// Враг Мутант: крупный горбатый мутант с рукой-молотом, прыжковая атака и удар по земле
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { outlined, rayAABB, rnd, resolveBoxCollision } from "../core/Physics.js";
import { getGloryPromptTexture } from "../effects/PromptTexture.js";
import { Enemy } from "./Enemy.js";
import { createToonMaterial } from "../world/Materials.js";

export class Mutant extends Enemy {
  /**
   * @param {THREE.Scene} scene
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {Object} [opts] - { isBoss, scale, health }
   */
  constructor(scene, x, y, z, opts = {}) {
    const C = CONFIG.enemies.mutant;
    const speed = C.speed * (1 + rnd(C.speedVar));
    const health = opts.health || C.health;
    super(scene, x, y, z, health, speed);

    this.isMutant = true;
    this.isBoss = !!opts.isBoss;
    this.modelScale = opts.scale || 1;
    this.hitboxScale = this.modelScale;
    if (this.shadow) {
      this.shadowBaseScale = 1.7 * this.modelScale;
      this.shadow.scale.set(this.shadowBaseScale, 1, this.shadowBaseScale);
    }

    // Таймеры атак
    this.leapCd = C.leapCooldown;
    this.slamT = 0;
    this.slamCd = 0;
    this.leapT = 0;
    this.leapStartPos = new THREE.Vector3();
    this.leapTargetPos = new THREE.Vector3();
    this.leapPeakY = 0;
    this.leapDuration = 0;
    this.leapWindupT = 0;
    this.staggerT = 0;
    this.wobbleT = Math.random() * 10;
    this.slamExecuted = false;

    // Комната/арена, за пределы которой мутант не может выйти
    this.boundRoom = null;
    this.leapRoom = null;

    // Состояние стаггера запоминает предыдущее (для отката)
    this.prevState = "idle";

    this.buildModel();
    this.updateHitboxes();
  }

  buildModel() {
    // Материалы мутанта
    const isPsx = (CONFIG.graphics && CONFIG.graphics.styleName) !== "cartoon";
    const baseOpts = isPsx ? { emissive: 0x141414, emissiveIntensity: 1.0 } : {};
    this.skinMat = createToonMaterial(0x6b3fa0, baseOpts); // фиолетовая кожа
    this.bellyMat = createToonMaterial(0x3d8b37, baseOpts); // зелёное брюхо
    this.spikeMat = createToonMaterial(0x2d1b4e, baseOpts); // тёмные шипы
    this.eyeMat = createToonMaterial(0xff3333, baseOpts); // красные глаза
    this.eyeWMat = createToonMaterial(0xffee88, baseOpts); // жёлтые белки
    this.hammerMat = createToonMaterial(0x7b4fbf, baseOpts); // кулак-молот

    const box = (w, h, d, mat) => outlined(new THREE.BoxGeometry(w, h, d), mat);
    const sph = (r, mat) => outlined(new THREE.SphereGeometry(r, 10, 8), mat, 40);

    // Масштаб 1.5x относительно зомби
    const S = 1.5;

    // Торс (горбатый — трапециевидный, наклон вперёд)
    this.torso = box(0.85, 1.2, 0.55, this.skinMat);
    this.torso.position.y = 1.1 * S;
    this.torso.rotation.x = 0.15; // горб
    this.group.add(this.torso);

    // Горб на спине
    const hump = box(0.6, 0.45, 0.4, this.skinMat);
    hump.position.set(0, 0.4, -0.35);
    this.torso.add(hump);

    // Зелёное брюхо (нашлёпка спереди)
    const belly = box(0.65, 0.6, 0.1, this.bellyMat);
    belly.position.set(0, -0.15, 0.28);
    this.torso.add(belly);

    // Шипы на спине (3 шт.)
    for (let i = 0; i < 3; i++) {
      const spike = outlined(new THREE.ConeGeometry(0.08, 0.45, 5), this.spikeMat);
      spike.position.set(-0.15 + i * 0.15, 0.55, -0.35);
      spike.rotation.x = -0.5 + rnd(0.2);
      spike.rotation.z = rnd(0.15);
      this.torso.add(spike);
    }

    // Лишняя маленькая рука на спине
    this.backArm = new THREE.Group();
    this.backArm.position.set(0.2, 0.25, -0.4);
    const backArmMesh = box(0.08, 0.08, 0.35, this.skinMat);
    backArmMesh.position.z = -0.17;
    const backHand = box(0.07, 0.07, 0.1, this.bellyMat);
    backHand.position.z = -0.37;
    this.backArm.add(backArmMesh, backHand);
    this.backArm.rotation.x = -0.8;
    this.backArm.rotation.z = 0.3;
    this.torso.add(this.backArm);

    // Голова (крупнее, 3 глаза)
    this.headGroup = new THREE.Group();
    this.headGroup.position.set(0, 2.5, 0.1);
    const headMesh = sph(0.42, this.skinMat);
    headMesh.scale.set(1, 0.85, 0.95); // приплюснутая
    this.headGroup.add(headMesh);

    // 3 глаза разного размера
    const eyeData = [
      { x: -0.18, y: 0.05, z: 0.34, r: 0.12, pr: 0.06 }, // левый большой
      { x: 0.14, y: 0.08, z: 0.35, r: 0.09, pr: 0.045 },  // правый средний
      { x: 0.02, y: -0.12, z: 0.38, r: 0.065, pr: 0.03 }   // нижний маленький
    ];
    for (const e of eyeData) {
      const eyeW = sph(e.r, this.eyeWMat);
      eyeW.position.set(e.x, e.y, e.z);
      const pupil = sph(e.pr, this.eyeMat);
      pupil.position.set(e.x, e.y, e.z + e.r * 0.7);
      this.headGroup.add(eyeW, pupil);
    }

    // Челюсть (широкая)
    const jaw = box(0.38, 0.12, 0.22, this.skinMat);
    jaw.position.set(0, -0.28, 0.14);
    this.headGroup.add(jaw);
    this.group.add(this.headGroup);

    // Правая рука — ОГРОМНАЯ рука-молот
    this.armR = new THREE.Group();
    this.armR.position.set(0.58, 1.7 * S, 0);
    const armRUpper = box(0.28, 0.28, 0.6, this.skinMat);
    armRUpper.position.z = 0.3;
    const armRFore = box(0.32, 0.32, 0.55, this.skinMat);
    armRFore.position.set(0, -0.05, 0.85);
    // Кулак-молот
    this.hammerFist = box(0.5, 0.45, 0.5, this.hammerMat);
    this.hammerFist.position.set(0, -0.05, 1.2);
    // Костяные наросты на кулаке
    for (let i = 0; i < 3; i++) {
      const knuckle = sph(0.1, this.spikeMat);
      knuckle.position.set(-0.15 + i * 0.15, 0.2, 0);
      this.hammerFist.add(knuckle);
    }
    this.armR.add(armRUpper, armRFore, this.hammerFist);
    this.group.add(this.armR);

    // Левая рука — маленькая, атрофированная
    this.armL = new THREE.Group();
    this.armL.position.set(-0.52, 1.6 * S, 0);
    const armLMesh = box(0.12, 0.12, 0.4, this.skinMat);
    armLMesh.position.z = 0.2;
    const handL = box(0.09, 0.09, 0.14, this.bellyMat);
    handL.position.z = 0.45;
    this.armL.add(armLMesh, handL);
    this.group.add(this.armL);

    // Ноги (массивные)
    this.legL = box(0.28, 0.85, 0.3, this.skinMat);
    this.legL.position.set(-0.22, 0.42, 0);
    this.legR = box(0.28, 0.85, 0.3, this.skinMat);
    this.legR.position.set(0.22, 0.42, 0);
    this.group.add(this.legL, this.legR);

    // Эффект оглушения: звёздочки над головой
    this.stunStars = new THREE.Group();
    this.stunStars.position.set(0, 3.2, 0);
    for (let i = 0; i < 4; i++) {
      const star = outlined(new THREE.BoxGeometry(0.1, 0.1, 0.1), createToonMaterial(0xffd23f));
      const ang = (i / 4) * Math.PI * 2;
      star.position.set(Math.cos(ang) * 0.32, 0, Math.sin(ang) * 0.32);
      this.stunStars.add(star);
    }
    this.stunStars.visible = false;
    this.group.add(this.stunStars);

    // Подсказка "[E] ДОБИТЬ" (общая текстура для всех врагов)
    const tex = getGloryPromptTexture();
    this.promptSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    this.promptSprite.position.set(0, 3.5, 0);
    this.promptSprite.scale.set(1.8, 0.45, 1);
    this.promptSprite.visible = false;
    this.group.add(this.promptSprite);

    // Индикатор замаха прыжка (красное свечение)
    this.leapGlowMat = new THREE.MeshBasicMaterial({
      color: 0xff2200,
      transparent: true,
      opacity: 0,
      depthWrite: false
    });
    this.leapGlow = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 6), this.leapGlowMat);
    this.leapGlow.position.y = 1.5;
    this.leapGlow.visible = false;
    this.group.add(this.leapGlow);

    // Кольцо удара по земле (декоративная волна)
    this.slamRing = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 3.0, 24),
      new THREE.MeshBasicMaterial({ color: 0x886644, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false })
    );
    this.slamRing.rotation.x = -Math.PI / 2;
    this.slamRing.visible = false;
    this.scene.add(this.slamRing);
    this.slamRingT = 0;

    this.scene.add(this.group);

    // Босс-заглушка: модель увеличена вдвое
    if (this.modelScale !== 1) {
      this.baseScale.setScalar(this.modelScale);
      this.group.scale.setScalar(this.modelScale);
    }
  }

  setFlash(on) {
    const isPsx = (CONFIG.graphics && CONFIG.graphics.styleName) !== "cartoon";
    const flashCol = isPsx ? ((CONFIG.graphics.style && CONFIG.graphics.style.psx && CONFIG.graphics.style.psx.hitFlashColor) || 0xfff4c0) : 0xffffff;
    const baseCol = isPsx ? 0x141414 : 0;
    const hex = on ? flashCol : baseCol;
    this.skinMat.emissive.setHex(hex);
    this.bellyMat.emissive.setHex(hex);
  }

  /** Мутант не переходит в unreachable — он может прыгнуть на блок */
  alert(player = null) {
    if (!this.alive) return;
    if (this.state === "idle") {
      this.state = "chase";
    }
  }

  /** Радиус коллизий с учётом масштаба: у босса модель и хитбоксы вдвое крупнее */
  get bodyRadius() {
    return CONFIG.enemies.mutant.hitboxRadius * (this.hitboxScale || 1);
  }

  /** Хитбоксы мутанта — крупнее зомби в 1.5 раза, у босса дополнительно масштабируются */
  updateHitboxes() {
    const C = CONFIG.enemies.mutant;
    const S = this.hitboxScale || 1;
    const x = this.pos.x;
    const y = this.pos.y;
    const z = this.pos.z;
    const radius = C.hitboxRadius * S;
    const bodyTop = C.hitboxBodyTop * S;
    const headRadius = C.hitboxHeadRadius * S;
    this.bodyMin.set(x - radius, y, z - radius);
    this.bodyMax.set(x + radius, y + bodyTop, z + radius);
    this.headMin.set(x - headRadius, y + bodyTop, z - headRadius);
    this.headMax.set(x + headRadius, y + C.hitboxHeight * S, z + headRadius);
  }

  /** Сопротивление отбрасыванию: мутант получает только 30% knockback */
  takeDamage(dmg, isHeadshot, pushVec, fx, game) {
    if (!this.alive) return;
    const C = CONFIG.enemies.mutant;
    const finalDmg = isHeadshot ? dmg * 2 : dmg;
    this.hp -= finalDmg;
    this.flashT = 0.08;
    this.setFlash(true);

    if (fx) {
      fx.popup(this.pos.x, this.pos.y + 3.0 * (this.hitboxScale || 1), this.pos.z, Math.round(finalDmg), isHeadshot);
      const hitNormal = pushVec ? pushVec.clone().normalize().negate() : new THREE.Vector3(0, 1, 0);
      // Зелёная слизь вместо крови
      fx.bloodSpray(this.pos, hitNormal, finalDmg, C.bloodColor);
    }

    // Сопротивление отбрасыванию (70% — только 30% knockback проходит)
    if (pushVec) {
      this.vel.addScaledVector(pushVec, 0.4 * (1 - C.knockbackResist));
    }

    // Проверка на смерть
    if (this.hp <= 0) {
      const wasStunned = this.state === "stunned";
      this.die(isHeadshot, pushVec, fx, game, false, wasStunned);
      return;
    }

    // Проверка оглушения (< 25% HP)
    if (this.hp <= this.maxHp * CONFIG.glory.stunThreshold && this.state !== "stunned") {
      this.state = "stunned";
      this.stunTimer = CONFIG.glory.stunDuration;
      return;
    }

    // Не прерывать прыжок и удар стаггером
    if (this.state === "leap" || this.state === "slam" || this.state === "stunned") return;

    this.prevState = this.state;
    this.state = "stagger";
    this.staggerT = C.staggerTime;
  }

  die(isHeadshot, pushVec, fx, game, isGloryKill = false, wasStunned = false) {
    this.stunStars.visible = false;
    this.promptSprite.visible = false;
    this.leapGlow.visible = false;
    this.slamRing.visible = false;
    this.alive = false;
    this.state = "dead";
    this.group.visible = false;

    const C = CONFIG.enemies.mutant;
    let pts = isGloryKill ? CONFIG.glory.score * 2 : isHeadshot ? C.scoreValue + C.headshotBonus : C.scoreValue;
    if (this.isBoss) {
      pts += (CONFIG.waves.boss && CONFIG.waves.boss.scoreBonus) || 2000;
    }
    game.onZombieKill(pts, isHeadshot, isGloryKill, this);

    // Больше кусков: 14–18 при обычной смерти, зелёная слизь
    const gibCount = isGloryKill ? C.gibsGlory : isHeadshot ? C.gibsHeadshot : C.gibsNormal;

    if (fx) {
      // Зелёные куски
      this.spawnMutantGibs(fx, gibCount, isHeadshot);
      if (fx.decals) {
        fx.decals.add(this.pos, new THREE.Vector3(0, 1, 0), C.bloodColor, 2.0);
      }
    }

    // Больше предметов при добивании
    if (game.spawnDrops) {
      game.spawnDrops(this.pos, isGloryKill, wasStunned);
      // Дополнительный дроп от мутанта
      if (isGloryKill) {
        game.spawnDrops(this.pos, true, true);
      }
    }
  }

  /** Специальные куски мутанта: зелёная слизь, большая рука отдельным куском */
  spawnMutantGibs(fx, count, isHeadshot) {
    const C = CONFIG.enemies.mutant;
    const clrs = [C.bloodColor, 0x6b3fa0, 0x3d8b37, 0x2d1b4e, 0x7b4fbf];
    const gore = fx.gore || fx;
    if (!gore.gibs) return;

    for (let i = 0; i < count; i++) {
      const g = gore.gibs[gore.gi];
      gore.gi = (gore.gi + 1) % gore.gibs.length;
      const isBigArm = i === 0; // первый кусок — большая рука
      const isHead = i === 1 && isHeadshot;
      g.m.material.color.setHex(
        isBigArm ? 0x7b4fbf : isHead ? 0x6b3fa0 : clrs[i % clrs.length]
      );
      g.s = isBigArm ? 0.5 : isHead ? 0.4 : 0.22 + Math.random() * 0.18;
      g.m.scale.setScalar(g.s);
      g.m.position.set(
        this.pos.x + rnd(0.4),
        this.pos.y + 0.8 + Math.random() * 1.4,
        this.pos.z + rnd(0.4)
      );
      g.v.set(rnd(7), 5 + Math.random() * 7, rnd(7));
      if (isBigArm) {
        // Большая рука летит дальше
        g.v.set(rnd(4) + 5, 6 + Math.random() * 4, rnd(4));
      }
      g.w.set(rnd(14), rnd(14), rnd(14));
      g.life = CONFIG.effects.gibs.life;
      g.m.visible = true;
    }
  }

  /** Проверка прямой видимости до точки (исключая блок, на котором стоит цель) */
  hasLineOfSight(fromPos, toPos, boxes, ignoreBlock = null) {
    const dir = this._tmpDir.subVectors(toPos, fromPos);
    const dist = dir.length();
    if (dist < 1e-4) return true;
    dir.multiplyScalar(1 / dist);
    for (const b of boxes) {
      if (b === ignoreBlock) continue;
      const h = rayAABB(fromPos, dir, b.min, b.max, 0.2);
      if (h && h.t < dist - 0.5) return false;
    }
    return true;
  }

  /** Находит блок, на котором стоит персонаж */
  findBlockUnder(pos, boxes) {
    if (!boxes) return null;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.max.y <= 0.2 || b.min.y < -0.1 || b.min.y > 4.5) continue;
      if (
        pos.x >= b.min.x - 0.5 &&
        pos.x <= b.max.x + 0.5 &&
        pos.z >= b.min.z - 0.5 &&
        pos.z <= b.max.z + 0.5 &&
        pos.y >= b.max.y - 0.5 &&
        pos.y <= b.max.y + 0.8
      ) {
        return b;
      }
    }
    return null;
  }

  /** Ограничение позиции внутри границ уровня */
  clampToArena(pos, radius = CONFIG.enemies.mutant.hitboxRadius, world = null) {
    const half = (world && world.rooms && world.rooms.length > 0)
      ? (CONFIG.level.gridSize * CONFIG.level.cellSize) / 2
      : CONFIG.world.roomSize / 2;
    const margin = radius + 0.05;
    pos.x = Math.max(-half + margin, Math.min(half - margin, pos.x));
    pos.z = Math.max(-half + margin, Math.min(half - margin, pos.z));
  }

  /**
   * Комната, за пределы которой мутант выходить не должен: комната его арены
   * или (для отладочного спавна) ближайшая комната на момент первого вызова.
   */
  getBoundRoom(world) {
    if (this.arena && this.arena.room) return this.arena.room;
    if (this.boundRoom) return this.boundRoom;
    const room = world && world.getRoomAt ? world.getRoomAt(this.pos) : null;
    if (room) this.boundRoom = room;
    return room;
  }

  /**
   * Удержать точку внутри комнаты. Стены комнаты — граница: мутант не может
   * ни прыжком, ни обычным движением оказаться за стеной или в коридоре.
   * @param {THREE.Vector3} pos
   * @param {number} radius
   * @param {Object|null} room
   */
  clampToRoom(pos, radius = CONFIG.enemies.mutant.hitboxRadius, room = null) {
    if (!room) return;
    const b = room.bounds;
    const margin = radius + 0.05;
    pos.x = Math.max(b.min.x + margin, Math.min(b.max.x - margin, pos.x));
    pos.z = Math.max(b.min.z + margin, Math.min(b.max.z - margin, pos.z));
  }

  /** Корректировка точки приземления прыжка: удержание внутри арены и вне стен блоков */
  clampLandingPos(targetPos, boxes, radius, room = null) {
    this.clampToArena(targetPos, radius);
    this.clampToRoom(targetPos, radius, room);
    for (const b of boxes) {
      if (
        targetPos.x + radius > b.min.x &&
        targetPos.x - radius < b.max.x &&
        targetPos.z + radius > b.min.z &&
        targetPos.z - radius < b.max.z
      ) {
        // Если игрок стоит на блоке сверху, мутант может приземлиться на блок
        if (targetPos.y >= b.max.y - 0.2) {
          targetPos.y = b.max.y;
        } else {
          // Игрок на земле рядом со стеной/блоком: выталкиваем точку приземления из препятствия
          const cx = (b.min.x + b.max.x) / 2;
          const cz = (b.min.z + b.max.z) / 2;
          const overlapX = (b.max.x - b.min.x) / 2 + radius - Math.abs(targetPos.x - cx);
          const overlapZ = (b.max.z - b.min.z) / 2 + radius - Math.abs(targetPos.z - cz);
          if (overlapX < overlapZ) {
            targetPos.x = targetPos.x < cx ? b.min.x - radius - 0.05 : b.max.x + radius + 0.05;
          } else {
            targetPos.z = targetPos.z < cz ? b.min.z - radius - 0.05 : b.max.z + radius + 0.05;
          }
          this.clampToArena(targetPos, radius);
          this.clampToRoom(targetPos, radius, room);
        }
      }
    }
    // Финальная страховка: точка приземления всегда внутри комнаты
    this.clampToRoom(targetPos, radius, room);
  }

  /** Физика перемещения с учётом размеров мутанта */
  move(dt, world) {
    const C = CONFIG.enemies.mutant;
    const boxes = world && world.getNearbyBoxes ? world.getNearbyBoxes(this.pos) : (world ? world.boxes : []);

    this.pos.x += this.vel.x * dt;
    resolveBoxCollision(this.pos, this.vel, this.bodyRadius, C.hitboxHeight, boxes, "x", C.collisionEps);

    this.pos.z += this.vel.z * dt;
    resolveBoxCollision(this.pos, this.vel, this.bodyRadius, C.hitboxHeight, boxes, "z", C.collisionEps);

    this.pos.y += this.vel.y * dt;
    resolveBoxCollision(this.pos, this.vel, this.bodyRadius, C.hitboxHeight, boxes, "y", C.collisionEps);

    // Держим мутанта внутри его комнаты: после расталкивания и коллизий он
    // не должен оказаться за стеной или в коридоре.
    this.clampToRoom(this.pos, this.bodyRadius, this.getBoundRoom(world));

    // Гарантия нахождения внутри границ уровня
    this.clampToArena(this.pos, this.bodyRadius, world);
  }

  /** Волна пыли от удара по земле */
  spawnSlamDust(fx) {
    if (!fx.particles) return;
    const p = fx.particles;
    for (let i = 0; i < 18; i++) {
      const ang = (i / 18) * Math.PI * 2 + rnd(0.2);
      const spd = 4 + Math.random() * 5;
      p.spawn(
        this.pos.x, this.pos.y + 0.15, this.pos.z,
        Math.cos(ang) * spd, 1.5 + Math.random() * 2, Math.sin(ang) * spd,
        0x998866, 0.15 + Math.random() * 0.1, 0.5 + Math.random() * 0.3, 8, 1.5
      );
    }
  }

  update(dt, player, world, allEnemies, game, fx) {
    if (!this.alive) return;
    const C = CONFIG.enemies.mutant;

    if (this.flashT > 0 && (this.flashT -= dt) <= 0) this.setFlash(false);

    const toPlayer = this._toPlayer.set(player.pos.x - this.pos.x, 0, player.pos.z - this.pos.z);
    const horizDist = toPlayer.length();
    const dirToPlayer = this._dirToPlayer;
    if (horizDist > 1e-4) {
      dirToPlayer.copy(toPlayer).multiplyScalar(1 / horizDist);
    } else {
      dirToPlayer.set(0, 0, 1);
    }
    const heightDiff = Math.abs(player.pos.y - this.pos.y);
    const playerBoxes = world.getNearbyBoxes ? world.getNearbyBoxes(player.pos) : world.boxes;

    // Обновление кулдаунов
    if (this.leapCd > 0) this.leapCd -= dt;
    if (this.slamCd > 0) this.slamCd -= dt;

    // Анимация кольца удара
    if (this.slamRing.visible) {
      this.slamRingT += dt;
      const ringProg = this.slamRingT / 0.5;
      if (ringProg >= 1) {
        this.slamRing.visible = false;
      } else {
        const scale = 1 + ringProg * 4;
        this.slamRing.scale.set(scale, scale, 1);
        this.slamRing.material.opacity = 0.6 * (1 - ringProg);
      }
    }

    // === 0. Состояние STUNNED (Оглушён для добивания) ===
    if (this.state === "stunned") {
      this.vel.x = 0;
      this.vel.z = 0;
      this.wobbleT += dt * 4;
      this.stunStars.visible = true;
      this.stunStars.rotation.y += dt * 4;

      // Мигает фиолетовым
      const isPurple = Math.sin(this.wobbleT * 12) > 0;
      const pc = isPurple ? 0xaa44ff : 0;
      this.skinMat.emissive.setHex(pc);
      this.bellyMat.emissive.setHex(pc);

      this.torso.rotation.z = Math.sin(this.wobbleT * 2) * 0.1;
      this.torso.rotation.x = 0.3;
      this.armR.rotation.x = -0.3;
      this.armL.rotation.x = -0.2;

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
        const pScale = 1.8 + Math.sin(Date.now() * 0.008) * 0.2;
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
        this.skinMat.emissive.setHex(baseCol);
        this.bellyMat.emissive.setHex(baseCol);
        this.torso.rotation.x = 0.15;
      }

      this.vel.y -= CONFIG.movement.gravity * dt;
      this.move(dt, world);
      this.group.position.copy(this.pos);
      this.updateHitboxes();
      return;
    } else {
      this.stunStars.visible = false;
      this.promptSprite.visible = false;
    }

    // === 1. Состояние IDLE ===
    if (this.state === "idle") {
      this.wobbleT += dt * 1.5;
      this.torso.rotation.z = Math.sin(this.wobbleT) * 0.04;
      // Мутант тяжело дышит
      this.torso.scale.z = 1 + Math.sin(this.wobbleT * 2) * 0.02;

      if (horizDist < C.aggroRange) {
        const origin = this._tmpOrigin.set(this.pos.x, this.pos.y + 1.8, this.pos.z);
        const playerEye = this._tmpTarget.set(player.pos.x, player.pos.y + 0.9, player.pos.z);
        const enemyBoxes = world.getNearbyBoxes ? world.getNearbyBoxes(this.pos) : world.boxes;
        if (this.hasLineOfSight(origin, playerEye, enemyBoxes)) {
          this.state = "chase";
        }
      }
    }

    // === 2. Состояние CHASE ===
    else if (this.state === "chase") {
      this.wobbleT += dt * 7;
      const yaw = Math.atan2(dirToPlayer.x, dirToPlayer.z);
      this.group.rotation.y = yaw;

      // Анимация бега
      this.torso.rotation.z = Math.sin(this.wobbleT) * 0.06;
      this.torso.rotation.x = 0.2; // горб при беге
      this.legL.rotation.x = Math.sin(this.wobbleT) * 0.4;
      this.legR.rotation.x = -Math.sin(this.wobbleT) * 0.4;
      this.armR.rotation.x = 0.15 + Math.sin(this.wobbleT) * 0.1;
      this.armL.rotation.x = 0.1 - Math.sin(this.wobbleT) * 0.08;

      const moveDir = this.steer(dirToPlayer, world);
      this.vel.x = moveDir.x * this.speed;
      this.vel.z = moveDir.z * this.speed;

      // Если мутант подошёл вплотную к игроку, не наползаем внутрь
      if (horizDist < 1.3) {
        this.vel.x = 0;
        this.vel.z = 0;
      }

      // Попытка прыжковой атаки (leap)
      if (
        horizDist >= C.leapMinDist &&
        horizDist <= C.leapMaxDist &&
        this.leapCd <= 0
      ) {
        const eyePos = this._tmpOrigin.set(this.pos.x, this.pos.y + 1.8, this.pos.z);
        const playerCenter = this._tmpTarget.set(player.pos.x, player.pos.y + 0.9, player.pos.z);
        // Игнорируем блок, на котором стоит игрок (чтобы мутант мог прыгнуть к кемперу)
        const playerBlock = this.findBlockUnder(player.pos, playerBoxes);
        if (this.hasLineOfSight(eyePos, playerCenter, playerBoxes, playerBlock)) {
          // Переход в состояние замаха прыжка
          this.state = "leap";
          this.leapT = 0;
          this.leapWindupT = 0;
          this.leapTargetPos.copy(player.pos); // запоминаем позицию игрока
          const landingBoxes = world.getNearbyBoxes ? world.getNearbyBoxes(this.leapTargetPos) : world.boxes;
          this.leapRoom = this.getBoundRoom(world);
          this.clampLandingPos(this.leapTargetPos, landingBoxes, this.bodyRadius, this.leapRoom);
          this.leapStartPos.copy(this.pos);
          this.vel.x = 0;
          this.vel.z = 0;

          // Расчёт дуги прыжка с учётом высоты цели
          const dx = this.leapTargetPos.x - this.pos.x;
          const dz = this.leapTargetPos.z - this.pos.z;
          const hDist = Math.hypot(dx, dz);
          this.leapDuration = Math.max(0.4, hDist / C.leapSpeed);
          this.leapPeakY = Math.max(
            this.pos.y + C.leapArcHeight,
            this.leapTargetPos.y + C.leapArcHeight * 0.5
          );

          this.leapGlow.visible = true;
          this.leapGlowMat.opacity = 0;
        }
      }

      // Попытка удара по земле (slam) — ближний бой
      if (
        horizDist <= C.slamRange &&
        heightDiff <= CONFIG.enemies.meleeMaxHeightDiff &&
        this.slamCd <= 0
      ) {
        this.state = "slam";
        this.slamT = 0;
        this.slamExecuted = false;
        this.vel.x = 0;
        this.vel.z = 0;
      }
    }

    // === 3. Состояние LEAP (прыжковая атака) ===
    else if (this.state === "leap") {
      this.leapT += dt;

      // Фаза 1: замах (приседание + красное свечение)
      if (this.leapT <= C.leapWindup) {
        this.leapWindupT = this.leapT;
        const wp = this.leapT / C.leapWindup;
        this.vel.x = 0;
        this.vel.z = 0;

        // Приседание
        this.torso.position.y = (1.1 * 1.5) - wp * 0.4;
        this.torso.rotation.x = 0.15 + wp * 0.3;
        this.legL.rotation.x = wp * 0.5;
        this.legR.rotation.x = wp * 0.5;

        // Руку-молот заносит назад
        this.armR.rotation.x = -wp * 1.5;
        this.armL.rotation.x = wp * 0.3;

        // Красное свечение нарастает
        this.leapGlowMat.opacity = wp * 0.5;
        this.skinMat.emissive.setHex(Math.floor(wp * 0.4 * 255) << 16);

        // Смотрим на игрока
        this.group.rotation.y = Math.atan2(dirToPlayer.x, dirToPlayer.z);
      }

      // Фаза 2: полёт по дуге
      else {
        this.leapGlow.visible = false;
        const isPsx = (CONFIG.graphics && CONFIG.graphics.styleName) !== "cartoon";
        this.skinMat.emissive.setHex(isPsx ? 0x141414 : 0);

        const flightT = this.leapT - C.leapWindup;
        const t = Math.min(1, flightT / this.leapDuration);

        // Интерполяция по дуге (параболическая)
        const startY = this.leapStartPos.y;
        const endY = this.leapTargetPos.y;
        const midY = this.leapPeakY;
        // Парабола через 3 точки: start, peak (t=0.5), end
        const arcY = startY * (1 - t) * (1 - 2 * t) + midY * 4 * t * (1 - t) + endY * t * (2 * t - 1);

        this.pos.x = this.leapStartPos.x + (this.leapTargetPos.x - this.leapStartPos.x) * t;
        this.pos.z = this.leapStartPos.z + (this.leapTargetPos.z - this.leapStartPos.z) * t;
        this.pos.y = arcY;

        // В полёте строго удерживаем мутанта в пределах его комнаты:
        // траектория не должна уходить за стены даже на низком FPS
        const leapRoom = this.leapRoom || this.getBoundRoom(world);
        const R = this.bodyRadius;
        this.clampToRoom(this.pos, R, leapRoom);

        // Проверка столкновения со стенами/блоками во время полёта по дуге
        const leapBoxes = world.getNearbyBoxes ? world.getNearbyBoxes(this.pos) : world.boxes;
        for (const b of leapBoxes) {
          if (
            this.pos.x + R > b.min.x &&
            this.pos.x - R < b.max.x &&
            this.pos.z + R > b.min.z &&
            this.pos.z - R < b.max.z &&
            this.pos.y + C.hitboxHeight > b.min.y &&
            this.pos.y < b.max.y
          ) {
            const cx = (b.min.x + b.max.x) / 2;
            const cz = (b.min.z + b.max.z) / 2;
            const overlapX = (b.max.x - b.min.x) / 2 + R - Math.abs(this.pos.x - cx);
            const overlapZ = (b.max.z - b.min.z) / 2 + R - Math.abs(this.pos.z - cz);
            if (overlapX < overlapZ) {
              this.pos.x = this.pos.x < cx ? b.min.x - R - 0.05 : b.max.x + R + 0.05;
            } else {
              this.pos.z = this.pos.z < cz ? b.min.z - R - 0.05 : b.max.z + R + 0.05;
            }
            this.clampToRoom(this.pos, R, leapRoom);
          }
        }
        // Страховка после выталкивания из блоков
        this.clampToRoom(this.pos, R, leapRoom);

        // Анимация полёта — руку-молот вытягивает вперёд
        this.torso.position.y = 1.1 * 1.5;
        this.torso.rotation.x = -0.3 + t * 0.5;
        this.armR.rotation.x = 1.5 - t * 2.0;
        this.legL.rotation.x = -0.5 + t * 0.8;
        this.legR.rotation.x = 0.3 - t * 0.5;

        this.group.rotation.y = Math.atan2(
          this.leapTargetPos.x - this.leapStartPos.x,
          this.leapTargetPos.z - this.leapStartPos.z
        );

        // Приземление
        if (t >= 1) {
          this.pos.x = this.leapTargetPos.x;
          this.pos.z = this.leapTargetPos.z;
          this.clampToRoom(this.pos, R, leapRoom);

          // Проверяем коллизии при приземлении
          this.vel.set(0, -2, 0);
          this.move(0.01, world);
          this.clampToRoom(this.pos, R, leapRoom);

          // Урон при приземлении
          const landDist = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
          const landHeightDiff = Math.abs(player.pos.y - this.pos.y);
          if (landDist <= C.leapDamageRadius && landHeightDiff <= 2) {
            player.takeDamage(C.leapDamage, this.pos, game);
          }

          // Эффект приземления — пыль
          if (fx) this.spawnSlamDust(fx);

          this.leapCd = C.leapCooldown;
          this.state = "chase";
          this.torso.position.y = 1.1 * 1.5;
          this.torso.rotation.x = 0.15;
          this.armR.rotation.x = 0;
        }
      }

      // Во время прыжка обновляем позицию группы
      this.group.position.copy(this.pos);
      this.updateHitboxes();
      return;
    }

    // === 4. Состояние SLAM (удар по земле) ===
    else if (this.state === "slam") {
      this.slamT += dt;
      this.vel.x *= 0.3;
      this.vel.z *= 0.3;
      this.group.rotation.y = Math.atan2(dirToPlayer.x, dirToPlayer.z);

      const windupProg = Math.min(1, this.slamT / C.slamWindup);

      // Замах — поднимает руку-молот вверх
      this.armR.rotation.x = -windupProg * 2.2;
      this.torso.rotation.x = 0.15 - windupProg * 0.25;
      this.armL.rotation.x = windupProg * 0.4;

      // Момент удара
      if (this.slamT >= C.slamWindup && !this.slamExecuted) {
        this.slamExecuted = true;

        // Быстро опускает руку
        this.armR.rotation.x = 1.5;
        this.torso.rotation.x = 0.4;

        // AoE-урон в радиусе slamRadius
        const slamDist = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
        if (slamDist <= C.slamRadius && heightDiff <= CONFIG.enemies.meleeMaxHeightDiff) {
          player.takeDamage(C.slamDamage, this.pos, game);
          // Отбрасывание игрока
          const pushDir = new THREE.Vector3(
            player.pos.x - this.pos.x,
            0.5,
            player.pos.z - this.pos.z
          );
          if (pushDir.lengthSq() < 1e-4) pushDir.set(0, 0.5, 1);
          pushDir.normalize();
          player.vel.addScaledVector(pushDir, C.slamKnockback);
        }

        // Визуальные эффекты: пыль + кольцо
        if (fx) this.spawnSlamDust(fx);
        this.slamRing.position.set(this.pos.x, this.pos.y + 0.05, this.pos.z);
        this.slamRing.visible = true;
        this.slamRingT = 0;
        this.slamRing.scale.set(1, 1, 1);
        this.slamRing.material.opacity = 0.6;
      }

      // Восстановление после удара
      if (this.slamT >= C.slamWindup + C.slamRecovery) {
        this.slamCd = C.slamCooldown;
        this.state = "chase";
        this.armR.rotation.x = 0;
        this.torso.rotation.x = 0.15;
      }
    }

    // === 5. Состояние STAGGER ===
    else if (this.state === "stagger") {
      this.staggerT -= dt;
      this.armR.rotation.x = 0.5;
      this.armL.rotation.x = 0.4;
      this.torso.rotation.x = -0.2;
      if (this.staggerT <= 0) {
        this.torso.rotation.x = 0.15;
        this.state = "chase";
      }
    }

    // Расталкивание между всеми врагами
    const sepDist = C.separationDist;
    const sepForce = C.separationPushForce;
    for (let i = 0; i < allEnemies.length; i++) {
      const other = allEnemies[i];
      if (other === this || !other.alive) continue;
      const dx = this.pos.x - other.pos.x;
      const dz = this.pos.z - other.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < sepDist && d > 1e-4) {
        const pushForce = (sepDist - d) * sepForce * dt;
        this.pos.x += (dx / d) * pushForce;
        this.pos.z += (dz / d) * pushForce;
      }
    }

    this.vel.y -= CONFIG.movement.gravity * dt;
    this.move(dt, world);
    this.group.position.copy(this.pos);
    this.updateHitboxes();
  }

  destroy() {
    if (this._destroyed) return;
    super.destroy();
    // Кольцо удара живёт отдельным объектом сцены — освобождаем его ресурсы
    if (this.slamRing) {
      this.scene.remove(this.slamRing);
      if (this.slamRing.geometry) this.slamRing.geometry.dispose();
      if (this.slamRing.material) this.slamRing.material.dispose();
    }
  }
}
