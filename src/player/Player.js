// Игрок: физика движения, прыжки, рывок, здоровье, броня, камера и получение урона
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { resolveBoxCollision } from "../core/Physics.js";

export class Player {
  /**
   * @param {THREE.Camera} camera
   */
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3(CONFIG.player.spawn.x, 0, CONFIG.player.spawn.z);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.jumpsUsed = 0;
    this.jumpQueued = false;
    this.dashQueued = false;
    this.dashTimer = 0;
    this.dashCd = 0;
    this.dashCharges = 1;
    this.dashChargesMax = 1;
    this.dashRecharge = 0;
    this.dashDir = new THREE.Vector3();

    // Множители от расходников и перков
    this.mods = null;
    this.jumpHeightMult = 1;
    this.moveSpeedMult = 1;
    this.gravityMult = 1;
    this.drunkAmount = 0; // 0..1, для камеры/управления
    this.weedAmount = 0;
    this.drunkTime = 0;
    this.lookSens = 1;

    this.recoil = 0;
    this.recoilYaw = 0;
    this.shakeT = 0;
    this.shakeDur = 0.1;
    this.shakeAmp = 0;
    this.fov = CONFIG.camera.fov;
    this.jumpVel = Math.sqrt(2 * CONFIG.movement.gravity * CONFIG.movement.jumpHeight);
    this.camera.rotation.order = "YXZ";

    this.health = CONFIG.player.health;
    this.maxHealth = CONFIG.player.maxHealth;
    this.armor = CONFIG.player.armor;
    this.maxArmor = CONFIG.player.maxArmor;
    this.invulnT = 0;
    this.isDead = false;
    this.deathCamT = 0;
    this.vignetteT = 0;

    this.dmgIndicatorT = 0;
    this.dmgSourcePos = new THREE.Vector3();

    // Game feel параметры
    this.prevOnGround = true;
    this.prevVelY = 0;
    this.stepTimer = 0;
    this.strafeRoll = 0;
    this.fovKick = 0;
  }

  reset(spawnPos = null) {
    if (spawnPos) {
      this.pos.set(spawnPos.x, spawnPos.y ?? 0, spawnPos.z);
    } else {
      this.pos.set(CONFIG.player.spawn.x, 0, CONFIG.player.spawn.z);
    }
    this.vel.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.health = this.maxHealth;
    this.armor = CONFIG.player.armor;
    this.invulnT = 0;
    this.isDead = false;
    this.deathCamT = 0;
    this.vignetteT = 0;
    this.dmgIndicatorT = 0;
    this.dashCd = 0;
    this.dashTimer = 0;
    this.dashRecharge = 0;
    this.dashCharges = this.dashChargesMax || 1;
    this.recoil = 0;
    this.recoilYaw = 0;
    this.shakeT = 0;
    this.drunkAmount = 0;
    this.weedAmount = 0;
    this.drunkTime = 0;
    this.lookSens = 1;
    this.camera.rotation.set(0, 0, 0);
  }

  addShake(a, t) {
    if (CONFIG.feel?.reduced) {
      a *= 0.4;
    }
    const mult = (CONFIG.feel?.camera?.shakeMult ?? 1.0) * (CONFIG.feel?.intensity ?? 1.0);
    const amp = a * mult;
    this.shakeAmp = Math.max(amp, (this.shakeAmp * Math.max(0, this.shakeT)) / this.shakeDur);
    this.shakeDur = t;
    this.shakeT = t;
  }

  look(dx, dy, viewmodel = null) {
    if (this.isDead) return;
    const sens = CONFIG.camera.mouseSensitivity * this.lookSens;
    this.yaw -= dx * sens;
    this.pitch -= dy * sens;
    const lim = Math.PI / 2 - 0.01;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
    if (viewmodel && viewmodel.addSway && !CONFIG.feel?.reduced) {
      viewmodel.addSway(dx, dy);
    }
  }

  approach(target, maxDelta) {
    const dx = target.x - this.vel.x;
    const dz = target.z - this.vel.z;
    const len = Math.hypot(dx, dz);
    if (len <= maxDelta || len === 0) {
      this.vel.x = target.x;
      this.vel.z = target.z;
    } else {
      this.vel.x += (dx / len) * maxDelta;
      this.vel.z += (dz / len) * maxDelta;
    }
  }

  takeDamage(amount, sourcePos, game) {
    if (this.isDead || this.invulnT > 0 || (game.gloryKill && game.gloryKill.isActive)) return;
    if (game.effects) amount *= game.effects.damageTakenMult;

    // Сложность забега
    if (game.difficultyCfg) amount *= game.difficultyCfg.damageMult ?? 1;

    // «Пьяный мастер»: водка даёт дополнительную защиту
    if (game.effects && game.effects.has && game.effects.has("vodka")) {
      const def = game.perks?.mods?.vodkaDefense ?? 0;
      if (def > 0) amount *= Math.max(0, 1 - def);
    }

    // На ступени стиля 5 («БОГ») игрок получает на 10% меньше урона
    if (game.styleMeter && game.styleMeter.rank === 5) {
      amount *= 1 - (CONFIG.style?.godDamageReduction || 0.1);
    }

    // Получение урона снимает 25 единиц шкалы стиля и откатывает ступень не более чем на 1
    if (game.styleMeter) {
      game.styleMeter.drainOnDamage(CONFIG.style?.damageDrain || 25);
    }

    this.invulnT = CONFIG.player.invulnTime;
    this.vignetteT = CONFIG.player.vignetteTime;
    this.addShake(CONFIG.player.shakeAmpOnDamage, CONFIG.player.shakeDurOnDamage);
    if (game.audio) game.audio.play("damage");

    const absorbed = Math.min(this.armor, amount * CONFIG.player.armorAbsorptionRatio);
    this.armor -= absorbed;
    const directDmg = amount - absorbed;
    this.health = Math.max(0, this.health - directDmg);

    if (sourcePos) {
      this.dmgIndicatorT = CONFIG.player.dmgIndicatorTime;
      this.dmgSourcePos.copy(sourcePos);
    }

    if (this.health <= 0) {
      this.die(game);
    } else {
      // «Последний шанс»: замедление времени при низком HP
      if (
        this.health < this.maxHealth * (CONFIG.run?.lastChanceThreshold ?? 0.2) &&
        game.tryLastChance
      ) {
        game.tryLastChance();
      }
      if (this.health < CONFIG.player.lowHpThreshold) game.sayQuote("lowHealth");
      else game.sayQuote("damage");
    }
  }

  die(game) {
    if (this.isDead) return;
    this.isDead = true;
    this.health = 0;
    if (game && game.styleMeter) {
      game.styleMeter.reset();
    }
    game.onPlayerDeath();
  }

  update(dt, keys, world, isGloryLocked, game = null) {
    const C = CONFIG;

    if (this.isDead) {
      this.deathCamT = Math.min(1, this.deathCamT + dt * C.player.deathCamLerpSpeed);
      const e = 1 - Math.pow(1 - this.deathCamT, 3);
      this.pos.y = Math.max(C.player.deathCamMinY, this.pos.y - dt * C.player.deathCamFallSpeed);
      this.camera.position.set(this.pos.x, this.pos.y, this.pos.z);
      this.camera.rotation.set(0.18 + e * 0.2, this.yaw, e * 0.55);
      return;
    }

    if (this.invulnT > 0) this.invulnT = Math.max(0, this.invulnT - dt);
    if (this.vignetteT > 0) this.vignetteT = Math.max(0, this.vignetteT - dt);
    if (this.dmgIndicatorT > 0) this.dmgIndicatorT = Math.max(0, this.dmgIndicatorT - dt);

    // Запаздывание мыши от водки (и плавное восстановление после отходняка)
    this.drunkTime += dt;
    const drunkCfg = CONFIG.effects.screen ? CONFIG.effects.screen.drunk : null;
    if (drunkCfg) {
      const d = Math.min(1, Math.max(0, this.drunkAmount));
      const targetSens = 1 - (1 - (drunkCfg.sensMin ?? 0.7)) * d;
      const k = 1 - Math.exp(-(drunkCfg.sensLerp ?? 4) * dt);
      this.lookSens += (targetSens - this.lookSens) * k;
    }

    if (isGloryLocked) {
      this.camera.position.set(this.pos.x, this.pos.y + C.player.eyeHeight, this.pos.z);
      return;
    }

    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);

    const ix = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    const iz = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    let wx = fx * iz + rx * ix;
    let wz = fz * iz + rz * ix;
    const wl = Math.hypot(wx, wz);
    const hasInput = wl > 0;
    if (hasInput) {
      wx /= wl;
      wz /= wl;
    }

    // Водка «заносит»: медленное боковое смещение направления
    if (hasInput && this.drunkAmount > 0.001 && drunkCfg) {
      const drift =
        Math.sin(this.drunkTime * 0.75 + 0.8) *
        (drunkCfg.driftMax ?? 0.25) *
        Math.min(1, this.drunkAmount);
      const bx = wx;
      const bz = wz;
      wx = bx - bz * drift;
      wz = bz + bx * drift;
      const dl = Math.hypot(wx, wz);
      if (dl > 0) {
        wx /= dl;
        wz /= dl;
      }
    }

    // Заряды рывка: 1 по умолчанию, больше с перком «Двойной рывок»
    this.dashChargesMax = Math.max(1, this.mods?.dashCharges ?? this.dashChargesMax ?? 1);
    if (this.dashCharges > this.dashChargesMax) this.dashCharges = this.dashChargesMax;
    if (this.dashCharges < this.dashChargesMax) {
      this.dashRecharge -= dt;
      if (this.dashRecharge <= 0) {
        this.dashCharges++;
        this.dashRecharge = this.dashCharges < this.dashChargesMax ? C.dash.dashCooldown : 0;
      }
    } else {
      this.dashRecharge = 0;
    }
    this.dashCd = this.dashCharges > 0 ? 0 : Math.max(0, this.dashRecharge);

    if (this.dashQueued && this.dashCharges > 0) {
      const wasFull = this.dashCharges >= this.dashChargesMax;
      this.dashCharges--;
      if (wasFull) this.dashRecharge = C.dash.dashCooldown;
      this.dashDir.set(hasInput ? wx : fx, 0, hasInput ? wz : fz);
      this.dashTimer = C.dash.dashDuration;
      this.vel.y = Math.max(this.vel.y, 0) * C.dash.airYFactor;
      if (!CONFIG.feel?.reduced) {
        this.fovKick = Math.max(this.fovKick, (CONFIG.feel?.camera?.dashFovKick ?? 10) * (CONFIG.feel?.intensity ?? 1.0));
      }
      if (game?.audio) game.audio.play("dash");
      if (game?.particles) {
        game.particles.dust(this.pos, CONFIG.feel?.particles?.dustDashCount ?? 8, 0.4);
      }
    }
    this.dashQueued = false;

    if (this.jumpQueued && this.jumpsUsed < C.movement.maxJumps) {
      const isDouble = this.jumpsUsed > 0;
      // +15% реальной высоты двойного прыжка: скорость корня из множителя высоты
      const jumpMult = isDouble ? Math.sqrt(this.jumpHeightMult || 1) : 1;
      this.vel.y = this.jumpVel * jumpMult;
      this.jumpsUsed++;
      this.onGround = false;
      if (!CONFIG.feel?.reduced) {
        this.fovKick = Math.max(this.fovKick, (CONFIG.feel?.camera?.jumpFovKick ?? 3.5) * (CONFIG.feel?.intensity ?? 1.0));
      }
      if (game?.audio) {
        game.audio.play(isDouble ? "double_jump" : "jump");
      }
    }
    this.jumpQueued = false;

    if (this.dashTimer > 0) {
      this.dashTimer -= dt;
      this.vel.x = this.dashDir.x * C.dash.dashSpeed;
      this.vel.z = this.dashDir.z * C.dash.dashSpeed;
    } else {
      const accel = this.onGround ? C.movement.groundAccel : C.movement.airAccel;
      this.approach({ x: wx * C.movement.moveSpeed * this.moveSpeedMult, z: wz * C.movement.moveSpeed * this.moveSpeedMult }, accel * dt);
      this.vel.y = Math.max(this.vel.y - C.movement.gravity * this.gravityMult * dt, -C.movement.maxFallSpeed);
    }

    const wasGrounded = this.onGround;
    const fallVelY = this.vel.y;

    this.move(dt, world);

    const justLanded = !wasGrounded && this.onGround;
    if (justLanded) {
      if (game?.audio) game.audio.play("land");
      if (game?.particles) {
        game.particles.dust(this.pos, CONFIG.feel?.particles?.dustLandCount ?? 12, 0.7);
      }
      const thresh = CONFIG.feel?.camera?.landShakeVelThresh ?? 7.0;
      if (fallVelY < -thresh && !CONFIG.feel?.reduced) {
        const amp = (CONFIG.feel?.camera?.landShakeAmp ?? 0.08) * (CONFIG.feel?.intensity ?? 1.0);
        const dur = CONFIG.feel?.camera?.landShakeDur ?? 0.22;
        this.addShake(amp, dur);
      }
    }

    // Звуки шагов при перемещении по земле
    if (this.onGround && hasInput && this.dashTimer <= 0) {
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        this.stepTimer = 0.35;
        if (game?.audio) game.audio.play("step");
      }
    } else {
      this.stepTimer = Math.min(this.stepTimer, 0.12);
    }

    this.camera.position.set(this.pos.x, this.pos.y + C.player.eyeHeight, this.pos.z);
    this.recoil *= Math.exp(-C.player.recoilDampSpeed * dt);
    this.recoilYaw = (this.recoilYaw || 0) * Math.exp(-C.player.recoilDampSpeed * dt);

    let sx = 0;
    let sy = 0;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const k = (this.shakeAmp * Math.max(0, this.shakeT)) / this.shakeDur;
      sx = (Math.random() - 0.5) * k;
      sy = (Math.random() - 0.5) * k;
    }

    // Пьяное раскачивание камеры: крен и лёгкий наклон тангажа
    let roll = 0;
    let tilt = 0;
    if (this.drunkAmount > 0.001 && drunkCfg) {
      const d = Math.min(1, this.drunkAmount);
      const amp =
        ((drunkCfg.swayBaseDeg ?? 2) + (drunkCfg.swayStrengthDeg ?? 6) * d) *
        (Math.PI / 180);
      const period = Math.max(0.5, drunkCfg.swayPeriod ?? 5);
      const phase = (this.drunkTime / period) * Math.PI * 2;
      roll = Math.sin(phase) * amp;
      tilt = Math.sin(phase * 0.5 + 1.3) * amp * 0.35;
    }

    // Крен камеры при боковом стрейфе (A/D)
    const strafeInput = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    const maxRollDeg = (CONFIG.feel?.camera?.strafeRollDeg ?? 1.6) * (CONFIG.feel?.intensity ?? 1.0);
    const targetStrafeRoll = CONFIG.feel?.reduced ? 0 : (-strafeInput * maxRollDeg * (Math.PI / 180));
    const rollSpeed = CONFIG.feel?.camera?.strafeRollSpeed ?? 10;
    this.strafeRoll += (targetStrafeRoll - this.strafeRoll) * Math.min(1, rollSpeed * dt);

    this.camera.rotation.set(this.pitch + this.recoil + sx + tilt, this.yaw + (this.recoilYaw || 0) + sy, roll + this.strafeRoll);

    this.fovKick *= Math.exp(-9 * dt);
    const baseFov = (CONFIG.camera && CONFIG.camera.fov) || 77;
    let targetFov = baseFov + this.fovKick;
    if (this.dashTimer > 0) targetFov = baseFov + 10 + this.fovKick;
    this.fov += (targetFov - this.fov) * Math.min(1, (C.camera?.fovLerp || 14) * dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  move(dt, world) {
    const maxMove = Math.max(Math.abs(this.vel.x), Math.abs(this.vel.y), Math.abs(this.vel.z)) * dt;
    const steps = Math.max(1, Math.ceil(maxMove / CONFIG.player.collisionSubstepDist));
    const sdt = dt / steps;
    const floorY = CONFIG.level.worldFloorY ?? 0;
    let grounded = false;
    const boxes = world && world.getNearbyBoxes ? world.getNearbyBoxes(this.pos) : (world ? world.boxes : []);

    for (let i = 0; i < steps; i++) {
      if (this._moveAxis("x", this.vel.x * sdt, boxes)) grounded = true;
      if (this._moveAxis("z", this.vel.z * sdt, boxes)) grounded = true;

      this.pos.y += this.vel.y * sdt;
      if (resolveBoxCollision(this.pos, this.vel, CONFIG.player.radius, CONFIG.player.height, boxes, "y", CONFIG.player.collisionEps, floorY)) {
        grounded = true;
      }
    }
    this.onGround = grounded;
    if (grounded) this.jumpsUsed = 0;
  }

  /**
   * Перемещение по горизонтальной оси с автоматическим шагом на низкий уступ.
   * Если путь перекрыт, но впереди есть поверхность не выше stepUpHeight,
   * игрок поднимается на неё без прыжка — так работают ступени-рампы.
   * @param {"x"|"z"} axis
   * @param {number} delta
   * @param {Array} boxes
   * @returns {boolean} true, если был совершён шаг на уступ
   */
  _moveAxis(axis, delta, boxes) {
    if (delta === 0) return false;

    const C = CONFIG.player;
    const stepH = CONFIG.level.stepUpHeight ?? 0.5;
    const startX = this.pos.x;
    const startZ = this.pos.z;
    const startY = this.pos.y;
    const velBefore = this.vel[axis];

    this.pos[axis] += delta;
    resolveBoxCollision(this.pos, this.vel, C.radius, C.height, boxes, axis, C.collisionEps);

    const moved = Math.abs(this.pos[axis] - (axis === "x" ? startX : startZ));
    if (moved >= Math.abs(delta) - 1e-4) return false;
    // В прыжке или падении уступы не преодолеваем
    if (Math.abs(this.vel.y) > 0.5) return false;

    const lifts = [stepH, stepH * 0.66, stepH * 0.34];
    for (const lift of lifts) {
      const testY = startY + lift;
      const testX = axis === "x" ? startX + delta : startX;
      const testZ = axis === "z" ? startZ + delta : startZ;
      if (this._overlapsAny(boxes, testX, testY, testZ)) continue;

      // Ищем поверхность под ногами в пределах шага
      let groundY = null;
      for (const b of boxes) {
        if (
          testX + C.radius <= b.min.x ||
          testX - C.radius >= b.max.x ||
          testZ + C.radius <= b.min.z ||
          testZ - C.radius >= b.max.z
        ) {
          continue;
        }
        if (b.max.y <= startY + 0.01 || b.max.y > startY + stepH + 0.01) continue;
        if (groundY === null || b.max.y > groundY) groundY = b.max.y;
      }
      if (groundY === null) continue;

      this.pos.set(testX, groundY, testZ);
      this.vel[axis] = velBefore;
      this.vel.y = 0;
      return true;
    }

    // Если это не уступ, оставляем позицию, вычисленную resolveBoxCollision (скольжение вдоль стены)
    return false;
  }

  /**
   * Пересекается ли хитбокс игрока с коллайдерами в заданной позиции
   * @param {Array} boxes
   * @param {number} x
   * @param {number} y - нижняя точка хитбокса
   * @param {number} z
   * @returns {boolean}
   */
  _overlapsAny(boxes, x, y, z) {
    const C = CONFIG.player;
    const e = 0.002;
    for (const b of boxes) {
      if (
        x + C.radius - e > b.min.x &&
        x - C.radius + e < b.max.x &&
        z + C.radius - e > b.min.z &&
        z - C.radius + e < b.max.z &&
        y + C.height - e > b.min.y &&
        y + e < b.max.y
      ) {
        return true;
      }
    }
    return false;
  }
}
