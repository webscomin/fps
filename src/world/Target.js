// Тренировочная мишень для проверки стрельбы и урона
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { disposeObject3D, outlined } from "../core/Physics.js";
import { createToonMaterial } from "./Materials.js";

export class Target {
  /**
   * @param {THREE.Scene} scene
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} color
   */
  constructor(scene, x, y, z, color) {
    this.scene = scene;
    this.base = new THREE.Vector3(x, y, z);
    this.color = color;
    this.min = new THREE.Vector3(x - 0.5, y, z - 0.5);
    this.max = new THREE.Vector3(x + 0.5, y + 1.95, z + 0.5);

    this.mat = createToonMaterial(color);
    this.headMat = createToonMaterial(0xffe066);

    this.group = new THREE.Group();
    this.group.position.set(x, y, z);

    const body = outlined(new THREE.CylinderGeometry(0.42, 0.5, 1.3, 10), this.mat);
    body.position.y = 0.65;

    const head = outlined(new THREE.SphereGeometry(0.32, 10, 8), this.headMat, 40);
    head.position.y = 1.62;

    const ring = outlined(
      new THREE.CylinderGeometry(0.22, 0.22, 0.06, 10),
      createToonMaterial(0xffffff)
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, 0.85, 0.46);

    this.group.add(body, head, ring);
    this.scene.add(this.group);

    this.hp = CONFIG.combat.targetHp;
    this.alive = true;
    this.flashT = 0;
    this.respawnT = 0;
  }

  setFlash(on) {
    const emissive = on ? 0xffffff : 0;
    this.mat.emissive.setHex(emissive);
    this.headMat.emissive.setHex(emissive);
  }

  /**
   * Получение урона
   * @param {number} dmg
   * @param {Object} fx
   * @returns {boolean} убита ли мишень
   */
  hit(dmg, fx) {
    if (!this.alive) return false;
    this.hp -= dmg;
    this.flashT = 0.08;
    this.setFlash(true);

    if (fx && fx.popup) {
      fx.popup(this.base.x, this.base.y + 2.4, this.base.z, Math.max(1, Math.round(dmg)));
    }

    if (this.hp <= 0) {
      this.alive = false;
      this.group.visible = false;
      this.respawnT = CONFIG.combat.targetRespawn;
      return true;
    }
    return false;
  }

  update(dt) {
    if (this.alive) {
      if (this.flashT > 0) {
        this.flashT -= dt;
        if (this.flashT <= 0) this.setFlash(false);
      }
    } else {
      this.respawnT -= dt;
      if (this.respawnT <= 0) {
        this.alive = true;
        this.hp = CONFIG.combat.targetHp;
        this.group.visible = true;
        this.setFlash(false);
      }
    }
  }

  /** Удалить мишень со сцены и освободить геометрию/материалы */
  destroy() {
    this.scene.remove(this.group);
    disposeObject3D(this.group);
  }
}
