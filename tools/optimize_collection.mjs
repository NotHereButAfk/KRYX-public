import fs from 'node:fs';
import crypto from 'node:crypto';
import { NodeIO, Logger } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const manifest = JSON.parse(fs.readFileSync('art/collection-remakes/catalog.json'));
let before = 0, after = 0;
for (const [index, item] of manifest.items.entries()) {
  const path = 'public' + item.model;
  before += fs.statSync(path).size;
  const doc = await io.read(path); doc.setLogger(new Logger(Logger.Verbosity.ERROR));
  if (!doc.getRoot().listExtensionsUsed().some(e => e.extensionName === 'EXT_meshopt_compression')) {
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16, quantizeNormal: 12, quantizeTexcoord: 14, quantizeWeight: 16 }));
    await io.write(path, doc);
  }
  const bytes = fs.readFileSync(path); after += bytes.length;
  item.modelSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if ((index + 1) % 25 === 0) console.log('Optimized', index + 1, '/', manifest.items.length);
}
fs.writeFileSync('art/collection-remakes/catalog.json', JSON.stringify(manifest, null, 2) + '\n');
console.log('Collection bytes:', { before, after, savedPercent: Math.round(100 * (1 - after / before)) });
