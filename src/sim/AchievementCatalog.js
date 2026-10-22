// Shared, immutable reward definitions. No cash value or combat advantages.
const ranks = ['Spark','Scout','Adept','Vanguard','Knight','Warden','Champion','Oracle','Sovereign','Eternal'];
const tiers = ['Common','Common','Uncommon','Uncommon','Rare','Rare','Epic','Epic','Legendary','Mythic'];
const track = (id,name,noun,color,glyph,steps) => ({id,name,noun,color,glyph,steps});
export const ACHIEVEMENT_TRACKS = [
  track('kills','Starfire','eliminations','#ffb45b','star',[1,10,25,75,150,350,750,1500,3500,7500]),
  track('humanKills','Duelist','player eliminations','#ff708b','swords',[1,5,15,30,75,150,300,600,1200,2500]),
  track('botKills','Circuitbreaker','arena bot eliminations','#5cddff','bolt',[1,10,30,80,200,400,800,1600,3200,6400]),
  track('headshots','Deadeye','headshot eliminations','#b79aff','target',[1,5,15,40,100,200,400,800,1600,3200]),
  track('assists','Bondkeeper','assists','#83e8be','link',[1,5,15,40,100,200,400,800,1600,3200]),
  track('score','Auric','combat score','#ffd36a','diamond',[100,1000,5000,15000,40000,100000,250000,600000,1500000,3000000]),
  track('games','Wayfarer','completed active matches','#84b7ff','compass',[1,3,10,25,50,100,200,400,750,1500]),
  track('wins','Crownkeeper','Deathmatch victories','#ff93de','crown',[1,3,5,10,25,50,100,200,400,800]),
  track('zombies','Nightwarden','zombie eliminations','#adf273','skull',[5,25,75,200,500,1200,3000,7000,15000,30000]),
  track('waves','Dawnrunner','Survival waves survived','#ff9876','sun',[1,5,15,30,60,120,250,500,1000,2000]),
  track('bestStreak','Unbroken','kills in one life','#e2b4ff','flame',[2,3,5,7,10,15,20,30,40,50]),
  track('swordKills','Bladedancer','sword eliminations','#94f5e6','blade',[1,5,15,40,100,200,400,800,1600,3200]),
];
export const ACHIEVEMENT_CATALOG = ACHIEVEMENT_TRACKS.flatMap(t => t.steps.map((goal,i) => ({
  id:`${t.id}-${i+1}`,stat:t.id,goal,name:`${t.name} ${ranks[i]}`,tier:i+1,rarity:tiers[i],
  description:`${goal.toLocaleString('en-US')} ${goal===1?t.noun.replace('eliminations','elimination').replace('assists','assist').replace('matches','match').replace('victories','victory').replace('waves','wave'):t.noun}`,color:t.color,glyph:t.glyph,
  coins: [25,50,75,100,150,200,300,400,600,1000][i],
  rewards:['badge','title','style'].map(kind=>`${kind}:${t.id}-${i+1}`),
})));
export const ACHIEVEMENT_REWARDS = ACHIEVEMENT_CATALOG.flatMap(a => ['badge','title','style'].map(kind=>({
  id:`${kind}:${a.id}`,achievement:a.id,kind,name:kind==='style'?`${a.name} lettering`:a.name,
  color:a.color,glyph:a.glyph,tier:a.tier,rarity:a.rarity,
})));
const byId=new Map(ACHIEVEMENT_REWARDS.map(r=>[r.id,r]));
export const getAchievementReward = id => byId.get(id) || null;
export function achievementProgress(stats={},claimed=[]) {
  const unlocked=new Set(claimed);
  return ACHIEVEMENT_CATALOG.map(a=>{const current=Math.max(0,Number(stats[a.stat])||0);return {...a,current,progress:Math.min(1,current/a.goal),complete:current>=a.goal,claimed:unlocked.has(a.id)};});
}
export function cleanNameCosmetics(value={}) {
  return Object.fromEntries(['badge','title','style'].map(kind=>[kind,getAchievementReward(value?.[kind])?.kind===kind?value[kind]:null]));
}
