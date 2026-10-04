import test from 'node:test';
import assert from 'node:assert/strict';
import { Writer, Reader, TypedObject, parseRequest, buildResponse, recordSet } from '../src/amf0.js';

test('value round trip', () => {
  const w = new Writer();
  const sample = { a: 1, b: 'héllo', c: [1, 'x', null, true], d: { e: false }, f: undefined };
  w.value(sample); w.value(new Date(86400000)); w.value('x'.repeat(70000));
  const r = new Reader(w.bytes());
  assert.deepEqual(r.value(), { a: 1, b: 'héllo', c: [1, 'x', null, true], d: { e: false } });
  assert.equal(r.value().getTime(), 86400000);
  assert.equal(r.value().length, 70000);
});

test('parses a Flash-style remoting request (strict-array body)', () => {
  const w = new Writer();
  w.u16(0); w.u16(0); w.u16(1);
  w.utf('Mattel.GameService.Data.Shared_GameService.GetUserCar'); w.utf('/1'); w.i32(-1);
  w.value([42, 34, 114]);
  const { messages } = parseRequest(w.bytes());
  assert.equal(messages.length, 1);
  assert.equal(messages[0].response, '/1');
  assert.deepEqual(messages[0].args, [42, 34, 114]);
});

test('response frames result as /1/onResult with a typed RecordSet', () => {
  const rs = recordSet(['username', 'score'], [['Ann', 5], ['Bob', 3]]);
  const bytes = buildResponse([{ response: '/1', ok: true, value: { Table: rs } }]);
  const r = new Reader(bytes);
  assert.equal(r.u16(), 0); assert.equal(r.u16(), 0); assert.equal(r.u16(), 1);
  assert.equal(r.utf(), '/1/onResult'); assert.equal(r.utf(), 'null'); assert.equal(r.i32(), -1);
  const v = r.value();
  assert.ok(v.Table instanceof TypedObject);
  assert.equal(v.Table.className, 'RecordSet');
  const si = v.Table.props.serverInfo;
  assert.equal(si.version, 1);
  assert.deepEqual(si.columnNames, ['username', 'score']);
  assert.deepEqual(si.initialData, [['Ann', 5], ['Bob', 3]]);
  assert.equal(si.totalCount, 2);
});

test('truncated input throws instead of hanging', () => {
  assert.throws(() => parseRequest(Uint8Array.of(0, 0, 0, 0, 0, 1)));
});
