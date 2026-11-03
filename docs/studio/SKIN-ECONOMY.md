# Earned-K skin shop

| Rarity | Price |
| --- | ---: |
| Common | 1,000 K |
| Rare | 1,500 K |
| Epic | 2,000 K |
| Legendary | 2,500 K |
| Mythic | 3,000 K |

src/core/SkinPrices.js is the shared policy. All current character/gun/sword sale entries carry these prices. The free starting appearance remains free; Night Market rotation is unchanged. The current collection has no mythic listing, but future mythics use3000K.

POST /api/e/purchase requires a registered session, same-origin request, bounded request key and a current market item. The server ignores submitted or saved-config prices, locks the account row and writes the balance debit, ledger and user_skins entitlement in one transaction. Successful retries return their previous result without charging twice, including after rotation. Browser attempts retain their request key on an uncertain result and refresh server-owned inventory/balance after purchase. Browser coins cannot fund purchases.

New SOL/USDC skin orders and legacy cash tournament entries are paused. The paid skin modal and wallet purchase buttons are removed; the old checkout function rejects use. Existing pending payment reconciliation, recorded orders, owned items, withdrawals and K tournament entries remain intact. Existing payment URLs are not exposed. No production balances, transactions or credentials were edited.

Validation: actual PostgreSQL/API tests, payment/tournament historical settlement tests, and general economy purchase/refund tests. Browser shop tests use controlled API fixtures and are reported separately from real database tests. See TESTING.md for final UI/build outcomes. Deployment remains subject to the previously documented release gates.
