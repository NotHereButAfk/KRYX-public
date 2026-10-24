import { isIP } from 'node:net';

function address(value) {
  const ip = String(value || '').trim().toLowerCase().replace(/^::ffff:/, '');
  return isIP(ip) ? ip : '';
}

// Only the immediate trusted proxy may supply a forwarding chain. Walk from
// that proxy toward the client; never trust the attacker-controlled first item.
// Set ACCOUNT_TRUSTED_PROXIES to comma-separated proxy IPs, "loopback" (the
// default for the local nginx proxy), or an empty string to trust none.
export function accountClientAddress(req, trustedProxies = process.env.ACCOUNT_TRUSTED_PROXIES ?? 'loopback') {
  const peer = address(req.socket?.remoteAddress) || 'unknown';
  const configured = new Set(String(trustedProxies).split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
  const trusted = ip => configured.has(ip) || (configured.has('loopback') && (ip === '::1' || ip.startsWith('127.')));
  if (!trusted(peer)) return peer;
  const raw = req.headers['x-forwarded-for'];
  if (typeof raw !== 'string' || raw.length > 1024) return peer;
  const chain = raw.split(',').map(address);
  if (chain.length > 16 || chain.some(ip => !ip)) return peer;
  for (let i = chain.length - 1; i >= 0; i--) if (!trusted(chain[i])) return chain[i];
  return chain[0] || peer;
}

export class AuthAttemptLimiter {
  constructor({ limit = 12, windowMs = 60_000, maxEntries = 10_000, now = Date.now } = {}) {
    this.limit = limit; this.windowMs = windowMs; this.maxEntries = maxEntries; this.now = now;
    this.entries = new Map(); this.nextSweep = 0;
  }
  allow(key) {
    const now = this.now();
    if (now >= this.nextSweep) {
      for (const [id, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(id);
      this.nextSweep = now + Math.min(60_000, this.windowMs);
    }
    let entry = this.entries.get(key);
    if (entry && entry.expiresAt <= now) { this.entries.delete(key); entry = null; }
    if (!entry) {
      // Fail closed instead of evicting an active guard to make room for an attacker.
      if (this.entries.size >= this.maxEntries) return false;
      entry = { count: 0, expiresAt: now + this.windowMs }; this.entries.set(key, entry);
    }
    if (entry.count >= this.limit) return false;
    entry.count++; return true;
  }
}
