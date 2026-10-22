import { createPublicKey, verify } from 'node:crypto';

// Never accept a client-supplied user ID, key URL, or game ID as authority.
export function createCrazyGamesVerifier({ gameId = process.env.CRAZYGAMES_GAME_ID || '139186', fetchKey = async () => {
  const response = await fetch('https://sdk.crazygames.com/publicKey.json', { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('key_unavailable');
  return (await response.json()).publicKey;
}, now = () => Date.now() } = {}) {
  let key, fetchedAt = 0;
  async function refresh() {
    try { key = createPublicKey(await fetchKey()); }
    catch { throw new Error('key_unavailable'); }
    fetchedAt = now();
  }
  return async token => {
    if (!gameId) throw new Error('crazygames_not_configured');
    if (typeof token !== 'string' || token.length > 12000) throw new Error('invalid_token');
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) throw new Error('invalid_token');
    const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
    if (header.alg !== 'RS256') throw new Error('invalid_token');
    if (!key || now() - fetchedAt > 300000) await refresh();
    const signed = Buffer.from(parts.slice(0, 2).join('.'));
    const signature = Buffer.from(parts[2], 'base64url');
    if (!verify('RSA-SHA256', signed, key, signature)) {
      // Bound refreshes so invalid tokens cannot flood the key provider.
      if (now() - fetchedAt < 30000) throw new Error('invalid_token');
      await refresh();
      if (!verify('RSA-SHA256', signed, key, signature)) throw new Error('invalid_token');
    }
    const claim = JSON.parse(Buffer.from(parts[1], 'base64url'));
    const seconds = now() / 1000;
    if (String(claim.gameId) !== String(gameId)) {
      // A signed game identifier is public configuration, never a credential.
      // Expose only this bounded value so preview configuration can be diagnosed.
      const actual = String(claim.gameId);
      const error = new Error('game_mismatch');
      if (/^[A-Za-z0-9_-]{1,128}$/.test(actual)) error.gameId = actual;
      throw error;
    }
    if (typeof claim.userId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(claim.userId)
      || !Number.isFinite(claim.exp) || claim.exp <= seconds
      || !Number.isFinite(claim.iat) || claim.iat > seconds + 30
      || (claim.nbf !== undefined && (!Number.isFinite(claim.nbf) || claim.nbf > seconds))
      || typeof claim.username !== 'string' || !/^[A-Za-z0-9._]{1,24}$/.test(claim.username)) throw new Error('invalid_token');
    return claim;
  };
}
