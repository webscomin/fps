// Взрывные бочки арен: модель из barrel.glb, размещение по сиду, урон, взрыв и цепная реакция
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { Rng } from "../core/Rng.js";
import { getNodeClone } from "../core/ModelCache.js";
import { disposeObject3D, rnd } from "../core/Physics.js";

const BARREL_HEIGHT = 1.2;
const BARREL_HALF = 0.45;       // AABB 0.9 x 1.2 x 0.9
const WALL_MARGIN = 1.05;       // центр бочки от внутренней стены
const DOOR_CLEARANCE = 4.5;     // до центра дверного проёма
const TIER_CLEARANCE = 3.0;     // до ярусов/платформ/рамп
const COVER_GAP = 0.55;         // минимальный зазор до низких укрытий
const CENTER_CLEARANCE = 5.6;   // свободный радиус 5 м + радиус бочки
const BARREL_SPACING = 0.95;    // бочки в группе вплотную, но без пересечения
const SMOKE_INTERVAL = 0.16;

/**
 * Одна взрывная бочка.
 */
export class ExplosiveBarrel {
  /**
   * @param {BarrelManager} manager
   * @param {number} x
   * @param {number} z
   * @param {Object} [opts]
   * @param {Object} [opts.room]
   * @param {Object} [opts.arena]
   * @param {number} [opts.rotation]
   */
  constructor(manager, x, z, opts = {}) {
    this.manager = manager;
    this.game = manager.game;
    this.room = opts.room || null;
    this.arena = opts.arena || null;

    this.pos = new THREE.Vector3(x, 0, z);
    this.hitRadius = BARREL_HALF;
    this.hitHeight = BARREL_HEIGHT;

    const cfg = CONFIG.barrels || {};
    this.maxHp = cfg.health ?? 30;
    this.hp = this.maxHp;
    this.alive = true;
    this.chainTimer = 0;
    this.visualT = 0;
    this.smokeT = 0;
    this.modelRadius = BARREL_HALF;
    this.baseMaterial = null;
    this.blinkMaterial = null;
    this.usingFallback = false;

    this.group = new THREE.Group();
    this.group.position.copy(this.pos);
    this.group.rotation.y = opts.rotation || 0;

    this._buildModel();
    // Группа бочек живёт отдельно от room.group (чтобы Room.destroy не удалил общую геометрию),
    // видимость синхронизируется с видимостью комнаты в BarrelManager.update()
    this.manager.root.add(this.group);

    // Коллайдер: общая физика игрока и врагов (лучи его пропускают — есть цилиндр)
    this.box = {
      min: new THREE.Vector3(x - BARREL_HALF, 0, z - BARREL_HALF),
      max: new THREE.Vector3(x + BARREL_HALF, BARREL_HEIGHT, z + BARREL_HALF),
      isObstacle: true,
      isBarrel: true,
      barrel: this
    };
    if (this.room && this.room.boxes) this.room.boxes.push(this.box);
    if (this.game.world && this.game.world.boxes) this.game.world.boxes.push(this.box);
  }

  /** Модель бочки: только нужный узел barrel.glb или процедурный запасной вариант. @private */
  _buildModel() {
    const cfg = CONFIG.barrels || {};
    const color = cfg.color || "Red";
    const res = String(cfg.model || "high").toLowerCase() === "low" ? "Low" : "High";
    const nodeName = `${color}_Barrel_${res}`;

    const node = getNodeClone("barrel", nodeName);
    if (node) {
      // У узлов barrel.glb есть собственный масштаб/матрица — учитываем их,
      // домножая масштаб, а не заменяя его.
      const initial = new THREE.Box3().setFromObject(node);
      const size = initial.getSize(new THREE.Vector3());
      const factor = size.y > 1e-6 ? BARREL_HEIGHT / size.y : 1;
      node.scale.multiplyScalar(factor);
      node.updateMatrixWorld(true);

      // Основание на y=0, центр XZ в нуле
      const scaled = new THREE.Box3().setFromObject(node);
      const center = scaled.getCenter(new THREE.Vector3());
      node.position.x -= center.x;
      node.position.z -= center.z;
      node.position.y -= scaled.min.y;
      node.updateMatrixWorld(true);

      const finalBox = new THREE.Box3().setFromObject(node);
      const finalSize = finalBox.getSize(new THREE.Vector3());
      this.modelRadius = Math.max(finalSize.x, finalSize.z) * 0.5;

      this.baseMaterial = node.material;
      this.material = node.material;
      this.mesh = node;
      this.usingFallback = false;
      this.group.add(node);
      this.manager.reportModelSize(this.modelRadius, nodeName);
      return;
    }

    // Запасная бочка: цилиндр 1.2 м, радиус 0.45, красно-коричневый материал
    const geo = this.manager.fallbackGeometry();
    const mat = this.manager.fallbackMaterial();
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = BARREL_HEIGHT / 2;
    this.modelRadius = 0.45;
    this.baseMaterial = mat;
    this.material = mat;
    this.usingFallback = true;
    this.group.add(this.mesh);
    if (this.manager.modelsReady) this.manager.warnFallbackOnce();
  }

  /**
   * Заменить запасную модель настоящей, когда barrel.glb догрузится.
   * (Уровень строится раньше, чем завершается initAllModels.)
   */
  rebuildModel() {
    if (!this.usingFallback || !this.alive) return;
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh = null;
    }
    this.blinkMaterial = null;
    this.material = null;
    this.baseMaterial = null;
    this._buildModel();
  }

  /**
   * Получить урон. При 0 HP бочка взрывается.
   * @param {number} dmg
   * @returns {boolean} взорвалась ли бочка
   */
  takeDamage(dmg) {
    if (!this.alive || dmg <= 0) return false;
    this.hp -= dmg;
    if (this.hp <= 0) {
      this.explode();
      return true;
    }
    // Ниже 50% HP — мигание и дым (материал клонируется только у этой бочки)
    if (this.hp <= this.maxHp * 0.5) this._ensureBlinkMaterial();
    return false;
  }

  /** @private */
  _ensureBlinkMaterial() {
    if (this.blinkMaterial || !this.baseMaterial) return;
    const mat = this.baseMaterial.clone();
    mat.userData.shared = false;
    if (this.baseMaterial.map) mat.map = this.baseMaterial.map;
    mat.emissive = new THREE.Color(0xff2a00);
    mat.emissiveIntensity = 0.35;
    this.blinkMaterial = mat;
    this.material = mat;
    if (this.mesh) this.mesh.material = mat;
  }

  /**
   * Визуальное обновление (только в активной арене): мигание и дым при < 50% HP.
   * @param {number} dt
   */
  updateVisual(dt) {
    this.visualT += dt;
    if (this.hp > this.maxHp * 0.5) return;

    this._ensureBlinkMaterial();
    if (this.blinkMaterial) {
      const k = 0.5 + 0.5 * Math.sin(this.visualT * 16);
      this.blinkMaterial.emissiveIntensity = 0.25 + 1.15 * k;
    }

    this.smokeT -= dt;
    if (this.smokeT <= 0) {
      this.smokeT = SMOKE_INTERVAL;
      const particles = this.game.particles;
      if (particles) {
        particles.spawn(
          this.pos.x + rnd(0.15),
          BARREL_HEIGHT * 0.95,
          this.pos.z + rnd(0.15),
          rnd(0.35),
          0.7 + Math.random() * 0.6,
          rnd(0.35),
          0x4a4740,
          0.11,
          0.5 + Math.random() * 0.3,
          -1.2,
          1.4
        );
      }
    }
  }

  /** Взрыв бочки: урон врагам и игроку, отбрасывание, эффекты и цепная реакция. */
  explode() {
    if (!this.alive) return;
    this.alive = false;
    this.chainTimer = 0;

    const cfg = CONFIG.barrels || {};
    const R = cfg.radius ?? 5;
    const pt = new THREE.Vector3(this.pos.x, this.pos.y + 0.6, this.pos.z);

    this._playEffects(pt, R, cfg);
    this._damageEnemies(pt, R, cfg);
    this._damagePlayer(pt, R, cfg);

    // Цепная реакция: соседние бочки взрываются с задержкой
    for (let i = 0; i < this.manager.list.length; i++) {
      const other = this.manager.list[i];
      if (other === this || !other.alive) continue;
      const d = Math.hypot(other.pos.x - this.pos.x, other.pos.z - this.pos.z);
      if (d <= R) this.manager.scheduleChain(other, cfg.chainDelay ?? 0.15);
    }

    this.dispose();
  }

  /** @private */
  _playEffects(pt, R, cfg) {
    const game = this.game;
    const fx = game.fx;
    if (fx && fx.explosion) fx.explosion(pt);
    if (game.gore && game.gore.shockwave) {
      game.gore.shockwave(pt, R, cfg.flashDuration ?? 0.28);
    }
    if (game.particles) {
      game.particles.rocketSmoke(pt, 18);
      game.particles.sparks(pt, new THREE.Vector3(0, 1, 0), 0xffb347, 20);
    }
    if (game.gore && game.gore.spawnGibs) {
      game.gore.spawnGibs(pt, 12, [0x7a2f22, 0x4a2320, 0xb04a2a, 0x8a3a2a], false);
    }
    if (game.audio) game.audio.play("barrel_explosion");
  }

  /** @private */
  _damageEnemies(pt, R, cfg) {
    const list = this.game.enemyManager ? this.game.enemyManager.zombies : [];
    const center = new THREE.Vector3();
    const push = new THREE.Vector3();
    const rocket = CONFIG.weapons.rocket;

    for (let i = 0; i < list.length; i++) {
      const enemy = list[i];
      if (!enemy || !enemy.alive) continue;
      center.set(enemy.pos.x, enemy.pos.y + 0.8, enemy.pos.z);
      const d = center.distanceTo(pt);
      if (d >= R) continue;

      const falloff = 1 - d / R;
      const dmg = Math.round((cfg.damageEnemies ?? 80) * falloff);
      if (dmg <= 0) continue;

      push.copy(center).sub(pt);
      if (push.lengthSq() < 1e-6) push.set(0, 1, 0);
      else push.normalize();
      push.multiplyScalar((rocket.pushEnemy ?? 26) * falloff);

      this.game.damageZombie(enemy, dmg, false, push, {
        weapon: "barrel",
        isExplosion: true
      });
    }
  }

  /** @private */
  _damagePlayer(pt, R, cfg) {
    const player = this.game.player;
    if (!player || player.isDead) return;

    const center = new THREE.Vector3(player.pos.x, player.pos.y + 0.9, player.pos.z);
    const d = center.distanceTo(pt);
    if (d >= R) return;

    const falloff = Math.max(0, 1 - d / R);
    const immune = !!(this.game.perks && this.game.perks.mods && this.game.perks.mods.barrelImmune);
    if (!immune) {
      player.takeDamage(cfg.damagePlayer ?? 20, pt, this.game);
    }

    // Отбрасывание как у взрыва ракеты
    const dir = center.clone().sub(pt);
    if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
    else dir.normalize();

    const rocket = CONFIG.weapons.rocket;
    const force = (rocket.jumpForce ?? 30) * falloff;
    if (dir.y > 0 && player.vel.y < 0) player.vel.y = 0;
    player.vel.addScaledVector(dir, force);
    if (force * dir.y > 2) player.onGround = false;

    player.addShake(0.02 + 0.09 * falloff, 0.35);
  }

  /** Убрать бочку из сцены и коллизий. */
  dispose() {
    if (this.group) {
      if (this.group.parent) this.group.parent.remove(this.group);
      disposeObject3D(this.group);
      this.group = null;
    }
    this.mesh = null;
    this.manager.removeCollider(this);
  }
}

/**
 * Менеджер бочек: размещение на аренах, обновление, взрывы и цепная реакция.
 */
export class BarrelManager {
  /**
   * @param {Object} game
   */
  constructor(game) {
    this.game = game;
    this.list = [];

    // Общая группа бочек в сцене (не внутри room.group — общие ресурсы не должны удаляться)
    this.root = new THREE.Group();
    this.root.name = "BarrelsRoot";
    game.scene.add(this.root);

    this._fallbackGeo = null;
    this._fallbackMat = null;
    this._fallbackWarned = false;
    this._modelLogged = false;
    this.modelsReady = false;
  }

  /**
   * Вызывается, когда initAllModels() завершился: заменяем запасные бочки
   * настоящей моделью (уровень строится раньше загрузки моделей).
   */
  onModelsReady() {
    this.modelsReady = true;
    for (let i = 0; i < this.list.length; i++) {
      const barrel = this.list[i];
      if (barrel.alive && barrel.usingFallback) barrel.rebuildModel();
    }
    if (this.list.some((b) => b.alive && b.usingFallback)) this.warnFallbackOnce();
  }

  /** Очистка при загрузке нового уровня. */
  reset() {
    for (let i = 0; i < this.list.length; i++) {
      const barrel = this.list[i];
      barrel.alive = false;
      barrel.box = null;
      if (barrel.group) {
        if (barrel.group.parent) barrel.group.parent.remove(barrel.group);
        disposeObject3D(barrel.group);
        barrel.group = null;
      }
    }
    this.list.length = 0;
  }

  /**
   * Расставить бочки на арене по сиду уровня.
   * @param {Object} room
   * @param {Object} arena
   */
  populateArena(room, arena) {
    if (!room || !Array.isArray(room.blocks)) return;

    const cfg = CONFIG.barrels || {};
    const wanted = Math.max(4, Math.min(8, Math.round(cfg.perArena ?? 6)));
    const seed = `${this.game.world ? this.game.world.seed : "seed"}:barrels:${room.id}`;
    const rng = new Rng(seed);

    const anchors = this._collectAnchors(room, rng);
    const placed = [];
    const created = [];
    let index = 0;

    while (created.length < wanted && index < anchors.length) {
      const anchor = anchors[index++];
      if (!this._isSpotFree(anchor.x, anchor.z, placed, BARREL_SPACING)) continue;

      const remaining = wanted - created.length;
      const groupSize = this._rollGroupSize(rng, remaining);
      const positions = this._buildGroup(anchor, groupSize, room, placed, rng);

      for (let i = 0; i < positions.length; i++) {
        const p = positions[i];
        const barrel = new ExplosiveBarrel(this, p.x, p.z, {
          room,
          arena,
          rotation: rng.range(0, Math.PI * 2)
        });
        created.push(barrel);
        placed.push(p);
        this.list.push(barrel);
      }
    }

    if (created.length < 4) {
      console.warn(
        `[Barrels] Арена ${room.id} (${room.arenaTemplate || "?"}): размещено только ${created.length} бочек из ${wanted}`
      );
    }
  }

  /**
   * Отладочный спавн бочки в 5 м перед игроком.
   * @param {number} [distance]
   * @returns {ExplosiveBarrel|null}
   */
  spawnInFrontOfPlayer(distance = 5) {
    const player = this.game.player;
    if (!player) return null;

    const fx = -Math.sin(player.yaw);
    const fz = -Math.cos(player.yaw);
    let x = player.pos.x + fx * distance;
    let z = player.pos.z + fz * distance;

    const world = this.game.world;
    const room = (world && world.getRoomAt ? world.getRoomAt(new THREE.Vector3(x, 0, z)) : null) ||
      (world && world.getRoomAt ? world.getRoomAt(player.pos) : null);

    if (room) {
      const b = room.bounds;
      x = Math.max(b.min.x + WALL_MARGIN, Math.min(b.max.x - WALL_MARGIN, x));
      z = Math.max(b.min.z + WALL_MARGIN, Math.min(b.max.z - WALL_MARGIN, z));
    }

    let arena = null;
    const arenas = this.game.levelManager ? this.game.levelManager.arenas : null;
    if (arenas) arena = arenas.find((a) => a.room === room) || null;

    const barrel = new ExplosiveBarrel(this, x, z, {
      room,
      arena,
      rotation: Math.random() * Math.PI * 2
    });
    this.list.push(barrel);

    if (world && world.rebuildBoxCache) world.rebuildBoxCache();
    return barrel;
  }

  /**
   * Урон бочке от внешнего источника.
   * @param {ExplosiveBarrel} barrel
   * @param {number} dmg
   * @returns {boolean}
   */
  damage(barrel, dmg) {
    if (!barrel || !barrel.alive) return false;
    return barrel.takeDamage(dmg);
  }

  /**
   * Запланировать цепной взрыв.
   * @param {ExplosiveBarrel} barrel
   * @param {number} [delay]
   */
  scheduleChain(barrel, delay) {
    if (!barrel || !barrel.alive) return;
    if (barrel.chainTimer > 0) return;
    const d = delay !== undefined ? delay : (CONFIG.barrels.chainDelay ?? 0.15);
    barrel.chainTimer = Math.max(0.01, d);
  }

  /**
   * Обновление бочек: цепные таймеры и визуал (только активная арена).
   * @param {number} dt
   */
  update(dt) {
    for (let i = 0; i < this.list.length; i++) {
      const barrel = this.list[i];
      if (!barrel.alive) continue;

      // Видимость бочек всегда следует за видимостью комнаты
      if (barrel.group) {
        barrel.group.visible = barrel.room ? !!barrel.room.group.visible : true;
      }

      if (barrel.chainTimer > 0) {
        barrel.chainTimer -= dt;
        if (barrel.chainTimer <= 0) {
          barrel.chainTimer = 0;
          barrel.explode();
          continue;
        }
      }

      // Бочки не анимируются вне активной арены и в невидимых комнатах
      if (barrel.arena && barrel.arena.state !== "active") continue;
      if (barrel.room && !barrel.room.group.visible) continue;
      barrel.updateVisual(dt);
    }
  }

  /**
   * Убрать коллайдер бочки и перестроить кэш.
   * @param {ExplosiveBarrel} barrel
   */
  removeCollider(barrel) {
    const box = barrel.box;
    if (!box) return;
    barrel.box = null;

    if (barrel.room && barrel.room.boxes) {
      const i = barrel.room.boxes.indexOf(box);
      if (i !== -1) barrel.room.boxes.splice(i, 1);
    }
    const world = this.game.world;
    if (world && world.boxes) {
      const j = world.boxes.indexOf(box);
      if (j !== -1) world.boxes.splice(j, 1);
    }
    if (world && world.rebuildBoxCache) world.rebuildBoxCache();
  }

  /**
   * Лог фактического размера модели (один раз).
   * @param {number} radius
   * @param {string} nodeName
   */
  reportModelSize(radius, nodeName) {
    if (this._modelLogged) return;
    this._modelLogged = true;
    console.info(
      `[Barrels] модель "${nodeName}": высота 1.20 м, радиус по Box3 ≈ ${radius.toFixed(2)} м`
    );
    if (radius > 0.55 || radius < 0.35) {
      console.warn(`[Barrels] Радиус модели ${radius.toFixed(2)} м вне диапазона 0.35–0.55 м (оставлен как есть).`);
    }
  }

  /** @returns {THREE.CylinderGeometry} */
  fallbackGeometry() {
    if (!this._fallbackGeo) {
      this._fallbackGeo = new THREE.CylinderGeometry(0.45, 0.45, BARREL_HEIGHT, 12);
      this._fallbackGeo.userData.shared = true;
    }
    return this._fallbackGeo;
  }

  /** @returns {THREE.MeshLambertMaterial} */
  fallbackMaterial() {
    if (!this._fallbackMat) {
      this._fallbackMat = new THREE.MeshLambertMaterial({ color: 0x7a3020 });
      this._fallbackMat.userData.shared = true;
    }
    return this._fallbackMat;
  }

  warnFallbackOnce() {
    if (this._fallbackWarned) return;
    this._fallbackWarned = true;
    console.warn("[Barrels] 3D-модель бочки недоступна — используется запасная цилиндрическая бочка.");
  }

  // ────────────────────────────── Размещение ──────────────────────────────

  /** @private */
  _rollGroupSize(rng, remaining) {
    if (remaining <= 1) return 1;
    const r = rng.next();
    if (remaining >= 3 && r < 0.35) return 3;
    if (r < 0.75) return 2;
    return 1;
  }

  /** @private */
  _buildGroup(anchor, size, room, placed, rng) {
    const positions = [{ x: anchor.x, z: anchor.z }];
    if (size <= 1) return positions;

    const dirs = [
      { x: 1, z: 0 },
      { x: -1, z: 0 },
      { x: 0, z: 1 },
      { x: 0, z: -1 }
    ];
    const start = rng.rangeInt(0, 3);

    for (let step = 1; step < size; step++) {
      let found = null;
      for (let k = 0; k < 4; k++) {
        const dir = dirs[(start + k) % 4];
        const x = anchor.x + dir.x * BARREL_SPACING * step;
        const z = anchor.z + dir.z * BARREL_SPACING * step;
        if (!this._isSpotValid(x, z, room)) continue;
        if (!this._isSpotFree(x, z, placed, BARREL_SPACING)) continue;
        if (!this._isSpotFree(x, z, positions, BARREL_SPACING)) continue;
        found = { x, z };
        break;
      }
      if (!found) break;
      positions.push(found);
    }
    return positions;
  }

  /** @private */
  _collectAnchors(room, rng) {
    const walls = [];
    const covers = [];
    const grid = [];
    const b = room.bounds;

    // 1. Вдоль стен
    const inset = WALL_MARGIN;
    const step = 1.5;
    const x0 = b.min.x + 1.2;
    const x1 = b.max.x - 1.2;
    const z0 = b.min.z + 1.2;
    const z1 = b.max.z - 1.2;
    for (let x = x0; x <= x1; x += step) {
      const jx = x + rng.range(-0.3, 0.3);
      walls.push({ x: jx, z: b.min.z + inset });
      walls.push({ x: jx, z: b.max.z - inset });
    }
    for (let z = z0; z <= z1; z += step) {
      const jz = z + rng.range(-0.3, 0.3);
      walls.push({ x: b.min.x + inset, z: jz });
      walls.push({ x: b.max.x - inset, z: jz });
    }

    // 2. У низких укрытий (kind === "block"); ярусы пропускаем — у них свои 3 м
    for (let i = 0; i < room.blocks.length; i++) {
      const blk = room.blocks[i];
      if (this._isTier(blk)) continue;

      const offset = 1.1;
      const ex = blk.w / 2 + offset;
      const ez = blk.d / 2 + offset;
      const spanX = Math.max(0, blk.w / 2 - 0.6);
      const spanZ = Math.max(0, blk.d / 2 - 0.6);

      for (let t = -spanX; t <= spanX; t += 1.6) {
        covers.push({ x: blk.x + t, z: blk.z - ez });
        covers.push({ x: blk.x + t, z: blk.z + ez });
      }
      for (let t = -spanZ; t <= spanZ; t += 1.6) {
        covers.push({ x: blk.x - ex, z: blk.z + t });
        covers.push({ x: blk.x + ex, z: blk.z + t });
      }
    }

    // 3. Сетка-резерв
    for (let x = b.min.x + WALL_MARGIN + 0.6; x <= b.max.x - WALL_MARGIN - 0.6; x += 1.6) {
      for (let z = b.min.z + WALL_MARGIN + 0.6; z <= b.max.z - WALL_MARGIN - 0.6; z += 1.6) {
        grid.push({ x, z });
      }
    }

    const filter = (arr) => arr.filter((p) => this._isSpotValid(p.x, p.z, room));
    rng.shuffle(walls);
    rng.shuffle(covers);
    rng.shuffle(grid);

    return [...filter(walls), ...filter(covers), ...filter(grid)];
  }

  /** @private */
  _isTier(block) {
    if (!block) return false;
    if (block.y >= 2.2) return true;
    return block.kind === "platform" || block.kind === "landmark" || block.kind === "bridge" || block.kind === "ramp";
  }

  /** @private */
  _gapToBlock(x, z, block) {
    const bx0 = block.x - block.w / 2;
    const bx1 = block.x + block.w / 2;
    const bz0 = block.z - block.d / 2;
    const bz1 = block.z + block.d / 2;
    const dx = Math.max(0, Math.max(bx0 - (x + BARREL_HALF), x - BARREL_HALF - bx1));
    const dz = Math.max(0, Math.max(bz0 - (z + BARREL_HALF), z - BARREL_HALF - bz1));
    return Math.hypot(dx, dz);
  }

  /** @private */
  _isSpotValid(x, z, room) {
    const b = room.bounds;

    // Внутри комнаты, с зазором от стен
    if (x < b.min.x + WALL_MARGIN || x > b.max.x - WALL_MARGIN) return false;
    if (z < b.min.z + WALL_MARGIN || z > b.max.z - WALL_MARGIN) return false;

    // Свободный центр 5 м
    if (Math.hypot(x - room.center.x, z - room.center.z) < CENTER_CLEARANCE) return false;

    // Двери
    for (const dir of ["north", "south", "west", "east"]) {
      if (!room.doors[dir]) continue;
      const doorX = dir === "west" ? b.min.x : dir === "east" ? b.max.x : room.center.x;
      const doorZ = dir === "north" ? b.min.z : dir === "south" ? b.max.z : room.center.z;
      if (Math.hypot(x - doorX, z - doorZ) < DOOR_CLEARANCE) return false;
    }

    // Блоки: ярусы — 3 м, низкие укрытия — без пересечения, не внутри блоков
    for (let i = 0; i < room.blocks.length; i++) {
      const blk = room.blocks[i];
      const gap = this._gapToBlock(x, z, blk);
      const minGap = this._isTier(blk) ? TIER_CLEARANCE : COVER_GAP;
      if (gap < minGap) return false;
    }

    // Яма
    if (room.pit) {
      const pit = room.pit;
      const px0 = pit.x - pit.w / 2;
      const px1 = pit.x + pit.w / 2;
      const pz0 = pit.z - pit.d / 2;
      const pz1 = pit.z + pit.d / 2;
      if (
        x + BARREL_HALF > px0 - 0.4 &&
        x - BARREL_HALF < px1 + 0.4 &&
        z + BARREL_HALF > pz0 - 0.4 &&
        z - BARREL_HALF < pz1 + 0.4
      ) {
        return false;
      }
    }

    return true;
  }

  /** @private */
  _isSpotFree(x, z, list, minDist) {
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (Math.hypot(x - p.x, z - p.z) < minDist - 1e-6) return false;
    }
    return true;
  }
}
