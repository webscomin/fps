// Управление летящими снарядами (ракеты) и механика взрывов (rocket jump)
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { outlined, castSceneRay, rnd } from "../core/Physics.js";
import { createToonMaterial } from "../world/Materials.js";

export class Projectiles {
  /**
   * @param {THREE.Scene} scene
   * @param {Object} game
   */
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;

    this.pools = {
      rocket: []
    };

    // Переиспользуемые векторы для update()/explode()
    this._nextPos = new THREE.Vector3();
    this._moveDir = new THREE.Vector3();
    this._tmpVec = new THREE.Vector3();

    // Динамический свет от взрыва (озаряет тёмные комнаты)
    this._explLight = new THREE.PointLight(0xff6611, 0, 32);
    this.scene.add(this._explLight);
    this._explLightTimer = 0;

    this.buildPools();
  }

  buildPools() {
    const H = Math.PI / 2;

    // Пул ракет (6 шт)
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      const body = outlined(
        new THREE.CylinderGeometry(0.1, 0.1, 0.5, 10),
        createToonMaterial(0xff4f8b)
      );
      body.rotation.x = H;

      const cone = outlined(
        new THREE.ConeGeometry(0.1, 0.25, 10),
        createToonMaterial(0xffd23f)
      );
      cone.rotation.x = H;
      cone.position.z = 0.37;

      const f1 = outlined(
        new THREE.BoxGeometry(0.3, 0.03, 0.16),
        createToonMaterial(0x7c5cff)
      );
      f1.position.z = -0.22;

      const f2 = outlined(
        new THREE.BoxGeometry(0.03, 0.3, 0.16),
        createToonMaterial(0x7c5cff)
      );
      f2.position.z = -0.22;

      g.add(body, cone, f1, f2);

      g.visible = false;
      this.scene.add(g);
      this.pools.rocket.push({
        m: g,
        pos: g.position,
        vel: new THREE.Vector3(),
        from: new THREE.Vector3(),
        life: 0,
        on: false,
        dmg: 0,
        r: 0.15,
        trail: 0
      });
    }
  }

  /**
   * Выпустить ракету
   */
  spawnRocket(origin, dir, cfg) {
    const p = this.pools.rocket.find((q) => !q.on);
    if (!p) return;

    p.on = true;
    p.life = cfg.life;
    p.dmg = cfg.damage;
    p.r = cfg.projRadius;
    p.trail = 0;
    p.vel.copy(dir).multiplyScalar(cfg.projSpeed);
    p.from.copy(origin);
    p.pos.copy(origin);
    p.m.lookAt(origin.clone().add(p.vel));
    p.m.visible = true;
  }

  /**
   * Взрыв ракеты с радиусом поражения и импульсом rocket jump
   */
  explode(pt, world, targets, zombies, fx, player) {
    const c = CONFIG.weapons.rocket;
    const R = c.explosionRadius;

    if (fx && fx.explosion) {
      fx.explosion(pt);
    }
    if (this._explLight) {
      this._explLight.position.copy(pt);
      this._explLight.intensity = 8.5;
      this._explLightTimer = 0.12;
    }
    if (this.game.particles && !CONFIG.feel?.reduced) {
      this.game.particles.rocketSmoke(pt, CONFIG.feel?.particles?.rocketSmokeCount ?? 14);
    }
    if (this.game.audio) this.game.audio.play("explosion");

    // Урон мишеням
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (!t.alive) continue;
      const dx = pt.x - Math.max(t.min.x, Math.min(pt.x, t.max.x));
      const dy = pt.y - Math.max(t.min.y, Math.min(pt.y, t.max.y));
      const dz = pt.z - Math.max(t.min.z, Math.min(pt.z, t.max.z));
      const d = Math.hypot(dx, dy, dz);
      if (d < R) {
        const dm = Math.round(c.explosionDamage * (1 - d / R));
        if (dm > 0) this.game.damageTarget(t, dm);
      }
    }

    // Урон и отталкивание зомби
    for (let i = 0; i < zombies.length; i++) {
      const z = zombies[i];
      if (!z.alive) continue;
      const d = z.pos.distanceTo(pt);
      if (d < R) {
        const falloff = 1 - d / R;
        const dm = Math.round(c.explosionDamage * falloff);
        const pushVec = z.pos.clone().sub(pt);
        if (pushVec.length() > 1e-4) pushVec.normalize();
        else pushVec.set(0, 1, 0);
        pushVec.multiplyScalar(c.pushEnemy * falloff);
        if (dm > 0) this.game.damageZombie(z, dm, false, pushVec, { weapon: "rocket", isExplosion: true });
      }
    }

    // Урон взрывным бочкам в радиусе (прямое попадание и сплэш)
    const barrelManager = this.game.barrels;
    if (barrelManager) {
      const barrels = barrelManager.list;
      for (let i = 0; i < barrels.length; i++) {
        const b = barrels[i];
        if (!b.alive) continue;
        const dx = b.pos.x - pt.x;
        const dy = b.pos.y + 0.6 - pt.y;
        const dz = b.pos.z - pt.z;
        const d = Math.hypot(dx, dy, dz);
        if (d < R) {
          const dm = Math.round(c.explosionDamage * (1 - d / R));
          if (dm > 0) barrelManager.damage(b, dm);
        }
      }
    }

    // Rocket Jump для игрока
    const pCenter = new THREE.Vector3(player.pos.x, player.pos.y + 0.9, player.pos.z);
    const toPlayer = pCenter.clone().sub(pt);
    const d = toPlayer.length();

    if (d < R) {
      const f = c.jumpForce * (1 - d / R);
      if (d > 1e-4) toPlayer.divideScalar(d);
      else toPlayer.set(0, 1, 0);

      if (toPlayer.y > 0 && player.vel.y < 0) player.vel.y = 0;
      player.vel.addScaledVector(toPlayer, f);
      if (f * toPlayer.y > 2) player.onGround = false;
    }

    player.addShake(0.05 * Math.max(0, 1 - d / 18), 0.35);
  }

  update(dt, world, targets, zombies, fx, player) {
    if (this._explLightTimer > 0) {
      this._explLightTimer -= dt;
      if (this._explLightTimer <= 0) {
        this._explLight.intensity = 0;
      } else {
        this._explLight.intensity = (this._explLightTimer / 0.12) * 8.5;
      }
    }

    const nextPos = this._nextPos;
    const moveDir = this._moveDir;
    const barrels = this.game && this.game.barrels ? this.game.barrels.list : [];

    for (const kind in this.pools) {
      for (let i = 0; i < this.pools[kind].length; i++) {
        const p = this.pools[kind][i];
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
        if (len < 1e-6) continue;
        moveDir.divideScalar(len);

        const boxes = world.getNearbyBoxes ? world.getNearbyBoxes(p.pos) : world.boxes;
        let hit = castSceneRay(p.from, moveDir, len, p.r, boxes, targets, zombies, barrels);

        // Страховка для пола (y = 0): если снаряд пересекает уровень пола вне ямы
        const floorY = 0;
        if (p.from.y >= floorY && nextPos.y <= floorY + p.r && p.vel.y < 0) {
          let inPit = false;
          if (world && world.rooms) {
            for (let ri = 0; ri < world.rooms.length; ri++) {
              const pit = world.rooms[ri].pit;
              if (!pit) continue;
              if (
                Math.abs(nextPos.x - pit.x) <= pit.w * 0.5 &&
                Math.abs(nextPos.z - pit.z) <= pit.d * 0.5
              ) {
                inPit = true;
                break;
              }
            }
          }
          if (!inPit) {
            const denom = nextPos.y - p.from.y;
            const frac = Math.abs(denom) > 1e-6 ? Math.max(0, Math.min(1, (floorY + p.r - p.from.y) / denom)) : 0;
            const floorT = frac * len;
            if (!hit || floorT < hit.t) {
              hit = {
                t: floorT,
                point: p.from.clone().addScaledVector(moveDir, floorT),
                normal: new THREE.Vector3(0, 1, 0)
              };
            }
          }
        }

        if (hit) {
          p.on = false;
          p.m.visible = false;

          if (hit.barrel) {
            // Бочка взрывается от ракеты
            this.explode(hit.point, world, targets, zombies, fx, player);
            continue;
          }

          // Ракета
          const explPoint = this._tmpVec.copy(hit.point);
          if (!hit.target && !hit.enemy) {
            explPoint.addScaledVector(hit.normal, 0.05);
          }
          this.explode(explPoint, world, targets, zombies, fx, player);
          continue;
        }

        p.from.copy(p.pos);
        p.pos.copy(nextPos);

        // Хвост дыма для ракеты
        if (kind === "rocket") {
          p.trail -= dt;
          if (p.trail <= 0) {
            p.trail = 0.03;
            if (fx && fx.particles) {
              fx.particles.spawn(
                p.pos.x,
                p.pos.y,
                p.pos.z,
                rnd(0.4),
                rnd(0.4),
                rnd(0.4),
                0x9a98b8,
                0.2,
                0.6,
                0,
                1
              );
              fx.particles.spawn(
                p.pos.x,
                p.pos.y,
                p.pos.z,
                rnd(0.3),
                rnd(0.3),
                rnd(0.3),
                0xff9a2a,
                0.12,
                0.2,
                0,
                0
              );
            }
          }
        }
      }
    }
  }
}
