// Presentation-only mass response. World velocity drives acceleration; looking
// around without travelling never fabricates sideways acceleration.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function createBodyDynamics(){
  const out={pitch:0,roll:0,twist:0,drop:0};
  let vx=0,vz=0,lastYaw=null,grounded=true,fall=0;
  const springs={pitch:[0,0],roll:[0,0],twist:[0,0],drop:[0,0]};
  function reset(){vx=vz=fall=0;lastYaw=null;grounded=true;for(const k of Object.keys(springs)){springs[k]=[0,0];out[k]=0;}}
  function step(input,dt){
    if(!(dt>0))return out;
    if(dt>.2){reset();return out;}
    const yaw=input.yaw||0,c=Math.cos(yaw),s=Math.sin(yaw),alpha=1-Math.exp(-10*dt);
    const nx=vx+(clamp(input.vx||0,-25,25)-vx)*alpha,nz=vz+(clamp(input.vz||0,-25,25)-vz)*alpha;
    const ax=(nx-vx)/dt,az=(nz-vz)/dt;vx=nx;vz=nz;
    const forward=-(s*ax+c*az),right=c*ax-s*az;
    const turn=lastYaw===null?0:Math.atan2(Math.sin(yaw-lastYaw),Math.cos(yaw-lastYaw))/dt;
    lastYaw=yaw;
    if(!input.grounded)fall=Math.max(fall,-(input.vy||0));
    if(input.grounded&&!grounded){springs.drop[1]-=clamp(fall*.035,0,.4);springs.pitch[1]-=clamp(fall*.045,0,.45);fall=0;}
    grounded=!!input.grounded;
    const targets={pitch:grounded?clamp(-forward*.0025,-.065,.065):0,
      roll:grounded?clamp(right*.0017,-.04,.04):0,
      twist:grounded?clamp(-turn*.008,-.025,.025):0,drop:0};
    const steps=Math.max(1,Math.ceil(dt*120)),h=dt/steps;
    for(const key of Object.keys(springs)){
      const spring=springs[key],w=key==='drop'?15:12;
      for(let i=0;i<steps;i++){spring[1]+=((targets[key]-spring[0])*w*w-2*w*spring[1])*h;spring[0]+=spring[1]*h;}
      out[key]=spring[0];
    }
    return out;
  }
  return {step,reset,value:out};
}
