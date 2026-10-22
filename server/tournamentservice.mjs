import {tournamentPrizes} from './tournament-prizes.mjs';
import {prizeRules,usdcAmount} from './tournament-prize-rules.mjs';
import {tournamentType} from './tournament-types.mjs';
import {scheduleModal,detailsModal,prizesModal,modalValues,scheduledInstant,draftMessage} from './tournament-gui.mjs';
import {units as kUnits, decimal as kDecimal} from './economy/money.mjs';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import bs58 from 'bs58';
import {address,decimalAmount,MAINNET_GENESIS,paymentUrl,validateTransfer} from './solanapayment.mjs';
import {discordClient,hashLinkCode,verifyDiscordRequest} from './discord-tournaments.mjs';

const fail=(message,status=400)=>{const e=Error(message);e.status=status;throw e;};
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));return true;};
async function read(req){const chunks=[];let size=0;for await(const part of req){const chunk=Buffer.isBuffer(part)?part:Buffer.from(part);size+=chunk.length;if(size>16384)fail('Request too large',413);chunks.push(chunk);}return Buffer.concat(chunks).toString('utf8');}
const originOK=req=>{try{return req.headers['sec-fetch-site']!=='cross-site'&&new URL(req.headers.origin).host===req.headers.host;}catch{return false;}};
export function feeUnits(value,asset){
  const decimals=asset==='SOL'?9:asset==='USDC'?6:asset==='K'?4:0;
  if(!decimals||!new RegExp(`^\\d{1,6}(\\.\\d{1,${decimals}})?$`).test(String(value)))fail('Enter a valid positive entry fee');
  const [whole,fraction='']=String(value).split('.'),units=BigInt(whole)*10n**BigInt(decimals)+BigInt(fraction.padEnd(decimals,'0'));
  if(units<=0n)fail('Entry fee must be greater than zero');return String(units);
}
export function createTournamentService(accounts,{env=process.env,fetchImpl=fetch,now=Date.now,reconcileIntervalMs=30000}={}){
  if(!accounts?.pool||!accounts?.session)return null;
  let secrets={},discordSecrets={};
  for(const [file,target] of [['.solana.json',secrets],['.discord.json',discordSecrets]]){
    try{Object.assign(target,JSON.parse(readFileSync(new URL(file,import.meta.url),'utf8')));}catch(e){if(e.code!=='ENOENT')console.error('[tournaments] Invalid private configuration');}
  }
  const config={DISCORD_APPLICATION_ID:'000000000000000000',DISCORD_GUILD_ID:'000000000000000001',DISCORD_TOURNAMENT_CHANNEL_ID:'000000000000000002',DISCORD_MOD_CHANNEL_ID:'000000000000000003',...secrets,...discordSecrets,...env},pool=accounts.pool;
  const site=config.PUBLIC_SITE_URL||'https://kryx.live';
  const admins=new Set(String(config.TOURNAMENT_ADMIN_USER_IDS||config.E_ADMIN_USER_IDS||'').split(',').map(v=>v.trim()).filter(Boolean));
  let merchant='';try{merchant=address(config.SOLANA_MERCHANT_ADDRESS);}catch{}
  const rpcUrl=config.SOLANA_RPC_URL||'https://api.mainnet-beta.solana.com';
  const cryptoConfigured=!!merchant&&rpcUrl.startsWith('https://');
  const configured=true;
  const discord=discordClient(config,fetchImpl);
  const linking=discord.configured&&/^[a-f0-9]{64}$/i.test(config.DISCORD_PUBLIC_KEY||'');
  const ready=Promise.resolve(accounts.ready).then(()=>pool.query(readFileSync(new URL('./migrations/005_tournaments.sql',import.meta.url),'utf8'))).then(()=>pool.query(readFileSync(new URL('./migrations/006_tournament_tokens.sql',import.meta.url),'utf8'))).then(()=>pool.query(readFileSync(new URL('./migrations/007_tournament_drafts.sql',import.meta.url),'utf8'))).then(()=>pool.query(readFileSync(new URL('./migrations/008_tournament_discord_creator.sql',import.meta.url),'utf8'))).then(()=>pool.query(readFileSync(new URL('./migrations/009_tournament_type.sql',import.meta.url),'utf8'))).then(()=>pool.query(readFileSync(new URL('./migrations/010_tournament_prizes.sql',import.meta.url),'utf8')));
  const rewards=tournamentPrizes({pool,ready,discord,now});
  ready.catch(()=>console.error('[tournaments] Database unavailable'));
  async function transaction(fn){const c=await pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
  async function rpc(method,params=[]){const response=await fetchImpl(rpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('Payment network unavailable');const data=await response.json();if(data.error)throw Error('Payment network unavailable');return data.result;}
  async function chain(){if(await rpc('getGenesisHash')!==MAINNET_GENESIS)fail('Payment network must be Solana mainnet',503);}
  const publicEvent=e=>({id:e.id,title:e.title,description:e.description,type:e.tournament_type||null,objective:tournamentType(e.tournament_type)?.objective||null,startsAt:e.starts_at,endsAt:e.ends_at,prizes:(e.prizes||[]).map(usdcAmount),closesAt:e.closes_at,capacity:e.capacity,asset:e.asset,fee:decimalAmount(e.fee_units,e.asset==='SOL'?9:e.asset==='K'?4:6),status:e.status,results:e.results||[],registered:Number(e.registered||0),announcementId:e.announcement_id||null});
  const publicOrder=o=>({id:o.id,tournamentId:o.tournament_id,asset:o.asset,amount:decimalAmount(o.amount_units,o.asset==='SOL'?9:o.asset==='K'?4:6),status:o.status,expiresAt:o.expires_at,signature:o.signature||null,
    paymentUrl:o.status==='pending'&&new Date(o.expires_at).getTime()>now()?paymentUrl(o).replace(/message=[^&]*/,`message=${encodeURIComponent('Tournament entry '+o.id)}`):null});
  async function profile(id){return (await pool.query('SELECT solana_address,discord_id,discord_name FROM tournament_profiles WHERE user_id=$1',[id])).rows[0]||{};}
  async function createEvent(data,creator,interactionId=null,db=pool,discordCreator=null){
    const template=tournamentType(data.type);
    if(!template)fail('Choose Most Kills or Longest Survived in Survival');
    data={...data,title:template.title};
    const start=Date.parse(data.startsAt),close=Date.parse(data.closesAt),capacity=Number(data.capacity);
    if(!String(data.title||'').trim()||String(data.title).length>80||String(data.description||'').length>1200||!Number.isFinite(start)||!Number.isFinite(close)||close<=now()||start<=close||!Number.isInteger(capacity)||capacity<2||capacity>128)fail('Check tournament title, dates and player limit');
    if(data.asset && data.asset!=='K')fail('Tournament entry fees use in-game K');
    const units=feeUnits(data.fee,'K');
    const rules=prizeRules(data.durationMinutes,data.prizeAmounts,capacity);
    const endsAt=new Date(start+rules.durationMinutes*60000);
    return (await db.query('INSERT INTO tournaments(id,title,description,starts_at,closes_at,capacity,asset,fee_units,created_by,discord_interaction_id,created_by_discord_id,tournament_type,ends_at,prizes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *',[randomUUID(),data.title.trim(),data.description||'',new Date(start),new Date(close),capacity,'K',units,creator,interactionId,discordCreator,data.type,endsAt,JSON.stringify(rules.prizes)])).rows[0];
  }
  async function enterWithTokens(eventId,user,wallet){
    return transaction(async c=>{
      const event=(await c.query('SELECT * FROM tournaments WHERE id=$1 FOR UPDATE',[eventId])).rows[0];
      if(!event || event.asset!=='K')fail('Tournament not found',404);
      const prior=(await c.query('SELECT o.* FROM tournament_entries e JOIN tournament_orders o ON o.id=e.order_id WHERE e.tournament_id=$1 AND e.user_id=$2',[eventId,user.id])).rows[0];
      if(prior)return prior;
      if(event.status!=='open'||new Date(event.closes_at).getTime()<=now())fail('Registration is closed',409);
      const count=Number((await c.query('SELECT COUNT(*) AS n FROM tournament_entries WHERE tournament_id=$1',[eventId])).rows[0].n);
      if(count>=event.capacity)fail('This tournament is full',409);
      const account=(await c.query('SELECT e_balance FROM users WHERE id=$1 FOR UPDATE',[user.id])).rows[0];
      const before=kUnits(account.e_balance),cost=BigInt(event.fee_units);
      if(before<cost)fail('Not enough K for this entry fee',409);
      const id=randomUUID(),at=new Date(now());
      const order=(await c.query("INSERT INTO tournament_orders(id,tournament_id,user_id,wallet,asset,amount_units,reference,merchant,created_at,expires_at,status,completed_at) VALUES($1,$2,$3,$4,'K',$5,$6,'internal',$7,$7,'registered',$7) RETURNING *",[id,eventId,user.id,wallet,String(cost),'K-'+id,at])).rows[0];
      await c.query("INSERT INTO e_transactions(id,user_id,amount,type,description,previous_balance,new_balance,metadata,idempotency_key) VALUES($1,$2,$3,'TOURNAMENT_ENTRY',$4,$5,$6,$7,$8)",[randomUUID(),user.id,kDecimal(-cost),'Tournament entry: '+event.title,kDecimal(before),kDecimal(before-cost),JSON.stringify({tournamentId:eventId,orderId:id}),'tournament:'+eventId+':'+user.id]);
      await c.query('UPDATE users SET e_balance=$1 WHERE id=$2',[kDecimal(before-cost),user.id]);
      await c.query('INSERT INTO tournament_entries(tournament_id,user_id,order_id,wallet) VALUES($1,$2,$3,$4)',[eventId,user.id,id,wallet]);
      return order;
    });
  }
  const checking=new Map();
  async function verifyOrder(order){
    if(order.status!=='pending')return order;
    if(checking.has(order.id))return checking.get(order.id);
    const task=(async()=>{
      await chain();
      const signatures=await rpc('getSignaturesForAddress',[order.reference,{limit:30,commitment:'finalized'}]);
      for(const item of signatures||[]){
        if(item.err||item.confirmationStatus!=='finalized')continue;
        const tx=await rpc('getTransaction',[item.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:0}]);
        // A single transfer must not carry several order references and pay
        // both a skin order and an entry with the same funds.
        const filtered=tx?.transaction?.message?{...tx,transaction:{...tx.transaction,message:{...tx.transaction.message,
          instructions:(tx.transaction.message.instructions||[]).filter(ix=>{
            if(order.asset==='SOL')return ix.accounts?.length===3;
            try{return ix.accounts?.length===(bs58.decode(ix.data)[0]===12?5:4);}catch{return false;}
          })}}}:tx;
        if(!validateTransfer(filtered,order)||tx.transaction?.signatures?.[0]!==item.signature)continue;
        return transaction(async c=>{
          // Always lock event then order, matching checkout creation's order.
          const event=(await c.query('SELECT * FROM tournaments WHERE id=$1 FOR UPDATE',[order.tournament_id])).rows[0];
          const locked=(await c.query('SELECT * FROM tournament_orders WHERE id=$1 FOR UPDATE',[order.id])).rows[0];
          if(locked.status!=='pending')return locked;
          const blockMs=tx.blockTime*1000;
          const count=Number((await c.query('SELECT COUNT(*) AS n FROM tournament_entries WHERE tournament_id=$1',[event.id])).rows[0].n);
          const existing=(await c.query('SELECT 1 FROM tournament_entries WHERE tournament_id=$1 AND user_id=$2',[event.id,order.user_id])).rowCount;
          const timely=blockMs>=new Date(order.created_at).getTime()-2000&&blockMs<=new Date(order.expires_at).getTime()&&blockMs<new Date(event.closes_at).getTime();
          const status=timely&&count<event.capacity&&!existing&&event.status==='open'?'registered':'needs_review';
          const updated=(await c.query('UPDATE tournament_orders SET status=$2,signature=$3,completed_at=$4 WHERE id=$1 RETURNING *',[order.id,status,item.signature,new Date(now())])).rows[0];
          if(status==='registered')await c.query('INSERT INTO tournament_entries(tournament_id,user_id,order_id,wallet) VALUES($1,$2,$3,$4)',[event.id,order.user_id,order.id,order.wallet]);
          return updated;
        });
      }
      await pool.query('UPDATE tournament_orders SET checked_at=$2 WHERE id=$1',[order.id,new Date(now())]);
      return order;
    })();checking.set(order.id,task);try{return await task;}finally{checking.delete(order.id);}
  }
  let reconciling;
  async function reconcile(){
    if(!cryptoConfigured||reconciling)return reconciling;
    reconciling=(async()=>{await ready;const rows=(await pool.query("SELECT * FROM tournament_orders WHERE status='pending' AND created_at>$1 ORDER BY checked_at NULLS FIRST LIMIT 20",[new Date(now()-7*86400000)])).rows;
      for(const row of rows){try{await verifyOrder(row);}catch{console.error('[tournaments] Payment reconciliation deferred');}}
    })();try{await reconciling;}finally{reconciling=null;}
  }
  const timer=reconcileIntervalMs>0?setInterval(()=>{reconcile().catch(()=>{});rewards.run().catch(()=>console.error('[tournament prizes] Retry deferred'));},reconcileIntervalMs):null;timer?.unref();
  async function interaction(req,res){
    const raw=await read(req);
    if(!verifyDiscordRequest(raw,req.headers,config.DISCORD_PUBLIC_KEY,now()))return send(res,401,{error:'Invalid signature'});
    const body=JSON.parse(raw);
    if(body.application_id!==config.DISCORD_APPLICATION_ID)return send(res,401,{error:'Wrong application'});
    if(body.type===1)return send(res,200,{type:1});
    const reply=content=>send(res,200,{type:4,data:{content,flags:64,allowed_mentions:{parse:[]}}});
    if(![2,3,5].includes(body.type)||body.guild_id!==config.DISCORD_GUILD_ID)return reply('Use this command in the KRYX community server.');
    const user=body.member?.user;
    if(!user?.id)return reply('Discord account could not be verified.');
    const claimed=await pool.query('INSERT INTO discord_interactions(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id',[body.id]);
    if(!claimed.rowCount)return reply('This command was already processed. Check your game profile.');
    await pool.query("DELETE FROM discord_interactions WHERE created_at < NOW()-INTERVAL '1 day'");
    if(body.data?.name==='tournaments')return reply(`View upcoming tournaments and register at ${site}/?panel=tournaments. Entry requires a game login, a saved Solana address and payment from your in-game K balance.`);
    if((body.type===2&&body.data?.name==='tournament')||([3,5].includes(body.type)&&body.data?.custom_id?.startsWith('tournament:'))){
      let allowed=false;try{const bits=BigInt(body.member.permissions||'0');allowed=!!(bits&8n);}catch{}
      if(!allowed)return reply('Administrator permission is required to create tournaments.');
      const organizer=(await pool.query('SELECT user_id FROM tournament_profiles WHERE discord_id=$1',[user.id])).rows[0];

      if(!config.DISCORD_MOD_CHANNEL_ID || body.channel_id!==config.DISCORD_MOD_CHANNEL_ID)return reply('Create tournaments in the configured mods-only channel.');
      if(!discord.configured)return reply('The tournament bot is not configured yet.');
      try{
        if(body.type===2){
          const id=randomUUID();
          await pool.query('DELETE FROM tournament_drafts WHERE expires_at<$1',[new Date(now())]);
          await pool.query('INSERT INTO tournament_drafts(id,discord_id,origin_id,expires_at) VALUES($1,$2,$3,$4)',[id,user.id,body.id,new Date(now()+30*60000)]);
          return send(res,200,scheduleModal(id,now()));
        }
        const [,action,id]=body.data.custom_id.split(':');
        if(!/^[0-9a-f-]{36}$/i.test(id||''))return reply('Invalid tournament form. Run /tournament again.');
        const draft=(await pool.query('SELECT * FROM tournament_drafts WHERE id=$1 AND discord_id=$2 AND expires_at>$3',[id,user.id,new Date(now())])).rows[0];
        if(!draft)return reply('This form expired or belongs to another moderator. Run /tournament again.');
        const payload=draft.payload;
        if(body.type===3&&action==='cancel'){
          const removed=await pool.query("DELETE FROM tournament_drafts WHERE id=$1 AND discord_id=$2 AND stage<>'created' RETURNING id",[id,user.id]);
          return reply(removed.rowCount?'Tournament draft cancelled. Nothing was published.':'This tournament was already created; its published event was not cancelled.');
        }
        if(body.type===3&&action==='editSchedule'&&draft.stage!=='created')return send(res,200,scheduleModal(id,now()));
        if(body.type===5&&action==='schedule'&&draft.stage!=='created'){
          const values=modalValues(body.data);let startsAt;
          try{startsAt=scheduledInstant(values);}catch(e){return reply(e.message+' Run /tournament again.');}
          if(Date.parse(startsAt)<=now()+5*60000||Date.parse(startsAt)>now()+26*86400000)return reply('Choose a start at least five minutes ahead and within the next 25 days. Run /tournament again.');
          const saved=await pool.query("UPDATE tournament_drafts SET payload=$2,stage='details' WHERE id=$1 AND stage<>'created' RETURNING id",[id,JSON.stringify({...payload,startsAt,zone:values.zone})]);
          if(!saved.rowCount)return reply('This tournament was already created.');
          return send(res,200,draftMessage(id,'Start: <t:'+Math.floor(Date.parse(startsAt)/1000)+':F> ('+values.zone+'). Continue to set the fee and player limit.',[['editDetails','Tournament details'],['editSchedule','Change time',2],['cancel','Cancel',4]]));
        }
        if(body.type===3&&action==='editDetails'&&payload.startsAt&&draft.stage!=='created')return send(res,200,detailsModal(id));
        if(body.type===5&&action==='details'&&payload.startsAt&&draft.stage!=='created'){
          const v=modalValues(body.data),capacity=Number(v.players),deadline=Number(v.deadline);
          if(!tournamentType(v.type)||String(v.instructions||'').length>1200||![2,4,8,16,32,64,128].includes(capacity)||![5,15,30,60,120,1440].includes(deadline))return reply('Check the tournament details and open the details form again.');
          feeUnits(v.fee,'K');
          const closesAt=new Date(Date.parse(payload.startsAt)-deadline*60000).toISOString();
          if(Date.parse(closesAt)<=now())return reply('Registration would already be closed. Choose a later start or a shorter registration cutoff.');
          const next={...payload,type:v.type,title:tournamentType(v.type).title,description:v.instructions||'',fee:v.fee,asset:'K',capacity,closesAt};
          const saved=await pool.query("UPDATE tournament_drafts SET payload=$2,stage='prizes' WHERE id=$1 AND stage<>'created' RETURNING id",[id,JSON.stringify(next)]);
          if(!saved.rowCount)return reply('This tournament was already created.');
          return send(res,200,draftMessage(id,'Details saved. Set the tournament duration and prizes for each place.',[['editPrizes','Duration & prizes'],['editDetails','Edit details',2]]));
        }
        if(body.type===3&&action==='editPrizes'&&payload.type&&draft.stage!=='created')return send(res,200,prizesModal(id));
        if(body.type===5&&action==='prizes'&&payload.type&&draft.stage!=='created'){
          const v=modalValues(body.data);let rules;
          try{rules=prizeRules(v.duration,v.prizes,payload.capacity);}catch(e){return reply(e.message);}
          const next={...payload,durationMinutes:rules.durationMinutes,prizeAmounts:rules.prizes.map(usdcAmount)};
          await pool.query("UPDATE tournament_drafts SET payload=$2,stage='review' WHERE id=$1 AND stage<>'created'",[id,JSON.stringify(next)]);
          const text='Review tournament: '+next.title+'\nStart: <t:'+Math.floor(Date.parse(next.startsAt)/1000)+':F>\nDuration: '+rules.durationMinutes+' minutes. Entry: '+next.fee+' K.\n'+next.prizeAmounts.map((amount,i)=>'Place '+(i+1)+': '+amount+' USDC').join('\n')+'\nOnly registered players in public matches count. Highest score wins; ties go to the player who reached the score first, then account ID. Survival counts the longest single life inside the tournament window. Prizes use the existing payout wallet and wait for funding if needed.';
          return send(res,200,draftMessage(id,text,[['confirm','Create & Announce',3],['editPrizes','Edit prizes',2],['editDetails','Edit details',2],['cancel','Cancel',4]]));
        }
        if(body.type!==3||action!=='confirm'||draft.stage!=='review')return reply('This form has already been used or is not ready. Run /tournament for a new event.');
        const event=await transaction(async c=>{
          const locked=(await c.query('SELECT * FROM tournament_drafts WHERE id=$1 FOR UPDATE',[id])).rows[0];
          if(locked?.stage!=='review'||new Date(locked.expires_at).getTime()<=now())fail('This form was already used or expired.');
          const created=await createEvent(locked.payload,organizer?.user_id??null,locked.origin_id,c,user.id);
          await c.query("UPDATE tournament_drafts SET stage='created' WHERE id=$1",[id]);return created;
        });
        send(res,200,{type:5,data:{flags:64}});
        void (async()=>{
          let content;
          try{
            const message=await discord.announce({...event,fee:publicEvent(event).fee},site);
            await pool.query('UPDATE tournaments SET announcement_id=$2 WHERE id=$1',[event.id,message.id]);
            content='Tournament created and announced in <#'+config.DISCORD_TOURNAMENT_CHANNEL_ID+'>.';
          }catch{content='Tournament created, but its announcement could not be posted. Do not create it again; an administrator can retry the announcement from the game tournament page.';}
          try{await discord.completeInteraction(body.token,content);}catch{console.error('[tournaments] Discord confirmation could not be delivered');}
        })();
        return true;
      }catch(e){return reply(e.status?e.message:'Could not create the tournament. Check /tournaments before retrying.');}
    }
    if(body.type!==2||body.data?.name!=='link')return reply('Unknown command.');
    const code=body.data.options?.find(o=>o.name==='code')?.value;
    if(typeof code!=='string'||!/^[-_a-zA-Z0-9]{24}$/.test(code))return reply('Generate a fresh linking code in your KRYX Profile.');
    try{
      await transaction(async c=>{
        const link=(await c.query('DELETE FROM discord_link_codes WHERE code_hash=$1 AND expires_at>$2 RETURNING user_id',[hashLinkCode(code),new Date(now())])).rows[0];
        if(!link)fail('Code expired or already used. Generate a new one in Profile.');
        await c.query('INSERT INTO tournament_profiles(user_id) VALUES($1) ON CONFLICT DO NOTHING',[link.user_id]);
        const current=(await c.query('SELECT discord_id FROM tournament_profiles WHERE user_id=$1 FOR UPDATE',[link.user_id])).rows[0];
        if(current.discord_id&&current.discord_id!==user.id)fail('This game account is already linked. Unlink it in Profile first.');
        await c.query('UPDATE tournament_profiles SET discord_id=$2,discord_name=$3 WHERE user_id=$1',[link.user_id,user.id,String(user.global_name||user.username||'Discord player').slice(0,80)]);
      });return reply('Your Discord account is now linked to KRYX. Refresh your Profile to see it.');
    }catch(e){return reply(e.code==='23505'?'This Discord account is already linked to another KRYX account.':e.status?e.message:'Account linking is temporarily unavailable.');}
  }
  const rates=new Map();
  async function handler(req,res,path){
    if(!path.startsWith('/api/tournaments')&&!path.startsWith('/api/community/'))return false;
    try{
      await ready;
      if(path==='/api/community/discord/interactions'&&req.method==='POST')return await interaction(req,res);
      const user=await accounts.session(req);
      if(req.method==='GET'&&path==='/api/tournaments'){
        const events=(await pool.query('SELECT t.*, (SELECT COUNT(*) FROM tournament_entries e WHERE e.tournament_id=t.id) AS registered FROM tournaments t ORDER BY starts_at DESC LIMIT 40')).rows;
        for(const event of events)if(event.status==='completed')event.results=(await pool.query(`SELECT p.place,p.score,p.state,p.signature,u.username FROM tournament_prizes p JOIN users u ON u.id=p.user_id WHERE p.tournament_id=$1 ORDER BY p.place`,[event.id])).rows;
        return send(res,200,{ok:true,events:events.map(publicEvent),configured});
      }
      if(!user)fail('Log in to continue',401);
      if(req.method!=='GET'){
        if(!originOK(req))fail('Same-origin request required',403);
        const at=now(),bucket=rates.get(String(user.id));
        if(!bucket||at-bucket.at>60000)rates.set(String(user.id),{at,count:1});else if(++bucket.count>20)fail('Please wait before trying again',429);
        if(rates.size>1000)for(const [id,r] of rates)if(at-r.at>60000)rates.delete(id);
      }
      if(req.method==='GET'&&path==='/api/community/me')return send(res,200,{ok:true,username:user.username,profile:await profile(user.id),discordConfigured:linking,admin:admins.has(String(user.id)),entries:(await pool.query('SELECT tournament_id,entered_at FROM tournament_entries WHERE user_id=$1',[user.id])).rows});
      const data=req.method==='GET'?{}:JSON.parse(await read(req)||'{}');
      if(req.method==='POST'&&path==='/api/community/profile'){
        let wallet;try{wallet=address(data.solanaAddress);}catch{fail('Enter a valid Solana wallet address');}
        await pool.query('INSERT INTO tournament_profiles(user_id,solana_address) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET solana_address=EXCLUDED.solana_address',[user.id,wallet]);
        return send(res,200,{ok:true,profile:await profile(user.id)});
      }
      if(req.method==='POST'&&path==='/api/community/discord/link-code'){
        if(!linking)fail('Discord linking is awaiting bot setup',503);
        const code=randomBytes(18).toString('base64url');
        await pool.query('INSERT INTO discord_link_codes(code_hash,user_id,expires_at) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET code_hash=EXCLUDED.code_hash,expires_at=EXCLUDED.expires_at',[hashLinkCode(code),user.id,new Date(now()+300000)]);
        return send(res,200,{ok:true,code,expiresIn:300});
      }
      if(req.method==='POST'&&path==='/api/community/discord/unlink'){
        await transaction(async c=>{await c.query('DELETE FROM discord_link_codes WHERE user_id=$1',[user.id]);await c.query('UPDATE tournament_profiles SET discord_id=NULL,discord_name=NULL WHERE user_id=$1',[user.id]);});
        return send(res,200,{ok:true});
      }
      if(path.startsWith('/api/tournaments/admin/')){
        if(!admins.has(String(user.id)))fail('Administrator access required',403);
        if(req.method==='GET'&&path.endsWith('/registrations')){
          const id=new URL(req.url,'https://localhost').searchParams.get('id');
          if(!/^[0-9a-f-]{36}$/i.test(id||''))fail('Select a tournament');
          const entries=(await pool.query('SELECT e.user_id,u.username,e.wallet,e.entered_at,p.discord_id,p.discord_name FROM tournament_entries e JOIN users u ON u.id=e.user_id LEFT JOIN tournament_profiles p ON p.user_id=e.user_id WHERE e.tournament_id=$1 ORDER BY e.entered_at',[id])).rows;
          const review=(await pool.query("SELECT id,user_id,asset,amount_units,signature FROM tournament_orders WHERE tournament_id=$1 AND status='needs_review'",[id])).rows;
          return send(res,200,{ok:true,entries,review});
        }
        if(req.method!=='POST')fail('Not found',404);
        if(path.endsWith('/discord-commands')){await discord.register();return send(res,200,{ok:true});}
        if(path.endsWith('/create')){
          const event=await createEvent(data,user.id);
          return send(res,201,{ok:true,event:publicEvent(event)});
        }
        if(path.endsWith('/announce')){
          const event=(await pool.query('SELECT * FROM tournaments WHERE id=$1',[data.id])).rows[0];if(!event)fail('Tournament not found',404);
          if(!event.announcement_id){const message=await discord.announce({...event,fee:publicEvent(event).fee},site);await pool.query('UPDATE tournaments SET announcement_id=$2 WHERE id=$1',[event.id,message.id]);}
          return send(res,200,{ok:true});
        }
        fail('Not found',404);
      }
      const entry=path.match(/^\/api\/tournaments\/([0-9a-f-]{36})\/enter$/i);
      if(entry&&req.method==='POST'){
        if(data.confirm!==true)fail('Confirm the entry fee before continuing');
        const p=await profile(user.id);if(!p.solana_address)fail('Set your Solana wallet address in Profile first');
        const target=(await pool.query('SELECT asset FROM tournaments WHERE id=$1',[entry[1]])).rows[0];
        if(target?.asset==='K')return send(res,201,{ok:true,order:publicOrder(await enterWithTokens(entry[1],user,p.solana_address))});
        if(!cryptoConfigured)fail('Legacy payment service unavailable',503);
        await chain();
        const order=await transaction(async c=>{
          const event=(await c.query('SELECT * FROM tournaments WHERE id=$1 FOR UPDATE',[entry[1]])).rows[0];
          if(!event||event.status!=='open'||new Date(event.closes_at).getTime()<=now())fail('Registration is closed',409);
          if((await c.query('SELECT 1 FROM tournament_entries WHERE tournament_id=$1 AND user_id=$2',[event.id,user.id])).rowCount)fail('You are already registered',409);
          const previous=(await c.query("SELECT * FROM tournament_orders WHERE tournament_id=$1 AND user_id=$2 AND status='pending' AND expires_at>$3 ORDER BY created_at DESC LIMIT 1",[event.id,user.id,new Date(now())])).rows[0];
          if(previous)return previous;
          const used=Number((await c.query("SELECT (SELECT COUNT(*) FROM tournament_entries WHERE tournament_id=$1)+(SELECT COUNT(*) FROM tournament_orders WHERE tournament_id=$1 AND status='pending' AND expires_at>$2) AS n",[event.id,new Date(now())])).rows[0].n);
          if(used>=event.capacity)fail('All places are taken or reserved for payment. Try again later.',409);
          const expires=new Date(Math.min(now()+600000,new Date(event.closes_at).getTime()));
          return (await c.query('INSERT INTO tournament_orders(id,tournament_id,user_id,wallet,asset,amount_units,reference,merchant,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[randomUUID(),event.id,user.id,p.solana_address,event.asset,event.fee_units,bs58.encode(randomBytes(32)),merchant,new Date(now()),expires])).rows[0];
        });return send(res,201,{ok:true,order:publicOrder(order)});
      }
      const orderMatch=path.match(/^\/api\/tournaments\/orders\/([0-9a-f-]{36})$/i);
      if(orderMatch&&req.method==='GET'){
        let order=(await pool.query('SELECT * FROM tournament_orders WHERE id=$1 AND user_id=$2',[orderMatch[1],user.id])).rows[0];
        if(!order)fail('Payment not found',404);
        if(!order.checked_at||now()-new Date(order.checked_at).getTime()>=10000)order=await verifyOrder(order);
        return send(res,200,{ok:true,order:publicOrder(order)});
      }
      fail('Not found',404);
    }catch(e){if(!e.status)console.error('[tournaments] Request failed',e.code||e.name);return send(res,e.status||503,{ok:false,error:e.status?e.message:'Tournament service temporarily unavailable. Do not send another payment; try again shortly.'});}
  }
  handler.recordResult=rewards.record;handler.prizes=rewards;handler.ready=ready;handler.reconcile=reconcile;handler.close=async()=>{clearInterval(timer);await reconciling;await rewards.close();};
  return handler;
}
