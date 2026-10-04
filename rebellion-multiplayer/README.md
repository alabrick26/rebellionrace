# Rebellion Race – multiplayer revival

Play the 2006 Hot Wheels *Rebellion Race* Flash game in the browser with working **multiplayer races**, a shared
**High Scores** table and **progress saved per browser** – no accounts, no passwords.

```
 Browser                                   Cloudflare (one Worker, free tier)
┌──────────────────────────┐   HTTPS      ┌──────────────────────────────────────────────┐
│ index.html  (nickname)   │ ───────────▶ │ static site  public/                          │
│ Ruffle plays rebellion.swf│             │                                              │
│  ├ Flash Remoting (AMF0) ─┼─ /gateway ─▶ │ gateway.js ─▶ D1  players · cars · scores     │
│  ├ LoadVars  /common/…    ─┼────────────▶ │ index.js   (cookie identity)                 │
│  └ XMLSocket ─ socketProxy ┼─ wss /ws ─▶ │ Hub (Durable Object) = ElectroServer emulation│
└──────────────────────────┘              │   + race rooms (engine.js)                    │
                                           └──────────────────────────────────────────────┘
```

* The **original SWF needs no changes**: it already connects, logs in and joins a lobby by itself, and the server
  simply speaks the three protocols it uses (Flash Remoting, a legacy auth call, and an ElectroServer-style socket).
  There is one optional one-line insurance patch → [`swf-patches/`](swf-patches/README.md).
* Cloudflare cannot accept raw TCP, so Ruffle's **`socketProxy`** tunnels the game's `XMLSocket` through a WebSocket
  into a Durable Object.
* Leaderboard metric = the original one: accumulated **cars beaten** (credited by the server, not the client).
* Protocol details: [`docs/PROTOCOL.md`](docs/PROTOCOL.md).

> **Why `*.workers.dev` and not `*.pages.dev`?** The multiplayer server is a Durable Object, and Cloudflare Pages
> cannot host one ("you cannot create and deploy a Durable Object within a Pages project"). Workers can serve the same
> static site *and* run the Durable Object, from the same GitHub repo with the same free tier, so this project is one
> Worker. The only visible difference is the URL (`https://rebellion-race.<you>.workers.dev`, or your own domain).
> A Pages + separate Worker split is possible but needs two deployments and cross-origin cookies/WebSockets.

---

## Setup plan (≈ 30–45 min)

You need: a GitHub account, a free Cloudflare account, Node.js 22+, and JPEXS Free Flash Decompiler.

### 1. Get the SWF in place
Use the **original** `rebellion.swf` (if your copy has the connection code removed, restore `frame_13` as described in
[`swf-patches/README.md`](swf-patches/README.md)), optionally add the one-block `onData` insurance, and save it as
`public/game/rebellion.swf`.

### 2. Put the repo on GitHub
```bash
git init && git add . && git commit -m "Rebellion Race multiplayer"
git remote add origin git@github.com:<you>/rebellion-race.git && git push -u origin main
```
The SWF is Mattel's property; **use a private repository** (Cloudflare can deploy from private repos).

### 3. Create the database and run locally
```bash
npm install
npx wrangler login
npx wrangler d1 create rebellion          # prints a database_id
#  -> paste it into wrangler.jsonc ("database_id")
npm run db:local                           # applies schema.sql to the local DB
npm run dev                                # http://localhost:8787
```
Test multiplayer with **two browser profiles** (e.g. a normal window and an incognito window), each with its own
nickname: press *Play* in both, choose *Start racing*, and both should be placed on the grid after a few seconds.
Run the unit tests any time with `npm test` (40 tests: AMF0, SQL, protocol, Durable Object adapter, original-client messages, full race flow).

### 4. Deploy
```bash
npm run db:remote                          # create the tables in the real D1 database (once)
npm run deploy                             # publishes the Worker + website + Durable Object
```
Open the printed URL. That is the whole production setup.

### 5. (Optional) deploy automatically from GitHub
Cloudflare dashboard → **Workers & Pages → Create → Import a repository** → pick the repo →
deploy command `npx wrangler deploy`. Bindings (D1, Durable Object) come from `wrangler.jsonc`, and the schema
only needs applying once (`npm run db:remote`). *Alternative:* the manual workflow in
`.github/workflows/deploy.yml` (needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repo secrets).

### 6. Verify (browser DevTools → Network)
| You should see | If not |
|---|---|
| `POST /gateway.aspx` → 200 `application/x-amf` | Your Ruffle build lacks AS2 Flash Remoting → use Ruffle 0.4.0 or newer (the CDN build in `index.html` tracks the latest) or self-host one in `public/ruffle/` |
| `GET /ws` → 101, frames `ConnectionResponse`, `LoginResponse … Accepted`, `CreateRoom … Success` | Check `SOCKET_HOST/PORT` in `public/app.js` equal `<IP>/<Port>` in `public/game/ServerSettings.xml`; if frames flow but the game ignores them, add the optional `onData` block; if `LoginResponse` says Declined, the nickname didn't reach the game (see Remoting row) |
| After two players join: `TRI\|0~…`, `CL\|…`, `PGCD\|10000` | A lone player waits; the game itself offers an AI race after ~15 s |

---

## What lives where
| Path | Purpose |
|---|---|
| `public/index.html, app.js, style.css` | the page: nickname box, Ruffle player (with `socketProxy`), high scores |
| `public/game/` | `rebellion.swf` (you add it), `ServerSettings.xml`, `GameData/` (the reconstructed XML) |
| `src/index.js` | routes: static site, `/api/*`, `/gateway.aspx`, `/common/*`, `/ws` |
| `src/engine.js` | **race server logic** (matchmaking, countdown, relay, finish order, scoring) |
| `src/hub.js, framing.js` | Durable Object adapter + XMLSocket NUL framing |
| `src/gateway.js, amf0.js` | Flash Remoting emulation |
| `src/db.js, schema.sql` | D1 access and schema |
| `test/` | unit/integration tests (`node:test`, real SQLite for the SQL) |

## Behaviour you may want to tune
* `src/engine.js → DEFAULTS`: countdown (10 s), lights (3 s), results (8 s), max 4 players per race, finish grace (20 s).
* `wrangler.jsonc → vars`: `BLOCKED_WORDS` (comma list), `STRICT_AUTH`.
* Profanity: only the blocklist above; add words for a younger audience.

## Honest limitations
* **Not yet exercised end-to-end.** The protocol logic, AMF0 gateway, SQL and framing are unit-tested; the parts that
  need real Ruffle + Cloudflare (socket proxy frames, AS2 remoting in your Ruffle build, your SWF copy) must be
  confirmed by you with the checklist in step 6.
* "Account" = a random token in your browser (localStorage + cookie). Clear site data and you start fresh;
  anyone with the token *is* you. Fine for a hobby game, not for anything sensitive.
* One global Durable Object runs every race – ample for a hobby community, not for thousands of simultaneous players.
* Car progress is client-reported (the game saves its own car state), scores are server-credited.
* Free-tier limits apply (Workers requests, Durable Object requests/duration, D1 reads/writes); WebSocket
  traffic during races is the main consumer. Check Cloudflare's current pricing page if the community grows.
