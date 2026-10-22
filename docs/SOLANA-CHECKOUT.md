# Skin checkout

The Night Market accepts SOL and native USDC on Solana mainnet through a
[Solana Pay transfer request](https://docs.solanapay.com/spec). K can also pay for skins at 1,000 K per $1;
K cannot be purchased through this checkout. See K-WITHDRAWALS.md for the separate, currently disabled payout system.

## Configuration

Set GitHub Actions secret `SOLANA_MERCHANT_ADDRESS` to the merchant's public
Solana account address. Optionally set `SOLANA_RPC_URL` to a production HTTPS
mainnet RPC endpoint; the public mainnet endpoint is the fallback. Never supply
a private key or seed phrase. Deployment installs a mode-600 `server/.solana.json`.
Environment variables with the same names override this file. Missing recipient
disables checkout. No card or PayPal SDK or API is used.

USDC uses Circle's native mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
([Circle addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)).
USD catalog prices are denominated at the same numeric amount in USDC. SOL uses
the [Coinbase SOL-USD ticker](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-ticker),
rejects prices older than two minutes, and rounds up to whole lamports. Quotes
last ten minutes. Users scan the request in a Solana Pay wallet or open its link.
Sending to a bare address without the order reference cannot be matched.

## Persistence and verification

Startup creates the additive `solana_store_orders` table and indexes after account
initialization. Existing `store_orders`, balances, and `user_skins` are untouched.
Amounts use integer atomic units in NUMERIC storage. Each order stores recipient,
currency, amount, quote, terms version, timestamps, reference and transaction signature.

The server checks the RPC mainnet genesis and requests finalized transactions.
A successful System transfer or native-USDC token transfer must have the exact
amount, merchant destination/owner, signed transfer authority, positive recipient
balance delta and unique order reference on the transfer instruction. Finalization
locks the order and atomically records its globally unique signature with skin
ownership. Client-supplied amounts and transaction claims cannot grant skins.

Pending orders are reconciled every 30 seconds, in batches of 20, for seven days,
including after restart or closing the browser. The authenticated order-status
endpoint can recheck older orders. Transfers made within the quote period can
finalize later. Exact payments sent after expiry become `needs_review`; an operator
must review them using the recorded order and signature. No automatic refunds or
custodial signing are implemented. Keep sufficient RPC history for recovery.

Operators can query `solana_store_orders WHERE status='needs_review'` to handle
late payments, and inspect pending orders by user ID for delivery support. Retain
these records with payment backups. Do not reset pending orders to issue rewards.

Run `node server/paymentservice_test.mjs`, `npm run build`, and the repository
certification suite. Tests use simulated RPC responses and a real embedded
PostgreSQL engine; they do not send funds. Before enabling production purchases,
the merchant should verify their public recipient and test a wallet payment.
