import assert from 'node:assert/strict';
import { getNightMarket, WEEK_MS } from '../server/nightmarket.mjs';
import { STORE_ITEMS } from '../server/storecatalog.mjs';
const monday = Date.UTC(2026, 8, 14);
const seen = new Set();
for (let i = 0; i < 100; i++) {
  const t = monday + i * WEEK_MS, a = getNightMarket(t), b = getNightMarket(t + WEEK_MS - 1);
  assert.equal(a.items.length, 5); assert.equal(new Set(a.items.map(s=>s.id)).size, 5);
  assert.deepEqual(a.items, b.items); assert.equal(a.resetsAt, t + WEEK_MS);
  assert.notDeepEqual(a.items, getNightMarket(a.resetsAt).items);
  a.items.forEach(s=>seen.add(s.id));
}
assert.equal(seen.size, STORE_ITEMS.length);
console.log('Weekly market passed: five unique offers, UTC boundary, stable reopens, full catalog coverage');
