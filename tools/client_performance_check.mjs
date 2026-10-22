import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  bloomEnabled, lowerRuntimeQuality, postFxPixelRatio, rendererPixelRatio,
  shouldReduceMenuQuality, shouldReduceRuntimeQuality,
} from '../src/core/RenderQuality.js';
import { boundedOctreeRayIntersect } from '../src/world/BoundedOctreeRay.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assert = (ok, message) => { if (!ok) throw new Error(message); };

assert(rendererPixelRatio('medium', 3) === 1.5, 'dense screens need sharper default rendering');
assert(postFxPixelRatio('medium', 3) === 1.5, 'post effects must preserve default sharpness');
assert(rendererPixelRatio('high', 3) === 2, 'high renderer cap changed');
assert(postFxPixelRatio('high', 3) === 1.5, 'high bloom must cap at 1.5x');
assert(rendererPixelRatio('low', 3) === 1, 'phone fallback must not magnify a sub-CSS-resolution canvas');
for (const [width, height] of [[390, 844], [844, 390], [1024, 1366], [3840, 2160]]) {
  for (const [quality, budget] of [['low', 1_048_576], ['medium', 2_073_600], ['high', 3_686_400]]) {
    const ratio = rendererPixelRatio(quality, 3, width, height);
    assert(width * height * ratio ** 2 <= budget + 1, 'framebuffer exceeded its pixel budget');
    assert(ratio === rendererPixelRatio(quality, 3, height, width), 'rotation changed the pixel budget');
  }
}
assert(rendererPixelRatio('medium', 1, 1280, 720) === 1, 'standard-density screens must not supersample unnecessarily');
assert(!bloomEnabled('low') && !bloomEnabled('medium') && bloomEnabled('high'),
  'bloom must stay a high-quality-only effect');

const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
const nearTriangle = new THREE.Triangle(
  new THREE.Vector3(-1, -1, -5),
  new THREE.Vector3(1, -1, -5),
  new THREE.Vector3(0, 1, -5),
);
const mockOctree = {
  triangles: [],
  subTrees: [{
    box: new THREE.Box3(new THREE.Vector3(-1, -1, -5.1), new THREE.Vector3(1, 1, -4.9)),
    triangles: [nearTriangle],
    subTrees: [],
  }],
  rayIntersect: () => { throw new Error('finite query fell back to an unbounded octree scan'); },
};
assert(!boundedOctreeRayIntersect(mockOctree, ray, 4),
  'bounded octree query returned geometry beyond its finite segment');
assert(Math.abs(boundedOctreeRayIntersect(mockOctree, ray, 6).distance - 5) < 1e-6,
  'bounded octree query missed nearby collision');
assert(lowerRuntimeQuality('high') === 'medium'
  && lowerRuntimeQuality('medium') === 'low'
  && lowerRuntimeQuality('low') === 'low', 'runtime quality fallback order changed');
assert(shouldReduceRuntimeQuality(3, 120, 40), 'sustained slow frames must reduce runtime quality');
assert(!shouldReduceRuntimeQuality(3, 180, 0), 'steady 60fps must preserve requested quality');
assert(shouldReduceMenuQuality(1.6, 40, 18),
  'a persistently slow spectator must lower quality without waiting for gameplay');
assert(!shouldReduceMenuQuality(1.6, 96, 0),
  'a steady spectator must preserve requested quality');

const bot = readFileSync(join(root, 'src/entities/Bot.js'), 'utf8');
const world = readFileSync(join(root, 'src/world/World.js'), 'utf8');
const zombie = readFileSync(join(root, 'src/entities/Zombie.js'), 'utf8');
const game = readFileSync(join(root, 'src/core/Game.js'), 'utf8');
const plates = readFileSync(join(root, 'src/ui/Nameplates.js'), 'utf8');
const weapons = readFileSync(join(root, 'src/weapons/WeaponSystem.js'), 'utf8');
const thumbnails = readFileSync(join(root, 'src/ui/WeaponThumbnails.js'), 'utf8');
const menu = readFileSync(join(root, 'src/ui/MainMenu.js'), 'utf8');
const inventory = readFileSync(join(root, 'src/ui/InventoryPanel.js'), 'utf8');
const htaccess = readFileSync(join(root, 'public/.htaccess'), 'utf8');
const authNet = readFileSync(join(root, 'src/net/AuthNetBridge.js'), 'utf8');
const hero = readFileSync(join(root, 'src/player/HeroBody.js'), 'utf8');
assert(!/quaternion\.clone\(\)\.invert\(\)/.test(bot), 'bot billboard allocates every frame');
assert(/raycastCollisionDistance\(ray, far = Infinity\)/.test(world),
  'world must expose an octree-accelerated bot obstruction query');
assert(/boundedOctreeRayIntersect\(this\._mapOctree, ray, far\)/.test(world),
  'client collision rays must stay bounded to their requested segment');
assert(!/intersectObjects\([^\n]*raycastMeshes/.test(bot),
  'bot AI must not scan every imported map mesh for navigation or gunfire');
assert((bot.match(/raycastCollisionDistance/g) || []).length >= 4,
  'bot sight, dash, shooting, and roaming must share accelerated collision rays');
assert(!/quaternion\.clone\(\)\.invert\(\)/.test(zombie), 'zombie billboard allocates every frame');
const menuUpdate = game.slice(game.indexOf('_updateMenuScene(dt)'), game.indexOf('_loop()'));
assert(!/new THREE\.Vector3/.test(menuUpdate), 'menu simulation allocates a vector every frame');
assert(/distanceToSquared/.test(plates), 'nameplates must reject by squared distance');
assert(/nextCheck: now \+ 100/.test(plates), 'nameplate occlusion raycasts must be throttled');
assert(!/\[this\.kickPos\.[xyz], this\.kickVel\.[xyz]\]\s*=/.test(weapons),
  'recoil spring allocates result arrays every frame');
assert(/this\._hudInfo \|\|=/.test(weapons), 'HUD payload must be reused');
assert(/this\._remoteSeen/.test(authNet) && /this\._remoteProject/.test(authNet),
  'remote-player sync must reuse frame scratch storage');
assert(!/frustumCulled = false/.test(hero),
  'connected player bodies must retain camera frustum culling');
assert(!/await this\._startPresentationPreloads\(\)/.test(game),
  'optional presentation assets must not block startup');
assert(/_schedulePresentationPreloads\(\)/.test(game),
  'optional presentation assets must be scheduled after gameplay is ready');
assert(/if \(bloomEnabled\(_q\)\) this\._buildPostFX\(\)/.test(game),
  'post-processing buffers must be lazy on the default quality tier');
assert(/isSpectating[\s\S]*?shouldReduceMenuQuality/.test(game),
  'dynamic resolution must monitor the spectator menu as well as gameplay');
const constructorBody = game.slice(game.indexOf('constructor(canvas)'), game.indexOf('\n  // Release all global'));
assert(!/preloadZombieModel\(\)/.test(constructorBody),
  'the survival-only zombie model must not compete with the first map request');
assert(/onWeaponModelsReady\(_generate\)/.test(thumbnails)
  && !/function _waitForGLB/.test(thumbnails),
  'weapon thumbnails must wait for actual GLB readiness instead of probing fallbacks');
assert(/warmWeaponHudThumbs\(ids, onReady\)[\s\S]*?onWeaponModelReady\(id/.test(thumbnails),
  'match HUD must render only the equipped weapon thumbnails');
const menuCtor = menu.slice(menu.indexOf('constructor('), menu.indexOf('// ── Nav wiring'));
assert(!/warmWeaponThumbs\(/.test(menuCtor), 'menu construction must not render weapon thumbnails');
const inventoryCtor = inventory.slice(inventory.indexOf('constructor('), inventory.search(/\n  (?:async )?open\(\)/));
assert(!/warmWeaponThumbs\(/.test(inventoryCtor), 'inventory construction must not render weapon thumbnails');
assert(/application\/x-evmap/.test(htaccess) && /DEFLATE[^\n]*application\/x-evmap/.test(htaccess),
  'large EV map payloads must be served compressed');

console.log('client performance passed: startup is non-blocking, EV maps compress, thumbnails are lazy, medium bloom is off, and hot loops stay allocation-light');
