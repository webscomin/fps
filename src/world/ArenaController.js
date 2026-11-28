// Контроллер одной арены: активация по входу, двери, волны врагов,
// точки спавна по периметру, награды за зачистку и босс-заглушка.
import * as THREE from "three";
import { CONFIG } from "../config.js";

export class ArenaController {
  /**
   * @param {Object} game
   * @param {Object} room
   * @param {Object} opts
   * @param {number} opts.index
   * @param {Object} opts.levelCfg
   * @param {Array} opts.doors
   * @param {boolean} [opts.isBoss]
   */
  constructor(game, room, opts = {}) {
    this.game = game;
    this.room = room;
    this.index = opts.index || 0;
    this.levelCfg = opts.levelCfg || {};
    this.doors = opts.doors || [];
    this.isBoss = !!opts.isBoss;

    const A = CONFIG.waves.arenas;
    this.maxAlive = Math.min(
      this.isBoss ? Math.max(8, (this.levelCfg.maxAlive || A.maxAlive) - 4) : (this.levelCfg.maxAlive || A.maxAlive),
      CONFIG.waves.maxAliveLimit
    );

    this.state = "idle"; // idle | active | cleared
    this.startDelay = 0;
    this.waves = [];
    this.currentWave = -1;
    this.waveTimer = 0;
    this.queue = [];
    this.pending = [];
    this.spawnTimer = 0;
    this.boss = null;
    this.bossSpawned = false;
    this.bossMinionTimer = 0;
    this.rewardGiven = false;
    this.markerGeo = new THREE.CylinderGeometry(0.55, 0.55, 3.2, 8, 1, true);

    this.spawnPoints = [];
    this.buildSpawnPoints();
    this.buildWaves();

    // Взрывные бочки арены: размещение по сиду (коллайдеры попадут в кэш World)
    if (this.game.barrels) this.game.barrels.populateArena(this.room, this);
  }

  /** Центр арены */
  get center() {
    return this.room.center;
  }

  /**
   * 8 точек по периметру с отступом от стен и вне блоков
   */
  buildSpawnPoints() {
    const A = CONFIG.waves.arenas;
    const count = Math.max(4, A.spawnPoints || 8);
    const em = this.game.enemyManager;
    const margin = 2.4;
    const cx = this.room.center.x;
    const cz = this.room.center.z;
    const rx = Math.max(2.0, this.room.w / 2 - margin);
    const rz = Math.max(2.0, this.room.d / 2 - margin);

    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + Math.PI / count;
      let point = null;
      for (const f of [1, 0.85, 0.7, 0.55]) {
        const x = cx + Math.cos(ang) * rx * f;
        const z = cz + Math.sin(ang) * rz * f;
        if (!em || !em.isSpawnBlocked(this.room, x, z)) {
          point = { x, z };
          break;
        }
      }
      if (!point) {
        point = {
          x: cx + Math.cos(ang) * rx * 0.5,
          z: cz + Math.sin(ang) * rz * 0.5
        };
      }
      this.spawnPoints.push(point);
    }
  }

  /**
   * Состав волн: суммарное количество врагов уровня делится на 2–3 волны,
   * сложность растёт с индексом арены.
   */
  buildWaves() {
    if (this.isBoss) {
      this.waves = [];
      return;
    }

    const A = CONFIG.waves.arenas;
    const cfg = this.levelCfg;
    const countMult = this.game?.difficultyCfg?.enemyCountMult ?? 1;
    const diff = (1 + this.index * (A.difficultyPerArena || 0)) * countMult;
    const total = {
      zombie: Math.max(1, Math.round((cfg.zombie || 0) * diff)),
      mutant: Math.round((cfg.mutant || 0) * diff),
      robot: Math.round((cfg.robot || 0) * diff),
      reaper: Math.round((cfg.reaper || 0) * diff)
    };

    const waveCount = Math.max(A.waveMin || 2, Math.min(A.waveMax || 3, cfg.waves || 2));
    const waves = [];
    for (let w = 0; w < waveCount; w++) waves.push([]);

    // 1. Раскладываем зомби, роботов и мутантов по всем волнам по кругу
    for (const type of ["zombie", "robot", "mutant"]) {
      for (let i = 0; i < total[type]; i++) {
        waves[i % waveCount].push(type);
      }
    }

    // 2. Пугала (reaper) не спавнятся в первой волне арены (только со второй)
    if (waveCount > 1) {
      const nonFirstWaves = waveCount - 1;
      for (let i = 0; i < total.reaper; i++) {
        waves[1 + (i % nonFirstWaves)].push("reaper");
      }
    } else {
      for (let i = 0; i < total.reaper; i++) {
        waves[0].push("reaper");
      }
    }

    // 3. Первая волна арены должна содержать минимум два разных типа, если на уровне их больше одного
    const distinctLevelTypes = ["zombie", "robot", "mutant"].filter((t) => total[t] > 0);
    if (distinctLevelTypes.length >= 2 && waves.length > 0) {
      const wave0Types = new Set(waves[0]);
      if (wave0Types.size < 2) {
        const missingType = distinctLevelTypes.find((t) => !wave0Types.has(t));
        if (missingType) {
          for (let w = 1; w < waves.length; w++) {
            const idx = waves[w].indexOf(missingType);
            if (idx !== -1) {
              waves[w].splice(idx, 1);
              const swapType = waves[0].pop();
              waves[w].push(swapType);
              waves[0].push(missingType);
              break;
            }
          }
        }
      }
    }

    // 4. В каждой волне должен быть хотя бы один враг; случайное перемешивание Fisher-Yates
    for (let w = 0; w < waves.length; w++) {
      if (waves[w].length === 0) waves[w].push("zombie");
      for (let i = waves[w].length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [waves[w][i], waves[w][j]] = [waves[w][j], waves[w][i]];
      }
    }

    this.waves = waves;
  }

  /**
   * Проверка «игрок зашёл в арену и прошёл вглубь от проёма»
   * @param {Object} player
   * @returns {boolean}
   */
  isPlayerInside(player) {
    const b = this.room.bounds;
    const p = player.pos;
    return (
      p.x >= b.min.x + 0.2 &&
      p.x <= b.max.x - 0.2 &&
      p.z >= b.min.z + 0.2 &&
      p.z <= b.max.z - 0.2 &&
      p.y < 4.5
    );
  }

  /**
   * Минимальная глубина от ближайшего проёма (м).
   * Гарантирует, что игрок прошёл внутрь арены от двери, через которую вошёл.
   */
  depthFromDoors(player) {
    const p = player.pos;
    const b = this.room.bounds;
    let minDepth = Infinity;
    for (const dir of ["north", "south", "west", "east"]) {
      if (!this.room.doors[dir]) continue;
      let depth;
      if (dir === "north") depth = p.z - b.min.z;
      else if (dir === "south") depth = b.max.z - p.z;
      else if (dir === "west") depth = p.x - b.min.x;
      else depth = b.max.x - p.x;
      if (depth < minDepth) minDepth = depth;
    }
    return minDepth === Infinity ? 0 : minDepth;
  }

  /**
   * Главное обновление арены
   */
  update(dt, player) {
    if (this.state === "idle") {
      const depth = CONFIG.waves.arenas.activateDepth || 4;
      if (this.isPlayerInside(player) && this.depthFromDoors(player) >= depth) {
        this.activate();
      }
      return;
    }

    if (this.state !== "active") return;

    this.updatePending(dt);

    if (this.startDelay > 0) {
      this.startDelay -= dt;
      if (this.startDelay <= 0) {
        this.startDelay = 0;
        if (this.isBoss) {
          this.spawnBoss();
        } else {
          this.startWave(0);
        }
      }
      return;
    }

    if (this.isBoss) {
      this.updateBoss(dt);
    } else {
      this.updateWaves(dt);
    }

    this.checkCleared();
  }

  activate() {
    if (this.state !== "idle") return;
    this.state = "active";
    this.startDelay = CONFIG.waves.arenas.startDelay || 1.5;
    for (const d of this.doors) d.close();
    this.game.showWaveBanner(this.isBoss ? "БОСС-АРЕНА" : "АРЕНА");
  }

  startWave(index) {
    if (index <= this.currentWave || index >= this.waves.length) return;
    this.currentWave = index;
    // Не теряем врагов, которые ещё не успели появиться из очереди прошлой волны
    const leftover = this.queue ? this.queue.slice() : [];
    this.queue = leftover.concat(this.waves[index]);
    this.waveSpawned = 0;
    this.waveTimer = 0;
    this.spawnTimer = 0;
    const n = Math.max(1, this.waves.length);
    this.game.showWaveBanner("ВОЛНА " + (index + 1) + " / " + n);
  }

  /**
   * Количество живых и ожидающих появления пугал этой арены (не считая debug)
   */
  aliveReapersCount() {
    const list = this.game.enemyManager.zombies;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.arena === this && e.isReaper && !e.debug && (e.alive || e.dying)) n++;
    }
    for (let i = 0; i < this.pending.length; i++) {
      if (this.pending[i].type === "reaper" && !this.pending[i].debug) n++;
    }
    return n;
  }

  /**
   * Доспавн из очереди и переход к следующей волне
   */
  updateWaves(dt) {
    this.waveTimer += dt;
    const A = CONFIG.waves.arenas;

    // Доспавн по одному, пока есть свободные слоты
    if (this.queue.length > 0) {
      this.spawnTimer -= dt;
      const alive = this.aliveCount() + this.pending.length;
      if (alive < this.maxAlive && this.spawnTimer <= 0) {
        const maxReapers = A.maxReapers != null ? A.maxReapers : 4;
        const currentReapers = this.aliveReapersCount();

        // Ищем индекс первого врага в очереди, которого можно заспавнить
        let spawnIndex = -1;
        for (let i = 0; i < this.queue.length; i++) {
          const type = this.queue[i];
          if (type === "reaper") {
            if (currentReapers < maxReapers) {
              spawnIndex = i;
              break;
            }
            // Лимит пугал достигнут — спавн пугала откладывается, ищем другой тип
          } else {
            spawnIndex = i;
            break;
          }
        }

        if (spawnIndex !== -1) {
          const [type] = this.queue.splice(spawnIndex, 1);
          this.scheduleSpawn(type);
          this.spawnTimer = CONFIG.waves.spawnInterval || 0.25;
        }
      }
    }

    // Переход к следующей волне
    if (this.currentWave < this.waves.length - 1) {
      const waveTotal = this.waves[this.currentWave].length;
      const remaining = this.waveRemaining(this.currentWave);
      const ratio = A.nextWaveAliveRatio || 0.2;
      const timeout = A.nextWaveTimeout || 25;
      if (remaining < waveTotal * ratio || this.waveTimer >= timeout) {
        this.startWave(this.currentWave + 1);
      }
    }
  }

  spawnBoss(dt = 0) {
    if (this.bossSpawned) return;
    this.bossSpawned = true;
    const B = CONFIG.waves.boss;
    const c = this.room.center;
    const y = 0.45;
    const boss = this.game.enemyManager.spawnMutant(c.x, y, c.z, {
      arena: this,
      isBoss: true,
      scale: B.scale || 2,
      health: B.health || 1500
    });
    boss.arena = this;
    boss.arenaWave = -1;
    boss.flashT = 0.3;
    boss.setFlash(true);
    this.boss = boss;
    this.bossMinionTimer = B.zombieInterval || 10;
    this.game.showWaveBanner("ГИГАНТ ПРОБУДИЛСЯ!");
  }

  updateBoss(dt) {
    const B = CONFIG.waves.boss;
    const bossAlive = this.boss && this.boss.alive;

    if (bossAlive) {
      this.bossMinionTimer -= dt;
      const alive = this.aliveCount() + this.pending.length;
      if (this.bossMinionTimer <= 0 && alive < this.maxAlive + 1) {
        this.bossMinionTimer = B.zombieInterval || 10;
        this.scheduleSpawn("zombie");
      }
    }

    this.spawnTimer -= dt;
    // поддерживаем обычный доспавн, если босс жив
    if (this.queue.length > 0 && this.spawnTimer <= 0) {
      const A = CONFIG.waves.arenas;
      const maxReapers = A.maxReapers != null ? A.maxReapers : 4;
      const currentReapers = this.aliveReapersCount();

      let spawnIndex = -1;
      for (let i = 0; i < this.queue.length; i++) {
        const type = this.queue[i];
        if (type === "reaper") {
          if (currentReapers < maxReapers) {
            spawnIndex = i;
            break;
          }
        } else {
          spawnIndex = i;
          break;
        }
      }

      if (spawnIndex !== -1) {
        const [type] = this.queue.splice(spawnIndex, 1);
        this.scheduleSpawn(type);
        this.spawnTimer = CONFIG.waves.spawnInterval || 0.25;
      }
    }
  }

  /**
   * Точка спавна: не ближе minSpawnDistFromPlayer к игроку, иначе самая дальняя
   */
  pickSpawnPoint(type) {
    const A = CONFIG.waves.arenas;
    const p = this.game.player.pos;
    const minD = A.minSpawnDistFromPlayer || 10;
    let best = null;
    let bestD = -1;
    const valid = [];

    for (const pt of this.spawnPoints) {
      const d = Math.hypot(pt.x - p.x, pt.z - p.z);
      if (d > bestD) {
        bestD = d;
        best = pt;
      }
      if (d >= minD) valid.push(pt);
    }

    const chosen = valid.length > 0 ? valid[Math.floor(Math.random() * valid.length)] : best;
    if (!chosen) return null;

    const y = type === "robot"
      ? A.robotHeightMin + Math.random() * Math.max(0, A.robotHeightMax - A.robotHeightMin)
      : 0;

    return { x: chosen.x, y, z: chosen.z };
  }

  /**
   * Постановка спавна в очередь: сначала 0.5 с световая вспышка
   */
  scheduleSpawn(type, opts = {}) {
    const point = this.pickSpawnPoint(type);
    if (!point) return false;

    const color = type === "robot"
      ? 0xffb703
      : type === "mutant"
      ? 0xb04cff
      : type === "reaper"
      ? 0xff9f1c
      : 0xff2e4a;
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const marker = new THREE.Mesh(this.markerGeo, mat);
    marker.position.set(point.x, point.y + 1.6, point.z);
    marker.scale.set(1, 1, 1);
    this.game.scene.add(marker);

    this.pending.push({
      type,
      point,
      marker,
      material: mat,
      debug: !!opts.debug,
      total: CONFIG.waves.arenas.spawnFlashDelay || 0.5,
      timer: CONFIG.waves.arenas.spawnFlashDelay || 0.5
    });
    return true;
  }

  updatePending(dt) {
    if (this.pending.length === 0) return;
    const em = this.game.enemyManager;

    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.timer -= dt;
      const t = 1 - Math.max(0, p.timer) / p.total;
      p.material.opacity = 0.2 + 0.5 * Math.sin(Math.min(1, t) * Math.PI * 0.9);
      p.marker.scale.set(1 + t * 0.5, 1, 1 + t * 0.5);

      if (p.timer <= 0) {
        this.removeMarker(p);
        this.pending.splice(i, 1);

        const enemy = em.spawnEnemyByType(p.type, p.point.x, p.point.y, p.point.z, {
          arena: this,
          wave: this.currentWave,
          debug: p.debug
        });
        if (enemy) {
          enemy.arena = this;
          enemy.arenaWave = this.currentWave;
          if (p.debug) enemy.debug = true;
          enemy.flashT = 0.2;
          enemy.setFlash(true);
        }
      }
    }
  }

  removeMarker(p) {
    this.game.scene.remove(p.marker);
    p.material.dispose();
  }

  /** Живые (включая умирающих) враги этой арены, исключая отладочные */
  aliveCount() {
    const list = this.game.enemyManager.zombies;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.arena === this && !e.debug && (e.alive || e.dying)) n++;
    }
    return n;
  }

  /** Осталось врагов в конкретной волне (живые + очередь + вспышки) */
  waveRemaining(waveIndex) {
    const list = this.game.enemyManager.zombies;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.arena === this && e.arenaWave === waveIndex && !e.debug && (e.alive || e.dying)) n++;
    }
    if (waveIndex === this.currentWave) {
      n += this.queue.length;
      for (const p of this.pending) {
        if (!p.debug && (p.type === "zombie" || p.type === "mutant" || p.type === "robot" || p.type === "reaper")) n++;
      }
    }
    return n;
  }

  /** Всего осталось врагов на арене (для HUD) */
  get remaining() {
    return this.aliveCount() + this.queue.length + this.pending.length;
  }

  /** Номер текущей волны для HUD (1-based) */
  get waveNumber() {
    return this.currentWave + 1;
  }

  /** Общее число волн */
  get waveCount() {
    return this.isBoss ? 1 : this.waves.length;
  }

  checkCleared() {
    if (this.state !== "active") return;

    if (this.isBoss) {
      const bossAlive = this.boss && this.boss.alive;
      if (!this.bossSpawned || bossAlive) return;
      if (this.pending.length > 0 || this.queue.length > 0) return;
      if (this.aliveCount() > 0) return;
      this.onCleared();
      return;
    }

    if (this.currentWave < this.waves.length - 1) return;
    if (this.queue.length > 0 || this.pending.length > 0) return;
    if (this.aliveCount() > 0) return;
    this.onCleared();
  }

  /**
   * Зачистка: открыть двери, награды, баннер
   */
  onCleared() {
    if (this.state === "cleared") return;
    this.state = "cleared";

    for (const d of this.doors) d.open();
    this.spawnRewards();

    const text = this.isBoss ? "БОСС ПОВЕРЖЕН! ЧИСТО!" : "ЧИСТО!";
    this.game.showWaveBanner(text);
    if (this.game.audio) this.game.audio.play("wave");

    if (this.game.levelManager) {
      this.game.levelManager.onArenaCleared(this);
    }
  }

  /**
   * Награды из центра арены: аптечка, броня и патроны всех типов
   */
  spawnRewards() {
    if (this.rewardGiven) return;
    this.rewardGiven = true;

    const pm = this.game.pickupManager;
    if (!pm) return;

    const reward = CONFIG.waves.arenas.clearReward || ["medkit", "armor", "ammo_shotgun", "ammo_ak47", "ammo_rocket"];
    const radius = CONFIG.waves.arenas.clearRewardRadius || 1.9;
    const c = this.room.center;
    const y = this.isBoss ? 0.5 : 0;

    for (let i = 0; i < reward.length; i++) {
      const ang = (i / reward.length) * Math.PI * 2;
      pm.spawnAt(
        c.x + Math.cos(ang) * radius,
        y,
        c.z + Math.sin(ang) * radius,
        reward[i]
      );
    }

    // Бонусный дроп добивания у босса
    if (this.isBoss && pm.spawnCustomDrop) {
      pm.spawnCustomDrop(new THREE.Vector3(c.x, 0.8, c.z), "medkit");
    }
  }

  /**
   * Отладочный спавн (клавиша T) — сразу, без задержки
   */
  debugSpawn(type = "zombie") {
    const point = this.pickSpawnPoint(type);
    if (!point) return null;
    const enemy = this.game.enemyManager.spawnEnemyByType(type, point.x, point.y, point.z, {
      arena: this,
      wave: this.currentWave,
      debug: true
    });
    if (enemy) {
      enemy.arena = this;
      enemy.arenaWave = this.currentWave;
      enemy.debug = true;
    }
    return enemy;
  }

  destroy() {
    for (const p of this.pending) {
      this.removeMarker(p);
    }
    this.pending = [];
    this.queue = [];
    if (this.markerGeo) {
      this.markerGeo.dispose();
      this.markerGeo = null;
    }
    this.boss = null;
  }
}
