// Враг Робот: летающий дрон-шар с лазерными залпами, стрейфом и защитой от кемперства на блоках
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { outlined, rayAABB, checkLineOfSight, rnd, resolveBoxCollision } from "../core/Physics.js";
import { Enemy } from "./Enemy.js";
import { createToonMaterial } from "../world/Materials.js";
import ModelCache from "../core/ModelCache.js";

export class Robot extends Enemy {
  /**
   * @param {THREE.Scene} scene
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  constructor(scene, x, y, z) {
    const C = CONFIG.enemies.robot;
    const speed = C.speed * (1 + rnd(C.speedVar));
    // Стартовая высота полёта над полом
    const startY = Math.max(y, C.flightHeightMin + 0.5);
    super(scene, x, startY, z, C.health, speed);

    this.isRobot = true;

    // Состояние 3D-модели призрака
    this.isGhost = false;
    this.ghostData = null;
    this.mixer = null;
    this.actions = null;
    this.currentAction = null;
    this.currentActionName = "";
    this.materials = [];

    // Параметры полёта и перемещения
    this.targetY = startY;
    this.strafeSign = Math.random() < 0.5 ? 1 : -1;
    this.strafeTimer = C.strafeIntervalMin + Math.random() * (C.strafeIntervalMax - C.strafeIntervalMin);
    this.wobbleT = Math.random() * 10;
    this.thrusterParticleTimer = 0;

    // Атака лазером
    this.attackCd = 1.0 + Math.random() * 1.5;
    this.chargeTimer = 0;
    this.burstRemaining = 0;
    this.burstTimer = 0;

    // Состояния и гибель
    this.staggerTimer = 0;
    this.dying = false;
    this.deathTimer = 0;
    this.spinAxis = new THREE.Vector3(rnd(1), 1, rnd(1)).normalize();

    // Переиспользуемые векторы (обновление дрона идёт каждый кадр)
    this._upAxis = new THREE.Vector3(0, 1, 0);
    this._forward = new THREE.Vector3();

    this.buildModel();
    this.updateHitboxes();
  }

  buildModel() {
    // 1. Попытка загрузки 3D-модели призрака из кэша
    if (ModelCache.has("ghost")) {
      const ghost = ModelCache.createGhostInstance();
      if (ghost) {
        this.isGhost = true;
        this.ghostData = ghost;
        this.modelGroup = ghost.modelGroup;
        this.mixer = ghost.mixer;
        this.actions = ghost.actions;
        this.materials = ghost.clonedMaterials || [];

        const modelCfg = CONFIG.enemies.robot.model || {};
        const targetHeight = modelCfg.height || 1.6;

        // Измеряем Box3 клона и масштабируем к targetHeight (1.6 м)
        const box = new THREE.Box3().setFromObject(this.modelGroup);
        const size = new THREE.Vector3();
        box.getSize(size);
        const rawHeight = size.y > 0 ? size.y : 1.0;
        const scale = targetHeight / rawHeight;
        this.modelGroup.scale.setScalar(scale);

        // Центрируем модель: pos.y хранит центр хитбокса
        box.setFromObject(this.modelGroup);
        const center = new THREE.Vector3();
        box.getCenter(center);

        this.ghostContainer = new THREE.Group();
        this.ghostContainer.add(this.modelGroup);

        this.modelGroup.position.set(
          -center.x,
          -center.y + (modelCfg.offsetY || 0),
          -center.z
        );
        this.ghostContainer.rotation.y = modelCfg.rotationY || 0;

        this.hoverGroup = new THREE.Group();
        this.hoverGroup.add(this.ghostContainer);
        this.group.add(this.hoverGroup);
        this.scene.add(this.group);

        this.playAction("idle ghost", { timeScale: 1.0 });
        return;
      }
    }

    // 2. Запасной вариант: старый процедурный дрон
    this.isGhost = false;
    this.buildProceduralModel();
  }

  buildProceduralModel() {
    const box = (w, h, d, mat) => outlined(new THREE.BoxGeometry(w, h, d), mat);
    const sph = (r, mat) => outlined(new THREE.SphereGeometry(r, 12, 10), mat);
    const cyl = (rt, rb, h, mat) => outlined(new THREE.CylinderGeometry(rt, rb, h, 12), mat);

    // Материалы
    const isPsx = (CONFIG.graphics && CONFIG.graphics.styleName) !== "cartoon";
    const baseOpts = isPsx ? { emissive: 0x141414, emissiveIntensity: 1.0 } : {};
    this.chassisMat = createToonMaterial(0xd90429, baseOpts); // Красный корпус
    this.stripeMat = createToonMaterial(0xffb703, baseOpts);  // Жёлтая полоса
    this.metalMat = createToonMaterial(0x4a4e69, baseOpts);   // Тёмный металл
    this.lensMat = createToonMaterial(0x00f0ff, {
      emissive: 0x007799
    }); // Светящийся глаз-линза

    // Внутренняя группа для покачивания (bobbing/sway)
    this.hoverGroup = new THREE.Group();
    this.group.add(this.hoverGroup);

    // 1. Корпус — круглый шар
    this.sphereMesh = sph(0.48, this.chassisMat);
    this.hoverGroup.add(this.sphereMesh);

    // 2. Жёлтая полоса вокруг экватора
    const stripe = cyl(0.50, 0.50, 0.12, this.stripeMat);
    this.hoverGroup.add(stripe);

    // 3. Глаз-линза (один большой спереди)
    this.eyeGroup = new THREE.Group();
    this.eyeGroup.position.set(0, 0, 0.40);

    const rim = cyl(0.23, 0.23, 0.08, this.metalMat);
    rim.rotation.x = Math.PI / 2;
    this.eyeGroup.add(rim);

    this.lensMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 12, 8),
      this.lensMat
    );
    this.lensMesh.position.set(0, 0, 0.04);
    this.eyeGroup.add(this.lensMesh);
    this.hoverGroup.add(this.eyeGroup);

    // 4. Две антенны на макушке
    const antGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.35, 6);
    const antMat = createToonMaterial(0x222222);

    const antL = outlined(antGeo, antMat);
    antL.position.set(-0.2, 0.55, -0.05);
    antL.rotation.z = -0.35;
    antL.rotation.x = -0.15;
    const tipL = sph(0.045, this.stripeMat);
    tipL.position.set(0, 0.18, 0);
    antL.add(tipL);

    const antR = outlined(antGeo, antMat);
    antR.position.set(0.2, 0.55, -0.05);
    antR.rotation.z = 0.35;
    antR.rotation.x = -0.15;
    const tipR = sph(0.045, this.stripeMat);
    tipR.position.set(0, 0.18, 0);
    antR.add(tipR);

    this.hoverGroup.add(antL, antR);

    // 5. Двигатели-сопла снизу
    const thrusterGeo = new THREE.ConeGeometry(0.09, 0.18, 8);
    const thrusterMat = createToonMaterial(0x333333);

    this.thrustL = outlined(thrusterGeo, thrusterMat);
    this.thrustL.position.set(-0.18, -0.48, 0);
    this.thrustL.rotation.x = Math.PI;

    this.thrustR = outlined(thrusterGeo, thrusterMat);
    this.thrustR.position.set(0.18, -0.48, 0);
    this.thrustR.rotation.x = Math.PI;

    this.hoverGroup.add(this.thrustL, this.thrustR);

    this.scene.add(this.group);
  }

  playAction(name, options = {}) {
    if (!this.actions || this.currentActionName === name) return;
    const nextAction = this.actions[name];
    if (!nextAction) return;

    const prevAction = this.currentAction;
    this.currentAction = nextAction;
    this.currentActionName = name;

    const duration = options.crossFadeDuration ?? 0.12;
    const timeScale = options.timeScale ?? 1.0;
    const loop = options.loop ?? THREE.LoopRepeat;
    const clamp = options.clampWhenFinished ?? false;

    nextAction.reset();
    nextAction.setEffectiveTimeScale(timeScale);
    nextAction.setEffectiveWeight(1.0);
    nextAction.setLoop(loop, loop === THREE.LoopOnce ? 1 : Infinity);
    nextAction.clampWhenFinished = clamp;

    if (prevAction && prevAction !== nextAction) {
      prevAction.crossFadeTo(nextAction, duration, true);
    }
    nextAction.play();
  }

  setFlash(on) {
    const isPsx = (CONFIG.graphics && CONFIG.graphics.styleName) !== "cartoon";
    const flashCol = isPsx ? ((CONFIG.graphics.style && CONFIG.graphics.style.psx && CONFIG.graphics.style.psx.hitFlashColor) || 0xfff4c0) : 0xffffff;
    const baseCol = isPsx ? 0x141414 : 0;
    const hex = on ? flashCol : baseCol;
    if (this.isGhost && this.materials) {
      for (const m of this.materials) {
        if (m.emissive) {
          m.emissive.setHex(hex);
          m.emissiveIntensity = on ? 0.8 : (isPsx ? 0.08 : 0);
        }
      }
    } else {
      if (this.chassisMat) this.chassisMat.emissive.setHex(hex);
      if (this.stripeMat) this.stripeMat.emissive.setHex(hex);
    }
  }

  updateHitboxes() {
    const C = CONFIG.enemies.robot;
    const x = this.pos.x;
    const y = this.pos.y;
    const z = this.pos.z;

    // Корпус
    this.bodyMin.set(x - C.hitboxRadius, y - C.hitboxHeight * 0.5, z - C.hitboxRadius);
    this.bodyMax.set(x + C.hitboxRadius, y + C.hitboxHeight * 0.5, z + C.hitboxRadius);

    // Голова / глаз-линза (слабая зона / крит)
    const forward = this._forward.set(0, 0, 1).applyAxisAngle(this._upAxis, this.group.rotation.y);
    const eyeX = x + forward.x * 0.28;
    const eyeY = y + 0.3;
    const eyeZ = z + forward.z * 0.28;
    this.headMin.set(eyeX - C.hitboxEyeRadius, eyeY - C.hitboxEyeRadius, eyeZ - C.hitboxEyeRadius);
    this.headMax.set(eyeX + C.hitboxEyeRadius, eyeY + C.hitboxEyeRadius, eyeZ + C.hitboxEyeRadius);
  }

  alert(player = null) {
    if (!this.alive || this.dying) return;
    if (this.state === "idle" || this.state === "patrol") {
      this.state = "strafe";
    }
  }

  /**
   * Получение урона: масло вместо крови для дрона или экто-искры для призрака
   */
  takeDamage(dmg, isHeadshot, pushVec, fx, game) {
    if (!this.alive || this.dying) return;
    const C = CONFIG.enemies.robot;
    const finalDmg = isHeadshot ? dmg * 2 : dmg;
    this.hp -= finalDmg;
    this.flashT = 0.08;
    this.setFlash(true);

    if (fx) {
      fx.popup(this.pos.x, this.pos.y + 0.8, this.pos.z, Math.round(finalDmg), isHeadshot);
      const hitNormal = pushVec ? pushVec.clone().normalize().negate() : new THREE.Vector3(0, 1, 0);

      if (this.isGhost) {
        // Бирюзово-фиолетовые искры для призрака
        if (fx.particles) {
          const sparkColor = C.projectileCoreColor || 0x2ee6d6;
          fx.particles.sparks(this.pos, hitNormal, sparkColor, 6);
        }
      } else {
        // Масло (чёрные капли) вместо крови для дрона
        fx.bloodSpray(this.pos, hitNormal, finalDmg, C.oilColor);
        // Искры
        if (fx.particles) {
          fx.particles.sparks(this.pos, hitNormal, 0xffd23f, 8);
        }
      }
    }

    // Проверка на гибель
    if (this.hp <= 0) {
      this.startDeathSequence(fx, game);
      return;
    }

    // Робот/призрак НЕ оглушается и НЕ добивается по E!
    // Стаггер: короткая тряска / hit reaction, отлёт назад на 1 м
    if (this.state !== "charge" && this.state !== "shoot") {
      this.state = "stagger";
      this.staggerTimer = C.staggerTime;
      if (this.isGhost) {
        this.playAction("hit reaction ghost.001", { timeScale: 1.5, loop: THREE.LoopOnce, clampWhenFinished: true });
      }
      if (pushVec) {
        const pushDir = pushVec.clone();
        pushDir.y = 0;
        if (pushDir.length() > 1e-4) pushDir.normalize();
        else pushDir.set(0, 0, -1);
        this.pos.addScaledVector(pushDir, C.staggerPushDist);
      }
    }
  }

  /**
   * Начало фазы гибели: растворение для призрака или падение с дымом для дрона
   */
  startDeathSequence(fx, game) {
    if (this.dying) return;
    this.dying = true;
    this.alive = false;
    this.state = "dead";

    if (this.isGhost) {
      this.deathTimer = 0.6;
      this.playAction("death ghost.002", { loop: THREE.LoopOnce, clampWhenFinished: true, timeScale: 1.0 });

      // 14-20 частиц эктоплазмы (бирюзово-фиолетовые светящиеся шарики, всплывают вверх и гаснут за 0.8 с)
      if (fx && fx.particles) {
        const ectoColors = [0x2ee6d6, 0x00f5d4, 0x9d4edd, 0x7b2cbf, 0xc77dff];
        const count = 14 + Math.floor(Math.random() * 7); // 14-20 частиц
        for (let i = 0; i < count; i++) {
          const color = ectoColors[i % ectoColors.length];
          fx.particles.spawn(
            this.pos.x + rnd(0.35),
            this.pos.y + rnd(0.4),
            this.pos.z + rnd(0.35),
            rnd(0.8),
            1.8 + Math.random() * 1.6,
            rnd(0.8),
            color,
            0.15 + Math.random() * 0.08,
            0.8,
            -1.2,
            0.5
          );
        }
      }
      return;
    }

    // Запасной вариант для дрона
    this.deathTimer = CONFIG.enemies.robot.deathSpinTime;
    if (this.lensMat) {
      this.lensMat.emissive.setHex(0);
      this.lensMat.color.setHex(0x111111);
    }
  }

  /**
   * Завершение растворения призрака
   */
  dissolveAndFinish(game) {
    const C = CONFIG.enemies.robot;
    // Очки за убийство
    game.onZombieKill(C.scoreValue, false, false, this);

    // Выпадение предметов как раньше
    if (Math.random() < C.dropChance && game.pickupManager) {
      const dropType = Math.random() < 0.5
        ? "armor"
        : ["ammo_shotgun", "ammo_ak47", "ammo_rocket"][Math.floor(Math.random() * 3)];
      game.pickupManager.spawnCustomDrop(this.pos, dropType);
    }

    this.destroy();
  }

  /**
   * Окончательный взрыв робота с кусками корпуса, дымом, маслом и шансом выпадения предметов (запасной вариант)
   */
  explodeAndGib(fx, game) {
    const C = CONFIG.enemies.robot;

    if (fx) {
      // 1. Взрыв
      if (fx.explosion) {
        fx.explosion(this.pos);
      }
      if (game.audio) game.audio.play("explosion");

      // 2. Черное масло и искры на полу
      if (fx.decals) {
        fx.decals.add(this.pos, new THREE.Vector3(0, 1, 0), C.oilColor, 1.8);
      }

      // 3. Разлёт металлических кусков (обломки дрона и болты)
      if (fx.gore && fx.gore.gibs) {
        const clrs = [0xd90429, 0xffb703, 0x4a4e69, 0x222222, 0xd0d0d0];
        for (let i = 0; i < 12; i++) {
          const g = fx.gore.gibs[fx.gore.gi];
          fx.gore.gi = (fx.gore.gi + 1) % fx.gore.gibs.length;
          g.m.material.color.setHex(clrs[i % clrs.length]);
          g.s = 0.12 + Math.random() * 0.16;
          g.m.scale.setScalar(g.s);
          g.m.position.set(this.pos.x + rnd(0.3), this.pos.y + rnd(0.3), this.pos.z + rnd(0.3));
          g.v.set(rnd(7), 4 + Math.random() * 5, rnd(7));
          g.w.set(rnd(15), rnd(15), rnd(15));
          g.life = CONFIG.effects.gibs.life;
          g.m.visible = true;
        }
      }
    }

    // 4. Очки за убийство
    game.onZombieKill(C.scoreValue, false, false, this);

    // 5. Шанс 30% оставить броню или патроны
    if (Math.random() < C.dropChance && game.pickupManager) {
      const dropType = Math.random() < 0.5
        ? "armor"
        : ["ammo_shotgun", "ammo_ak47", "ammo_rocket"][Math.floor(Math.random() * 3)];
      game.pickupManager.spawnCustomDrop(this.pos, dropType);
    }

    this.destroy();
  }

  update(dt, player, world, allEnemies, game, fx) {
    const C = CONFIG.enemies.robot;

    // --- Обработка фазы гибели ---
    if (this.dying) {
      if (this.isGhost) {
        this.deathTimer -= dt;
        if (this.mixer) this.mixer.update(dt);

        // Материал плавно становится прозрачным за 0.6 с
        const alpha = Math.max(0, this.deathTimer / 0.6);
        if (this.materials) {
          for (const m of this.materials) {
            m.transparent = true;
            m.opacity = alpha;
          }
        }
        this.group.position.copy(this.pos);

        if (this.deathTimer <= 0) {
          this.dissolveAndFinish(game);
        }
        return;
      }

      // Запасной вариант: падение и вращение старого дрона
      this.deathTimer -= dt;

      // Быстрое хаотичное вращение
      this.hoverGroup.rotation.x += 14 * dt;
      this.hoverGroup.rotation.y += 18 * dt;
      this.hoverGroup.rotation.z += 9 * dt;

      // Спуск вниз к полу
      this.pos.y -= 4.0 * dt;

      // Дым и искры из повреждённого дрона
      if (fx && fx.particles && Math.random() < 0.6) {
        fx.particles.spawn(
          this.pos.x + rnd(0.2),
          this.pos.y + rnd(0.2),
          this.pos.z + rnd(0.2),
          rnd(1), 1.5 + Math.random() * 1.5, rnd(1),
          0x222222, 0.25, 0.6, -1, 0.5
        );
        if (Math.random() < 0.3) {
          fx.particles.sparks(this.pos, new THREE.Vector3(rnd(1), 1, rnd(1)).normalize(), 0xffd23f, 3);
        }
      }

      this.group.position.copy(this.pos);

      if (this.deathTimer <= 0 || this.pos.y <= 0.4) {
        this.explodeAndGib(fx, game);
      }
      return;
    }

    if (!this.alive) return;

    // Обновление анимаций призрака
    if (this.isGhost && this.mixer) {
      this.mixer.update(dt);
    }

    if (this.flashT > 0 && (this.flashT -= dt) <= 0) this.setFlash(false);

    this.wobbleT += dt;

    // Векторы до игрока
    const toPlayer = this._toPlayer.set(player.pos.x - this.pos.x, 0, player.pos.z - this.pos.z);
    const horizDist = toPlayer.length();
    const dirToPlayer = this._dirToPlayer;
    if (horizDist > 1e-4) {
      dirToPlayer.copy(toPlayer).multiplyScalar(1 / horizDist);
    } else {
      dirToPlayer.set(0, 0, 1);
    }

    // Линия видимости к груди игрока
    const eyePos = this._tmpOrigin.set(this.pos.x, this.pos.y, this.pos.z);
    const playerChest = this._tmpTarget.set(player.pos.x, player.pos.y + 0.9, player.pos.z);
    const robotBoxes = world.getNearbyBoxes ? world.getNearbyBoxes(this.pos) : world.boxes;
    const hasLOS = checkLineOfSight(eyePos, playerChest, robotBoxes);

    if (this.attackCd > 0) this.attackCd -= dt;

    // --- Управление высотой полёта и защита от кемперства ---
    // Если игрок стоит высоко (на блоке/препятствии), дрон/призрак поднимается на высоту игрока + 1 м
    let desiredY;
    if (player.pos.y > 0.8) {
      desiredY = player.pos.y + C.elevatedPlayerOffset;
    } else {
      // Обычная высота полёта 1.5–3.5 м
      const bobY = Math.sin(this.wobbleT * 1.2) * 0.8;
      desiredY = ((C.flightHeightMin + C.flightHeightMax) / 2) + bobY;
    }

    // Плавное приближение к целевой высоте
    this.targetY = desiredY;
    this.pos.y += (this.targetY - this.pos.y) * Math.min(1, 3.5 * dt);

    // Легкое покачивание в воздухе
    this.hoverGroup.position.y = Math.sin(this.wobbleT * 3.5) * 0.08;

    // Частицы выхлопа двигателей снизу (только для процедурного дрона)
    if (!this.isGhost) {
      this.thrusterParticleTimer += dt;
      if (this.thrusterParticleTimer >= 0.08 && fx && fx.particles) {
        this.thrusterParticleTimer = 0;
        const thrusterP = this._tmpOrigin.set(this.pos.x, this.pos.y - 0.45, this.pos.z);
        fx.particles.spawn(
          thrusterP.x + rnd(0.08), thrusterP.y, thrusterP.z + rnd(0.08),
          rnd(0.3), -2.5, rnd(0.3),
          Math.random() < 0.5 ? 0xffb703 : 0xff4f8b, 0.08, 0.25, 0, 0.5
        );
      }
    }

    // === 1. Состояние STAGGER (короткая реакция на удар) ===
    if (this.state === "stagger") {
      this.staggerTimer -= dt;
      if (this.isGhost) {
        this.playAction("hit reaction ghost.001", { timeScale: 1.5, loop: THREE.LoopOnce, clampWhenFinished: true });
      } else {
        this.hoverGroup.rotation.z = Math.sin(this.wobbleT * 25) * 0.25;
        this.hoverGroup.rotation.x = Math.cos(this.wobbleT * 25) * 0.25;
      }
      if (this.staggerTimer <= 0) {
        this.hoverGroup.rotation.set(0, 0, 0);
        this.state = "strafe";
      }
      this.group.position.copy(this.pos);
      this.updateHitboxes();
      return;
    }

    // === 2. Состояние CHARGE (зарядка выстрела: 0.8 с) ===
    if (this.state === "charge") {
      this.chargeTimer += dt;
      this.vel.set(0, 0, 0);

      // Смотрит точно на игрока
      this.group.rotation.y = Math.atan2(dirToPlayer.x, dirToPlayer.z);

      if (this.isGhost) {
        const chargeScale = 2.667 / C.chargeDuration;
        this.playAction("spell ghost 1", { timeScale: chargeScale, loop: THREE.LoopOnce, clampWhenFinished: true });
      } else if (this.lensMesh && this.lensMat) {
        const prog = Math.min(1, this.chargeTimer / C.chargeDuration);
        const eyeScale = 1.0 + prog * 0.75;
        this.lensMesh.scale.set(eyeScale, eyeScale, eyeScale);
        this.lensMat.color.setRGB(1, (1 - prog) * 0.6, (1 - prog) * 0.4);
        this.lensMat.emissive.setRGB(prog, 0, 0);
      }

      if (this.chargeTimer >= C.chargeDuration) {
        this.state = "shoot";
        this.burstRemaining = C.burstCount;
        this.burstTimer = 0;
      }

      this.group.position.copy(this.pos);
      this.updateHitboxes();
      return;
    }

    // === 3. Состояние SHOOT (залп из 3 снарядов) ===
    if (this.state === "shoot") {
      this.burstTimer -= dt;
      this.vel.set(0, 0, 0);
      this.group.rotation.y = Math.atan2(dirToPlayer.x, dirToPlayer.z);

      if (this.isGhost) {
        this.playAction("spell ghost 2", { timeScale: 3.0, loop: THREE.LoopOnce, clampWhenFinished: true });
      }

      if (this.burstTimer <= 0 && this.burstRemaining > 0) {
        this.burstRemaining--;
        this.burstTimer = C.burstInterval;

        // Выстрел снарядом
        const forward = this._forward.set(0, 0, 1).applyAxisAngle(this._upAxis, this.group.rotation.y);
        const spawnPos = this._tmpOrigin.copy(this.pos).addScaledVector(forward, 0.5);
        const fireDir = this._tmpDir.copy(playerChest).sub(spawnPos).normalize();

        if (game.enemyManager && game.enemyManager.projectiles) {
          game.enemyManager.projectiles.spawn(spawnPos, fireDir, C.projectileSpeed, C.damage);
        }

        // Вспышка выстрела
        if (fx && fx.particles) {
          const sparkClr = C.projectileCoreColor || 0x2ee6d6;
          fx.particles.sparks(spawnPos, fireDir, sparkClr, 5);
        }
      }

      if (this.burstRemaining <= 0 && this.burstTimer <= 0) {
        // Завершение очереди
        if (!this.isGhost && this.lensMesh && this.lensMat) {
          this.lensMesh.scale.set(1, 1, 1);
          this.lensMat.color.setHex(0x00f0ff);
          this.lensMat.emissive.setHex(0x007799);
        }
        this.attackCd = C.attackCooldown;
        this.state = "strafe";
      }

      this.group.position.copy(this.pos);
      this.updateHitboxes();
      return;
    }

    // === 4. Состояния IDLE / PATROL / STRAFE (перемещение и дистанция) ===
    if (this.state === "idle" || this.state === "patrol") {
      if (this.isGhost) {
        this.playAction("idle ghost", { timeScale: 1.0 });
      }
      if (horizDist < C.aggroRange && hasLOS) {
        this.state = "strafe";
      }
    }

    if (this.state === "strafe") {
      // Смена анимации в зависимости от манёвра (отлёт назад/быстрая смена позиции vs стрейф вокруг)
      if (this.isGhost) {
        if (horizDist < C.tooCloseDist || horizDist > C.tooFarDist) {
          this.playAction("movement fast ghost.001", { timeScale: 1.0 });
        } else {
          this.playAction("movement ghost", { timeScale: 1.0 });
        }
      }

      // Смена направления стрейфа каждые 1.5–3 сек
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) {
        this.strafeSign *= -1;
        this.strafeTimer = C.strafeIntervalMin + Math.random() * (C.strafeIntervalMax - C.strafeIntervalMin);
      }

      // Определение вектора перемещения для удержания дистанции 12–20 м
      const moveVec = this._tmpTarget;

      if (horizDist < C.tooCloseDist) {
        // Слишком близко (< 10 м) — отлетает назад
        moveVec.subVectors(this.pos, player.pos);
        moveVec.y = 0;
        moveVec.normalize();
      } else if (horizDist > C.tooFarDist) {
        // Слишком далеко (> 22 м) — приближается
        moveVec.copy(dirToPlayer);
      } else {
        // В зоне 10–22 м: движение боком (стрейф по кругу вокруг игрока)
        moveVec.set(-dirToPlayer.z * this.strafeSign, 0, dirToPlayer.x * this.strafeSign);

        // Легкая корректировка к середине предпочтительного диапазона (16 м)
        const midDist = (C.preferredDistMin + C.preferredDistMax) / 2;
        const radialAdjustment = (horizDist - midDist) * 0.15;
        moveVec.addScaledVector(dirToPlayer, radialAdjustment);
        moveVec.normalize();
      }

      // Облёт препятствий
      const finalDir = this.steer(moveVec, world);
      this.vel.x = finalDir.x * this.speed;
      this.vel.z = finalDir.z * this.speed;

      // Поворот лицом к игроку
      this.group.rotation.y = Math.atan2(dirToPlayer.x, dirToPlayer.z);

      // Наклон корпуса в сторону движения (крен/тангаж)
      const localVel = this._tmpDir.set(this.vel.x, 0, this.vel.z).applyAxisAngle(this._upAxis, -this.group.rotation.y);
      this.hoverGroup.rotation.z = -localVel.x * 0.05;
      this.hoverGroup.rotation.x = localVel.z * 0.05;

      // Перемещение с разрешением коллизий с коробками стен
      this.pos.x += this.vel.x * dt;
      resolveBoxCollision(this.pos, this.vel, C.hitboxRadius, C.hitboxHeight, robotBoxes, "x", C.collisionEps);
      this.pos.z += this.vel.z * dt;
      resolveBoxCollision(this.pos, this.vel, C.hitboxRadius, C.hitboxHeight, robotBoxes, "z", C.collisionEps);

      // Расталкивание между врагами
      for (let i = 0; i < allEnemies.length; i++) {
        const other = allEnemies[i];
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

      // Проверка возможности атаки
      if (hasLOS && this.attackCd <= 0 && horizDist <= C.aggroRange && !player.isDead) {
        this.state = "charge";
        this.chargeTimer = 0;
        this.vel.set(0, 0, 0);
      }
    }

    // Дрон не должен вылетать за стены комнаты (расталкивание и рывок атаки
    // применяются после разрешения коллизий и могут вынести его наружу)
    this.clampToRoom(this.pos, C.hitboxRadius, this.getBoundRoom(world));

    this.group.position.copy(this.pos);
    this.updateHitboxes();
  }

  destroy() {
    this.dying = false;
    super.destroy();
  }
}
