// Декали: пятна крови и следы попаданий на стенах и полу
import * as THREE from "three";
import { CONFIG } from "../config.js";

export class Decals {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene = scene;
    const cfg = CONFIG.effects.decals;
    const bloodTex = this.createSplatterTexture();
    const dg = new THREE.PlaneGeometry(cfg.decalScaleDefault, cfg.decalScaleDefault);

    this.decals = [];
    this.index = 0;

    for (let i = 0; i < cfg.maxCount; i++) {
      const mesh = new THREE.Mesh(
        dg,
        new THREE.MeshBasicMaterial({
          map: bloodTex,
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -3,
          polygonOffsetUnits: -3
        })
      );
      mesh.visible = false;
      this.scene.add(mesh);
      this.decals.push({ m: mesh, life: 0 });
    }

    // Пул отметин от пуль (не более 40 штук, исчезает за 6 с)
    const holeTex = this.createBulletHoleTexture();
    const hg = new THREE.PlaneGeometry(0.14, 0.14);
    this.bulletHoles = [];
    this.holeIndex = 0;
    this.maxHoles = 40;

    for (let i = 0; i < this.maxHoles; i++) {
      const hm = new THREE.Mesh(
        hg,
        new THREE.MeshBasicMaterial({
          map: holeTex,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -4
        })
      );
      hm.visible = false;
      this.scene.add(hm);
      this.bulletHoles.push({ m: hm, life: 0, maxLife: 6.0 });
    }
  }

  createBulletHoleTexture() {
    const size = 64;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    const half = size / 2;

    g.clearRect(0, 0, size, size);
    // Тёмный ореол копоти
    const grad = g.createRadialGradient(half, half, 4, half, half, 26);
    grad.addColorStop(0, "rgba(20, 20, 20, 0.95)");
    grad.addColorStop(0.5, "rgba(35, 30, 25, 0.7)");
    grad.addColorStop(1, "rgba(30, 30, 30, 0)");
    g.fillStyle = grad;
    g.beginPath();
    g.arc(half, half, 26, 0, Math.PI * 2);
    g.fill();

    // Чёрная центральная воронка
    g.fillStyle = "#111111";
    g.beginPath();
    g.arc(half, half, 8, 0, Math.PI * 2);
    g.fill();

    return new THREE.CanvasTexture(c);
  }

  createSplatterTexture() {
    const size = CONFIG.effects.decals.splatterTexSize;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    const half = size / 2;

    g.clearRect(0, 0, size, size);
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.arc(half, half, 18, 0, Math.PI * 2);
    g.fill();

    for (let i = 0; i < 7; i++) {
      const ang = (i / 7) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const dist = 22 + Math.random() * 8;
      const rad = 2.5 + Math.random() * 3.5;
      g.beginPath();
      g.arc(half + Math.cos(ang) * dist, half + Math.sin(ang) * dist, rad, 0, Math.PI * 2);
      g.fill();
    }
    return new THREE.CanvasTexture(c);
  }

  /**
   * Наложить декаль на поверхность
   * @param {THREE.Vector3} p - точка попадания
   * @param {THREE.Vector3} n - нормаль поверхности
   * @param {number} [color]
   * @param {number} [scale=1]
   */
  add(p, n, color, scale = 1) {
    const d = this.decals[this.index];
    this.index = (this.index + 1) % this.decals.length;

    // На полу (нормаль вверх) поднимаем до 0.035, чтобы не конфликтовать со слоем пола
    const offset = Math.abs(n.y) > 0.8 ? 0.035 : 0.014;
    d.m.position.copy(p).addScaledVector(n, offset);
    d.m.lookAt(p.x + n.x, p.y + n.y, p.z + n.z);
    d.m.scale.setScalar(scale);
    d.m.material.color.setHex(color || CONFIG.world.outlineColor);
    d.life = CONFIG.effects.decals.decalLife;
    d.m.visible = true;
  }

  /**
   * Наложить маленькую тёмную отметину от пули (исчезает за 6 с)
   * @param {THREE.Vector3} p
   * @param {THREE.Vector3} n
   */
  addBulletHole(p, n) {
    if (!this.bulletHoles || this.bulletHoles.length === 0) {
      this.add(p, n, 0x1f1f1f, 0.25);
      return;
    }
    const h = this.bulletHoles[this.holeIndex];
    this.holeIndex = (this.holeIndex + 1) % this.bulletHoles.length;

    const offset = Math.abs(n.y) > 0.8 ? 0.035 : 0.016;
    h.m.position.copy(p).addScaledVector(n, offset);
    h.m.lookAt(p.x + n.x, p.y + n.y, p.z + n.z);
    // Случайный поворот для разнообразия
    h.m.rotateZ(Math.random() * Math.PI * 2);
    h.life = 6.0;
    h.maxLife = 6.0;
    h.m.material.opacity = 0.9;
    h.m.visible = true;
  }

  update(dt) {
    for (let i = 0; i < this.decals.length; i++) {
      const d = this.decals[i];
      if (d.life <= 0) continue;

      d.life -= dt;
      if (d.life <= 0) {
        d.m.visible = false;
      } else {
        d.m.material.opacity = 0.85 * Math.min(1, d.life / CONFIG.effects.decals.decalFadeTime);
      }
    }

    if (this.bulletHoles) {
      for (let i = 0; i < this.bulletHoles.length; i++) {
        const h = this.bulletHoles[i];
        if (h.life <= 0) continue;
        h.life -= dt;
        if (h.life <= 0) {
          h.m.visible = false;
        } else {
          // Плавное исчезновение за последние 1.5 с из 6.0 с
          h.m.material.opacity = 0.9 * Math.min(1, h.life / 1.5);
        }
      }
    }
  }
}
