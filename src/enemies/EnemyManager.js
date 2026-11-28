// Менеджер врагов: спавн зомби, мутантов и роботов, пул снарядов врагов,
// безопасные точки спавна и обновление только врагов активных арен.
import { CONFIG } from "../config.js";
import { Zombie } from "./Zombie.js";
import { Mutant } from "./Mutant.js";
import { Robot } from "./Robot.js";
import { StrawReaper } from "./StrawReaper.js";
import { EnemyProjectiles } from "./EnemyProjectiles.js";

export class EnemyManager {
  /**
   * @param {THREE.Scene} scene
   * @param {Object} world
   * @param {Object} game
   */
  constructor(scene, world, game) {
    this.scene = scene;
    this.world = world;
    this.game = game;

    this.zombies = [];  // все активные враги (зомби, мутанты, роботы, пугала)
    this.mutants = [];  // мутанты
    this.robots = [];   // роботы
    this.reapers = [];  // пугала с серпом

    this.wave = 0;

    // Пул снарядов врагов (лазеры роботов)
    this.projectiles = new EnemyProjectiles(this.scene, this.game);
  }

  /**
   * Проверка, свободна ли точка от стен и препятствий комнаты (пол и потолок игнорируются)
   * @param {Object} room
   * @param {number} x
   * @param {number} z
   */
  isSpawnBlocked(room, x, z) {
    const pad = 0.6;
    for (let i = 0; i < room.boxes.length; i++) {
      const b = room.boxes[i];
      if (b.max.y <= 0.2 || b.min.y > 1.8) continue;
      if (
        x >= b.min.x - pad &&
        x <= b.max.x + pad &&
        z >= b.min.z - pad &&
        z <= b.max.z + pad
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Поиск безопасной точки спавна в комнате игрока (для отладочного спавна).
   * Арены используют собственные 8 точек по периметру (ArenaController).
   * @param {THREE.Vector3} playerPos
   * @param {boolean} isFlying
   */
  findSpawnPoint(playerPos, isFlying = false) {
    let room = null;
    if (this.world) {
      room = this.world.getRoomAt ? this.world.getRoomAt(playerPos) : null;
      if (!room) room = this.world.startRoom;
    }

    if (room) {
      const margin = 1.8;
      const halfW = Math.max(1.5, room.w / 2 - margin);
      const halfD = Math.max(1.5, room.d / 2 - margin);
      const minPlayerDist = Math.min(
        CONFIG.waves.minSpawnDistFromPlayer || 12,
        Math.max(3.0, Math.min(halfW, halfD) * 0.75)
      );
      const spawnY = isFlying
        ? CONFIG.waves.arenas.robotHeightMin + Math.random() * 2
        : 0;

      for (let attempts = 0; attempts < CONFIG.waves.maxSpawnAttempts; attempts++) {
        const rx = room.center.x + (Math.random() - 0.5) * 2 * halfW;
        const rz = room.center.z + (Math.random() - 0.5) * 2 * halfD;

        if (Math.hypot(rx - playerPos.x, rz - playerPos.z) < minPlayerDist) continue;
        if (this.isSpawnBlocked(room, rx, rz)) continue;

        return { x: rx, y: spawnY, z: rz };
      }

      // Запасной вариант: самая дальняя от игрока свободная точка на кольце внутри комнаты
      let best = null;
      let bestDist = -1;
      const ringR = Math.min(halfW, halfD);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const rx = room.center.x + Math.cos(a) * ringR;
        const rz = room.center.z + Math.sin(a) * ringR;
        if (this.isSpawnBlocked(room, rx, rz)) continue;
        const dist = Math.hypot(rx - playerPos.x, rz - playerPos.z);
        if (dist > bestDist) {
          bestDist = dist;
          best = { x: rx, z: rz };
        }
      }
      if (best) {
        return { x: best.x, y: spawnY, z: best.z };
      }

      // Крайний случай: точка в стороне от игрока относительно центра комнаты
      const away = Math.atan2(room.center.z - playerPos.z, room.center.x - playerPos.x);
      return {
        x: room.center.x + Math.cos(away) * ringR,
        y: spawnY,
        z: room.center.z + Math.sin(away) * ringR
      };
    }

    // Фоллбэк для одиночной комнаты
    const half = CONFIG.world.roomSize / 2 - CONFIG.waves.spawnMargin;
    const minPlayerDist = CONFIG.waves.minSpawnDistFromPlayer || 12;

    for (let attempts = 0; attempts < CONFIG.waves.maxSpawnAttempts; attempts++) {
      const rx = (Math.random() - 0.5) * 2 * half;
      const rz = (Math.random() - 0.5) * 2 * half;

      const dist = Math.hypot(rx - playerPos.x, rz - playerPos.z);
      if (dist < minPlayerDist) continue;

      let inBox = false;
      for (const b of this.world.boxes) {
        if (
          rx >= b.min.x - 0.8 &&
          rx <= b.max.x + 0.8 &&
          rz >= b.min.z - 0.8 &&
          rz <= b.max.z + 0.8
        ) {
          inBox = true;
          break;
        }
      }

      if (!inBox) {
        const spawnY = isFlying
          ? CONFIG.waves.arenas.robotHeightMin + Math.random() * 2
          : 0;
        return { x: rx, y: spawnY, z: rz };
      }
    }

    const angle = Math.atan2(-playerPos.z, -playerPos.x);
    const fx = Math.cos(angle) * (half * 0.75);
    const fz = Math.sin(angle) * (half * 0.75);
    const fy = isFlying ? 3.5 : 0;
    return { x: fx, y: fy, z: fz };
  }

  /**
   * Общая регистрация врага в менеджере
   */
  registerEnemy(enemy, opts = {}) {
    // Сложность забега: HP врагов
    const hpMult = this.game?.difficultyCfg?.enemyHpMult ?? 1;
    if (hpMult !== 1 && enemy && enemy.maxHp > 0) {
      const oldMax = enemy.maxHp;
      enemy.maxHp = Math.max(1, Math.round(oldMax * hpMult));
      const ratio = oldMax > 0 ? enemy.hp / oldMax : 1;
      enemy.hp = Math.max(1, Math.min(enemy.maxHp, Math.round(enemy.maxHp * ratio)));
    }

    this.zombies.push(enemy);
    if (enemy.isMutant) this.mutants.push(enemy);
    if (enemy.isRobot) this.robots.push(enemy);
    if (enemy.isReaper) this.reapers.push(enemy);
    if (opts.arena) enemy.arena = opts.arena;
    if (opts.wave !== undefined) enemy.arenaWave = opts.wave;
    if (opts.debug) enemy.debug = true;
    return enemy;
  }

  /**
   * Спавн зомби
   */
  spawnZombie(x, y, z, opts = {}) {
    const pt = x !== undefined
      ? { x, y: y ?? 0, z: z ?? 0 }
      : this.findSpawnPoint(this.game.player.pos, false);
    const zombie = new Zombie(this.scene, pt.x, pt.y, pt.z);
    if (zombie.applyStyle) {
      zombie.applyStyle(CONFIG.graphics.zombieStyle || "toon", this.game.graphicsQuality || "high");
    }
    return this.registerEnemy(zombie, opts);
  }

  /**
   * Обновить стиль отображения всех активных зомби (toon / pbr)
   */
  updateZombieStyle(style, quality) {
    for (let i = 0; i < this.zombies.length; i++) {
      const e = this.zombies[i];
      if (e.applyStyle && !e.isMutant && !e.isRobot) {
        e.applyStyle(style, quality);
      }
    }
  }

  /**
   * Спавн мутанта (opts.boss → босс-заглушка)
   */
  spawnMutant(x, y, z, opts = {}) {
    const pt = x !== undefined
      ? { x, y: y ?? 0, z: z ?? 0 }
      : this.findSpawnPoint(this.game.player.pos, false);
    const mutant = new Mutant(this.scene, pt.x, pt.y, pt.z, opts);
    return this.registerEnemy(mutant, opts);
  }

  /**
   * Спавн робота (в воздухе)
   */
  spawnRobot(x, y, z, opts = {}) {
    const A = CONFIG.waves.arenas;
    const defaultY = A.robotHeightMin + Math.random() * Math.max(0, A.robotHeightMax - A.robotHeightMin);
    const pt = x !== undefined
      ? { x, y: y ?? defaultY, z: z ?? 0 }
      : this.findSpawnPoint(this.game.player.pos, true);
    const spawnY = pt.y > 0 ? pt.y : defaultY;
    const robot = new Robot(this.scene, pt.x, spawnY, pt.z);
    return this.registerEnemy(robot, opts);
  }

  /**
   * Спавн пугала с серпом (StrawReaper)
   */
  spawnReaper(x, y, z, opts = {}) {
    const pt = x !== undefined
      ? { x, y: y ?? 0, z: z ?? 0 }
      : this.findSpawnPoint(this.game.player.pos, false);
    const reaper = new StrawReaper(this.scene, pt.x, pt.y, pt.z);
    return this.registerEnemy(reaper, opts);
  }

  /**
   * Спавн врага по типу ("zombie", "mutant", "robot", "reaper")
   */
  spawnEnemyByType(type, x, y, z, opts = {}) {
    switch (type) {
      case "mutant":
        return this.spawnMutant(x, y, z, opts);
      case "robot":
        return this.spawnRobot(x, y, z, opts);
      case "reaper":
        return this.spawnReaper(x, y, z, opts);
      case "zombie":
      default:
        return this.spawnZombie(x, y, z, opts);
    }
  }

  /**
   * Прямой алиас spawnEnemyByType
   */
  spawnByType(type, x, y, z, opts = {}) {
    return this.spawnEnemyByType(type, x, y, z, opts);
  }

  /**
   * Количество живых и умирающих врагов
   */
  getAliveCount() {
    let count = 0;
    for (let i = 0; i < this.zombies.length; i++) {
      const z = this.zombies[i];
      if (z.alive || z.dying) count++;
    }
    return count;
  }

  /**
   * Оставшиеся враги (совместимость с HUD/старым кодом)
   */
  getRemainingEnemies() {
    return this.getAliveCount();
  }

  alertInRadius(pos, radius) {
    for (let i = 0; i < this.zombies.length; i++) {
      const z = this.zombies[i];
      if (z.alive && z.pos.distanceTo(pos) < radius) {
        z.alert();
      }
    }
  }

  /**
   * Обновление врагов. Враги неактивных арен не обновляются (экономия FPS),
   * но умирающие и мёртвые всё равно доигрывают смерть и вычищаются.
   */
  update(dt, player, world, game, fx) {
    for (let i = 0; i < this.zombies.length; i++) {
      const e = this.zombies[i];
      if (e.arena && e.arena.state !== "active" && e.alive) continue;
      e.update(dt, player, world, this.zombies, game, fx);
      if (e.updateShadow) e.updateShadow();
      if (e.updateSquash) e.updateSquash(dt);
    }

    // Очистка полностью удалённых врагов (с освобождением GPU-ресурсов)
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const e = this.zombies[i];
      if (!e.alive && !e.dying) {
        e.destroy();
        this.zombies.splice(i, 1);
      }
    }

    // Обновление летящих лазерных снарядов врагов
    if (this.projectiles) {
      this.projectiles.update(dt, world, player, fx);
    }
  }

  clear() {
    for (let i = 0; i < this.zombies.length; i++) {
      this.zombies[i].destroy();
    }
    this.zombies = [];
    this.mutants = [];
    this.robots = [];
    this.reapers = [];
    if (this.projectiles) {
      this.projectiles.clear();
    }
  }

  get enemies() {
    return this.zombies;
  }

  reset() {
    this.clear();
  }
}
