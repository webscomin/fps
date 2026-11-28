// Процедурный генератор уровня: сетка 4x4 ячеек (64x64 м), остовное дерево комнат,
// прямые коридоры, типы комнат (start, arena, loot, exit) и арены по шаблонам
import * as THREE from "three";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import { CONFIG } from "../config.js";
import { Rng } from "../core/Rng.js";
import { Room } from "./Room.js";
import {
  ARENA_TEMPLATES,
  finalizeArenaLayout,
  validateArenaRoom
} from "./ArenaTemplates.js";
import { outlined } from "../core/Physics.js";
import {
  getMaterial,
  getEmissiveMaterial,
  applyWorldUVs,
  applyAO
} from "./Materials.js";

export class LevelGenerator {
  /**
   * @param {Rng} [rng]
   */
  constructor(rng) {
    this.rng = rng || new Rng();
  }

  /**
   * Сгенерировать уровень по сиду
   * @param {string|number} [seed]
   * @returns {Object} { rooms, corridors, startRoom, exitRoom, allBoxes, seedStr }
   */
  generate(seed) {
    if (seed !== undefined) {
      this.rng.setSeed(seed);
    } else {
      this.rng.setSeed(); // Случайный новый сид
    }

    const maxAttempts = 10;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const levelData = this._buildLevel();
        if (this.validateLevel(levelData)) {
          return levelData;
        }
      } catch (err) {
        console.warn("Повторная генерация уровня из-за ошибки:", err);
      }
    }

    throw new Error("Не удалось сгенерировать валидный уровень после 10 попыток");
  }

  /**
   * Внутренний алгоритм генерации уровня
   */
  _buildLevel() {
    const C = CONFIG.level;
    const G = C.gridSize; // 4
    const CS = C.cellSize; // 64

    // 1. Выбираем количество комнат от minRooms (7) до maxRooms (10)
    const targetRoomCount = this.rng.rangeInt(C.minRooms, C.maxRooms);

    // 2. Выбираем связанный набор ячеек в сетке 4x4
    const selectedCells = this._chooseConnectedCells(G, targetRoomCount);

    // 3. Строим остовное дерево (DFS) и добавляем 1-2 петли
    const edges = this._buildGraph(selectedCells, G);

    // 4. Назначаем типы комнат
    const roomTypesMap = this._assignRoomTypes(selectedCells, edges);

    // 5. Создаём объекты Room
    const rooms = [];
    const roomsByCell = new Map();

    let idSeq = 0;
    for (const cellKey of selectedCells) {
      const [gx, gz] = cellKey.split(",").map(Number);
      const type = roomTypesMap.get(cellKey);
      let cfg = C.roomTypes[type];

      // Арены получают случайный размер и высоту потолка в заданном диапазоне
      if (type === "arena") {
        const size = Math.round(this.rng.range(C.arenaMinSize, C.arenaMaxSize));
        const height = Math.round(this.rng.range(C.arenaMinHeight, C.arenaMaxHeight));
        cfg = { ...cfg, w: size, d: size, h: height };
      }

      // Центр ячейки в мировых координатах
      const cx = (gx - (G - 1) / 2) * CS;
      const cz = (gz - (G - 1) / 2) * CS;
      const center = new THREE.Vector3(cx, 0, cz);

      const room = new Room(idSeq++, gx, gz, type, center, cfg);
      rooms.push(room);
      roomsByCell.set(cellKey, room);
    }

    // 6. Настраиваем двери в комнатах по рёбрам графа
    for (const [keyA, keyB] of edges) {
      const roomA = roomsByCell.get(keyA);
      const roomB = roomsByCell.get(keyB);
      if (!roomA || !roomB) continue;

      const dx = roomB.gx - roomA.gx;
      const dz = roomB.gz - roomA.gz;

      if (dx === 1 && dz === 0) {
        roomA.doors.east = true;
        roomA.doorNeighbors.east = roomB;
        roomB.doors.west = true;
        roomB.doorNeighbors.west = roomA;
      } else if (dx === -1 && dz === 0) {
        roomA.doors.west = true;
        roomA.doorNeighbors.west = roomB;
        roomB.doors.east = true;
        roomB.doorNeighbors.east = roomA;
      } else if (dx === 0 && dz === 1) {
        roomA.doors.south = true;
        roomA.doorNeighbors.south = roomB;
        roomB.doors.north = true;
        roomB.doorNeighbors.north = roomA;
      } else if (dx === 0 && dz === -1) {
        roomA.doors.north = true;
        roomA.doorNeighbors.north = roomB;
        roomB.doors.south = true;
        roomB.doorNeighbors.south = roomA;
      }
    }

    // 7. Генерируем арены по шаблонам (без повтора шаблона подряд)
    let lastTemplateId = null;
    const templateCounts = {};
    for (const room of rooms) {
      if (room.type !== "arena") continue;
      lastTemplateId = this._buildArena(room, lastTemplateId);
      templateCounts[lastTemplateId] = (templateCounts[lastTemplateId] || 0) + 1;
    }

    // 8. Строим 3D геометрию комнат
    for (const room of rooms) {
      room.buildGeometry();
    }

    // 9. Создаём коридоры между соединёнными комнатами
    const corridors = this._buildCorridors(edges, roomsByCell);

    // Находим start и exit комнаты
    const startRoom = rooms.find((r) => r.type === "start");
    const exitRoom = rooms.find((r) => r.type === "exit");

    // Собираем все AABB коллайдеры уровня
    const allBoxes = [];
    for (const room of rooms) {
      for (const b of room.boxes) {
        allBoxes.push(b);
      }
    }
    for (const corridor of corridors) {
      for (const b of corridor.boxes) {
        allBoxes.push(b);
      }
    }

    return {
      rooms,
      corridors,
      startRoom,
      exitRoom,
      allBoxes,
      roomsByCell,
      edges,
      templateCounts,
      seedStr: this.rng.seedStr
    };
  }

  /**
   * Выбор N связанных ячеек в сетке GxG
   */
  _chooseConnectedCells(G, targetCount) {
    const selected = new Set();
    // Стартуем из случайной ячейки
    const startX = this.rng.rangeInt(0, G - 1);
    const startZ = this.rng.rangeInt(0, G - 1);
    selected.add(`${startX},${startZ}`);

    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ];

    while (selected.size < targetCount) {
      // Ищем всех соседей уже выбранных ячеек
      const candidates = [];
      for (const cellKey of selected) {
        const [cx, cz] = cellKey.split(",").map(Number);
        for (const [dx, dz] of dirs) {
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx >= 0 && nx < G && nz >= 0 && nz < G) {
            const nKey = `${nx},${nz}`;
            if (!selected.has(nKey) && !candidates.includes(nKey)) {
              candidates.push(nKey);
            }
          }
        }
      }

      if (candidates.length === 0) break;
      const nextCell = this.rng.choice(candidates);
      selected.add(nextCell);
    }

    return selected;
  }

  /**
   * Построение остовного дерева (DFS) + 1-2 лишних рёбер для петель
   */
  _buildGraph(cellsSet, G) {
    const cellsList = Array.from(cellsSet);
    const root = this.rng.choice(cellsList);

    const edges = [];
    const edgeSet = new Set();
    const visited = new Set();

    const addEdge = (a, b) => {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push([a, b]);
      }
    };

    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ];

    // Randomized DFS
    const dfs = (cellKey) => {
      visited.add(cellKey);
      const [cx, cz] = cellKey.split(",").map(Number);

      const neighbors = [];
      for (const [dx, dz] of dirs) {
        const nx = cx + dx;
        const nz = cz + dz;
        const nKey = `${nx},${nz}`;
        if (cellsSet.has(nKey) && !visited.has(nKey)) {
          neighbors.push(nKey);
        }
      }

      this.rng.shuffle(neighbors);
      for (const nKey of neighbors) {
        if (!visited.has(nKey)) {
          addEdge(cellKey, nKey);
          dfs(nKey);
        }
      }
    };

    dfs(root);

    // Добавляем 1-2 лишних связи для циклов
    const extraCandidates = [];
    for (const cellA of cellsList) {
      const [ax, az] = cellA.split(",").map(Number);
      for (const [dx, dz] of dirs) {
        const bx = ax + dx;
        const bz = az + dz;
        const cellB = `${bx},${bz}`;
        if (cellsSet.has(cellB)) {
          const key = cellA < cellB ? `${cellA}|${cellB}` : `${cellB}|${cellA}`;
          if (!edgeSet.has(key) && !extraCandidates.includes(key)) {
            extraCandidates.push(key);
          }
        }
      }
    }

    const extraEdgeCount = Math.min(extraCandidates.length, this.rng.rangeInt(1, 2));
    this.rng.shuffle(extraCandidates);
    for (let i = 0; i < extraEdgeCount; i++) {
      const [a, b] = extraCandidates[i].split("|");
      addEdge(a, b);
    }

    return edges;
  }

  /**
   * Назначение типов комнат: start (1), exit (1, самая далёкая по числу переходов),
   * loot (1-2), arena (3-5)
   */
  _assignRoomTypes(cellsSet, edges) {
    const cells = Array.from(cellsSet);
    const adj = new Map();
    for (const c of cells) adj.set(c, []);
    for (const [a, b] of edges) {
      adj.get(a).push(b);
      adj.get(b).push(a);
    }

    // Выбираем стартовую комнату (предпочтительно с 1-2 связями с краю)
    const leaves = cells.filter((c) => adj.get(c).length <= 2);
    const startCell = leaves.length > 0 ? this.rng.choice(leaves) : this.rng.choice(cells);

    // BFS от startCell для нахождения расстояний (в переходах)
    const dist = new Map();
    const queue = [startCell];
    dist.set(startCell, 0);

    while (queue.length > 0) {
      const cur = queue.shift();
      const d = dist.get(cur);
      for (const n of adj.get(cur)) {
        if (!dist.has(n)) {
          dist.set(n, d + 1);
          queue.push(n);
        }
      }
    }

    // exit — самая далёкая от start по числу переходов
    let maxDist = -1;
    let exitCell = null;
    for (const [c, d] of dist.entries()) {
      if (d > maxDist) {
        maxDist = d;
        exitCell = c;
      }
    }

    // Оставшиеся комнаты для распределения (loot и arena)
    const remaining = cells.filter((c) => c !== startCell && c !== exitCell);

    // loot комнат: 1-2 штуки
    const targetLootCount = remaining.length >= 7 ? 2 : 1;
    // Предпочитаем тупиковые или вторичные комнаты для loot
    remaining.sort((a, b) => adj.get(a).length - adj.get(b).length);
    const lootCells = remaining.slice(0, targetLootCount);
    const arenaCells = remaining.slice(targetLootCount);

    const typesMap = new Map();
    typesMap.set(startCell, "start");
    typesMap.set(exitCell, "exit");
    for (const c of lootCells) typesMap.set(c, "loot");
    for (const c of arenaCells) typesMap.set(c, "arena");

    return typesMap;
  }

  /**
   * Построить арену по случайному шаблону.
   * Шаблон выбирается из пула без повтора предыдущего; при неудачной
   * валидации (пересечения/проходы/двери/достижимость) пробуется другой
   * шаблон или другой вариант трансформации.
   * @param {Room} room
   * @param {string|null} lastTemplateId
   * @returns {string} id выбранного шаблона
   */
  _buildArena(room, lastTemplateId = null) {
    const pool = ARENA_TEMPLATES.filter((t) => t.id !== lastTemplateId);
    this.rng.shuffle(pool);

    for (const tpl of pool) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const layout = tpl.build(this.rng, room);
        const built = finalizeArenaLayout(layout, room, this.rng);

        room.blocks = built.blocks;
        room.pit = built.pit;
        room.arenaAllowCenter = layout.allowCenter === true;
        room.arenaTemplate = tpl.id;

        if (validateArenaRoom(room).ok) return tpl.id;
      }
    }

    // Резервный вариант, если ни один шаблон не прошёл валидацию
    room.blocks = this._fallbackArenaBlocks(room);
    room.pit = null;
    room.arenaAllowCenter = true;
    room.arenaTemplate = "fallback";
    return "fallback";
  }

  /**
   * Безопасная арена-заглушка: центральный монумент (landmark) и ярус 3.6 м со ступенями.
   * @param {Room} room
   */
  _fallbackArenaBlocks(room) {
    const cx = room.center.x;
    const cz = room.center.z;
    const tierH = 3.6;
    return [
      { x: cx, z: cz, w: 4, d: 4, y: 0, h: 9.0, kind: "landmark", walkable: false, groupId: 900 },
      { x: cx, z: cz + 10, w: 6, d: 5, y: 0, h: tierH, kind: "platform", walkable: true, groupId: 901 }
    ];
  }

  /**
   * Построение коридоров между комнатами
   */
  _buildCorridors(edges, roomsByCell) {
    const corridors = [];
    const T = CONFIG.level.wallThickness; // 1.0
    const dw = CONFIG.level.corridorWidth;  // 4.0
    const dh = CONFIG.level.corridorHeight; // 4.5

    for (const [keyA, keyB] of edges) {
      const roomA = roomsByCell.get(keyA);
      const roomB = roomsByCell.get(keyB);
      if (!roomA || !roomB) continue;

      const theme = roomA.theme || roomB.theme;
      const wallMat = getMaterial(theme.wall, {
        texture: "wall",
        theme,
        vertexColors: true
      });
      const floorMat = getMaterial(theme.floor, {
        texture: "floor",
        theme,
        vertexColors: true
      });
      const ceilMat = getMaterial(
        new THREE.Color(theme.ceiling).multiplyScalar(0.72).getHex(),
        { vertexColors: true }
      );

      const group = new THREE.Group();
      const boxes = [];
      const wallGeos = [];
      const floorGeos = [];
      const ceilGeos = [];
      const stripGeos = [];
      const stripH = 0.1;
      const stripT = 0.06;
      const stripY = stripH / 2 + 0.04;
      const stripInset = 0.045;

      const dx = roomB.gx - roomA.gx;
      const dz = roomB.gz - roomA.gz;

      if (dx !== 0) {
        // Горизонтальный коридор по оси X
        const leftRoom = dx > 0 ? roomA : roomB;
        const rightRoom = dx > 0 ? roomB : roomA;

        const x1 = leftRoom.center.x + leftRoom.w / 2;
        const x2 = rightRoom.center.x - rightRoom.w / 2;
        const cz = leftRoom.center.z;

        // Видимая часть коридора — только между внешними гранями стен комнат.
        // Иначе пол/потолок/боковые стены заходят в проём и совпадают с его
        // поверхностями, вызывая z-fighting (чёрные мигающие полосы).
        const sx1 = x1 + T;
        const sx2 = x2 - T;
        const sLen = Math.max(0.1, sx2 - sx1);
        const sMid = (sx1 + sx2) / 2;

        // Пол
        const floorGeo = new THREE.BoxGeometry(sLen, 0.4, dw);
        floorGeo.translate(sMid, -0.2, cz);
        floorGeos.push(floorGeo);
        boxes.push({
          min: new THREE.Vector3(x1, -1.0, cz - dw / 2),
          max: new THREE.Vector3(x2, 0.0, cz + dw / 2)
        });

        // Потолок
        const ceilGeo = new THREE.BoxGeometry(sLen, 0.4, dw);
        ceilGeo.translate(sMid, dh + 0.2, cz);
        ceilGeos.push(ceilGeo);
        boxes.push({
          min: new THREE.Vector3(x1, dh, cz - dw / 2),
          max: new THREE.Vector3(x2, dh + 1.0, cz + dw / 2)
        });

        // Северная стена (-Z)
        const wallNGeo = new THREE.BoxGeometry(sLen, dh, T);
        wallNGeo.translate(sMid, dh / 2, cz - dw / 2 - T / 2);
        wallGeos.push(wallNGeo);
        boxes.push({
          min: new THREE.Vector3(x1, 0, cz - dw / 2 - T),
          max: new THREE.Vector3(x2, dh, cz - dw / 2)
        });

        // Южная стена (+Z)
        const wallSGeo = new THREE.BoxGeometry(sLen, dh, T);
        wallSGeo.translate(sMid, dh / 2, cz + dw / 2 + T / 2);
        wallGeos.push(wallSGeo);
        boxes.push({
          min: new THREE.Vector3(x1, 0, cz + dw / 2),
          max: new THREE.Vector3(x2, dh, cz + dw / 2 + T)
        });

        // Светящиеся полосы по низу стен коридора
        for (const side of [-1, 1]) {
          const sg = new THREE.BoxGeometry(sLen - 0.4, stripH, stripT);
          sg.translate(
            sMid,
            stripY,
            cz + side * (dw / 2) - side * stripInset
          );
          stripGeos.push(sg);
        }
      } else if (dz !== 0) {
        // Вертикальный коридор по оси Z
        const topRoom = dz > 0 ? roomA : roomB;
        const botRoom = dz > 0 ? roomB : roomA;

        const z1 = topRoom.center.z + topRoom.d / 2;
        const z2 = botRoom.center.z - botRoom.d / 2;
        const cx = topRoom.center.x;

        // Аналогично горизонтальному коридору — не заходим внутрь стен комнат
        const sz1 = z1 + T;
        const sz2 = z2 - T;
        const sLen = Math.max(0.1, sz2 - sz1);
        const sMid = (sz1 + sz2) / 2;

        // Пол
        const floorGeo = new THREE.BoxGeometry(dw, 0.4, sLen);
        floorGeo.translate(cx, -0.2, sMid);
        floorGeos.push(floorGeo);
        boxes.push({
          min: new THREE.Vector3(cx - dw / 2, -1.0, z1),
          max: new THREE.Vector3(cx + dw / 2, 0.0, z2)
        });

        // Потолок
        const ceilGeo = new THREE.BoxGeometry(dw, 0.4, sLen);
        ceilGeo.translate(cx, dh + 0.2, sMid);
        ceilGeos.push(ceilGeo);
        boxes.push({
          min: new THREE.Vector3(cx - dw / 2, dh, z1),
          max: new THREE.Vector3(cx + dw / 2, dh + 1.0, z2)
        });

        // Западная стена (-X)
        const wallWGeo = new THREE.BoxGeometry(T, dh, sLen);
        wallWGeo.translate(cx - dw / 2 - T / 2, dh / 2, sMid);
        wallGeos.push(wallWGeo);
        boxes.push({
          min: new THREE.Vector3(cx - dw / 2 - T, 0, z1),
          max: new THREE.Vector3(cx - dw / 2, dh, z2)
        });

        // Восточная стена (+X)
        const wallEGeo = new THREE.BoxGeometry(T, dh, sLen);
        wallEGeo.translate(cx + dw / 2 + T / 2, dh / 2, sMid);
        wallGeos.push(wallEGeo);
        boxes.push({
          min: new THREE.Vector3(cx + dw / 2, 0, z1),
          max: new THREE.Vector3(cx + dw / 2 + T, dh, z2)
        });

        // Светящиеся полосы по низу стен коридора
        for (const side of [-1, 1]) {
          const sg = new THREE.BoxGeometry(stripT, stripH, sLen - 0.4);
          sg.translate(
            cx + side * (dw / 2) - side * stripInset,
            stripY,
            sMid
          );
          stripGeos.push(sg);
        }
      }

      // Слияние мешей коридора
      if (wallGeos.length > 0) {
        const mergedWall = BufferGeometryUtils.mergeGeometries(wallGeos);
        applyWorldUVs(mergedWall, 4);
        applyAO(mergedWall, { mode: "wall", minY: 0, maxY: dh });
        group.add(outlined(mergedWall, wallMat, 25));
      }
      if (floorGeos.length > 0) {
        const mergedFloor = BufferGeometryUtils.mergeGeometries(floorGeos);
        applyWorldUVs(mergedFloor, 6);
        applyAO(mergedFloor, { mode: "floor" });
        group.add(outlined(mergedFloor, floorMat, 25));
      }
      if (ceilGeos.length > 0) {
        const mergedCeil = BufferGeometryUtils.mergeGeometries(ceilGeos);
        applyAO(mergedCeil, { mode: "ceiling" });
        group.add(outlined(mergedCeil, ceilMat, 25));
      }
      if (stripGeos.length > 0) {
        const mergedStrips = BufferGeometryUtils.mergeGeometries(stripGeos);
        group.add(new THREE.Mesh(mergedStrips, getEmissiveMaterial(theme.accent, 1.7)));
      }

      corridors.push({
        roomA,
        roomB,
        group,
        boxes
      });
    }

    return corridors;
  }

  /**
   * Проверка корректности сгенерированного уровня
   * @param {Object} levelData
   * @returns {boolean}
   */
  validateLevel(levelData) {
    const { rooms, startRoom, exitRoom, edges } = levelData;

    // 1. Проверка наличия комнат start и exit
    if (!startRoom || !exitRoom) {
      console.warn("validateLevel: no startRoom or exitRoom");
      return false;
    }

    // 2. Проверка пути от start до exit (BFS)
    const adj = new Map();
    for (const r of rooms) adj.set(r.id, []);
    for (const [aKey, bKey] of edges) {
      const ra = levelData.roomsByCell.get(aKey);
      const rb = levelData.roomsByCell.get(bKey);
      if (ra && rb) {
        adj.get(ra.id).push(rb.id);
        adj.get(rb.id).push(ra.id);
      }
    }

    const visited = new Set();
    const queue = [startRoom.id];
    visited.add(startRoom.id);

    while (queue.length > 0) {
      const cur = queue.shift();
      if (cur === exitRoom.id) break;
      for (const n of adj.get(cur) || []) {
        if (!visited.has(n)) {
          visited.add(n);
          queue.push(n);
        }
      }
    }
    if (!visited.has(exitRoom.id)) {
      console.warn("validateLevel: no path from start to exit");
      return false;
    }

    // 3. Проверка комнат на отсутствие пересечений
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const a = rooms[i].bounds;
        const b = rooms[j].bounds;
        if (
          a.min.x < b.max.x &&
          a.max.x > b.min.x &&
          a.min.z < b.max.z &&
          a.max.z > b.min.z
        ) {
          console.warn(`validateLevel: room overlap between ${rooms[i].id} and ${rooms[j].id}`);
          return false; // Недопустимое пересечение комнат
        }
      }
    }

    // 4. Проверка геометрии арен по шаблонам (пересечения, проходы, двери,
    //    центр и достижимость платформ)
    for (const r of rooms) {
      if (r.type !== "arena" || r.blocks.length === 0) continue;
      const check = validateArenaRoom(r);
      if (!check.ok) {
        if (typeof console !== "undefined") {
          console.warn(
            `Арена ${r.id} (${r.arenaTemplate || "?"}) не прошла проверку:`,
            check.issues.join(", ")
          );
        }
        return false;
      }
    }

    return true;
  }
}

/**
 * Автотест генерации уровней: проверяет заданное количество уровней (по умолчанию 50).
 * Проверяет:
 * 1. Все платформы и ярусы достижимы пешком по ступеням (BFS).
 * 2. Проходы между препятствиями не уже 4.0 м.
 * 3. В каждой арене есть центральная структура-ориентир (landmark).
 * 4. Структуры не перекрывают двери и проходы.
 * @param {number} [count=50]
 * @returns {{ ok: boolean, count: number, totalArenas: number, passedArenas: number, issues: string[] }}
 */
export function testLevels(count = 50) {
  const gen = new LevelGenerator();
  let totalArenas = 0;
  let passedArenas = 0;
  const issues = [];

  for (let seed = 1; seed <= count; seed++) {
    const level = gen.generate(seed);
    for (const room of level.rooms) {
      if (room.type !== "arena") continue;
      totalArenas++;
      const res = validateArenaRoom(room);
      if (!res.ok) {
        issues.push(`Сид ${seed} арена ${room.id} (${room.arenaTemplate}): ${res.issues.join(", ")}`);
      } else {
        passedArenas++;
      }
    }
  }

  const ok = issues.length === 0;
  return { ok, count, totalArenas, passedArenas, issues };
}
