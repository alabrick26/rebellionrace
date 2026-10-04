// Identity = a random token the browser keeps (localStorage + HttpOnly cookie). No passwords, no accounts.
const enc = new TextEncoder();

export async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function parseCookies(header) {
  const out = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export const COOKIE = 'rr_token';
export const validToken = (t) => typeof t === 'string' && /^[A-Za-z0-9-]{24,64}$/.test(t);
export const tokenFromRequest = (req) => {
  const t = parseCookies(req.headers.get('Cookie'))[COOKIE];
  return validToken(t) ? t : null;
};

export function cookieHeader(token, secure) {
  return `${COOKIE}=${token}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

// 3-16 chars, must start with a letter (so it can never look like a number to ActionScript),
// and may not contain any of the game protocol's separators ( ^ | ~ , & ) or XML specials.
export const NICK_RE = /^[A-Za-z][A-Za-z0-9_-]{2,15}$/;

/** Returns null if OK, else an error string. blocked = comma separated list of forbidden substrings. */
export function nicknameError(nick, blocked = '') {
  if (typeof nick !== 'string' || !NICK_RE.test(nick)) {
    return 'Nickname must be 3-16 characters: letters, digits, _ or -, starting with a letter.';
  }
  const lc = nick.toLowerCase();
  for (const w of blocked.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)) {
    if (lc.includes(w)) return 'That nickname is not allowed.';
  }
  return null;
}
