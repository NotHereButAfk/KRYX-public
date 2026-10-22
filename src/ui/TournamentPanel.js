let version=0,poll,profileVersion=0,linkPoll;
async function api(path,data){
  const response=await fetch(path,{credentials:'same-origin',...(data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})});
  const result=await response.json().catch(()=>{throw Error('Account service is temporarily unavailable. Please try again.');});if(!response.ok||!result.ok){const error=Error(result.error||'Service unavailable');error.status=response.status;throw error;}return result;
}
function node(tag,text,parent,className){const el=document.createElement(tag);if(text)el.textContent=text;if(className)el.className=className;parent?.append(el);return el;}
function button(text,parent,action){const b=node('button',text,parent,'tournament-action');b.type='button';b.onclick=async()=>{b.disabled=true;try{await action();}finally{if(b.isConnected)b.disabled=false;}};return b;}
export async function openCommunityProfile(){
  const current=++profileVersion;clearTimeout(linkPoll);
  const root=document.getElementById('community-profile');if(!root)return;root.replaceChildren();
  node('h2','CONNECTED ACCOUNTS',root,'career-connections-title');
  const status=node('p','Loading connections…',root,'career-note');status.setAttribute('aria-live','polite');
  try{
    const me=await api('/api/community/me');if(current!==profileVersion)return;status.textContent='Manage your Discord account and tournament wallet here.';
    const cards=node('div',null,root,'career-connections');
    const wallet=node('section',null,cards,'career-connection');
    node('span','01 / WALLET',wallet,'career-eyebrow');node('h3','Solana wallet',wallet);
    const walletState=node('p',me.profile.solana_address?'Address saved':'No wallet address saved',wallet,'career-connection-state');
    node('p','Connect Phantom to fill your address, or paste it below. Save it for tournament registration.',wallet,'career-note');
    const form=node('form',null,wallet,'tournament-profile-form');
    const label=node('label','Solana address',form),input=node('input',null,label);input.name='solanaAddress';input.required=true;input.maxLength=44;input.autocomplete='off';input.spellcheck=false;input.placeholder='Your public Solana address';input.value=me.profile.solana_address||'';
    const actions=node('div',null,form,'career-connection-actions');
    button('CONNECT PHANTOM',actions,async()=>{
      const provider=window.phantom?.solana;
      if(!provider?.isPhantom){status.textContent='Open KRYX in the Phantom browser or enable the Phantom extension. You can also paste your address below.';input.focus();return;}
      try{const result=await provider.connect();if(current!==profileVersion)return;
        const address=result.publicKey?.toString();if(!address)throw Error('Wallet did not return a Solana address.');
        input.value=address;walletState.textContent='Wallet connected · Address not saved yet';status.textContent='Review the address, then click Save address.';
      }catch(e){status.textContent=e.code===4001?'Connection cancelled. Your saved address has not changed.':e.message;}
    });
    const save=node('button','SAVE ADDRESS',actions,'tournament-action');save.type='submit';
    form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{await api('/api/community/profile',{solanaAddress:input.value.trim()});walletState.textContent='Address saved';status.textContent='Solana address saved for your account.';}catch(e){status.textContent=e.message;}finally{save.disabled=false;}};
    const discord=node('section',null,cards,'career-connection');
    node('span','02 / COMMUNITY',discord,'career-eyebrow');node('h3','Discord',discord);
    node('p','Link your game account to your Discord identity for community events and tournaments.',discord,'career-note');
    if(me.profile.discord_id){
      node('p',`Linked to ${me.profile.discord_name}`,discord);
      button('UNLINK DISCORD',discord,async()=>{try{await api('/api/community/discord/unlink',{});await openCommunityProfile();}catch(e){status.textContent=e.message;}});
    }else{
      const linkingBox=node('div',null,discord,'discord-link-box');
      const link=button('LINK DISCORD',discord,async()=>{
        try{
          const result=await api('/api/community/discord/link-code',{});
          if(current!==profileVersion)return;
          clearTimeout(linkPoll);linkingBox.replaceChildren();
          const expiresAt=Date.now()+result.expiresIn*1000;
          node('p','In the KRYX Discord server, use this command:',linkingBox);
          const command=`/link code:${result.code}`;
          const field=node('input',null,linkingBox);field.type='text';field.readOnly=true;
          field.value=command;field.setAttribute('aria-label','Private Discord linking command');
          field.onclick=()=>field.select();
          button('COPY COMMAND',linkingBox,async()=>{
            try{await navigator.clipboard.writeText(command);status.textContent='Copied. Paste it in the KRYX Discord server.';}
            catch{field.focus();field.select();status.textContent='Select and copy the command above.';}
          });
          node('p','Expires in 5 minutes. Use it once and keep it private. No password or wallet connection needed.',linkingBox);
          link.textContent='GENERATE NEW CODE';
          status.textContent='Waiting for you to use /link in Discord...';
          const check=async()=>{
            if(current!==profileVersion||!root.isConnected||root.closest('.hidden'))return;
            if(Date.now()>=expiresAt){linkingBox.replaceChildren();status.textContent='Code expired. Click Generate new code to try again.';return;}
            try{const updated=await api('/api/community/me');if(current!==profileVersion)return;
              if(updated.profile.discord_id){await openCommunityProfile();return;}
            }catch{}
            linkPoll=setTimeout(check,3000);
          };
          linkPoll=setTimeout(check,3000);
        }catch(e){status.textContent=e.message;}
      });
      link.disabled=!me.discordConfigured;
      if(!me.discordConfigured)node('p','Discord linking is awaiting bot setup.',discord);
    }
    const community=node('a','OPEN COMMUNITY DISCORD',discord);community.href='https://discord.gg/e5ebChfaE';community.target='_blank';community.rel='noopener';
  }catch(e){status.textContent=e.status===401?'Log in to save your Solana address and link Discord.':e.message;}
}
export function tournamentCategory(event,now=Date.now()){
  if(event.status==='completed')return 'finished';
  return event.status==='open'&&Date.parse(event.closesAt)>now&&event.registered<event.capacity?'available':'closed';
}
export async function openTournamentPanel(){
  const current=++version;clearTimeout(poll);
  const root=document.getElementById('tournament-events'),requirements=document.getElementById('tournament-requirements');
  if(!root)return;root.replaceChildren();requirements.replaceChildren();node('p','Loading tournaments…',root);
  try{
    const [list,me]=await Promise.all([api('/api/tournaments'),api('/api/community/me').catch(e=>{if(e.status===401)return null;throw e;})]);
    if(current!==version)return;root.replaceChildren();
    for(const [name,ready] of [['Log in',!!me],['Save a Solana address',!!me?.profile.solana_address]])node('div',`${ready?'✓':'○'} ${name}`,requirements,ready?'requirement-ready':'');
    const account=node('a',me?'EDIT PROFILE':'LOG IN',requirements,'tournament-action');account.href=me?'/?panel=profile':'/login?next=%2F%3Fpanel%3Dtournaments';
    const now=Date.now(),groups={};
    for(const [key,title,empty] of [['available','Available','No tournaments are open for entry.'],['closed','Registration Closed','No closed tournaments.'],['finished','Finished','No finished tournaments yet.']]){
      const events=list.events.filter(event=>tournamentCategory(event,now)===key);
      const section=node('section',null,root,'tournament-group');
      node('h3',title+' ('+events.length+')',section,'tournament-group-title');
      groups[key]=section;
      if(!events.length)node('p',empty,section,'tournament-empty');
    }
    for(const event of list.events){
      const category=tournamentCategory(event,now);
      const row=node('details',null,groups[category],'tournament-event');
      const summary=node('summary',null,row,'tournament-row-summary');
      node('span',event.title,summary,'tournament-row-title');
      node('span',new Date(event.startsAt).toLocaleString(),summary,'tournament-row-date');
      node('span',category==='available'?event.fee+' '+event.asset:category==='finished'?'FINISHED':'CLOSED',summary,'tournament-kicker');
      const card=node('div',null,row,'tournament-row-details');
      if(event.objective)node('p',event.objective,card,'tournament-objective');
      if(event.description)node('p',event.description,card);
      const info=node('dl',null,card,'tournament-facts');
      for(const [label,value] of [['STARTS',new Date(event.startsAt).toLocaleString()],['ENTRY FEE',`${event.fee} ${event.asset}`],['REGISTERED',`${event.registered} / ${event.capacity}`],['REGISTRATION CLOSES',new Date(event.closesAt).toLocaleString()]]){node('dt',label,info);node('dd',value,info);}
      if(event.endsAt)node('p','Ends: '+new Date(event.endsAt).toLocaleString(),card);
      if(event.prizes?.length)node('p','Prizes: '+event.prizes.map((amount,i)=>`${i+1}${i===0?'st':i===1?'nd':i===2?'rd':'th'} — ${amount} USDC`).join(' · '),card);
      if(event.endsAt)node('p','Public matches only during the event window. Highest score wins; ties use the earliest score, then account ID. Survival counts your longest single life inside the window. USDC prizes are sent to your registration wallet; unfunded prizes stay queued.',card);
      for(const result of event.results||[]){
        node('p',`#${result.place} ${result.username} · Score ${result.score} · Prize ${result.state==='completed'?'paid':result.state==='review'?'under review':result.state==='failed'?'transfer failed':'queued'}`,card);
        if(result.state==='completed'&&result.signature){const link=node('a','View confirmed Solana transaction',card);link.href='https://explorer.solana.com/tx/'+encodeURIComponent(result.signature);link.target='_blank';link.rel='noopener noreferrer';}
      }
      const status=node('p','',card,'tournament-message');status.setAttribute('aria-live','polite');
      const entered=me?.entries.some(e=>e.tournament_id===event.id),open=category==='available';
      if(category==='finished'){node('p','This tournament has finished.',card);if(entered)node('p','You were registered for this tournament.',card,'tournament-confirmed');}
      else if(entered){node('div','✓ REGISTERED — PAYMENT CONFIRMED',card,'tournament-confirmed');node('p','Watch the Discord announcements for check-in and match instructions.',card);}
      else if(!open)node('p','Registration is closed.',card);
      else if(!me||!me.profile.solana_address)node('p','Complete your account requirements above to enter.',card);
      else if(!list.configured)node('p','Entry payments are not available yet.',card);
      else{
        const label=node('label',null,card,'tournament-consent'),confirm=node('input',null,label);confirm.type='checkbox';
        node('span',`I confirm the ${event.fee} ${event.asset} entry fee.${event.asset==='K'?' It will be deducted from my in-game balance.':' Network fees are separate.'}`,label);
        const pay=button('PAY ENTRY FEE',card,async()=>{
          if(!confirm.checked)return;
          try{const result=await api(`/api/tournaments/${event.id}/enter`,{confirm:true});await showPayment(result.order,card,status,current);}
          catch(e){status.textContent=e.message;}
        });pay.disabled=true;confirm.onchange=()=>{pay.disabled=!confirm.checked;};
      }
      if(me?.admin){
        button(event.announcementId?'ANNOUNCED IN DISCORD':'ANNOUNCE IN DISCORD',card,async()=>{try{await api('/api/tournaments/admin/announce',{id:event.id});status.textContent='Announcement posted.';}catch(e){status.textContent=e.message;}});
        button('VIEW REGISTRATIONS',card,async()=>{try{
          const report=await api(`/api/tournaments/admin/registrations?id=${event.id}`);
          card.querySelector('.tournament-report')?.remove();const reportBox=node('div',null,card,'tournament-report');
          node('h4','REGISTERED PLAYERS',reportBox);
          for(const entry of report.entries)node('p',`${entry.username} · ${entry.discord_name||'Discord not linked'} · ${entry.wallet}`,reportBox);
          if(!report.entries.length)node('p','No confirmed entries yet.',reportBox);
          for(const order of report.review)node('p',`PAYMENT REVIEW: ${order.id} · player ${order.user_id} · transaction ${order.signature}`,reportBox);
        }catch(e){status.textContent=e.message;}});
      }
    }
    if(me?.admin)adminForm(root);
  }catch(e){if(current===version){root.replaceChildren();node('p',e.message,root);}}
}
async function showPayment(order,card,status,current){
  card.querySelector('.tournament-payment')?.remove();
  const box=node('div',null,card,'tournament-payment');node('h4',`${order.amount} ${order.asset}`,box);
  if(order.status==='registered'){status.textContent='You are registered. Payment confirmed.';await openTournamentPanel();return;}
  if(order.status==='needs_review'){status.textContent='Payment needs organizer review. Do not pay again. Keep this order ID.';node('p',order.id,box);return;}
  if(order.paymentUrl){
    node('p','Scan with a Solana Pay wallet. Solana mainnet only.',box);
    const canvas=node('canvas',null,box);canvas.setAttribute('aria-label','Tournament entry payment QR code');
    const {default:QRCode}=await import('qrcode');if(current!==version)return;
    await QRCode.toCanvas(canvas,order.paymentUrl,{width:200,margin:2});
    button('COPY PAYMENT REQUEST',box,async()=>{try{await navigator.clipboard.writeText(order.paymentUrl);status.textContent='Payment request copied.';}catch{status.textContent='Scan the QR code with your Solana Pay wallet.';}});
    node('p',`Pay before ${new Date(order.expiresAt).toLocaleTimeString()}. Your place is confirmed only after payment verification.`,box);
    status.textContent='Waiting for confirmed payment…';
  }else status.textContent='This payment request expired. Do not pay it. Any earlier payment is still being checked.';
  node('small',`Order: ${order.id}`,box);
  const check=async()=>{if(current!==version||document.getElementById('panel-tournaments').classList.contains('hidden'))return;try{const result=await api(`/api/tournaments/orders/${order.id}`);await showPayment(result.order,card,status,current);}catch(e){status.textContent=e.message;poll=setTimeout(check,12000);}};
  clearTimeout(poll);poll=setTimeout(check,12000);
}
function adminForm(root){
  const details=node('details',null,root,'tournament-admin');node('summary','ORGANIZER TOOLS',details);
  const status=node('p','',details);status.setAttribute('aria-live','polite');
  button('REGISTER DISCORD COMMANDS',details,async()=>{try{await api('/api/tournaments/admin/discord-commands',{});status.textContent='Discord commands registered.';}catch(e){status.textContent=e.message;}});
  node('p','Create tournaments in Discord with /tournament. Choose Most Kills or Longest Survived in Survival, then set the entry fee in K, player limit, start time and registration deadline.',details);
}
