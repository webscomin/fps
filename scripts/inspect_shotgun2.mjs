// Полная инспекция структуры shotgun.glb — все узлы, мешы, bounding box
import { readFileSync } from 'fs';

const buf = readFileSync('public/models/shotgun.glb');
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

// Parse GLB header
const dv = new DataView(ab);
const jsonLen = dv.getUint32(12, true);
const jsonStr = new TextDecoder().decode(new Uint8Array(ab, 20, jsonLen));
const gltf = JSON.parse(jsonStr);

const binOffset = 20 + jsonLen + 8;

console.log('=== GLTF STRUCTURE ===');
console.log('Nodes:', gltf.nodes?.length || 0);
console.log('Meshes:', gltf.meshes?.length || 0);
console.log('Materials:', gltf.materials?.length || 0);
console.log('Textures:', gltf.textures?.length || 0);
console.log('Images:', gltf.images?.length || 0);
console.log('Accessors:', gltf.accessors?.length || 0);

console.log('\n=== NODE TREE ===');
function printNode(idx, depth = 0) {
  const node = gltf.nodes[idx];
  const prefix = '  '.repeat(depth);
  const meshInfo = node.mesh !== undefined ? ` [mesh=${node.mesh}]` : '';
  const trans = node.translation ? ` T(${node.translation.map(v=>v.toFixed(2)).join(', ')})` : '';
  const rot = node.rotation ? ` R(${node.rotation.map(v=>v.toFixed(3)).join(', ')})` : '';
  const scl = node.scale ? ` S(${node.scale.map(v=>v.toFixed(3)).join(', ')})` : '';
  console.log(`${prefix}[${idx}] "${node.name || '<unnamed>'}"${meshInfo}${trans}${rot}${scl}`);
  if (node.children) {
    for (const c of node.children) printNode(c, depth + 1);
  }
}

const scene = gltf.scenes[gltf.scene || 0];
for (const rootIdx of scene.nodes) {
  printNode(rootIdx);
}

console.log('\n=== MESHES ===');
for (let i = 0; i < (gltf.meshes?.length || 0); i++) {
  const mesh = gltf.meshes[i];
  console.log(`Mesh ${i}: "${mesh.name || '<unnamed>'}", primitives: ${mesh.primitives.length}`);
  for (let j = 0; j < mesh.primitives.length; j++) {
    const prim = mesh.primitives[j];
    const posAcc = gltf.accessors[prim.attributes.POSITION];
    console.log(`  Prim ${j}: material=${prim.material}, vertices=${posAcc.count}`);
    console.log(`    min: [${posAcc.min.map(v=>v.toFixed(4)).join(', ')}]`);
    console.log(`    max: [${posAcc.max.map(v=>v.toFixed(4)).join(', ')}]`);
    const size = posAcc.max.map((v, k) => v - posAcc.min[k]);
    console.log(`    size: [${size.map(v=>v.toFixed(4)).join(', ')}]`);
  }
}

console.log('\n=== MATERIALS ===');
for (let i = 0; i < (gltf.materials?.length || 0); i++) {
  const mat = gltf.materials[i];
  const pbr = mat.pbrMetallicRoughness || {};
  const hasBaseColor = !!pbr.baseColorTexture;
  const hasNormal = !!mat.normalTexture;
  const hasEmissive = !!mat.emissiveTexture;
  const hasMR = !!pbr.metallicRoughnessTexture;
  console.log(`Mat ${i}: "${mat.name || '<unnamed>'}" baseColor=${hasBaseColor} normal=${hasNormal} emissive=${hasEmissive} metallicRoughness=${hasMR}`);
}

console.log('\n=== FILE SIZE ===');
console.log(`${(buf.length / 1024 / 1024).toFixed(2)} MB`);
