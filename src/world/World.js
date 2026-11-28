// Игровой мир: освещение, процедурный уровень (LevelGenerator), комнаты, коридоры,
// пространственное разделение коллайдеров и видимость (culling)
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { EDGE_MAT } from "../core/Physics.js";
import { LevelGenerator } from "./LevelGenerator.js";
import { Target } from "./Target.js";

export class World {
  /**
   * @param {THREE.Scene} scene
   * @param {string|number} [seed]
   */
  constructor(scene, seed) {
    this.scene = scene;
    this.levelGenerator = new LevelGenerator();

    this.rooms = [];
    this.corridors = [];
    this.boxes = [];        // Полный список всех коллайдеров мира
    this.targets = [];
    this.startRoom = null;
    this.exitRoom = null;
    this.seed = "";

    // Кэш активных коллайдеров по комнатам (строится при загрузке уровня)
    this._nearbyBoxCache = null;

    this.levelGroup = new THREE.Group();
    this.scene.add(this.levelGroup);

    this.setupEnvironment();
    this.loadLevel(seed);
  }

  /**
   * Базовое окружение: туман, глобальный свет и постоянный пул PointLight
   */
  setupEnvironment() {
    this.scene.background = new THREE.Color(CONFIG.world.fogColor);
    this.scene.fog = new THREE.FogExp2(
      CONFIG.world.fogColor,
      CONFIG.world.fogDensity != null ? CONFIG.world.fogDensity : 0.014
    );

    const hemi = CONFIG.world.hemisphereLight || {};
    this.hemiLight = new THREE.HemisphereLight(
      hemi.skyColor != null ? hemi.skyColor : 0x8fa0a8,
      hemi.groundColor != null ? hemi.groundColor : 0x3a3f42,
      hemi.intensity != null ? hemi.intensity : 1.0
    );
    this.scene.add(this.hemiLight);

    const amb = CONFIG.world.ambientLight || {};
    this.ambientLight = new THREE.AmbientLight(
      amb.color != null ? amb.color : 0xffffff,
      amb.intensity != null ? amb.intensity : 0.25
    );
    this.scene.add(this.ambientLight);

    const sun = CONFIG.world.sunLight || {};
    this.sunLight = new THREE.DirectionalLight(
      sun.color != null ? sun.color : 0xffffff,
      sun.intensity != null ? sun.intensity : 0.6
    );
    this.sunLight.position.set(sun.x || 15, sun.y || 25, sun.z || 10);
    this.scene.add(this.sunLight);

    // Постоянный пул источников света (PointLight pool).
    // Число источников света в сцене ВСЕГДА неизменно (6 штук), visible всегда true,
    // чтобы предотвратить перекомпиляцию шейдеров Three.js и чёрные вспышки.
    const maxLights = (CONFIG.graphics && CONFIG.graphics.maxPointLights) || 6;
    this.pointLightPool = [];
    for (let i = 0; i < maxLights; i++) {
      const pl = new THREE.PointLight(0xffffff, 0, 30);
      pl.position.set(0, -100, 0);
      pl.visible = true; // ВСЕГДА true
      this.scene.add(pl);
      this.pointLightPool.push(pl);
    }
    this._lightAssignTimer = 0;
  }

  /**
   * Загрузка / перегенерация уровня по сиду
   * @param {string|number} [seed]
   */
  loadLevel(seed) {
    // 1. Очистка предыдущего уровня
    this.clearLevel();

    // 2. Генерация нового уровня
    const levelData = this.levelGenerator.generate(seed);

    this.rooms = levelData.rooms;
    this.corridors = levelData.corridors;
    this.startRoom = levelData.startRoom;
    this.exitRoom = levelData.exitRoom;
    this.roomsByCell = levelData.roomsByCell;
    this.boxes = levelData.allBoxes;
    this.seed = levelData.seedStr;

    // 2a. Кэш коллайдеров для быстрого поиска без аллокаций в игровом цикле
    this._buildBoxCache();

    // 3. Добавление комнат и коридоров на сцену
    for (const room of this.rooms) {
      room.buildLights(this.scene);
      this.levelGroup.add(room.group);
    }
    for (const corridor of this.corridors) {
      this.levelGroup.add(corridor.group);
    }

    // 4. Тренировочные мишени в стартовой комнате
    this.spawnTargets();

    return levelData;
  }

  /**
   * Создать тренировочные мишени из CONFIG.world.targets.
   * Координаты конфигурации трактуются как смещения от центра стартовой комнаты
   * и ограничиваются её размерами (конфиг достался от одиночной арены 40х40).
   */
  spawnTargets() {
    const defs = CONFIG.world.targets || [];
    const room = this.startRoom;
    const limitX = room ? room.w / 2 - 1.5 : 15;
    const limitZ = room ? room.d / 2 - 1.5 : 15;

    for (const def of defs) {
      const ox = Math.max(-limitX, Math.min(limitX, def.x));
      const oz = Math.max(-limitZ, Math.min(limitZ, def.z));
      const x = room ? room.center.x + ox : def.x;
      const z = room ? room.center.z + oz : def.z;
      this.targets.push(new Target(this.scene, x, def.y || 0, z, def.color));
    }
  }

  /**
   * Очистить текущий уровень со сцены
   */
  clearLevel() {
    for (const room of this.rooms) {
      room.destroy();
    }
    // Коридоры не имеют собственного destroy(): обходим их группы и освобождаем
    // геометрию и материалы (кроме глобального EDGE_MAT, общего для всех контуров)
    while (this.levelGroup.children.length > 0) {
      const child = this.levelGroup.children[0];
      this.levelGroup.remove(child);
      child.traverse((node) => {
        if (node.geometry) node.geometry.dispose();
        if (node.material && node.material !== EDGE_MAT) {
          const mats = Array.isArray(node.material) ? node.material : [node.material];
          for (const m of mats) {
            // Кэшированные материалы и общие текстуры живут весь сеанс
            if (m === EDGE_MAT || m.userData.shared) continue;
            m.dispose();
          }
        }
      });
    }
    for (const target of this.targets) {
      target.destroy();
    }
    this.targets = [];

    // Сброс пула источников света (не удаляя их из сцены)
    if (this.pointLightPool) {
      for (const pl of this.pointLightPool) {
        pl.intensity = 0;
        pl.position.set(0, -100, 0);
      }
    }

    this.rooms = [];
    this.corridors = [];
    this.boxes = [];
    this.startRoom = null;
    this.exitRoom = null;
    this._nearbyBoxCache = null;
  }

  /**
   * Найти комнату по мировым координатам позиции
   * @param {THREE.Vector3} pos
   * @returns {Room|null}
   */
  getRoomAt(pos) {
    for (const r of this.rooms) {
      const b = r.bounds;
      if (
        pos.x >= b.min.x &&
        pos.x <= b.max.x &&
        pos.z >= b.min.z &&
        pos.z <= b.max.z
      ) {
        return r;
      }
    }
    // Если игрок в коридоре, находим ближайшую комнату
    let closest = null;
    let minDist = Infinity;
    for (const r of this.rooms) {
      const d = Math.hypot(pos.x - r.center.x, pos.z - r.center.z);
      if (d < minDist) {
        minDist = d;
        closest = r;
      }
    }
    return closest;
  }

  /**
   * Построить кэш коллайдеров для каждой комнаты: текущая комната, соседние через двери
   * и примыкающие к ним коридоры. Вызывается один раз при загрузке уровня.
   */
  _buildBoxCache() {
    this._nearbyBoxCache = this.rooms && this.rooms.length > 0 ? new Map() : null;
    if (!this._nearbyBoxCache) return;

    for (const room of this.rooms) {
      const roomsSet = new Set([room]);
      for (const dir in room.doorNeighbors) {
        const neighbor = room.doorNeighbors[dir];
        if (neighbor) roomsSet.add(neighbor);
      }

      const activeBoxes = [];
      for (const r of roomsSet) {
        for (const b of r.boxes) activeBoxes.push(b);
      }
      for (const corr of this.corridors) {
        if (roomsSet.has(corr.roomA) || roomsSet.has(corr.roomB)) {
          for (const b of corr.boxes) activeBoxes.push(b);
        }
      }

      this._nearbyBoxCache.set(room, activeBoxes);
    }
  }

  /**
   * Перестроить кэш коллайдеров (после добавления/удаления дверей)
   */
  rebuildBoxCache() {
    this._buildBoxCache();
  }

  /**
   * Пространственное разделение: получить коллайдеры текущей комнаты и соседних (требование производительности)
   * @param {THREE.Vector3} pos
   * @returns {Array<{ min: THREE.Vector3, max: THREE.Vector3 }>}
   */
  getNearbyBoxes(pos) {
    const curRoom = this.getRoomAt(pos);
    if (!curRoom) return this.boxes;

    if (this._nearbyBoxCache) {
      const cached = this._nearbyBoxCache.get(curRoom);
      if (cached) return cached;
    }

    // Резервный путь: кэш ещё не построен (например, во время генерации уровня)
    const nearbyRooms = new Set([curRoom]);
    for (const dir in curRoom.doorNeighbors) {
      const neighbor = curRoom.doorNeighbors[dir];
      if (neighbor) nearbyRooms.add(neighbor);
    }

    const activeBoxes = [];
    for (const room of nearbyRooms) {
      for (const b of room.boxes) {
        activeBoxes.push(b);
      }
    }

    // Добавляем коллайдеры коридоров, примыкающих к активным комнатам
    for (const corr of this.corridors) {
      if (nearbyRooms.has(corr.roomA) || nearbyRooms.has(corr.roomB)) {
        for (const b of corr.boxes) {
          activeBoxes.push(b);
        }
      }
    }

    return activeBoxes.length > 0 ? activeBoxes : this.boxes;
  }

  /**
   * Обновление мира: visibility culling комнат дальше 1 ячейки от игрока,
   * и динамическая привязка постоянного пула PointLight к ближайшим источникам света (10 Гц)
   * @param {number} dt
   * @param {THREE.Vector3} [playerPos]
   */
  update(dt, playerPos) {
    if (playerPos) {
      const CS = CONFIG.level.cellSize;
      const G = CONFIG.level.gridSize;
      // Индекс ячейки игрока в сетке 4x4
      const pgx = Math.round(playerPos.x / CS + (G - 1) / 2);
      const pgz = Math.round(playerPos.z / CS + (G - 1) / 2);

      // Видимость комнат: видимы только комнаты не дальше 1 ячейки (Чебышёвское расстояние <= 1)
      for (const room of this.rooms) {
        const distGrid = Math.max(Math.abs(room.gx - pgx), Math.abs(room.gz - pgz));
        room.group.visible = distGrid <= 1;
      }

      // Коридор видим, если видима хотя бы одна из соединённых комнат
      for (const corr of this.corridors) {
        corr.group.visible = corr.roomA.group.visible || corr.roomB.group.visible;
      }

      this._assignPointLights(dt, playerPos);
    }

    // Обновление мишеней (если есть)
    for (const target of this.targets) {
      target.update(dt);
    }
  }

  /**
   * Динамическая привязка постоянного пула источников света (PointLight pool) к ближайшим
   * лампам комнат. Выполняется не чаще 10 Гц.
   * @param {number} dt
   * @param {THREE.Vector3} playerPos
   */
  _assignPointLights(dt, playerPos) {
    if (!this.pointLightPool || this.pointLightPool.length === 0) return;

    this._lightAssignTimer = (this._lightAssignTimer || 0) + dt;
    if (this._lightAssignTimer < 0.1) return;
    this._lightAssignTimer = 0;

    // Собираем якоря света только из видимых комнат
    const candidates = [];
    for (const room of this.rooms) {
      if (!room.group.visible || !room.lightAnchors) continue;
      for (let i = 0; i < room.lightAnchors.length; i++) {
        const anchor = room.lightAnchors[i];
        const dx = anchor.pos.x - playerPos.x;
        const dy = anchor.pos.y - playerPos.y;
        const dz = anchor.pos.z - playerPos.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        candidates.push({ anchor, distSq });
      }
    }

    // Сортируем по удаленности от игрока
    candidates.sort((a, b) => a.distSq - b.distSq);

    const poolLen = this.pointLightPool.length;
    const count = Math.min(candidates.length, poolLen);

    for (let i = 0; i < count; i++) {
      const { anchor } = candidates[i];
      const pl = this.pointLightPool[i];
      pl.position.copy(anchor.pos);
      pl.color.copy(anchor.color);
      pl.intensity = anchor.intensity;
      pl.distance = anchor.distance;
      pl.visible = true;
    }

    // Неиспользуемые источники света в пуле: intensity = 0, visible = true!
    for (let i = count; i < poolLen; i++) {
      const pl = this.pointLightPool[i];
      pl.intensity = 0;
      pl.visible = true;
    }
  }

  /**
   * Обновление ловушек комнат (ямы арен): возврат игрока на край с уроном.
   * @param {number} dt
   * @param {Object} player
   * @param {Object} game
   */
  updateHazards(dt, player, game) {
    if (!player) return;
    const room = this.getRoomAt(player.pos);
    if (room && room.updateHazards) {
      room.updateHazards(dt, player, game);
    }
  }
}
