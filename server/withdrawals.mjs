import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { EconomyStore } from './economy/store.mjs';
import { units, decimal } from './economy/money.mjs';
import { address, USDC_MINT } from './solanapayment.mjs';
import { configuredServerPayouts, SERVER_WALLET_LIMITS } from './solana-payouts.mjs';

export const K_PER_USDC = 1000;
export function withdrawalQuote(kAmount) {
  const k = units(kAmount);
  if (k <= 0n || k % 10n !== 0n) throw new Error('Use a positive K amount with at most three decimal places');
  return { k: decimal(k), usdcUnits: (k / 10n).toString() };
}

// A production provider must implement lookup(idempotencyKey) and submit(request)
// with durable idempotency. Do not attach a raw, non-idempotent send RPC here.
// No provider is configured by default: no outgoing funds or K reservations.
export class WithdrawalStore extends EconomyStore {
  constructor(pool, { provider = null, limits = null } = {}) {
    super(pool); this.provider = provider; this.limits = limits;
    this.enabled = this.validConfiguration();
  }
  validConfiguration() {
    try { return !!this.provider && this.provider.accepting !== false && units(this.limits?.minimumK)>0n
      && ['perWithdrawalK','perUserDailyK','globalDailyK'].every(key => this.limits[key] === null || units(this.limits[key])>0n);
    } catch { return false; }
  }
  async init() {
    await this.pool.query(readFileSync(new URL('./migrations/002_k_withdrawals.sql', import.meta.url), 'utf8'));
  }
  async reserve(userId, destination, amount, key) {
    if (!this.enabled) throw new Error('USDC withdrawals are not enabled yet');
    const target = address(destination), quote = withdrawalQuote(amount), k = units(quote.k);
    if (!/^[a-zA-Z0-9-]{16,64}$/.test(key || '')) throw new Error('Invalid request key');
    if (k < units(this.limits.minimumK) || (this.limits.perWithdrawalK !== null && k > units(this.limits.perWithdrawalK))) throw new Error('Amount is outside the withdrawal limits');
    return this.transaction(async c => {
      // Serialize global daily budget and each user's balance before reserving.
      await c.query('SELECT id FROM k_withdrawal_lock WHERE id=1 FOR UPDATE');
      const user = (await c.query('SELECT e_balance FROM users WHERE id=$1 FOR UPDATE', [userId])).rows[0];
      if (!user) throw new Error('Account unavailable');
      const prior = (await c.query('SELECT * FROM k_withdrawals WHERE user_id=$1 AND request_key=$2', [userId,key])).rows[0];
      if (prior) {
        if (prior.destination !== target || units(prior.k_amount) !== k) throw new Error('Request key reused');
        return prior;
      }
      const flags = await c.query('SELECT 1 FROM e_flags WHERE user_id=$1 AND reviewed_at IS NULL LIMIT 1', [userId]);
      if (flags.rowCount) throw new Error('Earnings require review before withdrawal');
      const daily = (await c.query(`SELECT COALESCE(SUM(k_amount),0) AS total,
        COALESCE(SUM(k_amount) FILTER(WHERE user_id=$1),0) AS player
        FROM k_withdrawals WHERE created_at>=date_trunc('day',NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        AND state<>'failed'`, [userId])).rows[0];
      if ((this.limits.globalDailyK !== null && units(daily.total) + k > units(this.limits.globalDailyK))
          || (this.limits.perUserDailyK !== null && units(daily.player) + k > units(this.limits.perUserDailyK))) throw new Error('Daily withdrawal limit reached');
      const before = units(user.e_balance);
      if (before < k) throw new Error('Not enough K');
      await this.provider.validateDestination?.(target);
      await this.provider.canReserve?.(quote.usdcUnits);
      const id = randomUUID();
      const row = (await c.query(`INSERT INTO k_withdrawals(id,user_id,request_key,destination,k_amount,usdc_units)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [id,userId,key,target,quote.k,quote.usdcUnits])).rows[0];
      await c.query(`INSERT INTO e_transactions(id,user_id,amount,type,description,previous_balance,new_balance,metadata,idempotency_key)
        VALUES($1,$2,$3,'WITHDRAWAL_RESERVE',$4,$5,$6,$7,$8)`,
      [randomUUID(),userId,decimal(-k),'K reserved for USDC withdrawal',decimal(before),decimal(before-k),{ withdrawalId:id },`withdrawal:${id}:reserve`]);
      await c.query('UPDATE users SET e_balance=$1 WHERE id=$2', [decimal(before-k),userId]);
      return row;
    });
  }
  async processOne() {
    if (!this.provider) return false;
    const job = await this.transaction(async c => {
      const row = (await c.query(`SELECT * FROM k_withdrawals WHERE state IN ('queued','processing','submitted')
        AND (lease_until IS NULL OR lease_until<NOW()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
      if (!row) return null;
      await c.query("UPDATE k_withdrawals SET state='processing',lease_until=NOW()+INTERVAL '2 minutes',updated_at=NOW() WHERE id=$1", [row.id]);
      return row;
    });
    if (!job) return false;
    try {
      // Recover a provider submission after a timeout/crash before attempting send.
      let outcome = await this.provider.lookup(job.id);
      if (!outcome && !this.enabled) return false;
      if (!outcome) outcome = await this.provider.submit({ idempotencyKey: job.id, destination: job.destination,
        amountUnits: String(job.usdc_units), mint: USDC_MINT, network: 'solana-mainnet' });
      await this.applyOutcome(job, outcome);
    } catch {
      // Unknown outcome is NEVER refunded or blindly retried with a new key.
      await this.pool.query("UPDATE k_withdrawals SET reason='Awaiting provider reconciliation',updated_at=NOW() WHERE id=$1 AND state='processing'", [job.id]);
    }
    return true;
  }
  async applyOutcome(job, outcome) {
    if (!outcome) throw new Error('Unknown provider result');
    await this.transaction(async c => {
      const row = (await c.query('SELECT * FROM k_withdrawals WHERE id=$1 FOR UPDATE', [job.id])).rows[0];
      if (!row || ['completed','failed','review'].includes(row.state)) return;
      const matches = outcome.destination === row.destination && String(outcome.amountUnits) === String(row.usdc_units)
        && outcome.mint === USDC_MINT && outcome.network === 'solana-mainnet';
      if (!matches) {
        await c.query("UPDATE k_withdrawals SET state='review',reason='Provider transfer details differ from request',updated_at=NOW() WHERE id=$1", [row.id]);
        return;
      }
      if (outcome.status === 'review') {
        await c.query("UPDATE k_withdrawals SET state='review',reason='Payout requires transaction reconciliation',updated_at=NOW() WHERE id=$1", [row.id]);
      } else if (outcome.status === 'failed' && outcome.definitive === true) {
        const user = (await c.query('SELECT e_balance FROM users WHERE id=$1 FOR UPDATE', [row.user_id])).rows[0];
        const before = units(user.e_balance), after = before + units(row.k_amount);
        await c.query(`INSERT INTO e_transactions(id,user_id,amount,type,description,previous_balance,new_balance,metadata,idempotency_key)
          VALUES($1,$2,$3,'WITHDRAWAL_RELEASE',$4,$5,$6,$7,$8)`,
        [randomUUID(),row.user_id,row.k_amount,'K returned: payout failed',decimal(before),decimal(after),{withdrawalId:row.id},`withdrawal:${row.id}:release`]);
        await c.query('UPDATE users SET e_balance=$1 WHERE id=$2', [decimal(after),row.user_id]);
        await c.query("UPDATE k_withdrawals SET state='failed',reason='Payout failed; K returned',updated_at=NOW() WHERE id=$1", [row.id]);
      } else if (outcome.status === 'completed' && outcome.finalized === true && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(outcome.signature || '')) {
        await c.query("UPDATE k_withdrawals SET state='completed',provider_id=$2,signature=$3,reason=NULL,updated_at=NOW() WHERE id=$1", [row.id,outcome.id,outcome.signature]);
      } else {
        await c.query("UPDATE k_withdrawals SET state='submitted',provider_id=$2,reason=NULL,updated_at=NOW() WHERE id=$1", [row.id,outcome.id || null]);
      }
    });
  }
}

export function createWithdrawalService(accounts, options = {}) {
  if (!accounts?.pool) return null;
  const store = new WithdrawalStore(accounts.pool, options);
  const ready = Promise.resolve(accounts.ready).then(async () => {
    await store.init();
    if (!Object.hasOwn(options,'provider')) {
      store.provider = await configuredServerPayouts(accounts.pool);
      store.limits = SERVER_WALLET_LIMITS;
      await store.provider?.init();
      store.enabled = store.validConfiguration();
    }
  });
  ready.catch(() => console.error('[withdrawals] Initialization unavailable'));
  let running = null;
  const timer = setInterval(() => {
    if (!running) running = ready.then(() => store.processOne()).catch(() => {}).finally(() => { running = null; });
  }, 15000);
  timer?.unref();
  const send = (res, status, value) => { res.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));return true; };
  const handler = async (req,res,path) => {
    if (path !== '/api/withdrawals') return false;
    try {
      await ready;
      const user = await accounts.session(req);
      if (!user) return send(res,401,{error:'Log in to view withdrawals'});
      if (req.method === 'GET') {
        const rows = await accounts.pool.query('SELECT id,destination,k_amount,usdc_units,state,signature,reason,created_at FROM k_withdrawals WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[user.id]);
        return send(res,200,{enabled:store.enabled,kPerUSDC:K_PER_USDC,limits:store.limits,withdrawals:rows.rows});
      }
      if (req.method !== 'POST') return send(res,405,{error:'Method not allowed'});
      if (!req.headers.origin || req.headers['sec-fetch-site']==='cross-site' || new URL(req.headers.origin).host!==req.headers.host)
        return send(res,403,{error:'Same-origin request required'});
      if (!store.enabled) return send(res,503,{error:'USDC payouts are awaiting payout wallet setup and funding. Your K has not been deducted.'});
      let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)throw Error('Request too large');}
      const data=JSON.parse(raw);
      if(data.termsAccepted!==true || data.termsVersion!=='2026-09-17-K') return send(res,400,{error:'Accept the withdrawal terms'});
      const row=await store.reserve(user.id,data.destination,data.amountK,data.key);
      return send(res,201,{id:row.id,state:row.state,kAmount:row.k_amount,usdcUnits:row.usdc_units});
    } catch { return send(res,400,{error:'Withdrawal could not be accepted. Check your balance, limits, and account eligibility.'}); }
  };
  handler.close=async()=>{clearInterval(timer);await running;};
  handler.ready=ready;
  return handler;
}
