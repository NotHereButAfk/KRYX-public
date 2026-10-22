// Original, deterministic artwork. Large motifs remain readable on gun shell UVs.
export function themedWrap(theme, premium=false) {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
  const c=canvas.getContext('2d');
  const palettes={fire:['#261016','#ff5829','#ffe5a1'],water:['#092c49','#21bed1','#d1fcff'],garden:['#152c24','#77c978','#ffd4eb'],toxic:['#141d23','#b1f22a','#edff92'],neko:['#302544','#e1a4e8','#bdf7ff']};
  const [base,color,light]=palettes[theme];
  c.fillStyle=base;c.fillRect(0,0,512,512);
  c.lineCap='round';c.lineJoin='round';
  const path=(draw,fill,stroke,width=3)=>{c.beginPath();draw();if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=width;c.stroke();}};
  for(let row=-1;row<4;row++)for(let col=-1;col<4;col++){
    c.save();c.translate(col*192+(row%2)*96,row*192);
    if(theme==='fire'){
      path(()=>{c.moveTo(20,170);c.bezierCurveTo(-15,95,80,110,68,15);c.bezierCurveTo(145,75,80,88,138,117);c.bezierCurveTo(182,177,82,202,20,170);},color);
      path(()=>{c.moveTo(55,171);c.quadraticCurveTo(31,136,88,89);c.quadraticCurveTo(70,135,113,142);c.quadraticCurveTo(130,184,55,171);},light);
      for(let i=0;i<7;i++){c.fillStyle=i%2?color:light;c.fillRect((i*37)%180,15+(i*23)%95,3,8);}
    }else if(theme==='water'){
      for(let i=0;i<4;i++)path(()=>{c.moveTo(-30,35+i*34);c.bezierCurveTo(35,-10+i*34,76,92+i*34,156,28+i*34);c.quadraticCurveTo(192,4+i*34,218,32+i*34);},null,i%2?light:color,i===0?11:4);
      for(let i=0;i<5;i++)path(()=>c.arc(22+i*33,17+(i%3)*48,3+(i%2)*3,0,Math.PI*2),null,light,2);
    }else if(theme==='garden'){
      path(()=>{c.moveTo(10,190);c.bezierCurveTo(130,130,15,80,150,0);},null,color,6);
      for(let i=0;i<5;i++){const x=55+(i%2)*30,y=25+i*29;path(()=>{c.moveTo(x,y);c.quadraticCurveTo(x-48,y-25,x-45,y+14);c.quadraticCurveTo(x-15,y+24,x,y);},color);path(()=>{c.moveTo(x,y);c.quadraticCurveTo(x+48,y-25,x+45,y+14);c.quadraticCurveTo(x+15,y+24,x,y);},'#408653');}
      for(let i=0;i<5;i++){c.save();c.translate(115,105);c.rotate(i*Math.PI*2/5);path(()=>c.ellipse(0,15,10,20,0,0,Math.PI*2),light);c.restore();}path(()=>c.arc(115,105,8,0,Math.PI*2),'#ffc95e');
    }else if(theme==='toxic'){
      c.save();c.translate(90,92);for(let i=0;i<3;i++){c.rotate(Math.PI*2/3);path(()=>c.arc(0,-26,24,.15,Math.PI*1.85),null,color,10);}path(()=>c.arc(0,0,9,0,Math.PI*2),light);c.restore();
      for(let i=0;i<4;i++)path(()=>c.arc(15+i*43,153+(i%2)*17,5+i%3,0,Math.PI*2),null,color,3);
      c.fillStyle=light;c.save();c.translate(0,0);c.rotate(-.4);for(let i=0;i<5;i++)c.fillRect(i*30,-5,14,12);c.restore();
    }else{
      // Non-explicit anime cat-eared portrait: face, hair, collar, and star insignia.
      path(()=>{c.moveTo(25,78);c.lineTo(20,14);c.lineTo(65,43);c.quadraticCurveTo(95,20,121,44);c.lineTo(162,15);c.lineTo(155,83);c.lineTo(145,148);c.lineTo(35,148);c.closePath();},color,light,3);
      path(()=>c.ellipse(90,91,47,55,0,0,Math.PI*2),'#ffe5d9');
      path(()=>{c.moveTo(39,85);c.quadraticCurveTo(35,20,112,39);c.quadraticCurveTo(161,38,143,103);c.lineTo(119,70);c.lineTo(105,87);c.lineTo(88,58);c.lineTo(59,87);c.closePath();},'#8e6bb5');
      for(const x of [69,115]){path(()=>c.ellipse(x,97,8,12,0,0,Math.PI*2),'#27354e');path(()=>c.arc(x+2,93,3,0,Math.PI*2),light);}
      path(()=>{c.moveTo(82,122);c.quadraticCurveTo(91,129,101,122);},null,'#b36287',2);
      path(()=>{c.moveTo(39,170);c.lineTo(55,143);c.lineTo(90,154);c.lineTo(125,143);c.lineTo(143,170);},'#293c59',light,3);
      path(()=>{c.moveTo(90,145);c.lineTo(75,157);c.lineTo(90,164);c.lineTo(105,157);c.closePath();},color);
    }
    if(premium){
      c.globalAlpha=.8;path(()=>{c.moveTo(4,42);c.lineTo(4,4);c.lineTo(43,4);},null,'#f7db93',2);
      c.globalAlpha=1;path(()=>{c.moveTo(165,30);c.lineTo(170,42);c.lineTo(182,47);c.lineTo(170,52);c.lineTo(165,64);c.lineTo(160,52);c.lineTo(148,47);c.lineTo(160,42);c.closePath();},light);
    }
    c.restore();
  }
  return canvas;
}
