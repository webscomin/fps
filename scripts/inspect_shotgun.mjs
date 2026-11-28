// Get vertex count and approximate bounding box from accessor data
import { readFileSync } from "fs";

const data = readFileSync("public/models/shotgun.glb");
const jsonChunkLength = data.readUInt32LE(12);
const jsonStr = data.toString("utf8", 20, 20 + jsonChunkLength);
const gltf = JSON.parse(jsonStr);

// Position accessor
const mesh = gltf.meshes[0];
const posAccessorIdx = mesh.primitives[0].attributes.POSITION;
const posAccessor = gltf.accessors[posAccessorIdx];
console.log(`Vertices: ${posAccessor.count}`);
console.log(`Position min: [${posAccessor.min.map(v=>v.toFixed(4)).join(", ")}]`);
console.log(`Position max: [${posAccessor.max.map(v=>v.toFixed(4)).join(", ")}]`);

const sizeX = posAccessor.max[0] - posAccessor.min[0];
const sizeY = posAccessor.max[1] - posAccessor.min[1];
const sizeZ = posAccessor.max[2] - posAccessor.min[2];
console.log(`Size: X=${sizeX.toFixed(4)}, Y=${sizeY.toFixed(4)}, Z=${sizeZ.toFixed(4)}`);
console.log(`Max dimension: ${Math.max(sizeX, sizeY, sizeZ).toFixed(4)}`);

// Material info
const mat = gltf.materials[0];
console.log(`\nMaterial: ${JSON.stringify(mat, null, 2)}`);
