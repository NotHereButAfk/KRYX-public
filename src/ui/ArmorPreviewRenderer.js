import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildPreviewCharacter } from '../player/PreviewCharacter.js';
import { isSharedGeometry } from '../player/LowPolyModels.js';

// The cyborg chassis share their geometry between every body in the game, so
// tearing down the preview must not free it — swapping armour in the loadout
// would otherwise empty the player's own model and every bot's.
function _release(group) {
  group.traverse((o) => {
    if (!o.isMesh) return;
    if (!isSharedGeometry(o.geometry)) o.geometry.dispose();
    o.material.dispose();
  });
}

// Dedicated Three.js renderer for the loadout panel's live armor preview.
// Shows the full character (selected player skin + armor type + armor finish)
// rotating on a small turntable. Runs its own RAF loop while LOADOUT is open.
export class ArmorPreviewRenderer {
  constructor(canvas) {
    this._canvas   = canvas;
    this._renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    // updateStyle=false: keep the CSS width:100% so the canvas fits its column
    // (the drawing buffer stays crisp at the canvas's intrinsic resolution).
    this._renderer.setSize(canvas.width, canvas.height, false);
    this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = 1.05;

    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0x0a0e16);

    // image-based lighting so the metal/emissive armor reads correctly
    const pmrem = new THREE.PMREMGenerator(this._renderer);
    this._scene.environment = pmrem.fromScene(new RoomEnvironment(0.5)).texture;
    pmrem.dispose();

    // sci-fi turntable disc + glow ring under the figure
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.95, 1.05, 0.06, 40),
      new THREE.MeshStandardMaterial({ color: 0x0e1622, roughness: 0.5, metalness: 0.6 })
    );
    disc.position.y = -0.03;
    this._scene.add(disc);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.96, 1.08, 48),
      new THREE.MeshBasicMaterial({ color: 0x00cfff, transparent: true, opacity: 0.6, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.012;
    this._scene.add(ring);

    this._camera = new THREE.PerspectiveCamera(34, canvas.width / canvas.height, 0.01, 50);

    this._scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(2.5, 4, 3);
    this._scene.add(key);
    const fill = new THREE.DirectionalLight(0x40a0ff, 0.6);
    fill.position.set(-3, 1, 2);
    this._scene.add(fill);
    const rim = new THREE.DirectionalLight(0x00cfff, 0.7);
    rim.position.set(0, 2, -3);
    this._scene.add(rim);

    this._group = null;
    this._t     = 0;
    this._raf   = null;
  }

  // Build (or rebuild) the character for the given player skin + armor.
  loadArmor(playerSkin, armorTypeId, armorSkin) {
    if (this._group) {
      this._scene.remove(this._group);
      _release(this._group);
      this._group = null;
    }
    // Use the same rigged, skinnable model the match uses. The old static
    // white Spartan preview ignored equipped finishes and made every character
    // skin look identical in the loadout.
    const g = buildPreviewCharacter(playerSkin, armorTypeId, armorSkin);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });

    // center horizontally, sit feet on the disc, frame the whole body.
    const targetH = 2.3;
    let cx, cz, feetY, height;
    if (g.userData?.isHuman) {
      // Re-measuring the posed SkinnedMesh here collapses to a degenerate box;
      // use the metrics cached at build time instead.
      cx = g.userData.centerX; cz = g.userData.centerZ;
      feetY = g.userData.feetY; height = g.userData.standHeight;
    } else {
      g.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(g);
      const c   = box.getCenter(new THREE.Vector3());
      const sz  = box.getSize(new THREE.Vector3());
      cx = c.x; cz = c.z; feetY = box.min.y; height = sz.y;
    }
    g.position.x -= cx;
    g.position.z -= cz;
    g.position.y -= feetY; // feet on disc
    const s = height > 0 ? targetH / height : 1;
    g.scale.setScalar(s);

    // Present connected arena bodies as living warriors instead of an export
    // bind pose. This only affects the loadout mannequin; gameplay animation
    // and rifle IK still own these bones in a match.
    const rig = g.userData?.rig;
    if (rig) {
      // EV's default presentation is a relaxed combat-ready human pose, not a
      // bind-pose mannequin: shoulders open, elbows bent forward and palms
      // turned slightly inward.  Besides feeling alive, this makes the single
      // connected bicep/forearm surface visible instead of letting straight
      // arms read as stacked robot segments.
      if (rig.armL) { rig.armL.rotation.x = -0.12; rig.armL.rotation.z = -0.40; }
      if (rig.armR) { rig.armR.rotation.x = -0.12; rig.armR.rotation.z = 0.40; }
      if (rig.elbowL) { rig.elbowL.rotation.x = -0.82; rig.elbowL.rotation.z = -0.08; }
      if (rig.elbowR) { rig.elbowR.rotation.x = -0.82; rig.elbowR.rotation.z = 0.08; }
      const bones = g.userData?.bones;
      if (bones?.handL) { bones.handL.rotation.x = 0.14; bones.handL.rotation.y = -0.16; }
      if (bones?.handR) { bones.handR.rotation.x = 0.14; bones.handR.rotation.y = 0.16; }
      // A planted shoulder-width stance exposes the black inner-thigh gap and
      // keeps the shin armour from merging into one central column on screen.
      if (rig.legL) { rig.legL.rotation.x = 0.035; rig.legL.rotation.z = -0.085; }
      if (rig.legR) { rig.legR.rotation.x = 0.075; rig.legR.rotation.z = 0.085; }
      if (rig.kneeL) rig.kneeL.rotation.x = -0.10;
      if (rig.kneeR) rig.kneeR.rotation.x = -0.14;
      if (rig.ankleL) rig.ankleL.rotation.z = 0.085;
      if (rig.ankleR) rig.ankleR.rotation.z = -0.085;
      if (rig.head) rig.head.rotation.y = -0.035;
      this._idleRig = rig;
      this._idleBase = {
        chestX: rig.chest?.rotation.x || 0,
        spineX: rig.spine?.rotation.x || 0,
        headY: rig.head?.rotation.y || 0,
        armLX: rig.armL?.rotation.x || 0,
        armRX: rig.armR?.rotation.x || 0,
        elbowLX: rig.elbowL?.rotation.x || 0,
        elbowRX: rig.elbowR?.rotation.x || 0,
      };
    } else {
      this._idleRig = null;
      this._idleBase = null;
    }

    this._group = g;
    this._baseYaw = g.rotation.y + Math.PI;
    this._scene.add(g);

    // frame the full body with a little headroom/legroom
    const midY = targetH * 0.5;
    this._camera.position.set(0.0, midY + 0.15, 4.3);
    this._camera.lookAt(0, midY, 0);
    this._lookY = midY;
  }

  start() {
    if (this._raf !== null) return;
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      this._t += 0.016;
      if (this._group) {
        // Keep the soldier facing the player like EV.IO's loadout mannequin;
        // a restrained presentation sway shows the model without turning its
        // back while the user is choosing a skin.
        this._group.rotation.y = (this._baseYaw || 0) + Math.sin(this._t * 0.45) * 0.22;
        // Subtle breath and asymmetric weight transfer. Keep the amplitudes
        // below gameplay animation values: this is an alive idle, not a looped
        // dance, and it must never fight weapon carry in the match.
        if (this._idleRig && this._idleBase) {
          const r = this._idleRig, b = this._idleBase;
          const breath = Math.sin(this._t * 1.45);
          const weight = Math.sin(this._t * 0.72 + 0.8);
          if (r.chest) r.chest.rotation.x = b.chestX + breath * 0.012;
          if (r.spine) r.spine.rotation.x = b.spineX - breath * 0.006;
          if (r.head) r.head.rotation.y = b.headY + weight * 0.025;
          if (r.armL) r.armL.rotation.x = b.armLX - breath * 0.010;
          if (r.armR) r.armR.rotation.x = b.armRX - breath * 0.010;
          if (r.elbowL) r.elbowL.rotation.x = b.elbowLX + weight * 0.018;
          if (r.elbowR) r.elbowR.rotation.x = b.elbowRX - weight * 0.018;
        }
        // Drive the rigged human soldier's idle animation on the turntable.
        const ud = this._group.userData;
        if (ud?.isHuman) { ud.setMotion('idle'); ud.mixer.update(0.016); ud.armorTick?.(0.016); }
      }
      this._renderer.render(this._scene, this._camera);
    };
    loop();
  }

  stop() {
    if (this._raf !== null) { cancelAnimationFrame(this._raf); this._raf = null; }
  }

  dispose() {
    this.stop();
    if (this._group) {
      _release(this._group);
    }
    this._renderer.dispose();
  }
}
