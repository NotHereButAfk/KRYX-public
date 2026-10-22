import {writeFileSync} from 'node:fs';
import {signerFromSeed} from '../server/solana-payouts.mjs';
const seed=process.env.SOLANA_PAYOUT_SEED?.trim();
const output=process.env.PAYOUT_CONFIG_PATH;
if(!output)throw Error('Output path required');
let config={enabled:false};
if(seed){
  const signer=await signerFromSeed(seed);
  config={seed,address:signer.address,rpcUrl:process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    enabled:process.env.SOLANA_PAYOUT_ENABLED==='true',backupConfirmed:process.env.SOLANA_PAYOUT_BACKUP_CONFIRMED==='true'};
}
writeFileSync(output,JSON.stringify(config),{mode:0o600});
