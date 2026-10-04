// Flash Remoting (AMF0) gateway at /gateway.aspx. Emulates the two .NET services the SWF calls:
//   Mattel.HotWheels.UserServices_HW.GetUserInfo
//   Mattel.GameService.Data.Shared_GameService.{GetPlayerStatus, GetUserCar, UpdateCar1..12,
//                                               RecordCarScore, GetTopCarList, RecordScore, VerifyCode}
// Each result is shaped like the original ADO.NET DataSet:  { Table: RecordSet }
import { parseRequest, buildResponse, recordSet } from './amf0.js';
import { tokenFromRequest, sha256Hex } from './auth.js';
import * as db from './db.js';

const table = (columns, rows) => ({ Table: recordSet(columns, rows) });

async function resolvePlayer(req, env, claimedId) {
  const token = tokenFromRequest(req);
  if (token) {
    const p = await db.findByTokenHash(env.DB, await sha256Hex(token));
    if (p) return p;
  }
  // Fallback if a Flash runtime omits cookies on remoting calls. Disable with STRICT_AUTH=1.
  if (env.STRICT_AUTH === '1') return null;
  const id = Number(claimedId);
  return Number.isInteger(id) && id > 0 ? db.findById(env.DB, id) : null;
}

const USER_COLS = ['userID', 'NickName', 'Avatar', 'Background', 'EmailAddressUser',
  'EmailAddressParent', 'LastBirthdayEmailSentDate', 'CountBirthdayYear', 'lastplaydate'];
const CAR_COLS = ['username', ...Array.from({ length: db.NUM_CARS }, (_, i) => `car${i + 1}`)];

const handlers = {
  async getuserinfo(ctx, [userID]) {
    const p = await resolvePlayer(ctx.req, ctx.env, userID);
    return table(USER_COLS, p ? [[p.id, p.nickname ?? '', 0, 0, '', '', null, 0, null]] : []);
  },
  async getplayerstatus(ctx, [userid]) {
    const p = await resolvePlayer(ctx.req, ctx.env, userid);
    return table(['max_score', 'rank'], [[p?.score ?? 0, p ? await db.rankOf(ctx.env.DB, p.score) : 0]]);
  },
  async getusercar(ctx, [userid]) {
    const p = await resolvePlayer(ctx.req, ctx.env, userid);
    const cars = p ? await db.getCars(ctx.env.DB, p.id) : Array.from({ length: db.NUM_CARS }, (_, i) => db.defaultCarStatus(i + 1));
    return table(CAR_COLS, [[p?.nickname ?? '', ...cars]]);
  },
  // The race server credits scores itself (authoritative); the client-reported call is acknowledged but ignored.
  async recordcarscore(ctx, [userid]) {
    const p = await resolvePlayer(ctx.req, ctx.env, userid);
    return table(['rank', 'score'], [[p ? await db.rankOf(ctx.env.DB, p.score) : 0, p?.score ?? 0]]);
  },
  async gettopcarlist(ctx, [, , numrows]) {
    const rows = await db.topScores(ctx.env.DB, Number(numrows) || 100);
    return table(['username', 'score'], rows.map((r) => [r.username, r.score]));
  },
  async verifycode() { return table(['valid'], [['N']]); },
  async recordscore() { return table(['result'], [[1]]); },
};

async function dispatch(ctx, target, args) {
  const parts = target.split('.');
  const method = (parts.pop() ?? '').toLowerCase();
  const m = /^updatecar(\d{1,2})$/.exec(method);
  if (m) {
    const [userid, , , status] = args;
    const p = await resolvePlayer(ctx.req, ctx.env, userid);
    if (p) await db.saveCar(ctx.env.DB, p.id, Number(m[1]), status);
    return table(['result'], [[1]]);
  }
  const h = handlers[method];
  if (!h) throw new Error(`Unknown method ${target}`);
  return h(ctx, args);
}

export async function handleGateway(req, env) {
  const headers = { 'Content-Type': 'application/x-amf', 'Cache-Control': 'no-store' };
  if (req.method !== 'POST') return new Response('Flash Remoting gateway', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  let parsed;
  try { parsed = parseRequest(new Uint8Array(await req.arrayBuffer())); }
  catch { return new Response('Bad AMF request', { status: 400 }); }
  const ctx = { req, env };
  const results = [];
  for (const msg of parsed.messages) {
    try {
      results.push({ response: msg.response, ok: true, value: await dispatch(ctx, msg.target, msg.args) });
    } catch (e) {
      results.push({
        response: msg.response, ok: false,
        value: { code: 'SERVER.PROCESSING', level: 'error', description: String(e?.message ?? e), details: '' },
      });
    }
  }
  return new Response(buildResponse(results), { status: 200, headers });
}
