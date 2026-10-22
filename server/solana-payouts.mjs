import { readFileSync, statSync } from 'node:fs';
import { address, createKeyPairSignerFromPrivateKeyBytes, createTransactionMessage,
  setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions, signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction, getSignatureFromTransaction, isOffCurveAddress } from '@solana/kit';
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS, getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction } from '@solana-program/token';
import { EconomyStore } from './economy/store.mjs';
import { MAINNET_GENESIS, USDC_MINT } from './solanapayment.mjs';

export const SERVER_WALLET_LIMITS = Object.freeze({minimumK:'5000',perWithdrawalK:null,perUserDailyK:null,globalDailyK:null});
export async function signerFromSeed(seed) {
  if (!/^[a-f0-9]{64}$/i.test(seed || '')) throw Error('Invalid payout wallet configuration');
  return createKeyPairSignerFromPrivateKeyBytes(Buffer.from(seed,'hex'));
}
export function loadPayoutConfiguration(file = new URL('./.payout-wallet.json',import.meta.url)) {
  try {
    const stat=statSync(file);
    if(process.platform!=='win32' && (stat.mode & 0o077)) throw Error('Payout key must be readable only by its owner');
    return JSON.parse(readFileSync(file,'utf8'));
  }catch(e){if(e.code==='ENOENT')return null;throw e;}
}
export function createPayoutRpc(url,fetchImpl=fetch) {
  if (!url?.startsWith('https://')) throw Error('HTTPS payout RPC required');
  return async(method,params=[])=>{
    const response=await fetchImpl(url,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error(`Payout RPC HTTP ${response.status}`);
    const result=await response.json();
    if(result.error)throw Error('Payout RPC rejected request');
    return result.result;
  };
}

export async function buildUsdcPayout({signer,destination,amountUnits,blockhash,lastValidBlockHeight,withdrawalId}) {
  const recipient=address(destination),mint=address(USDC_MINT);
  if(isOffCurveAddress(recipient) || recipient===signer.address)throw Error('Use a different, standard Solana wallet address');
  if(!/^[a-f0-9-]{36}$/.test(withdrawalId || ''))throw Error('Unique withdrawal ID required');
  const amount=BigInt(amountUnits);
  if(amount<=0n || amount>18446744073709551615n)throw Error('Invalid token amount');
  const [source]=await findAssociatedTokenPda({owner:signer.address,mint,tokenProgram:TOKEN_PROGRAM_ADDRESS});
  const [target]=await findAssociatedTokenPda({owner:recipient,mint,tokenProgram:TOKEN_PROGRAM_ADDRESS});
  let message=createTransactionMessage({version:0});
  message=setTransactionMessageFeePayerSigner(signer,message);
  message=setTransactionMessageLifetimeUsingBlockhash({blockhash,lastValidBlockHeight:BigInt(lastValidBlockHeight)},message);
  message=appendTransactionMessageInstructions([
    {programAddress:address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),data:new TextEncoder().encode(`kyx-withdrawal:${withdrawalId}`)},
    getCreateAssociatedTokenIdempotentInstruction({payer:signer,ata:target,owner:recipient,mint}),
    getTransferCheckedInstruction({source,mint,destination:target,authority:signer,amount,decimals:6}),
  ],message);
  const transaction=await signTransactionMessageWithSigners(message);
  return {signature:getSignatureFromTransaction(transaction),wire:getBase64EncodedWireTransaction(transaction),source,target};
}

// Every job is signed exactly once. Its signed bytes commit to PostgreSQL BEFORE
// any network broadcast. A timeout/restart can only resend those same bytes.
export class SolanaPayoutProvider extends EconomyStore {
  constructor(pool,{signer,rpc,accepting=false}) {
    super(pool);this.signer=signer;this.rpc=rpc;this.accepting=accepting;
  }
  async init() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS solana_payout_transfers(
      withdrawal_id UUID PRIMARY KEY REFERENCES k_withdrawals(id),
      signature VARCHAR(88) NOT NULL UNIQUE, wire TEXT NOT NULL,
      destination VARCHAR(44) NOT NULL, amount_units NUMERIC(18,0) NOT NULL,
      treasury VARCHAR(44) NOT NULL, last_valid_height BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    if(this.accepting)await this.verifyNetwork();
  }
  async verifyNetwork() {
    if(await this.rpc('getGenesisHash')!==MAINNET_GENESIS)throw Error('Payout RPC is not Solana mainnet');
  }
  outcome(row,status,extra={}) {
    return {id:row.withdrawal_id,destination:row.destination,amountUnits:String(row.amount_units),
      network:'solana-mainnet',mint:USDC_MINT,status,signature:row.signature,...extra};
  }
  async liquidity() {
    const [ata]=await findAssociatedTokenPda({owner:this.signer.address,mint:address(USDC_MINT),tokenProgram:TOKEN_PROGRAM_ADDRESS});
    const info=await this.rpc('getAccountInfo',[ata,{encoding:'jsonParsed',commitment:'finalized'}]);
    const token=info?.value?.data?.parsed?.info;
    if(!info.value)return {usdc:0n,sol:0n};
    if(info.value.owner!==TOKEN_PROGRAM_ADDRESS || token?.mint!==USDC_MINT || token.owner!==this.signer.address || token.state!=='initialized')throw Error('Invalid treasury USDC account');
    const balance=await this.rpc('getBalance',[this.signer.address,{commitment:'finalized'}]);
    if(!Number.isSafeInteger(balance.value))throw Error('Invalid SOL balance');
    return {usdc:BigInt(token.tokenAmount.amount),sol:BigInt(balance.value)};
  }
  async canReserve(amountUnits) {
    if(!this.accepting)throw Error('Withdrawals are paused');
    await this.verifyNetwork();
    const balances=await this.liquidity();
    const pending=(await this.pool.query("SELECT COALESCE(SUM(usdc_units),0) AS amount, COUNT(*) AS count FROM k_withdrawals WHERE state NOT IN ('failed','completed')")).rows[0];
    const hasPrizes=(await this.pool.query("SELECT to_regclass('public.tournament_prizes') AS table_name")).rows[0]?.table_name;
    const prizes=hasPrizes?(await this.pool.query("SELECT COALESCE(SUM(amount_units),0) AS amount,COUNT(*) AS count FROM tournament_prizes WHERE state IN ('submitted','review')")).rows[0]:{amount:'0',count:'0'};
    if(balances.usdc<BigInt(pending.amount)+BigInt(prizes.amount)+BigInt(amountUnits))throw Error('Payout wallet needs more USDC');
    // Includes a conservative allowance for creating recipients' token accounts.
    if(balances.sol<(BigInt(pending.count)+BigInt(prizes.count)+1n)*3000000n)throw Error('Payout wallet needs more SOL for fees');
  }
  async validateDestination(destination) {
    const target=address(destination);
    if(isOffCurveAddress(target) || target===this.signer.address)throw Error('Invalid payout wallet address');
    const info=await this.rpc('getAccountInfo',[target,{encoding:'base64',commitment:'finalized'}]);
    if(info.value && (info.value.executable || info.value.owner!=='11111111111111111111111111111111'))throw Error('Enter a wallet address, not a token account');
  }
  async submit(request) {
    await this.verifyNetwork();
    if(request.network!=='solana-mainnet' || request.mint!==USDC_MINT)throw Error('Unsupported payout asset');
    const row=await this.transaction(async c=>{
      const job=(await c.query('SELECT * FROM k_withdrawals WHERE id=$1 FOR UPDATE',[request.idempotencyKey])).rows[0];
      if(!job || !['processing','submitted'].includes(job.state) || job.destination!==request.destination
          || String(job.usdc_units)!==String(request.amountUnits))throw Error('Payout does not match reserved withdrawal');
      const prior=(await c.query('SELECT * FROM solana_payout_transfers WHERE withdrawal_id=$1',[job.id])).rows[0];
      if(prior)return prior;
      await this.validateDestination(job.destination);
      const balances=await this.liquidity();
      if(balances.usdc<BigInt(job.usdc_units) || balances.sol<3000000n)throw Error('Treasury funding required');
      const latest=await this.rpc('getLatestBlockhash',[{commitment:'finalized'}]);
      const signed=await buildUsdcPayout({signer:this.signer,destination:job.destination,amountUnits:job.usdc_units,withdrawalId:job.id,...latest.value});
      return (await c.query(`INSERT INTO solana_payout_transfers(withdrawal_id,signature,wire,destination,amount_units,treasury,last_valid_height)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[job.id,signed.signature,signed.wire,job.destination,job.usdc_units,this.signer.address,String(latest.value.lastValidBlockHeight)])).rows[0];
    });
    return this.reconcile(row);
  }
  async lookup(id) {
    const row=(await this.pool.query('SELECT * FROM solana_payout_transfers WHERE withdrawal_id=$1',[id])).rows[0];
    return row?this.reconcile(row):null;
  }
  async reconcile(row) {
    await this.verifyNetwork();
    const result=await this.rpc('getSignatureStatuses',[[row.signature],{searchTransactionHistory:true}]);
    const status=result?.value?.[0];
    if(status?.confirmationStatus==='finalized') {
      if(status.err)return this.outcome(row,'failed',{definitive:true});
      return this.outcome(row,'completed',{finalized:true});
    }
    if(status)return this.outcome(row,'submitted');
    const height=await this.rpc('getBlockHeight',[{commitment:'finalized'}]);
    if(BigInt(height)>BigInt(row.last_valid_height)) {
      // Missing history is not proof of failure. Keep the K hold for review.
      // Never create a replacement transaction with a new signature.
      return this.outcome(row,'review',{reason:'Transaction expired without a verifiable final outcome'});
    }
    const sent=await this.rpc('sendTransaction',[row.wire,{encoding:'base64',skipPreflight:false,preflightCommitment:'finalized',maxRetries:0}]);
    if(sent!==row.signature)throw Error('RPC returned unexpected signature');
    return this.outcome(row,'submitted');
  }
}

export async function configuredServerPayouts(pool,config=loadPayoutConfiguration()) {
  if(!config?.seed)return null;
  const signer=await signerFromSeed(config.seed);
  if(signer.address!==config.address)throw Error('Payout address does not match signing key');
  return new SolanaPayoutProvider(pool,{signer,rpc:createPayoutRpc(config.rpcUrl || 'https://api.mainnet-beta.solana.com'),accepting:config.enabled===true && config.backupConfirmed===true});
}
