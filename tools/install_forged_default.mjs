import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';

globalThis.ProgressEvent ??= class { constructor(type, data) { Object.assign(this, { type }, data); } };
function read(bytes) {
  const length = bytes.readUInt32LE(12);
  return { json: JSON.parse(bytes.subarray(20, 20 + length)), bin: bytes.subarray(28 + length), bytes };
}
const source = read(fs.readFileSync('art/player-skins/rig-source.glb'));
// Decode the collection source once at build time. Its quantized inverse bind
// matrices belong to its meshes and must be retained when rebinding by name.
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const document = await io.read('public/assets/player-skins/remake_84.glb');
for (const extension of document.getRoot().listExtensionsUsed()) {
  if (extension.extensionName === 'EXT_meshopt_compression') extension.dispose();
}
await document.transform(dequantize());
const skin = read(Buffer.from(await io.writeBinary(document)));
const j = source.json, s = skin.json;
const original = await new GLTFLoader().parseAsync(source.bytes.buffer.slice(
  source.bytes.byteOffset, source.bytes.byteOffset + source.bytes.byteLength), '');
const mixer = new THREE.AnimationMixer(original.scene);
mixer.clipAction(original.animations[0]).play(); mixer.update(0);
original.scene.updateMatrixWorld(true);
const bounds = new THREE.Box3();
original.scene.traverse(o => { if (o.isSkinnedMesh) bounds.union(new THREE.Box3().setFromObject(o, true)); });
j.scenes[j.scene || 0].extras = {
  rigBounds: { height: bounds.max.y - bounds.min.y, minY: bounds.min.y },
  design: 'Default Reforged / current collection meshes / preserved animation rig',
  embeddedSkinId: 'remake_84',
};

const viewOffset = j.bufferViews.length, accessorOffset = j.accessors.length;
for (const view of s.bufferViews) j.bufferViews.push({ ...view, buffer: 0, byteOffset: (view.byteOffset || 0) + source.bin.length });
for (const accessor of s.accessors) {
  if (accessor.sparse) throw Error('Unexpected sparse collection accessor');
  j.accessors.push({ ...accessor, ...(accessor.bufferView != null ? { bufferView: accessor.bufferView + viewOffset } : {}) });
}

// Keep the original rifle and its BIND markers; replace both old body nodes
// with every current skinned surface. Joint nodes and animation targets never
// move or get reordered.
const rifle = j.meshes[j.nodes.find(n => n.name === 'Auto Rifle - original mesh').mesh];
const rifleMaterials = [...new Set(rifle.primitives.map(p => p.material))];
const materialOffset = rifleMaterials.length;
rifle.primitives.forEach(p => { p.material = rifleMaterials.indexOf(p.material); });
j.materials = [...rifleMaterials.map(i => j.materials[i]), ...s.materials];
j.meshes = [rifle, ...s.meshes.map(mesh => ({ ...mesh, primitives: mesh.primitives.map(p => ({ ...p,
  attributes: Object.fromEntries(Object.entries(p.attributes).map(([key, index]) => [key, index + accessorOffset])),
  ...(p.indices != null ? { indices: p.indices + accessorOffset } : {}),
  ...(p.material != null ? { material: p.material + materialOffset } : {}),
})) }))];
j.nodes.find(n => n.name === 'Auto Rifle - original mesh').mesh = 0;
const bones = new Map(j.nodes.map((node, index) => [node.name, index]));
const skinOffset = j.skins.length;
j.skins.push(...s.skins.map(bind => ({ ...bind,
  inverseBindMatrices: bind.inverseBindMatrices + accessorOffset,
  joints: bind.joints.map(index => {
    const target = bones.get(s.nodes[index].name);
    if (target == null) throw Error(`Unknown collection bone: ${s.nodes[index].name}`);
    return target;
  }),
})));
const surfaces = s.nodes.filter(n => n.mesh != null);
const slots = ['EV.IO Default - Armor', 'EV.IO Default - Body'].map(name => j.nodes.find(n => n.name === name));
if (surfaces.length !== slots.length) throw Error('Default Reforged must include both current body surfaces');
surfaces.forEach((node, index) => {
  const { children, ...surface } = node;
  Object.assign(slots[index], surface, { mesh: node.mesh + 1, skin: node.skin + skinOffset });
});

// Compact only referenced accessors/views. The retired armor data is removed
// from the shipped binary; animation and weapon samples are copied byte-for-byte.
const accessorRefs = [];
const ref = (object, key) => { if (object[key] != null) accessorRefs.push([object, key]); };
for (const mesh of j.meshes) for (const primitive of mesh.primitives) {
  ref(primitive, 'indices');
  for (const key of Object.keys(primitive.attributes)) ref(primitive.attributes, key);
}
for (const bind of j.skins) ref(bind, 'inverseBindMatrices');
for (const animation of j.animations) for (const sampler of animation.samplers) {
  ref(sampler, 'input'); ref(sampler, 'output');
}
const accessorIds = [...new Set(accessorRefs.map(([object, key]) => object[key]))].sort((a, b) => a - b);
const accessorMap = new Map(accessorIds.map((id, index) => [id, index]));
j.accessors = accessorIds.map(id => j.accessors[id]);
accessorRefs.forEach(([object, key]) => { object[key] = accessorMap.get(object[key]); });
const viewRefs = [];
for (const accessor of j.accessors) {
  if (accessor.bufferView != null) viewRefs.push([accessor, 'bufferView']);
  if (accessor.sparse) for (const field of ['indices', 'values']) viewRefs.push([accessor.sparse[field], 'bufferView']);
}
const viewIds = [...new Set(viewRefs.map(([object, key]) => object[key]))].sort((a, b) => a - b);
const viewMap = new Map(viewIds.map((id, index) => [id, index]));
const combined = Buffer.concat([source.bin, skin.bin]), chunks = [];
let byteOffset = 0;
j.bufferViews = viewIds.map(id => {
  const view = j.bufferViews[id], start = view.byteOffset || 0;
  const data = combined.subarray(start, start + view.byteLength);
  const result = { ...view, buffer: 0, byteOffset };
  chunks.push(data); byteOffset += data.length;
  const padding = (4 - byteOffset % 4) % 4;
  if (padding) { chunks.push(Buffer.alloc(padding)); byteOffset += padding; }
  return result;
});
viewRefs.forEach(([object, key]) => { object[key] = viewMap.get(object[key]); });
const bin = Buffer.concat(chunks);
j.buffers = [{ byteLength: bin.length }];
let json = Buffer.from(JSON.stringify(j));
json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + json.length + bin.length, 8);
header.writeUInt32LE(json.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
const binaryHeader = Buffer.alloc(8);
binaryHeader.writeUInt32LE(bin.length); binaryHeader.writeUInt32LE(0x004e4942, 4);
fs.writeFileSync('public/ev-default.glb', Buffer.concat([header, json, binaryHeader, bin]));
console.log('Installed both Default Reforged surfaces; retained all 13 actions, joints, rifle and BIND markers.');
