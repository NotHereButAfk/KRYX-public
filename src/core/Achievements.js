import {achievementProgress} from '../sim/AchievementCatalog.js';
async function request(path='',data){
 const response=await fetch('/api/achievements'+path,{credentials:'same-origin',...(data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{})});
 const result=await response.json();if(!response.ok)throw new Error(result.error||'Achievements unavailable');return result;
}
export const Achievements={
 list(_username,state={}){return achievementProgress(state.stats,state.claimed);},
 load:()=>request(),claim:(_username,id)=>request('/claim',{id}),equip:(kind,id)=>request('/equip',{kind,id}),
};
