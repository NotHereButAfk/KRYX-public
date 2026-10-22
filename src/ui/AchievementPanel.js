import { EAccount } from '../core/EAccount.js';
import {Achievements} from '../core/Achievements.js';
import {ACHIEVEMENT_REWARDS,getAchievementReward} from '../sim/AchievementCatalog.js';
import {badgeSVG,renderNameCosmetics} from './NameCosmetics.js';
import {UserAccount} from '../core/UserAccount.js';
import './achievements.css';
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
let generation=0;
export async function openAchievementPanel(username){
 const token=++generation,root=document.getElementById('ach-grid');if(!root)return;
 root.className='achievement-hub';root.replaceChildren(el('p','ach-status','Loading achievements…'));
 let state={stats:{},claimed:[],equipped:{}},signedIn=false,notice='',busy=false,tab='achievements',query='',filter='all',page=0;
 const displayName=UserAccount.getDisplayName(username)||'Your name';
 try{state=await Achievements.load();signedIn=true;}catch(error){notice=error.message;}
 if(token!==generation)return;
 const summary=el('div','ach-summary'),preview=el('div','ach-identity-preview'),slots=el('div','ach-slots'),status=el('p','ach-status');
 status.setAttribute('role','status');
 const toolbar=el('div','ach-toolbar'),tabs=el('div','ach-tabs'),search=el('input','ach-search'),select=el('select','ach-filter');
 search.type='search';search.placeholder='Search rewards or achievements';search.setAttribute('aria-label','Search achievements and rewards');
 select.setAttribute('aria-label','Filter achievements and rewards');
 toolbar.append(tabs,search,select);
 const results=el('div','ach-results'),pager=el('div','ach-pagination');
 root.replaceChildren(summary,preview,slots,status,toolbar,results,pager);
 const buttons=new Map();
 for(const [id,label]of [['achievements','Achievements'],['badge','Badges · 120'],['title','Titles · 120'],['style','Lettering · 120']]){
  const b=el('button','',label);b.type='button';b.onclick=()=>{tab=id;page=0;filter='all';fillFilters();draw();};tabs.append(b);buttons.set(id,b);
 }
 function fillFilters(){select.replaceChildren();for(const [value,label]of [['all','All'],['unlocked',tab==='achievements'?'Ready to claim':'Unlocked'],['locked','Locked'],...(tab==='achievements'?[['claimed','Claimed']]:[['equipped','Equipped']])]){const o=el('option','',label);o.value=value;select.append(o);}}
 search.oninput=()=>{query=search.value.toLowerCase().trim();page=0;draw();};select.onchange=()=>{filter=select.value;page=0;draw();};
 async function act(work,message){if(busy)return;busy=true;notice='Saving…';draw();try{state=await work();await EAccount.refresh();notice=message;}catch(e){notice=e.message;}finally{busy=false;if(token===generation)draw();}}
 function draw(){
  const list=Achievements.list(username,state),byId=new Map(list.map(a=>[a.id,a])),claimed=new Set(state.claimed),cosmeticClaims=new Set(state.cosmeticClaims||[]);
  document.getElementById('ach-done').textContent=list.filter(a=>a.complete).length;
  document.getElementById('ach-total').textContent=list.length;
  summary.textContent=`120 quests · K coin rewards · ${claimed.size} completed claims`;
  renderNameCosmetics(preview,displayName,state.equipped);
  slots.replaceChildren();for(const kind of ['badge','title','style']){const row=el('div','ach-slot');row.append(el('span','',`${kind==='style'?'Lettering':kind}: ${getAchievementReward(state.equipped[kind])?.name||'Default'}`));if(state.equipped[kind]){const clear=el('button','','Clear');clear.disabled=busy;clear.onclick=()=>act(()=>Achievements.equip(kind,null),'Slot cleared.');row.append(clear);}slots.append(row);}
  status.textContent=notice||'Earn progress in signed-in multiplayer matches, starting with this update. Complete quests to claim K coins. Previously unlocked cosmetics remain available.';
  for(const [id,b]of buttons){b.classList.toggle('active',id===tab);b.setAttribute('aria-pressed',String(id===tab));}
  let items=(tab==='achievements'?[...list]:ACHIEVEMENT_REWARDS.filter(r=>r.kind===tab)).sort((a,b)=>a.tier-b.tier);
  items=items.filter(item=>{const a=tab==='achievements'?item:byId.get(item.achievement),owned=tab==='achievements'?claimed.has(a.id):cosmeticClaims.has(a.id);return (!query||`${item.name} ${a.description} ${item.rarity}`.toLowerCase().includes(query))&&(filter==='all'||filter==='unlocked'&&(tab==='achievements'?a.complete&&!owned:owned)||filter==='locked'&&(tab==='achievements'?!a.complete:!owned)||filter==='claimed'&&owned||filter==='equipped'&&state.equipped[tab]===item.id);});
  const pages=Math.max(1,Math.ceil(items.length/18));page=Math.min(page,pages-1);results.replaceChildren();
  for(const item of items.slice(page*18,(page+1)*18)){
   const a=tab==='achievements'?item:byId.get(item.achievement),owned=tab==='achievements'?claimed.has(a.id):cosmeticClaims.has(a.id),card=el('article','reward-card');card.style.setProperty('--reward-color',item.color);
   const art=el('div','reward-art');
   if(tab==='achievements')art.textContent='K';
   else if(tab==='badge')art.innerHTML=badgeSVG(item);
   else renderNameCosmetics(art,tab==='title'?displayName:'KRYX',{[tab]:item.id});
   card.append(art,el('span','reward-rarity',`${item.rarity} · Tier ${item.tier}`),el('h3','',item.name),el('p','',a.description));
   if(tab==='achievements'){
    card.append(el('p','reward-bundle',`${a.coins.toLocaleString()} K coins`));
    const progress=el('progress');progress.max=a.goal;progress.value=Math.min(a.current,a.goal);progress.setAttribute('aria-label',a.description);card.append(progress,el('span','reward-progress',`${Math.min(a.current,a.goal).toLocaleString()} / ${a.goal.toLocaleString()}`));
   }
   const button=el('button','reward-action');button.type='button';button.disabled=busy||!signedIn;
   if(tab==='achievements'){button.textContent=owned?'Claimed':a.complete?`Claim ${a.coins} K`:'In progress';button.disabled||=owned||!a.complete;button.onclick=()=>act(()=>Achievements.claim(username,a.id),`${a.coins} K coins added to your balance.`);}
   else if(!owned){button.textContent='Legacy reward';button.disabled=true;}
   else{button.textContent=state.equipped[tab]===item.id?'Equipped':'Equip';button.disabled||=state.equipped[tab]===item.id;button.onclick=()=>act(()=>Achievements.equip(tab,item.id),`${item.name} equipped.`);}
   card.append(button);results.append(card);
  }
  if(!items.length)results.append(el('p','ach-empty','No rewards match these filters.'));
  pager.replaceChildren();const prev=el('button','','Previous'),next=el('button','','Next');prev.disabled=page===0;next.disabled=page>=pages-1;prev.onclick=()=>{page--;draw();};next.onclick=()=>{page++;draw();};pager.append(prev,el('span','',`${page+1} / ${pages} · ${items.length} results`),next);
 }
 fillFilters();draw();
 async function refresh(){
  if(token!==generation||!root.isConnected||root.querySelector('.ach-results')!==results)return;
  if(!busy&&!document.hidden&&root.getClientRects().length){
   try{const next=await Achievements.load();if(!busy&&token===generation){state=next;signedIn=true;draw();}}catch{/* Keep the last confirmed progress on temporary connection loss. */}
  }
  if(token===generation)setTimeout(refresh,5000);
 }
 setTimeout(refresh,5000);
}
