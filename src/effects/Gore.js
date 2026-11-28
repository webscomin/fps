// Расчленение (gibs), брызги крови, всплывающий текст урона и взрывы
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { rnd, EDGE_MAT } from "../core/Physics.js";
import { createToonMaterial } from "../world/Materials.js";

export class Gore {
  /**
   * @param {THREE.Scene} scene
   * @param {Object} decals
   */
  constructor(scene, decals) {
    this.scene = scene;
    this.decals = decals;
    const cfg = CONFIG.effects;

    // Взрывы
    const eg = new THREE.IcosahedronGeometry(1, 1);
    this.expl = [];
    for (let i = 0; i < cfg.explosions.maxCount; i++) {
      const m = new THREE.Mesh(
        eg,
        new THREE.MeshBasicMaterial({ color: 0xff8a1f, transparent: true, depthWrite: false })
      );
      m.visible = false;
      this.scene.add(m);
      this.expl.push({ m, t: 1 });
    }
    this.eLight = new THREE.PointLight(
      0xff8a2a,
      0,
      cfg.explosions.lightDistance
    );
    this.scene.add(this.eLight);
    this.eT = 1;

    // Кольца ударной волны (меши; новых источников света не создаём)
    this.waves = [];
    const ringGeo = new THREE.RingGeometry(0.82, 1.0, 32);
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffb347,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      const ring = new THREE.Mesh(ringGeo, mat);
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      this.scene.add(ring);
      this.waves.push({ m: ring, mat, t: 1, dur: 0.28, radius: 5 });
    }

    // Всплывающие цифры урона / подсказки
    this.pops = [];
    this.pp = 0;
    for (let i = 0; i < cfg.popups.maxCount; i++) {
      const cv = document.createElement("canvas");
      cv.width = 160;
      cv.height = 70;
      const tex = new THREE.CanvasTexture(cv);
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false })
      );
      s.scale.set(1.5, 0.65, 1);
      s.visible = false;
      s.renderOrder = 999;
      this.scene.add(s);
      this.pops.push({
        s,
        cv,
        tex,
        life: 0,
        maxLife: cfg.popups.duration,
        y0: 0,
        accumDmg: 0,
        isHeadshot: false,
        bounceT: 0,
        scaleBaseW: 1.5,
        scaleBaseH: 0.65
      });
    }

    // Куски тел (gibs)
    const bg = new THREE.BoxGeometry(1, 1, 1);
    const be = new THREE.EdgesGeometry(bg);
    const sg = new THREE.SphereGeometry(0.5, 8, 6);
    const se = new THREE.EdgesGeometry(sg);

    this.gibs = [];
    this.gi = 0;
    for (let i = 0; i < cfg.gibs.maxCount; i++) {
      const isHead = i % 8 === 0;
      const geo = isHead ? sg : bg;
      const edgesGeo = isHead ? se : be;
      const m = new THREE.Mesh(geo, createToonMaterial(0xffffff));
      m.add(new THREE.LineSegments(edgesGeo, EDGE_MAT));
      m.visible = false;
      this.scene.add(m);
      this.gibs.push({
        m,
        v: new THREE.Vector3(),
        w: new THREE.Vector3(),
        life: 0,
        s: 0.25,
        isHead
      });
    }
  }

  /**
   * Сноп брызг крови
   */
  bloodSpray(p, n, dmg, color, particles) {
    const count = 10 + Math.min(10, Math.floor(dmg / 6));
    const clr = color || CONFIG.effects.blood.zombieColor;
    for (let i = 0; i < count; i++) {
      particles.spawn(
        p.x,
        p.y,
        p.z,
        n.x * (3 + Math.random() * 4) + rnd(3.5),
        n.y * (3 + Math.random() * 4) + rnd(3.5) + 1.2,
        n.z * (3 + Math.random() * 4) + rnd(3.5),
        clr,
        0.08 + Math.random() * 0.06,
        0.4 + Math.random() * 0.35,
        24,
        0.8
      );
    }
  }

  /**
   * Взрыв с разлётом огня и дыма
   */
  explosion(p, particles) {
    const e = this.expl.find((q) => q.t >= 1) || this.expl[0];
    e.t = 0;
    e.m.position.copy(p);
    e.m.visible = true;

    this.eLight.position.copy(p);
    this.eT = 0;

    for (let i = 0; i < 12; i++) {
      particles.spawn(
        p.x,
        p.y,
        p.z,
        rnd(7),
        rnd(7) + 2,
        rnd(7),
        i % 2 ? 0xffd23f : 0xff7a1a,
        0.4,
        0.45 + Math.random() * 0.2,
        -3,
        1.5
      );
    }
    for (let i = 0; i < 13; i++) {
      particles.spawn(
        p.x,
        p.y,
        p.z,
        rnd(3),
        rnd(3) + 1.5,
        rnd(3),
        0x7d7aa0,
        0.6,
        0.9 + Math.random() * 0.4,
        -1,
        1
      );
    }
  }

  /**
   * Кольцо ударной волны (взрыв бочки).
   * @param {THREE.Vector3} p
   * @param {number} [radius=5]
   * @param {number} [duration=0.28]
   */
  shockwave(p, radius = 5, duration = 0.28) {
    if (!this.waves || this.waves.length === 0) return;
    const w = this.waves.find((q) => q.t >= 1) || this.waves[0];
    w.t = 0;
    w.dur = Math.max(0.1, duration);
    w.radius = Math.max(0.5, radius);
    w.m.position.copy(p);
    w.m.position.y = Math.max(0.08, p.y - 0.55);
    w.m.scale.setScalar(0.6);
    w.mat.opacity = 0.85;
    w.m.visible = true;
  }

  /**
   * Отрисовка текста на canvas текстуры всплывающего урона
   */
  _drawPopupText(q, val, isHeadshot) {
    const g = q.cv.getContext("2d");
    g.clearRect(0, 0, 160, 70);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineJoin = "round";

    const text = isHeadshot ? val + " ХЕДШОТ!" : "" + val;
    const isCrit = !isHeadshot && typeof val === "number" && val >= (CONFIG.feel?.damageNumbers?.critThreshold ?? 35);

    if (isHeadshot) {
      g.font = "900 30px Trebuchet MS, Verdana, sans-serif";
      g.lineWidth = 7;
      g.strokeStyle = "#1b1340";
      g.fillStyle = "#ffd23f";
    } else if (isCrit) {
      g.font = "900 44px Trebuchet MS, Verdana, sans-serif";
      g.lineWidth = 8;
      g.strokeStyle = "#2b050f";
      g.fillStyle = "#ff2a4b";
    } else {
      g.font = "900 38px Trebuchet MS, Verdana, sans-serif";
      g.lineWidth = 7;
      g.strokeStyle = "#121020";
      g.fillStyle = "#ffffff";
    }

    g.strokeText(text, 80, 36);
    g.fillText(text, 80, 36);

    const baseMult = isHeadshot ? 1.3 : (val >= 40 ? 1.25 : (val >= 20 ? 1.0 : 0.85));
    q.scaleBaseW = 1.55 * baseMult;
    q.scaleBaseH = 0.68 * baseMult;
    q.s.scale.set(q.scaleBaseW, q.scaleBaseH, 1);
    q.tex.needsUpdate = true;
  }

  /**
   * Всплывающий текст урона над врагом (с объединением близких попаданий и анимацией подскока)
   */
  popup(x, y, z, val, isHeadshot = false) {
    const groupWindow = CONFIG.feel?.damageNumbers?.groupWindow ?? 0.2;
    const maxLife = CONFIG.effects.popups.duration;

    // Проверяем, есть ли рядом активный всплывающий урон в пределах groupWindow
    let grouped = null;
    for (let i = 0; i < this.pops.length; i++) {
      const p = this.pops[i];
      if (p.life > 0 && (maxLife - p.life) < groupWindow) {
        const dx = p.s.position.x - x;
        const dy = p.y0 - y;
        const dz = p.s.position.z - z;
        if (dx * dx + dy * dy + dz * dz < 1.44) {
          grouped = p;
          break;
        }
      }
    }

    if (grouped) {
      grouped.accumDmg += (typeof val === "number" ? val : 0);
      if (isHeadshot) grouped.isHeadshot = true;
      grouped.life = maxLife;
      grouped.bounceT = 0;
      this._drawPopupText(grouped, grouped.accumDmg, grouped.isHeadshot);
      return;
    }

    const q = this.pops[this.pp];
    this.pp = (this.pp + 1) % this.pops.length;

    q.accumDmg = (typeof val === "number" ? val : 0);
    q.isHeadshot = isHeadshot;
    q.y0 = y + rnd(0.1);
    q.s.position.set(x + rnd(0.2), q.y0, z + rnd(0.2));
    q.life = maxLife;
    q.maxLife = maxLife;
    q.bounceT = 0;

    this._drawPopupText(q, q.accumDmg, q.isHeadshot);
    q.s.material.opacity = 1;
    q.s.visible = true;
  }

  /**
   * Разлёт кусков зомби при смерти
   */
  zombieGibs(pos, count, isHeadshot) {
    const clrs = [0x9e9488, 0x6e5d4e, 0x5a4a3e, 0x857a6e, 0x473b32, 0xb0a597];
    for (let i = 0; i < count; i++) {
      const g = this.gibs[this.gi];
      this.gi = (this.gi + 1) % this.gibs.length;
      const isHead = i === 0 && isHeadshot;
      g.m.material.color.setHex(isHead ? 0xa89c8e : clrs[i % clrs.length]);
      g.s = isHead ? 0.36 : 0.18 + Math.random() * 0.16;
      g.m.scale.setScalar(g.s);
      g.m.position.set(pos.x + rnd(0.3), pos.y + 0.6 + Math.random() * 1.1, pos.z + rnd(0.3));
      g.v.set(rnd(6), 4 + Math.random() * 6, rnd(6));
      g.w.set(rnd(12), rnd(12), rnd(12));
      g.life = CONFIG.effects.gibs.life;
      g.m.visible = true;
    }
  }

  /**
   * Разлёт произвольных кусков плоти/материалов в заданных цветах
   */
  spawnGibs(pos, count, colors = null, isHeadshot = false) {
    const clrs = colors && colors.length > 0 ? colors : [0x9e9488, 0x6e5d4e, 0x5a4a3e, 0x857a6e, 0x473b32, 0xb0a597];
    for (let i = 0; i < count; i++) {
      const g = this.gibs[this.gi];
      this.gi = (this.gi + 1) % this.gibs.length;
      const isHead = i === 0 && isHeadshot;
      g.m.material.color.setHex(isHead ? (clrs[0] || 0xa89c8e) : clrs[i % clrs.length]);
      g.s = isHead ? 0.36 : 0.18 + Math.random() * 0.16;
      g.m.scale.setScalar(g.s);
      g.m.position.set(pos.x + rnd(0.3), pos.y + 0.5 + Math.random() * 0.8, pos.z + rnd(0.3));
      g.v.set(rnd(5), 3 + Math.random() * 5, rnd(5));
      g.w.set(rnd(12), rnd(12), rnd(12));
      g.life = CONFIG.effects.gibs.life;
      g.m.visible = true;
    }
  }

  /**
   * Запуск отдельной отсечённой головы в полёт (для добивания дробовиком)
   */
  spawnHead(pos, vel, color = 0xa89c8e, size = 0.36) {
    // Находим свободный элемент со сферой (isHead) или берём циклический
    let g = this.gibs.find((x) => x.life <= 0 && x.isHead);
    if (!g) {
      g = this.gibs[this.gi];
      this.gi = (this.gi + 1) % this.gibs.length;
    }
    g.m.material.color.setHex(color);
    g.s = size;
    g.m.scale.setScalar(g.s);
    g.m.position.copy(pos);
    g.v.copy(vel);
    g.w.set(rnd(14), rnd(14), rnd(14));
    g.life = CONFIG.effects.gibs.life;
    g.m.visible = true;
    return g;
  }

  update(dt) {
    const cfg = CONFIG.effects;

    // Обновление взрывов
    for (let i = 0; i < this.expl.length; i++) {
      const e = this.expl[i];
      if (e.t >= 1) continue;
      e.t += dt / cfg.explosions.duration;
      const k = Math.min(1, e.t);
      e.m.scale.setScalar(0.5 + CONFIG.weapons.rocket.explosionRadius * 0.8 * (1 - (1 - k) * (1 - k)));
      e.m.material.opacity = 1 - k;
      if (k >= 1) e.m.visible = false;
    }

    if (this.eT < 1) {
      this.eT += dt / cfg.explosions.lightDuration;
      this.eLight.intensity = cfg.explosions.lightIntensity * Math.max(0, 1 - this.eT);
    }

    // Кольца ударной волны
    for (let i = 0; i < this.waves.length; i++) {
      const w = this.waves[i];
      if (w.t >= 1) continue;
      w.t += dt / w.dur;
      const k = Math.min(1, w.t);
      const scale = 0.6 + (w.radius - 0.6) * (1 - (1 - k) * (1 - k));
      w.m.scale.setScalar(scale);
      w.mat.opacity = 0.85 * (1 - k);
      if (k >= 1) w.m.visible = false;
    }

    // Обновление всплывающего текста
    for (let i = 0; i < this.pops.length; i++) {
      const q = this.pops[i];
      if (q.life <= 0) continue;
      q.life -= dt;
      if (q.life <= 0) {
        q.s.visible = false;
        continue;
      }
      q.bounceT = (q.bounceT || 0) + dt;
      const bounceDur = 0.24;
      let bounceY = 0;
      if (q.bounceT < bounceDur) {
        const bt = q.bounceT / bounceDur;
        bounceY = Math.sin(bt * Math.PI) * (CONFIG.feel?.damageNumbers?.bounceHeight ?? 0.35);
      }
      q.s.position.y = q.y0 + bounceY + (1 - q.life / cfg.popups.duration) * cfg.popups.riseDistance;
      q.s.material.opacity = Math.min(1, q.life / cfg.popups.fadeDuration);
    }

    // Обновление кусков тел
    for (let i = 0; i < this.gibs.length; i++) {
      const g = this.gibs[i];
      if (g.life <= 0) continue;
      g.life -= dt;
      if (g.life <= 0) {
        g.m.visible = false;
        continue;
      }

      g.v.y -= cfg.gibs.gravity * dt;
      g.m.position.addScaledVector(g.v, dt);

      if (g.m.position.y < g.s / 2) {
        g.m.position.y = g.s / 2;
        if (Math.abs(g.v.y) > cfg.gibs.minBounceSpeed && this.decals) {
          this.decals.add(
            g.m.position,
            new THREE.Vector3(0, 1, 0),
            CONFIG.effects.blood.zombieColor,
            0.7 + Math.random() * 0.4
          );
        }
        g.v.y = Math.abs(g.v.y) * cfg.gibs.bounceFactor;
        if (g.v.y < cfg.gibs.stopBounceSpeed) g.v.y = 0;
        g.v.x *= cfg.gibs.groundFriction;
        g.v.z *= cfg.gibs.groundFriction;
        g.w.multiplyScalar(cfg.gibs.groundFriction);
      }

      g.m.rotation.x += g.w.x * dt;
      g.m.rotation.y += g.w.y * dt;
      g.m.rotation.z += g.w.z * dt;
      g.m.scale.setScalar(g.s * Math.min(1, g.life / cfg.gibs.fadeDuration));
    }
  }
}
