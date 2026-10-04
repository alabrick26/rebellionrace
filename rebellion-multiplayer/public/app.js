// Website glue: nickname -> profile cookie -> Ruffle player (with the websocket "socket proxy") + high scores.
// SOCKET_HOST/PORT must equal <IP>/<Port> in public/game/ServerSettings.xml. They are never really dialled:
// Ruffle maps that host:port to our /ws endpoint.
const SOCKET_HOST = 'game.local';
const SOCKET_PORT = 9875;
const SWF_URL = '/game/rebellion.swf';

const $ = (id) => document.getElementById(id);
const nick = $('nick'), play = $('play'), msg = $('msg');
let started = false;

const say = (text, error = false) => { msg.textContent = text; msg.className = error ? 'error' : ''; };

function token() {
  let t = localStorage.getItem('rr_token');
  if (!t) { t = crypto.randomUUID(); localStorage.setItem('rr_token', t); }
  return t;
}

async function saveProfile(nickname) {
  const res = await fetch('/api/profile', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: token(), nickname }),
  });
  const data = await res.json().catch(() => ({ ok: false, error: 'Server error' }));
  if (!res.ok || !data.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function startGame() {
  const api = window.RufflePlayer?.newest();
  if (!api) { say('Could not load the Flash emulator (Ruffle). Check your connection.', true); return false; }
  const stage = $('stage');
  stage.innerHTML = '';
  const player = api.createPlayer();
  stage.appendChild(player);
  const wsProto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  player.load({
    url: SWF_URL,
    autoplay: 'on',
    unmuteOverlay: 'hidden',
    allowNetworking: 'all',
    socketProxy: [{ host: SOCKET_HOST, port: SOCKET_PORT, proxyUrl: `${wsProto}${location.host}/ws` }],
  });
  return true;
}

async function onPlay() {
  if (started) { location.reload(); return; }          // "Change nickname"
  const name = nick.value.trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]{2,15}$/.test(name)) {
    say('3-16 characters: letters, digits, _ or -, starting with a letter.', true);
    return;
  }
  play.disabled = true; say('Saving...');
  try {
    await saveProfile(name);
  } catch (e) {
    play.disabled = false; say(e.message, true); return;
  }
  localStorage.setItem('rr_nick', name);
  if (startGame()) {
    started = true; nick.disabled = true;
    play.textContent = 'Change nickname'; say(`Playing as ${name}`);
  }
  play.disabled = false;
  refreshBoard();
}

async function refreshBoard() {
  try {
    const { rows } = await (await fetch('/api/leaderboard?limit=20')).json();
    const me = (localStorage.getItem('rr_nick') || '').toLowerCase();
    const ol = $('scores'); ol.innerHTML = '';
    if (!rows.length) { ol.innerHTML = '<li class="empty">No scores yet</li>'; }
    for (const r of rows) {
      const li = document.createElement('li');
      if (r.username.toLowerCase() === me) li.className = 'me';
      const n = document.createElement('span'); n.className = 'n'; n.textContent = r.username;
      const s = document.createElement('span'); s.className = 's'; s.textContent = r.score;
      li.append(n, s); ol.appendChild(li);
    }
    const on = await (await fetch('/api/online')).json();
    $('online').textContent = on.online ? `${on.online} player${on.online === 1 ? '' : 's'} online` : '';
  } catch { /* leaderboard is optional */ }
}

nick.value = localStorage.getItem('rr_nick') || '';
play.addEventListener('click', onPlay);
nick.addEventListener('keydown', (e) => { if (e.key === 'Enter') onPlay(); });
refreshBoard();
setInterval(refreshBoard, 30000);
