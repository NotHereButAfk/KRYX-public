"""Install a complete remodeled collection only after every export exists."""
import json, pathlib, shutil, hashlib, sys
sys.path.insert(0,str(pathlib.Path(__file__).parent))
from read_ev_asset import read_asset
ROOT=pathlib.Path(__file__).resolve().parents[3]
manifest_path=ROOT/'art/collection-remakes/catalog.json'
manifest=json.loads(manifest_path.read_text());items=manifest['items']
assert len(items)==357 and all(x['rarity']!='relic' for x in items)
out=ROOT/'artifacts/collection-remodeled'
missing=[x['sourceId'] for x in items if any(not (out/x['kryxId']/f).exists() for f in ['model.glb','model.blend','preview.png'])]
if missing:raise SystemExit('Incomplete collection; missing '+str(len(missing))+' exports: '+','.join(missing[:15]))
weapons={'Auto Rifle':'m4','Hand Cannon':'magnum','Burst Rifle':'battlerifle','Sweeper':'energyshotgun','Laser Rifle':'plasmarifle','Sword':'sword'}
chars=[];guns=[];swords=[];material_maps={}
def rgb(c):return sum(round(max(0,min(1,c[i]))*255)<<(16-i*8) for i in range(3))
for item in items:
    sid=item['sourceId'];slug=item['kryxId'];ischar=item['category']=='character'
    original=ROOT/'artifacts/collection-reference'/(sid+('.evskin' if ischar else '.evobj'));src=read_asset(original)
    if not ischar:material_maps[slug]={key:any(0<=m.get(key,-1)<len(src['textures']) for m in src['materials']) for key in ['map','emissiveMap']}
    colors=[m['color'][:3] for m in src['materials'] if max(m['color'][:3])>.12]
    primary=rgb(colors[0]) if colors else 0x607080
    energy=next((rgb(m['emissive']) for m in src['materials'] if max(m.get('emissive',[0,0,0]))>.1),0x5ed9ff)
    asset=f'/assets/{"player" if ischar else "weapon"}-skins/{slug}.glb'
    thumbnail=f'/assets/{"character" if ischar else "weapon"}-skins/{slug}.png'
    for source,dest in [('model.glb',ROOT/'public'/asset.lstrip('/')),('preview.png',ROOT/'public'/thumbnail.lstrip('/')),('model.blend',ROOT/'art/collection-remakes/scenes'/(slug+'.blend'))]:
        dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(out/slug/source,dest)
    skin={'id':slug,'name':item['referenceName']+' Reforged','rarity':item['rarity'],'collection':'Reforged Collection','model':asset,'thumbnail':thumbnail,'earningEnabled':False,'metalness':.25,'roughness':.54}
    if ischar:
        skin.update(primary=primary,secondary=0x101820,emissive=energy,emissiveIntensity=.65,shield=0,price={'common':20,'rare':30,'epic':40,'legendary':60}[item['rarity']]);chars.append(skin)
        if item['rarity']=='legendary':skin.update(animated=True,legendaryStyle=int(sid)%5,energyColor=energy)
    else:
        wid=weapons[item['weapon']];skin.update(weaponId=wid,body=primary,accent=energy,metal=primary,energyColor=energy)
        if item['rarity']=='legendary':
            style=int(sid)%5;skin.update(animated=True,legendaryStyle=style,theme=['fire','water','garden','toxic','neko'][style])
            if wid!='sword':skin['shootSound']='legendary:'+slug
        if wid=='sword':skin.update(blade=primary,guard=energy,grip=0x101820,fuller=energy);swords.append(skin)
        else:guns.append(skin)
    item.update(status='exported',model=asset,sourceSha256=hashlib.sha256(original.read_bytes()).hexdigest(),modelSha256=hashlib.sha256((out/slug/'model.glb').read_bytes()).hexdigest())
(ROOT/'art/collection-remakes/material-maps.json').write_text(json.dumps(material_maps,indent=2)+'\n')
module='// Blender-remodeled derivatives; source/rarity mapping: art/collection-remakes/catalog.json.\n'
for name,data in [('REMADE_CHARACTERS',chars),('REMADE_GUNS',guns),('REMADE_SWORDS',swords)]:module+='export const '+name+' = '+json.dumps(data,indent=2)+';\n'
(ROOT/'server/remadecollection.mjs').write_text(module)
manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
print('INSTALLED',len(chars),'characters',len(guns),'guns',len(swords),'swords')
