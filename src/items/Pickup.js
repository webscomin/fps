// Подбираемый предмет: модель, физика падения, парение, притягивание к игроку и сбор
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { disposeObject3D, outlined, rnd } from "../core/Physics.js";
import { createBlobShadow, createToonMaterial } from "../world/Materials.js";
import { createAmmoPickupMesh } from "./AmmoModels.js";

export class Pickup {
  /**
   * @param {THREE.Scene} scene
   * @param {"medkit" | "armor" | "ammo_shotgun" | "ammo_ak47" | "ammo_rocket" | "vodka" | "joint"} type
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {THREE.Vector3} [initialVel]
   */
  constructor(scene, type, x, y, z, initialVel = null) {
    this.scene = scene;
    this.type = type;
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = initialVel ? initialVel.clone() : new THREE.Vector3(rnd(1.4), 3.5 + Math.random() * 1.5, rnd(1.4));
    this.groundY = y;
    this.bounced = false;
    this.hovering = false;
    this.hoverBaseY = y + 0.35;
    this.hoverT = Math.random() * 10;
    this.life = CONFIG.pickups.life;
    this.alive = true;

    this.buildModel();
  }

  buildModel() {
    this.mesh = new THREE.Group();
    this.mesh.position.copy(this.pos);

    const box = (w, h, d, color) => outlined(new THREE.BoxGeometry(w, h, d), createToonMaterial(color));

    if (this.type === "medkit") {
      const b = box(0.38, 0.38, 0.38, 0xffffff);
      const cross1 = box(0.12, 0.4, 0.4, 0xff3366);
      const cross2 = box(0.4, 0.12, 0.4, 0xff3366);
      this.mesh.add(b, cross1, cross2);
    } else if (this.type === "armor") {
      const shield = box(0.36, 0.46, 0.14, 0x33a1fd);
      const core = box(0.2, 0.26, 0.16, 0xffffff);
      this.mesh.add(shield, core);
    } else if (this.type === "ammo_shotgun") {
      const modelMesh = createAmmoPickupMesh("ammo_shotgun");
      if (modelMesh) {
        this.mesh.add(modelMesh);
      } else {
        const b = box(0.36, 0.28, 0.28, 0xffd23f);
        const stripe = box(0.38, 0.1, 0.3, 0xff3366);
        this.mesh.add(b, stripe);
      }
    } else if (this.type === "ammo_ak47") {
      const modelMesh = createAmmoPickupMesh("ammo_ak47");
      if (modelMesh) {
        this.mesh.add(modelMesh);
      } else {
        // Оливково-зелёный ящик с надписью «7.62»
        const b = box(0.36, 0.28, 0.28, 0x424e2b);
        const lid = box(0.38, 0.05, 0.30, 0x333d20);
        lid.position.y = 0.14;
        this.mesh.add(b, lid);

        const canvas = document.createElement("canvas");
        canvas.width = 128;
        canvas.height = 64;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#3a4524";
        ctx.fillRect(0, 0, 128, 64);
        ctx.fillStyle = "#e0d890";
        ctx.font = "bold 34px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("7.62", 64, 32);
        const stencilTex = new THREE.CanvasTexture(canvas);
        const labelMat = new THREE.MeshBasicMaterial({ map: stencilTex });
        const labelGeo = new THREE.PlaneGeometry(0.24, 0.12);
        const labelFront = new THREE.Mesh(labelGeo, labelMat);
        labelFront.position.set(0, 0, 0.142);
        const labelBack = new THREE.Mesh(labelGeo, labelMat);
        labelBack.position.set(0, 0, -0.142);
        labelBack.rotation.y = Math.PI;
        this.mesh.add(labelFront, labelBack);
      }
    } else if (this.type === "ammo_rocket") {
      const modelMesh = createAmmoPickupMesh("ammo_rocket");
      if (modelMesh) {
        this.mesh.add(modelMesh);
      } else {
        const b = box(0.42, 0.25, 0.25, 0xff7a1a);
        const tip = box(0.18, 0.27, 0.27, 0xff3366);
        tip.position.x = 0.14;
        this.mesh.add(b, tip);
      }
    } else if (this.type === "vodka") {
      this.buildVodka();
    } else if (this.type === "joint") {
      this.buildJoint();
    }

    this.scene.add(this.mesh);

    // Фальшивая тень-пятно под предметом
    this.shadowBaseScale = 0.62;
    this.shadow = createBlobShadow(this.shadowBaseScale);
    this.shadow.position.set(this.pos.x, this.groundY + 0.032, this.pos.z);
    this.scene.add(this.shadow);
  }

  /** Бутылка водки: стеклянный цилиндр, горлышко и этикетка с «В». */
  buildVodka() {
    const glass = createToonMaterial(0xbfe9ff, { transparent: true, opacity: 0.72 });
    const body = outlined(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 10), glass);
    const neck = outlined(new THREE.CylinderGeometry(0.07, 0.1, 0.2, 8), glass);
    neck.position.y = 0.34;
    const cap = outlined(
      new THREE.CylinderGeometry(0.075, 0.075, 0.07, 8),
      createToonMaterial(0x1b1340)
    );
    cap.position.y = 0.47;
    const label = outlined(
      new THREE.CylinderGeometry(0.168, 0.168, 0.22, 10, 1, true),
      createToonMaterial(0xfff4d6)
    );
    label.position.y = -0.04;
    this.mesh.add(body, neck, cap, label);

    // Буква «В» на двух сторонах этикетки, чтобы читалась при вращении
    const tex = this._letterTexture("В");
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
    const geo = new THREE.PlaneGeometry(0.13, 0.16);
    const front = new THREE.Mesh(geo, mat);
    front.position.set(0, -0.04, 0.171);
    const back = new THREE.Mesh(geo, mat);
    back.position.set(0, -0.04, -0.171);
    back.rotation.y = Math.PI;
    this.mesh.add(front, back);
  }

  /** Косяк: белый цилиндр, оранжевый кончик и лёгкий дымок. */
  buildJoint() {
    const paper = createToonMaterial(0xfffdf5);
    const body = outlined(new THREE.CylinderGeometry(0.052, 0.052, 0.34, 8), paper);
    body.rotation.z = Math.PI / 2;

    const ember = outlined(
      new THREE.CylinderGeometry(0.056, 0.056, 0.08, 8),
      createToonMaterial(0xff7a1a, { emissive: 0xff5a00, emissiveIntensity: 0.8 })
    );
    ember.rotation.z = Math.PI / 2;
    ember.position.x = 0.2;

    const ash = outlined(
      new THREE.CylinderGeometry(0.054, 0.054, 0.03, 8),
      createToonMaterial(0x2b2b2b)
    );
    ash.rotation.z = Math.PI / 2;
    ash.position.x = -0.18;

    this.mesh.add(body, ember, ash);

    // Дым: три полупрозрачных шарика, анимируются в update
    this.smokeT = 0;
    this.smokePuffs = [];
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xdfe6f0,
        transparent: true,
        opacity: 0.4,
        depthWrite: false
      });
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), mat);
      puff.position.set(0.22, 0.18, 0);
      this.mesh.add(puff);
      this.smokePuffs.push({ mesh: puff, phase: i / 3 });
    }
  }

  /** Текстура буквы для этикетки. @private */
  _letterTexture(letter) {
    const cv = document.createElement("canvas");
    cv.width = 64;
    cv.height = 64;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillStyle = "#1b1340";
    ctx.font = "bold 46px 'Trebuchet MS', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(letter, 32, 34);
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    return tex;
  }

  /** Обновить тень-пятно: уменьшается при подъёме предмета. */
  updateShadow() {
    if (!this.shadow) return;
    if (!this.alive) {
      this.shadow.visible = false;
      return;
    }
    const groundY = this.groundY + 0.032;
    const height = Math.max(0, this.pos.y - groundY);
    const shrink = Math.max(0.4, 1 - height * 0.08);
    const s = this.shadowBaseScale * shrink;
    this.shadow.visible = this.mesh.visible;
    this.shadow.position.set(this.pos.x, groundY, this.pos.z);
    this.shadow.scale.set(s, 1, s);
  }

  canPlayerCollect(player, game) {
    // Расходники: слот полон — предмет не берётся и не притягивается магнитом
    if (this.type === "vodka" || this.type === "joint") {
      const count = game && game.consumables ? game.consumables[this.type] || 0 : 0;
      return count < (CONFIG.effects.maxStack ?? 3);
    }

    const wpns = game.weapons || (game.weaponManager ? game.weaponManager.weapons : (game.combat ? game.combat.weapons : []));
    if (this.type === "medkit") return player.health < player.maxHealth;
    if (this.type === "armor") return player.armor < player.maxArmor;
    if (this.type === "ammo_shotgun") return wpns[0].ammo < wpns[0].cfg.maxAmmo;
    if (this.type === "ammo_ak47") return wpns[1].ammo < wpns[1].cfg.maxAmmo;
    if (this.type === "ammo_rocket") return wpns[2].ammo < wpns[2].cfg.maxAmmo;
    return true;
  }

  collect(player, game, fx) {
    this.alive = false;
    this.destroy();
    if (game.audio) game.audio.play("pickup");
    if (game.levelManager) game.levelManager.onItemCollected(this.type);

    // Расходники попадают в инвентарь, а не применяются сразу
    if (this.type === "vodka" || this.type === "joint") {
      if (game.addConsumable) game.addConsumable(this.type);
      game.triggerFlash(this.type);
      if (fx) {
        const label = this.type === "vodka" ? "+1 ВОДКА" : "+1 КОСЯК";
        const color = this.type === "vodka" ? 0x9ffcff : 0xff9f1c;
        fx.popup(this.pos.x, this.pos.y + 0.8, this.pos.z, label);
        if (fx.particles) fx.particles.sparks(this.pos, new THREE.Vector3(0, 1, 0), color, 10);
      }
      return;
    }

    const P = CONFIG.pickups;
    const wpns = game.weapons || (game.weaponManager ? game.weaponManager.weapons : (game.combat ? game.combat.weapons : []));

    if (this.type === "medkit") {
      player.health = Math.min(player.maxHealth, player.health + P.medkitHp);
      game.triggerFlash("green");
      if (fx) {
        fx.popup(this.pos.x, this.pos.y + 0.8, this.pos.z, "+25 HP");
        if (fx.particles) fx.particles.sparks(this.pos, new THREE.Vector3(0, 1, 0), 0x2ecc71, 10);
      }
    } else if (this.type === "armor") {
      player.armor = Math.min(player.maxArmor, player.armor + P.armorAp);
      game.triggerFlash("blue");
      if (fx) {
        fx.popup(this.pos.x, this.pos.y + 0.8, this.pos.z, "+25 AP");
        if (fx.particles) fx.particles.sparks(this.pos, new THREE.Vector3(0, 1, 0), 0x33a1fd, 10);
      }
    } else if (this.type === "ammo_shotgun") {
      const w = wpns[0];
      w.ammo = Math.min(w.cfg.maxAmmo, w.ammo + P.shotgunAmmo);
      if (fx) {
        fx.popup(this.pos.x, this.pos.y + 0.8, this.pos.z, "+8 ДРОБОВИК");
        if (fx.particles) fx.particles.sparks(this.pos, new THREE.Vector3(0, 1, 0), 0xffd23f, 8);
      }
    } else if (this.type === "ammo_ak47") {
      const w = wpns[1];
      const count = P.ak47Ammo ?? 30;
      w.ammo = Math.min(w.cfg.maxAmmo, w.ammo + count);
      if (fx) {
        fx.popup(this.pos.x, this.pos.y + 0.8, this.pos.z, `+${count} ПАТРОНЫ АК`);
        if (fx.particles) fx.particles.sparks(this.pos, new THREE.Vector3(0, 1, 0), 0xa09848, 8);
      }
    } else if (this.type === "ammo_rocket") {
      const w = wpns[2];
      w.ammo = Math.min(w.cfg.maxAmmo, w.ammo + P.rocketAmmo);
      if (fx) {
        fx.popup(this.pos.x, this.pos.y + 0.8, this.pos.z, "+4 РАКЕТЫ");
        if (fx.particles) fx.particles.sparks(this.pos, new THREE.Vector3(0, 1, 0), 0xff7a1a, 8);
      }
    }
  }

  update(dt, player, game, fx) {
    if (!this.alive) return;
    this.life -= dt;
    if (this.life <= 0) {
      this.alive = false;
      this.destroy();
      return;
    }

    // Мигание в последние 5 секунд
    if (this.life <= CONFIG.pickups.blinkTime) {
      this.mesh.visible = Math.sin(this.life * CONFIG.pickups.blinkSpeed) > 0;
    }

    if (!this.hovering) {
      this.vel.y -= 18 * dt;
      this.pos.addScaledVector(this.vel, dt);
      if (this.pos.y <= this.groundY + 0.3) {
        this.pos.y = this.groundY + 0.3;
        if (!this.bounced) {
          this.bounced = true;
          this.vel.y = Math.abs(this.vel.y) * 0.45;
          this.vel.x *= 0.5;
          this.vel.z *= 0.5;
        } else {
          this.hovering = true;
          this.hoverBaseY = this.pos.y;
          this.vel.set(0, 0, 0);
        }
      }
    } else {
      this.hoverT += dt * 3;
      this.pos.y = this.hoverBaseY + Math.sin(this.hoverT) * 0.08;
    }

    this.mesh.rotation.y += dt * 2.2;
    this.mesh.position.copy(this.pos);

    // Лёгкий дымок косяка
    if (this.smokePuffs) {
      this.smokeT += dt;
      for (const p of this.smokePuffs) {
        const k = (this.smokeT * 0.55 + p.phase) % 1;
        p.mesh.position.y = 0.15 + k * 0.32;
        p.mesh.scale.setScalar(0.5 + k * 1.3);
        p.mesh.material.opacity = 0.42 * (1 - k);
      }
    }

    this.updateShadow();

    const canRec = this.canPlayerCollect(player, game);
    const d = this.pos.distanceTo(player.pos);

    // Магнитное притяжение
    if (canRec && d <= CONFIG.pickups.magnetRadius) {
      const k = Math.min(1, dt * (5 + (1 - d / CONFIG.pickups.magnetRadius) * 12));
      this.pos.x += (player.pos.x - this.pos.x) * k;
      this.pos.y += (player.pos.y + 0.8 - this.pos.y) * k;
      this.pos.z += (player.pos.z - this.pos.z) * k;
    }

    // Подбор
    if (canRec && d <= CONFIG.pickups.pickupRadius) {
      this.collect(player, game, fx);
    }
  }

  /** Обновить модель патронов после завершения предзагрузки 3D-моделей. */
  refreshAmmoModel() {
    if (!this.alive || this._destroyed) return;
    if (this.type !== "ammo_shotgun" && this.type !== "ammo_ak47" && this.type !== "ammo_rocket") return;
    const modelMesh = createAmmoPickupMesh(this.type);
    if (!modelMesh) return;
    while (this.mesh.children.length > 0) {
      const child = this.mesh.children[0];
      this.mesh.remove(child);
      disposeObject3D(child);
    }
    this.mesh.add(modelMesh);
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.alive = false;
    this.scene.remove(this.mesh);
    if (this.shadow) {
      this.scene.remove(this.shadow);
      this.shadow = null;
    }
    disposeObject3D(this.mesh);
  }
}
