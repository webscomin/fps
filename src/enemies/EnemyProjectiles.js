// Снаряды врагов (лазерные снаряды робота) с пулом объектов и коллизиями
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { rayAABB } from "../core/Physics.js";

export class EnemyProjectiles {
  /**
   * @param {THREE.Scene} scene
   * @param {Object} game
   */
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.pool = [];
    this.maxCount = CONFIG.enemies.robot?.maxProjectiles || 40;

    // Переиспользуемые векторы: update() не должен аллоцировать каждый кадр
    this._nextPos = new THREE.Vector3();
    this._moveDir = new THREE.Vector3();
    this._hitNormal = new THREE.Vector3();
    this._pMin = new THREE.Vector3();
    this._pMax = new THREE.Vector3();
    this._forward = new THREE.Vector3(0, 0, 1);
    this._hitPoint = new THREE.Vector3();

    this.buildPool();
  }

  buildPool() {
    const coreGeo = new THREE.SphereGeometry(0.12, 8, 6);
    coreGeo.scale(1, 1, 2.2);
    const glowGeo = new THREE.SphereGeometry(0.2, 8, 6);
    glowGeo.scale(1, 1, 2.4);

    const coreColor = (CONFIG.enemies.robot && CONFIG.enemies.robot.projectileCoreColor) || 0x2ee6d6;
    const glowColor = (CONFIG.enemies.robot && CONFIG.enemies.robot.projectileGlowColor) || 0x9d4edd;

    for (let i = 0; i < this.maxCount; i++) {
      const g = new THREE.Group();

      // Ядро снаряда (светящееся бирюзовое)
      const core = new THREE.Mesh(
        coreGeo,
        new THREE.MeshBasicMaterial({ color: coreColor })
      );

      // Светящаяся фиолетово-бирюзовая оболочка
      const glow = new THREE.Mesh(
        glowGeo,
        new THREE.MeshBasicMaterial({
          color: glowColor,
          transparent: true,
          opacity: 0.75,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      );
      g.add(core, glow);

      g.visible = false;
      this.scene.add(g);

      this.pool.push({
        m: g,
        pos: g.position,
        vel: new THREE.Vector3(),
        from: new THREE.Vector3(),
        life: 0,
        on: false,
        damage: 10,
        r: 0.15
      });
    }
  }

  /**
   * Заспавнить снаряд из пула
   * @param {THREE.Vector3} fromPos
   * @param {THREE.Vector3} dir - нормализованное направление
   * @param {number} [speed=38]
   * @param {number} [damage=10]
   */
  spawn(fromPos, dir, speed = 38, damage = 10) {
    // Ищем неактивный снаряд или берем снаряд с наименьшим запасом жизни
    let p = this.pool.find((item) => !item.on);
    if (!p) {
      p = this.pool.reduce((oldest, item) => (item.life < oldest.life ? item : oldest), this.pool[0]);
    }

    p.pos.copy(fromPos);
    p.from.copy(fromPos);
    p.vel.copy(dir).normalize().multiplyScalar(speed);
    p.damage = damage;
    p.life = CONFIG.enemies.robot?.projectileLife || 3.0;
    p.r = CONFIG.enemies.robot?.projectileRadius || 0.15;
    p.on = true;

    // Ориентация меша по направлению движения
    p.m.quaternion.setFromUnitVectors(this._forward, this._moveDir.copy(dir).normalize());

    p.m.visible = true;
    return p;
  }

  /** Высота потолка над точкой: комната (своя h) или коридор (corridorHeight) */
  getCeilingY(world, pos) {
    if (world && world.rooms) {
      for (const r of world.rooms) {
        const b = r.bounds;
        if (pos.x >= b.min.x && pos.x <= b.max.x && pos.z >= b.min.z && pos.z <= b.max.z) {
          return r.h;
        }
      }
      return CONFIG.level.corridorHeight;
    }
    return CONFIG.world.wallHeight;
  }

  /**
   * Обновление всех снарядов: перемещение и проверка столкновений с миром и игроком
   */
  update(dt, world, player, fx) {
    const nextPos = this._nextPos;
    const moveDir = this._moveDir;
    const hitNormal = this._hitNormal;

    // Хитбокс игрока
    const pRadius = CONFIG.player.radius + 0.1;
    const pHeight = CONFIG.player.height;
    const pMin = this._pMin.set(player.pos.x - pRadius, player.pos.y, player.pos.z - pRadius);
    const pMax = this._pMax.set(player.pos.x + pRadius, player.pos.y + pHeight, player.pos.z + pRadius);

    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      if (!p.on) continue;

      p.life -= dt;
      if (p.life <= 0) {
        p.on = false;
        p.m.visible = false;
        continue;
      }

      nextPos.copy(p.pos).addScaledVector(p.vel, dt);
      moveDir.subVectors(nextPos, p.from);
      const len = moveDir.length();
      if (len < 1e-5) continue;
      moveDir.divideScalar(len);

      let closestT = len;
      let hitTarget = null; // "player" | "world"
      hitNormal.set(0, 1, 0);

      // 1. Проверка столкновения со стенами и блоками мира
      const boxes = world && world.getNearbyBoxes ? world.getNearbyBoxes(p.pos) : (world ? world.boxes : []);
      for (let j = 0; j < boxes.length; j++) {
        const b = boxes[j];
        const h = rayAABB(p.from, moveDir, b.min, b.max, p.r);
        if (h && h.t < closestT) {
          closestT = h.t;
          hitTarget = "world";
          hitNormal.set(0, 0, 0);
          const ax = ["x", "y", "z"][h.a];
          hitNormal[ax] = h.s;
        }
      }

      // Проверка пола и потолка
      if (moveDir.y < -1e-5) {
        const tFloor = (p.r - p.from.y) / moveDir.y;
        if (tFloor >= 0 && tFloor < closestT) {
          closestT = tFloor;
          hitTarget = "world";
          hitNormal.set(0, 1, 0);
        }
      }
      if (moveDir.y > 1e-5) {
        const ceilingY = this.getCeilingY(world, p.from);
        const tCeil = (ceilingY - p.r - p.from.y) / moveDir.y;
        if (tCeil >= 0 && tCeil < closestT) {
          closestT = tCeil;
          hitTarget = "world";
          hitNormal.set(0, -1, 0);
        }
      }

      // 2. Проверка столкновения с игроком
      if (!player.isDead) {
        const hPlayer = rayAABB(p.from, moveDir, pMin, pMax, p.r);
        if (hPlayer && hPlayer.t < closestT) {
          closestT = hPlayer.t;
          hitTarget = "player";
        }
      }

      // Обработка попадания
      if (hitTarget) {
        const hitPoint = this._hitPoint.copy(p.from).addScaledVector(moveDir, closestT);
        p.on = false;
        p.m.visible = false;

        const sparkColor = (CONFIG.enemies.robot && CONFIG.enemies.robot.projectileCoreColor) || 0x2ee6d6;
        if (hitTarget === "player") {
          player.takeDamage(p.damage, p.pos, this.game);
          if (fx && fx.particles) {
            fx.particles.sparks(hitPoint, hitNormal.copy(moveDir).negate(), sparkColor, 10);
          }
        } else if (hitTarget === "world") {
          if (fx && fx.particles) {
            fx.particles.sparks(hitPoint, hitNormal, sparkColor, 6);
          }
          if (fx && fx.decals) {
            fx.decals.add(hitPoint, hitNormal, 0x1b1340, 0.45);
          }
        }
        continue;
      }

      // Перемещение
      p.pos.copy(nextPos);
      p.from.copy(p.pos);
    }
  }

  clear() {
    for (let i = 0; i < this.pool.length; i++) {
      this.pool[i].on = false;
      this.pool[i].m.visible = false;
    }
  }
}
