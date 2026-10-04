// Fake clock + fake sockets for driving the RaceEngine deterministically.
import { RaceEngine } from '../src/engine.js';

export function makeClock() {
  let t = 1_800_000_000_000; let nextId = 1; const timers = [];
  return {
    now: () => t,
    setTimer(fn, ms) { const x = { id: nextId++, at: t + ms, fn }; timers.push(x); return x.id; },
    clearTimer(id) { const i = timers.findIndex((x) => x.id === id); if (i >= 0) timers.splice(i, 1); },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const n = timers[0];
        if (!n || n.at > end) break;
        timers.shift(); t = n.at; n.fn();
      }
      t = end;
    },
    pending: () => timers.length,
  };
}

export function makeEngine(over = {}) {
  const clock = makeClock(); const finishes = [];
  const engine = new RaceEngine({ ...clock, random: () => 0.5, onFinish: (r) => finishes.push(r), ...over });
  return { engine, clock, finishes };
}

let seq = 0;
export function makeConn(nick, playerId = ++seq) {
  const c = { id: `c${++seq}`, playerId, nick, sent: [], closed: false,
    send(s) { this.sent.push(s); }, close() { this.closed = true; } };
  c.raw = () => c.sent.filter((s) => !s.startsWith('<'));
  c.codes = () => c.raw().map((s) => s.split('|')[0]);
  c.last = (code) => [...c.raw()].reverse().find((s) => s === code || s.startsWith(code + '|'));
  return c;
}

const doc = (action, params = '') => `<XmlDoc><Action>${action}</Action><Parameters>${params}</Parameters></XmlDoc>`;
export const X = {
  login: (n) => doc('Login', `<Name>${n}</Name><Password></Password>`),
  raw: (n) => doc('RegisterRawHandler', `<Name>${n}</Name>`),
  join: () => doc('ExecutePlugin', '<Plugin>HWGameManager</Plugin><Method>JoinAnyGame</Method><Variables><Variable><Name>GameName</Name><Value>RebellionRace</Value></Variable></Variables>'),
  leave: () => doc('ExecutePlugin', '<Plugin>HWGameManager</Plugin><Method>LeaveGame</Method><Variables />'),
  time: () => doc('GetServerTime'),
};

/** Connect + login + register raw handler + (optionally) pick a car and join. */
export function enter(engine, nick, { join = true, car } = {}) {
  const c = makeConn(nick);
  engine.connect(c);
  engine.receive(c, X.login(nick));
  engine.receive(c, X.raw('RebellionRace'));
  if (car) engine.receive(c, `SCT|${car}`);
  if (join) engine.receive(c, X.join());
  return c;
}
