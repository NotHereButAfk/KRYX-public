import {randomUUID} from 'node:crypto';
import {existsSync,writeFileSync} from 'node:fs';
import {configuredServerPayouts,buildUsdcPayout} from './solana-payouts.mjs';
import {usdcAmount} from './tournament-prize-rules.mjs';

export function tournamentPrizes({pool,ready,discord,now=Date.now,providerFactory=()=>configuredServerPayouts(pool),buildTransfer=buildUsdcPayout,reviewFile=new URL('./.tournament-scoring-review.json',import.meta.url)}) {
  let pending=Promise.resolve(),running,scoreFailure=existsSync(reviewFile);
  const transaction=async fn=>{const c=await pool.connect();try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
  function record(userId,type,value=1,startedAt=null,at=now()) {
    if(!userId||!Number.isFinite(value)||value<=0)return;
    pending=pending.then(async()=>{
      await ready;
      const rows=(await pool.query(`SELECT t.id,t.starts_at,t.ends_at FROM tournaments t JOIN tournament_entries e ON e.tournament_id=t.id
        WHERE e.user_id=$1 AND t.tournament_type=$2 AND t.ends_at IS NOT NULL AND t.status<>'completed'
        AND t.starts_at<=$3 AND t.ends_at>$4`,[userId,type,new Date(at),new Date(startedAt??at)])).rows;
      for(const t of rows){
        const score=type==='most_kills'?1:Math.floor(Math.max(0,Math.min(at,+new Date(t.ends_at))-Math.max(startedAt,+new Date(t.starts_at)))/1000);
        if(score<=0)continue;
        await pool.query(`INSERT INTO tournament_scores(tournament_id,user_id,score,reached_at) VALUES($1,$2,$3,$4)
          ON CONFLICT(tournament_id,user_id) DO UPDATE SET
          score=${type==='most_kills'?'tournament_scores.score+EXCLUDED.score':'GREATEST(tournament_scores.score,EXCLUDED.score)'},
          reached_at=CASE WHEN ${type==='most_kills'?'TRUE':'EXCLUDED.score>tournament_scores.score'} THEN EXCLUDED.reached_at ELSE tournament_scores.reached_at END`,[t.id,userId,score,new Date(Math.min(at,+new Date(t.ends_at)))]);
      }
    }).catch(()=>{scoreFailure=true;try{writeFileSync(reviewFile,JSON.stringify({at:now(),reason:'Score persistence failed; review results before removing this marker'}),{mode:0o600});}catch{console.error('[tournament prizes] Could not persist scoring review marker');}console.error('[tournament prizes] Score persistence failed; settlement paused for review');});
    return pending;
  }
  async function finalize(){
    await pending;
    if(scoreFailure)throw Error('Score persistence failed; review required');
    const events=(await pool.query("SELECT id FROM tournaments WHERE ends_at<$1 AND status<>'completed'",[new Date(now()-30000)])).rows;
    for(const event of events)await transaction(async c=>{
      const t=(await c.query('SELECT * FROM tournaments WHERE id=$1 FOR UPDATE',[event.id])).rows[0];
      if(t.status==='completed')return;
      const winners=(await c.query(`SELECT s.*,e.wallet,p.discord_id FROM tournament_scores s
        JOIN tournament_entries e ON e.tournament_id=s.tournament_id AND e.user_id=s.user_id
        LEFT JOIN tournament_profiles p ON p.user_id=s.user_id WHERE s.tournament_id=$1 AND s.score>0
        ORDER BY s.score DESC,s.reached_at ASC,s.user_id ASC LIMIT $2`,[t.id,t.prizes.length])).rows;
      for(let i=0;i<winners.length;i++){
        const w=winners[i];
        await c.query(`INSERT INTO tournament_prizes(id,tournament_id,user_id,place,score,destination,discord_id,amount_units)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,[randomUUID(),t.id,w.user_id,i+1,w.score,w.wallet,w.discord_id,t.prizes[i]]);
      }
      await c.query("UPDATE tournaments SET status='completed' WHERE id=$1",[t.id]);
    });
  }
  async function notify(row,paid){
    if(!row.discord_id){await pool.query(`UPDATE tournament_prizes SET ${paid?'paid_notified':'win_notified'}=TRUE WHERE id=$1`,[row.id]);return;}
    if(!discord.configured)return;
    const message=paid?`Your tournament prize is paid! ${row.title} — place ${row.place}: ${usdcAmount(row.amount_units)} USDC.\nSolana transaction: https://explorer.solana.com/tx/${row.signature}`
      :`You placed ${row.place} in ${row.title}! Your prize is ${usdcAmount(row.amount_units)} USDC. It is queued for your registered Solana wallet. If funding is needed, payment will be retried automatically. You will receive a transaction link after finalization.`;
    await discord.direct(row.discord_id,message,`${row.id}:${paid?'paid':'won'}`);
    await pool.query(`UPDATE tournament_prizes SET ${paid?'paid_notified':'win_notified'}=TRUE WHERE id=$1`,[row.id]);
  }
  async function run(){
    await ready;await finalize();
    const provider=await providerFactory();
    const rows=(await pool.query(`SELECT p.*,t.title FROM tournament_prizes p JOIN tournaments t ON t.id=p.tournament_id
      WHERE next_attempt<=$1 AND (state IN ('queued','submitted') OR NOT win_notified OR (state='completed' AND NOT paid_notified))
      ORDER BY next_attempt,place LIMIT 20`,[new Date(now())])).rows;
    for(const row of rows){
      // Persisted row locks serialize signing. Never build a replacement for an ambiguous transaction.
      await pool.query('UPDATE tournament_prizes SET next_attempt=$2 WHERE id=$1',[row.id,new Date(now()+60000)]);
      try{if(!row.win_notified)await notify(row,false);}catch{ /* DMs may be disabled; retry without blocking payment. */ }
      try{
        if(provider?.accepting && row.state==='queued')await transaction(async c=>{
          await c.query('SELECT id FROM tournament_payout_lock WHERE id=1 FOR UPDATE');
          await c.query('SELECT id FROM k_withdrawal_lock WHERE id=1 FOR UPDATE');
          const job=(await c.query('SELECT * FROM tournament_prizes WHERE id=$1 FOR UPDATE',[row.id])).rows[0];
          if(job.state!=='queued')return;
          await provider.verifyNetwork();await provider.validateDestination(job.destination);
          // Respect funds already reserved by ordinary K withdrawals.
          await provider.canReserve(job.amount_units);
          const latest=await provider.rpc('getLatestBlockhash',[{commitment:'finalized'}]);
          const signed=await buildTransfer({signer:provider.signer,destination:job.destination,amountUnits:job.amount_units,withdrawalId:job.id,...latest.value});
          await c.query("UPDATE tournament_prizes SET signature=$2,wire=$3,last_valid_height=$4,state='submitted' WHERE id=$1",[job.id,signed.signature,signed.wire,String(latest.value.lastValidBlockHeight)]);
        });
        const job=(await pool.query('SELECT * FROM tournament_prizes WHERE id=$1',[row.id])).rows[0];
        if(provider && job.state==='submitted'){
          const result=await provider.reconcile({...job,withdrawal_id:job.id});
          if(['completed','failed','review'].includes(result.status))await pool.query('UPDATE tournament_prizes SET state=$2 WHERE id=$1',[job.id,result.status]);
          job.state=result.status;
        }
        if(job.state==='completed'&&!job.paid_notified)await notify({...row,...job},true);
      }catch{ /* Insufficient funds/RPC failures leave the durable job queued. */ }
    }
  }
  return {record,flush:()=>pending,run(){if(running)return running;running=run().finally(()=>{running=null;});return running;},async close(){await pending;await running;}};
}
