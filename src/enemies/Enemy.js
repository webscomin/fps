// Базовый класс врага: хитбоксы, здоровье, состояния, получение урона, оглушение и физика коллизий
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { disposeObject3D, rayAABB, resolveBoxCollision } from "../core/Physics.js";
import { createBlobShadow } from "../world/Materials.js";

export class Enemy {
  /**
   * @param {THREE.Scene} scene
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} health
   * @param {number} speed
   */
  constructor(scene, x, y, z, health, speed) {
    this.scene = scene;
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3();
    this.speed = speed;
    this.hp = health;
    this.maxHp = health;
    this.state = "idle"; // idle, chase, attack, stagger, unreachable, stunned, dead
    this.alive = true;

    this.flashT = 0;
    this.stunTimer = 0;
    this.squashT = 0;
    this.baseScale = new THREE.Vector3(1, 1, 1);

    this.bodyMin = new THREE.Vector3();
    this.bodyMax = new THREE.Vector3();
    this.headMin = new THREE.Vector3();
    this.headMax = new THREE.Vector3();

    // Переиспользуемые векторы для горячего пути (без аллокаций каждый кадр)
    this._toPlayer = new THREE.Vector3();
    this._dirToPlayer = new THREE.Vector3();
    this._tmpOrigin = new THREE.Vector3();
    this._tmpTarget = new THREE.Vector3();
    this._tmpDir = new THREE.Vector3();
    this._leftDir = new THREE.Vector3();
    this._rightDir = new THREE.Vector3();

    this.group = new THREE.Group();
    this.group.position.copy(this.pos);

    // Фальшивая круглая тень на полу: без дорогих shadow map
    this.shadowBaseScale = 1.15;
    this.shadow = createBlobShadow(this.shadowBaseScale);
    this.shadow.visible = false;
    this.scene.add(this.shadow);
  }

  /**
   * Обновить тень-пятно под врагом. Тень всегда лежит на полу комнаты
   * и уменьшается, когда враг поднимается выше (прыжок, платформа).
   */
  updateShadow() {
    if (!this.shadow) return;
    if (!this.alive || !this.group.visible) {
      this.shadow.visible = false;
      return;
    }
    const groundY = 0.032;
    const height = Math.max(0, this.pos.y - groundY);
    const shrink = Math.max(0.35, 1 - height * 0.075);
    const s = this.shadowBaseScale * shrink;
    this.shadow.visible = true;
    this.shadow.position.set(this.pos.x, groundY, this.pos.z);
    this.shadow.scale.set(s, 1, s);
  }

  setFlash(on) {
    // Переопределяется в наследнике для смены emissive материалов
  }

  updateHitboxes() {
    const x = this.pos.x;
    const y = this.pos.y;
    const z = this.pos.z;
    this.bodyMin.set(x - 0.45, y, z - 0.45);
    this.bodyMax.set(x + 0.45, y + 1.48, z + 0.45);
    this.headMin.set(x - 0.28, y + 1.48, z - 0.28);
    this.headMax.set(x + 0.28, y + 2.1, z + 0.28);
  }

  /**
   * Сквош и стретч (сплющивание) врага при получении урона для сочности
   */
  updateSquash(dt) {
    if (this.squashT <= 0) {
      if (this.group) {
        this.group.scale.set(this.baseScale.x, this.baseScale.y, this.baseScale.z);
      }
      return;
    }
    this.squashT -= dt;
    const cfg = CONFIG.feel?.enemy;
    const totalDur = cfg?.squashDuration ?? 0.12;
    const k = Math.max(0, this.squashT / totalDur);
    const wave = Math.sin(k * Math.PI);
    const squashY = cfg?.squashScaleY ?? 0.12;
    const stretchXZ = cfg?.squashScaleXZ ?? 0.06;
    const mult = CONFIG.feel?.intensity ?? 1.0;
    const sy = 1 - squashY * wave * mult;
    const sxz = 1 + stretchXZ * wave * mult;
    if (this.group) {
      this.group.scale.set(this.baseScale.x * sxz, this.baseScale.y * sy, this.baseScale.z * sxz);
    }
  }

  takeDamage(dmg, isHeadshot, pushVec, fx, game) {
    if (!this.alive) return;
    const finalDmg = isHeadshot ? dmg * 2 : dmg;
    this.hp -= finalDmg;
    this.flashT = 0.08;
    this.setFlash(true);

    if (!CONFIG.feel?.reduced) {
      this.squashT = CONFIG.feel?.enemy?.squashDuration ?? 0.12;
    }

    if (fx) {
      fx.popup(this.pos.x, this.pos.y + 2.2, this.pos.z, Math.round(finalDmg), isHeadshot);
      const hitNormal = pushVec ? pushVec.clone().normalize().negate() : new THREE.Vector3(0, 1, 0);
      fx.bloodSpray(this.pos, hitNormal, finalDmg);
    }

    if (pushVec) {
      this.vel.addScaledVector(pushVec, 0.4);
    }

    // Проверка на смерть
    if (this.hp <= 0) {
      const wasStunned = this.state === "stunned";
      this.die(isHeadshot, pushVec, fx, game, false, wasStunned);
      return;
    }

    // Проверка оглушения (< 25% HP)
    if (this.hp <= this.maxHp * CONFIG.glory.stunThreshold && this.state !== "stunned") {
      this.state = "stunned";
      this.stunTimer = CONFIG.glory.stunDuration;
      return;
    }

    if (this.state !== "stunned") {
      this.state = "stagger";
      this.staggerT = CONFIG.enemies.zombie.staggerTime;
    }
  }

  die(isHeadshot, pushVec, fx, game, isGloryKill = false, wasStunned = false) {
    this.alive = false;
    this.state = "dead";
    this.group.visible = false;

    const C = CONFIG.enemies.zombie;
    const pts = isGloryKill ? CONFIG.glory.score : isHeadshot ? C.scoreValue + C.headshotBonus : C.scoreValue;
    game.onZombieKill(pts, isHeadshot, isGloryKill, this);

    const isOverkill = isGloryKill || (pushVec && pushVec.length() > 16);
    const gibCount = isOverkill ? 14 : isHeadshot ? 8 : 6;

    if (fx) {
      fx.zombieGibs(this.pos, gibCount, isHeadshot);
      if (fx.decals) {
        fx.decals.add(this.pos, new THREE.Vector3(0, 1, 0), CONFIG.effects.blood.zombieColor, 1.4);
      }
    }

    // Спавн лута
    if (game.spawnDrops) {
      game.spawnDrops(this.pos, isGloryKill, wasStunned);
    }
  }

  alert(player = null) {
    if (!this.alive) return;
    if (this.state === "idle") {
      this.state = "chase";
    }
  }

  steer(targetDir, world) {
    const origin = this._tmpOrigin.set(this.pos.x, this.pos.y + 0.8, this.pos.z);
    let forwardBlocked = false;

    // Оптимизация: проверяем только ближайшие коробки
    const boxes = world && world.getNearbyBoxes ? world.getNearbyBoxes(this.pos) : (world ? world.boxes : []);

    for (const b of boxes) {
      const h = rayAABB(origin, targetDir, b.min, b.max, 0.4);
      if (h && h.t < 1.8) {
        forwardBlocked = true;
        break;
      }
    }

    if (!forwardBlocked) return targetDir;

    const leftDir = this._leftDir.set(
      targetDir.x * 0.707 - targetDir.z * 0.707,
      0,
      targetDir.x * 0.707 + targetDir.z * 0.707
    );
    const rightDir = this._rightDir.set(
      targetDir.x * 0.707 + targetDir.z * 0.707,
      0,
      -targetDir.x * 0.707 + targetDir.z * 0.707
    );

    let leftT = 10;
    let rightT = 10;

    for (const b of boxes) {
      const hl = rayAABB(origin, leftDir, b.min, b.max, 0.4);
      if (hl && hl.t < leftT) leftT = hl.t;
      const hr = rayAABB(origin, rightDir, b.min, b.max, 0.4);
      if (hr && hr.t < rightT) rightT = hr.t;
    }

    return leftT > rightT ? leftDir : rightDir;
  }

  /**
   * Комната, к которой привязан враг: комната его арены (или ближайшая на
   * момент первого вызова для отладочного спавна). За её стены враг не выходит.
   */
  getBoundRoom(world) {
    if (this.arena && this.arena.room) return this.arena.room;
    if (this.boundRoom) return this.boundRoom;
    const room = world && world.getRoomAt ? world.getRoomAt(this.pos) : null;
    if (room) this.boundRoom = room;
    return room;
  }

  /**
   * Удержать позицию внутри комнаты, чтобы врага не вытолкнуло за стену
   * расталкиванием или спорной коллизией.
   */
  clampToRoom(pos, radius, room = null) {
    if (!room) return;
    const b = room.bounds;
    const margin = radius + 0.05;
    pos.x = Math.max(b.min.x + margin, Math.min(b.max.x - margin, pos.x));
    pos.z = Math.max(b.min.z + margin, Math.min(b.max.z - margin, pos.z));
  }

  move(dt, world) {
    const sdt = dt;
    const r = CONFIG.enemies.zombie.hitboxRadius;
    const boxes = world && world.getNearbyBoxes ? world.getNearbyBoxes(this.pos) : (world ? world.boxes : []);

    this.pos.x += this.vel.x * sdt;
    resolveBoxCollision(this.pos, this.vel, r, CONFIG.enemies.zombie.hitboxHeight, boxes, "x", CONFIG.enemies.zombie.collisionEps);

    this.pos.z += this.vel.z * sdt;
    resolveBoxCollision(this.pos, this.vel, r, CONFIG.enemies.zombie.hitboxHeight, boxes, "z", CONFIG.enemies.zombie.collisionEps);

    this.pos.y += this.vel.y * sdt;
    resolveBoxCollision(this.pos, this.vel, r, CONFIG.enemies.zombie.hitboxHeight, boxes, "y", CONFIG.enemies.zombie.collisionEps);

    // Не позволяем расталкиванию вытолкнуть врага за стену его комнаты
    this.clampToRoom(this.pos, r, this.getBoundRoom(world));

    // Гарантия нахождения внутри границ уровня
    const half = (world && world.rooms && world.rooms.length > 0)
      ? (CONFIG.level.gridSize * CONFIG.level.cellSize) / 2
      : CONFIG.world.roomSize / 2;
    const margin = r + 0.05;
    this.pos.x = Math.max(-half + margin, Math.min(half - margin, this.pos.x));
    this.pos.z = Math.max(-half + margin, Math.min(half - margin, this.pos.z));
  }

  /**
   * Освободить геометрию и материалы модели врага.
   * Материалы/геометрии создаются индивидуально для каждого врага,
   * поэтому их можно безопасно удалять после смерти (кроме общих EDGE_MAT и текстур).
   */
  disposeModel() {
    disposeObject3D(this.group);
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.alive = false;
    this.scene.remove(this.group);
    if (this.shadow) {
      this.scene.remove(this.shadow);
      this.shadow = null;
    }
    this.disposeModel();
  }
}
