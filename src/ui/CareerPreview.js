import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { preloadEvCharacter } from '../player/EvCharacter.js';
import { preloadAuthoredSkin } from '../player/AuthoredSkins.js';
import { buildPreviewCharacter } from '../player/PreviewCharacter.js';
import { disposeModel } from '../core/ModelResources.js';

// Render the gameplay character without replacing its authored scale or posing
// its bones with the retired mannequin rig.
export class CareerPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment()).texture;
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x394456, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2);
    key.position.set(3, 4, 4); this.scene.add(key);
    this.camera = new THREE.PerspectiveCamera(34, 1, .01, 40);
    this.revision = 0; this.raf = null;
  }
  async loadArmor(skin, armor, finish) {
    const revision = ++this.revision;
    await Promise.all([preloadEvCharacter(), preloadAuthoredSkin(finish)]);
    if (revision !== this.revision) return;
    if (this.model) { this.scene.remove(this.model); disposeModel(this.model); }
    const model = buildPreviewCharacter(skin, armor, finish);
    this.model = model; this.scene.add(model);
    await model.userData.skinReady;
    if (revision !== this.revision) return;
    model.userData.setMotion?.('idle');
    model.userData.mixer?.update(0);
    this.height = model.userData.standHeight || 1.82;
    model.rotation.y = Math.PI + .16;
    this.render(0);
  }
  render(dt) {
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    const bodyHeight = this.height || 1.82;
    const distance = Math.max(bodyHeight / (2 * Math.tan(THREE.MathUtils.degToRad(17))),
      .85 / (2 * Math.tan(THREE.MathUtils.degToRad(17)) * this.camera.aspect)) * 1.22;
    this.camera.position.set(0, bodyHeight * .54, distance);
    this.camera.lookAt(0, bodyHeight * .51, 0);
    this.camera.updateProjectionMatrix();
    this.model?.userData.mixer?.update(dt);
    this.model?.userData.armorTick?.(dt);
    this.renderer.render(this.scene, this.camera);
  }
  start() {
    if (this.raf !== null) return;
    let previous = performance.now();
    const tick = now => {
      this.raf = requestAnimationFrame(tick);
      this.render(Math.min(.05, (now - previous) / 1000)); previous = now;
    };
    this.raf = requestAnimationFrame(tick);
  }
  stop() { cancelAnimationFrame(this.raf); this.raf = null; }
}

// Inventory uses the same asset, materials and pose as the career viewer.
const portraits = new Map();
export function characterPortrait(skin, armor = 'vanguard', finish = null) {
  const key = [skin?.id, armor, finish?.id].join(':');
  if (!portraits.has(key)) portraits.set(key, (async () => {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;left:-1000px;width:256px;height:320px';
    document.body.appendChild(canvas);
    let preview;
    try {
      preview = new CareerPreview(canvas);
      await preview.loadArmor(skin, armor, finish);
      preview.render(0);
      return canvas.toDataURL('image/png');
    } finally {
      if (preview?.model) disposeModel(preview.model);
      preview?.scene.environment?.dispose();
      preview?.renderer.dispose();
      canvas.remove();
    }
  })().catch(error => { portraits.delete(key); throw error; }));
  return portraits.get(key);
}
