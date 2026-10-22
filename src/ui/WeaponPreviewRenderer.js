import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildWeaponModel } from '../weapons/WeaponModels.js';
import { applyWeaponSkin, animateWeaponSkin } from '../weapons/WeaponSkins.js';
import { applySwordSkin, animateSwordSkin } from '../weapons/SwordSkins.js';
import { disposeModel } from '../core/ModelResources.js';

// Lightweight dedicated Three.js renderer for the 3D skin-preview panel.
// Runs in its own RAF loop while the ARMORY tab is open.
export class WeaponPreviewRenderer {
  constructor(canvas) {
    this._canvas   = canvas;
    this._renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this._renderer.setSize(canvas.width, canvas.height);

    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0x0c1018);

    // subtle grid floor for depth reference
    const grid = new THREE.GridHelper(1.5, 10, 0x1a2230, 0x141c28);
    grid.position.y = -0.22;
    this._scene.add(grid);

    this._camera = new THREE.PerspectiveCamera(38, canvas.width / canvas.height, 0.01, 50);
    this._camera.position.set(0.38, 0.16, 0.58);
    this._camera.lookAt(0, 0, 0);

    // Lighting — the room environment is what makes the metallic gun finishes
    // read; punctual lights alone leave them near-black.
    const pmrem = new THREE.PMREMGenerator(this._renderer);
    this._scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = 1.15;
    this._scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(2, 3, 3);
    this._scene.add(key);
    const fill = new THREE.DirectionalLight(0x6080ff, 0.45);
    fill.position.set(-3, 0.5, 2);
    this._scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffe0b0, 0.3);
    rim.position.set(0, -2, -3);
    this._scene.add(rim);

    this._group   = null;
    this._isSword = false;
    this._skin    = null;
    this._t       = 0;
    this._raf     = null;
  }

  // Build (or rebuild) the preview model for the given weaponDef.
  loadWeapon(weaponDef) {
    if (this._group) {
      this._scene.remove(this._group);
      disposeModel(this._group);
    }
    const { group } = buildWeaponModel(weaponDef);
    group.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });

    // Center and fit the model
    const box = new THREE.Box3().setFromObject(group);
    const c   = box.getCenter(new THREE.Vector3());
    const sz  = box.getSize(new THREE.Vector3());
    group.position.sub(c);
    const maxDim = Math.max(sz.x, sz.y, sz.z);
    if (maxDim > 0) group.scale.setScalar(0.32 / maxDim);

    this._isSword = weaponDef.kind === 'melee';
    this._group   = group;
    this._skin    = null;
    this._scene.add(group);
  }

  // Apply (or preview) a skin on the current model without saving.
  // Route by catalog shape — the sword wears the shared gun catalog now;
  // only legacy sword-catalog entries carry .blade.
  previewSkin(skin) {
    if (!this._group || !skin) return;
    this._skin = skin;
    if (skin.blade !== undefined) applySwordSkin(this._group, skin);
    else                          applyWeaponSkin(this._group, skin);
  }

  start() {
    if (this._raf !== null) return;
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      this._t += 0.016;
      if (this._group) {
        this._group.rotation.y = this._t * 0.7;
        this._group.position.y = Math.sin(this._t * 1.3) * 0.016;
        // Drive animated skin if applicable
        if (this._skin?.animated) {
          if (this._skin.blade !== undefined) animateSwordSkin(this._group, this._skin, this._t);
          else                                animateWeaponSkin(this._group, this._skin, this._t);
        }
      }
      this._renderer.render(this._scene, this._camera);
    };
    loop();
  }

  stop() {
    if (this._raf !== null) { cancelAnimationFrame(this._raf); this._raf = null; }
  }

  resize(w, h) {
    this._renderer.setSize(w, h);
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
  }

  dispose() {
    this.stop();
    if (this._group) {
      disposeModel(this._group);
    }
    this._renderer.dispose();
  }
}
