// Ракетница: тяжёлое взрывное оружие с выхлопом дыма и высоким сплэш-уроном
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { castSceneRay, rnd } from "../core/Physics.js";
import { Weapon } from "./Weapon.js";

export class RocketLauncher extends Weapon {
  /**
   * @param {Object} game
   */
  constructor(game) {
    super("rocket", CONFIG.weapons.rocket, game);
    this.smokeT = 0;
  }

  /**
   * Произвести выстрел ракетой
   */
  fire(player, camera, world, targets, zombies, fx, projectiles) {
    const c = this.cfg;
    this.ammo--;
    this.cool = c.cooldown;

    const dir = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    camera.getWorldDirection(dir);
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    up.set(0, 1, 0).applyQuaternion(camera.quaternion);

    const shootDir = new THREE.Vector3();
    this.spreadDir(dir, right, up, c.spread || 0, shootDir);

    const muzzlePos =
      this.game?.viewmodel && typeof this.game.viewmodel.getMuzzleWorldPosition === "function"
        ? this.game.viewmodel.getMuzzleWorldPosition()
        : camera.position.clone().addScaledVector(dir, 0.9).addScaledVector(right, 0.25).addScaledVector(up, -0.15);

    // Гарантируем, что точка старта снаряда не пересекается с игроком и не уходит под пол/за стену
    const spawnPos = muzzlePos.clone();
    const toMuzzle = spawnPos.clone().sub(camera.position);
    const toMuzzleDist = toMuzzle.length();
    if (toMuzzleDist > 1e-4 && world && world.boxes) {
      const toMuzzleDir = toMuzzle.divideScalar(toMuzzleDist);
      const boxes = world.getNearbyBoxes ? world.getNearbyBoxes(camera.position) : world.boxes;
      const wallHit = castSceneRay(camera.position, toMuzzleDir, toMuzzleDist, 0.05, boxes, targets, zombies, this.game?.barrels?.list || []);
      if (wallHit) {
        spawnPos.copy(wallHit.point).addScaledVector(wallHit.normal, 0.16);
      }
    }
    const floorY = 0;
    if (player.pos.y >= floorY - 0.1 && spawnPos.y < floorY + 0.16) {
      spawnPos.y = floorY + 0.16;
    }
    const distFromCam = spawnPos.distanceTo(camera.position);
    if (distFromCam < 0.45) {
      spawnPos.copy(camera.position).addScaledVector(dir, 0.45);
      if (player.pos.y >= floorY - 0.1 && spawnPos.y < floorY + 0.16) {
        spawnPos.y = floorY + 0.16;
      }
    }

    if (projectiles) {
      projectiles.spawnRocket(spawnPos, shootDir, c);
    }

    // Выхлоп у дула (искры и дым) и задний выхлоп (backblast) с тыла трубы
    if (fx && fx.particles) {
      fx.particles.sparks(muzzlePos, dir, 0xffaa33, 10);
      for (let i = 0; i < 4; i++) {
        fx.particles.spawn(
          muzzlePos.x + rnd(0.06),
          muzzlePos.y + rnd(0.06),
          muzzlePos.z + rnd(0.06),
          dir.x * (2.2 + Math.random() * 1.5) + rnd(0.6),
          dir.y * (2.2 + Math.random() * 1.5) + rnd(0.6) + 0.3,
          dir.z * (2.2 + Math.random() * 1.5) + rnd(0.6),
          i % 2 === 0 ? 0xffb86c : 0xd0cedc,
          0.14 + Math.random() * 0.08,
          0.12,
          0.1,
          1.4
        );
      }

      const backblastPos =
        this.game?.viewmodel && typeof this.game.viewmodel.getBackblastWorldPosition === "function"
          ? this.game.viewmodel.getBackblastWorldPosition()
          : camera.position.clone().addScaledVector(dir, 0.1).addScaledVector(right, 0.35).addScaledVector(up, -0.2);

      const backDir = dir.clone().negate();
      fx.particles.sparks(backblastPos, backDir, 0xff9a2a, 8);
      for (let i = 0; i < 6; i++) {
        fx.particles.spawn(
          backblastPos.x + rnd(0.08),
          backblastPos.y + rnd(0.08),
          backblastPos.z + rnd(0.08),
          backDir.x * (3.0 + Math.random() * 2.0) + rnd(0.9),
          backDir.y * (3.0 + Math.random() * 2.0) + rnd(0.9) + 0.3,
          backDir.z * (3.0 + Math.random() * 2.0) + rnd(0.9),
          i % 2 === 0 ? 0xc8c6d4 : 0xffaa44,
          0.18 + Math.random() * 0.1,
          0.45,
          -0.2,
          1.6
        );
      }
    }

    // Белая вспышка по краям экрана <= 0.08 с (учитывает «Ослабить эффекты»)
    if (this.game?.hud && typeof this.game.hud.triggerBackblastFlash === "function") {
      this.game.hud.triggerBackblastFlash();
    }

    // Физическая отдача, пинок FOV и встряска камеры от тяжёлого выстрела
    player.vel.addScaledVector(dir, player.onGround ? -1.8 : -3.5);
    player.fovKick = Math.max(player.fovKick || 0, 5.5);
    player.recoil += (c.recoil * Math.PI) / 180;
    player.addShake(c.shake, c.shakeTime);
  }

  /**
   * Эффект дыма позади ракетницы, когда она в руках
   */
  updateSmoke(dt, camera, fx) {
    this.smokeT -= dt;
    if (this.smokeT <= 0) {
      this.smokeT = this.cfg.smokeInterval || 0.09;
      if (fx && fx.particles) {
        const dir = new THREE.Vector3();
        const right = new THREE.Vector3();
        const up = new THREE.Vector3();
        camera.getWorldDirection(dir);
        right.set(1, 0, 0).applyQuaternion(camera.quaternion);
        up.set(0, 1, 0).applyQuaternion(camera.quaternion);

        const rearPos = camera.position
          .clone()
          .addScaledVector(dir, 0.15)
          .addScaledVector(right, 0.35)
          .addScaledVector(up, -0.22);

        fx.particles.spawn(
          rearPos.x,
          rearPos.y,
          rearPos.z,
          rnd(0.12) - dir.x * 0.6,
          rnd(0.12) + 0.25 - dir.y * 0.6,
          rnd(0.12) - dir.z * 0.6,
          0xb8b6c8,
          0.13,
          0.45,
          -0.4,
          0.9
        );
      }
    }
  }
}
