import {TOURNAMENT_TYPES} from './tournament-types.mjs';
const label=(text,component)=>({type:18,label:text,component});
const select=(id,options)=>({type:3,custom_id:id,options:options.map(([label,value])=>({label,value:String(value)})),min_values:1,max_values:1});
const input=(id,placeholder,max_length=80,style=1)=>({type:4,custom_id:id,style,placeholder,max_length,required:true});
export const ZONES=['America/New_York','America/Chicago','America/Denver','America/Los_Angeles','UTC','Europe/London','Europe/Berlin','Asia/Singapore','Australia/Sydney'];
export function scheduleModal(id,now){
  const today=new Date(now).toISOString().slice(0,10);
  const days=Array.from({length:25},(_,i)=>{const d=new Date(Date.parse(today+'T12:00:00Z')+i*86400000);return [d.toLocaleDateString('en-US',{timeZone:'UTC',weekday:'short',month:'short',day:'numeric'}),d.toISOString().slice(0,10)];});
  return {type:9,data:{custom_id:'tournament:schedule:'+id,title:'Tournament — day & time',components:[
    label('Day (next 25 days)',select('day',days)),
    label('Hour',select('hour',Array.from({length:24},(_,i)=>[(i%12||12)+' '+(i<12?'AM':'PM'),i]))),
    label('Minute',select('minute',Array.from({length:12},(_,i)=>[String(i*5).padStart(2,'0'),i*5]))),
    label('Timezone',select('zone',ZONES.map(z=>[z.replaceAll('_',' '),z])))
  ]}};
}
export function detailsModal(id){return {type:9,data:{custom_id:'tournament:details:'+id,title:'Tournament — details',components:[
  label('Tournament type',select('type',Object.entries(TOURNAMENT_TYPES).map(([id,t])=>[t.title,id]))),
  label('Entry fee (in-game K)',input('fee','100',12)),
  label('Player limit',select('players',[[2,2],[4,4],[8,8],[16,16],[32,32],[64,64],[128,128]])),
  label('Registration closes before start',select('deadline',[['5 minutes',5],['15 minutes',15],['30 minutes',30],['1 hour',60],['2 hours',120],['1 day',1440]])),
  label('Match and check-in instructions',{...input('instructions','Where to meet and how the matches work',1200,2),required:false})
]}};}
export function modalValues(data){const values={};for(const row of data.components||[]){for(const c of row.component?[row.component]:row.components||[]){if(c.custom_id)values[c.custom_id]=c.value??c.values?.[0];}}return values;}
export function scheduledInstant(v){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(v.day||'')||!ZONES.includes(v.zone)||!/^\d{1,2}$/.test(v.hour||'')||!/^\d{1,2}$/.test(v.minute||'')||Number(v.hour)>23||Number(v.minute)>59)throw Error('Choose a valid day, time and timezone.');
  const wanted=v.day+'T'+String(v.hour).padStart(2,'0')+':'+String(v.minute).padStart(2,'0');
  const base=Date.parse(wanted+':00Z');let value=base;
  const local=t=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:v.zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(t).map(p=>[p.type,p.value]));return p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute;};
  for(let i=0;i<4;i++)value+=base-Date.parse(local(value)+':00Z');
  if(!Number.isFinite(value)||local(value)!==wanted)throw Error('That local time does not exist because the clocks change. Pick a different time.');
  return new Date(value).toISOString();
}
export function draftMessage(id,text,actions){return {type:4,data:{content:text,flags:64,allowed_mentions:{parse:[]},components:[{type:1,components:actions.map(([action,label,style=1])=>({type:2,custom_id:'tournament:'+action+':'+id,label,style}))}]}};}

export function prizesModal(id){return {type:9,data:{custom_id:'tournament:prizes:'+id,title:'Tournament — duration & prizes',components:[
 label('Duration in minutes (5–1440)',input('duration','60',4)),
 label('USDC prizes: 1st, 2nd, 3rd, … (up to 10)',input('prizes','20, 10, 5',200))
]}};}
