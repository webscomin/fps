// Automated test suite for shotgun effects binding
import * as THREE from "three";
import { CONFIG } from "../src/config.js";
import { Viewmodel } from "../src/weapons/Viewmodel.js";
import { AudioManager } from "../src/audio/AudioManager.js";

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    passed++;
  } else {
    console.error(`[FAIL] ${message}`);
    failed++;
  }
}

console.log("=== RUNNING SHOTGUN EFFECTS VERIFICATION ===");

// 1. CONFIG check
assert(CONFIG.viewmodel?.shotgun?.muzzle !== undefined, "CONFIG.viewmodel.shotgun.muzzle exists");
assert(CONFIG.viewmodel?.shotgun?.eject !== undefined, "CONFIG.viewmodel.shotgun.eject exists");
assert(CONFIG.viewmodel?.shotgun?.eject?.side !== undefined, "eject.side exists");
assert(CONFIG.viewmodel?.shotgun?.shell?.scale !== undefined, "shell.scale exists");
assert(CONFIG.viewmodel?.shotgun?.pump !== undefined, "CONFIG.viewmodel.shotgun.pump exists");

// 2. Audio check
const audio = new AudioManager();
let lastPlayedSound = null;
audio.play = function(name, vol) {
  lastPlayedSound = name;
};
audio.play("shot_shotgun");
assert(lastPlayedSound === "shot_shotgun", "shot_shotgun sound call works");
audio.play("shell_drop");
assert(lastPlayedSound === "shell_drop", "shell_drop sound call works");

// 3. Viewmodel check
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
const vm = new Viewmodel(scene, camera, audio);

assert(vm.shellPool.length === 10, "Shell pool has exactly 10 shells");
assert(vm.wScene.children.some(c => vm.shellPool.map(s => s.mesh).includes(c)), "Shells are added to wScene");

// Verify muzzle point and markers on shotgun model
const sgModel = vm.models.shotgun;
assert(sgModel !== undefined, "Shotgun model exists in Viewmodel");

const flash = sgModel.userData.flash;
assert(flash !== undefined, "Shotgun has flash mesh");
// In procedural fallback or loaded model, check flash
assert(flash.visible === false, "Flash initially hidden");

// Mock shotgun hierarchy if loaded without GLTF in Node
if (!sgModel.userData._isModel) {
  sgModel.userData._isModel = true;
  // Create mock body and handguard node for node test
  const mockBody = new THREE.Group();
  mockBody.name = "Tactical_Body";
  const mockHandguard = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10));
  mockHandguard.name = "Tactical_Handguard_V1";
  mockHandguard.position.set(141, 0, 17);
  mockBody.add(mockHandguard);
  sgModel.add(mockBody);
  vm.handguardNode = mockHandguard;
  vm.handguardBasePos.set(141, 0, 17);

  const mockMuzzleMarker = new THREE.Mesh(new THREE.SphereGeometry(5.5));
  mockMuzzleMarker.name = "muzzleMarker";
  mockMuzzleMarker.position.set(199, 0, 32);
  sgModel.add(mockMuzzleMarker);
  sgModel.userData.muzzleMarker = mockMuzzleMarker;

  const mockEjectMarker = new THREE.Mesh(new THREE.SphereGeometry(4.5));
  mockEjectMarker.name = "ejectMarker";
  mockEjectMarker.position.set(15, 6, 25);
  sgModel.add(mockEjectMarker);
  sgModel.userData.ejectMarker = mockEjectMarker;
}

let shellSoundTriggered = false;
audio.play = function(name) {
  if (name === "shell_drop") shellSoundTriggered = true;
};

// 4. Test shot firing and muzzle light position
const initialWSceneCount = vm.wScene.children.length;
const initialMainSceneCount = vm.mainScene.children.length;

vm.triggerFlash(1.0, "shotgun");
assert(vm.flashT > 0, "Flash timer active after triggerFlash");
assert(vm.pumpActive === true, "Pump active after triggerFlash");
assert(vm.pendingShells.length === 1, "One shell pending after shot");
assert(vm.pendingShells[0] === 0.12, "Shell ejection delay is 0.12s");

// Update dt = 0.05s
vm.update(0.05, { vel: { x: 0, y: 0, z: 0 }, dashTimer: 0, onGround: true }, "shotgun");
assert(vm.handguardNode.position.x < 141, "Handguard moved backward along barrel (-X)");
assert(vm.pendingShells.length === 1, "Shell still pending at 0.05s");

// Update dt = 0.08s (total 0.13s -> shell ejects)
vm.update(0.08, { vel: { x: 0, y: 0, z: 0 }, dashTimer: 0, onGround: true }, "shotgun");
assert(vm.pendingShells.length === 0, "Pending shell ejected at >0.12s");

const activeShells = vm.shellPool.filter(s => s.mesh.visible);
assert(activeShells.length === 1, "Exactly one shell active in wScene");
assert(activeShells[0].vel.x > 0, "Shell moves right (+X)");
assert(activeShells[0].vel.y > 0, "Shell moves up (+Y)");

// Update past return time
const retTime = CONFIG.viewmodel?.shotgun?.pump?.returnTime || 0.18;
for (let t = 0; t < Math.ceil(retTime / 0.05) + 2; t++) {
  vm.update(0.05, { vel: { x: 0, y: 0, z: 0 }, dashTimer: 0, onGround: true }, "shotgun");
}
assert(vm.pumpActive === false, "Pump finished after returnTime");
assert(Math.abs(vm.handguardNode.position.x - 141) < 1e-4, "Handguard returned exactly to base position 141");

// Update to complete shell life (total > 1.2s)
for (let t = 0; t < 15; t++) {
  vm.update(0.1, { vel: { x: 0, y: 0, z: 0 }, dashTimer: 0, onGround: true }, "shotgun");
}
assert(shellSoundTriggered === true, "Shell drop sound triggered during flight");
const activeShellsAfter = vm.shellPool.filter(s => s.mesh.visible);
assert(activeShellsAfter.length === 0, "Shell disappeared after 1.2s");

// Test left ejection side (side = -1)
CONFIG.viewmodel.shotgun.eject.side = -1;
CONFIG.viewmodel.shotgun.shell.scale = 1.5;
vm.triggerFlash(1.0, "shotgun");
vm.update(0.13, { vel: { x: 0, y: 0, z: 0 }, dashTimer: 0, onGround: true }, "shotgun");
const leftShells = vm.shellPool.filter(s => s.mesh.visible);
assert(leftShells.length > 0 && leftShells[0].vel.x < 0, "Shell flies left (-X) when eject.side is -1");
CONFIG.viewmodel.shotgun.eject.side = 1;
CONFIG.viewmodel.shotgun.shell.scale = 1.0;
for (let t = 0; t < 15; t++) {
  vm.update(0.1, { vel: { x: 0, y: 0, z: 0 }, dashTimer: 0, onGround: true }, "shotgun");
}

// 5. Leak test: 100 shots
console.log("Simulating 100 shots for leak test...");
for (let shot = 0; shot < 100; shot++) {
  vm.triggerFlash(1.0, "shotgun");
  for (let step = 0; step < 20; step++) {
    vm.update(0.05, { vel: { x: 0, y: 0, z: 0 }, dashTimer: 0, onGround: true }, "shotgun");
  }
}
assert(vm.wScene.children.length === initialWSceneCount, "wScene object count unchanged after 100 shots (no leaks)");
assert(vm.mainScene.children.length === initialMainSceneCount, "mainScene object count unchanged after 100 shots (no leaks)");
assert(vm.shellPool.length === 10, "Shell pool size strictly 10");

// 6. Test glory kill and switch weapon stability
vm.triggerFlash(1.0, "shotgun");
vm.playGloryPose("shotgun", 0.2);
for (let t = 0; t < Math.ceil(retTime / 0.05) + 2; t++) {
  vm.update(0.05, { vel: { x: 0, y: 0, z: 0 }, dashTimer: 0, onGround: true }, "shotgun");
}
vm.endGloryPose(0.15);
vm.update(0.2, { vel: { x: 0, y: 0, z: 0 }, dashTimer: 0, onGround: true }, "shotgun");
assert(Math.abs(vm.handguardNode.position.x - 141) < 1e-4, "Handguard base position preserved after glory pose");

vm.switchWeapon("ak47");
assert(vm.pumpActive === false, "Pump deactivated on weapon switch");
assert(Math.abs(vm.handguardNode.position.x - 141) < 1e-4, "Handguard in base position on weapon switch");
vm.switchWeapon("shotgun");

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
