import {readFileSync} from 'node:fs';
// Deployment writes this private file outside dist. Never expose it through HTTP.
export function emailConfig() {
  let file={};
  try { file=JSON.parse(readFileSync(new URL('./.email.json',import.meta.url),'utf8')); }
  catch(error){if(error.code!=='ENOENT')console.error('[email] Invalid private email configuration');}
  return {...file,...Object.fromEntries(Object.entries(process.env).filter(([key,value])=>key.startsWith('ACCOUNT_')&&value))};
}
