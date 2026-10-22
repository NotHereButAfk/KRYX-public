import { randomUUID } from 'node:crypto';
import {ACHIEVEMENT_TRACKS,getAchievementReward,cleanNameCosmetics,achievementProgress} from '../src/sim/AchievementCatalog.js';
const ids=new Set([...ACHIEVEMENT_TRACKS.map(t=>t.id),'deaths','bestSurvivalSeconds']);
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
export function createAchievementService(accounts) {
  if(!accounts?.pool)return null;
  const pool=accounts.pool;
  const ready=Promise.resolve(accounts.ready).then(()=>pool.query(`
    CREATE TABLE IF NOT EXISTS achievement_stats(user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, stats JSONB NOT NULL DEFAULT '{}');
    CREATE TABLE IF NOT EXISTS achievement_claims(user_id BIGINT REFERENCES users(id) ON DELETE CASCADE, achievement_id TEXT NOT NULL, claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(user_id,achievement_id));
    CREATE TABLE IF NOT EXISTS name_cosmetics(user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, badge TEXT, title TEXT, style TEXT);
    ALTER TABLE achievement_claims ADD COLUMN IF NOT EXISTS reward_kind TEXT NOT NULL DEFAULT 'cosmetic';
    UPDATE users u SET kills=GREATEST(u.kills,LEAST(2147483647,COALESCE((a.stats->>'kills')::bigint,0))),
      deaths=GREATEST(u.deaths,LEAST(2147483647,COALESCE((a.stats->>'deaths')::bigint,0))),
      score=GREATEST(u.score,LEAST(2147483647,COALESCE((a.stats->>'score')::bigint,0))),
      games=GREATEST(u.games,LEAST(2147483647,COALESCE((a.stats->>'games')::bigint,0)))
      FROM achievement_stats a WHERE a.user_id=u.id;
  `));
  ready.catch(e=>console.error('[achievements init]',e.message));
  let pending=Promise.resolve();
  async function profile(userId) {
    await ready;await pending;
    const [s,c,e]=await Promise.all([
      pool.query('SELECT stats FROM achievement_stats WHERE user_id=$1',[userId]),
      pool.query('SELECT achievement_id,reward_kind FROM achievement_claims WHERE user_id=$1',[userId]),
      pool.query('SELECT badge,title,style FROM name_cosmetics WHERE user_id=$1',[userId]),
    ]);
    return {stats:s.rows[0]?.stats||{},claimed:c.rows.map(r=>r.achievement_id),cosmeticClaims:c.rows.filter(r=>r.reward_kind==='cosmetic').map(r=>r.achievement_id),equipped:cleanNameCosmetics(e.rows[0])};
  }
  function record(userId,delta) {
    if(!userId)return;
    const entries=Object.entries(delta).filter(([k,v])=>ids.has(k)&&Number.isSafeInteger(v)&&v>0);
    if(!entries.length)return;
    pending=pending.then(async()=>{
      await ready;
      const expressions=entries.map(([key],i)=>{
        const current=`COALESCE((achievement_stats.stats->>'${key}')::bigint,0)`;
        return `'${key}', ${['bestStreak','bestSurvivalSeconds'].includes(key)?`GREATEST(${current},$${i+2}::bigint)`:`(${current}+$${i+2}::bigint)`}`;
      });
      // Each event is a single atomic UPSERT; simultaneous rooms cannot lose progress.
      const lifetime=entries.flatMap(([key],i)=>['kills','deaths','score','games'].includes(key)?[`${key}=LEAST(2147483647,users.${key}::bigint+$${i+2}::bigint)`]:[]);
      const upsert=`INSERT INTO achievement_stats(user_id,stats) VALUES($1,jsonb_build_object(${entries.map(([k],i)=>`'${k}',$${i+2}::bigint`).join(',')})) ON CONFLICT(user_id) DO UPDATE SET stats=achievement_stats.stats || jsonb_build_object(${expressions.join(',')}) RETURNING user_id`;
      // Career and achievement progress commit together, using authoritative events only.
      await pool.query(lifetime.length?`WITH progress AS (${upsert}) UPDATE users SET ${lifetime.join(',')} WHERE id IN (SELECT user_id FROM progress)`:upsert,[userId,...entries.map(([,v])=>v)]);
    }).catch(e=>console.error('[achievement progress]',e.message));
  }
  const service={ready,profile,record,flush:()=>pending,onEquip:null};
  service.handler=async(req,res,path)=>{
    if(!path.startsWith('/api/achievements'))return false;
    try {
      await ready;const user=await accounts.session(req);
      if(!user){send(res,401,{error:'Sign in to earn and equip achievement rewards.'});return true;}
      if(req.method==='GET'&&path==='/api/achievements'){send(res,200,await profile(user.id));return true;}
      if(req.method!=='POST'){send(res,404,{error:'Not found'});return true;}
      if(req.headers['sec-fetch-site']==='cross-site'||!req.headers.origin||new URL(req.headers.origin).host!==req.headers.host){send(res,403,{error:'Same-origin request required'});return true;}
      let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2048){send(res,413,{error:'Request too large'});return true;}}
      const data=JSON.parse(raw||'{}');
      if(path==='/api/achievements/claim'){
        const state=await profile(user.id),a=achievementProgress(state.stats,state.claimed).find(a=>a.id===data.id);
        if(!a?.complete){send(res,409,{error:'Achievement is still locked.'});return true;}
        // Claim, balance and ledger entry commit atomically. A repeated or
        // concurrent request can never pay twice; older cosmetic claims stay claimed.
        await pool.query(`WITH claim AS (
          INSERT INTO achievement_claims(user_id,achievement_id,reward_kind) VALUES($1,$2,'coins')
          ON CONFLICT DO NOTHING RETURNING user_id
        ), paid AS (
          UPDATE users SET e_balance=e_balance+$3::numeric WHERE id IN (SELECT user_id FROM claim)
          RETURNING id,e_balance
        ) INSERT INTO e_transactions(id,user_id,amount,type,description,previous_balance,new_balance,idempotency_key,metadata)
          SELECT $4,id,$3::numeric,'EVENT_REWARD',$5,e_balance-$3::numeric,e_balance,$6,$7::jsonb FROM paid`,
          [user.id,a.id,a.coins,randomUUID(),`Quest reward: ${a.name}`,`quest:${user.id}:${a.id}`,JSON.stringify({achievement:a.id})]);
      }else if(path==='/api/achievements/equip'){
        const kind=data.kind;if(!['badge','title','style'].includes(kind)){send(res,400,{error:'Unknown reward slot'});return true;}
        const reward=getAchievementReward(data.id);
        if(data.id!==null){
          if(reward?.kind!==kind){send(res,400,{error:'Unknown reward'});return true;}
          const owned=await pool.query("SELECT achievement_id FROM achievement_claims WHERE user_id=$1 AND achievement_id=$2 AND reward_kind='cosmetic'",[user.id,reward.achievement]);
          if(!owned.rows.length){send(res,403,{error:'Unlock this reward first.'});return true;}
        }
        await pool.query(`INSERT INTO name_cosmetics(user_id,${kind}) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET ${kind}=EXCLUDED.${kind}`,[user.id,data.id]);
        const state=await profile(user.id);service.onEquip?.(user.id,state.equipped);send(res,200,state);return true;
      }else{send(res,404,{error:'Not found'});return true;}
      send(res,200,await profile(user.id));return true;
    }catch(e){console.error('[achievements]',e.message);send(res,503,{error:'Achievements are temporarily unavailable. Try again.'});return true;}
  };
  return service;
}
