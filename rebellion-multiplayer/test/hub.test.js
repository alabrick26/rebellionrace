// Exercises the Durable Object adapter with a minimal stand-in for Cloudflare's WebSocketPair / 101 responses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hub } from '../src/hub.js';
import { makeDb } from './d1shim.js';

const RealResponse = globalThis.Response;
class FakeResponse {
  constructor(body, init = {}) { this.body = body; this.status = init.status ?? 200; this.webSocket = init.webSocket; this.headers = init.headers ?? {}; }
  static json(d) { return RealResponse.json(d); }
}
class FakeSocket {
  constructor() { this.handlers = {}; this.sent = []; this.closed = null; this.accepted = false; }
  accept() { this.accepted = true; }
  addEventListener(t, fn) { (this.handlers[t] ??= []).push(fn); }
  send(d) { this.sent.push(d); }
  close(code, reason) { this.closed = { code, reason }; }
  emit(t, data) { for (const fn of this.handlers[t] ?? []) fn({ data }); }
}
const dec = new TextDecoder(); const enc = new TextEncoder();
const text = (u8) => dec.decode(u8);

function setup() {
  const pairs = [];
  globalThis.Response = FakeResponse;
  globalThis.WebSocketPair = function () { const p = [new FakeSocket(), new FakeSocket()]; pairs.push(p); return { 0: p[0], 1: p[1] }; };
  const env = { DB: makeDb() };
  const hub = new Hub({ waitUntil: (p) => p }, env);
  return { hub, env, pairs, restore() { globalThis.Response = RealResponse; delete globalThis.WebSocketPair; clearInterval(hub.sweeper); } };
}
const req = (headers = {}, path = '/ws') => ({ url: 'https://hub' + path, headers: { get: (k) => headers[k] ?? headers[k.toLowerCase()] ?? null } });

test('Hub: handshake, NUL framing, login, time sync, subprotocol echo', async () => {
  const t = setup();
  try {
    assert.equal((await t.hub.fetch(req({}, '/ws'))).status, 426);                       // not an upgrade
    assert.equal((await t.hub.fetch(req({ Upgrade: 'websocket' }))).status, 401);         // no identity headers

    const res = await t.hub.fetch(req({ Upgrade: 'websocket', 'x-player-id': '7', 'x-player-nick': 'Ann', 'Sec-WebSocket-Protocol': 'binary, base64' }));
    assert.equal(res.status, 101);
    assert.equal(res.headers['Sec-WebSocket-Protocol'], 'binary');
    const [, server] = t.pairs[0];
    assert.ok(server.accepted);

    // 1st frame: binary, NUL-terminated ConnectionResponse
    assert.ok(server.sent[0] instanceof Uint8Array);
    assert.equal(server.sent[0].at(-1), 0);
    assert.match(text(server.sent[0]), /^<XmlDoc><Action>ConnectionResponse<\/Action>.*<Result>Accepted<\/Result>/);

    // Two messages in ONE websocket frame, the second split across frames
    const login = '<XmlDoc><Action>Login</Action><Parameters><Name>Ann</Name><Password></Password></Parameters></XmlDoc>';
    server.emit('message', enc.encode(`${login}\0GS`));
    server.emit('message', enc.encode('T\0'));
    assert.match(text(server.sent[1]), /<Action>LoginResponse<\/Action>.*<Result>Accepted<\/Result><Username>Ann<\/Username>/);
    assert.match(text(server.sent[2]), /^ST\|\d+\0$/);

    // stats + close cleans up
    assert.deepEqual(await (await t.hub.fetch(req({}, '/stats'))).json(), { online: 1, rooms: [] });
    server.emit('close');
    assert.deepEqual(await (await t.hub.fetch(req({}, '/stats'))).json(), { online: 0, rooms: [] });
  } finally { t.restore(); }
});

test('Hub: a finished race credits the score in D1', async () => {
  const t = setup();
  try {
    const { addScore } = await import('../src/db.js');
    t.env.DB.raw.exec("INSERT INTO players (token_hash,nickname,nickname_lc,created_at,last_seen) VALUES ('h','Ann','ann',0,0)");
    t.hub.engine.onFinish({ playerId: 1, nick: 'Ann', position: 1, carsBeaten: 3, timeMs: 1000 });
    await new Promise((r) => setTimeout(r, 20));
    const row = await t.env.DB.prepare('SELECT score, wins, races FROM players WHERE id = 1').first();
    assert.deepEqual(row, { score: 3, wins: 1, races: 1 });
    assert.ok(addScore);
  } finally { t.restore(); }
});
