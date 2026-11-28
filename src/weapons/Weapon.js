// Базовый класс оружия: боезапас, перезарядка, разброс и общий интерфейс стрельбы
import * as THREE from "three";

export class Weapon {
  /**
   * @param {string} id
   * @param {Object} cfg
   * @param {Object} game
   */
  constructor(id, cfg, game) {
    this.id = id;
    this.cfg = cfg;
    this.game = game;
    this.ammo = cfg.ammo;
    this.cool = 0;
  }

  update(dt) {
    if (this.cool > 0) {
      this.cool = Math.max(0, this.cool - dt);
    }
  }

  canFire() {
    return this.cool <= 0 && this.ammo > 0;
  }

  refill() {
    this.ammo = this.cfg.maxAmmo;
  }

  /**
   * Расчёт случайного направления с разбросом в конусе
   * @param {THREE.Vector3} dir
   * @param {THREE.Vector3} right
   * @param {THREE.Vector3} up
   * @param {number} deg
   * @param {THREE.Vector3} out
   * @returns {THREE.Vector3}
   */
  spreadDir(dir, right, up, deg, out = new THREE.Vector3()) {
    const a = Math.tan((deg * Math.PI) / 180);
    const r = Math.sqrt(Math.random()) * a;
    const ph = Math.random() * 6.2832;
    return out
      .copy(dir)
      .addScaledVector(right, Math.cos(ph) * r)
      .addScaledVector(up, Math.sin(ph) * r)
      .normalize();
  }

  fire(player, camera, world, targets, zombies, fx, projectiles) {
    // Реализуется в конкретном классе оружия
  }
}
