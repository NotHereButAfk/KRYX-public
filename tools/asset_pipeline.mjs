#!/usr/bin/env node
// Phase 7/9 — asset pipeline validation + manifest/provenance. Validates every
// shipped glTF binary (public/*.glb) without a full glTF lib by parsing the
// GLB container + JSON chunk directly, then writes a manifest with SHA-256
// provenance hashes and a per-asset budget report (mesh/vert/size + LOD/
// compression readiness). This is the buildable half of the art-strike phases
// — the PIPELINE and its gates — independent of who authors the hero art.
//
//   node tools/asset_pipeline.mjs           # validate + write manifest
//   node tools/asset_pipeline.mjs --check   # CI mode: fail on budget breach

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pubDir = join(root, 'public');
const CHECK = process.argv.includes('--check');

// Budgets (a browser FPS viewmodel/character kit). Breaching these is a
// perf/quality-tier warning, not a crash — CI --check fails on them.
const BUDGET = {
  maxBytes: 3.5 * 1024 * 1024,   // 3.5MB per asset
  maxVerts: 120000,              // per asset
  maxMeshes: 64,
};

// Parse a GLB: 12-byte header, then chunks (JSON, then BIN). We only need the
// JSON chunk to read the asset structure + accessor vertex counts.
function parseGLB(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB (bad magic)');
  const version = buf.readUInt32LE(4);
  let off = 12, json = null, binLen = 0;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    if (type === 0x4e4f534a) json = JSON.parse(buf.slice(off + 8, off + 8 + len).toString('utf8'));
    else if (type === 0x004e4942) binLen = len;
    off += 8 + len;
  }
  return { version, json, binLen };
}

function analyze(file) {
  const buf = readFileSync(file);
  const { version, json, binLen } = parseGLB(buf);
  const sha = createHash('sha256').update(buf).digest('hex');

  const meshes = json.meshes?.length || 0;
  let prims = 0, verts = 0, tris = 0;
  const acc = json.accessors || [];
  for (const m of json.meshes || []) {
    for (const p of m.primitives || []) {
      prims++;
      const posIdx = p.attributes?.POSITION;
      if (posIdx != null && acc[posIdx]) verts += acc[posIdx].count;
      if (p.indices != null && acc[p.indices]) tris += acc[p.indices].count / 3;
    }
  }
  const hasUV = (json.meshes || []).some((m) => m.primitives?.some((p) => p.attributes?.TEXCOORD_0 != null));
  const compressed = !!(json.extensionsUsed || []).find((e) => e === 'KHR_draco_mesh_compression' || e === 'EXT_meshopt_compression');
  const nodes = json.nodes?.length || 0;

  return {
    file: basename(file), bytes: buf.length, sha256: sha.slice(0, 16),
    glbVersion: version, meshes, primitives: prims, vertices: verts,
    triangles: Math.round(tris), nodes, hasUV, compressed, binBytes: binLen,
    warnings: [
      buf.length > BUDGET.maxBytes && `over size budget (${(buf.length / 1048576).toFixed(2)}MB > ${(BUDGET.maxBytes / 1048576).toFixed(1)}MB)`,
      verts > BUDGET.maxVerts && `over vertex budget (${verts} > ${BUDGET.maxVerts})`,
      meshes > BUDGET.maxMeshes && `over mesh-count budget (${meshes} > ${BUDGET.maxMeshes})`,
    ].filter(Boolean),
  };
}

const glbs = readdirSync(pubDir).filter((f) => f.endsWith('.glb')).sort();
if (!glbs.length) { console.log('no .glb assets found'); process.exit(0); }

const assets = [];
let breaches = 0, totalBytes = 0, totalVerts = 0;
console.log('── ASSET PIPELINE — glTF validation ──');
console.log('  asset                    size     verts    tris   meshes  uv  compressed  sha');
for (const f of glbs) {
  let a; try { a = analyze(join(pubDir, f)); } catch (e) { console.log(`  ${f.padEnd(22)} PARSE FAIL — ${e.message}`); breaches++; continue; }
  assets.push(a);
  totalBytes += a.bytes; totalVerts += a.vertices;
  breaches += a.warnings.length;
  const kb = (a.bytes / 1024).toFixed(0) + 'KB';
  console.log(`  ${a.file.padEnd(22)} ${kb.padStart(7)} ${String(a.vertices).padStart(8)} ${String(a.triangles).padStart(7)} ${String(a.meshes).padStart(6)}   ${a.hasUV ? 'y' : 'n'}   ${a.compressed ? 'yes' : 'no '.padEnd(3)}       ${a.sha256}`);
  for (const w of a.warnings) console.log(`      ⚠ ${w}`);
}

// Manifest with provenance — lets a CDN/loader verify integrity + track what
// shipped (Phase 7 "manifests + provenance", Phase 12 provenance review input).
const manifest = {
  generated: new Date().toISOString(),
  budgets: BUDGET,
  totals: { assets: assets.length, bytes: totalBytes, vertices: totalVerts,
            megabytes: +(totalBytes / 1048576).toFixed(2) },
  assets,
};
writeFileSync(join(pubDir, 'assets.manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`\n  ${assets.length} assets  ${(totalBytes / 1048576).toFixed(2)}MB total  ${totalVerts} verts`);
console.log(`  manifest → public/assets.manifest.json`);
// Advisory: no asset uses mesh compression yet — a real optimization lever.
const uncompressed = assets.filter((a) => !a.compressed).length;
if (uncompressed) console.log(`  note: ${uncompressed}/${assets.length} assets are uncompressed — meshopt/draco is an available size win`);

if (CHECK && breaches) { console.log(`\n${breaches} budget breach(es) — FAIL`); process.exit(1); }
console.log(breaches ? `\n${breaches} advisory warning(s)` : '\nall assets within budget');
