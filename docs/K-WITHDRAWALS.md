# K purchases and USDC payout preparation

The owner selected 1,000 K per USD of skin value and 1,000 K per USDC payout.
All existing and future server balances are eligible; browser-local balances are
not imported. USDC is a token denomination, not a guaranteed bank-dollar value.

## Available now

Night Market checkout supports K alongside SOL/USDC. Catalog prices are determined
by the server. A $20 skin costs 20,000 K. The existing EconomyStore purchase method
locks the user, checks ownership/balance, debits K, writes a SHOP_PURCHASE ledger
entry and grants the skin in one transaction. A stable request key prevents repeat
charges. Active crypto orders prevent buying the same skin with K simultaneously.

## Withdrawals are disabled

No production payout provider, signing credentials, treasury funds, or live limits
have been configured. The public receiving address cannot sign outgoing payments.
The withdrawal API reports disabled and rejects requests without deducting K.
The earnings page explains that payouts are not live; it never claims K was sent.

`WithdrawalStore` provides a provider-independent reservation and processing engine.
An additive migration extends the existing ledger types and creates withdrawal
records without changing existing balances. Amounts use fixed-point integers:
0.001 K = one USDC micro-unit. Smaller residual amounts stay in the K balance.
The game pays transfer/network fees; requested payout amounts are not reduced.

To activate, implement and independently verify a provider adapter with:

- `lookup(idempotencyKey)`: durable authoritative status, null only if no submission
  exists. Timeout must throw, never pretend a transfer does not exist.
- `submit({idempotencyKey,destination,amountUnits,mint,network})`: creates at most one
  transfer for the key, including across network timeouts, process restarts and
  concurrent workers. Raw Solana send RPC is not a sufficient adapter.
- Both return immutable `id`, destination, atomic amount, mint, network and status.
  Only `completed` with `finalized:true` and transaction signature completes a job.
  Only a definitive failed transfer releases K. Unknown outcomes retain the hold.

Pass the provider and positive limits (`minimumK`, `perWithdrawalK`,
`perUserDailyK`, `globalDailyK`) to createWithdrawalService in authserver. There
is deliberately no environment switch that enables an unimplemented provider.
Fund native USDC and required SOL fees through the provider's secure dashboard.
Never put seeds or private keys in the browser, chat, repository or plain config.

The worker runs every 15 seconds with leased jobs and provider reconciliation.
User balance locks prevent shop purchases from spending reserved K. Daily budgets
use UTC and a database lock. Unreviewed earnings flags block new withdrawals.
Provider mismatches enter review, retaining the reservation. Operator inspection:
`SELECT * FROM k_withdrawals WHERE state IN ('review','processing','submitted')`.
Do not refund an uncertain payout manually without verifying the provider record.

Before activation, select a provider available for the operator's jurisdiction,
complete its account/compliance requirements and configure any required recipient
verification in the request path. The adapter is not a compliance service.
Circle documents [developer-controlled wallets](https://developers.circle.com/wallets/signing-apis)
as one possible signing service. Applicable requirements depend on the business
model and jurisdiction; see [FinCEN's business-model guidance](https://www.fincen.gov/resources/statutes-regulations/guidance/application-fincens-regulations-certain-business-models).

Tests: `node server/withdrawals_test.mjs`, `node server/paymentservice_test.mjs`,
and `node tools/solana_checkout_browser_check.mjs` with Vite on port 5996.
Payout tests use a fake provider and PostgreSQL-compatible PGlite. They prove the
internal state machine, not the behavior of a future real provider or live transfers.
