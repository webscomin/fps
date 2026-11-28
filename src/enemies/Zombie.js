// Враг Зомби: 3D-модель (GLB) со скелетной анимацией (или процедурный запасной вариант),
// ИИ преследования, атаки, состояния оглушения и кольцо вокруг недосягаемого игрока
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { outlined, rayAABB, rnd } from "../core/Physics.js";
import { getGloryPromptTexture } from "../effects/PromptTexture.js";
import { Enemy } from "./Enemy.js";
import { createToonMaterial } from "../world/Materials.js";
import { hasZombieModel, createZombieInstance } from "../core/ModelCache.js";

export class Zombie extends Enemy {
  /**
   * @param {THREE.Scene} scene
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  constructor(scene, x, y, z) {
    const C = CONFIG.enemies.zombie;
    const speed = C.speed * (1 + rnd(C.speedVar));
    super(scene, x, y, z, C.health, speed);

    this.attackT = 0;
    this.attackCd = 0;
    this.staggerT = 0;
    this.wobbleT = Math.random() * 10;
    this.checkStuckT = 0;
    this.lastCheckPos = new THREE.Vector3(x, y, z);
    this.sidestepDir = new THREE.Vector3();
    this.sidestepT = 0;

    // Параметры поведения при недосягаемом игроке (кольцо вокруг блока)
    this.unreachableAngle = undefined;
    this.unreachableRingDist = undefined;
    this.unreachableSubState = "move"; // "move" или "stop"
    this.unreachableSubTimer = 0;
    this.unreachableCheckTimer = 0;

    // 3D-модель и скелетные анимации
    this.isGlbModel = false;
    this.modelGroup = null;
    this.skinnedMesh = null;
    this.outlineMesh = null;
    this.mixer = null;
    this.actions = null;
    this.currentAction = null;
    this.currentActionName = "";
    this.materials = null;
    this.currentMaterial = null;

    this.buildModel();
    this.updateHitboxes();
  }

  buildModel() {
    // 1. Попытка создать инстанс загруженной 3D-модели
    if (hasZombieModel()) {
      const inst = createZombieInstance();
      if (inst) {
        this.isGlbModel = true;
        this.modelGroup = inst.modelGroup;
        this.skinnedMesh = inst.skinnedMesh;
        this.outlineMesh = inst.outlineMesh;
        this.mixer = inst.mixer;
        this.actions = inst.actions;
        this.materials = inst.materials;

        const mCfg = CONFIG.enemies.zombie.model || {};
        const targetH = mCfg.height || 2.0;
        const rawH = mCfg.rawHeight || 1.85;
        const scale = targetH / rawH;

        this.modelGroup.scale.setScalar(scale);
        this.modelGroup.rotation.y = mCfg.rotationY || 0;
        this.modelGroup.position.y = mCfg.offsetY || 0;

        this.group.add(this.modelGroup);
        this.applyStyle(CONFIG.graphics.zombieStyle || "toon", CONFIG.graphics.mode);

        this.setupCommonEffects();
        this.scene.add(this.group);
        this.playAction("idle");
        return;
      }
    }

    // 2. Запасной процедурный вариант из простых фигур
    this.buildProceduralModel();
    this.setupCommonEffects();
    this.scene.add(this.group);
  }

  /**
   * Общие процедурные элементы: звёздочки оглушения и подсказка добивания
   */
  setupCommonEffects() {
    // Эффект оглушения: звёздочки над головой
    this.stunStars = new THREE.Group();
    this.stunStars.position.set(0, 2.25, 0);
    for (let i = 0; i < 3; i++) {
      const star = outlined(new THREE.BoxGeometry(0.08, 0.08, 0.08), createToonMaterial(0xffd23f));
      const ang = (i / 3) * Math.PI * 2;
      star.position.set(Math.cos(ang) * 0.26, 0, Math.sin(ang) * 0.26);
      this.stunStars.add(star);
    }
    this.stunStars.visible = false;
    this.group.add(this.stunStars);

    // Подсказка "[E] ДОБИТЬ"
    const tex = getGloryPromptTexture();
    this.promptSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    this.promptSprite.position.set(0, 2.55, 0);
    this.promptSprite.scale.set(1.6, 0.4, 1);
    this.promptSprite.visible = false;
    this.group.add(this.promptSprite);
  }

  /**
   * Запасная процедурная модель (на случай ошибки загрузки GLB)
   */
  buildProceduralModel() {
    this.isGlbModel = false;
    const isPsx = (CONFIG.graphics && CONFIG.graphics.styleName) !== "cartoon";
    const baseOpts = isPsx ? { emissive: 0x141414, emissiveIntensity: 1.0 } : {};
    this.coatMat = createToonMaterial(0xeeeeee, baseOpts);
    this.skinMat = createToonMaterial(0x55aa44, baseOpts);
    this.pantsMat = createToonMaterial(0x2b283d, baseOpts);
    this.badgeMat = createToonMaterial(0xffd23f, baseOpts);
    this.eyeWMat = createToonMaterial(0xffffff, baseOpts);
    this.eyeBMat = createToonMaterial(0x1b1340, baseOpts);
    this.stainMat = createToonMaterial(0x38b000, baseOpts);

    const box = (w, h, d, mat) => outlined(new THREE.BoxGeometry(w, h, d), mat);
    const sph = (r, mat) => outlined(new THREE.SphereGeometry(r, 10, 8), mat, 40);

    // Тело
    this.torso = box(0.55, 0.95, 0.32, this.coatMat);
    this.torso.position.y = 1.05;
    this.group.add(this.torso);

    // Бейдж и пятна
    const badge = box(0.12, 0.16, 0.04, this.badgeMat);
    badge.position.set(0.15, 1.25, 0.17);
    const stain1 = box(0.16, 0.22, 0.02, this.stainMat);
    stain1.position.set(-0.12, 0.95, 0.17);
    const stain2 = box(0.2, 0.14, 0.02, createToonMaterial(0x991b1b));
    stain2.position.set(0.08, 0.8, 0.17);
    this.group.add(badge, stain1, stain2);

    // Голова
    this.headGroup = new THREE.Group();
    this.headGroup.position.set(0, 1.74, 0);
    const headMesh = sph(0.3, this.skinMat);
    const eyeL = sph(0.1, this.eyeWMat);
    eyeL.position.set(-0.11, 0.06, 0.24);
    const pupilL = sph(0.045, this.eyeBMat);
    pupilL.position.set(-0.11, 0.06, 0.32);
    const eyeR = sph(0.07, this.eyeWMat);
    eyeR.position.set(0.12, 0.02, 0.26);
    const pupilR = sph(0.035, this.eyeBMat);
    pupilR.position.set(0.12, 0.02, 0.32);
    const jaw = box(0.26, 0.09, 0.18, this.skinMat);
    jaw.position.set(0, -0.2, 0.12);
    this.headGroup.add(headMesh, eyeL, pupilL, eyeR, pupilR, jaw);
    this.group.add(this.headGroup);

    // Руки
    this.armL = new THREE.Group();
    this.armL.position.set(-0.36, 1.35, 0);
    const armLMesh = box(0.15, 0.15, 0.7, this.coatMat);
    armLMesh.position.z = 0.35;
    const handL = box(0.13, 0.13, 0.2, this.skinMat);
    handL.position.z = 0.75;
    this.armL.add(armLMesh, handL);

    this.armR = new THREE.Group();
    this.armR.position.set(0.36, 1.35, 0);
    const armRMesh = box(0.15, 0.15, 0.7, this.coatMat);
    armRMesh.position.z = 0.35;
    const handR = box(0.13, 0.13, 0.2, this.skinMat);
    handR.position.z = 0.75;
    this.armR.add(armRMesh, handR);
    this.group.add(this.armL, this.armR);

    // Ноги
    this.legL = box(0.2, 0.6, 0.22, this.pantsMat);
    this.legL.position.set(-0.16, 0.3, 0);
    this.legR = box(0.2, 0.6, 0.22, this.pantsMat);
    this.legR.position.set(0.16, 0.3, 0);
    this.group.add(this.legL, this.legR);
  }

  /**
   * Переключение внешнего вида (pbr / toon) и контура.
   * В режиме PSX зомби всегда использует pbr без контура.
   * @param {"pbr"|"toon"} style
   * @param {"low"|"medium"|"high"} quality
   */
  applyStyle(style = "pbr", quality = "high") {
    if (!this.isGlbModel || !this.skinnedMesh || !this.materials) return;
    const isPsx = (CONFIG.graphics && CONFIG.graphics.styleName) !== "cartoon";
    const usePbr = isPsx || style === "pbr";
    const mat = usePbr ? this.materials.pbr : this.materials.toon;
    this.skinnedMesh.material = mat;
    this.currentMaterial = mat;

    if (this.outlineMesh) {
      this.outlineMesh.visible = !isPsx && style === "toon" && quality === "high";
    }
  }

  /**
   * Воспроизведение анимационного клипа с плавным переходом crossFadeTo (0.12 с)
   * @param {"idle"|"chase"|"attackSwipe"|"attackBite"|"stagger"|"stunned"|"unreachable"} stateName
   * @param {number} [crossFade=0.12]
   */
  playAction(stateName, crossFade = 0.12) {
    if (!this.isGlbModel || !this.actions) return;

    const mCfg = (CONFIG.enemies.zombie.model && CONFIG.enemies.zombie.model.clips) || {};

    let clipName = "";
    let timeScale = 1.0;
    let loop = THREE.LoopRepeat;
    let clamp = false;

    if (stateName === "idle") {
      clipName = (mCfg.idle && mCfg.idle.clipName) || "ZombieWalk";
      timeScale = (mCfg.idle && mCfg.idle.timeScale != null) ? mCfg.idle.timeScale : 0.25;
    } else if (stateName === "chase") {
      clipName = (mCfg.chase && mCfg.chase.clipName) || "ZombieRun";
      const baseSpeed = (mCfg.chase && mCfg.chase.baseSpeed) || 1.619;
      const minScale = (mCfg.chase && mCfg.chase.minScale) || 1.2;
      const maxScale = (mCfg.chase && mCfg.chase.maxScale) || 3.2;
      timeScale = Math.max(minScale, Math.min(maxScale, this.speed / baseSpeed));
    } else if (stateName === "attackSwipe") {
      clipName = (mCfg.attack && mCfg.attack.swipe && mCfg.attack.swipe.clipName) || "ZombieSwipe";
      const hitTime = (mCfg.attack && mCfg.attack.swipe && mCfg.attack.swipe.hitTime) || 0.948;
      const windup = CONFIG.enemies.zombie.attackWindup || 0.35;
      timeScale = hitTime / windup;
      loop = THREE.LoopOnce;
      clamp = true;
    } else if (stateName === "attackBite") {
      clipName = (mCfg.attack && mCfg.attack.bite && mCfg.attack.bite.clipName) || "ZombieBite";
      const hitTime = (mCfg.attack && mCfg.attack.bite && mCfg.attack.bite.hitTime) || 0.82;
      const windup = CONFIG.enemies.zombie.attackWindup || 0.35;
      timeScale = hitTime / windup;
      loop = THREE.LoopOnce;
      clamp = true;
    } else if (stateName === "stagger") {
      clipName = (mCfg.stagger && mCfg.stagger.clipName) || "ZombieStumble";
      timeScale = (mCfg.stagger && mCfg.stagger.timeScale != null) ? mCfg.stagger.timeScale : 4.0;
      loop = THREE.LoopOnce;
      clamp = true;
    } else if (stateName === "stunned") {
      clipName = (mCfg.stunned && mCfg.stunned.clipName) || "ZombieStumble";
      timeScale = 1.0;
      loop = THREE.LoopOnce;
      clamp = true;
    } else if (stateName === "unreachable") {
      clipName = (mCfg.unreachable && mCfg.unreachable.clipName) || "ZombieWalk";
      timeScale = (mCfg.unreachable && mCfg.unreachable.timeScale != null) ? mCfg.unreachable.timeScale : 0.5;
    }

    if (!clipName || !this.actions[clipName]) return;

    if (this.currentActionName === stateName && this.actions[clipName].isRunning()) {
      if (loop === THREE.LoopRepeat) return;
    }

    const prevAction = this.currentAction;
    const nextAction = this.actions[clipName];

    nextAction.reset();
    nextAction.setLoop(loop, loop === THREE.LoopOnce ? 1 : Infinity);
    nextAction.clampWhenFinished = clamp;
    nextAction.timeScale = timeScale;

    if (prevAction && prevAction !== nextAction) {
      prevAction.crossFadeTo(nextAction, crossFade, true);
    }
    nextAction.play();

    this.currentAction = nextAction;
    this.currentActionName = stateName;
  }

  setFlash(on) {
    const isPsx = (CONFIG.graphics && CONFIG.graphics.styleName) !== "cartoon";
    const flashCol = isPsx ? ((CONFIG.graphics.style && CONFIG.graphics.style.psx && CONFIG.graphics.style.psx.hitFlashColor) || 0xfff4c0) : 0xffffff;
    const baseCol = isPsx ? 0x141414 : 0;
    const hex = on ? flashCol : baseCol;
    if (this.isGlbModel) {
      if (this.currentMaterial) {
        this.currentMaterial.emissive.setHex(hex);
      }
    } else {
      if (this.coatMat) this.coatMat.emissive.setHex(hex);
      if (this.skinMat) this.skinMat.emissive.setHex(hex);
    }
  }

  die(isHeadshot, pushVec, fx, game, isGloryKill = false, wasStunned = false) {
    this.stunStars.visible = false;
    this.promptSprite.visible = false;
    if (this.mixer) {
      this.mixer.stopAllAction();
    }
    super.die(isHeadshot, pushVec, fx, game, isGloryKill, wasStunned);
  }

  destroy() {
    if (this._destroyed) return;
    if (this.mixer) {
      this.mixer.stopAllAction();
      if (this.modelGroup) {
        this.mixer.uncacheRoot(this.modelGroup);
      }
      this.mixer = null;
    }
    this.actions = null;
    this.currentAction = null;
    this.skinnedMesh = null;
    this.outlineMesh = null;
    this.modelGroup = null;
    this.materials = null;
    this.currentMaterial = null;
    super.destroy();
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

  update(dt, player, world, zombies, game, fx) {
    if (!this.alive) return;

    // Не обновляем врагов неактивной арены (экономия FPS)
    if (this.arena && this.arena.state !== "active") return;

    // Обновляем анимационный миксер с учётом игрового timeScale (замедление при добивании/косяке)
    if (this.mixer) {
      const timeScale = (game && game.timeScale != null) ? game.timeScale : 1.0;
      this.mixer.update(dt * timeScale);
    }

    const C = CONFIG.enemies.zombie;
    const uCfg = CONFIG.enemies.unreachable;

    if (this.flashT > 0 && (this.flashT -= dt) <= 0) this.setFlash(false);

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
    const zombieChestY = this.pos.y + 1.05;
    const meleeHeightDiff = Math.abs(playerChestY - zombieChestY);

    const playerBoxes = world.getNearbyBoxes ? world.getNearbyBoxes(player.pos) : world.boxes;
    const blockUnderPlayer = this.findBlockUnder(player.pos, playerBoxes);
    const isPlayerUnreachable = blockUnderPlayer !== null &&
      (player.onGround || player.pos.y >= blockUnderPlayer.max.y - 0.2) &&
      heightDiff > uCfg.heightThreshold;

    // 0. Состояние STUNNED (Оглушён для добивания)
    if (this.state === "stunned") {
      this.vel.x = 0;
      this.vel.z = 0;
      this.wobbleT += dt * 4;
      this.stunStars.visible = true;
      this.stunStars.rotation.y += dt * 4;

      // Мигает оранжевым
      const isOrange = Math.sin(this.wobbleT * 12) > 0;
      const oc = isOrange ? 0xff7700 : 0;

      if (this.isGlbModel) {
        this.playAction("stunned", 0.12);
        if (this.currentMaterial) this.currentMaterial.emissive.setHex(oc);
        if (this.modelGroup) this.modelGroup.rotation.z = Math.sin(this.wobbleT * 2) * 0.12;
      } else {
        this.coatMat.emissive.setHex(oc);
        this.skinMat.emissive.setHex(oc);
        this.torso.rotation.z = Math.sin(this.wobbleT * 2) * 0.12;
        this.torso.rotation.x = 0.22;
        this.armL.rotation.x = -0.2;
        this.armR.rotation.x = -0.2;
      }

      // Проверка условий подсказки "[E] ДОБИТЬ"
      const eyeDir = this._tmpDir;
      player.camera.getWorldDirection(eyeDir);
      const toZ = this._tmpTarget.copy(this.pos).sub(player.pos);
      const dist3D = toZ.length();
      if (dist3D > 1e-4) toZ.multiplyScalar(1 / dist3D);
      const dot = eyeDir.dot(toZ);
      const inCone = dot >= Math.cos((CONFIG.glory.angle * Math.PI) / 180);

      let hasWall = false;
      const rayStart = player.camera.position;
      for (const b of playerBoxes) {
        const h = rayAABB(rayStart, toZ, b.min, b.max, 0.1);
        if (h && h.t < dist3D - 0.5) {
          hasWall = true;
          break;
        }
      }

      const canGlory = dist3D <= CONFIG.glory.range && inCone && !hasWall && !player.isDead && player.dashTimer <= 0;
      this.promptSprite.visible = canGlory;
      if (canGlory) {
        const pScale = 1.6 + Math.sin(Date.now() * 0.008) * 0.2;
        this.promptSprite.scale.set(pScale, pScale * 0.25, 1);
      }

      this.stunTimer -= dt;
      if (this.stunTimer <= 0) {
        this.state = "chase";
        this.hp = this.maxHp * CONFIG.glory.stunThreshold;
        this.stunStars.visible = false;
        this.promptSprite.visible = false;
        const isPsx = (CONFIG.graphics && CONFIG.graphics.styleName) !== "cartoon";
        const baseCol = isPsx ? 0x141414 : 0;
        if (this.isGlbModel) {
          if (this.currentMaterial) this.currentMaterial.emissive.setHex(baseCol);
          if (this.modelGroup) this.modelGroup.rotation.z = 0;
          this.playAction("chase");
        } else {
          this.coatMat.emissive.setHex(baseCol);
          this.skinMat.emissive.setHex(baseCol);
          this.torso.rotation.x = 0;
        }
      }

      this.vel.y -= CONFIG.movement.gravity * dt;
      this.move(dt, world);
      this.group.position.copy(this.pos);
      this.updateHitboxes();
      return;
    } else {
      this.stunStars.visible = false;
      this.promptSprite.visible = false;
      if (this.isGlbModel && this.modelGroup && this.modelGroup.rotation.z !== 0) {
        this.modelGroup.rotation.z = 0;
      }
    }

    // 1. Состояние UNREACHABLE (игрок на блоке — зомби держат дистанцию 2–3.5 м и образуют кольцо)
    if (this.state === "unreachable") {
      if (!isPlayerUnreachable) {
        this.state = "chase";
        if (this.isGlbModel) {
          this.playAction("chase");
        } else {
          this.headGroup.rotation.x = 0;
          this.armL.rotation.x = 0;
          this.armR.rotation.x = 0;
          this.torso.rotation.x = 0;
        }
        this.unreachableAngle = undefined;
        return;
      }

      if (this.isGlbModel) {
        this.playAction("unreachable");
      }

      this.unreachableCheckTimer -= dt;
      if (this.unreachableCheckTimer <= 0) {
        this.unreachableCheckTimer = uCfg.checkInterval;
      }

      const block = blockUnderPlayer;
      if (!block) {
        this.state = "chase";
        this.unreachableAngle = undefined;
        return;
      }
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

      if (Math.abs(targetX - bx) > halfW && Math.abs(targetZ - bz) > halfD) {
        const cornerX = bx + Math.sign(cosA) * halfW;
        const cornerZ = bz + Math.sign(sinA) * halfD;
        const cornerAngle = Math.atan2(targetX - cornerX, targetZ - cornerZ);
        targetX = cornerX + Math.sin(cornerAngle) * this.unreachableRingDist;
        targetZ = cornerZ + Math.cos(cornerAngle) * this.unreachableRingDist;
      }

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
        if (!this.isGlbModel) {
          this.headGroup.rotation.x = -Math.min(1.2, Math.atan2(heightDiff, Math.max(0.5, horizDist)));
          this.armL.rotation.x = 0.8;
          this.armR.rotation.x = 0.8;
          this.torso.rotation.x = -0.1;
        }
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
            if (this.isGlbModel) {
              this.playAction("idle");
            } else {
              this.armL.rotation.x = 1.0;
              this.armR.rotation.x = 1.0;
              this.torso.rotation.x = -0.15;
            }
          } else {
            const dirToTarget = this._tmpDir.set(toTargetX / distToTarget, 0, toTargetZ / distToTarget);
            const moveDir = this.steer(dirToTarget, world);
            const moveSpeed = this.speed * uCfg.speedFactor;
            this.vel.x = moveDir.x * moveSpeed;
            this.vel.z = moveDir.z * moveSpeed;

            this.group.rotation.y = Math.atan2(moveDir.x, moveDir.z);

            if (!this.isGlbModel) {
              this.wobbleT += dt * 3;
              this.legL.rotation.x = Math.sin(this.wobbleT) * 0.3;
              this.legR.rotation.x = -Math.sin(this.wobbleT) * 0.3;
              this.armL.rotation.x = 0.1 + Math.sin(this.wobbleT) * 0.1;
              this.armR.rotation.x = 0.1 - Math.sin(this.wobbleT) * 0.1;
              this.torso.rotation.x = 0;
              this.torso.rotation.z = Math.sin(this.wobbleT) * 0.04;
              this.headGroup.rotation.x = -Math.min(1.1, Math.atan2(heightDiff, Math.max(0.5, horizDist)));
            }
          }
        } else if (this.unreachableSubState === "stop") {
          this.vel.x = 0;
          this.vel.z = 0;
          this.group.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);

          if (!this.isGlbModel) {
            this.headGroup.rotation.x = -Math.min(1.2, Math.atan2(heightDiff, Math.max(0.5, horizDist)));
            this.wobbleT += dt * 4;
            this.armL.rotation.x = 1.0 + Math.sin(this.wobbleT * 4) * 0.2;
            this.armR.rotation.x = 1.0 - Math.sin(this.wobbleT * 4) * 0.2;
            this.torso.rotation.x = -0.15;
            this.torso.rotation.z = Math.sin(this.wobbleT * 2) * 0.05;
          }

          if (this.unreachableSubTimer <= 0) {
            const shift = (Math.random() < 0.5 ? 1 : -1) * (0.6 + Math.random() * 0.9);
            this.unreachableAngle += shift;
            this.unreachableRingDist = uCfg.ringMinDist + Math.random() * (uCfg.ringMaxDist - uCfg.ringMinDist);
            this.unreachableSubState = "move";
            this.unreachableSubTimer = uCfg.moveDurationMin + Math.random() * (uCfg.moveDurationMax - uCfg.moveDurationMin);
            if (this.isGlbModel) {
              this.playAction("unreachable");
            }
          }
        }
      }

      // Расталкивание между зомби
      for (let i = 0; i < zombies.length; i++) {
        const other = zombies[i];
        if (other === this || !other.alive) continue;
        const dx = this.pos.x - other.pos.x;
        const dz = this.pos.z - other.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < C.separationDist && d > 1e-4) {
          const pushForce = (C.separationDist - d) * C.separationPushForce * dt;
          this.pos.x += (dx / d) * pushForce;
          this.pos.z += (dz / d) * pushForce;
        }
      }

      this.vel.y -= CONFIG.movement.gravity * dt;
      this.move(dt, world);
      this.group.position.copy(this.pos);
      this.updateHitboxes();
      return;
    } else {
      if (!this.isGlbModel && this.headGroup) {
        this.headGroup.rotation.x = 0;
      }
    }

    // 2. Состояние IDLE
    if (this.state === "idle") {
      if (this.isGlbModel) {
        this.playAction("idle");
      } else {
        this.wobbleT += dt * 2;
        this.torso.rotation.z = Math.sin(this.wobbleT) * 0.05;
      }

      if (horizDist < C.aggroRange) {
        let hasLOS = true;
        const origin = this._tmpOrigin.set(this.pos.x, this.pos.y + 1.2, this.pos.z);
        const enemyBoxes = world.getNearbyBoxes ? world.getNearbyBoxes(this.pos) : world.boxes;
        for (const b of enemyBoxes) {
          const h = rayAABB(origin, dirToPlayer, b.min, b.max, 0.1);
          if (h && h.t < horizDist) {
            hasLOS = false;
            break;
          }
        }
        if (hasLOS) {
          if (isPlayerUnreachable) {
            this.state = "unreachable";
            this.unreachableAngle = undefined;
            if (this.isGlbModel) this.playAction("unreachable");
          } else {
            this.state = "chase";
            if (this.isGlbModel) this.playAction("chase");
          }
        }
      }
    }

    // 3. Состояние CHASE
    else if (this.state === "chase") {
      if (isPlayerUnreachable) {
        this.state = "unreachable";
        this.unreachableAngle = undefined;
        if (this.isGlbModel) this.playAction("unreachable");
        return;
      }

      if (this.isGlbModel) {
        this.playAction("chase");
      }

      const yaw = Math.atan2(dirToPlayer.x, dirToPlayer.z);
      this.group.rotation.y = yaw;

      if (!this.isGlbModel) {
        this.wobbleT += dt * 8;
        this.torso.rotation.z = Math.sin(this.wobbleT) * 0.08;
        this.legL.rotation.x = Math.sin(this.wobbleT) * 0.45;
        this.legR.rotation.x = -Math.sin(this.wobbleT) * 0.45;
        this.armL.rotation.x = 0.1 + Math.sin(this.wobbleT) * 0.15;
        this.armR.rotation.x = 0.1 - Math.sin(this.wobbleT) * 0.15;
      }

      let moveDir = this.steer(dirToPlayer, world);

      this.checkStuckT += dt;
      if (this.checkStuckT >= C.stuckCheckInterval) {
        const moved = this.pos.distanceTo(this.lastCheckPos);
        if (moved < C.stuckMinMoveDist) {
          this.sidestepT = C.sidestepDuration;
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

      // Проверка начала атаки (с ограничением высоты)
      if (horizDist <= C.attackRange && meleeHeightDiff <= CONFIG.enemies.meleeMaxHeightDiff && this.attackCd <= 0) {
        this.state = "attack";
        this.attackT = 0;
        if (this.isGlbModel) {
          const isBite = Math.random() < 0.5;
          this.playAction(isBite ? "attackBite" : "attackSwipe", 0.08);
        }
      }
    }

    // 4. Состояние ATTACK
    else if (this.state === "attack") {
      this.vel.x *= 0.5;
      this.vel.z *= 0.5;
      this.attackT += dt;

      if (!this.isGlbModel) {
        const windupProg = Math.min(1, this.attackT / C.attackWindup);
        this.armL.rotation.x = 0.2 + windupProg * 0.9;
        this.armR.rotation.x = 0.2 + windupProg * 0.9;
      }

      // Момент удара строго определяется логикой игры (attackWindup = 0.35 с)
      if (this.attackT >= C.attackWindup) {
        if (horizDist <= C.attackRange + 0.4 && meleeHeightDiff <= CONFIG.enemies.meleeMaxHeightDiff) {
          player.takeDamage(C.damage, this.pos, game);
        }
        this.attackCd = C.attackCooldown;
        this.state = isPlayerUnreachable ? "unreachable" : "chase";
        if (isPlayerUnreachable) this.unreachableAngle = undefined;
        if (this.isGlbModel) this.playAction(this.state);
      }
    }

    // 5. Состояние STAGGER
    else if (this.state === "stagger") {
      this.staggerT -= dt;
      if (this.isGlbModel) {
        this.playAction("stagger", 0.08);
      } else {
        this.armL.rotation.x = 0.8;
        this.armR.rotation.x = 0.8;
        this.torso.rotation.x = -0.3;
      }
      if (this.staggerT <= 0) {
        if (!this.isGlbModel) this.torso.rotation.x = 0;
        if (isPlayerUnreachable) {
          this.state = "unreachable";
          this.unreachableSubState = "move";
          this.unreachableSubTimer = uCfg.moveDurationMin;
          if (this.isGlbModel) this.playAction("unreachable");
        } else {
          this.state = "chase";
          if (this.isGlbModel) this.playAction("chase");
        }
      }
    }

    if (this.attackCd > 0) this.attackCd -= dt;

    // Расталкивание между зомби
    for (let i = 0; i < zombies.length; i++) {
      const other = zombies[i];
      if (other === this || !other.alive) continue;
      const dx = this.pos.x - other.pos.x;
      const dz = this.pos.z - other.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < C.separationDist && d > 1e-4) {
        const pushForce = (C.separationDist - d) * C.separationPushForce * dt;
        this.pos.x += (dx / d) * pushForce;
        this.pos.z += (dz / d) * pushForce;
      }
    }

    this.vel.y -= CONFIG.movement.gravity * dt;
    this.move(dt, world);
    this.group.position.copy(this.pos);
    this.updateHitboxes();
  }
}
