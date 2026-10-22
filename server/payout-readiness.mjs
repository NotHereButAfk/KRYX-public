// Read-only deployment diagnostic. Never prints keys, RPC URLs, or config JSON.
import {configuredServerPayouts,loadPayoutConfiguration} from './solana-payouts.mjs';
import {MAINNET_GENESIS} from './solanapayment.mjs';
let stage='read protected configuration',accepting=true;
try {
  const config=loadPayoutConfiguration();
  if(!config?.seed){console.log('Payout wallet is not configured; disabled');process.exit(0);}
  stage='derive signing address';
  const provider=await configuredServerPayouts(null,config);
  accepting=provider.accepting;
  console.log(JSON.stringify({node:process.version,address:provider.signer.address,accepting:provider.accepting}));
  stage='verify mainnet RPC';
  if(await provider.rpc('getGenesisHash')!==MAINNET_GENESIS)throw Error('Wrong network');
  console.log('Payout configuration and mainnet RPC verified; no transfer sent');
} catch(e) {
  console.error(`Payout readiness failed at: ${stage}`);
  if(/^Payout RPC HTTP [0-9]{3}$/.test(e.message))console.error(e.message);
  process.exitCode=stage==='verify mainnet RPC' && !accepting ? 0 : 1;
}
