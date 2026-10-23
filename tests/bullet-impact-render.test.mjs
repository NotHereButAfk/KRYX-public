import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const web = await createServer({ root, server: { host: '127.0.0.1', port: 0, hmr: false } });
let browser;
try {
  await web.listen();
  browser = await chromium.launch({ executablePath: process.env.CHROME || (existsSync(edge) ? edge : undefined),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 720, height: 480 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const url = web.resolvedUrls.local[0];
  await page.route(`${url}__impact-probe`, route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><style>body{margin:0;background:#68706d}canvas{display:block}</style>' }));
  await page.goto(`${url}__impact-probe`);
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { BulletImpactEffects } = await import('/src/effects/BulletImpactEffects.js');
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x68706d);
    const camera = new THREE.PerspectiveCamera(55, 720 / 480, 0.01, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(720, 480);
    document.body.appendChild(renderer.domElement);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), new THREE.MeshBasicMaterial({ color: 0x9caaa6 }));
    wall.position.z = -3;
    scene.add(wall);
    const raycaster = new THREE.Raycaster();
    let probes = 0;
    const world = { _mapRoot: wall, raycastCollisionHit(ray, far) {
      probes++;
      raycaster.set(ray.origin, ray.direction);
      raycaster.far = far;
      const hit = raycaster.intersectObject(wall)[0];
      return hit ? { point: hit.point, distance: hit.distance, normal: new THREE.Vector3(0, 0, 1) } : null;
    } };
    const effects = new BulletImpactEffects(scene);
    const pixels = () => {
      const data = new Uint8Array(720 * 480 * 4);
      const gl = renderer.getContext();
      gl.readPixels(0, 0, 720, 480, gl.RGBA, gl.UNSIGNED_BYTE, data);
      return data;
    };
    renderer.render(scene, camera);
    const baselineCalls = renderer.info.render.calls;
    const before = pixels();
    for (const x of [-0.35, 0, 0.35]) effects.showEndpoint(world, camera.position, new THREE.Vector3(x, 0, -3), camera);
    effects.update(0.05, camera);
    renderer.render(scene, camera);
    const after = pixels();
    let changedPixels = 0;
    for (let i = 0; i < before.length; i += 4) {
      if (Math.abs(before[i] - after[i]) + Math.abs(before[i + 1] - after[i + 1]) + Math.abs(before[i + 2] - after[i + 2]) > 12) changedPixels++;
    }
    const activeCalls = renderer.info.render.calls;
    for (let i = 0; i < 300; i++) effects.showEndpoint(world, camera.position, new THREE.Vector3(0, 0, -3), camera);
    renderer.render(scene, camera);
    const cappedCalls = renderer.info.render.calls;
    effects.clear();
    renderer.render(scene, camera);
    const clearedCalls = renderer.info.render.calls;
    effects.showEndpoint(world, camera.position, new THREE.Vector3(0, 0, -3), camera);
    effects.update(0.05, camera);
    renderer.render(scene, camera);
    window.impactProbe = { renderer, scene, camera, effects, wall };
    return { baselineCalls, activeCalls, cappedCalls, clearedCalls, changedPixels, probes };
  });
  const out = path.join(root, 'artifacts', 'impact-review');
  mkdirSync(out, { recursive: true });
  await page.screenshot({ path: path.join(out, 'confirmed-impact.png') });
  const disposal = await page.evaluate(() => {
    const { renderer, scene, camera, effects } = window.impactProbe;
    const before = renderer.info.memory.geometries;
    effects.dispose();
    renderer.render(scene, camera);
    return { before, after: renderer.info.memory.geometries, calls: renderer.info.render.calls };
  });
  assert.deepEqual(errors, [], 'rendering bullet impacts produced browser/GPU errors');
  assert(result.changedPixels > 20, 'impact shader produced no visible pixels');
  assert.equal(result.activeCalls, result.baselineCalls + 1);
  assert.equal(result.cappedCalls, result.activeCalls, 'sustained fire increases draw calls');
  assert.equal(result.clearedCalls, result.baselineCalls);
  assert.equal(disposal.after, disposal.before - 1, 'effect GPU geometry survived disposal');
  console.log(`Impact GPU render passed: ${JSON.stringify({ ...result, disposal })}`);
} finally {
  await browser?.close();
  await web.close();
}
