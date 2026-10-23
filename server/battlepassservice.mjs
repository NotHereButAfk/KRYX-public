import { BP_MILESTONES, BP_SEASON, BP_XP_PER_TIER, battlePassXP } from '../src/sim/BattlePassCatalog.js';

const send = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
};

export function createBattlePassService(accounts, { flushProgress = async () => {} } = {}) {
  if (!accounts?.pool) return null;
  const pool = accounts.pool;
  const ready = Promise.resolve(accounts.ready).then(() => pool.query(`
    CREATE TABLE IF NOT EXISTS battlepass_claims (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      claim_key TEXT NOT NULL,
      tier INTEGER NOT NULL,
      skin_id TEXT NOT NULL,
      claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(user_id, claim_key)
    );
  `));
  ready.catch(error => console.error('[battle pass init]', error.message));

  async function profile(userId) {
    await ready;
    await flushProgress();
    const [stats, claims, owned] = await Promise.all([
      pool.query('SELECT id,username,kills,games FROM users WHERE id=$1', [userId]),
      pool.query('SELECT claim_key FROM battlepass_claims WHERE user_id=$1', [userId]),
      pool.query('SELECT skin_id,skin_kind FROM user_skins WHERE user_id=$1', [userId]),
    ]);
    return {
      owner: { id: String(userId), username: stats.rows[0]?.username },
      season: BP_SEASON, xp: battlePassXP(stats.rows[0]), claimed: claims.rows.map(row => row.claim_key),
      ownedSkins: owned.rows.map(row => ({ id: row.skin_id, kind: row.skin_kind })),
    };
  }

  async function handler(req, res, path) {
    if (!path.startsWith('/api/battlepass')) return false;
    try {
      await ready;
      const user = await accounts.session(req);
      if (!user) { send(res, 401, { error: 'Sign in to collect battle pass rewards.' }); return true; }
      if (req.method === 'GET' && path === '/api/battlepass') {
        send(res, 200, await profile(user.id)); return true;
      }
      if (req.method !== 'POST' || path !== '/api/battlepass/claim') {
        send(res, 404, { error: 'Not found' }); return true;
      }
      let originMatches = false;
      try { originMatches = !!req.headers.origin && new URL(req.headers.origin).host === req.headers.host; } catch {}
      if (req.headers['sec-fetch-site'] === 'cross-site' || !originMatches) {
        send(res, 403, { error: 'Same-origin request required' }); return true;
      }
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (Buffer.byteLength(raw) > 2048) { send(res, 413, { error: 'Request too large' }); return true; }
      }
      let data;
      try { data = JSON.parse(raw || '{}'); } catch { send(res, 400, { error: 'Invalid request' }); return true; }
      if (!data || typeof data !== 'object' || Array.isArray(data)) { send(res, 400, { error: 'Invalid request' }); return true; }
      // Cookies are shared between tabs; sessionStorage is not. A stale tab must
      // never claim rewards for whichever account was signed in elsewhere.
      if (typeof data.expectedUsername !== 'string' || data.expectedUsername.toLowerCase() !== user.username?.toLowerCase()) {
        send(res, 409, { error: 'Your account changed in another tab. Sign in again before claiming rewards.' }); return true;
      }
      const selected = data.all === true ? BP_MILESTONES : BP_MILESTONES.filter(reward => reward.tier === data.tier);
      if (!selected.length) { send(res, 400, { error: 'Unknown reward' }); return true; }
      await flushProgress();
      // Eligibility, claim and entitlement are one PostgreSQL statement. Client
      // XP/skin IDs are never accepted; retries cannot grant or charge twice.
      const result = await pool.query(`WITH eligible AS (
        SELECT reward.tier,reward.claim_key,reward.skin_id FROM users u
        CROSS JOIN UNNEST($2::integer[],$3::text[],$4::text[]) AS reward(tier,claim_key,skin_id)
        WHERE u.id=$1 AND GREATEST(0,u.kills)::bigint*25 + GREATEST(0,u.games)::bigint*100 >= (reward.tier-1)*$5::bigint
      ), claims AS (
        INSERT INTO battlepass_claims(user_id,claim_key,tier,skin_id)
        SELECT $1,claim_key,tier,skin_id FROM eligible ON CONFLICT DO NOTHING RETURNING tier,skin_id,user_id
      ), grants AS (
        INSERT INTO user_skins(user_id,skin_id,skin_kind)
        SELECT user_id,skin_id,'character' FROM claims ON CONFLICT DO NOTHING RETURNING skin_id
      ) SELECT tier,skin_id FROM claims`,
      [user.id, selected.map(reward => reward.tier), selected.map(reward => reward.key), selected.map(reward => reward.id), BP_XP_PER_TIER]);
      const state = await profile(user.id);
      if (!result.rows.length && selected.every(reward => state.xp < reward.xp)) {
        send(res, 409, { error: 'Reach this tier by playing signed-in matches first.' }); return true;
      }
      send(res, 200, { ...state, granted: result.rows.map(row => ({ tier: row.tier, id: row.skin_id })) });
      return true;
    } catch (error) {
      console.error('[battle pass]', error.message);
      send(res, 503, { error: 'Battle pass is temporarily unavailable. Try again.' });
      return true;
    }
  }
  return { ready, handler, profile };
}
