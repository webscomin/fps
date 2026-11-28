// Менеджер уровней: арены, двери, прогрессия, лифт выхода, статистика и рестарт.
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { Door } from "./Door.js";
import { ArenaController } from "./ArenaController.js";

const DOOR_DIRS = ["north", "south", "west", "east"];
const PAD_HALF = 3.6;
export class LevelManager {
  /**
   * @param {Object} game
   */
  constructor(game) {
    this.game = game;

    this.level = 1;
    this.levelCfg = this.getLevelConfig(1);
    this.levelElapsed = 0;
    this.itemsFound = 0;
    this.baseKills = game.kills || 0;
    this.baseGlory = game.gloryKills || 0;

    this.arenas = [];
    this.doors = [];
    this.clearedCount = 0;

    this.liftActive = false;
    this.liftArmed = false;
    this.liftHintShown = false;
    this.transitionCooldown = 0;
    this.liftT = 0;

    this.liftGroup = null;
    this.liftMat = null;
    this.liftRingMat = null;
    this.liftRings = [];

    this.buildLevelObjects();
    this.buildLift();

    this.game.pickupManager.spawnStartPickups();
    this.game.hud.setLevel(this.level);
    this.game.hud.setSeed(this.game.world.seed);
    this.game.hud.setArenaProgress(0, this.arenas.length);
  }

  /**
   * Конфигурация уровня 1–8, далее — рост на 15% за уровень
   * @param {number} level
   */
  getLevelConfig(level) {
    const W = CONFIG.waves;
    const table = W.levels;
    if (level >= 1 && level <= table.length) return table[level - 1];

    const last = table[table.length - 1];
    const extra = level - table.length;
    const mul = Math.pow(W.levelScale || 1.15, extra);
    return {
      level,
      zombie: Math.round(last.zombie * mul),
      mutant: Math.round(last.mutant * mul),
      robot: Math.round(last.robot * mul),
      maxAlive: W.maxAliveLimit || 18,
      waves: W.arenas.waveMax || 3
    };
  }

  /** Каждый 3-й уровень — босс-арена в комнате exit */
  isBossLevel(level = this.level) {
    const every = CONFIG.waves.boss.everyLevels || 3;
    return level > 0 && level % every === 0;
  }

  /**
   * Создание дверей, арен и босс-арены для текущего мира
   */
  buildLevelObjects() {
    const world = this.game.world;
    this.arenas = [];
    this.doors = [];
    this.clearedCount = 0;

    // Двери стартовой комнаты всегда открыты
    if (world.startRoom) {
      this.createDoors(world.startRoom);
    }

    // Обычные арены
    const arenaRooms = world.rooms.filter((r) => r.type === "arena");
    arenaRooms.forEach((room, i) => {
      const doors = this.createDoors(room);
      this.arenas.push(
        new ArenaController(this.game, room, {
          index: i,
          levelCfg: this.levelCfg,
          doors
        })
      );
    });

    // Двери выхода; на каждом 3-м уровне комната exit становится босс-ареной
    const exitDoors = world.exitRoom ? this.createDoors(world.exitRoom) : [];
    if (this.isBossLevel()) {
      this.arenas.push(
        new ArenaController(this.game, world.exitRoom, {
          index: arenaRooms.length,
          levelCfg: this.levelCfg,
          doors: exitDoors,
          isBoss: true
        })
      );
    }

    // Коллайдеры дверей уже добавлены в комнаты — перестраиваем кэш
    if (world.rebuildBoxCache) world.rebuildBoxCache();
  }

  /**
   * Двери на все проёмы комнаты
   */
  createDoors(room) {
    const doors = [];
    for (const dir of DOOR_DIRS) {
      if (!room.doors[dir]) continue;
      const door = new Door(this.game.world, room, dir, { startOpen: true });
      doors.push(door);
      this.doors.push(door);
    }
    return doors;
  }

  /**
   * Светящийся цилиндр-лифт в комнате выхода
   */
  buildLift() {
    const exit = this.game.world.exitRoom;
    if (!exit) return;

    this.liftGroup = new THREE.Group();
    this.liftGroup.position.set(exit.center.x, 0, exit.center.z);

    this.liftMat = new THREE.MeshBasicMaterial({
      color: 0x3a4a55,
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const cylinder = new THREE.Mesh(
      new THREE.CylinderGeometry(1.35, 1.6, 4.2, 20, 1, true),
      this.liftMat
    );
    cylinder.position.y = 2.3;
    this.liftGroup.add(cylinder);
    this.liftCylinder = cylinder;

    this.liftRingMat = new THREE.MeshBasicMaterial({
      color: 0x3a4a55,
      transparent: true,
      opacity: 0.35,
      depthWrite: false
    });

    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.5, 0.07, 8, 28),
        this.liftRingMat
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.55 + i * 3.2;
      this.liftGroup.add(ring);
      this.liftRings.push(ring);
    }

    this.game.scene.add(this.liftGroup);
    this.applyLiftVisual();
  }

  applyLiftVisual() {
    if (!this.liftMat || !this.liftRingMat) return;
    if (this.liftActive) {
      this.liftMat.color.setHex(0x4cc9f0);
      this.liftMat.opacity = 0.24;
      this.liftRingMat.color.setHex(0x9ffcff);
      this.liftRingMat.opacity = 0.85;
    } else {
      this.liftMat.color.setHex(0x3a4a55);
      this.liftMat.opacity = 0.07;
      this.liftRingMat.color.setHex(0x3a4a55);
      this.liftRingMat.opacity = 0.35;
    }
  }

  updateLift(dt) {
    if (!this.liftGroup) return;
    this.liftT += dt;
    for (let i = 0; i < this.liftRings.length; i++) {
      this.liftRings[i].rotation.z += dt * (this.liftActive ? 1.8 : 0.35) * (i === 0 ? 1 : -1);
    }
    if (this.liftActive) {
      const s = 1 + Math.sin(this.liftT * 3) * 0.05;
      this.liftCylinder.scale.set(s, 1, s);
    } else {
      this.liftCylinder.scale.set(1, 1, 1);
    }
  }

  /**
   * Главное обновление уровня
   */
  update(dt) {
    const game = this.game;
    const player = game.player;

    if (!player.isDead) this.levelElapsed += dt;
    if (this.transitionCooldown > 0) {
      this.transitionCooldown = Math.max(0, this.transitionCooldown - dt);
    }

    for (const door of this.doors) door.update(dt);
    for (const arena of this.arenas) arena.update(dt, player);

    this.updateLift(dt);
    this.updateLiftAvailability();
    this.checkLiftEntry(dt);
  }

  updateLiftAvailability() {
    if (this.liftActive || !this.allCleared()) return;
    this.liftActive = true;
    this.liftArmed = false;
    this.applyLiftVisual();
    this.game.showWaveBanner("ВСЕ АРЕНЫ ЗАЧИЩЕНЫ! К ЛИФТУ!");
  }

  /**
   * Проверка входа в лифт. Активируется только после зачистки всех арен.
   * После активации нужно выйти с подиума и зайти заново, чтобы не
   * перескочить уровень в момент убийства босса на подиуме.
   */
  checkLiftEntry(dt) {
    if (this.transitionCooldown > 0) return;

    const game = this.game;
    const exit = game.world.exitRoom;
    const player = game.player;
    if (!exit || player.isDead || game.gloryKill.isActive) return;

    const dx = player.pos.x - exit.center.x;
    const dz = player.pos.z - exit.center.z;
    const inPad =
      Math.abs(dx) <= PAD_HALF &&
      Math.abs(dz) <= PAD_HALF &&
      player.pos.y <= 1.6;

    if (!inPad) {
      this.liftArmed = true;
      this.liftHintShown = false;
      return;
    }

    if (!this.liftArmed) return;

    if (!this.liftActive) {
      if (!this.liftHintShown) {
        this.liftHintShown = true;
        this.game.showWaveBanner(
          "СНАЧАЛА ЗАЧИСТИ АРЕНЫ (" + this.clearedCount + " / " + this.arenas.length + ")!"
        );
      }
      return;
    }

    this.nextLevel();
  }

  /**
   * Все арены (включая босс-арену) зачищены
   */
  allCleared() {
    return this.arenas.length === 0 || this.clearedCount >= this.arenas.length;
  }

  getActiveArena() {
    for (const a of this.arenas) {
      if (a.state === "active") return a;
    }
    return null;
  }

  /**
   * Арена доложила о зачистке
   */
  onArenaCleared(arena) {
    this.clearedCount = Math.min(this.arenas.length, this.clearedCount + 1);
    this.game.hud.setArenaProgress(this.clearedCount, this.arenas.length);
  }

  onItemCollected() {
    this.itemsFound++;
  }

  /** Статистика текущего уровня на момент вызова */
  snapshotStats() {
    return {
      level: this.level,
      time: this.levelElapsed,
      kills: Math.max(0, this.game.kills - this.baseKills),
      glory: Math.max(0, this.game.gloryKills - this.baseGlory),
      items: this.itemsFound
    };
  }

  /**
   * Переход на следующий уровень с новым сидом. Здоровье, броня,
   * патроны и счёт сохраняются.
   */
  nextLevel() {
    const stats = this.snapshotStats();
    const prevLevel = this.level;
    const proceed = () => {
      this.startLevel(prevLevel + 1, undefined, { preservePlayer: true });
      this.game.hud.showLevelStats(stats);
      if (this.game.audio) this.game.audio.play("wave");
    };

    // Между уровнями — выбор перка. Игра и эффекты на паузе до выбора.
    if (this.game.beginPerkChoice) {
      this.game.beginPerkChoice(proceed);
    } else {
      proceed();
    }
  }

  /**
   * Загрузка уровня.
   * @param {number} levelNumber
   * @param {string|number} [seed] - undefined = новый случайный сид
   * @param {Object} [opts]
   * @param {boolean} [opts.preservePlayer=false] - сохранить здоровье/броню/патроны
   */
  startLevel(levelNumber, seed, opts = {}) {
    const game = this.game;
    const player = game.player;
    const preserve = !!opts.preservePlayer;
    const savedHealth = player.health;
    const savedArmor = player.armor;

    this.destroyLevelObjects();
    game.enemyManager.clear();
    game.pickupManager.clear();
    game.gloryKill.isActive = false;
    game.hud.hideLevelStats();

    // Старые бочки удаляются вместе с комнатами; сбрасываем ссылки менеджера
    if (game.barrels) game.barrels.reset();

    game.world.loadLevel(seed);

    this.level = Math.max(1, levelNumber | 0);
    this.levelCfg = this.getLevelConfig(this.level);
    this.levelElapsed = 0;
    this.itemsFound = 0;
    this.baseKills = game.kills;
    this.baseGlory = game.gloryKills;
    this.clearedCount = 0;
    this.liftActive = false;
    this.liftArmed = false;
    this.liftHintShown = false;
    this.transitionCooldown = 0.8;

    const spawnPos = game.world.startRoom ? game.world.startRoom.center : null;
    player.reset(spawnPos);
    if (preserve) {
      player.health = Math.min(player.maxHealth, savedHealth);
      player.armor = Math.min(player.maxArmor, savedArmor);
      if (game.styleMeter) {
        game.styleMeter.freeze(3.0);
      }
    } else {
      game.refillAmmo();
      if (game.styleMeter) {
        game.styleMeter.reset();
      }
    }

    this.buildLevelObjects();
    this.buildLift();
    game.pickupManager.spawnStartPickups();

    game.hud.setSeed(game.world.seed);
    game.hud.setLevel(this.level);
    game.hud.setArenaProgress(0, this.arenas.length);
    game.hud.setScore(game.kills, game.gloryKills, game.score);
  }

  /**
   * Рестарт текущего уровня с тем же сидом (после смерти)
   */
  restartLevel() {
    this.startLevel(this.level, this.game.world.seed, { preservePlayer: false });
  }

  /**
   * Отладочный спавн врага по типу (T — зомби, кнопки отладочного меню).
   * @param {"zombie"|"robot"|"reaper"|"mutant"} [type]
   */
  debugSpawnEnemy(type = "zombie") {
    const arena = this.getActiveArena();
    if (arena) return arena.debugSpawn(type);
    return this.game.enemyManager.spawnEnemyByType(type);
  }

  debugSpawnZombie() {
    return this.debugSpawnEnemy("zombie");
  }

  destroyLevelObjects() {
    for (const arena of this.arenas) arena.destroy();
    this.arenas = [];
    for (const door of this.doors) door.destroy();
    this.doors = [];
    this.destroyLift();
  }

  destroyLift() {
    if (this.liftGroup) {
      this.game.scene.remove(this.liftGroup);
      this.liftGroup.traverse((node) => {
        if (node.geometry) node.geometry.dispose();
      });
      this.liftGroup = null;
    }
    if (this.liftMat) {
      this.liftMat.dispose();
      this.liftMat = null;
    }
    if (this.liftRingMat) {
      this.liftRingMat.dispose();
      this.liftRingMat = null;
    }
    this.liftRings = [];
    this.liftCylinder = null;
  }
}
