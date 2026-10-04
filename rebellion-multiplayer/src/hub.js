// Durable Object: one global instance that terminates every game WebSocket and runs the RaceEngine.
// Ruffle's `socketProxy` tunnels the SWF's XMLSocket over a WebSocket carrying the raw bytes:
// each message is terminated by a NUL byte (XMLSocket framing).
import { RaceEngine } from './engine.js';
import { addScore } from './db.js';
import { makeFramer, frame } from './framing.js';

export class Hub {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sweeper = null;
    this.engine = new RaceEngine({
      onFinish: (r) => {
        this.ctx.waitUntil(
          addScore(this.env.DB, r.playerId, r.carsBeaten, r.position === 1).catch((e) => console.error('addScore failed', e)),
        );
      },
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/stats') return Response.json(this.engine.stats());
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });

    const playerId = Number(request.headers.get('x-player-id'));
    const nick = request.headers.get('x-player-nick');
    if (!playerId || !nick) return new Response('Unauthorized', { status: 401 });

    const [client, server] = Object.values(new WebSocketPair());
    server.accept();

    const conn = {
      id: crypto.randomUUID(), playerId, nick,
      send: (s) => server.send(frame(s)),
      close: (code, reason) => server.close(code, reason),
    };
    const feed = makeFramer((msg) => this.engine.receive(conn, msg));
    server.addEventListener('message', (ev) => feed(ev.data));
    const gone = () => this.engine.disconnect(conn);
    server.addEventListener('close', gone);
    server.addEventListener('error', gone);

    if (!this.sweeper) this.sweeper = setInterval(() => this.engine.sweep(), 30000);
    this.engine.connect(conn);

    // Some WebSocket proxies negotiate a subprotocol ("binary"); echo the first one so browsers accept it.
    const headers = {};
    const proto = request.headers.get('Sec-WebSocket-Protocol');
    if (proto) headers['Sec-WebSocket-Protocol'] = proto.split(',')[0].trim();
    return new Response(null, { status: 101, webSocket: client, headers });
  }
}
