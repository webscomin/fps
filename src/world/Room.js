// Класс комнаты процедурного уровня
// Управляет геометрией, проёмами в стенах под коридоры, препятствиями арены и коллайдерами
import * as THREE from "three";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import { CONFIG } from "../config.js";
import { EDGE_MAT, outlined } from "../core/Physics.js";
import Themes, { createRoomRng, pickRoomTheme } from "./Themes.js";
import { buildRoomDecor } from "./Decor.js";
import {
  getMaterial,
  getEmissiveMaterial,
  applyWorldUVs,
  applyAO
} from "./Materials.js";

const _atmoColor = new THREE.Color();
const _atmoFog = new THREE.Color();
const _dangerColor = new THREE.Color(0xff2233);
const _dangerFog = new THREE.Color(0x2a0a0a);

export class Room {
  /**
   * @param {number} id
   * @param {number} gx
   * @param {number} gz
   * @param {string} type - "start" | "arena" | "loot" | "exit"
   * @param {THREE.Vector3} center
   * @param {Object} cfg - конфигурация типа из CONFIG.level.roomTypes
   */
  constructor(id, gx, gz, type, center, cfg) {
    this.id = id;
    this.gx = gx;
    this.gz = gz;
    this.type = type;
    this.center = center;
    this.w = cfg.w;
    this.d = cfg.d;
    this.h = cfg.h;
    this.cfg = cfg;

    // Двери на 4 стороны (north: -Z, south: +Z, west: -X, east: +X)
    this.doors = { north: false, south: false, west: false, east: false };
    this.doorNeighbors = {};

    // Границы комнаты
    this.bounds = {
      min: new THREE.Vector3(this.center.x - this.w / 2, 0, this.center.z - this.d / 2),
      max: new THREE.Vector3(this.center.x + this.w / 2, this.h, this.center.z + this.d / 2)
    };

    // Все AABB коллайдеры комнаты (стены, пол, потолок, препятствия)
    this.boxes = [];
    // Список препятствий (для арен)
    this.blocks = [];
    // Яма арены (отверстие в полу) и активные ловушки комнаты
    this.pit = null;
    this.hazards = [];
    this._hazardCd = 0;

    // Группа Three.js для рендеринга
    this.group = new THREE.Group();
    this.lights = [];
    this.lightAnchors = [];

    // Визуальная тема комнаты и декор (детерминированы данными комнаты)
    this._themeRng = Themes.createRoomRng(this, "theme");
    this.theme = Themes.pickRoomTheme(this, this._themeRng);
    this._decorRng = createRoomRng(this, "decor");
    const decorCfg = CONFIG.level.decor || {};
    this.flicker = this._decorRng.next() < (decorCfg.flickerChance != null ? decorCfg.flickerChance : 0.2);
    this.decor = null;
    this._atmoTime = 0;
    this._emergency = 0;
    this._lightBaseColors = [];
    this._lightBaseIntensities = [];

    // Цвета материалов
    this.floorColor = this.theme.floor;
    this.wallColor = this.theme.wall;
  }

  /**
   * Построение геометрии комнаты: пол, потолок, стены с проёмами, препятствия
   * Геометрия сливается по материалам для минимизации draw calls
   */
  buildGeometry() {
    const cx = this.center.x;
    const cz = this.center.z;
    const w = this.w;
    const d = this.d;
    const h = this.h;
    const T = CONFIG.level.wallThickness;
    const dw = CONFIG.level.corridorWidth;   // 4.0
    const dh = CONFIG.level.corridorHeight;  // 4.5
    const theme = this.theme;

    const wallGeos = [];
    const floorGeos = [];
    const ceilGeos = [];
    const obstacleGeos = [];
    const pitGeos = [];

    // Вспомогательная функция создания коробки с сохранением позиции в геометрии
    const createBox = (bx, by, bz, bw, bh, bd, addCollider = true, isObstacle = false) => {
      const geo = new THREE.BoxGeometry(bw, bh, bd);
      geo.translate(bx, by, bz);

      if (addCollider) {
        const min = new THREE.Vector3(bx - bw / 2, by - bh / 2, bz - bd / 2);
        const max = new THREE.Vector3(bx + bw / 2, by + bh / 2, bz + bd / 2);
        this.boxes.push({ min, max, isObstacle });
      }
      return geo;
    };

    // 1. ПОЛ
    // Плита пола заходит под стены на толщину T: это закрывает порог проёма
    // полом цвета комнаты и исключает наложение на пол коридора.
    // При наличии ямы пол собирается из 4 плит вокруг отверстия.
    const pit = this.pit;
    const addFloorSlab = (x0, x1, z0, z1) => {
      if (x1 - x0 < 0.01 || z1 - z0 < 0.01) return;
      const geo = new THREE.BoxGeometry(x1 - x0, 0.4, z1 - z0);
      geo.translate((x0 + x1) / 2, -0.2, (z0 + z1) / 2);
      floorGeos.push(geo);
      this.boxes.push({
        min: new THREE.Vector3(x0, -1.0, z0),
        max: new THREE.Vector3(x1, 0.0, z1)
      });
    };

    const fx0 = cx - w / 2 - T;
    const fx1 = cx + w / 2 + T;
    const fz0 = cz - d / 2 - T;
    const fz1 = cz + d / 2 + T;

    if (!pit) {
      addFloorSlab(fx0, fx1, fz0, fz1);
    } else {
      const hx0 = Math.max(cx - w / 2 + 1, pit.x - pit.w / 2);
      const hx1 = Math.min(cx + w / 2 - 1, pit.x + pit.w / 2);
      const hz0 = Math.max(cz - d / 2 + 1, pit.z - pit.d / 2);
      const hz1 = Math.min(cz + d / 2 - 1, pit.z + pit.d / 2);

      addFloorSlab(fx0, fx1, fz0, hz0);
      addFloorSlab(fx0, fx1, hz1, fz1);
      addFloorSlab(fx0, hx0, hz0, hz1);
      addFloorSlab(hx1, fx1, hz0, hz1);

      // Стенки и дно ямы: тёмная геометрия с коллайдерами, чтобы игрок
      // падал внутрь, а не проскакивал под пол комнаты.
      const depth = pit.depth || CONFIG.level.pitDepth || 4;
      const addPitBox = (x0, x1, y0, y1, z0, z1) => {
        if (x1 - x0 < 0.01 || y1 - y0 < 0.01 || z1 - z0 < 0.01) return;
        const geo = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
        geo.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
        pitGeos.push(geo);
        this.boxes.push({
          min: new THREE.Vector3(x0, y0, z0),
          max: new THREE.Vector3(x1, y1, z1)
        });
      };
      const wt = 0.4;      // толщина стенок ямы
      const inset = 0.02;  // чтобы грани не совпадали с обрезом пола

      addPitBox(hx0 - 0.2, hx1 + 0.2, -depth - 0.4, -depth, hz0 - 0.2, hz1 + 0.2);
      addPitBox(hx0, hx1, -depth, 0, hz0 + inset, hz0 + inset + wt);
      addPitBox(hx0, hx1, -depth, 0, hz1 - inset - wt, hz1 - inset);
      addPitBox(hx0 + inset, hx0 + inset + wt, -depth, 0, hz0, hz1);
      addPitBox(hx1 - inset - wt, hx1 - inset, -depth, 0, hz0, hz1);

      this.hazards.push({
        type: "pit",
        minX: hx0,
        maxX: hx1,
        minZ: hz0,
        maxZ: hz1,
        floorY: -depth,
        damage: CONFIG.level.pitDamage || 10
      });
    }

    // 2. ПОТОЛОК
    const ceilGeo = new THREE.BoxGeometry(w, 0.4, d);
    ceilGeo.translate(cx, h + 0.2, cz);
    ceilGeos.push(ceilGeo);
    this.boxes.push({
      min: new THREE.Vector3(cx - w / 2, h, cz - d / 2),
      max: new THREE.Vector3(cx + w / 2, h + 1.0, cz + d / 2)
    });

    // 3. СТЕНЫ С ПРОЁМАМИ
    // Стены North и South закрывают углы (длина w + 2*T), West и East идут между ними (длина d)

    // --- СЕВЕРНАЯ СТЕНА (North, -Z) ---
    const zNorth = cz - d / 2 - T / 2;
    if (!this.doors.north) {
      wallGeos.push(createBox(cx, h / 2, zNorth, w + 2 * T, h, T));
    } else {
      // Проём 4x4.5 по центру. 3 части стены:
      const leftW = (w + 2 * T - dw) / 2;
      const leftX = cx - (w + 2 * T) / 2 + leftW / 2;
      wallGeos.push(createBox(leftX, h / 2, zNorth, leftW, h, T));

      const rightW = leftW;
      const rightX = cx + (w + 2 * T) / 2 - rightW / 2;
      wallGeos.push(createBox(rightX, h / 2, zNorth, rightW, h, T));

      if (h > dh) {
        const topH = h - dh;
        const topY = dh + topH / 2;
        wallGeos.push(createBox(cx, topY, zNorth, dw, topH, T));
      }
    }

    // --- ЮЖНАЯ СТЕНА (South, +Z) ---
    const zSouth = cz + d / 2 + T / 2;
    if (!this.doors.south) {
      wallGeos.push(createBox(cx, h / 2, zSouth, w + 2 * T, h, T));
    } else {
      const leftW = (w + 2 * T - dw) / 2;
      const leftX = cx - (w + 2 * T) / 2 + leftW / 2;
      wallGeos.push(createBox(leftX, h / 2, zSouth, leftW, h, T));

      const rightW = leftW;
      const rightX = cx + (w + 2 * T) / 2 - rightW / 2;
      wallGeos.push(createBox(rightX, h / 2, zSouth, rightW, h, T));

      if (h > dh) {
        const topH = h - dh;
        const topY = dh + topH / 2;
        wallGeos.push(createBox(cx, topY, zSouth, dw, topH, T));
      }
    }

    // --- ЗАПАДНАЯ СТЕНА (West, -X) ---
    const xWest = cx - w / 2 - T / 2;
    if (!this.doors.west) {
      wallGeos.push(createBox(xWest, h / 2, cz, T, h, d));
    } else {
      const topD = (d - dw) / 2;
      const topZ = cz - d / 2 + topD / 2;
      wallGeos.push(createBox(xWest, h / 2, topZ, T, h, topD));

      const botD = topD;
      const botZ = cz + d / 2 - botD / 2;
      wallGeos.push(createBox(xWest, h / 2, botZ, T, h, botD));

      if (h > dh) {
        const topH = h - dh;
        const topY = dh + topH / 2;
        wallGeos.push(createBox(xWest, topY, cz, T, topH, dw));
      }
    }

    // --- ВОСТОЧНАЯ СТЕНА (East, +X) ---
    const xEast = cx + w / 2 + T / 2;
    if (!this.doors.east) {
      wallGeos.push(createBox(xEast, h / 2, cz, T, h, d));
    } else {
      const topD = (d - dw) / 2;
      const topZ = cz - d / 2 + topD / 2;
      wallGeos.push(createBox(xEast, h / 2, topZ, T, h, topD));

      const botD = topD;
      const botZ = cz + d / 2 - botD / 2;
      wallGeos.push(createBox(xEast, h / 2, botZ, T, h, botD));

      if (h > dh) {
        const topH = h - dh;
        const topY = dh + topH / 2;
        wallGeos.push(createBox(xEast, topY, cz, T, topH, dw));
      }
    }

    // 4. ПРЕПЯТСТВИЯ И ПЛАТФОРМЫ (для арен)
    // Геометрия группируется по типу блока, чтобы каждый тип имел свой цвет:
    // укрытия/колонны, лестницы-рампы, платформы и мосты.
    const kindGeos = new Map();
    kindGeos.set("block", obstacleGeos); // постаменты лута тоже идут в группу block
    for (const blk of this.blocks) {
      const geo = createBox(blk.x, blk.y + blk.h / 2, blk.z, blk.w, blk.h, blk.d, true, true);
      const kind = blk.kind || "block";
      if (!kindGeos.has(kind)) kindGeos.set(kind, []);
      kindGeos.get(kind).push(geo);
    }

    // 5. ДЕКОРАТИВНЫЕ ЭЛЕМЕНТЫ ТИПОВ КОМНАТ
    if (this.type === "exit") {
      this.buildExitPortal();
    } else if (this.type === "loot") {
      this.buildLootPedestals(obstacleGeos, createBox);
    }

    // 6. ВСТРОЕННЫЙ ДЕКОР (без коллайдеров)
    this.decor = buildRoomDecor(this, this.theme, this._decorRng);
    if (this.decor.group.children.length > 0) {
      this.group.add(this.decor.group);
    }
    if (this.decor.lampMat) {
      this._lightBaseColors.push(new THREE.Color(this.decor.lampMat.color.getHex()));
    }

    // 6b. СВЕТЯЩИЕСЯ ПОЛОСЫ ПО НИЗУ СТЕН (цвет темы, попадают в bloom)
    const stripColor = theme.accent;
    const stripGeos = [];
    const stripH = 0.1;
    const stripT = 0.06;
    const stripY = stripH / 2 + 0.04;
    const stripInset = 0.045;
    const cornerPad = 0.35;
    const addStripX = (zBase, inward, a, b) => {
      if (b - a < 0.2) return;
      const geo = new THREE.BoxGeometry(b - a, stripH, stripT);
      geo.translate((a + b) / 2, stripY, zBase + inward * stripInset);
      stripGeos.push(geo);
    };
    const addStripZ = (xBase, inward, a, b) => {
      if (b - a < 0.2) return;
      const geo = new THREE.BoxGeometry(stripT, stripH, b - a);
      geo.translate(xBase + inward * stripInset, stripY, (a + b) / 2);
      stripGeos.push(geo);
    };
    const sx0 = cx - w / 2 + cornerPad;
    const sx1 = cx + w / 2 - cornerPad;
    const sz0 = cz - d / 2 + cornerPad;
    const sz1 = cz + d / 2 - cornerPad;
    const doorHalf = dw / 2 + 0.3;

    if (this.doors.north) {
      addStripX(cz - d / 2, 1, sx0, cx - doorHalf);
      addStripX(cz - d / 2, 1, cx + doorHalf, sx1);
    } else {
      addStripX(cz - d / 2, 1, sx0, sx1);
    }
    if (this.doors.south) {
      addStripX(cz + d / 2, -1, sx0, cx - doorHalf);
      addStripX(cz + d / 2, -1, cx + doorHalf, sx1);
    } else {
      addStripX(cz + d / 2, -1, sx0, sx1);
    }
    if (this.doors.west) {
      addStripZ(cx - w / 2, 1, sz0, cz - doorHalf);
      addStripZ(cx - w / 2, 1, cz + doorHalf, sz1);
    } else {
      addStripZ(cx - w / 2, 1, sz0, sz1);
    }
    if (this.doors.east) {
      addStripZ(cx + w / 2, -1, sz0, cz - doorHalf);
      addStripZ(cx + w / 2, -1, cz + doorHalf, sz1);
    } else {
      addStripZ(cx + w / 2, -1, sz0, sz1);
    }

    // 7. СЛИЯНИЕ ГЕОМЕТРИИ ПО МАТЕРИАЛАМ (BufferGeometryUtils.mergeGeometries)
    const bounds = this.bounds;
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
    // Потолок темнее стен и особенно тёмный в аренах
    const ceilColor = new THREE.Color(theme.ceiling)
      .multiplyScalar(this.type === "arena" ? 0.55 : 0.72)
      .getHex();
    const ceilMat = getMaterial(ceilColor, { vertexColors: true });
    const kindMat = (kind) => {
      const color =
        (theme.blocks && theme.blocks[kind]) ||
        Room.KIND_COLORS[kind] ||
        Room.KIND_COLORS.block;
      return getMaterial(color, {
        texture: "noise",
        theme,
        vertexColors: true,
        tint: true
      });
    };

    if (wallGeos.length > 0) {
      const mergedWalls = BufferGeometryUtils.mergeGeometries(wallGeos);
      applyWorldUVs(mergedWalls, 4);
      applyAO(mergedWalls, {
        mode: "wall",
        minY: 0,
        maxY: h,
        minX: bounds.min.x,
        maxX: bounds.max.x,
        minZ: bounds.min.z,
        maxZ: bounds.max.z
      });
      const wallMesh = outlined(mergedWalls, wallMat, 25);
      this.group.add(wallMesh);
    }

    if (floorGeos.length > 0) {
      const mergedFloor = BufferGeometryUtils.mergeGeometries(floorGeos);
      applyWorldUVs(mergedFloor, 6);
      applyAO(mergedFloor, {
        mode: "floor",
        minX: bounds.min.x,
        maxX: bounds.max.x,
        minZ: bounds.min.z,
        maxZ: bounds.max.z
      });
      const floorMesh = outlined(mergedFloor, floorMat, 25);
      this.group.add(floorMesh);
    }

    if (ceilGeos.length > 0) {
      const mergedCeil = BufferGeometryUtils.mergeGeometries(ceilGeos);
      applyAO(mergedCeil, {
        mode: "ceiling",
        minX: bounds.min.x,
        maxX: bounds.max.x,
        minZ: bounds.min.z,
        maxZ: bounds.max.z
      });
      const ceilMesh = outlined(mergedCeil, ceilMat, 25);
      this.group.add(ceilMesh);
    }

    if (obstacleGeos.length > 0) {
      const mergedObstacles = BufferGeometryUtils.mergeGeometries(obstacleGeos);
      applyWorldUVs(mergedObstacles, 4);
      applyAO(mergedObstacles, { mode: "block", minY: 0, maxY: h });
      const obstMesh = outlined(mergedObstacles, kindMat("block"), 25);
      this.group.add(obstMesh);
    }

    // Прочие типы препятствий (рампы, платформы, мосты) — отдельными мешами
    for (const [kind, geos] of kindGeos) {
      if (kind === "block" || geos.length === 0) continue;
      const merged = BufferGeometryUtils.mergeGeometries(geos);
      applyWorldUVs(merged, 4);
      applyAO(merged, { mode: "block", minY: 0, maxY: h });
      this.group.add(outlined(merged, kindMat(kind), 25));
    }

    // Стенки и дно ямы — тёмный материал, чтобы яма читалась как провал
    if (pitGeos.length > 0) {
      const mergedPit = BufferGeometryUtils.mergeGeometries(pitGeos);
      applyWorldUVs(mergedPit, 3);
      applyAO(mergedPit, { mode: "block", minY: -8, maxY: 0, strength: 0.8 });
      const pitMat = getMaterial(0x14121f, {
        texture: "grate",
        theme,
        vertexColors: true
      });
      this.group.add(outlined(mergedPit, pitMat, 25));
    }

    // Светящаяся обводка низа стен
    if (stripGeos.length > 0) {
      const mergedStrips = BufferGeometryUtils.mergeGeometries(stripGeos);
      this.group.add(new THREE.Mesh(mergedStrips, getEmissiveMaterial(stripColor, 1.7)));
    }
  }

  /**
   * Обновление ловушек комнаты (яма арены): возврат игрока на край с уроном.
   * @param {number} dt
   * @param {Object} player
   * @param {Object} game
   */
  updateHazards(dt, player, game) {
    if (this._hazardCd > 0) {
      this._hazardCd = Math.max(0, this._hazardCd - dt);
      return;
    }
    if (!player || player.isDead || this.hazards.length === 0) return;

    for (const hz of this.hazards) {
      if (hz.type !== "pit") continue;
      const r = CONFIG.player.radius || 0.4;
      const overX = player.pos.x > hz.minX - r && player.pos.x < hz.maxX + r;
      const overZ = player.pos.z > hz.minZ - r && player.pos.z < hz.maxZ + r;
      // Игрок внутри ямы и уже провалился ниже уровня пола
      if (overX && overZ && player.pos.y < -0.9 && player.pos.y > hz.floorY - 0.5) {
        this._returnFromPit(player, game, hz);
        return;
      }
    }

    // Обновляем атмосферу этой комнаты: мигающие лампы, пульсирующие огоньки,
    // аварийная подсветка арены, туман/фон.
    this.updateAtmosphere(dt, game, player);
  }

  /**
   * Обновление атмосферы комнаты: свечение, пульсация, мигающие лампы (20%),
   * аварийная красная подсветка в активной арене, туман и фон под тему комнаты.
   * @param {number} dt
   * @param {Object} game
   * @param {Object} player
   */
  updateAtmosphere(dt, game, player) {
    this._atmoTime += dt;

    // 1. Проверяем, активна ли сейчас эта арена
    let arenaActive = false;
    if (this.type === "arena" && game && game.levelManager && game.levelManager.arenas) {
      for (const a of game.levelManager.arenas) {
        if (a.room === this && a.state === "active") {
          arenaActive = true;
          break;
        }
      }
    }

    const targetEmergency = arenaActive ? 1.0 : 0.0;
    this._emergency = THREE.MathUtils.lerp(this._emergency, targetEmergency, dt * 5.0);
    const hasEmergency = this._emergency > 0.01;
    // Аварийный строб: частота <= 3 Гц (2.5 Гц), яркость никогда не падает ниже 0.55
    const strobe = 0.85 + 0.3 * Math.sin(this._atmoTime * 5.0);

    const flickerAllowed = (CONFIG.graphics && CONFIG.graphics.flickerEnabled !== false);

    // 2. Аварийная красная подсветка в активной арене
    if (hasEmergency) {
      for (let i = 0; i < this.lightAnchors.length; i++) {
        const lt = this.lightAnchors[i];
        const baseCol = this._lightBaseColors[i] || _dangerColor;
        const baseInt = this._lightBaseIntensities[i] || 1.0;
        lt.color.copy(baseCol).lerp(_dangerColor, this._emergency);
        lt.intensity = THREE.MathUtils.lerp(baseInt, Math.max(0.55, baseInt * strobe), this._emergency);
      }
      if (this.decor && this.decor.lampMat) {
        const lampBase = this.decor.lampBase || new THREE.Color(this.theme.lamp);
        this.decor.lampMat.color.copy(lampBase).lerp(_dangerColor, this._emergency);
        if (this.decor.lampHalos) {
          for (const halo of this.decor.lampHalos) {
            halo.material.color.copy(this.decor.lampMat.color);
          }
        }
      }
    } else if (this.flicker && flickerAllowed && this.decor && this.decor.lampMat) {
      // 3. Мигающие лампы в 20% комнат (анимация яркости): частота <= 3 Гц, яркость НЕ ниже 55%
      const t = this._atmoTime * 2.8 + this.id * 13.37;
      let f = 0.78 + 0.18 * Math.sin(t) + 0.08 * Math.sin(t * 1.8);
      f = Math.max(0.55, Math.min(1.05, f)); // Яркость НИКОГДА не падает ниже 55%

      const lampBase = this.decor.lampBase || new THREE.Color(this.theme.lamp);
      this.decor.lampMat.color.copy(lampBase).multiplyScalar(f);
      if (this.decor.lampHalos) {
        for (const halo of this.decor.lampHalos) {
          halo.material.color.copy(this.decor.lampMat.color);
        }
      }

      for (let i = 0; i < this.lightAnchors.length; i++) {
        const baseInt = this._lightBaseIntensities[i] || 1.0;
        const baseCol = this._lightBaseColors[i] || new THREE.Color(this.theme.accent);
        this.lightAnchors[i].color.copy(baseCol);
        this.lightAnchors[i].intensity = baseInt * f;
      }
    } else {
      // Стабильный свет
      for (let i = 0; i < this.lightAnchors.length; i++) {
        const baseInt = this._lightBaseIntensities[i] || 1.0;
        const baseCol = this._lightBaseColors[i] || new THREE.Color(this.theme.accent);
        this.lightAnchors[i].color.copy(baseCol);
        this.lightAnchors[i].intensity = baseInt;
      }
      if (this.decor && this.decor.lampMat && this.decor.lampBase) {
        this.decor.lampMat.color.copy(this.decor.lampBase);
      }
    }

    // 4. Пульсирующие светящиеся диоды и колбы (из pulseMats)
    for (const p of this.decor?.pulseMats || []) {
      const v = 0.5 + 0.5 * Math.sin(this._atmoTime * p.speed + p.phase);
      p.mat.color.setRGB(v, v, v);
    }

    // 5. Динамический туман и фон, соответствующие теме комнаты, где находится игрок
    if (game && game.world && game.world.scene && player) {
      const px = player.pos.x;
      const pz = player.pos.z;
      const inRoom =
        px >= this.bounds.min.x &&
        px <= this.bounds.max.x &&
        pz >= this.bounds.min.z &&
        pz <= this.bounds.max.z;

      if (inRoom) {
        const targetFog = hasEmergency ? _dangerFog : _atmoFog.set(this.theme.fog);
        const targetBg = hasEmergency ? _dangerFog : _atmoColor.set(this.theme.background);
        if (game.world.scene.fog) {
          game.world.scene.fog.color.lerp(targetFog, dt * 3.5);
          // FogExp2: плотность по теме, видимость 55-70м
          if (game.world.scene.fog.density !== undefined) {
            const baseDensity = this.theme.fogDensity != null ? this.theme.fogDensity : 0.014;
            const targetDensity = Math.min(0.018, baseDensity * (hasEmergency ? 1.25 : 1.0));
            game.world.scene.fog.density = THREE.MathUtils.lerp(
              game.world.scene.fog.density,
              targetDensity,
              dt * 2.5
            );
          }
        }
        if (game.world.scene.background) {
          game.world.scene.background.lerp(targetBg, dt * 3.5);
        }
      }
    }
  }

  /**
   * Вернуть игрока из ямы на ближайший свободный край с уроном.
   * @param {Object} player
   * @param {Object} game
   * @param {Object} hz - данные ловушки
   */
  _returnFromPit(player, game, hz) {
    const r = CONFIG.player.radius || 0.4;
    const pad = 1.8;
    const bx0 = this.bounds.min.x + r + 0.4;
    const bx1 = this.bounds.max.x - r - 0.4;
    const bz0 = this.bounds.min.z + r + 0.4;
    const bz1 = this.bounds.max.z - r - 0.4;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    const candidates = [
      { x: clamp(player.pos.x, hz.minX + 1, hz.maxX - 1), z: hz.minZ - pad },
      { x: clamp(player.pos.x, hz.minX + 1, hz.maxX - 1), z: hz.maxZ + pad },
      { x: hz.minX - pad, z: clamp(player.pos.z, hz.minZ + 1, hz.maxZ - 1) },
      { x: hz.maxX + pad, z: clamp(player.pos.z, hz.minZ + 1, hz.maxZ - 1) }
    ];

    let target = null;
    let bestDist = Infinity;
    for (const c of candidates) {
      if (c.x < bx0 || c.x > bx1 || c.z < bz0 || c.z > bz1) continue;
      // Точка не должна оказаться внутри препятствия на высоте игрока
      let blocked = false;
      for (const b of this.blocks) {
        if (b.y + b.h <= 0.55 || b.y >= 1.8) continue;
        if (
          c.x + r > b.x - b.w / 2 &&
          c.x - r < b.x + b.w / 2 &&
          c.z + r > b.z - b.d / 2 &&
          c.z - r < b.z + b.d / 2
        ) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      const dist = Math.hypot(c.x - player.pos.x, c.z - player.pos.z);
      if (dist < bestDist) {
        bestDist = dist;
        target = c;
      }
    }

    // Резерв: точка перед ямой со стороны игрока, прижатая к границам комнаты
    if (!target) {
      target = {
        x: clamp(player.pos.x, bx0, bx1),
        z: clamp(hz.minZ - pad, bz0, bz1)
      };
    }

    player.pos.set(target.x, 0.05, target.z);
    player.vel.set(0, 0, 0);
    this._hazardCd = 0.5;

    if (game && player.takeDamage) {
      const src = new THREE.Vector3(
        (hz.minX + hz.maxX) / 2,
        hz.floorY,
        (hz.minZ + hz.maxZ) / 2
      );
      player.takeDamage(hz.damage, src, game);
    }
  }

  /**
   * Портал/лифт выхода из уровня в комнате exit
   */
  buildExitPortal() {
    const cx = this.center.x;
    const cz = this.center.z;

    // Круглый/восьмигранный постамент
    const padGeo = new THREE.CylinderGeometry(2.8, 3.2, 0.4, 8);
    const padMat = getMaterial(0x1b1340);
    const pad = outlined(padGeo, padMat);
    pad.position.set(cx, 0.2, cz);
    this.group.add(pad);
    this.boxes.push({
      min: new THREE.Vector3(cx - 3.0, 0, cz - 3.0),
      max: new THREE.Vector3(cx + 3.0, 0.4, cz + 3.0),
      isObstacle: true
    });

    // Светящееся кольцо портала
    const ringGeo = new THREE.TorusGeometry(1.6, 0.14, 8, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x4cc9f0, toneMapped: false });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(cx, 0.45, cz);
    this.group.add(ring);

    // Столб энергии/света
    const beamGeo = new THREE.CylinderGeometry(1.2, 1.2, 5.0, 16, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x4cc9f0,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(cx, 2.9, cz);
    this.group.add(beam);

    // Колонны портала
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const px = cx + Math.cos(ang) * 2.3;
      const pz = cz + Math.sin(ang) * 2.3;
      const colGeo = new THREE.BoxGeometry(0.4, 3.0, 0.4);
      const colMat = getMaterial(0x4361ee);
      const col = outlined(colGeo, colMat);
      col.position.set(px, 1.5, pz);
      this.group.add(col);
    }
  }

  /**
   * Постаменты в комнате с лутом (размещаются в стороне от осей дверей, чтобы не блокировать проход)
   */
  buildLootPedestals(obstacleGeos, createBox) {
    const cx = this.center.x;
    const cz = this.center.z;
    const hasEW = this.doors.west || this.doors.east;
    // Если двери на западе/востоке, ставим постаменты по оси Z (север-юг); иначе по оси X
    const ped1 = hasEW
      ? createBox(cx, 0.4, cz - 2.5, 1.6, 0.8, 1.6, true, true)
      : createBox(cx - 2.5, 0.4, cz, 1.6, 0.8, 1.6, true, true);
    const ped2 = hasEW
      ? createBox(cx, 0.4, cz + 2.5, 1.6, 0.8, 1.6, true, true)
      : createBox(cx + 2.5, 0.4, cz, 1.6, 0.8, 1.6, true, true);
    obstacleGeos.push(ped1, ped2);
  }

  /**
   * Освещение комнаты: дескрипторы источников света (light anchors).
   * Реальные PointLight НЕ создаются здесь и НЕ добавляются в group, чтобы не вызывать
   * перекомпиляцию шейдеров при изменении видимости комнаты.
   * Вместо этого World привязывает свой постоянный пул PointLight к ближайшим якорям.
   * @param {THREE.Scene} scene
   */
  buildLights(scene) {
    const theme = this.theme;
    const cx = this.center.x;
    const cz = this.center.z;
    const h = this.h;

    // Базовые цвета из темы
    const baseA = theme.lightA || theme.accent;
    const baseB = theme.lightB || theme.accent;

    this.lights = [];
    this.lightAnchors = [];
    this._lightBaseColors = [];
    this._lightBaseIntensities = [];

    const addLightAnchor = (color, intensity, dist, x, y, z) => {
      const anchor = {
        pos: new THREE.Vector3(x, y, z),
        color: new THREE.Color(color),
        baseColor: new THREE.Color(color),
        intensity: intensity,
        baseIntensity: intensity,
        distance: dist
      };
      this.lightAnchors.push(anchor);
      this._lightBaseColors.push(new THREE.Color(color));
      this._lightBaseIntensities.push(intensity);
    };

    if (this.type === "arena") {
      // 2 источника света по диагонали арены
      addLightAnchor(baseA, 0.95, 36, cx - 8, h - 1.5, cz - 8);
      addLightAnchor(baseB, 0.95, 36, cx + 8, h - 1.5, cz + 8);
      // Акцентная подсветка центральной структуры-ориентира (landmark)
      const landmarkLight = 0x00f5d4;
      addLightAnchor(landmarkLight, 1.25, 28, cx, 5.5, cz);
    } else if (this.type === "exit") {
      // 1 неоновый яркий свет в центре портала
      addLightAnchor(theme.accent, 1.4, 25, cx, 3.0, cz);
    } else if (this.type === "loot") {
      // 1 тёплый свет в комнате лута
      addLightAnchor(baseA, 1.1, 22, cx, h - 1.2, cz);
    } else {
      // Старт: 1 мягкий свет
      addLightAnchor(baseA, 0.85, 24, cx, h - 1.2, cz);
    }
  }

  destroy() {
    this.group.traverse((child) => {
      if (child.isMesh || child.isLineSegments) {
        if (child.geometry) child.geometry.dispose();
      }
      if (child.isSprite && child.material) {
        child.material.dispose();
      }
    });
    this.boxes = [];
    this.blocks = [];
    this.lights = [];
    this.lightAnchors = [];
    this.pit = null;
    this.hazards = [];
    this._hazardCd = 0;
    this.theme = null;
    this.decor = null;
    this._atmoTime = 0;
    this._emergency = 0;
    this._lightBaseColors = [];
    this._lightBaseIntensities = [];
    this._decorRng = null;
    this._themeRng = null;
  }
}

// Цвета препятствий по типу блока
Room.KIND_COLORS = {
  block: 0xff9f1c,
  ramp: 0xffd23f,
  platform: 0x9b5de5,
  bridge: 0x4cc9f0,
  landmark: 0x00f5d4
};