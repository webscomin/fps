// Враг StrawReaper (пугало с серпом): 3D-модель (GLB) со скелетной анимацией,
// нарезкой через THREE.AnimationUtils.subclip, рукопашной атакой серпом,
// смертоносным рывком (charge) с замахом и телеграфной полосой, уязвимым окном восстановления (recovery),
// неподвижной засадой (ambush), кольцом вокруг недосягаемого игрока и физическим стаггером.
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { outlined, rayAABB, rnd, resolveBoxCollision, checkLineOfSight } from "../core/Physics.js";
import { Enemy } from "./Enemy.js";
import { createToonMaterial } from "../world/Materials.js";
import { hasReaperModel, createReaperInstance } from "../core/ModelCache.js";

export class StrawReaper extends Enemy {
  /**
   * @param {THREE.Scene} scene
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  constructor(scene, x, y, z) {
    const C = CONFIG.enemies.reaper;
    const speed = C.speed * (1 + rnd(C.speedVar || 0));
    super(scene, x, y, z, C.health, speed);

    this.isReaper = true;
    this.attackT = 0;
    this.attackCd = 0;
    this._hitDealt = false;
    this.staggerT = 0;
    this.wobbleT = Math.random() * 10;
    this.checkStuckT = 0;
    this.lastCheckPos = new THREE.Vector3(x, y, z);
    this.sidestepDir = new THREE.Vector3();
    this.sidestepT = 0;

    // Параметры поведения при недосягаемом игроке (кольцо вокруг блока)
    this.unreachableAngle = undefined;
    this.unreachableRingDist = undefined;
    this.unreachableSubState = "move";
    this.unreachableSubTimer = 0;
    this.unreachableCheckTimer = 0;

    // Параметры рывка (charge) и восстановления (recovery)
    this.chargeCd = 0;
    this.chargeWindupTimer = 0;
    this.chargeDistTraveled = 0;
    this.chargeHitDealt = false;
    this.chargeDir = new THREE.Vector3();
    this.chargeStartPos = new THREE.Vector3();
    this.recoveryTimer = 0;

    // Засада (ambush): пугало при спавне стоит неподвижно в позе idleStaff
    const ambushChance = C.ambushChance != null ? C.ambushChance : 0.3;
    this.isAmbush = Math.random() < ambushChance;
    this.state = this.isAmbush ? "ambush" : "idle";

    // 3D-модель, скелетные анимации и материалы
    this.isGlbModel = false;
    this.modelGroup = null;
    this.clonedMaterials = [];
    this.proceduralMaterials = [];
    this.sickleMaterials = [];
    this.mixer = null;
    this.actions = null;
    this.currentAction = null;
    this.currentActionName = "";

    // Визуальные индикаторы: полоса рывка на полу и значок уязвимости
    this.createTelegraphMesh();
    this.setupVulnSprite();

    this.buildModel();
    this.updateHitboxes();
  }

  /**
   * Создать плоский прямоугольник красной дорожки-телеграфа на полу
   */
  createTelegraphMesh() {
    // Базовая геометрия 1x1, смещённая так, чтобы z=0 находился под ногами пугала
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, 0.5);

    const mat = new THREE.MeshBasicMaterial({
      color: 0xff1a1a,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    this.telegraphMesh = new THREE.Mesh(geo, mat);
    this.telegraphMesh.renderOrder = 3;
    this.telegraphMesh.visible = false;
    this.scene.add(this.telegraphMesh);
  }

  showChargeTelegraph(width, distance) {
    if (!this.telegraphMesh) return;
    this.telegraphMesh.scale.set(width, 1, distance);
    this.telegraphMesh.position.set(this.pos.x, this.pos.y + 0.03, this.pos.z);
    this.telegraphMesh.rotation.set(0, Math.atan2(this.chargeDir.x, this.chargeDir.z), 0);
    this.telegraphMesh.visible = true;
    if (this.telegraphMesh.material) {
      this.telegraphMesh.material.opacity = 0.45;
    }
  }

  hideChargeTelegraph() {
    if (this.telegraphMesh) {
      this.telegraphMesh.visible = false;
    }
  }

  /**
   * Спрайт с жёлтой меткой «УЯЗВИМ!» над головой в фазе восстановления
   */
  setupVulnSprite() {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "rgba(20, 10, 0, 0.85)";
    if (ctx.roundRect) ctx.roundRect(8, 8, 240, 48, 8);
    else ctx.fillRect(8, 8, 240, 48);
    ctx.fill();

    ctx.strokeStyle = "#ffd23f";
    ctx.lineWidth = 4;
    if (ctx.roundRect) ctx.roundRect(8, 8, 240, 48, 8);
    else ctx.strokeRect(8, 8, 240, 48);
    ctx.stroke();

    ctx.fillStyle = "#ffd23f";
    ctx.font = "bold 24px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("УЯЗВИМ!", 128, 32);

    const tex = new THREE.CanvasTexture(canvas);
    this.vulnSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    this.vulnSprite.position.set(0, 2.65, 0);
    this.vulnSprite.scale.set(1.5, 0.38, 1);
    this.vulnSprite.visible = false;
    this.group.add(this.vulnSprite);
  }

  buildModel() {
    // 1. Попытка создать инстанс загруженной 3D-модели
    if (hasReaperModel()) {
      const inst = createReaperInstance();
      if (inst) {
        this.isGlbModel = true;
        this.modelGroup = inst.modelGroup;
        this.clonedMaterials = inst.clonedMaterials || [];
        this.mixer = inst.mixer;
        this.actions = inst.actions;

        const mCfg = (CONFIG.enemies.reaper && CONFIG.enemies.reaper.model) || {};
        const targetH = mCfg.height || 2.1;
        const rawH = mCfg.rawHeight || 1.1045;
        const scale = targetH / rawH;

        this.modelGroup.scale.setScalar(scale);
        this.modelGroup.rotation.y = mCfg.rotationY || 0;
        this.modelGroup.position.y = mCfg.offsetY || 0;

        this.group.add(this.modelGroup);
        this.scene.add(this.group);

        this.headBone = this.modelGroup.getObjectByName("mixamorigHead") || null;
        this.headTopBone = this.modelGroup.getObjectByName("mixamorigHeadTop_End") || null;
        this._headWorldPos = new THREE.Vector3();
        this._headTopWorldPos = new THREE.Vector3();

        this.setupSickleMaterials();
        this.playAction(this.state === "ambush" ? "idle" : "idle");
        return;
      }
    }

    // 2. Запасной процедурный вариант из простых фигур
    this.buildProceduralModel();
    this.setupSickleMaterials();
    this.scene.add(this.group);
  }

  /**
   * Найти материалы серпа для подсветки красным при замахе
   */
  setupSickleMaterials() {
    this.sickleMaterials = [];
    if (this.isGlbModel && this.modelGroup) {
      this.modelGroup.traverse((node) => {
        if (node.isMesh || node.isSkinnedMesh) {
          // В reaper.glb серп прикреплен к ноде Cylinder под правой рукой
          const isSickleNode =
            node.name === "mesh_0" ||
            node.name === "mesh_0_1" ||
            (node.parent && node.parent.name === "Cylinder");
          if (isSickleNode && node.material) {
            if (Array.isArray(node.material)) {
              this.sickleMaterials.push(...node.material);
            } else {
              this.sickleMaterials.push(node.material);
            }
          }
        }
      });
    }

    // Если процедурная модель или материалы не найдены
    if (this.sickleMaterials.length === 0) {
      if (this.sickleBlade && this.sickleBlade.material) {
        this.sickleMaterials.push(this.sickleBlade.material);
      } else {
        this.sickleMaterials = this.clonedMaterials;
      }
    }
  }

  /**
   * Запасная процедурная модель пугала (на случай отсутствия или сбоя GLB)
   */
  buildProceduralModel() {
    this.isGlbModel = false;
    const strawMat = createToonMaterial(0xb8860b);
    const darkWoodMat = createToonMaterial(0x4a2e18);
    const burlapMat = createToonMaterial(0x8b5a2b);
    const metalMat = createToonMaterial(0x888899);
    this.proceduralMaterials = [strawMat, darkWoodMat, burlapMat, metalMat];

    const box = (w, h, d, mat) => outlined(new THREE.BoxGeometry(w, h, d), mat);
    const sph = (r, mat) => outlined(new THREE.SphereGeometry(r, 10, 8), mat, 40);

    // Центральный столб / тело
    this.torso = box(0.5, 1.1, 0.4, burlapMat);
    this.torso.position.y = 1.15;
    this.group.add(this.torso);

    // Голова-мешок со шляпой
    this.headGroup = new THREE.Group();
    this.headGroup.position.set(0, 1.85, 0);
    const headMesh = sph(0.28, strawMat);
    const brim = box(0.8, 0.05, 0.8, darkWoodMat);
    brim.position.y = 0.22;
    const crown = box(0.42, 0.35, 0.42, darkWoodMat);
    crown.position.y = 0.42;
    this.headGroup.add(headMesh, brim, crown);
    this.group.add(this.headGroup);

    // Руки (ветви) и серп
    this.armL = new THREE.Group();
    this.armL.position.set(-0.35, 1.45, 0);
    const armLMesh = box(0.12, 0.12, 0.75, darkWoodMat);
    armLMesh.position.z = 0.35;
    this.armL.add(armLMesh);

    this.armR = new THREE.Group();
    this.armR.position.set(0.35, 1.45, 0);
    const armRMesh = box(0.12, 0.12, 0.75, darkWoodMat);
    armRMesh.position.z = 0.35;
    const sickleHandle = box(0.08, 0.8, 0.08, darkWoodMat);
    sickleHandle.position.set(0, 0.1, 0.75);
    this.sickleBlade = box(0.04, 0.14, 0.55, metalMat);
    this.sickleBlade.position.set(0, 0.45, 0.55);
    this.sickleBlade.rotation.x = 0.4;
    this.armR.add(armRMesh, sickleHandle, this.sickleBlade);

    this.group.add(this.armL, this.armR);

    // Ноги-столбы
    this.legL = box(0.15, 0.65, 0.15, darkWoodMat);
    this.legL.position.set(-0.15, 0.32, 0);
    this.legR = box(0.15, 0.65, 0.15, darkWoodMat);
    this.legR.position.set(0.15, 0.32, 0);
    this.group.add(this.legL, this.legR);
  }

  updateHitboxes() {
    const C = CONFIG.enemies.reaper;
    const x = this.pos.x;
    const y = this.pos.y;
    const z = this.pos.z;
    const r = C.hitboxRadius || 0.55;
    const h = C.hitboxHeight || 2.25;
    const hr = C.hitboxHeadRadius || 0.44;
    const hy = C.hitboxHeadY || 1.55;

    if (this.isGlbModel && this.headBone) {
      this.group.updateMatrixWorld(true);
      this.headBone.getWorldPosition(this._headWorldPos);
      let hx = this._headWorldPos.x;
      let headCenterY = this._headWorldPos.y + 0.18;
      let hz = this._headWorldPos.z;
      if (this.headTopBone) {
        this.headTopBone.getWorldPosition(this._headTopWorldPos);
        hx = (this._headWorldPos.x + this._headTopWorldPos.x) * 0.5;
        headCenterY = (this._headWorldPos.y + this._headTopWorldPos.y) * 0.5;
        hz = (this._headWorldPos.z + this._headTopWorldPos.z) * 0.5;
      }

      this.headMin.set(hx - hr, headCenterY - 0.38, hz - hr);
      this.headMax.set(hx + hr, headCenterY + 0.45, hz + hr);
      this.bodyMin.set(x - r, y, z - r);
      this.bodyMax.set(x + r, Math.max(y + hy + 0.15, headCenterY - 0.1), z + r);
      return;
    }

    this.bodyMin.set(x - r, y, z - r);
    this.bodyMax.set(x + r, y + Math.min(h, hy + 0.15), z + r);
    this.headMin.set(x - hr, y + hy, z - hr);
    this.headMax.set(x + hr, y + h, z + hr);
  }

  /**
   * Воспроизведение анимационного клипа пугала
   * @param {"idle"|"chase"|"melee"|"unreachable"|"raise"|"shuffle"|"chargeDash"} stateName
   * @param {number} [crossFade=0.15]
   */
  playAction(stateName, crossFade = 0.15) {
    if (!this.isGlbModel || !this.actions) return;

    const mCfg = (CONFIG.enemies.reaper.model && CONFIG.enemies.reaper.model.clips) || {};
    let clipName = "";
    let timeScale = 1.0;
    let loop = THREE.LoopRepeat;
    let clamp = false;

    if (stateName === "chase") {
      clipName = (mCfg.chase && mCfg.chase.clipName) || "walk";
      timeScale = (mCfg.chase && mCfg.chase.timeScale != null) ? mCfg.chase.timeScale : 2.0;
    } else if (stateName === "chargeDash") {
      clipName = (mCfg.chase && mCfg.chase.clipName) || "walk";
      timeScale = 3.0;
    } else if (stateName === "melee") {
      clipName = (mCfg.melee && mCfg.melee.clipName) || "attack";
      const hitOffset = (mCfg.melee && mCfg.melee.hitOffset) || 1.1;
      const windup = CONFIG.enemies.reaper.attackWindup || 0.5;
      timeScale = hitOffset / windup;
      loop = THREE.LoopOnce;
      clamp = true;
    } else if (stateName === "idle") {
      clipName = (mCfg.idle && mCfg.idle.clipName) || "idleStaff";
      timeScale = (mCfg.idle && mCfg.idle.timeScale != null) ? mCfg.idle.timeScale : 1.0;
    } else if (stateName === "unreachable") {
      clipName = (mCfg.unreachable && mCfg.unreachable.clipName) || "idleHunched";
      timeScale = (mCfg.unreachable && mCfg.unreachable.timeScale != null) ? mCfg.unreachable.timeScale : 1.0;
    } else if (stateName === "raise") {
      clipName = "raise";
      loop = THREE.LoopOnce;
      clamp = true;
    } else if (stateName === "shuffle") {
      clipName = "shuffle";
    }

    const nextAction = this.actions[clipName];
    if (!nextAction) return;

    if (this.currentAction === nextAction && nextAction.isRunning()) {
      return;
    }

    nextAction.reset();
    nextAction.setLoop(loop, loop === THREE.LoopOnce ? 1 : Infinity);
    nextAction.clampWhenFinished = clamp;
    nextAction.timeScale = timeScale;

    if (this.currentAction && this.currentAction !== nextAction) {
      nextAction.crossFadeFrom(this.currentAction, crossFade, true);
    }
    nextAction.play();
    this.currentAction = nextAction;
    this.currentActionName = stateName;
  }

  /**
   * Проигрывание клипа raise с точной подгонкой длительности под время замаха
   */
  playChargeRaiseAction(windup) {
    if (!this.isGlbModel || !this.actions) {
      if (this.armR) this.armR.rotation.x = 1.4;
      return;
    }
    const action = this.actions["raise"];
    if (!action) return;

    const clip = action.getClip();
    const clipDur = clip ? clip.duration : 1.3;
    const timeScale = clipDur / Math.max(0.01, windup);

    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.timeScale = timeScale;

    if (this.currentAction && this.currentAction !== action) {
      action.crossFadeFrom(this.currentAction, 0.08, true);
    }
    action.play();
    this.currentAction = action;
    this.currentActionName = "raise";
  }

  setSickleEmissive(hex, intensity = 1.0) {
    for (let i = 0; i < this.sickleMaterials.length; i++) {
      const mat = this.sickleMaterials[i];
      if (mat && mat.emissive) {
        mat.emissive.setHex(hex);
        if (mat.emissiveIntensity !== undefined) {
          mat.emissiveIntensity = intensity;
        }
      }
    }
  }

  setAllEmissive(hex, intensity = 1.0) {
    for (let i = 0; i < this.clonedMaterials.length; i++) {
      const mat = this.clonedMaterials[i];
      if (mat && mat.emissive) {
        mat.emissive.setHex(hex);
        if (mat.emissiveIntensity !== undefined) {
          mat.emissiveIntensity = intensity;
        }
      }
    }
    for (let i = 0; i < this.proceduralMaterials.length; i++) {
      const mat = this.proceduralMaterials[i];
      if (mat && mat.emissive) {
        mat.emissive.setHex(hex);
        if (mat.emissiveIntensity !== undefined) {
          mat.emissiveIntensity = intensity;
        }
      }
    }
  }

  setFlash(on) {
    const isPsx = (CONFIG.graphics && CONFIG.graphics.styleName) !== "cartoon";
    const baseEmissive = isPsx ? 0x141414 : 0x000000;
    const baseIntensity = isPsx ? 0.8 : 0.0;

    if (on) {
      const flashCol = isPsx ? ((CONFIG.graphics.style && CONFIG.graphics.style.psx && CONFIG.graphics.style.psx.hitFlashColor) || 0xfff4c0) : 0xffffff;
      this.setAllEmissive(flashCol, 0.8);
      return;
    }

    // Восстановление специфического свечения состояний
    if (this.state === "chargeWindup") {
      this.setAllEmissive(baseEmissive, baseIntensity);
      this.setSickleEmissive(0xff1111, 1.2);
    } else if (this.state === "recovery") {
      const isY = Math.sin(this.recoveryTimer * 16) > 0;
      this.setAllEmissive(isY ? 0xffd23f : baseEmissive, isY ? 0.8 : baseIntensity);
    } else {
      this.setAllEmissive(baseEmissive, baseIntensity);
    }
  }

  /**
   * Проверка условий для начала рывка
   */
  canCharge(player, horizDist, heightDiff, world) {
    const C = CONFIG.enemies.reaper;
    const chCfg = C.charge || {};

    if (this.chargeCd > 0) return false;

    const minDist = chCfg.minDist != null ? chCfg.minDist : 6;
    const maxDist = chCfg.maxDist != null ? chCfg.maxDist : 14;
    if (horizDist < minDist || horizDist > maxDist) return false;

    const maxHDiff = chCfg.maxHeightDiff != null ? chCfg.maxHeightDiff : 1.5;
    if (Math.abs(heightDiff) > maxHDiff) return false;

    const from = this._tmpOrigin.set(this.pos.x, this.pos.y + 1.2, this.pos.z);
    const to = this._tmpTarget.set(player.pos.x, player.pos.y + 1.2, player.pos.z);
    const boxes = world && world.getNearbyBoxes ? world.getNearbyBoxes(this.pos) : (world ? world.boxes : []);

    return checkLineOfSight(from, to, boxes, 0.2);
  }

  /**
   * Начать замах и подготовку к рывку
   */
  startCharge(player) {
    const C = CONFIG.enemies.reaper;
    const chCfg = C.charge || {};

    this.state = "chargeWindup";
    this.chargeWindupTimer = chCfg.windup != null ? chCfg.windup : 0.6;
    this.chargeDistTraveled = 0;
    this.chargeHitDealt = false;

    // Направление рывка фиксируется строго в начале замаха
    this.chargeDir.set(player.pos.x - this.pos.x, 0, player.pos.z - this.pos.z);
    if (this.chargeDir.lengthSq() > 1e-6) {
      this.chargeDir.normalize();
    } else {
      this.chargeDir.set(0, 0, 1);
    }
    this.group.rotation.y = Math.atan2(this.chargeDir.x, this.chargeDir.z);
    this.vel.set(0, 0, 0);

    // Анимация замаха серпом
    this.playChargeRaiseAction(this.chargeWindupTimer);

    // Подсветка серпа красным
    this.setSickleEmissive(0xff1111, 1.2);

    // Показ красной полосы-дорожки на полу
    const w = chCfg.width != null ? chCfg.width : 1.5;
    const dist = chCfg.dashDistance != null ? chCfg.dashDistance : 9;
    this.showChargeTelegraph(w, dist);
  }

  takeDamage(dmg, isHeadshot, pushVec, fx, game) {
    if (!this.alive) return;

    const C = CONFIG.enemies.reaper;

    // Если пугало было в засаде, оно мгновенно просыпается
    if (this.state === "ambush") {
      this.isAmbush = false;
      const toP = this._toPlayer.set(game.player.pos.x - this.pos.x, 0, game.player.pos.z - this.pos.z);
      const hDist = toP.length();
      const hDiff = game.player.pos.y - this.pos.y;
      if (this.canCharge(game.player, hDist, hDiff, game.world)) {
        this.startCharge(game.player);
      } else {
        this.state = "chase";
        this.playAction("chase");
      }
    }

    // В фазе восстановления пугало получает в recoveryDamageMult (1.5x) больше урона
    let finalDmg = isHeadshot ? dmg * 2 : dmg;
    if (this.state === "recovery") {
      const mult = C.recoveryDamageMult != null ? C.recoveryDamageMult : 1.5;
      finalDmg *= mult;
    }

    this.hp -= finalDmg;
    this.flashT = 0.08;
    this.setFlash(true);

    if (fx) {
      fx.popup(this.pos.x, this.pos.y + 2.3, this.pos.z, Math.round(finalDmg), isHeadshot);
      const hitNormal = pushVec ? pushVec.clone().normalize().negate() : new THREE.Vector3(0, 1, 0);
      fx.bloodSpray(this.pos, hitNormal, finalDmg);
    }

    if (pushVec) {
      const resist = C.staggerKnockbackResist != null ? C.staggerKnockbackResist : 0.5;
      this.vel.addScaledVector(pushVec, 0.4 * (1 - resist));
    }

    // Проверка на смерть
    if (this.hp <= 0) {
      this.die(isHeadshot, pushVec, fx, game);
      return;
    }

    // Стаггер не сбивает активный рывок или окно уязвимости
    if (
      this.state !== "chargeWindup" &&
      this.state !== "chargeDash" &&
      this.state !== "recovery"
    ) {
      this.state = "stagger";
      this.staggerT = C.staggerTime || 0.2;
    }
  }

  die(isHeadshot, pushVec, fx, game) {
    this.alive = false;
    this.state = "dead";
    this.group.visible = false;
    if (this.shadow) this.shadow.visible = false;

    this.hideChargeTelegraph();
    if (this.vulnSprite) this.vulnSprite.visible = false;
    this.setSickleEmissive(0, 0);

    const C = CONFIG.enemies.reaper;
    const pts = C.scoreValue + (isHeadshot ? (C.headshotBonus || 0) : 0);
    game.onZombieKill(pts, isHeadshot, false, this);

    const isOverkill = pushVec && pushVec.length() > 16;
    const gibCount = isOverkill ? 14 : isHeadshot ? 12 : 10;

    if (fx) {
      if (fx.zombieGibs) {
        fx.zombieGibs(this.pos, gibCount, isHeadshot);
      }
      if (fx.decals) {
        const strawColor = (C.strawColors && C.strawColors[0]) || 0xb8860b;
        fx.decals.add(this.pos, new THREE.Vector3(0, 1, 0), strawColor, 1.4);
      }
    }

    if (game.spawnDrops) {
      game.spawnDrops(this.pos, false, false);
    }
  }

  alert(player = null) {
    if (!this.alive) return;
    // Пугало в засаде не выходит из неё от звуков выстрелов, пока игрок не приблизится на 9 м или не нанесёт урон
    if (this.state === "ambush") return;
    if (this.state === "idle") {
      this.state = "chase";
      this.playAction("chase");
    }
  }

  /**
   * Находит блок препятствия под игроком (игнорирует пол и потолок)
   */
  findBlockUnder(pos, boxes) {
    if (!boxes) return null;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.max.y <= 0.2 || b.min.y < -0.1 || b.min.y > 4.5) continue;
      const height = b.max.y - b.min.y;
      if (!b.isObstacle && height < 1.0 && b.max.y < 1.4) continue;

      if (
        pos.x >= b.min.x - 0.4 &&
        pos.x <= b.max.x + 0.4 &&
        pos.z >= b.min.z - 0.4 &&
        pos.z <= b.max.z + 0.4 &&
        pos.y >= b.max.y - 0.4 &&
        pos.y <= b.max.y + 0.8
      ) {
        return b;
      }
    }
    return null;
  }

  move(dt, world) {
    const C = CONFIG.enemies.reaper;
    const r = C.hitboxRadius || 0.45;
    const h = C.hitboxHeight || 2.1;
    const boxes = world && world.getNearbyBoxes ? world.getNearbyBoxes(this.pos) : (world ? world.boxes : []);

    this.pos.x += this.vel.x * dt;
    resolveBoxCollision(this.pos, this.vel, r, h, boxes, "x", 0.001);

    this.pos.z += this.vel.z * dt;
    resolveBoxCollision(this.pos, this.vel, r, h, boxes, "z", 0.001);

    this.pos.y += this.vel.y * dt;
    resolveBoxCollision(this.pos, this.vel, r, h, boxes, "y", 0.001);

    this.clampToRoom(this.pos, r, this.getBoundRoom(world));

    const half = (world && world.rooms && world.rooms.length > 0)
      ? (CONFIG.level.gridSize * CONFIG.level.cellSize) / 2
      : CONFIG.world.roomSize / 2;
    const margin = r + 0.05;
    this.pos.x = Math.max(-half + margin, Math.min(half - margin, this.pos.x));
    this.pos.z = Math.max(-half + margin, Math.min(half - margin, this.pos.z));
  }

  update(dt, player, world, enemies, game, fx) {
    if (!this.alive) return;
    if (this.arena && this.arena.state !== "active") return;

    if (this.mixer) {
      const timeScale = (game && game.timeScale != null) ? game.timeScale : 1.0;
      this.mixer.update(dt * timeScale);
    }

    const C = CONFIG.enemies.reaper;
    const uCfg = CONFIG.enemies.unreachable;
    const chCfg = C.charge || {};

    if (this.flashT > 0 && (this.flashT -= dt) <= 0) {
      this.setFlash(false);
    }

    if (this.chargeCd > 0) {
      this.chargeCd -= dt;
    }

    const toPlayer = this._toPlayer.set(player.pos.x - this.pos.x, 0, player.pos.z - this.pos.z);
    const horizDist = toPlayer.length();
    const dirToPlayer = this._dirToPlayer;
    if (horizDist > 1e-4) {
      dirToPlayer.copy(toPlayer).multiplyScalar(1 / horizDist);
    } else {
      dirToPlayer.set(0, 0, 1);
    }

    const heightDiff = player.pos.y - this.pos.y;
    const playerChestY = player.pos.y + 0.9;
    const reaperChestY = this.pos.y + 1.1;
    const meleeHeightDiff = Math.abs(playerChestY - reaperChestY);

    const playerBoxes = world.getNearbyBoxes ? world.getNearbyBoxes(player.pos) : world.boxes;
    const blockUnderPlayer = this.findBlockUnder(player.pos, playerBoxes);
    const isPlayerUnreachable = blockUnderPlayer !== null &&
      (player.onGround || player.pos.y >= blockUnderPlayer.max.y - 0.2) &&
      heightDiff > uCfg.heightThreshold;

    // 0. Состояние ЗАМАХА РЫВКА (chargeWindup)
    if (this.state === "chargeWindup") {
      this.vel.set(0, 0, 0);
      this.chargeWindupTimer -= dt;

      // Пульсация красной полосы-дорожки перед рывком
      if (this.telegraphMesh && this.telegraphMesh.visible) {
        const pulse = 0.35 + 0.2 * Math.sin(this.chargeWindupTimer * 25);
        this.telegraphMesh.material.opacity = pulse;
      }

      if (this.chargeWindupTimer <= 0) {
        // Переход в фазу активного рывка
        this.state = "chargeDash";
        this.chargeDistTraveled = 0;
        this.chargeStartPos.copy(this.pos);
        this.chargeHitDealt = false;
        this.playAction("chargeDash", 0.05);
      }

      this.group.position.copy(this.pos);
      this.updateHitboxes();
      return;
    }

    // 0.1. Состояние АКТИВНОГО РЫВКА (chargeDash)
    else if (this.state === "chargeDash") {
      const dashSpeed = chCfg.dashSpeed != null ? chCfg.dashSpeed : 20;
      const maxDistance = chCfg.dashDistance != null ? chCfg.dashDistance : 9;

      this.vel.x = this.chargeDir.x * dashSpeed;
      this.vel.z = this.chargeDir.z * dashSpeed;

      // Проверка попадания игрока в полосу поражения шириной 1.5 м
      if (!this.chargeHitDealt) {
        const toP = this._tmpDir.set(player.pos.x - this.chargeStartPos.x, 0, player.pos.z - this.chargeStartPos.z);
        const proj = toP.dot(this.chargeDir);

        if (proj >= -0.5 && proj <= this.chargeDistTraveled + 0.8) {
          const perpX = toP.x - proj * this.chargeDir.x;
          const perpZ = toP.z - proj * this.chargeDir.z;
          const perpDist = Math.hypot(perpX, perpZ);
          const halfWidth = (chCfg.width != null ? chCfg.width : 1.5) / 2;
          const playerRadius = CONFIG.player.radius || 0.4;

          if (perpDist <= halfWidth + playerRadius) {
            const maxHDiff = CONFIG.enemies.meleeMaxHeightDiff || 1.3;
            // Игрок, прыгнувший над пугалом, не получает урон
            if (meleeHeightDiff <= maxHDiff) {
              // Учёт неуязвимости игрока (рывок/дэш или неуязвимость после урона)
              const isInvuln = player.dashTimer > 0 || player.invulnT > 0;
              if (!isInvuln) {
                this.chargeHitDealt = true;
                player.takeDamage(chCfg.damage != null ? chCfg.damage : 30, this.pos, game);
              }
            }
          }
        }
      }

      // Перемещение с проверкой коллизий стен и блоков
      const prevX = this.pos.x;
      const prevZ = this.pos.z;
      this.move(dt, world);

      const movedDist = Math.hypot(this.pos.x - prevX, this.pos.z - prevZ);
      this.chargeDistTraveled += movedDist;

      // Остановка рывка при столкновении со стеной/блоком или достижении максимальной дистанции
      const expectedDist = dashSpeed * dt;
      const isWallBlocked = expectedDist > 0.05 && movedDist < expectedDist * 0.25;
      const reachedMaxDist = this.chargeDistTraveled >= maxDistance;

      if (isWallBlocked || reachedMaxDist) {
        this.vel.set(0, 0, 0);
        this.hideChargeTelegraph();
        this.setSickleEmissive(0, 0);

        this.state = "recovery";
        this.recoveryTimer = chCfg.recoveryTime != null ? chCfg.recoveryTime : 1.2;
        this.playAction("idle", 0.08); // idleStaff
      }

      this.group.position.copy(this.pos);
      this.updateHitboxes();
      return;
    }

    // 0.2. Состояние ВОССТАНОВЛЕНИЯ (recovery) — пугало уязвимо (1.5x урон)
    else if (this.state === "recovery") {
      this.vel.set(0, 0, 0);
      this.recoveryTimer -= dt;

      // Мигание метки «УЯЗВИМ!» и жёлтой подсветки
      const isYellow = Math.sin(this.recoveryTimer * 16) > 0;
      if (this.vulnSprite) {
        this.vulnSprite.visible = true;
        const sc = 1.4 + 0.15 * Math.sin(this.recoveryTimer * 16);
        this.vulnSprite.scale.set(sc, sc * 0.25, 1);
      }

      if (this.flashT <= 0) {
        this.setAllEmissive(isYellow ? 0xffd23f : 0x000000, isYellow ? 0.8 : 0);
      }

      if (this.recoveryTimer <= 0) {
        if (this.vulnSprite) this.vulnSprite.visible = false;
        this.setAllEmissive(0, 0);
        this.chargeCd = chCfg.cooldown != null ? chCfg.cooldown : 5.0;
        this.state = isPlayerUnreachable ? "unreachable" : "chase";
        this.playAction(this.state);
      }

      this.group.position.copy(this.pos);
      this.updateHitboxes();
      return;
    }

    // 0.3. Состояние ЗАСАДЫ (ambush) — неподвижное пугало-декор
    else if (this.state === "ambush") {
      this.vel.set(0, 0, 0);
      this.playAction("idle"); // idleStaff

      // Пробуждение, когда игрок подошёл ближе 9 м
      if (horizDist <= 9) {
        this.isAmbush = false;
        if (this.canCharge(player, horizDist, heightDiff, world)) {
          this.startCharge(player);
          return;
        } else {
          this.state = "chase";
          this.playAction("chase");
        }
      }

      this.group.position.copy(this.pos);
      this.updateHitboxes();
      return;
    }

    // 1. Состояние UNREACHABLE (игрок на недосягаемом высоком блоке)
    else if (this.state === "unreachable") {
      this.unreachableCheckTimer -= dt;
      if (this.unreachableCheckTimer <= 0) {
        this.unreachableCheckTimer = uCfg.checkInterval;
        if (!isPlayerUnreachable) {
          this.state = "chase";
          this.unreachableAngle = undefined;
          this.playAction("chase");
          return;
        }
      }

      this.playAction("unreachable");

      const block = blockUnderPlayer || {
        min: new THREE.Vector3(player.pos.x - 2, 0, player.pos.z - 2),
        max: new THREE.Vector3(player.pos.x + 2, 3, player.pos.z + 2)
      };

      const bx = (block.min.x + block.max.x) / 2;
      const bz = (block.min.z + block.max.z) / 2;
      const halfW = (block.max.x - block.min.x) / 2;
      const halfD = (block.max.z - block.min.z) / 2;

      if (this.unreachableAngle === undefined) {
        this.unreachableAngle = Math.atan2(this.pos.x - bx, this.pos.z - bz) + rnd(0.5);
        this.unreachableRingDist = uCfg.ringMinDist + Math.random() * (uCfg.ringMaxDist - uCfg.ringMinDist);
        this.unreachableSubState = "move";
        this.unreachableSubTimer = uCfg.moveDurationMin + Math.random() * (uCfg.moveDurationMax - uCfg.moveDurationMin);
        this.unreachableCheckTimer = uCfg.checkInterval;
      }

      const cosA = Math.cos(this.unreachableAngle);
      const sinA = Math.sin(this.unreachableAngle);
      const expHalfW = halfW + this.unreachableRingDist;
      const expHalfD = halfD + this.unreachableRingDist;
      const tx = Math.abs(cosA) > 1e-4 ? expHalfW / Math.abs(cosA) : Infinity;
      const tz = Math.abs(sinA) > 1e-4 ? expHalfD / Math.abs(sinA) : Infinity;
      const targetRadius = Math.min(tx, tz);
      let targetX = bx + cosA * targetRadius;
      let targetZ = bz + sinA * targetRadius;

      const nearX = Math.max(block.min.x, Math.min(this.pos.x, block.max.x));
      const nearZ = Math.max(block.min.z, Math.min(this.pos.z, block.max.z));
      const distFromBlock = Math.hypot(this.pos.x - nearX, this.pos.z - nearZ);

      if (distFromBlock < uCfg.ringMinDist) {
        let awayX = this.pos.x - nearX;
        let awayZ = this.pos.z - nearZ;
        let awayLen = Math.hypot(awayX, awayZ);
        if (awayLen < 1e-4) {
          awayX = cosA;
          awayZ = sinA;
          awayLen = 1;
        }
        const pushSpeed = this.speed * uCfg.speedFactor;
        this.vel.x = (awayX / awayLen) * pushSpeed;
        this.vel.z = (awayZ / awayLen) * pushSpeed;
        this.group.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);
      } else {
        this.unreachableSubTimer -= dt;
        if (this.unreachableSubState === "move") {
          const toTargetX = targetX - this.pos.x;
          const toTargetZ = targetZ - this.pos.z;
          const distToTarget = Math.hypot(toTargetX, toTargetZ);

          if (distToTarget < 0.4 || this.unreachableSubTimer <= 0) {
            this.unreachableSubState = "stop";
            this.unreachableSubTimer = uCfg.stopDurationMin + Math.random() * (uCfg.stopDurationMax - uCfg.stopDurationMin);
            this.vel.x = 0;
            this.vel.z = 0;
            this.playAction("idle");
          } else {
            const dirToTarget = this._tmpDir.set(toTargetX / distToTarget, 0, toTargetZ / distToTarget);
            const moveDir = this.steer(dirToTarget, world);
            const moveSpeed = this.speed * uCfg.speedFactor;
            this.vel.x = moveDir.x * moveSpeed;
            this.vel.z = moveDir.z * moveSpeed;
            this.group.rotation.y = Math.atan2(moveDir.x, moveDir.z);
          }
        } else {
          this.vel.x = 0;
          this.vel.z = 0;
          this.group.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);
          if (this.unreachableSubTimer <= 0) {
            this.unreachableAngle += (Math.random() < 0.5 ? 1 : -1) * (0.8 + Math.random() * 0.8);
            this.unreachableRingDist = uCfg.ringMinDist + Math.random() * (uCfg.ringMaxDist - uCfg.ringMinDist);
            this.unreachableSubState = "move";
            this.unreachableSubTimer = uCfg.moveDurationMin + Math.random() * (uCfg.moveDurationMax - uCfg.moveDurationMin);
            this.playAction("unreachable");
          }
        }
      }
    }

    // 2. Состояние IDLE
    else if (this.state === "idle") {
      this.playAction("idle");

      if (horizDist < C.aggroRange) {
        let hasLOS = true;
        const origin = this._tmpOrigin.set(this.pos.x, this.pos.y + 1.2, this.pos.z);
        const enemyBoxes = world.getNearbyBoxes ? world.getNearbyBoxes(this.pos) : world.boxes;
        for (let i = 0; i < enemyBoxes.length; i++) {
          const b = enemyBoxes[i];
          const h = rayAABB(origin, dirToPlayer, b.min, b.max, 0.1);
          if (h && h.t < horizDist) {
            hasLOS = false;
            break;
          }
        }
        if (hasLOS) {
          if (this.canCharge(player, horizDist, heightDiff, world)) {
            this.startCharge(player);
            return;
          } else if (isPlayerUnreachable) {
            this.state = "unreachable";
            this.unreachableAngle = undefined;
            this.playAction("unreachable");
          } else {
            this.state = "chase";
            this.playAction("chase");
          }
        }
      }
    }

    // 3. Состояние CHASE
    else if (this.state === "chase") {
      if (isPlayerUnreachable) {
        this.state = "unreachable";
        this.unreachableAngle = undefined;
        this.playAction("unreachable");
        return;
      }

      // Проверка возможности рывка
      if (this.canCharge(player, horizDist, heightDiff, world)) {
        this.startCharge(player);
        return;
      }

      this.playAction("chase");

      const yaw = Math.atan2(dirToPlayer.x, dirToPlayer.z);
      this.group.rotation.y = yaw;

      if (!this.isGlbModel) {
        this.wobbleT += dt * 8;
        this.armL.rotation.x = Math.sin(this.wobbleT) * 0.3;
        this.armR.rotation.x = -Math.sin(this.wobbleT) * 0.3;
      }

      let moveDir = this.steer(dirToPlayer, world);

      this.checkStuckT += dt;
      if (this.checkStuckT >= (C.stuckCheckInterval || 0.4)) {
        const moved = this.pos.distanceTo(this.lastCheckPos);
        if (moved < (C.stuckMinMoveDist || 0.2)) {
          this.sidestepT = C.sidestepDuration || 0.6;
          this.sidestepDir.set(-dirToPlayer.z, 0, dirToPlayer.x).multiplyScalar(Math.random() < 0.5 ? 1 : -1);
        }
        this.lastCheckPos.copy(this.pos);
        this.checkStuckT = 0;
      }

      if (this.sidestepT > 0) {
        this.sidestepT -= dt;
        moveDir.addScaledVector(this.sidestepDir, 1.2).normalize();
      }

      this.vel.x = moveDir.x * this.speed;
      this.vel.z = moveDir.z * this.speed;

      // Проверка начала обычной ближней атаки серпом
      if (horizDist <= C.attackRange && meleeHeightDiff <= CONFIG.enemies.meleeMaxHeightDiff && this.attackCd <= 0) {
        this.state = "melee";
        this.attackT = 0;
        this._hitDealt = false;
        this.playAction("melee", 0.08);
      }
    }

    // 4. Состояние MELEE (размах и удар серпом)
    else if (this.state === "melee") {
      this.vel.x *= 0.4;
      this.vel.z *= 0.4;
      this.attackT += dt;

      this.group.rotation.y = Math.atan2(dirToPlayer.x, dirToPlayer.z);

      if (!this.isGlbModel && this.armR) {
        const windupProg = Math.min(1, this.attackT / C.attackWindup);
        this.armR.rotation.x = 0.2 + windupProg * 1.4;
      }

      // Нанесение урона в момент выпада (attackWindup = 0.5 с)
      if (!this._hitDealt && this.attackT >= C.attackWindup) {
        this._hitDealt = true;
        if (horizDist <= C.attackRange + 0.5 && meleeHeightDiff <= CONFIG.enemies.meleeMaxHeightDiff) {
          player.takeDamage(C.damage, this.pos, game);
        }
      }

      // Окончание удара и восстановление
      if (this.attackT >= C.attackWindup + 0.35) {
        this.attackCd = C.attackCooldown;
        this.state = isPlayerUnreachable ? "unreachable" : "chase";
        if (isPlayerUnreachable) this.unreachableAngle = undefined;
        this.playAction(this.state);
      }
    }

    // 5. Состояние STAGGER (отшат при получении урона)
    else if (this.state === "stagger") {
      this.staggerT -= dt;
      const totalTime = C.staggerTime || 0.2;
      const prog = Math.max(0, this.staggerT / totalTime);
      const tilt = -(C.staggerTilt || 0.25) * prog;

      if (this.modelGroup) {
        this.modelGroup.rotation.x = tilt;
      } else if (this.torso) {
        this.torso.rotation.x = tilt;
      }

      if (this.staggerT <= 0) {
        if (this.modelGroup) this.modelGroup.rotation.x = 0;
        if (this.torso) this.torso.rotation.x = 0;
        this.state = isPlayerUnreachable ? "unreachable" : "chase";
        this.playAction(this.state);
      }
    }

    if (this.attackCd > 0) this.attackCd -= dt;

    // Расталкивание с остальными врагами (только в подвижных состояниях, не во время рывка или засады)
    if (this.state !== "ambush" && this.state !== "chargeDash" && enemies && enemies.length) {
      const sepDist = C.separationDist || 1.1;
      const sepPush = C.separationPushForce || 3.5;
      for (let i = 0; i < enemies.length; i++) {
        const other = enemies[i];
        if (other === this || !other.alive) continue;
        const dx = this.pos.x - other.pos.x;
        const dz = this.pos.z - other.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < sepDist && d > 1e-4) {
          const pushForce = (sepDist - d) * sepPush * dt;
          this.pos.x += (dx / d) * pushForce;
          this.pos.z += (dz / d) * pushForce;
        }
      }
    }

    this.vel.y -= CONFIG.movement.gravity * dt;
    this.move(dt, world);
    this.group.position.copy(this.pos);
    this.updateHitboxes();
  }

  destroy() {
    if (this._destroyed) return;
    this.hideChargeTelegraph();
    if (this.telegraphMesh) {
      this.scene.remove(this.telegraphMesh);
      if (this.telegraphMesh.geometry) this.telegraphMesh.geometry.dispose();
      if (this.telegraphMesh.material) this.telegraphMesh.material.dispose();
      this.telegraphMesh = null;
    }
    if (this.vulnSprite) {
      this.group.remove(this.vulnSprite);
      if (this.vulnSprite.material) {
        if (this.vulnSprite.material.map) this.vulnSprite.material.map.dispose();
        this.vulnSprite.material.dispose();
      }
      this.vulnSprite = null;
    }
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }
    this.clonedMaterials = [];
    this.sickleMaterials = [];
    this.proceduralMaterials = [];
    this.actions = null;
    this.currentAction = null;
    super.destroy();
  }
}
