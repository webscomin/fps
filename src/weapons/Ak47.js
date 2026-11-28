// АК-47: автоматический огонь 10 выстр/с, hitscan, нарастающий разброс, визуальная отдача и трассеры
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { castSceneRay } from "../core/Physics.js";
import { Weapon } from "./Weapon.js";

export class Ak47 extends Weapon {
  /**
   * @param {Object} game
   */
  constructor(game) {
    super("ak47", CONFIG.weapons.ak47, game);
    this.currentSpread = this.cfg.spread?.min ?? 0.8;
    this.shotCount = 0;
  }

  update(dt) {
    super.update(dt);

    // Восстановление разброса после остановки стрельбы
    const sMin = this.cfg.spread?.min ?? 0.8;
    const sMax = this.cfg.spread?.max ?? 3.0;
    const sRec = this.cfg.spread?.recover ?? 0.25;
    if (this.currentSpread > sMin) {
      const recoveryRate = (sMax - sMin) / Math.max(0.01, sRec);
      this.currentSpread = Math.max(sMin, this.currentSpread - recoveryRate * dt);
    }
  }

  /**
   * Произвести выстрел из АК-47
   */
  fire(player, camera, world, targets, zombies, fx) {
    const c = this.cfg;
    this.ammo--;
    this.cool = c.cooldown;
    this.shotCount++;

    // Направление взгляда камеры
    const dir = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    camera.getWorldDirection(dir);
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    up.set(0, 1, 0).applyQuaternion(camera.quaternion);

    // Текущий разброс для этого выстрела и накопление для следующего
    const shotSpread = this.currentSpread;
    const sMax = c.spread?.max ?? 3.0;
    const sPerShot = c.spread?.perShot ?? 0.12;
    this.currentSpread = Math.min(sMax, this.currentSpread + sPerShot);

    const tmpDir = new THREE.Vector3();
    this.spreadDir(dir, right, up, shotSpread, tmpDir);

    const barrels = this.game && this.game.barrels ? this.game.barrels.list : [];
    const maxRange = c.range || 80;
    const hit = castSceneRay(camera.position, tmpDir, maxRange, 0, world.boxes, targets, zombies, barrels);

    let endPoint = null;

    if (hit) {
      endPoint = hit.point;

      // Падение урона с расстояния: до 40 м 100% (12), на 80 м 60% (7.2)
      const falloffStart = c.falloffStart ?? 40;
      const falloffEnd = c.falloffEnd ?? 80;
      const falloffMin = c.falloffMin ?? 0.6;
      let k = 1.0;
      if (hit.t > falloffStart) {
        const p = Math.min(1.0, (hit.t - falloffStart) / Math.max(1, falloffEnd - falloffStart));
        k = 1.0 - (1.0 - falloffMin) * p;
      }
      const pDmg = c.damage * k;

      if (hit.barrel) {
        this.game.damageBarrel(hit.barrel, pDmg);
        if (fx && fx.particles) {
          fx.particles.sparks(hit.point, hit.normal, 0xffd23f, 3);
        }
      } else if (hit.enemy) {
        const push = tmpDir.clone().multiplyScalar((c.pushEnemy || 3) * 0.1);
        this.game.damageZombie(hit.enemy, pDmg, hit.isHead, push, { weapon: "ak47", isExplosion: false });
      } else if (hit.target) {
        this.game.damageTarget(hit.target, pDmg);
        if (fx && fx.particles) {
          fx.particles.sparks(hit.point, hit.normal, 0xffd23f, 2);
        }
      } else {
        // Попадание в стены/пол: искры и маленькая тёмная отметина
        if (fx && fx.decals) {
          if (typeof fx.decals.addBulletHole === "function") {
            fx.decals.addBulletHole(hit.point, hit.normal);
          } else {
            fx.decals.add(hit.point, hit.normal, 0x1f1f1f, 0.25);
          }
        }
        if (fx && fx.particles) {
          fx.particles.sparks(hit.point, hit.normal, 0xffd23f, 4);
        }
      }
    } else {
      endPoint = camera.position.clone().addScaledVector(tmpDir, maxRange);
    }

    // Трассер: тонкая светящаяся линия от дула до точки попадания, каждая 3-я пуля
    if (this.shotCount % 3 === 0 && fx && fx.tracers) {
      const muzzlePos =
        this.game.viewmodel && typeof this.game.viewmodel.getMuzzleWorldPosition === "function"
          ? this.game.viewmodel.getMuzzleWorldPosition()
          : camera.position.clone().addScaledVector(right, 0.25).addScaledVector(up, -0.2).addScaledVector(dir, 0.6);
      fx.tracers.spawn(muzzlePos, endPoint, 0.05);
    }

    // Отдача камеры: подъём на 0.35° вверх и лёгкое смещение вбок ±0.15°, накопление до 4°
    const maxPitchRad = ((c.recoilCamera?.maxPitch ?? 4.0) * Math.PI) / 180;
    const pitchKick = ((c.recoilCamera?.pitch ?? 0.35) * Math.PI) / 180;
    const yawRange = ((c.recoilCamera?.yaw ?? 0.15) * Math.PI) / 180;
    const yawKick = (Math.random() * 2 - 1) * yawRange;

    player.recoil = Math.min(maxPitchRad, player.recoil + pitchKick);
    player.recoilYaw = (player.recoilYaw || 0) + yawKick;
    player.addShake(c.shake, c.shakeTime);
  }
}
