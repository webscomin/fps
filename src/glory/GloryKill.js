// Механика добиваний (Glory Kill): выстрел в упор (Doom Eternal style),
// быстрый подлёт, прицеливание оружия, выстрел из текущего ствола, хит-стоп,
// расчленение/реакция врагов по типу оружия и замедление времени
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { rayAABB, rnd } from "../core/Physics.js";

/**
 * Получение параметров цвета крови, кусков и анатомии по типу врага
 * @param {Object} enemy
 * @returns {Object}
 */
function getEnemyInfo(enemy) {
  if (enemy.isMutant) {
    return {
      type: "mutant",
      fluid: (CONFIG.enemies.mutant && CONFIG.enemies.mutant.bloodColor) || 0x39ff14,
      gibs: [0x39ff14, 0x6b3fa0, 0x3d8b37, 0x2d1b4e, 0x7b4fbf],
      headColor: 0x6b3fa0,
      headSize: 0.42,
      headY: 2.5
    };
  }
  if (enemy.isReaper || (enemy.constructor && enemy.constructor.name === "StrawReaper")) {
    return {
      type: "reaper",
      fluid: (CONFIG.enemies.reaper && CONFIG.enemies.reaper.bloodColor) || 0xb8860b,
      gibs: (CONFIG.enemies.reaper && CONFIG.enemies.reaper.strawColors) || [0xcca033, 0xb8860b, 0xd4af37],
      headColor: 0xcca033,
      headSize: 0.34,
      headY: 1.8
    };
  }
  if (enemy.isRobot || (enemy.constructor && enemy.constructor.name === "Robot")) {
    return {
      type: "robot",
      fluid: 0xffaa00,
      gibs: [0x222222, 0x555555, 0x888888, 0xff8800],
      headColor: 0x555555,
      headSize: 0.32,
      headY: 1.6
    };
  }
  if (enemy.isGhost) {
    return {
      type: "ghost",
      fluid: 0x4deeea,
      gibs: [0x4deeea, 0x74ee15, 0x00f0ff, 0xffffff],
      headColor: 0x4deeea,
      headSize: 0.35,
      headY: 1.7
    };
  }
  // По умолчанию: Зомби
  return {
    type: "zombie",
    fluid: (CONFIG.effects.blood && CONFIG.effects.blood.zombieColor) || 0x8a1515,
    gibs: [0x9e9488, 0x6e5d4e, 0x5a4a3e, 0x857a6e, 0x473b32, 0xb0a597],
    headColor: 0xa89c8e,
    headSize: 0.36,
    headY: 1.7
  };
}

/**
 * Отсечение головы: скрытие кости головы у скелетной модели (scale 0,0,0)
 * либо скрытие procedural headGroup/headMesh
 * @param {Object} enemy
 */
function decapitateEnemy(enemy) {
  let boneFound = false;

  // 1. SkinnedMesh скелет
  if (enemy.skinnedMesh && enemy.skinnedMesh.skeleton) {
    const headBone = enemy.skinnedMesh.skeleton.bones.find(
      (b) => b.name && b.name.toLowerCase().includes("head")
    );
    if (headBone) {
      headBone.scale.set(0, 0, 0);
      boneFound = true;
    }
  }

  // 2. Traversal внутри группы модели
  if (!boneFound && enemy.modelGroup) {
    enemy.modelGroup.traverse((c) => {
      if (c.isBone && c.name && c.name.toLowerCase().includes("head")) {
        c.scale.set(0, 0, 0);
        boneFound = true;
      }
    });
  }

  // 3. Процедурные модели (мутант, запасной зомби)
  if (enemy.headGroup) {
    enemy.headGroup.visible = false;
  }
  if (enemy.head) {
    enemy.head.visible = false;
  }
  if (enemy.headMesh) {
    enemy.headMesh.visible = false;
  }
}

export class GloryKill {
  /**
   * @param {Object} game
   */
  constructor(game) {
    this.game = game;
    this.isActive = false;
    this.target = null;
    this.timer = 0;
    this.realTimer = 0;
    this.duration = CONFIG.glory.duration;
    this.type = "shot"; // "shot" или устаревшие "punch", "rip", "kick"
    this.executed = false;
    this.shotTriggered = false;
    this.hitstopTimer = 0;

    this.startPos = new THREE.Vector3();
    this.targetPos = new THREE.Vector3();

    this.startYaw = 0;
    this.startPitch = 0;
    this.targetYaw = 0;
    this.targetPitch = 0;
    this.diffYaw = 0;

    this.weaponId = "shotgun";
    this.ak47BurstIndex = 0;
    this.ak47BurstTimer = 0;

    // Активные тела расправы (фонтан крови, заваливание назад, очередь АК-47)
    this.activeCorpses = [];

    // Кольцо ударной волны для выстрела в упор из дробовика
    const sGeo = new THREE.RingGeometry(0.12, 0.32, 28);
    this.shockwaveMat = new THREE.MeshBasicMaterial({
      color: 0xffe270,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
      depthWrite: false
    });
    this.shockwaveMesh = new THREE.Mesh(sGeo, this.shockwaveMat);
    this.shockwaveMesh.visible = false;
    this.shockwaveTimer = 0;
    this.shockwaveDuration = 0.25;
    this.game.scene.add(this.shockwaveMesh);
  }

  /**
   * Попытка инициировать добивание
   * @param {Array} enemies
   */
  tryTrigger(enemies) {
    const P = this.game.player;
    const cam = this.game.camera;

    if (this.isActive || P.isDead || P.dashTimer > 0) return;

    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);

    let bestEnemy = null;
    let bestDist = CONFIG.glory.range;

    for (let i = 0; i < enemies.length; i++) {
      const z = enemies[i];
      if (!z.alive || z.state !== "stunned") continue;

      const toZ = z.pos.clone().sub(P.pos);
      const d = toZ.length();
      if (d > bestDist) continue;

      toZ.normalize();
      const dot = dir.dot(toZ);
      if (dot < Math.cos((CONFIG.glory.angle * Math.PI) / 180)) continue;

      // Проверка стен между камерой и врагом
      let blocked = false;
      const boxes = this.game.world && this.game.world.boxes ? this.game.world.boxes : [];
      for (const b of boxes) {
        const h = rayAABB(cam.position, toZ, b.min, b.max, 0.1);
        if (h && h.t < d - 0.5) {
          blocked = true;
          break;
        }
      }

      if (!blocked) {
        bestEnemy = z;
        bestDist = d;
      }
    }

    if (!bestEnemy) return;

    // Расчёт точки остановки перед врагом (CONFIG.glory.shot.stopDistance = 1.6 м)
    const stopDistance = (CONFIG.glory.shot && CONFIG.glory.shot.stopDistance) || CONFIG.glory.stopDistance || 1.6;
    const stopDir = P.pos.clone().sub(bestEnemy.pos);
    stopDir.y = 0;
    if (stopDir.length() > 0.001) stopDir.normalize();
    else stopDir.set(0, 0, 1);

    const dest = bestEnemy.pos.clone().addScaledVector(stopDir, stopDistance);
    dest.y = bestEnemy.pos.y;

    // Проверка коллизий точки назначения со стенами
    const r = CONFIG.player.radius;
    const h = CONFIG.player.height;
    const worldBoxes = this.game.world && this.game.world.boxes ? this.game.world.boxes : [];
    for (const b of worldBoxes) {
      if (
        dest.x + r > b.min.x &&
        dest.x - r < b.max.x &&
        dest.z + r > b.min.z &&
        dest.z - r < b.max.z &&
        dest.y + h > b.min.y &&
        dest.y < b.max.y
      ) {
        // При блокировке точки остановки добивание отменяется
        return;
      }
    }

    // Запуск добивания
    this.isActive = true;
    this.target = bestEnemy;
    this.timer = 0;
    this.realTimer = 0;
    this.executed = false;
    this.shotTriggered = false;
    this.hitstopTimer = 0;
    this.startPos.copy(P.pos);
    this.targetPos.copy(dest);

    // Текущее оружие
    this.weaponId = this.game.currentWeapon ? this.game.currentWeapon.id : "shotgun";
    this.ak47BurstIndex = 0;
    this.ak47BurstTimer = 0;

    // Определение типа добивания: устаревший legacy режим или выстрел в упор
    if (CONFIG.glory.useLegacy) {
      this.type = ["punch", "rip", "kick"][Math.floor(Math.random() * 3)];
    } else {
      this.type = "shot";
    }

    // Расчёт плавного доворота камеры к цели (голове/груди)
    const enemyInfo = getEnemyInfo(bestEnemy);
    const targetAimY = bestEnemy.pos.y + (enemyInfo.headY ? enemyInfo.headY * 0.85 : 1.5);
    const eyeY = dest.y + CONFIG.player.eyeHeight;
    const toAim = new THREE.Vector3(
      bestEnemy.pos.x - dest.x,
      targetAimY - eyeY,
      bestEnemy.pos.z - dest.z
    );

    this.startYaw = P.yaw;
    this.startPitch = P.pitch;
    this.targetYaw = Math.atan2(-toAim.x, -toAim.z);
    const horizDist = Math.hypot(toAim.x, toAim.z);
    this.targetPitch = Math.atan2(toAim.y, Math.max(0.01, horizDist));

    // Нормализация разницы углов yaw для кратчайшего доворота
    this.diffYaw = (this.targetYaw - this.startYaw + Math.PI * 3) % (Math.PI * 2) - Math.PI;

    // Неуязвимость игрока на всё время сцены плюс бонусное время
    P.invulnT = this.duration + CONFIG.glory.invulnBonusTime + 0.5;

    // При старте в legacy включаем замедление сразу; в новом режиме — перед/во время выстрела
    if (CONFIG.glory.useLegacy) {
      this.game.timeScale = CONFIG.glory.timeScale;
      if (this.game.audio) this.game.audio.play("glory");
    } else {
      // Подготовка позы оружия: выдвижение вперёд и подъём к прицелу
      if (this.game.viewmodel) {
        const aimDur = (CONFIG.glory.shot && CONFIG.glory.shot.aimDuration) || 0.2;
        this.game.viewmodel.playGloryPose(this.weaponId, aimDur);
      }
    }

    if (this.game.hud) {
      this.game.hud.setGloryVignette(true);
    }
  }

  /**
   * Принудительная отмена добивания с полным восстановлением игрока, камеры и времени
   */
  cancel() {
    if (!this.isActive) return;
    this.isActive = false;
    this.target = null;
    this.game.timeScale = 1.0;

    if (this.game.hud) {
      this.game.hud.setGloryVignette(false);
    }

    if (this.game.viewmodel) {
      this.game.viewmodel.endGloryPose();
    }

    if (this.game.player) {
      this.game.player.camera.rotation.z = 0;
    }
  }

  /**
   * Обновление активных трупов добивания (фонтаны крови, падение тела, очередь АК-47)
   * @param {number} rawDelta
   * @param {Object} fx
   * @private
   */
  _updateActiveCorpses(rawDelta, fx) {
    for (let i = this.activeCorpses.length - 1; i >= 0; i--) {
      const c = this.activeCorpses[i];
      c.timer += rawDelta;

      // 1. Тело после выстрела дробовика
      if (c.type === "shotgun") {
        // Фонтан/гейзер из шеи (0.4 с)
        if (c.timer < c.geyserDuration && fx && fx.particles) {
          const count = 3 + Math.floor(Math.random() * 2);
          for (let p = 0; p < count; p++) {
            fx.particles.spawn(
              c.neckPos.x + rnd(0.06),
              c.neckPos.y,
              c.neckPos.z + rnd(0.06),
              rnd(0.7),
              3.8 + Math.random() * 2.5,
              rnd(0.7),
              c.colors.fluid,
              0.09,
              0.4 + Math.random() * 0.15,
              20,
              0.5
            );
          }
        }

        // Заваливание назад после паузы стояния (0.3 с)
        if (c.timer >= c.standDuration && c.timer < c.standDuration + c.fallDuration) {
          const fallProgress = (c.timer - c.standDuration) / c.fallDuration;
          if (c.enemy && c.enemy.group) {
            c.enemy.group.rotation.x = -fallProgress * (Math.PI * 0.45);
          }
        }

        // Удар об пол: развал на 4-6 кусков и декаль крови
        if (c.timer >= c.standDuration + c.fallDuration && !c.shattered) {
          c.shattered = true;
          if (c.enemy && c.enemy.group) {
            c.enemy.group.visible = false;
          }
          if (fx) {
            const gibCount = 4 + Math.floor(Math.random() * 3);
            if (fx.spawnGibs) {
              fx.spawnGibs(c.enemy.pos, gibCount, c.colors.gibs, false);
            } else if (fx.zombieGibs) {
              fx.zombieGibs(c.enemy.pos, gibCount, false);
            }
            if (fx.decals) {
              fx.decals.add(c.enemy.pos, new THREE.Vector3(0, 1, 0), c.colors.fluid, 1.6);
            }
          }
        }

        // Удаление завершённого трупа
        if (c.timer >= c.standDuration + c.fallDuration + 0.1) {
          this.activeCorpses.splice(i, 1);
        }
      }

      // 2. Тело после очереди АК-47: 3 пули в грудь, падение на спину с хлещущей кровью, через 0.6 с гиб
      else if (c.type === "ak47") {
        // Тряска и дергание от попаданий пуль во время очереди
        if (c.timer < c.burstDuration) {
          if (c.enemy && c.enemy.group) {
            c.enemy.group.position.x = c.originalPos.x + rnd(0.04);
            c.enemy.group.position.z = c.originalPos.z + rnd(0.04);
          }
        }

        // Падение на спину после окончания очереди пуль
        if (c.timer >= c.burstDuration && c.timer < c.burstDuration + c.fallDuration) {
          const fallProgress = (c.timer - c.burstDuration) / c.fallDuration;
          if (c.enemy && c.enemy.group) {
            c.enemy.group.rotation.x = -fallProgress * (Math.PI * 0.48);
          }
          // Хлещущая кровь во время падения
          if (fx && fx.bloodSpray && Math.random() < 0.6) {
            fx.bloodSpray(
              new THREE.Vector3(c.enemy.pos.x + rnd(0.1), c.enemy.pos.y + 0.9, c.enemy.pos.z + rnd(0.1)),
              new THREE.Vector3(rnd(0.5), 0.8 + Math.random() * 0.5, rnd(0.5)).normalize(),
              10,
              c.colors.fluid
            );
          }
        }

        // Через 0.6 с после завершения очереди: разрыв на ошмётки (мясо, кости) и пятно крови
        if (c.timer >= c.burstDuration + c.gibDelay && !c.shattered) {
          c.shattered = true;
          if (c.enemy && c.enemy.group) {
            c.enemy.group.visible = false;
          }
          // Удаляем временные метки пулевых отверстий
          if (c.bulletMarks) {
            for (const bm of c.bulletMarks) {
              if (bm.parent) bm.parent.remove(bm);
              if (bm.geometry) bm.geometry.dispose();
              if (bm.material) bm.material.dispose();
            }
          }

          if (fx) {
            const gibCount = 8;
            if (fx.spawnGibs) {
              fx.spawnGibs(c.enemy.pos, gibCount, c.colors.gibs, false);
            } else if (fx.zombieGibs) {
              fx.zombieGibs(c.enemy.pos, gibCount, false);
            }
            if (fx.decals) {
              fx.decals.add(c.enemy.pos, new THREE.Vector3(0, 1, 0), c.colors.fluid, 1.6);
            }
          }
        }

        if (c.timer >= c.burstDuration + c.gibDelay + 0.1) {
          this.activeCorpses.splice(i, 1);
        }
      }
    }
  }

  /**
   * Обновление кольца ударной волны от выстрела дробовика
   * @param {number} rawDelta
   * @private
   */
  _updateShockwave(rawDelta) {
    if (this.shockwaveTimer > 0) {
      this.shockwaveTimer -= rawDelta;
      const k = Math.max(0, this.shockwaveTimer / this.shockwaveDuration);
      const scale = 0.25 + (1 - k) * 2.4;
      this.shockwaveMesh.scale.setScalar(scale);
      this.shockwaveMat.opacity = k * 0.95;
      if (this.shockwaveTimer <= 0) {
        this.shockwaveMesh.visible = false;
      }
    }
  }

  /**
   * Основной цикл обновления добивания
   * @param {number} dt масштабированное игровое время
   * @param {Object} viewmodel
   * @param {Object} fx
   * @param {number} [rawDt] реальное не масштабированное время кадра
   */
  update(dt, viewmodel, fx, rawDt) {
    // Реальное время кадра без учёта timeScale и эффектов замедления
    const rawDelta =
      rawDt ||
      dt / Math.max(0.001, this.game.timeScale * (this.game.effects ? this.game.effects.timeScaleMult : 1.0));

    // Обновление независимых тел расправы и ударной волны
    this._updateActiveCorpses(rawDelta, fx);
    this._updateShockwave(rawDelta);

    if (!this.isActive) return;

    // Проверка ранней смерти цели (от ловушки или случайного снаряда)
    if (!this.target || (!this.target.alive && !this.shotTriggered)) {
      this.cancel();
      return;
    }

    const P = this.game.player;
    const shotCfg = CONFIG.glory.shot || {};
    const dashDur = shotCfg.dashDuration || 0.15;
    const aimDur = shotCfg.aimDuration || 0.20;
    const hitstopDur = shotCfg.hitstopDuration || 0.06;
    const slowScale = shotCfg.slowTimeScale || 0.3;

    // --- УСТАРЕВШИЙ РЕЖИМ (CONFIG.glory.useLegacy = true) ---
    if (CONFIG.glory.useLegacy) {
      this.timer += dt;
      if (this.timer <= CONFIG.glory.dashDuration) {
        const t = this.timer / CONFIG.glory.dashDuration;
        P.pos.lerpVectors(this.startPos, this.targetPos, t);
        P.vel.set(0, 0, 0);
      }
      if (this.target && this.target.alive) {
        const dx = this.target.pos.x - P.pos.x;
        const dz = this.target.pos.z - P.pos.z;
        P.yaw = Math.atan2(-dx, -dz);
        P.pitch = -0.1;
        P.camera.rotation.set(P.pitch + P.recoil, P.yaw, P.camera.rotation.z);
      }
      const prog = Math.min(1, this.timer / this.duration);
      if (viewmodel) {
        if (this.type === "punch") {
          viewmodel.kick = -Math.sin(prog * Math.PI) * 2.8;
          viewmodel.view.position.x = 0.3 - Math.sin(prog * Math.PI) * 0.15;
        } else if (this.type === "rip") {
          viewmodel.kick = Math.sin(prog * Math.PI * 2) * 1.8;
          viewmodel.view.position.y = -0.27 + Math.sin(prog * Math.PI) * 0.2;
        } else {
          viewmodel.kick = Math.sin(prog * Math.PI) * 3.5;
          P.camera.rotation.z = Math.sin(prog * Math.PI) * 0.18;
        }
      }
      if (!this.executed && this.timer >= CONFIG.glory.executeTime) {
        this.executed = true;
        if (this.target && this.target.alive) {
          if (fx) fx.popup(this.target.pos.x, this.target.pos.y + 2.2, this.target.pos.z, "ДОБИВАНИЕ!", true);
          const push = new THREE.Vector3(0, 4, -20).applyAxisAngle(new THREE.Vector3(0, 1, 0), P.yaw);
          this.target.die(true, push, fx, this.game, true, true);
          P.addShake(0.06, 0.3);
          if (this.game.audio) this.game.audio.play("kill");
        }
      }
      if (this.timer >= this.duration) {
        this.isActive = false;
        this.target = null;
        this.game.timeScale = 1.0;
        if (this.game.hud) this.game.hud.setGloryVignette(false);
        if (viewmodel) viewmodel.view.position.set(0.3, -0.27, -0.5);
        P.camera.rotation.z = 0;
      }
      return;
    }

    // --- НОВЫЙ РЕЖИМ: ВЫСТРЕЛ В УПОР (Doom Eternal style) ---

    // Обработка хит-стопа (0.06 с реального времени)
    if (this.hitstopTimer > 0) {
      this.hitstopTimer -= rawDelta;
      this.game.timeScale = 0.02; // почти полная остановка мира
      if (this.hitstopTimer <= 0) {
        this.game.timeScale = slowScale; // плавное замедление 0.3
      }
      return; // в момент хит-стопа кадр замирает
    }

    this.realTimer += rawDelta;

    // а) Подлёт 0.15 с к точке назначения
    if (this.realTimer <= dashDur) {
      const t = Math.min(1, this.realTimer / dashDur);
      P.pos.lerpVectors(this.startPos, this.targetPos, t);
      P.vel.set(0, 0, 0);
    } else {
      P.pos.copy(this.targetPos);
      P.vel.set(0, 0, 0);
    }

    // Плавный доворот камеры к цели (до завершения фазы прицеливания)
    const aimPhaseTotal = dashDur + aimDur;
    const camProgress = Math.min(1, this.realTimer / aimPhaseTotal);
    const camEase = 1 - Math.pow(1 - camProgress, 3);
    P.yaw = this.startYaw + this.diffYaw * camEase;
    P.pitch = THREE.MathUtils.lerp(this.startPitch, this.targetPitch, camEase);
    P.camera.rotation.set(P.pitch + P.recoil, P.yaw, 0);

    // в) Выстрел в упор из текущего оружия (патроны НЕ тратятся)
    const shotTime = dashDur + aimDur; // 0.35 с
    if (!this.shotTriggered && this.realTimer >= shotTime) {
      this.shotTriggered = true;
      this.executed = true;
      this.hitstopTimer = hitstopDur;
      this.game.timeScale = 0.02;

      const target = this.target;
      const enemyInfo = getEnemyInfo(target);
      const weaponId = this.weaponId;

      // 1. ДРОБОВИК
      if (weaponId === "shotgun") {
        if (this.game.audio) this.game.audio.play("shot_shotgun", 1.4);
        if (viewmodel) {
          viewmodel.triggerFlash(1.8);
          viewmodel.kick = 2.0; // мощная отдача
        }
        P.addShake(0.12, shotCfg.shakeDuration || 0.3);

        // Кольцо ударной волны
        const neckPos = target.pos.clone().add(new THREE.Vector3(0, enemyInfo.headY || 1.7, 0));
        this.shockwaveMesh.position.copy(neckPos);
        this.shockwaveMesh.quaternion.copy(this.game.camera.quaternion);
        this.shockwaveMesh.scale.setScalar(0.25);
        this.shockwaveMat.opacity = 0.95;
        this.shockwaveMesh.visible = true;
        this.shockwaveTimer = this.shockwaveDuration;

        // Отсечение головы врага
        decapitateEnemy(target);

        // Отдельный оторванный кусок головы летит назад и вбок
        const yaw = P.yaw;
        const backDir = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)).normalize();
        const sideSign = Math.random() < 0.5 ? 1 : -1;
        const rightDir = new THREE.Vector3(backDir.z * sideSign, 0, -backDir.x * sideSign);
        const headVel = backDir
          .clone()
          .multiplyScalar(4 + Math.random() * 2.5)
          .addScaledVector(rightDir, 2 + Math.random() * 2)
          .add(new THREE.Vector3(0, 5 + Math.random() * 2, 0));

        if (fx && fx.spawnHead) {
          fx.spawnHead(neckPos, headVel, enemyInfo.headColor, enemyInfo.headSize);
        } else if (fx && fx.zombieGibs) {
          fx.zombieGibs(neckPos, 1, true);
        }

        // Регистрируем тело для стояния (0.3 с), заваливания назад (0.5 с) и распада об пол
        this.activeCorpses.push({
          type: "shotgun",
          enemy: target,
          colors: enemyInfo,
          neckPos: neckPos,
          timer: 0,
          geyserDuration: shotCfg.decapGeyserDuration || 0.4,
          standDuration: shotCfg.shotgunStandDuration || 0.3,
          fallDuration: shotCfg.shotgunFallDuration || 0.5,
          shattered: false
        });
      }

      // 2. АК-47: 1-й выстрел очереди в грудь, кровь, пулевое отверстие и лёгкий рывок назад
      else if (weaponId === "ak47") {
        if (this.game.audio) this.game.audio.play("shot_ak47", 1.25);
        if (viewmodel) {
          viewmodel.triggerFlash(0.7, "ak47");
          viewmodel.kick = 0.5;
        }

        this.ak47BurstIndex = 1;
        this.ak47BurstTimer = 0;

        const bulletMarks = [];
        const chestY = (enemyInfo.headY || 1.7) * 0.72;
        const bmGeo = new THREE.SphereGeometry(0.045, 8, 8);
        const bmMat = new THREE.MeshBasicMaterial({ color: 0x151515 });
        const mark = new THREE.Mesh(bmGeo, bmMat);
        mark.position.set(rnd(0.12), chestY + rnd(0.08), 0.28);
        target.group.add(mark);
        bulletMarks.push(mark);

        // Брызги крови из груди и лёгкий рывок назад
        const shootDir = new THREE.Vector3(-Math.sin(P.yaw), 0, -Math.cos(P.yaw)).normalize();
        if (fx && fx.bloodSpray) {
          fx.bloodSpray(
            new THREE.Vector3(target.pos.x, target.pos.y + chestY, target.pos.z),
            shootDir,
            18,
            enemyInfo.fluid
          );
        }
        if (target.group) {
          target.group.position.addScaledVector(shootDir, 0.08);
        }

        this.activeCorpses.push({
          type: "ak47",
          enemy: target,
          colors: enemyInfo,
          originalPos: target.group.position.clone(),
          bulletMarks,
          timer: 0,
          burstDuration: shotCfg.ak47BurstDuration || 0.2,
          fallDuration: 0.35,
          gibDelay: 0.6,
          shattered: false
        });
      }

      // 3. РАКЕТНИЦА
      else if (weaponId === "rocket") {
        if (this.game.audio) {
          this.game.audio.play("shot_rocket", 1.2);
          this.game.audio.play("explosion", 1.3);
        }
        if (viewmodel) {
          viewmodel.triggerFlash(1.5);
          viewmodel.kick = -1.8; // удар дулом вперёд
        }
        P.addShake(0.15, 0.35);

        // Мини-взрыв радиусом 2 на враге БЕЗ урона игроку
        if (fx && fx.explosion) {
          fx.explosion(target.pos);
        }

        // Полный разрыв на куски (gibs взрыв)
        target.group.visible = false;
        if (fx) {
          if (fx.spawnGibs) {
            fx.spawnGibs(target.pos, 16, enemyInfo.gibs, true);
          } else if (fx.zombieGibs) {
            fx.zombieGibs(target.pos, 16, true);
          }
          if (fx.decals) {
            fx.decals.add(target.pos, new THREE.Vector3(0, 1, 0), enemyInfo.fluid, 2.0);
          }
        }
      }

      // Отметка врага мёртвым в логике игры
      target.alive = false;
      target.state = "dead";
      if (target.promptSprite) target.promptSprite.visible = false;
      if (target.stunStars) target.stunStars.visible = false;
      if (target.shadow) target.shadow.visible = false;

      // Начисление очков и выпадение предметов
      const pts = target.isMutant ? CONFIG.glory.score * 2 : CONFIG.glory.score;
      this.game.onZombieKill(pts, true, true, target);
      if (this.game.spawnDrops) {
        this.game.spawnDrops(target.pos, true, true);
        if (target.isMutant) {
          this.game.spawnDrops(target.pos, true, true);
        }
      }

      // Текст-уведомление (kill feed / notification) на 1.2 с
      const wNames = { shotgun: "ДРОБОВИК", ak47: "АК-47", rocket: "РАКЕТНИЦА" };
      const wLabel = wNames[weaponId] || "АК-47";
      if (this.game.hud && this.game.hud.showGloryFeed) {
        this.game.hud.showGloryFeed(`${wLabel}: ДОБИТ!`, (shotCfg.notificationDuration || 1.2) * 1000);
      }
      if (fx && fx.popup) {
        fx.popup(target.pos.x, target.pos.y + (enemyInfo.headY || 1.8) + 0.3, target.pos.z, "ДОБИТ!", true);
      }
    }

    // Очередь из 3 выстрелов АК-47 в грудь за 0.2 с
    if (
      this.weaponId === "ak47" &&
      this.shotTriggered &&
      this.ak47BurstIndex < (shotCfg.ak47BurstCount || 3)
    ) {
      this.ak47BurstTimer += rawDelta;
      const interval = (shotCfg.ak47BurstDuration || 0.2) / (shotCfg.ak47BurstCount || 3);
      if (this.ak47BurstTimer >= interval) {
        this.ak47BurstTimer -= interval;
        this.ak47BurstIndex++;
        if (this.game.audio) this.game.audio.play("shot_ak47", 1.15);
        if (viewmodel) {
          viewmodel.triggerFlash(0.55, "ak47");
          viewmodel.kick = 0.4;
        }

        const target = this.target;
        if (target && target.group) {
          const corpse = this.activeCorpses.find((c) => c.enemy === target);
          const enemyInfo = getEnemyInfo(target);
          const chestY = (enemyInfo.headY || 1.7) * 0.72;

          // Брызги крови и толчок
          const shootDir = new THREE.Vector3(-Math.sin(P.yaw), 0, -Math.cos(P.yaw)).normalize();
          if (fx && fx.bloodSpray) {
            fx.bloodSpray(
              new THREE.Vector3(target.pos.x, target.pos.y + chestY, target.pos.z),
              shootDir,
              14,
              enemyInfo.fluid
            );
          }
          target.group.position.addScaledVector(shootDir, 0.06);

          if (corpse && corpse.bulletMarks) {
            const bmGeo = new THREE.SphereGeometry(0.045, 8, 8);
            const bmMat = new THREE.MeshBasicMaterial({ color: 0x151515 });
            const mark = new THREE.Mesh(bmGeo, bmMat);
            mark.position.set(rnd(0.14), chestY + rnd(0.08), 0.28);
            target.group.add(mark);
            corpse.bulletMarks.push(mark);
          }
        }
      }
    }

    // г) Замедление времени timeScale = 0.3 и плавный выход из добивания
    if (this.shotTriggered && this.hitstopTimer <= 0) {
      const shotDoneTime = shotTime + hitstopDur;
      const totalDur = this.duration; // 0.9 с
      const recoveryProgress = Math.min(1, Math.max(0, (this.realTimer - shotDoneTime) / (totalDur - shotDoneTime)));

      // Плавный переход от slowScale (0.3) обратно к 1.0
      this.game.timeScale = THREE.MathUtils.lerp(slowScale, 1.0, Math.pow(recoveryProgress, 1.5));
    }

    // Завершение добивания (~0.9 с реального времени)
    if (this.realTimer >= this.duration) {
      this.isActive = false;
      this.target = null;
      this.game.timeScale = 1.0;

      if (this.game.hud) {
        this.game.hud.setGloryVignette(false);
      }

      if (viewmodel) {
        viewmodel.endGloryPose();
      }

      P.camera.rotation.z = 0;
      P.invulnT = CONFIG.glory.invulnBonusTime || 0.3;
    }
  }
}
