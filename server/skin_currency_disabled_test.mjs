import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createEconomyService} from './economy/service.mjs';

// Exercise the legacy HTTP route with a funded account and purchasable catalog.
let initialize;
const accounts={ready:new Promise(resolve=>{initialize=resolve}),pool:{},session:async()=>({id:1,ownedSkins:[]})};
const service=createEconomyService(accounts);
service.runtime.init=async()=>{};
service.store.config=async()=>({revision:1,config:{enabled:true,items:{catalog:[{id:'test-skin',kind:'character',priceE:'20000'}]}}});
service.store.profile=async()=>({balance:'100000'});
let purchases=0;
service.store.purchase=async()=>{purchases++;return {ok:true}};
initialize();await service.ready;
async function call(path,body){
  const req=Readable.from(body===undefined?[]:[JSON.stringify(body)]);
  req.method=body===undefined?'GET':'POST';req.headers={host:'game.test',origin:'https://game.test'};
  let status,data;
  await service.handler(req,{writeHead(s){status=s},end(s){data=JSON.parse(s)}},path);
  return {status,data};
}
const result=await call('/api/e/purchase',{itemId:'test-skin',key:'valid-key-12345'});
assert.equal(result.status,410);assert.equal(purchases,0);
const profile=await call('/api/e/me');
assert.equal(profile.data.balance,'100000');assert.equal(profile.data.kPurchases,false);
assert.equal(profile.data.catalog[0].priceE,null);
const storage=new Map([['sio_shop',JSON.stringify({coins:100000,owned:[]})]]);
globalThis.localStorage={getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)};
const {Shop}=await import('../src/core/Shop.js');
assert.equal(Shop.buy('test-skin',1).ok,false);
assert.equal(Shop.getCoins(),100000);
assert.deepEqual(JSON.parse(storage.get('sio_shop')).owned,[]);
console.log('Skin currency purchases disabled: legacy API, public catalog and local shop preserve balances and ownership.');
