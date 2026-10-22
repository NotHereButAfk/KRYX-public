import { STORE_ITEMS } from './storecatalog.mjs';
export const WEEK_MS = 7 * 86400000;
const MONDAY = Date.UTC(2026, 0, 5);
// A stable catalog order makes rotations independent of restarts and clients.
const catalog = [...STORE_ITEMS].sort((a, b) => a.id.localeCompare(b.id, 'en'));
let seed = 0x4e494748;
for (let i = catalog.length - 1; i > 0; i--) {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  const j = (seed >>> 0) % (i + 1);
  [catalog[i], catalog[j]] = [catalog[j], catalog[i]];
}
export function getNightMarket(now = Date.now()) {
  const week = Math.floor((now - MONDAY) / WEEK_MS);
  const start = ((week * 5) % catalog.length + catalog.length) % catalog.length;
  return { week, serverTime: now, resetsAt: MONDAY + (week + 1) * WEEK_MS,
    items: Array.from({ length: Math.min(5, catalog.length) }, (_, i) => catalog[(start + i) % catalog.length]) };
}
