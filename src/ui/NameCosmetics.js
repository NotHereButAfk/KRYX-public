import {getAchievementReward,cleanNameCosmetics} from '../sim/AchievementCatalog.js';
const paths={star:'M32 10 38 24 54 25 42 36 46 52 32 43 18 52 22 36 10 25 26 24Z',swords:'M17 12 45 48M12 17 48 45M40 48 48 40M16 24 24 16',bolt:'M34 9 16 35 30 35 25 55 49 26 35 26Z',target:'M32 12A20 20 0 1 0 32 52A20 20 0 1 0 32 12M32 4V20M32 44V60M4 32H20M44 32H60',link:'M25 39 20 44A10 10 0 0 1 6 30L20 16A10 10 0 0 1 34 30M39 25 44 20A10 10 0 0 1 58 34L44 48A10 10 0 0 1 30 34M23 41 41 23',diamond:'M32 9 53 30 32 55 11 30ZM11 30H53M32 9 23 30 32 55 41 30Z',compass:'M32 8 44 44 8 32 32 8 56 32 32 56 8 32M32 8V56M8 32H56',crown:'M12 20 23 32 32 12 41 32 52 20 47 49H17ZM18 41H46',skull:'M16 38V24Q16 10 32 10T48 24V38L40 42V52H24V42ZM24 27V32M40 27V32M29 42H35',sun:'M32 18A14 14 0 1 0 32 46A14 14 0 1 0 32 18M32 4V12M32 52V60M4 32H12M52 32H60M12 12 18 18M46 46 52 52M12 52 18 46M46 18 52 12',flame:'M34 7Q45 21 40 29Q50 24 49 39Q48 54 32 55Q14 54 15 39Q15 27 26 20Q21 36 30 36Q39 32 34 7Z',blade:'M47 8 42 30 25 45 19 39 34 20ZM15 35 29 49M13 51 22 42'};
export function badgeSVG(reward) {
  const r=typeof reward==='string'?getAchievementReward(reward):reward;if(!r)return '';
  const n=3+(r.tier%7),points=Array.from({length:n},(_,i)=>{const a=i*Math.PI*2/n-Math.PI/2;return `${32+30*Math.cos(a)},${32+30*Math.sin(a)}`;}).join(' ');
  const marks=Array.from({length:r.tier},(_,i)=>`<circle cx="${12+i*4.4}" cy="59" r="1.3" fill="currentColor"/>`).join('');
  return `<svg viewBox="0 0 64 64" aria-hidden="true" style="color:${r.color}"><polygon points="${points}" fill="currentColor" fill-opacity=".12" stroke="currentColor" stroke-width="1.5"/><g transform="translate(8 8) scale(.75)" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[r.glyph]}"/></g>${marks}</svg>`;
}
export function renderNameCosmetics(element,name,raw) {
  const c=cleanNameCosmetics(raw),key=JSON.stringify([name,c]);if(element.dataset.identity===key)return;
  element.dataset.identity=key;element.replaceChildren();element.classList.add('identity-name');
  const badge=getAchievementReward(c.badge),title=getAchievementReward(c.title),style=getAchievementReward(c.style);
  if(badge){const b=document.createElement('span');b.className='identity-badge';b.innerHTML=badgeSVG(badge);b.title=badge.name;element.append(b);}
  const text=document.createElement('span');text.className=`identity-letters lettering-${style?.tier||0}`;
  const original=name || 'Player';
  text.textContent=style?.tier===6?original.replace(/[A-Za-z0-9]/g,c=>String.fromCodePoint(c.charCodeAt(0)+0xfee0)):
    style?.tier===10?original.replace(/[A-Za-z]/g,c=>String.fromCodePoint((c<='Z'?0x24b6:0x24d0)+c.toLowerCase().charCodeAt(0)-97)):original;
  text.setAttribute('aria-label',original);if(style)text.style.color=style.color;element.append(text);
  if(title){const t=document.createElement('small');t.className='identity-title';t.textContent=title.name;t.style.color=title.color;element.append(t);}
}
