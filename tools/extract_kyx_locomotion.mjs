import fs from 'node:fs';

const sourcePath = new URL('../public/vendor/quaternius/universal-animation-library.glb', import.meta.url);
const outputPath = new URL('../public/kyx-locomotion.glb', import.meta.url);
const source = fs.readFileSync(sourcePath);
const jsonLength = source.readUInt32LE(12);
const json = JSON.parse(source.subarray(20, 20 + jsonLength).toString('utf8').trimEnd());
const binHeader = 20 + jsonLength;
const binLength = source.readUInt32LE(binHeader);
const bin = source.subarray(binHeader + 8, binHeader + 8 + binLength);
const wanted = new Map([
  ['Idle_Loop', 'Idle'], ['Walk_Loop', 'Walk'], ['Sprint_Loop', 'Run'],
]);
const animations = json.animations.filter((animation) => wanted.has(animation.name));
if (animations.length !== wanted.size) throw new Error('missing required Universal locomotion clips');

const accessorIds = new Set();
for (const animation of animations) for (const sampler of animation.samplers) {
  accessorIds.add(sampler.input); accessorIds.add(sampler.output);
}
const accessorMap = new Map([...accessorIds].sort((a, b) => a - b).map((id, index) => [id, index]));
const viewIds = new Set();
for (const id of accessorMap.keys()) {
  const accessor = json.accessors[id];
  if (accessor.sparse) throw new Error('sparse animation accessors are not supported');
  viewIds.add(accessor.bufferView);
}
const viewMap = new Map([...viewIds].sort((a, b) => a - b).map((id, index) => [id, index]));
const chunks = [];
let byteLength = 0;
const bufferViews = [];
for (const id of viewMap.keys()) {
  const view = json.bufferViews[id];
  const bytes = bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
  const padding = (4 - (byteLength % 4)) % 4;
  if (padding) { chunks.push(Buffer.alloc(padding)); byteLength += padding; }
  const clone = { ...view, buffer: 0, byteOffset: byteLength };
  delete clone.target;
  bufferViews.push(clone);
  chunks.push(bytes); byteLength += bytes.length;
}
const accessors = [...accessorMap.keys()].map((id) => ({
  ...json.accessors[id], bufferView: viewMap.get(json.accessors[id].bufferView),
}));
const compactAnimations = animations.map((animation) => ({
  ...animation,
  name: wanted.get(animation.name),
  samplers: animation.samplers.map((sampler) => ({
    ...sampler, input: accessorMap.get(sampler.input), output: accessorMap.get(sampler.output),
  })),
}));
const nodes = json.nodes.map((node) => {
  const clone = { ...node };
  delete clone.mesh; delete clone.skin; delete clone.weights; delete clone.camera;
  return clone;
});
const compact = {
  asset: { version: '2.0', generator: 'KYX locomotion extractor' },
  scene: json.scene, scenes: json.scenes, nodes,
  animations: compactAnimations, accessors, bufferViews,
  buffers: [{ byteLength }],
};
const pad = (buffer, byte = 0x20) => Buffer.concat([buffer, Buffer.alloc((4 - buffer.length % 4) % 4, byte)]);
const jsonBytes = pad(Buffer.from(JSON.stringify(compact)), 0x20);
const binBytes = pad(Buffer.concat(chunks), 0x00);
const total = 12 + 8 + jsonBytes.length + 8 + binBytes.length;
const out = Buffer.alloc(total);
out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
out.writeUInt32LE(jsonBytes.length, 12); out.writeUInt32LE(0x4e4f534a, 16); jsonBytes.copy(out, 20);
const binOffset = 20 + jsonBytes.length;
out.writeUInt32LE(binBytes.length, binOffset); out.writeUInt32LE(0x004e4942, binOffset + 4);
binBytes.copy(out, binOffset + 8);
fs.writeFileSync(outputPath, out);
console.log(`kyx locomotion: ${out.length} bytes, ${compactAnimations.length} source-authored clips`);
