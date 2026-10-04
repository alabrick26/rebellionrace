// Minimal AMF0 codec + Flash Remoting packet helpers (what AS2 NetConnection.call speaks).
// AMF0 markers: 0x00 number, 0x01 bool, 0x02 string, 0x03 object, 0x05 null, 0x06 undefined,
// 0x07 reference, 0x08 ECMA array, 0x09 object-end, 0x0A strict array, 0x0B date,
// 0x0C long string, 0x10 typed object.

const enc = new TextEncoder();
const dec = new TextDecoder();

/** A typed (class-named) AMF0 object, e.g. new TypedObject("RecordSet", { serverInfo: {...} }) */
export class TypedObject {
  constructor(className, props) {
    this.className = className;
    this.props = props;
  }
}

// ---------------------------------------------------------------- reader
export class Reader {
  constructor(buf) {
    this.u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    this.dv = new DataView(this.u8.buffer, this.u8.byteOffset, this.u8.byteLength);
    this.pos = 0;
    this.refs = [];
  }
  need(n) {
    if (this.pos + n > this.u8.length) throw new Error('AMF0: unexpected end of data');
  }
  byte() { this.need(1); return this.u8[this.pos++]; }
  u16() { this.need(2); const v = this.dv.getUint16(this.pos); this.pos += 2; return v; }
  i32() { this.need(4); const v = this.dv.getInt32(this.pos); this.pos += 4; return v; }
  u32() { this.need(4); const v = this.dv.getUint32(this.pos); this.pos += 4; return v; }
  f64() { this.need(8); const v = this.dv.getFloat64(this.pos); this.pos += 8; return v; }
  utf(len) {
    const n = len ?? this.u16();
    this.need(n);
    const s = dec.decode(this.u8.subarray(this.pos, this.pos + n));
    this.pos += n;
    return s;
  }
  props(target) {
    for (;;) {
      const key = this.utf();
      if (key === '' && this.u8[this.pos] === 0x09) { this.pos++; return target; }
      target[key] = this.value();
    }
  }
  value() {
    const t = this.byte();
    switch (t) {
      case 0x00: return this.f64();
      case 0x01: return this.byte() !== 0;
      case 0x02: return this.utf();
      case 0x03: { const o = {}; this.refs.push(o); return this.props(o); }
      case 0x05: return null;
      case 0x06: return undefined;
      case 0x07: return this.refs[this.u16()];
      case 0x08: { this.u32(); const o = {}; this.refs.push(o); return this.props(o); }
      case 0x0a: {
        const n = this.u32();
        const a = [];
        this.refs.push(a);
        for (let i = 0; i < n; i++) a.push(this.value());
        return a;
      }
      case 0x0b: { const ms = this.f64(); this.u16(); return new Date(ms); }
      case 0x0c:
      case 0x0f: { const n = this.u32(); return this.utf(n); }
      case 0x10: {
        const cls = this.utf();
        const o = {};
        this.refs.push(o);
        this.props(o);
        return new TypedObject(cls, o);
      }
      default: throw new Error('AMF0: unsupported marker 0x' + t.toString(16));
    }
  }
}

// ---------------------------------------------------------------- writer
export class Writer {
  constructor() { this.chunks = []; this.len = 0; }
  push(u8) { this.chunks.push(u8); this.len += u8.length; }
  byte(v) { this.push(Uint8Array.of(v)); }
  u16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v); this.push(b); }
  i32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v); this.push(b); }
  u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0); this.push(b); }
  f64(v) { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v); this.push(b); }
  utf(s) { const b = enc.encode(s); this.u16(b.length); this.push(b); }
  props(obj) {
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) continue;
      this.utf(k);
      this.value(v);
    }
    this.u16(0);
    this.byte(0x09);
  }
  value(v) {
    if (v === null) return this.byte(0x05);
    if (v === undefined) return this.byte(0x06);
    switch (typeof v) {
      case 'number': this.byte(0x00); return this.f64(v);
      case 'bigint': this.byte(0x00); return this.f64(Number(v));
      case 'boolean': this.byte(0x01); return this.byte(v ? 1 : 0);
      case 'string': {
        const b = enc.encode(v);
        if (b.length > 0xffff) { this.byte(0x0c); this.u32(b.length); this.push(b); }
        else { this.byte(0x02); this.u16(b.length); this.push(b); }
        return undefined;
      }
      case 'object': {
        if (v instanceof Date) { this.byte(0x0b); this.f64(v.getTime()); return this.u16(0); }
        if (v instanceof TypedObject) { this.byte(0x10); this.utf(v.className); return this.props(v.props); }
        if (Array.isArray(v)) {
          this.byte(0x0a);
          this.u32(v.length);
          for (const x of v) this.value(x);
          return undefined;
        }
        this.byte(0x03);
        return this.props(v);
      }
      default: return this.byte(0x06);
    }
  }
  bytes() {
    const out = new Uint8Array(this.len);
    let o = 0;
    for (const c of this.chunks) { out.set(c, o); o += c.length; }
    return out;
  }
}

// ---------------------------------------------------------------- Flash Remoting packets
/** Parse a remoting request -> { headers, messages: [{ target, response, args }] } */
export function parseRequest(buf) {
  const r = new Reader(buf);
  r.u16(); // AMF version (0 for the AS2 era)
  const headers = [];
  const hc = r.u16();
  for (let i = 0; i < hc; i++) {
    const name = r.utf();
    const mustUnderstand = r.byte() !== 0;
    r.i32();
    r.refs = [];
    headers.push({ name, mustUnderstand, value: r.value() });
  }
  const messages = [];
  const mc = r.u16();
  for (let i = 0; i < mc; i++) {
    const target = r.utf();
    const response = r.utf();
    r.i32();
    r.refs = [];
    const body = r.value();
    const args = Array.isArray(body) ? body : body === undefined || body === null ? [] : [body];
    messages.push({ target, response, args });
  }
  return { headers, messages };
}

/** Build a remoting response. results: [{ response: "/1", ok: true, value }] */
export function buildResponse(results) {
  const w = new Writer();
  w.u16(0);
  w.u16(0);
  w.u16(results.length);
  for (const r of results) {
    w.utf(r.response + (r.ok ? '/onResult' : '/onStatus'));
    w.utf('null');
    w.i32(-1);
    w.value(r.value);
  }
  return w.bytes();
}

// ---------------------------------------------------------------- RecordSet
/**
 * The wire shape mx.remoting.RecordSet's constructor reads:
 *   serverInfo.version === 1, columnNames[], initialData[][] (rows in column order),
 *   cursor, totalCount (== initialData.length means "fully delivered, no paging").
 */
export function recordSet(columns, rows) {
  return new TypedObject('RecordSet', {
    serverInfo: {
      version: 1,
      columnNames: columns,
      initialData: rows,
      cursor: 1,
      totalCount: rows.length,
      serviceName: 'RecordSet',
      id: 'rs',
    },
  });
}
