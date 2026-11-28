// Смешные лица над врагами под косяком: чисто визуальные спрайты, общая текстура.
import * as THREE from "three";
import { CONFIG } from "../config.js";

export class FunnyFaces {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    this.texture = this._makeTexture();
    this.material = new THREE.SpriteMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false
    });
    this.entries = new Map();
    this._timer = 0;
  }

  /** @private */
  _makeTexture() {
    const cv = document.createElement("canvas");
    cv.width = 64;
    cv.height = 64;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, 64, 64);

    // Жёлтая рожа с чёрным контуром
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#1b1340";
    ctx.fillStyle = "#ffd23f";
    ctx.beginPath();
    ctx.arc(32, 32, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Глаза
    ctx.fillStyle = "#1b1340";
    ctx.beginPath();
    ctx.arc(23, 26, 4, 0, Math.PI * 2);
    ctx.arc(41, 26, 4, 0, Math.PI * 2);
    ctx.fill();

    // Улыбка и язык
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(32, 34, 13, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.fillStyle = "#ff4f8b";
    ctx.beginPath();
    ctx.ellipse(32, 44, 6, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    return new THREE.CanvasTexture(cv);
  }

  /**
   * @param {number} dt
   * @param {number} amount визуальная сила косяка (0..1)
   * @param {Array} enemies
   */
  update(dt, amount, enemies) {
    if (!(dt > 0)) return;
    this._timer += dt;

    if (amount <= 0.05 || !enemies || enemies.length === 0) {
      this._hideAll();
      return;
    }

    const cfg = CONFIG.effects.screen.weed;
    const seen = new Set();

    for (const enemy of enemies) {
      if (!enemy || enemy.alive === false || enemy.isDead || enemy.dead) continue;
      const pos = enemy.pos || (enemy.mesh && enemy.mesh.position) || null;
      if (!pos) continue;

      seen.add(enemy);
      let entry = this.entries.get(enemy);
      if (!entry) {
        entry = {
          sprite: null,
          ttl: 0,
          nextRoll: Math.random() * 1.5
        };
        this.entries.set(enemy, entry);
      }

      if (entry.sprite && entry.sprite.visible) {
        entry.ttl -= dt;
        if (entry.ttl <= 0) {
          entry.sprite.visible = false;
          entry.nextRoll = this._rollDelay(cfg);
        } else {
          const h =
            enemy.hitboxHeight ||
            (enemy.cfg && enemy.cfg.hitboxHeight) ||
            2.2;
          entry.sprite.position.set(pos.x, pos.y + h + 0.55, pos.z);
        }
        continue;
      }

      entry.nextRoll -= dt;
      if (entry.nextRoll > 0) continue;
      entry.nextRoll = this._rollDelay(cfg);
      if (Math.random() >= cfg.faceChance) continue;

      if (!entry.sprite) {
        entry.sprite = new THREE.Sprite(this.material);
        this.scene.add(entry.sprite);
      }
      entry.sprite.visible = true;
      entry.sprite.scale.set(0.8, 0.8, 1);
      entry.ttl = cfg.faceDuration;

      const h =
        enemy.hitboxHeight ||
        (enemy.cfg && enemy.cfg.hitboxHeight) ||
        2.2;
      entry.sprite.position.set(pos.x, pos.y + h + 0.55, pos.z);
    }

    // Убираем спрайты врагов, которых больше нет
    for (const [enemy, entry] of this.entries) {
      if (seen.has(enemy)) continue;
      if (entry.sprite) this.scene.remove(entry.sprite);
      this.entries.delete(enemy);
    }
  }

  /** @private */
  _rollDelay(cfg) {
    const min = cfg.faceIntervalMin ?? 1.2;
    const max = cfg.faceIntervalMax ?? 2.4;
    return min + Math.random() * Math.max(0, max - min);
  }

  /** @private */
  _hideAll() {
    for (const entry of this.entries.values()) {
      if (entry.sprite) entry.sprite.visible = false;
      entry.ttl = 0;
    }
  }

  /** Спрятать все лица (смерть/рестарт). */
  clear() {
    for (const entry of this.entries.values()) {
      if (entry.sprite) this.scene.remove(entry.sprite);
    }
    this.entries.clear();
  }

  dispose() {
    this.clear();
    this.material.dispose();
    this.texture.dispose();
  }
}
