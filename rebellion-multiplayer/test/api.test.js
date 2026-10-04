import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { makeDb } from './d1shim.js';
import { Writer, Reader } from '../src/amf0.js';
import * as db from '../src/db.js';
import { sha256Hex } from '../src/auth.js';

const TOKEN_A = 'aaaaaaaa-1111-4222-8333-444444444444';
const TOKEN_B = 'bbbbbbbb-1111-4222-8333-444444444444';

function makeEnv(extra = {}) {
  const hubCalls = [];
  return {
    DB: makeDb(), BLOCKED_WORDS: 'badword',
    ASSETS: { fetch: async () => new Response('static', { status: 200 }) },
    HUB: {
      idFromName: (n) => n,
      get: () => ({ fetch: async (req) => { hubCalls.push(req); return Response.json({ online: 3, rooms: [] }); } }),
    },
    hubCalls, ...extra,
  };
}
const call = (env, path, init = {}) => worker.fetch(new Request('https://game.example' + path, init), env, {});
const profile = (env, token, nickname) => call(env, '/api/profile', { method: 'POST', body: JSON.stringify({ token, nickname }) });
const cookieOf = (res) => /rr_token=[^;]+/.exec(res.headers.get('Set-Cookie'))?.[0];

function amf(target, args) {
  const w = new Writer();
  w.u16(0); w.u16(0); w.u16(1); w.utf(target); w.utf('/1'); w.i32(-1); w.value(args);
  return w.bytes();
}
async function remoting(env, cookie, target, args) {
  const res = await call(env, '/gateway.aspx', { method: 'POST', body: amf(target, args), headers: cookie ? { Cookie: cookie } : {} });
  const r = new Reader(new Uint8Array(await res.arrayBuffer()));
  r.u16(); r.u16(); r.u16();
  const name = r.utf(); r.utf(); r.i32();
  return { name, value: r.value() };
}
// What mx.remoting.RecordSet does with serverInfo: rows become objects keyed by column name.
const rows = (rs) => rs.props.serverInfo.initialData.map((row) =>
  Object.fromEntries(rs.props.serverInfo.columnNames.map((c, i) => [c, row[i]])));

test('profile: validation, cookie, uniqueness, rename keeps identity', async () => {
  const env = makeEnv();
  assert.equal((await profile(env, TOKEN_A, '1abc')).status, 400);       // must start with a letter
  assert.equal((await profile(env, TOKEN_A, 'a|b')).status, 400);        // protocol separators rejected
  assert.equal((await profile(env, TOKEN_A, 'xbadwordx')).status, 400);  // blocked list
  assert.equal((await profile(env, 'short', 'Ann')).status, 400);        // bad token
  const ok = await profile(env, TOKEN_A, 'Ann');
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('Set-Cookie'), /rr_token=.*HttpOnly.*SameSite=Lax.*Secure/);
  const body = await ok.json(); assert.equal(body.nickname, 'Ann'); assert.equal(body.id, 1);
  assert.equal((await profile(env, TOKEN_B, 'ann')).status, 409);        // case-insensitive clash
  assert.equal((await profile(env, TOKEN_A, 'Annie')).status, 200);      // rename same browser
  assert.equal((await (await profile(env, TOKEN_A, 'Annie')).json()).id, 1);
  assert.equal((await profile(env, TOKEN_B, 'Ann')).status, 200);        // old name is free again
});

test('legacy auth endpoint returns userID=<id>& for the cookie owner, 0 otherwise', async () => {
  const env = makeEnv();
  const cookie = cookieOf(await profile(env, TOKEN_A, 'Ann'));
  assert.equal(await (await call(env, '/common/getauthcookie.aspx', { headers: { Cookie: cookie } })).text(), 'userID=1&');
  assert.equal(await (await call(env, '/common/getauthcookie.aspx')).text(), 'userID=0&');
});

test('gateway GetUserInfo / GetUserCar / UpdateCarN round trip', async () => {
  const env = makeEnv();
  const cookie = cookieOf(await profile(env, TOKEN_A, 'Ann'));

  let r = await remoting(env, cookie, 'Mattel.HotWheels.UserServices_HW.GetUserInfo', [1]);
  assert.equal(r.name, '/1/onResult');
  assert.equal(rows(r.value.Table)[0].NickName, 'Ann');
  assert.equal(rows(r.value.Table)[0].userID, 1);

  r = await remoting(env, cookie, 'Mattel.GameService.Data.Shared_GameService.GetUserCar', [1, 34, 114]);
  let car = rows(r.value.Table)[0];
  assert.equal(car.car1, 'id=c0&locked=false&speedIcons=0&handlingIcons=0&accelIcons=0');
  assert.equal(car.car2, 'id=c1&locked=true&speedIcons=0&handlingIcons=0&accelIcons=0');

  await remoting(env, cookie, 'Mattel.GameService.Data.Shared_GameService.UpdateCar3', [1, 34, 114, 'id=c2&locked=false&speedIcons=9&handlingIcons=2&accelIcons=-3']);
  r = await remoting(env, cookie, 'Mattel.GameService.Data.Shared_GameService.GetUserCar', [1, 34, 114]);
  car = rows(r.value.Table)[0];
  assert.equal(car.car3, 'id=c2&locked=false&speedIcons=6&handlingIcons=2&accelIcons=0');   // sanitised
  await remoting(env, cookie, 'Mattel.GameService.Data.Shared_GameService.UpdateCar99', [1, 34, 114, 'x']);  // out of range: ignored
});

test('gateway: a request cannot modify someone else\'s cars when cookie is present', async () => {
  const env = makeEnv();
  const a = cookieOf(await profile(env, TOKEN_A, 'Ann'));
  await profile(env, TOKEN_B, 'Bob');                                   // Bob = player 2
  await remoting(env, a, 'Mattel.GameService.Data.Shared_GameService.UpdateCar2', [2, 34, 114, 'id=c1&locked=false&speedIcons=5']);
  assert.equal((await db.getCars(env.DB, 2))[1], 'id=c1&locked=true&speedIcons=0&handlingIcons=0&accelIcons=0');
  assert.match((await db.getCars(env.DB, 1))[1], /locked=false&speedIcons=5/);   // it went to Ann (the cookie owner)
});

test('STRICT_AUTH=1 refuses the cookie-less fallback', async () => {
  const env = makeEnv({ STRICT_AUTH: '1' });
  await profile(env, TOKEN_A, 'Ann');
  const r = await remoting(env, null, 'Mattel.HotWheels.UserServices_HW.GetUserInfo', [1]);
  assert.equal(rows(r.value.Table).length, 0);
  const lenient = makeEnv(); await profile(lenient, TOKEN_A, 'Ann');
  const r2 = await remoting(lenient, null, 'Mattel.HotWheels.UserServices_HW.GetUserInfo', [1]);
  assert.equal(rows(r2.value.Table)[0].NickName, 'Ann');
});

test('scores: server-credited, leaderboard ordered, client RecordCarScore ignored', async () => {
  const env = makeEnv();
  const a = cookieOf(await profile(env, TOKEN_A, 'Ann'));
  await profile(env, TOKEN_B, 'Bob');
  await profile(env, 'cccccccc-1111-4222-8333-444444444444', 'Cyd');
  await db.addScore(env.DB, 1, 3, true); await db.addScore(env.DB, 2, 3, false); await db.addScore(env.DB, 1, 2, true);

  const rec = await remoting(env, a, 'Mattel.GameService.Data.Shared_GameService.RecordCarScore', [1, 34, 114, 999]);
  assert.equal(rows(rec.value.Table)[0].score, 5);                      // 999 was NOT added

  const top = await remoting(env, null, 'Mattel.GameService.Data.Shared_GameService.GetTopCarList', [34, 114, 100]);
  assert.deepEqual(rows(top.value.Table), [{ username: 'Ann', score: 5 }, { username: 'Bob', score: 3 }]);   // Cyd has 0 -> hidden

  const st = await remoting(env, a, 'Mattel.GameService.Data.Shared_GameService.GetPlayerStatus', [1, 34]);
  assert.equal(rows(st.value.Table)[0].max_score, 5);

  const lb = await (await call(env, '/api/leaderboard')).json();
  assert.deepEqual(lb.rows, [{ username: 'Ann', score: 5 }, { username: 'Bob', score: 3 }]);
  const me = await (await call(env, '/api/me', { headers: { Cookie: a } })).json();
  assert.equal(me.rank, 1); assert.equal(me.wins, 2);
});

test('gateway errors come back as /onStatus, not a crash', async () => {
  const env = makeEnv();
  const r = await remoting(env, null, 'Some.Unknown.Service.Nope', []);
  assert.equal(r.name, '/1/onStatus');
  assert.equal(r.value.level, 'error');
  assert.equal((await call(env, '/gateway.aspx', { method: 'POST', body: new Uint8Array([1, 2, 3]) })).status, 400);
  assert.equal((await call(env, '/gateway.aspx')).status, 200);
});

test('/ws: requires an upgrade and a profile; forwards identity headers to the hub', async () => {
  const env = makeEnv();
  assert.equal((await call(env, '/ws')).status, 426);
  const up = { Upgrade: 'websocket' };
  assert.equal((await call(env, '/ws', { headers: up })).status, 401);
  const cookie = cookieOf(await profile(env, TOKEN_A, 'Ann'));
  await call(env, '/ws', { headers: { ...up, Cookie: cookie } });
  assert.equal(env.hubCalls.at(-1).headers.get('x-player-id'), '1');
  assert.equal(env.hubCalls.at(-1).headers.get('x-player-nick'), 'Ann');
});

test('static assets fall through; online stats proxied', async () => {
  const env = makeEnv();
  assert.equal(await (await call(env, '/index.html')).text(), 'static');
  assert.equal((await (await call(env, '/api/online')).json()).online, 3);
});

test('tokens are stored hashed', async () => {
  const env = makeEnv(); await profile(env, TOKEN_A, 'Ann');
  const row = await db.findById(env.DB, 1);
  assert.equal(row.token_hash, await sha256Hex(TOKEN_A)); assert.notEqual(row.token_hash, TOKEN_A);
});
