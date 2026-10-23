import * as THREE from 'three';
import { blinkDestination } from '../sim/MoveSim.js';
import { PLAYER_EYE_HEIGHT } from '../sim/MovementConfig.js';
import '../ui/teleport.css';

// A pooled destination outline, not an actor or light. It reads the same boxes
// as predicted/server movement and only raycasts while blink is being selected.
export class BlinkPreview {
  constructor(scene, marker) {
    this.scene = scene; this.marker = marker; this.valid = true;
    this.target = {}; this.pulse = 0;
    this.ray = new THREE.Ray(); this.from = new THREE.Vector3(); this.direction = new THREE.Vector3();
    this.raycaster = new THREE.Raycaster(undefined,undefined,.1,22);
    this.landing = new THREE.Vector3();
    this.material = new THREE.MeshBasicMaterial({color:0x85f2dd,transparent:true,opacity:.72,depthWrite:false});
    this.ring = new THREE.TorusGeometry(.43,.022,4,40);
    this.body = new THREE.CylinderGeometry(.30,.36,1.5,8,1,true);
    this.wire = new THREE.MeshBasicMaterial({color:0x85f2dd,transparent:true,opacity:.18,wireframe:true,depthWrite:false});
    this.group = new THREE.Group(); this.group.name = 'blink-destination-preview';
    const ring = new THREE.Mesh(this.ring,this.material);ring.rotation.x=Math.PI/2;ring.position.y=.06;this.group.add(ring);
    const body = new THREE.Mesh(this.body,this.wire);body.position.y=.83;this.group.add(body);
    this.group.visible=false;scene.add(this.group);
    marker.innerHTML='<span class="blink-reticle"></span><span class="blink-status"></span><span class="blink-hint">CLICK TO BLINK · Q / RIGHT CLICK TO CANCEL</span>';
    this.status=marker.querySelector('.blink-status');
  }

  measure(player, world, client) {
    if(client?.simWorld?.boxes && client.sim) {
      blinkDestination(client.sim,player.yaw,player.pitch,client.simWorld,this.target);
    } else {
      player.camera.getWorldPosition(this.from);player.camera.getWorldDirection(this.direction);
      this.ray.set(this.from,this.direction);
      // The legacy/offline controller uses render-mesh and box intersections.
      // Match that path when no authoritative simulation is connected.
      this.raycaster.ray.copy(this.ray);
      const hits=world.raycastMeshes?this.raycaster.intersectObjects(world.raycastMeshes,true):[];
      const hit=world.raycastBoxHit?.(this.ray,22) || (!world.raycastMeshes && world.raycastCollisionHit?.(this.ray,22));
      const blockedAt=Math.min(hits[0]?.distance??Infinity,hit?.distance??Infinity);
      const distance=Number.isFinite(blockedAt)?Math.max(.1,blockedAt-.9):22;
      this.target.x=this.from.x+this.direction.x*distance;
      this.target.z=this.from.z+this.direction.z*distance;
      this.target.y=Math.max(0,this.from.y+this.direction.y*distance-PLAYER_EYE_HEIGHT);
      this.landing.set(this.target.x,this.target.y,this.target.z);
      world.resolveCollisions?.(this.landing,.45);
      this.target.x=this.landing.x;this.target.y=this.landing.y;this.target.z=this.landing.z;
      this.target.distance=Math.hypot(this.target.x-player.position.x,this.target.y-player.position.y,this.target.z-player.position.z);
    }
    this.valid=Number.isFinite(this.target.distance)&&this.target.distance>=.8;
    return this.valid;
  }

  update(dt, armed, enabled = true) {
    this.pulse=Math.max(0,this.pulse-dt);
    this.group.visible=enabled&&(armed||this.pulse>0);
    if(armed) {
      this.group.position.set(this.target.x,this.target.y,this.target.z);
      this.group.scale.setScalar(1);
      this.material.color.setHex(this.valid?0x85f2dd:0xffad84);this.wire.color.copy(this.material.color);
      this.material.opacity=.72;this.wire.opacity=.18;
      this.marker.dataset.valid=String(this.valid);
      const text=this.valid?`BLINK · ${Math.round(this.target.distance)} m`:'PATH BLOCKED';
      if(this.status.textContent!==text)this.status.textContent=text;
    } else if(this.pulse>0) {
      this.group.scale.setScalar(1+(1-this.pulse/.35)*.45);
      this.material.opacity=this.pulse/.35*.5;this.wire.opacity=this.pulse/.35*.08;
    }
  }

  flash(position) {
    if(!position)return;
    this.group.position.copy(position);this.pulse=.35;
  }
  hide() {this.group.visible=false;this.pulse=0;}
  dispose(){this.scene.remove(this.group);this.ring.dispose();this.body.dispose();this.material.dispose();this.wire.dispose();}
}
