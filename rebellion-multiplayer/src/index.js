// Worker entry: static site (assets binding) + API + Flash Remoting gateway + WebSocket -> Durable Object.
import { handleGateway } from './gateway.js';
import { sha256Hex, tokenFromRequest, validToken, nicknameError, cookieHeader } from './auth.js';
import * as db from './db.js';
export { Hub } from './hub.js';

const json = (data, init = {}) =>
  new Response(JSON.stringify(data), { ...init, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...init.headers } });

async function currentPlayer(req, env) {
  const t = tokenFromRequest(req);
  return t ? db.findByTokenHash(env.DB, await sha256Hex(t)) : null;
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname;
    const secure = url.protocol === 'https:';

    // ---- game transport: websocket tunnel for the SWF's XMLSocket (Ruffle socketProxy)
    if (p === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      const player = await currentPlayer(req, env);
      if (!player?.nickname) return new Response('Set a nickname first', { status: 401 });
      const headers = new Headers(req.headers);
      headers.set('x-player-id', String(player.id));
      headers.set('x-player-nick', player.nickname);
      return env.HUB.get(env.HUB.idFromName('main')).fetch(new Request(req, { headers }));
    }

    // ---- Flash Remoting + legacy auth endpoints the SWF already calls
    if (p === '/gateway.aspx') return handleGateway(req, env);
    if (p === '/common/getauthcookie.aspx') {
      const player = await currentPlayer(req, env);
      return new Response(`userID=${player?.id ?? 0}&`, { headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
    }
    if (p === '/common/setauthcookie.aspx') return new Response('', { status: 200 });

    // ---- website API
    if (p === '/api/profile' && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }
      if (!validToken(body?.token)) return json({ ok: false, error: 'Invalid token' }, { status: 400 });
      const bad = nicknameError(body?.nickname, env.BLOCKED_WORDS ?? '');
      if (bad) return json({ ok: false, error: bad }, { status: 400 });
      const r = await db.saveProfile(env.DB, await sha256Hex(body.token), body.nickname);
      if (!r.ok) return json({ ok: false, error: 'That nickname is already taken.' }, { status: 409 });
      return json(
        { ok: true, id: r.player.id, nickname: r.player.nickname, score: r.player.score },
        { headers: { 'Set-Cookie': cookieHeader(body.token, secure) } },
      );
    }
    if (p === '/api/me') {
      const me = await currentPlayer(req, env);
      if (!me) return json({ ok: false }, { status: 401 });
      return json({ ok: true, nickname: me.nickname, score: me.score, wins: me.wins, races: me.races, rank: await db.rankOf(env.DB, me.score) });
    }
    if (p === '/api/leaderboard') {
      const limit = Number(url.searchParams.get('limit')) || 50;
      return json({ ok: true, rows: await db.topScores(env.DB, limit) }, { headers: { 'Cache-Control': 'public, max-age=10' } });
    }
    if (p === '/api/online') {
      const r = await env.HUB.get(env.HUB.idFromName('main')).fetch('https://hub/stats');
      return json(await r.json(), { headers: { 'Cache-Control': 'public, max-age=5' } });
    }
    if (p === '/api/health') return json({ ok: true });

    // ---- everything else: the static site
    return env.ASSETS.fetch(req);
  },
};
