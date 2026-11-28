// Система частиц: искры, дым, пороховые газы, гильзы дробовика, пыль при приземлении
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { rnd } from "../core/Physics.js";

export class Particles {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene = scene;
    const maxCount = CONFIG.effects.particles.maxCount;
    const geo = new THREE.IcosahedronGeometry(1, 0);

    this.parts = [];
    this.index = 0;

    for (let i = 0; i < maxCount; i++) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      mesh.visible = false;
      this.scene.add(mesh);
      this.parts.push({
        m: mesh,
        v: new THREE.Vector3(),
        life: 0,
        max: 1,
        size: 0.1,
        grav: 0,
        drag: 0
      });
    }

    // Пул гильз дробовика (Requirement 8)
    const shellGeo = new THREE.BoxGeometry(0.024, 0.024, 0.07);
    const shellMat = new THREE.MeshBasicMaterial({ color: 0xffd23f });
    const maxShells =
      (CONFIG.feel && CONFIG.feel.particles && CONFIG.feel.particles.shellCasingsMax) || 16;
    this.shells = [];
    this.shellIndex = 0;

    for (let i = 0; i < maxShells; i++) {
      const sm = new THREE.Mesh(shellGeo, shellMat);
      sm.visible = false;
      this.scene.add(sm);
      this.shells.push({
        m: sm,
        v: new THREE.Vector3(),
        w: new THREE.Vector3(),
        life: 0,
        maxLife: 2.2
      });
    }
  }

  /**
   * Заспавнить одну частицу
   */
  spawn(x, y, z, vx, vy, vz, color, size, life, grav = 0, drag = 0) {
    const p = this.parts[this.index];
    this.index = (this.index + 1) % this.parts.length;

    p.m.position.set(x, y, z);
    p.v.set(vx, vy, vz);
    p.m.material.color.setHex(color);
    p.size = size;
    p.life = life;
    p.max = life;
    p.grav = grav;
    p.drag = drag;
    p.m.scale.setScalar(size);
    p.m.visible = true;
  }

  /**
   * Сноп искр от попадания пуль
   */
  sparks(p, n, color, count) {
    const feelMult =
      (CONFIG.feel && CONFIG.feel.reduced ? 0.4 : 1.0) *
      ((CONFIG.feel && CONFIG.feel.intensity) || 1.0);
    const nSparks = Math.max(1, Math.round(count * feelMult));

    for (let i = 0; i < nSparks; i++) {
      this.spawn(
        p.x,
        p.y,
        p.z,
        n.x * 3.2 + rnd(3.2),
        n.y * 3.2 + rnd(3.2),
        n.z * 3.2 + rnd(3.2),
        color,
        0.07,
        0.25 + Math.random() * 0.2,
        14
      );
    }
  }

  /**
   * Радиальное облачко пыли на полу при приземлении или рывке
   * @param {THREE.Vector3} pos
   * @param {number} [count=10]
   * @param {number} [radius=1.0]
   */
  dust(pos, count = 10, radius = 1.0) {
    const feelMult =
      (CONFIG.feel && CONFIG.feel.reduced ? 0.4 : 1.0) *
      ((CONFIG.feel && CONFIG.feel.intensity) || 1.0);
    const n = Math.max(3, Math.round(count * feelMult));
    const floorY = pos.y + 0.05;

    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2 + rnd(0.2);
      const speed = (1.6 + Math.random() * 2.2) * radius;
      this.spawn(
        pos.x,
        floorY,
        pos.z,
        Math.cos(angle) * speed,
        0.35 + Math.random() * 0.8,
        Math.sin(angle) * speed,
        0xc4bfb8,
        0.18,
        0.35 + Math.random() * 0.25,
        -1.2,
        2.5
      );
    }
  }

  /**
   * Клубящийся дым после взрыва ракеты
   * @param {THREE.Vector3} pos
   * @param {number} [count=12]
   */
  rocketSmoke(pos, count = 12) {
    const feelMult =
      (CONFIG.feel && CONFIG.feel.reduced ? 0.4 : 1.0) *
      ((CONFIG.feel && CONFIG.feel.intensity) || 1.0);
    const n = Math.max(4, Math.round(count * feelMult));

    for (let i = 0; i < n; i++) {
      this.spawn(
        pos.x + rnd(0.4),
        pos.y + 0.3 + Math.random() * 0.6,
        pos.z + rnd(0.4),
        rnd(2.5),
        1.5 + Math.random() * 2.5,
        rnd(2.5),
        i % 2 === 0 ? 0x888296 : 0x5a5568,
        0.45 + Math.random() * 0.3,
        0.7 + Math.random() * 0.4,
        -1.5,
        1.8
      );
    }
  }

  /**
   * Выброс гильзы дробовика вправо-вверх-назад
   * @param {THREE.Vector3} pos
   * @param {THREE.Vector3} dir
   * @param {THREE.Vector3} right
   * @param {THREE.Vector3} up
   */
  spawnShell(pos, dir, right, up) {
    if (CONFIG.feel && CONFIG.feel.reduced) return;
    const s = this.shells[this.shellIndex];
    this.shellIndex = (this.shellIndex + 1) % this.shells.length;

    // Вылет справа от оружия
    s.m.position
      .copy(pos)
      .addScaledVector(dir, 0.4)
      .addScaledVector(right, 0.22)
      .addScaledVector(up, -0.15);

    s.v.set(0, 0, 0)
      .addScaledVector(right, 2.6 + rnd(0.6))
      .addScaledVector(up, 2.2 + rnd(0.6))
      .addScaledVector(dir, -0.7 + rnd(0.4));

    s.w.set(rnd(18), rnd(18), rnd(18));
    s.life = s.maxLife;
    s.m.visible = true;
  }

  update(dt) {
    // 1. Частицы
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      if (p.life <= 0) continue;

      p.life -= dt;
      if (p.life <= 0) {
        p.m.visible = false;
        continue;
      }

      p.v.y -= p.grav * dt;
      if (p.drag) {
        p.v.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      }
      p.m.position.addScaledVector(p.v, dt);
      p.m.scale.setScalar((p.size * p.life) / p.max);
    }

    // 2. Гильзы дробовика
    for (let i = 0; i < this.shells.length; i++) {
      const s = this.shells[i];
      if (s.life <= 0) continue;

      s.life -= dt;
      if (s.life <= 0) {
        s.m.visible = false;
        continue;
      }

      s.v.y -= 22 * dt;
      s.m.position.addScaledVector(s.v, dt);
      s.m.rotation.x += s.w.x * dt;
      s.m.rotation.y += s.w.y * dt;
      s.m.rotation.z += s.w.z * dt;

      // Отскок от пола
      if (s.m.position.y < 0.04) {
        s.m.position.y = 0.04;
        if (Math.abs(s.v.y) > 0.4) {
          s.v.y = Math.abs(s.v.y) * 0.45;
          s.v.x *= 0.65;
          s.v.z *= 0.65;
          s.w.multiplyScalar(0.6);
        } else {
          s.v.set(0, 0, 0);
          s.w.set(0, 0, 0);
        }
      }
    }
  }
}
