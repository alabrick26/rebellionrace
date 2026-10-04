// RaceEngine: everything the original ElectroServer + "HWGameManager"/"RebellionRace" plugins did,
// reduced to what the game's SWF actually uses. Pure logic: no Cloudflare APIs, so it is unit-testable.
//
// Wire protocol (see docs/PROTOCOL.md):
//   XML control messages:  Login, CreateRoom (= back to lobby), RegisterRawHandler,
//                          ExecutePlugin(HWGameManager: JoinAnyGame|LeaveGame), GetServerTime, Logout
//   Raw game messages:     R, GST, SCT, CA, AC, ICL, F, SendTaunt   (client -> server)
//                          ST, TRI, CL, PGCD, PGCDC, SG, RSG, CA, IC, ICL, F, GO, GRCD, GRCDC, UL, DisplayTaunt
import * as es from './es3.js';

export const EPOCH = Date.UTC(2026, 0, 1);
export const GRID = [[-100, -200], [100, -200], [-100, -110], [100, -110]];
export const TAUNTS = [
  'Good luck', 'Beat that!', 'Nice race!', 'Eat my dust!', 'Try again!', 'Booyah!', "I'm winning this time!",
  'Gotcha!', 'Maybe next time', 'Bring it!', 'Good game!', 'AARRGGHH!', 'Forget about it!', 'So close!',
  'Pedal to the metal!', "Burn 'n' turn", 'No way!', 'I love Hot Wheels\u00ae!', 'Too slow',
  'Watch my taillights!', 'In your dreams!', 'I own the finish line!', 'Boosters are my friend',
  'This game rocks!', 'Best. Game. Ever!', "Can't catch this!", 'No one can stop me!', "I'm untouchable!",
  "I'm the king of the track!",
];

export const DEFAULTS = {
  maxPlayers: 4,
  openGraceMs: 3000,     // after the 2nd player joins, wait a moment for more before starting
  readyTimeoutMs: 5000,  // wait for every client to answer TRI with "R"
  pregameMs: 10000,      // "Starting in N seconds"
  lightsMs: 3000,        // SG (red lights) -> RSG (green)
  finishGraceMs: 20000,  // after the first finisher, everyone else has this long
  raceTimeoutMs: 240000, // hard cap for a race
  resultsMs: 8000,       // results screen before the next race
  idleMs: 180000,        // drop connections that go silent (the game pings every 90 s)
  msgPerSecond: 150,     // per-connection flood guard
};

const NUM = /^-?\d+(\.\d+)?(e-?\d+)?$/i;
const isNum = (s) => typeof s === 'string' && NUM.test(s);
const CAR_ID = /^c(\d|1[01])$/;

export class RaceEngine {
  /**
   * @param {object} opts  now(), setTimer(fn,ms)->id, clearTimer(id), random(), onFinish(result), plus DEFAULTS overrides
   */
  constructor(opts = {}) {
    this.o = { ...DEFAULTS, ...opts };
    this.now = opts.now ?? (() => Date.now());
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id));
    this.random = opts.random ?? Math.random;
    this.onFinish = opts.onFinish ?? (() => {});
    this.clients = new Map();
    this.rooms = new Map();
    this.nextRoomId = 1;
  }

  serverTime() { return Math.round(this.now() - EPOCH); }

  // ------------------------------------------------------------------ connection lifecycle
  /** conn = { id, playerId, nick, send(str), close() } */
  connect(conn) {
    const st = {
      conn, id: conn.id, playerId: conn.playerId, nick: conn.nick,
      loggedIn: false, rawHandler: null,
      car: { id: 'c0', speed: 0, handling: 0, accel: 0 },
      room: null, ready: false, finished: false, slot: null,
      lastSeen: this.now(), windowStart: this.now(), windowCount: 0,
    };
    this.clients.set(conn.id, st);
    conn.send(es.connectionAccepted());
    return st;
  }

  disconnect(conn) {
    const st = this.clients.get(conn.id);
    if (!st) return;
    this.leave(st);
    this.clients.delete(conn.id);
  }

  /** Forcefully drop a client (also closes its socket). */
  drop(st, reason) {
    this.leave(st);
    this.clients.delete(st.id);
    try { st.conn.close(1000, reason ?? 'closed'); } catch { /* already closed */ }
  }

  /** Call periodically: removes connections that have gone silent. */
  sweep() {
    const cutoff = this.now() - this.o.idleMs;
    for (const st of [...this.clients.values()]) if (st.lastSeen < cutoff) this.drop(st, 'idle');
  }

  stats() {
    return {
      online: [...this.clients.values()].filter((c) => c.loggedIn).length,
      rooms: [...this.rooms.values()].map((r) => ({ id: r.id, status: r.status, players: r.players.length })),
    };
  }

  // ------------------------------------------------------------------ inbound
  receive(conn, text) {
    const st = this.clients.get(conn.id);
    if (!st || typeof text !== 'string' || text === '') return;
    const t = this.now();
    st.lastSeen = t;
    if (t - st.windowStart >= 1000) { st.windowStart = t; st.windowCount = 0; }
    if (++st.windowCount > this.o.msgPerSecond) return; // flood guard
    try {
      if (text.charCodeAt(0) === 60 /* < */) this.onXml(st, text);
      else this.onRaw(st, text);
    } catch {
      /* never let a malformed message take the room down */
    }
  }

  onXml(st, text) {
    const doc = es.parseClientDoc(text);
    if (!doc) return;
    switch (doc.action) {
      case 'Login': return this.login(st, doc);
      case 'RegisterRawHandler': st.rawHandler = doc.name ?? null; return undefined;
      case 'GetServerTime': return st.conn.send(es.serverTimeXml(this.serverTime()));
      case 'ExecutePlugin':
        if (doc.plugin !== 'HWGameManager' || !st.loggedIn) return undefined;
        if (doc.method === 'JoinAnyGame') return this.join(st);
        if (doc.method === 'LeaveGame') return this.leave(st);
        return undefined;
      case 'CreateRoom':
        // The original game's joinLobby() (run after login and whenever a player leaves a race) creates a hidden
        // lobby room. On the old server that moved the player out of any race room; here it frees the seat.
        if (!st.loggedIn) {
          return st.conn.send(es.esDoc('CreateRoom', '<Result>Failure</Result><Reason>Not logged in</Reason>'));
        }
        this.leave(st);
        return st.conn.send(es.esDoc('CreateRoom', '<Result>Success</Result>'));
      case 'Logout': return this.drop(st, 'logout');
      default: return undefined;
    }
  }

  login(st, doc) {
    const wanted = (doc.name ?? '').toLowerCase();
    if (!wanted || wanted !== st.nick.toLowerCase()) {
      st.conn.send(es.loginDeclined('Nickname does not match this browser profile'));
      return;
    }
    // the same player in another tab/connection: the newest connection wins
    for (const other of [...this.clients.values()]) {
      if (other !== st && other.playerId === st.playerId) this.drop(other, 'replaced');
    }
    st.loggedIn = true;
    st.conn.send(es.loginAccepted(st.nick));
  }

  onRaw(st, text) {
    if (text.includes('^')) return; // '^' is the batch separator; clients never send it
    const bar = text.indexOf('|');
    const code = bar < 0 ? text : text.slice(0, bar);
    const rest = bar < 0 ? '' : text.slice(bar + 1);
    switch (code) {
      case 'GST': return st.conn.send(`ST|${this.serverTime()}`);
      case 'SCT': return this.setCar(st, rest);
      case 'R': return this.ready(st);
      case 'CA': return this.carAction(st, rest);
      case 'AC': return this.attemptCollect(st, rest);
      case 'ICL': return this.itemCollision(st, rest);
      case 'F': return this.finish(st);
      case 'SendTaunt': return this.taunt(st, rest);
      default: return undefined; // incl. the SWF's debug "SG" button
    }
  }

  // ------------------------------------------------------------------ handlers
  setCar(st, rest) {
    const [id, s, h, a] = rest.split('~');
    if (!CAR_ID.test(id ?? '')) return;
    const icon = (v) => Math.max(0, Math.min(6, Number.parseInt(v, 10) || 0));
    st.car = { id, speed: icon(s), handling: icon(h), accel: icon(a) };
  }

  join(st) {
    if (st.room) this.leave(st);
    let room = [...this.rooms.values()].find(
      (r) => (r.status === 'open' || r.status === 'results') && r.players.length < this.o.maxPlayers,
    );
    if (!room) room = this.createRoom();
    room.players.push(st);
    st.room = room;
    st.ready = false;
    st.finished = false;
    if (room.status === 'open' && room.players.length >= 2 && !room.timers.open) {
      room.timer('open', this.o.openGraceMs, () => this.beginRound(room));
    }
  }

  leave(st) {
    const room = st.room;
    if (!room) return;
    st.room = null;
    st.ready = false;
    st.finished = false;
    room.players = room.players.filter((p) => p !== st);
    this.bcast(room, `UL|${st.nick}`);
    if (room.players.length === 0) { this.disposeRoom(room); return; }
    const n = room.players.length;
    switch (room.status) {
      case 'open':
        if (n < 2) room.clear('open');
        break;
      case 'prep':
      case 'countdown':
      case 'light':
        if (n < 2) { room.clearAll(); room.status = 'open'; this.bcast(room, 'PGCDC'); }
        else if (room.status === 'prep' && room.players.every((p) => p.ready)) this.sendGrid(room);
        break;
      case 'racing':
        if (room.players.every((p) => p.finished)) this.endRound(room);
        break;
      case 'results':
        if (n < 2) { room.clear('results'); room.status = 'open'; this.bcast(room, 'GRCDC'); }
        break;
      default:
    }
  }

  ready(st) {
    const room = st.room;
    if (!room || room.status !== 'prep') return;
    st.ready = true;
    if (room.players.every((p) => p.ready)) this.sendGrid(room);
  }

  carAction(st, rest) {
    const room = st.room;
    if (!room || !['countdown', 'light', 'racing'].includes(room.status)) return;
    const f = rest.split('~');
    // ACTION~x~y~speed~rotation~percent
    if (f.length !== 6 || !/^[A-Za-z0-9,.\- ]{1,32}$/.test(f[0]) || !f.slice(1).every(isNum)) return;
    this.bcast(room, `CA|${this.serverTime()}~${st.nick}~${rest}`);
  }

  attemptCollect(st, rest) {
    const room = st.room;
    if (!room || room.status !== 'racing') return;
    const id = Number.parseInt(rest, 10);
    if (!Number.isInteger(id) || id < 0 || room.collected.has(id)) return;
    room.collected.add(id);
    this.bcast(room, `IC|${id}~${st.nick}`);
  }

  itemCollision(st, rest) {
    const room = st.room;
    if (!room || room.status !== 'racing') return;
    const [id, speed, angle] = rest.split('~');
    if (!/^\d+$/.test(id ?? '') || !isNum(speed) || !isNum(angle)) return;
    this.bcast(room, `ICL|${id}~${speed}~${angle}~${st.nick}`);
  }

  taunt(st, rest) {
    const room = st.room;
    if (!room || !['countdown', 'light'].includes(room.status)) return;
    const text = /^\d+$/.test(rest) ? TAUNTS[Number(rest)] : TAUNTS.find((t) => t === rest);
    if (text) this.bcast(room, `DisplayTaunt|${st.nick}~${text}`);
  }

  finish(st) {
    const room = st.room;
    if (!room || room.status !== 'racing' || st.finished || !room.roundPlayers.includes(st)) return;
    st.finished = true;
    const before = room.finishOrder.length;
    room.finishOrder.push(st);
    const ms = Math.max(0, Math.round(this.now() - room.startedAt));
    this.bcast(room, `F|${st.nick}~${ms}`);
    const roundSize = room.roundPlayers.length;
    if (roundSize >= 2) {
      this.onFinish({
        playerId: st.playerId, nick: st.nick, position: before + 1,
        carsBeaten: Math.max(0, roundSize - 1 - before), timeMs: ms,
      });
    }
    if (room.players.every((p) => p.finished || !room.roundPlayers.includes(p))) this.endRound(room);
    else if (before === 0) room.timer('grace', this.o.finishGraceMs, () => this.endRound(room));
  }

  // ------------------------------------------------------------------ round state machine
  createRoom() {
    const engine = this;
    const room = {
      id: this.nextRoomId++, status: 'open', players: [], roundPlayers: [], finishOrder: [],
      collected: new Set(), seed: 0, startedAt: 0, timers: {},
      timer(name, ms, fn) {
        this.clear(name);
        this.timers[name] = engine.setTimer(() => { delete this.timers[name]; fn(); }, ms);
      },
      clear(name) {
        if (this.timers[name] !== undefined) { engine.clearTimer(this.timers[name]); delete this.timers[name]; }
      },
      clearAll() { for (const n of Object.keys(this.timers)) this.clear(n); },
    };
    this.rooms.set(room.id, room);
    return room;
  }

  disposeRoom(room) { room.clearAll(); this.rooms.delete(room.id); }

  bcast(room, msg) {
    for (const p of room.players) {
      try { p.conn.send(msg); } catch { /* socket already gone */ }
    }
  }

  beginRound(room) {
    room.clear('open');
    if (room.players.length < 2) { room.status = 'open'; return; }
    room.status = 'prep';
    room.seed = Math.floor(this.random() * 2147483646) + 1;
    room.collected = new Set();
    room.finishOrder = [];
    room.roundPlayers = [...room.players];
    for (const p of room.players) { p.ready = false; p.finished = false; }
    this.bcast(room, `TRI|0~${room.seed}`);
    room.timer('ready', this.o.readyTimeoutMs, () => this.sendGrid(room));
  }

  sendGrid(room) {
    if (room.status !== 'prep') return;
    room.clear('ready');
    if (room.players.length < 2) { room.status = 'open'; this.bcast(room, 'PGCDC'); return; }
    room.status = 'countdown';
    room.roundPlayers = [...room.players];
    room.players.forEach((p, i) => { p.slot = GRID[i % GRID.length]; });
    const cars = room.players
      .map((p) => `${p.nick},${p.slot[0]},${p.slot[1]},${p.car.id},${p.car.speed},${p.car.handling},${p.car.accel}`)
      .join('~');
    this.bcast(room, `CL|${cars}~`);
    this.bcast(room, `PGCD|${this.o.pregameMs}`);
    room.timer('pregame', this.o.pregameMs, () => this.startLights(room));
  }

  startLights(room) {
    if (room.status !== 'countdown') return;
    room.status = 'light';
    this.bcast(room, 'SG');
    room.timer('lights', this.o.lightsMs, () => this.go(room));
  }

  go(room) {
    if (room.status !== 'light') return;
    room.status = 'racing';
    room.startedAt = this.now();
    this.bcast(room, 'RSG');
    room.timer('race', this.o.raceTimeoutMs, () => this.endRound(room));
  }

  endRound(room) {
    if (room.status !== 'racing') return;
    room.clear('grace');
    room.clear('race');
    room.status = 'results';
    const names = room.finishOrder.map((p) => p.nick);
    for (const p of room.roundPlayers) if (!names.includes(p.nick) && room.players.includes(p)) names.push(p.nick);
    this.bcast(room, `GO|${names.join('~')}`);
    this.bcast(room, `GRCD|${this.o.resultsMs}`);
    room.timer('results', this.o.resultsMs, () => this.nextRound(room));
  }

  nextRound(room) {
    if (room.status !== 'results') return;
    if (room.players.length >= 2) this.beginRound(room);
    else { room.status = 'open'; this.bcast(room, 'GRCDC'); }
  }
}
