import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEngine, makeConn, enter, X } from './helpers.js';
import { DEFAULTS } from '../src/engine.js';

test('connect -> ConnectionResponse, login accepted, wrong name declined', () => {
  const { engine } = makeEngine();
  const c = makeConn('Ann'); engine.connect(c);
  assert.match(c.sent[0], /<Action>ConnectionResponse<\/Action>.*<Result>Accepted<\/Result>.*Major="3"/);
  engine.receive(c, X.login('Mallory'));
  assert.match(c.sent[1], /<Result>Declined<\/Result>/);
  engine.receive(c, X.login('ann'));
  assert.match(c.sent[2], /<Result>Accepted<\/Result><Username>Ann<\/Username><Variables><\/Variables>/);
});

test('GST -> ST, GetServerTime -> XML', () => {
  const { engine } = makeEngine();
  const c = enter(engine, 'Ann', { join: false });
  engine.receive(c, 'GST');
  assert.match(c.last('ST'), /^ST\|\d+$/);
  engine.receive(c, X.time());
  assert.match(c.sent.at(-1), /<Action>GetServerTime<\/Action><Parameters><ServerTime>\d+<\/ServerTime>/);
});

test('a lone player just waits (no TRI)', () => {
  const { engine, clock } = makeEngine();
  const a = enter(engine, 'Ann');
  clock.advance(60000);
  assert.deepEqual(a.codes(), []);
});

test('full race: TRI -> R -> CL/PGCD -> SG -> RSG -> CA/IC/ICL -> F -> GO/GRCD -> next TRI', () => {
  const { engine, clock, finishes } = makeEngine();
  const a = enter(engine, 'Ann', { car: 'c3~2~1~0' });
  const b = enter(engine, 'Bob', { car: 'c1~3~3~3' });
  clock.advance(DEFAULTS.openGraceMs);
  for (const c of [a, b]) assert.match(c.last('TRI'), /^TRI\|0~\d+$/);
  assert.equal(a.last('TRI'), b.last('TRI'));                 // same seed -> same track for everyone

  engine.receive(a, 'R');
  assert.equal(a.last('CL'), undefined);                       // waits for Bob
  engine.receive(b, 'R');
  assert.equal(a.last('CL'), 'CL|Ann,-100,-200,c3,2,1,0~Bob,100,-200,c1,3,3,3~');
  assert.equal(a.last('PGCD'), `PGCD|${DEFAULTS.pregameMs}`);

  clock.advance(DEFAULTS.pregameMs);
  assert.ok(a.codes().includes('SG')); assert.ok(!a.codes().includes('RSG'));
  clock.advance(DEFAULTS.lightsMs);
  assert.ok(a.codes().includes('RSG'));

  // car actions are stamped with server time + sender name and echoed to everyone (incl. sender)
  engine.receive(a, 'CA|SA~0~-200~0~270~0');
  assert.match(b.last('CA'), /^CA\|\d+~Ann~SA~0~-200~0~270~0$/);
  assert.match(a.last('CA'), /^CA\|\d+~Ann~SA~0~-200~0~270~0$/);
  engine.receive(a, 'CA|TAC,off road~10.5~-5000~0.45~271~12');
  assert.match(b.last('CA'), /~Ann~TAC,off road~10\.5~-5000~0\.45~271~12$/);
  engine.receive(a, 'CA|HACK^IC|1~x~1~2~3~4~5');               // injection attempts are dropped
  engine.receive(a, 'CA|SR~a~b~c~d~e');

  // first-come item pickup
  engine.receive(a, 'AC|7'); engine.receive(b, 'AC|7');
  assert.equal(a.raw().filter((s) => s === 'IC|7~Ann').length, 1);
  assert.ok(!b.raw().includes('IC|7~Bob'));
  engine.receive(b, 'ICL|85~0.645~190~SOMEONE_ELSE');          // name is forced to the real sender
  assert.equal(a.last('ICL'), 'ICL|85~0.645~190~Bob');

  clock.advance(41000);
  engine.receive(b, 'F');
  assert.equal(a.last('F'), 'F|Bob~41000');
  assert.deepEqual(finishes, [{ playerId: b.playerId, nick: 'Bob', position: 1, carsBeaten: 1, timeMs: 41000 }]);
  engine.receive(b, 'F');                                      // double finish ignored
  assert.equal(finishes.length, 1);
  clock.advance(3000);
  engine.receive(a, 'F');
  assert.equal(finishes[1].carsBeaten, 0);                     // last place beats nobody
  assert.equal(a.last('GO'), 'GO|Bob~Ann');                    // everyone done -> immediate results
  assert.equal(a.last('GRCD'), `GRCD|${DEFAULTS.resultsMs}`);

  const before = a.raw().filter((s) => s.startsWith('TRI')).length;
  clock.advance(DEFAULTS.resultsMs);
  assert.equal(a.raw().filter((s) => s.startsWith('TRI')).length, before + 1);   // next race starts
});

test('ready timeout starts the countdown even if a client never answers', () => {
  const { engine, clock } = makeEngine();
  const a = enter(engine, 'Ann'); enter(engine, 'Bob');
  clock.advance(DEFAULTS.openGraceMs);
  engine.receive(a, 'R');
  clock.advance(DEFAULTS.readyTimeoutMs);
  assert.ok(a.last('CL')); assert.ok(a.last('PGCD'));
});

test('grace timer ends the race after the first finisher', () => {
  const { engine, clock } = makeEngine();
  const a = enter(engine, 'Ann'); const b = enter(engine, 'Bob');
  clock.advance(DEFAULTS.openGraceMs); engine.receive(a, 'R'); engine.receive(b, 'R');
  clock.advance(DEFAULTS.pregameMs + DEFAULTS.lightsMs);
  engine.receive(a, 'F');
  assert.equal(a.last('GO'), undefined);
  clock.advance(DEFAULTS.finishGraceMs);
  assert.equal(a.last('GO'), 'GO|Ann~Bob');                    // DNF players are listed last
});

test('leaving during the countdown cancels it (PGCDC) and the survivor waits', () => {
  const { engine, clock } = makeEngine();
  const a = enter(engine, 'Ann'); const b = enter(engine, 'Bob');
  clock.advance(DEFAULTS.openGraceMs); engine.receive(a, 'R'); engine.receive(b, 'R');
  engine.receive(b, X.leave());
  assert.equal(a.last('UL'), 'UL|Bob'); assert.ok(a.codes().includes('PGCDC'));
  clock.advance(60000);
  assert.ok(!a.codes().includes('SG'));
  enter(engine, 'Cyd');                                        // a new opponent restarts the cycle
  clock.advance(DEFAULTS.openGraceMs);
  assert.equal(a.raw().filter((s) => s.startsWith('TRI')).length, 2);
});

test('disconnect mid-race: UL sent, remaining finisher ends the round', () => {
  const { engine, clock } = makeEngine();
  const a = enter(engine, 'Ann'); const b = enter(engine, 'Bob');
  clock.advance(DEFAULTS.openGraceMs); engine.receive(a, 'R'); engine.receive(b, 'R');
  clock.advance(DEFAULTS.pregameMs + DEFAULTS.lightsMs);
  engine.disconnect(b);
  assert.equal(a.last('UL'), 'UL|Bob');
  engine.receive(a, 'F');
  assert.equal(a.last('GO'), 'GO|Ann');
});

test('4 players get 4 grid slots; a 5th goes to a second room', () => {
  const { engine, clock } = makeEngine();
  const names = ['P1', 'P2', 'P3', 'P4'].map((n) => enter(engine, n));
  const p5 = enter(engine, 'P5');
  assert.equal(engine.stats().rooms.length, 2);
  clock.advance(DEFAULTS.openGraceMs);
  for (const c of names) engine.receive(c, 'R');
  assert.match(names[0].last('CL'), /P3,-100,-110.*P4,100,-110/);
  assert.deepEqual(p5.codes(), []);
});

test('a player who joins during the results screen is included in the next race', () => {
  const { engine, clock } = makeEngine();
  const a = enter(engine, 'Ann'); const b = enter(engine, 'Bob');
  clock.advance(DEFAULTS.openGraceMs); engine.receive(a, 'R'); engine.receive(b, 'R');
  clock.advance(DEFAULTS.pregameMs + DEFAULTS.lightsMs);
  engine.receive(a, 'F'); engine.receive(b, 'F');
  const c = enter(engine, 'Cyd');
  assert.equal(engine.stats().rooms.length, 1);
  clock.advance(DEFAULTS.resultsMs);
  assert.ok(c.last('TRI'));
});

test('taunts: index or text accepted, unknown text dropped', () => {
  const { engine, clock } = makeEngine();
  const a = enter(engine, 'Ann'); const b = enter(engine, 'Bob');
  clock.advance(DEFAULTS.openGraceMs); engine.receive(a, 'R'); engine.receive(b, 'R');
  engine.receive(a, 'SendTaunt|2');
  assert.equal(b.last('DisplayTaunt'), 'DisplayTaunt|Ann~Nice race!');
  engine.receive(a, 'SendTaunt|Eat my dust!');
  assert.equal(b.last('DisplayTaunt'), 'DisplayTaunt|Ann~Eat my dust!');
  engine.receive(a, 'SendTaunt|<script>');
  assert.equal(b.raw().filter((s) => s.startsWith('DisplayTaunt')).length, 2);
});

test('same player logging in twice: the newer connection wins', () => {
  const { engine } = makeEngine();
  const a1 = makeConn('Ann', 7); engine.connect(a1); engine.receive(a1, X.login('Ann'));
  const a2 = makeConn('Ann', 7); engine.connect(a2); engine.receive(a2, X.login('Ann'));
  assert.ok(a1.closed); assert.ok(!a2.closed);
});

test('unauthenticated clients cannot join; garbage input is harmless; idle clients are swept', () => {
  const { engine, clock } = makeEngine();
  const c = makeConn('Ann'); engine.connect(c);
  engine.receive(c, X.join());
  assert.equal(engine.stats().rooms.length, 0);
  for (const junk of ['<<<', '|||', 'F', 'AC|x', 'CA|', 'ICL|1', 'SCT|zz~9', '\u0000', 'X'.repeat(5000)]) engine.receive(c, junk);
  clock.advance(DEFAULTS.idleMs + 1);
  engine.sweep();
  assert.ok(c.closed);
});

test('SCT clamps icons and rejects unknown cars', () => {
  const { engine, clock } = makeEngine();
  const a = enter(engine, 'Ann', { car: 'c11~99~-4~abc' }); const b = enter(engine, 'Bob', { car: 'evil~3~3~3' });
  clock.advance(DEFAULTS.openGraceMs); engine.receive(a, 'R'); engine.receive(b, 'R');
  assert.equal(a.last('CL'), 'CL|Ann,-100,-200,c11,6,0,0~Bob,100,-200,c0,0,0,0~');
});

test('flood guard drops excess messages', () => {
  const { engine, clock } = makeEngine({ msgPerSecond: 5 });
  const a = enter(engine, 'Ann', { join: false });
  const before = a.sent.length;
  for (let i = 0; i < 50; i++) engine.receive(a, 'GST');
  assert.ok(a.sent.length - before <= 5);
  clock.advance(1000);
  engine.receive(a, 'GST');
  assert.ok(a.sent.length - before <= 6);
});
