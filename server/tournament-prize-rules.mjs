export function prizeRules(durationMinutes, amounts, capacity=128) {
  const duration=Number(durationMinutes);
  if(!Number.isInteger(duration)||duration<5||duration>1440)throw Error('Duration must be 5–1440 minutes.');
  const prizes=Array.isArray(amounts)?amounts:String(amounts||'').split(',').map(x=>x.trim());
  if(!prizes.length||prizes.length>Math.min(10,capacity))throw Error('Set prizes for 1–10 places, no more than the player limit.');
  const units=prizes.map(value=>{
    if(!/^\d{1,6}(\.\d{1,6})?$/.test(String(value)))throw Error('Enter USDC prizes separated by commas, highest place first.');
    const [whole,fraction='']=String(value).split('.');const n=BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'));
    if(n<=0n)throw Error('Each prize must be greater than zero.');return n.toString();
  });
  for(let i=1;i<units.length;i++)if(BigInt(units[i])>BigInt(units[i-1]))throw Error('Prizes must decrease or stay equal by place.');
  return {durationMinutes:duration,prizes:units};
}
export const usdcAmount=units=>{const n=BigInt(units);return `${n/1000000n}.${String(n%1000000n).padStart(6,'0')}`;};
