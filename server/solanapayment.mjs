import bs58 from 'bs58';

export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
// Full getGenesisHash result; the shorter CAIP network identifier is not a hash.
export const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const SYSTEM = '11111111111111111111111111111111';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

export function address(value) {
  if (typeof value !== 'string' || bs58.decode(value).length !== 32 || value === SYSTEM) throw new Error('Invalid recipient');
  return bs58.encode(bs58.decode(value));
}

export function decimalAmount(units, decimals) {
  const text = BigInt(units).toString().padStart(decimals + 1, '0');
  return `${text.slice(0, -decimals)}.${text.slice(-decimals)}`.replace(/0+$/, '').replace(/\.$/, '');
}

export function quoteUnits(cents, asset, solUsd) {
  if (asset === 'USDC') return (BigInt(cents) * 10000n).toString();
  // Integer ceiling prevents underpayment; no floating point currency math.
  if (!/^\d+(\.\d{1,8})?$/.test(solUsd || '')) throw new Error('Invalid SOL price');
  const [whole, fraction = ''] = solUsd.split('.');
  const rate = BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, '0'));
  if (rate <= 0n) throw new Error('Invalid SOL price');
  const numerator = BigInt(cents) * 1000000000000000n;
  return ((numerator + rate - 1n) / rate).toString();
}

export function paymentUrl(order) {
  const params = new URLSearchParams({
    amount: decimalAmount(order.amount_units, order.asset === 'SOL' ? 9 : 6),
    reference: order.reference, label: 'KYX.IO', message: `Skin purchase ${order.id}`,
  });
  if (order.asset === 'USDC') params.set('spl-token', USDC_MINT);
  return `solana:${order.merchant}?${params}`;
}

// Only a successful, standard transfer with this order's reference qualifies.
// Callers must obtain this transaction at finalized commitment on mainnet.
export function validateTransfer(tx, order) {
  if (!tx || tx.meta?.err !== null || !Number.isInteger(tx.blockTime)) return false;
  const message = tx.transaction?.message;
  if (!message || !Array.isArray(message.accountKeys)) return false;
  const keys = [...message.accountKeys, ...(tx.meta.loadedAddresses?.writable || []), ...(tx.meta.loadedAddresses?.readonly || [])];
  const signed = message.header?.numRequiredSignatures || 0;
  const units = BigInt(order.amount_units);
  const recipient = order.merchant;
  for (const ix of message.instructions || []) {
    try {
      if (!ix.accounts?.slice(2).some(i => keys[i] === order.reference)) continue;
      const data = Buffer.from(bs58.decode(ix.data));
      if (order.asset === 'SOL' && keys[ix.programIdIndex] === SYSTEM && data.length === 12
          && data.readUInt32LE(0) === 2 && ix.accounts[0] < signed
          && keys[ix.accounts[1]] === recipient && data.readBigUInt64LE(4) === units) {
        const i = ix.accounts[1];
        // RPC JSON balances must be exact integers before converting to BigInt.
        if (Number.isSafeInteger(tx.meta.preBalances[i]) && Number.isSafeInteger(tx.meta.postBalances[i])
            && BigInt(tx.meta.postBalances[i]) - BigInt(tx.meta.preBalances[i]) >= units) return true;
      }
      if (order.asset === 'USDC' && keys[ix.programIdIndex] === TOKEN) {
        const checked = data[0] === 12 && data.length === 10 && data[9] === 6;
        const plain = data[0] === 3 && data.length === 9;
        if (!checked && !plain) continue;
        const dest = ix.accounts[checked ? 2 : 1];
        if (ix.accounts[checked ? 3 : 2] >= signed
            || (checked && keys[ix.accounts[1]] !== USDC_MINT) || data.readBigUInt64LE(1) !== units) continue;
        const after = tx.meta.postTokenBalances?.find(b => b.accountIndex === dest && b.mint === USDC_MINT && b.owner === order.merchant);
        const before = tx.meta.preTokenBalances?.find(b => b.accountIndex === dest);
        if (after && BigInt(after.uiTokenAmount.amount) - BigInt(before?.uiTokenAmount.amount || '0') >= units) return true;
      }
    } catch { /* Malformed instructions never authorize a purchase. */ }
  }
  return false;
}
