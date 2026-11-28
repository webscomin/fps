// Дробовик: стрельба снопом дроби, расчёт разброса, падение урона с расстоянием и отдача в воздухе
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { castSceneRay } from "../core/Physics.js";
import { Weapon } from "./Weapon.js";

export class Shotgun extends Weapon {
  /**
   * @param {Object} game
   */
  constructor(game) {
    super("shotgun", CONFIG.weapons.shotgun, game);
  }

  /**
   * Произвести выстрел
   */
  fire(player, camera, world, targets, zombies, fx) {
    const c = this.cfg;
    this.ammo--;
    this.cool = c.cooldown;

    const dir = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    camera.getWorldDirection(dir);
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    up.set(0, 1, 0).applyQuaternion(camera.quaternion);

    const dmTargets = new Map();
    const dmZombies = new Map();
    const dmBarrels = new Map();
    const barrels = this.game && this.game.barrels ? this.game.barrels.list : [];
    const tmpDir = new THREE.Vector3();

    for (let i = 0; i < c.pellets; i++) {
      this.spreadDir(dir, right, up, c.spread, tmpDir);
      const hit = castSceneRay(camera.position, tmpDir, c.range, 0, world.boxes, targets, zombies, barrels);
      if (!hit) continue;

      let k = 1;
      if (hit.t > c.falloffStart) {
        k = 1 - (1 - c.falloffMin) * Math.min(1, (hit.t - c.falloffStart) / (c.range - c.falloffStart));
      }
      const pDmg = c.damage * k;

      if (hit.barrel) {
        // Бочка останавливает дробь: сквозь неё в врага позади попадания нет
        dmBarrels.set(hit.barrel, (dmBarrels.get(hit.barrel) || 0) + pDmg);
      } else if (hit.enemy) {
        const entry = dmZombies.get(hit.enemy) || { dmg: 0, isHead: false, push: new THREE.Vector3() };
        entry.dmg += pDmg;
        if (hit.isHead) entry.isHead = true;
        entry.push.addScaledVector(tmpDir, c.pushEnemy * 0.1);
        dmZombies.set(hit.enemy, entry);
      } else if (hit.target) {
        dmTargets.set(hit.target, (dmTargets.get(hit.target) || 0) + pDmg);
      } else {
        if (fx && fx.decals) {
          if (typeof fx.decals.addBulletHole === "function") {
            fx.decals.addBulletHole(hit.point, hit.normal);
          } else {
            fx.decals.add(hit.point, hit.normal, 0x1f1f1f, 0.25);
          }
        }
      }

      if (fx && fx.particles) {
        fx.particles.sparks(hit.point, hit.normal, 0xffd23f, 3);
      }
    }

    for (const [t, d] of dmTargets) {
      this.game.damageTarget(t, d);
    }

    for (const [b, d] of dmBarrels) {
      this.game.damageBarrel(b, d);
    }

    for (const [z, entry] of dmZombies) {
      this.game.damageZombie(z, entry.dmg, entry.isHead, entry.push, { weapon: "shotgun", isExplosion: false });
    }

    if (!player.onGround) {
      player.vel.addScaledVector(dir, -c.airPush);
    }

    // Отдача и встряска
    player.recoil += (c.recoil * Math.PI) / 180;
    player.addShake(c.shake, c.shakeTime);
  }
}
