// D1 access layer. All SQL lives here.
export const NUM_CARS = 12;
export const defaultCarStatus = (slot) =>
  `id=c${slot - 1}&locked=${slot === 1 ? 'false' : 'true'}&speedIcons=0&handlingIcons=0&accelIcons=0`;

/** Canonicalise a client-supplied car string (never trust raw input). */
export function normalizeCarStatus(slot, raw) {
  const p = new URLSearchParams(String(raw ?? '').slice(0, 200));
  const icons = (k) => Math.max(0, Math.min(6, Number.parseInt(p.get(k) ?? '0', 10) || 0));
  const locked = slot === 1 ? false : p.get('locked') !== 'false';
  return `id=c${slot - 1}&locked=${locked}&speedIcons=${icons('speedIcons')}&handlingIcons=${icons('handlingIcons')}&accelIcons=${icons('accelIcons')}`;
}

export const findByTokenHash = (db, hash) =>
  db.prepare('SELECT * FROM players WHERE token_hash = ?').bind(hash).first();

export const findById = (db, id) => db.prepare('SELECT * FROM players WHERE id = ?').bind(id).first();

/** Create or rename the profile owning this token. -> { ok, player } | { ok:false, error } */
export async function saveProfile(db, tokenHash, nickname) {
  const now = Date.now();
  const lc = nickname.toLowerCase();
  const clash = await db.prepare('SELECT id, token_hash FROM players WHERE nickname_lc = ?').bind(lc).first();
  if (clash && clash.token_hash !== tokenHash) return { ok: false, error: 'taken' };
  try {
    const existing = await findByTokenHash(db, tokenHash);
    if (existing) {
      await db.prepare('UPDATE players SET nickname = ?, nickname_lc = ?, last_seen = ? WHERE id = ?')
        .bind(nickname, lc, now, existing.id).run();
    } else {
      await db.prepare('INSERT INTO players (token_hash, nickname, nickname_lc, created_at, last_seen) VALUES (?,?,?,?,?)')
        .bind(tokenHash, nickname, lc, now, now).run();
    }
  } catch (e) {
    if (/UNIQUE/i.test(String(e?.message ?? e))) return { ok: false, error: 'taken' };
    throw e;
  }
  return { ok: true, player: await findByTokenHash(db, tokenHash) };
}

export async function getCars(db, playerId) {
  const { results } = await db.prepare('SELECT car, status FROM player_cars WHERE player_id = ?').bind(playerId).all();
  const bySlot = new Map((results ?? []).map((r) => [r.car, r.status]));
  return Array.from({ length: NUM_CARS }, (_, i) => bySlot.get(i + 1) ?? defaultCarStatus(i + 1));
}

export async function saveCar(db, playerId, slot, raw) {
  if (!Number.isInteger(slot) || slot < 1 || slot > NUM_CARS) return;
  await db.prepare(
    'INSERT INTO player_cars (player_id, car, status) VALUES (?,?,?) ON CONFLICT(player_id, car) DO UPDATE SET status = excluded.status',
  ).bind(playerId, slot, normalizeCarStatus(slot, raw)).run();
}

/** Authoritative scoring, called by the race server when a player finishes. */
export function addScore(db, playerId, carsBeaten, won) {
  return db.prepare('UPDATE players SET score = score + ?, races = races + 1, wins = wins + ?, last_seen = ? WHERE id = ?')
    .bind(Math.max(0, Math.floor(carsBeaten)), won ? 1 : 0, Date.now(), playerId).run();
}

export async function topScores(db, limit = 100) {
  const { results } = await db.prepare(
    'SELECT nickname AS username, score FROM players WHERE score > 0 AND nickname IS NOT NULL ORDER BY score DESC, id ASC LIMIT ?',
  ).bind(Math.max(1, Math.min(100, limit))).all();
  return results ?? [];
}

export async function rankOf(db, score) {
  const r = await db.prepare('SELECT COUNT(*) AS n FROM players WHERE score > ?').bind(score).first();
  return (r?.n ?? 0) + 1;
}
