import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFramer, frame } from '../src/framing.js';

const bytes = (s) => new TextEncoder().encode(s);

test('splits concatenated messages and joins split ones', () => {
  const got = []; const feed = makeFramer((m) => got.push(m));
  feed(bytes('GST\0R\0SC')); feed(bytes('T|c1~1~1~1\0'));
  assert.deepEqual(got, ['GST', 'R', 'SCT|c1~1~1~1']);
});
test('accepts string frames too, ignores empty messages', () => {
  const got = []; const feed = makeFramer((m) => got.push(m));
  feed('A\0\0B\0'); assert.deepEqual(got, ['A', 'B']);
});
test('multi-byte characters split across chunks survive', () => {
  const got = []; const feed = makeFramer((m) => got.push(m));
  const b = bytes('Hot Wheels\u00ae!\0');
  feed(b.slice(0, 11)); feed(b.slice(11));          // cuts the 2-byte (r) in half
  assert.deepEqual(got, ['Hot Wheels\u00ae!']);
});
test('unterminated flood is discarded, not buffered forever', () => {
  const got = []; const feed = makeFramer((m) => got.push(m), 100);
  feed('x'.repeat(500)); feed('ok\0');
  assert.deepEqual(got, ['ok']);
});
test('frame() appends the NUL terminator', () => {
  const f = frame('ST|5'); assert.equal(f[f.length - 1], 0); assert.equal(new TextDecoder().decode(f.slice(0, -1)), 'ST|5');
});
