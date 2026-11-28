// Временная проверка бочек в Node (без WebGL/DOM): размещение, урон, цепь, перк, рейкаст.
import * as THREE from "three";
import { BarrelManager, ExplosiveBarrel } from "file:///C:/Users/HP/Desktop/fps-game/src/world/ExplosiveBarrel.js";
import { castSceneRay } from "file:///C:/Users/HP/Desktop/fps-game/src/core/Physics.js";
import { CONFIG } from "file:///C:/Users/HP/Desktop/fps-game/src/config.js";

let failures = 0;
function check(name, ok, extra = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}${extra ? "  [" + extra + "]" : ""}`);
}

function makeRoom({ id = 1, w = 48, d = 48, h = 14, doors = ["north", "south", "west", "east"], blocks = [], pit = null } = {}) {
  const center = new THREE.Vector3(0, 0, 0);
  return {
    id,
    w,
    d,
    h,
    center,
    doors: {
      north: doors.includes("north"),
      south: doors.includes("south"),
      west: doors.includes("west"),
      east: doors.includes("east")
    },
    bounds: {
      min: new THREE.Vector3(center.x - w / 2, 0, center.z - d / 2),
      max: new THREE.Vector3(center.x + w / 2, h, center.z + d / 2)
    },
    blocks,
    pit,
    boxes: [],
    group: new THREE.Group(),
    arenaTemplate: "test"
  };
}

function makeGame(seed = "TESTSEED") {
  const player = {
    pos: new THREE.Vector3(0, 0, 0),
    vel: new THREE.Vector3(),
    yaw: 0,
    onGround: true,
    isDead: false,
    invulnT: 0,
    damageTaken: [],
    takeDamage(amount, sourcePos) {
      if (this.invulnT > 0) return;
      this.damageTaken.push(amount);
    },
    addShake() {}
  };
  const kills = [];
  const game = {
    scene: new THREE.Scene(),
    world: {
      seed,
      boxes: [],
      getRoomAt: () => null,
      rebuildBoxCache() {}
    },
    player,
    enemyManager: { zombies: [] },
    perks: { mods: { barrelImmune: false } },
    particles: { spawn() {}, rocketSmoke() {}, sparks() {} },
    gore: { shockwave() {}, spawnGibs() {}, explosion() {} },
    fx: { explosion() {} },
    audio: { play() {} },
    levelManager: { arenas: [] },
    damageZombie(enemy, dmg, isHead, push, source) {
      kills.push({ enemy, dmg, isHead, push: push.clone(), source });
    }
  };
  return { game, player, kills };
}

// ── 1. Синтетические арены и размещение ──
const blockers = [
  // центральный landmark
  { x: 0, z: 0, w: 6, d: 6, y: 0, h: 10, kind: "landmark" },
  // ярус-платформа 8x8 на высоте 3.6
  { x: 12, z: -12, w: 8, d: 8, y: 3.6, h: 0.5, kind: "platform" },
  // низкие укрытия
  { x: -14, z: 6, w: 1.6, d: 8, y: 0, h: 2.2, kind: "block" },
  { x: 10, z: 12, w: 6, d: 1.6, y: 0, h: 2.2, kind: "block" },
  { x: -8, z: -14, w: 3, d: 3, y: 0, h: 2.2, kind: "block" }
];
const room = makeRoom({ blocks: blockers });
const { game, player, kills } = makeGame();

const manager = new BarrelManager(game);
game.levelManager.arenas.push({ state: "active", room });
manager.populateArena(room, game.levelManager.arenas[0]);

const count = manager.list.length;
check("На арене 4–8 бочек", count >= 4 && count <= 8, "count=" + count);

function gapToBlock(x, z, blk) {
  const H = 0.45;
  const bx0 = blk.x - blk.w / 2, bx1 = blk.x + blk.w / 2;
  const bz0 = blk.z - blk.d / 2, bz1 = blk.z + blk.d / 2;
  const dx = Math.max(0, Math.max(bx0 - (x + H), x - H - bx1));
  const dz = Math.max(0, Math.max(bz0 - (z + H), z - H - bz1));
  return Math.hypot(dx, dz);
}
const isTier = (b) => b.y >= 2.2 || ["platform", "landmark", "bridge", "ramp"].includes(b.kind);

const bd = room.bounds;
let geomErrors = [];
for (const b of manager.list) {
  if (b.pos.x < bd.min.x + 1.049 || b.pos.x > bd.max.x - 1.049 || b.pos.z < bd.min.z + 1.049 || b.pos.z > bd.max.z - 1.049) {
    geomErrors.push("стена");
  }
  if (Math.hypot(b.pos.x, b.pos.z) < 5.6 - 1e-6) geomErrors.push("центр");
  if (Math.hypot(b.pos.x - 0, b.pos.z + 24) < 4.5 - 1e-6) geomErrors.push("дверь N");
  if (Math.hypot(b.pos.x - 0, b.pos.z - 24) < 4.5 - 1e-6) geomErrors.push("дверь S");
  if (Math.hypot(b.pos.x + 24, b.pos.z) < 4.5 - 1e-6) geomErrors.push("дверь W");
  if (Math.hypot(b.pos.x - 24, b.pos.z) < 4.5 - 1e-6) geomErrors.push("дверь E");
  for (const blk of room.blocks) {
    const gap = gapToBlock(b.pos.x, b.pos.z, blk);
    const min = isTier(blk) ? 3.0 : 0.55;
    if (gap < min - 1e-6) geomErrors.push(`блок ${blk.kind} gap=${gap.toFixed(2)}`);
  }
}
check("Геометрия размещения: стены/центр/двери/блоки", geomErrors.length === 0, geomErrors.join("; "));

let overlap = null;
for (let i = 0; i < manager.list.length; i++) {
  for (let j = i + 1; j < manager.list.length; j++) {
    const a = manager.list[i].pos, b = manager.list[j].pos;
    if (Math.hypot(a.x - b.x, a.z - b.z) < 0.95 - 1e-6) overlap = `${i}-${j}`;
  }
}
check("Бочки не пересекаются", overlap === null, overlap || "");

check("Бочки в общей группе менеджера", manager.list.every((b) => b.group && b.group.parent === manager.root));
check("Коллайдеры добавлены", manager.list.every((b) => room.boxes.includes(b.box) && game.world.boxes.includes(b.box)));
check("Коллайдер AABB 0.9×1.2×0.9", manager.list.every((b) => {
  const s = new THREE.Vector3().subVectors(b.box.max, b.box.min);
  return Math.abs(s.x - 0.9) < 1e-9 && Math.abs(s.y - 1.2) < 1e-9 && Math.abs(s.z - 0.9) < 1e-9;
}));

// Детерминированность по сиду
const room2 = makeRoom({ id: 1, blocks: blockers.map((b) => ({ ...b })) });
const m2 = new BarrelManager(game);
m2.populateArena(room2, game.levelManager.arenas[0]);
const sig1 = manager.list.map((b) => `${b.pos.x.toFixed(3)},${b.pos.z.toFixed(3)}`).join("|");
const sig2 = m2.list.map((b) => `${b.pos.x.toFixed(3)},${b.pos.z.toFixed(3)}`).join("|");
check("Размещение детерминировано по сиду", sig1 === sig2);

// Маленькая exit-арена
const exitRoom = makeRoom({ id: 7, w: 24, d: 24, h: 12, doors: ["north"], blocks: [] });
exitRoom.boxes.push({ min: new THREE.Vector3(-3, 0, -3), max: new THREE.Vector3(3, 0.4, 3) });
const mExit = new BarrelManager(game);
mExit.populateArena(exitRoom, game.levelManager.arenas[0]);
check("Маленькая exit-арена: 4–8 бочек", mExit.list.length >= 4 && mExit.list.length <= 8, "count=" + mExit.list.length);

// Арена с ямой
const pitRoom = makeRoom({
  id: 9,
  w: 50,
  d: 50,
  blocks: [{ x: 0, z: 0, w: 3.2, d: 3.2, y: 0, h: 8.5, kind: "landmark" }],
  pit: { x: 0, z: 0, w: 26, d: 26, depth: 4 }
});
const mPit = new BarrelManager(game);
mPit.populateArena(pitRoom, game.levelManager.arenas[0]);
const pitOk = mPit.list.every((b) => {
  const p = pitRoom.pit;
  return !(b.pos.x + 0.45 > p.x - p.w / 2 - 0.4 && b.pos.x - 0.45 < p.x + p.w / 2 + 0.4 &&
    b.pos.z + 0.45 > p.z - p.d / 2 - 0.4 && b.pos.z - 0.45 < p.z + p.d / 2 + 0.4);
});
check("Бочки не стоят над ямой", pitOk, "count=" + mPit.list.length);

// ── 2. Попадания и блокировка луча ──
const hitRoom = makeRoom({ id: 20 });
const m3 = new BarrelManager(game);
const b1 = new ExplosiveBarrel(m3, 0, -5, { room: hitRoom, arena: game.levelManager.arenas[0] });
m3.list.push(b1);
const enemy = {
  alive: true,
  pos: new THREE.Vector3(0, 0, -12),
  headMin: new THREE.Vector3(-0.28, 1.48, -12.28),
  headMax: new THREE.Vector3(0.28, 2.1, -11.72),
  bodyMin: new THREE.Vector3(-0.45, 0, -12.45),
  bodyMax: new THREE.Vector3(0.45, 1.48, -11.55)
};
const origin = new THREE.Vector3(0, 1.2, 0);
const dir = new THREE.Vector3(0, 0, -1);
const ray = castSceneRay(origin, dir, 40, 0, [], [], [enemy], m3.list);
check("Рейкаст попадает в бочку (цилиндр)", !!ray && ray.barrel === b1 && !ray.enemy);
check("Луч не проваливается к врагу за бочкой", !!ray && ray.t < 5.5, ray ? "t=" + ray.t.toFixed(2) : "no hit");

const noBarrelRay = castSceneRay(origin, dir, 40, 0, [], [], [enemy], []);
check("Без бочки луч попадает во врага", !!noBarrelRay && noBarrelRay.enemy === enemy);

// ── 3. Взрыв: урон врагам/игроку, цепь, стиль, перк ──
const exRoom = makeRoom({ id: 30 });
const m4 = new BarrelManager(game);
const arena4 = { state: "active", room: exRoom };
const a = new ExplosiveBarrel(m4, 0, -5, { room: exRoom, arena: arena4 });
const b = new ExplosiveBarrel(m4, 0, -1, { room: exRoom, arena: arena4 }); // в радиусе 4 м
m4.list.push(a, b);
const targetEnemy = {
  alive: true,
  pos: new THREE.Vector3(1, 0, -5),
  type: "zombie"
};
game.enemyManager.zombies = [targetEnemy];
player.pos.set(2, 0, -5);
player.damageTaken.length = 0;
kills.length = 0;

a.takeDamage(30);
check("Бочка исчезает из коллизий", !exRoom.boxes.includes(a.box) && !game.world.boxes.includes(a.box));
check("Враг получил урон от бочки", kills.length === 1 && kills[0].dmg > 0 && kills[0].dmg <= 80, kills[0] ? "dmg=" + kills[0].dmg : "no damage");
check("Урон передан с источником barrel", kills.length > 0 && kills[0].source.weapon === "barrel" && kills[0].source.isExplosion === true);
check("Враг отбрасывается", kills.length > 0 && kills[0].push.length() > 0);
check("Игрок получил 20 урона", player.damageTaken.length === 1 && player.damageTaken[0] === 20, JSON.stringify(player.damageTaken));
check("Соседняя бочка запланирована к взрыву", b.alive && b.chainTimer > 0.14);
check("Задержка цепи 0.15 с", Math.abs(b.chainTimer - 0.15) < 1e-6);

// До истечения задержки — не взорвалась
m4.update(0.1);
check("Цепь ждёт 0.15 с", b.alive);
m4.update(0.1);
check("Цепная реакция сработала", !b.alive);

// Перк «Бочкам привет»
const game2 = makeGame("PERK").game;
const m5 = new BarrelManager(game2);
const perkRoom = makeRoom({ id: 40 });
const arena5 = { state: "active", room: perkRoom };
const c = new ExplosiveBarrel(m5, 0, -5, { room: perkRoom, arena: arena5 });
m5.list.push(c);
game2.perks.mods.barrelImmune = true;
game2.player.pos.set(0.5, 0, -5);
game2.player.damageTaken.length = 0;
c.takeDamage(30);
check("Перк «Бочкам привет»: урон игроку 0", game2.player.damageTaken.length === 0);

// Мигание ниже 50%: клон материала только у этой бочки
const blinkRoom = makeRoom({ id: 50 });
const m6 = new BarrelManager(game);
const bl = new ExplosiveBarrel(m6, 0, -6, { room: blinkRoom, arena: { state: "active", room: blinkRoom } });
m6.list.push(bl);
const sharedMat = bl.mesh.material;
bl.takeDamage(20); // hp 10 < 15
check("Материал мигания клонируется у повреждённой бочки", bl.mesh.material !== sharedMat && bl.blinkMaterial !== null);
check("Клон не помечен shared", bl.mesh.material.userData.shared === false);

// ── 4. Отладочный спавн перед игроком ──
const dbgRoom = makeRoom({ id: 60 });
game.world.getRoomAt = () => dbgRoom;
game.player.pos.set(0, 0, 0);
game.player.yaw = 0; // смотрит в -Z
const before = m3.list.length;
const dbg = m3.spawnInFrontOfPlayer(5);
check("Отладочный спавн создаёт бочку", !!dbg && m3.list.length === before + 1);
check("Бочка появляется в ~5 м впереди", !!dbg && Math.abs(dbg.pos.z - -5) < 0.01, dbg ? `z=${dbg.pos.z}` : "");

console.log(`\nИТОГО: ${failures === 0 ? "все проверки пройдены" : failures + " ошибок"}`);
process.exit(failures === 0 ? 0 : 1);
