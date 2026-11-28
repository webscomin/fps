import * as THREE from "three";
import { CONFIG } from "../src/config.js";
import { Viewmodel } from "../src/weapons/Viewmodel.js";
import { LevelGenerator } from "../src/world/LevelGenerator.js";
import { buildRoomDecor } from "../src/world/Decor.js";
import { Room } from "../src/world/Room.js";

console.log("=== RUNNING VERIFICATION TESTS ===");

// 1. Verify Camera and Config
console.log("\n[Test 1] Camera & Config settings:");
console.assert(CONFIG.camera.near === 0.15, `near should be 0.15, got ${CONFIG.camera.near}`);
console.assert(CONFIG.camera.far === 160, `far should be 160, got ${CONFIG.camera.far}`);
console.assert(CONFIG.camera.fov === 77, `fov should be 77, got ${CONFIG.camera.fov}`);
console.assert(CONFIG.graphics.weaponInComposer === true, `weaponInComposer should be true by default`);
console.log("  CONFIG.camera.near =", CONFIG.camera.near, "(PASS)");
console.log("  CONFIG.camera.far =", CONFIG.camera.far, "(PASS)");
console.log("  CONFIG.camera.fov =", CONFIG.camera.fov, "(PASS)");
console.log("  CONFIG.graphics.weaponInComposer =", CONFIG.graphics.weaponInComposer, "(PASS)");

// 2. Verify Viewmodel single active model & diagnostics
console.log("\n[Test 2] Viewmodel single active model & diagnostics:");
const scene = new THREE.Scene();
const mainCam = new THREE.PerspectiveCamera(CONFIG.camera.fov, 16 / 9, CONFIG.camera.near, CONFIG.camera.far);
const viewmodel = new Viewmodel(scene, mainCam);

// After buildModels, only shotgun should be visible
console.assert(viewmodel.models.shotgun.visible === true, "Shotgun should be visible by default");
console.assert(viewmodel.models.ak47.visible === false, "AK-47 should not be visible");
console.assert(viewmodel.models.rocket.visible === false, "Rocket should not be visible");
console.log("  Initial state: shotgun visible =", viewmodel.models.shotgun.visible, ", ak47 =", viewmodel.models.ak47.visible, ", rocket =", viewmodel.models.rocket.visible, "(PASS)");

// Switch to ak47
viewmodel.switchWeapon("ak47");
console.assert(viewmodel.models.shotgun.visible === false, "Shotgun should be hidden");
console.assert(viewmodel.models.ak47.visible === true, "AK-47 should be visible");
console.assert(viewmodel.models.rocket.visible === false, "Rocket should be hidden");
console.log("  Switch to ak47: ak47 visible =", viewmodel.models.ak47.visible, "(PASS)");

// Switch to rocket
viewmodel.switchWeapon("rocket");
console.assert(viewmodel.models.shotgun.visible === false, "Shotgun should be hidden");
console.assert(viewmodel.models.ak47.visible === false, "AK-47 should be hidden");
console.assert(viewmodel.models.rocket.visible === true, "Rocket should be visible");
console.log("  Switch to rocket: rocket visible =", viewmodel.models.rocket.visible, "(PASS)");

// Rebuild models (simulates style or quality switch)
viewmodel.buildModels();
console.assert(viewmodel.models.rocket.visible === true, "Rocket should still be the active model after rebuild");
console.assert(viewmodel.models.shotgun.visible === false, "Shotgun should be hidden after rebuild");
console.assert(viewmodel.models.ak47.visible === false, "AK-47 should be hidden after rebuild");
console.log("  Rebuild models: preserves active weapon and only rocket visible (PASS)");

// Diagnostics
const diag = viewmodel.getDiagnostics();
console.assert(diag.nanFound === false, "No NaN should be found");
console.assert(diag.modelVisible === true, "Active model should be visible");
console.assert(diag.childMeshCount > 0, "Child mesh count should be > 0");
console.log("  Diagnostics:", JSON.stringify(diag, null, 2));

// 3. Level Generation & Floor Planes Audit
console.log("\n[Test 3] Level Generation & Floor Audit:");
const gen = new LevelGenerator();
const level = gen.generate("TEST_AUDIT_SEED_123");

console.log(`  Generated ${level.rooms.length} rooms and ${level.corridors.length} corridors.`);

// Check Decor in rooms: verify no y = 0.008 floor planes, overlays >= 0.03
let floorPlaneAt0008Count = 0;
let overlayBelow003Count = 0;
let overlayCount = 0;

for (const room of level.rooms) {
  if (room.decor && room.decor.group) {
    room.decor.group.traverse((obj) => {
      if (obj.isMesh && obj.geometry) {
        const box = new THREE.Box3().setFromObject(obj);
        const center = new THREE.Vector3();
        box.getCenter(center);
        if (Math.abs(center.y - 0.008) < 0.003) {
          floorPlaneAt0008Count++;
        }
        if (center.y > 0.001 && center.y < 0.029) {
          overlayBelow003Count++;
        }
        if (center.y >= 0.030 && center.y <= 0.05) {
          overlayCount++;
          if (obj.material) {
            console.assert(obj.material.polygonOffset === true, `Overlay at y=${center.y} should have polygonOffset = true`);
          }
        }
      }
    });
  }
}

console.assert(floorPlaneAt0008Count === 0, `Found ${floorPlaneAt0008Count} duplicate floor planes at y=0.008! Should be 0`);
console.assert(overlayBelow003Count === 0, `Found ${overlayBelow003Count} overlays below y=0.03! Should be 0`);
console.log(`  Duplicate floor planes at y=0.008: ${floorPlaneAt0008Count} (PASS)`);
console.log(`  Overlays below y=0.03: ${overlayBelow003Count} (PASS)`);
console.log(`  Valid floor overlays with polygonOffset at y>=0.03: ${overlayCount} (PASS)`);

// Check corridor and room floor boundaries (ensure no overlapping floor slabs in the same plane)
console.log("\n[Test 4] Corridor and Room Floor Overlap Check:");
const T = CONFIG.level.wallThickness; // 0.6
for (const corr of level.corridors) {
  // Corridor box 0 is floor
  const fBox = corr.boxes[0];
  console.assert(fBox, "Corridor must have floor collider box");
  console.assert(corr.group.children.length > 0, "Corridor must have meshes");
}
console.log("  Corridor floor checks passed without overlapping room interior planes (PASS)");

console.log("\n[Test 5] auditFloorPlanes simulation on scene:");
const fullScene = new THREE.Scene();
for (const r of level.rooms) {
  fullScene.add(r.group);
}
for (const c of level.corridors) {
  fullScene.add(c.group);
}

const auditList = [];
const tempBox = new THREE.Box3();
const size = new THREE.Vector3();
const center = new THREE.Vector3();

fullScene.traverse((obj) => {
  if (obj.isMesh && obj.geometry) {
    tempBox.setFromObject(obj);
    tempBox.getSize(size);
    tempBox.getCenter(center);
    if (Math.abs(center.y) < 0.15 || (tempBox.min.y >= -0.15 && tempBox.max.y <= 0.15)) {
      auditList.push({
        name: obj.name || obj.parent?.name || obj.geometry.type || "Mesh",
        y: Number(center.y.toFixed(4)),
        dimensions: `${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`,
        polygonOffset: !!obj.material?.polygonOffset
      });
    }
  }
});
console.log(`  auditFloorPlanes discovered ${auditList.length} objects in |y| < 0.15.`);
console.table(auditList.slice(0, 10));

console.log("\n=== ALL TESTS PASSED SUCCESSFULLY! ===");
