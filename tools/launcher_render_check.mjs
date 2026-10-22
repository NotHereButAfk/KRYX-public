import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let app, browser;
try {
  app = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)),
    server: { host: '127.0.0.1', port: 0, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] } });
  await app.listen();
  browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--no-sandbox', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__launcher_probe', route => route.fulfill({ contentType: 'text/html',
    body: '<html><body style="margin:0;background:#171c24"></body></html>' }));
  await page.goto(`${app.resolvedUrls.local[0]}__launcher_probe`);
  const result = await page.evaluate(async (baseline) => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { WeaponSystem } = await import('/src/weapons/WeaponSystem.js');
    const models = await import('/src/weapons/WeaponModels.js');
    const { PickupSystem } = await import('/src/world/PickupSystem.js');
    const fx = await import('/src/effects/ExplosionEffect.js');
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x171c24);
    const camera = new THREE.PerspectiveCamera(78, 1280 / 720, .02, 300);
    scene.add(camera, new THREE.HemisphereLight(0xffffff, 0x5c6070, 2));
    const audio = new Proxy({}, { get: () => () => {} });
    const ws = new WeaponSystem(camera, scene, audio);
    const pickup = new PickupSystem(scene, [], { onPickupRequest() {}, lootPads: [
      { padId: 1, lootType: 'weapon', gunId: 'concussion', x: -1.2, y: -.8, z: -3.5, active: true },
    ] });
    const oldSource = pickup._pickups[0]._spin.children[0].userData.modelSource;
    await new Promise(resolve => { models.onWeaponModelsReady(resolve); models.preloadWeaponModels(); });
    ws.addMapGun('concussion');
    ws.switchTo(ws.loadout.findIndex(w => w.id === 'concussion'));
    const held = ws.models.get('concussion').group;
    const ground = pickup._pickups[0]._spin.children[0];
    const geometries = group => { const set = new Set(); group.traverse(o => { if (o.isMesh) set.add(o.geometry); }); return set; };
    const buffers = geometries(held);
    let disposed = 0;
    buffers.forEach(g => g.addEventListener('dispose', () => disposed++));
    const sameGeometry = [...geometries(ground)].every(g => buffers.has(g));
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1280, 720);
    document.body.append(renderer.domElement);
    const world = { _hemisphere: scene.children.find(o => o.isHemisphereLight) };
    const input = { mouseDown: false, rightMouseDown: false, mouseDX: 0, mouseDY: 0, wheelDelta: 0,
      isDown: () => false, consumeJustPressed: () => false };
    const player = { velocity: new THREE.Vector3(), onGround: true, pitch: 0, yaw: 0, health: 100,
      camera, _camDist: 0, isDead: false, baseFov: 78 };
    for (let i = 0; i < 90; i++) ws.update(1 / 60, input, world, { getRaycastTargets: () => [] }, player);
    renderer.render(scene, camera);
    ws.renderViewmodel(renderer, world);
    const view = { oldSource, heldSource: held.userData.modelSource, groundSource: ground.userData.modelSource,
      sameGeometry, heldParts: buffers.size, trigger: held.userData.authoredHandPose.trigger };

    function profile(module) {
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight());
      module.prepareExplosionLights?.(scene);
      const ground = new THREE.Mesh(new THREE.BoxGeometry(20, .2, 20), new THREE.MeshStandardMaterial({ color: 0x888888 }));
      ground.position.set(0, -1, -5); scene.add(ground);
      const camera = new THREE.PerspectiveCamera(70, 1, .1, 50);
      camera.position.set(0, 2, 5); camera.lookAt(0, 0, -2);
      const renderer = new THREE.WebGLRenderer(); renderer.setSize(256, 256);
      const render = () => { const start = performance.now(); renderer.render(scene, camera); renderer.getContext().finish(); return performance.now() - start; };
      render(); render();
      const lit = () => renderer.properties.get(ground.material).currentProgram.id;
      const before = lit(), milliseconds = [], effects = [];
      for (let i = 0; i < 5; i++) {
        effects.push(module.spawnExplosion(scene, new THREE.Vector3(i - 2, 0, -3), 6.5, 'rocket'));
        effects.forEach(e => module.updateExplosion(e, .05));
        milliseconds.push(render());
      }
      const after = lit(), draws = renderer.info.render.calls;
      effects.forEach(e => module.disposeExplosion(scene, e));
      render();
      const remainingLights = scene.children.filter(o => o.isPointLight);
      const allDark = remainingLights.every(l => l.intensity === 0);
      const firstGeo = renderer.info.memory.geometries;
      for (let i = 0; i < 10; i++) {
        const e = module.spawnExplosion(scene, new THREE.Vector3(0, 0, -3));
        render(); module.disposeExplosion(scene, e); render();
      }
      const lastGeo = renderer.info.memory.geometries;
      renderer.dispose();
      return { before, after, draws, firstGeo, lastGeo, allDark, lightCount: remainingLights.length,
        burstFrameMs: milliseconds.map(x => +x.toFixed(1)) };
    }
    const old = baseline ? profile(await import('/artifacts/explosion-before.js')) : null;
    const current = profile(fx);
    pickup.dispose();
    // Removing/replacing a pickup must not release the gun currently in-hand.
    renderer.render(scene, camera); ws.renderViewmodel(renderer, world);
    return { ...view, disposed, current, old };
  }, process.env.KYX_COMPARE_EXPLOSIONS === '1');
  assert.equal(result.heldSource, 'blender-arsenal');
  assert.equal(result.groundSource, result.heldSource);
  assert(result.sameGeometry, 'pickup and held launcher must share the Blender mesh');
  assert.equal(result.disposed, 0, 'pickup disposal must preserve held weapon buffers');
  assert.equal(result.current.before, result.current.after, 'explosions must not recompile map materials');
  assert.equal(result.current.firstGeo, result.current.lastGeo, 'repeated blasts must not leak GPU geometry');
  assert.equal(result.current.lightCount, 2);
  assert(result.current.allDark);
  assert.deepEqual(errors, []);
  mkdirSync('artifacts/launcher', { recursive: true });
  await page.screenshot({ path: 'artifacts/launcher/held.png' });
  console.log('Launcher render passed:', JSON.stringify(result));
} finally { await browser?.close(); await app?.close(); }
