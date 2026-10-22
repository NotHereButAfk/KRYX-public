import {usdcAmount} from './tournament-prize-rules.mjs';
import {tournamentType} from './tournament-types.mjs';
import {createHash, createPublicKey, verify} from 'node:crypto';

export const DISCORD_COMMANDS = [
  {name:'tournament',description:'Open the tournament creation form.',default_member_permissions:'8'},
  {name:'link',description:'Link your KRYX account using the code from your game profile.',options:[{type:3,name:'code',description:'Your one-time KRYX linking code',required:true}]},
  {name:'tournaments',description:'View upcoming KRYX tournaments and entry requirements.'},
];
export const hashLinkCode = code => createHash('sha256').update(code).digest('hex');
export function verifyDiscordRequest(raw, headers, publicKey, now=Date.now()) {
  try {
    const timestamp=headers['x-signature-timestamp'],signature=headers['x-signature-ed25519'];
    if(!/^\d+$/.test(timestamp||'') || Math.abs(now/1000-Number(timestamp))>300 || !/^[a-f0-9]{128}$/i.test(signature||'') || !/^[a-f0-9]{64}$/i.test(publicKey||''))return false;
    const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(publicKey,'hex')]),format:'der',type:'spki'});
    return verify(null,Buffer.concat([Buffer.from(timestamp),Buffer.from(raw)]),key,Buffer.from(signature,'hex'));
  } catch{return false;}
}
export function discordClient(config, fetchImpl=fetch) {
  const configured=!!config.DISCORD_BOT_TOKEN && /^\d{17,24}$/.test(config.DISCORD_APPLICATION_ID||'') && /^\d{17,24}$/.test(config.DISCORD_GUILD_ID||'');
  async function request(path,method,body){
    if(!configured)throw Error('Discord bot is not configured');
    const response=await fetchImpl(`https://discord.com/api/v10/${path}`,{method,headers:{Authorization:`Bot ${config.DISCORD_BOT_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error('Discord request failed; check bot permissions and try again');
    return response.json();
  }
  return {configured,
    async direct(userId,content,key){
      if(!/^\d{17,24}$/.test(userId))throw Error('Invalid Discord recipient');
      const channel=await request('users/@me/channels','POST',{recipient_id:userId});
      return request(`channels/${channel.id}/messages`,'POST',{content,allowed_mentions:{parse:[]},nonce:hashLinkCode(key).slice(0,24),enforce_nonce:true});
    },
    completeInteraction:(token,content)=>request(`webhooks/${config.DISCORD_APPLICATION_ID}/${encodeURIComponent(token)}/messages/@original`,'PATCH',{content,allowed_mentions:{parse:[]}}),
    register:()=>request(`applications/${config.DISCORD_APPLICATION_ID}/guilds/${config.DISCORD_GUILD_ID}/commands`,'PUT',DISCORD_COMMANDS),
    announce:(event,site)=>{
      if(!/^\d{17,24}$/.test(config.DISCORD_TOURNAMENT_CHANNEL_ID||''))throw Error('Tournament announcement channel is not configured');
      return request(`channels/${config.DISCORD_TOURNAMENT_CHANNEL_ID}/messages`,'POST',{
        embeds:[{title:event.title,description:event.description || 'Registration is open.',color:0x22dac7,url:`${site}/?panel=tournaments`,fields:[
          ...(tournamentType(event.tournament_type)?[{name:'Objective',value:tournamentType(event.tournament_type).objective}]:[]),
          ...(event.ends_at?[{name:'Ends',value:`<t:${Math.floor(new Date(event.ends_at).getTime()/1000)}:F>`},{name:'USDC prizes by place',value:(event.prizes||[]).map((p,i)=>`${i+1}: ${usdcAmount(p)} USDC`).join('\n')||'None'},{name:'Scoring',value:'Registered players in public matches only. Highest score wins; ties use earliest score, then account ID. Survival uses the longest single life within the event window.'}]:[]),
          {name:'Starts',value:`<t:${Math.floor(new Date(event.starts_at).getTime()/1000)}:F>`},
          {name:'Entry fee',value:`${event.fee} ${event.asset}`,inline:true},
          {name:'Players',value:String(event.capacity),inline:true},
          {name:'How to enter',value:'Log in to KRYX, save your Solana address in Profile, and pay the entry fee from your in-game K balance on the tournament page.'}
        ]}],allowed_mentions:{parse:[]},nonce:hashLinkCode(event.id).slice(0,24),enforce_nonce:true,
      });
    }
  };
}
