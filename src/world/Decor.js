// Визуальный декор комнат: трубы, панели, плакаты, лампы, вентиляция,
// напольные декали и тематические объекты.
// Декор не создаёт физических коллайдеров и не мешает передвижению игрока.
//
// ГАРАНТИЯ ОТСУТСТВИЯ ПЕРЕСЕЧЕНИЙ («застревания друг в друге»):
// Декор использует пространственные менеджеры слотов для каждой стены,
// потолка и пола (AABB 2D/3D slot allocation). Ни один элемент не может
// быть размещён поверх или внутри другого элемента.
//
// ПРОИЗВОДИТЕЛЬНОСТЬ:
// Вся статическая геометрия сливается в минимальное число мешей:
// - Lambert с vertex colors (непрозрачный);
// - Basic с vertex colors (светящиеся индикаторы);
// - Меш светильников с материалом lampMat (мигание в 20% комнат);
// - Два меша пульсирующих огоньков (pulseA, pulseB);
// - Прозрачные меши (лужи, стекло био-резервуаров);
// - Один меш напольного декоративного узора (текстура темы);
// - Контуры через LineSegments (EDGE_MAT).

import * as THREE from "three";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import { CONFIG } from "../config.js";
import { EDGE_MAT } from "../core/Physics.js";
import { getMaterial, createToonMaterial } from "./Materials.js";

// Кэш текстур
const _signCache = new Map();
const _paintColor = new THREE.Color();

/**
 * Ограничить яркость разметки пола: не светлее и не ярче основного пола более чем на 25%.
 * @param {number} markingHex
 * @param {number} floorHex
 * @returns {number}
 */
function clampMarkingColor(markingHex, floorHex) {
  const mCol = new THREE.Color(markingHex);
  const fCol = new THREE.Color(floorHex);
  const mLum = 0.2126 * mCol.r + 0.7152 * mCol.g + 0.0722 * mCol.b;
  const fLum = 0.2126 * fCol.r + 0.7152 * fCol.g + 0.0722 * fCol.b;
  const maxAllowedLum = Math.max(fLum * 1.25, 0.05);
  if (mLum > maxAllowedLum && mLum > 0.0001) {
    const scale = maxAllowedLum / mLum;
    mCol.r = Math.min(1, mCol.r * scale);
    mCol.g = Math.min(1, mCol.g * scale);
    mCol.b = Math.min(1, mCol.b * scale);
  }
  return mCol.getHex();
}

export const SIGN_TEXTS = [
  "НЕ КОРМИТЬ МУТАНТОВ",
  "ВОДКА — НЕ ТОПЛИВО",
  "СОБЛЮДАЙ ТИШИНУ. ОНИ СЛЫШАТ",
  "ВЫХОД ЗАПРЕЩЁН. ВСЕМ",
  "ПЕРЕРАБОТКА — ЭТО ЗАБОТА",
  "НЕ ТРОГАЙ РУБИЛЬНИК",
  "НОРМА — ЭТО ЧУВСТВО",
  "УЛЫБАЙСЯ. КАМЕРА ВСЁ ВИДИТ"
];

/**
 * Записать цвет в вершинный атрибут геометрии (для объединённых мешей с vertexColors)
 * @param {THREE.BufferGeometry} geo
 * @param {number|THREE.Color} color
 */
function paint(geo, color) {
  _paintColor.set(color);
  const count = geo.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = _paintColor.r;
    arr[i * 3 + 1] = _paintColor.g;
    arr[i * 3 + 2] = _paintColor.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return geo;
}

/**
 * Текстура плаката с абсурдной надписью.
 * @param {Object} theme
 * @param {string} text
 * @returns {THREE.CanvasTexture}
 */
function getSignTexture(theme, text) {
  const key = theme.id + "|" + text;
  const cached = _signCache.get(key);
  if (cached) return cached;

  if (typeof document === "undefined") {
    const dummy = new THREE.Texture();
    _signCache.set(key, dummy);
    return dummy;
  }

  const cv = document.createElement("canvas");
  cv.width = 512;
  cv.height = 256;
  const ctx = cv.getContext("2d");

  // Фон плаката
  ctx.fillStyle = theme.signBg || "#111827";
  ctx.fillRect(0, 0, 512, 256);

  // Рамка плаката
  ctx.strokeStyle = theme.signInk || "#ffffff";
  ctx.lineWidth = 12;
  ctx.strokeRect(12, 12, 488, 232);

  // Предупреждающая диагональная штриховка сверху и снизу
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = theme.signInk || "#ffffff";
  for (let x = -30; x < 550; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 20, 0);
    ctx.lineTo(x + 60, 36);
    ctx.lineTo(x + 40, 36);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(x, 256);
    ctx.lineTo(x + 20, 256);
    ctx.lineTo(x + 60, 220);
    ctx.lineTo(x + 40, 220);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1.0;

  // Текст с переносом строк
  ctx.fillStyle = theme.signInk || "#ffffff";
  ctx.font = "bold 42px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const words = text.split(" ");
  const lines = [];
  let curLine = "";
  for (const w of words) {
    const test = curLine ? curLine + " " + w : w;
    if (ctx.measureText(test).width > 440) {
      if (curLine) lines.push(curLine);
      curLine = w;
    } else {
      curLine = test;
    }
  }
  if (curLine) lines.push(curLine);

  const lineHeight = 50;
  const startY = 128 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((ln, i) => ctx.fillText(ln, 256, startY + i * lineHeight));

  // Заклёпки по углам
  ctx.fillStyle = theme.signInk || "#ffffff";
  for (const [bx, by] of [[28, 28], [484, 28], [28, 228], [484, 228]]) {
    ctx.beginPath();
    ctx.arc(bx, by, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.userData.shared = true;
  _signCache.set(key, tex);
  return tex;
}

/**
 * Проверка пересечения двух 2D прямоугольников [minA, maxA] и [minB, maxB]
 */
function rectsOverlap(aMinX, aMaxX, aMinY, aMaxY, bMinX, bMaxX, bMinY, bMaxY) {
  return aMinX < bMaxX && aMaxX > bMinX && aMinY < bMaxY && aMaxY > bMinY;
}

/**
 * Основная функция генерации декора комнаты
 * @param {Object} room
 * @param {Object} theme
 * @param {Rng} rng
 */
// Круглая текстура для ореола светильников
let _haloTexture = null;
function getLampHaloTexture() {
  if (_haloTexture) return _haloTexture;
  if (typeof document === "undefined") return null;
  const cv = document.createElement("canvas");
  cv.width = 64;
  cv.height = 64;
  const ctx = cv.getContext("2d");
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, "rgba(255, 255, 255, 0.45)");
  grad.addColorStop(0.35, "rgba(255, 255, 255, 0.18)");
  grad.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  _haloTexture = new THREE.CanvasTexture(cv);
  _haloTexture.userData.shared = true;
  return _haloTexture;
}

export function buildRoomDecor(room, theme, rng) {
  const group = new THREE.Group();
  const cfg = CONFIG.level.decor || {};
  if (cfg.enabled === false) {
    return { group, pulseMats: [], lampMat: null, lampBase: new THREE.Color(theme.lamp) };
  }

  const cx = room.center.x;
  const cz = room.center.z;
  const w = room.w;
  const d = room.d;
  const h = room.h;
  const C = CONFIG.level;
  const dw = C.corridorWidth;
  const dh = C.corridorHeight;

  const density = cfg.density != null ? cfg.density : 1.0;
  const count = (base) => Math.round(base * density);

  // Буферы геометрии для слияния
  const lambertGeos = [];
  const basicGeos = [];
  const lampGeos = [];
  const lampPositions = [];
  const pulseA = [];
  const pulseB = [];
  const edgeGeos = [];
  const transparentBuckets = new Map();

  // Вспомогательные функции построения фигур
  const boxAt = (bw, bh, bd, x, y, z, rotY, color, outline = true) => {
    const geo = new THREE.BoxGeometry(bw, bh, bd);
    if (rotY) geo.rotateY(rotY);
    geo.translate(x, y, z);
    paint(geo, color);
    lambertGeos.push(geo);
    if (outline) {
      edgeGeos.push(new THREE.EdgesGeometry(geo));
    }
  };

  const cylAt = (rt, rb, len, x, y, z, color, axis = "y", segs = 10, outline = false) => {
    const geo = new THREE.CylinderGeometry(rt, rb, len, segs);
    if (axis === "x") geo.rotateZ(Math.PI / 2);
    else if (axis === "z") geo.rotateX(Math.PI / 2);
    geo.translate(x, y, z);
    paint(geo, color);
    lambertGeos.push(geo);
    if (outline) {
      edgeGeos.push(new THREE.EdgesGeometry(geo));
    }
  };

  const glowBox = (bw, bh, bd, x, y, z, rotY, color) => {
    const geo = new THREE.BoxGeometry(bw, bh, bd);
    if (rotY) geo.rotateY(rotY);
    geo.translate(x, y, z);
    paint(geo, color);
    basicGeos.push(geo);
  };

  const pulseBox = (targetList, bw, bh, bd, x, y, z, rotY, color) => {
    const geo = new THREE.BoxGeometry(bw, bh, bd);
    if (rotY) geo.rotateY(rotY);
    geo.translate(x, y, z);
    paint(geo, color);
    targetList.push(geo);
  };

  const addTransparent = (kind, opacity, side, geo, color, isFloor = false) => {
    paint(geo, color);
    let b = transparentBuckets.get(kind);
    if (!b) {
      b = { opacity, side, geos: [], isFloor };
      transparentBuckets.set(kind, b);
    }
    b.geos.push(geo);
  };

  const addSolid = (geo, color, outline = false) => {
    paint(geo, color);
    lambertGeos.push(geo);
    if (outline) {
      edgeGeos.push(new THREE.EdgesGeometry(geo));
    }
  };

  // Стены комнаты: нормаль, тангенс и точка центра
  const walls = [
    { dir: "north", bx: cx, bz: cz - d / 2, tx: 1, tz: 0, nx: 0, nz: 1, rot: 0, len: w },
    { dir: "south", bx: cx, bz: cz + d / 2, tx: 1, tz: 0, nx: 0, nz: -1, rot: Math.PI, len: w },
    { dir: "west", bx: cx - w / 2, bz: cz, tx: 0, tz: 1, nx: 1, nz: 0, rot: Math.PI / 2, len: d },
    { dir: "east", bx: cx + w / 2, bz: cz, tx: 0, tz: 1, nx: -1, nz: 0, rot: -Math.PI / 2, len: d }
  ];

  const wallPoint = (wall, t, off) => ({
    x: wall.bx + wall.tx * t + wall.nx * off,
    z: wall.bz + wall.tz * t + wall.nz * off
  });

  const wallBox = (wall, t, y, tw, th, td, off, color, outline = true) => {
    const p = wallPoint(wall, t, off);
    boxAt(tw, th, td, p.x, y, p.z, wall.rot, color, outline);
  };

  const wallGlow = (wall, t, y, tw, th, td, off, color) => {
    const p = wallPoint(wall, t, off);
    glowBox(tw, th, td, p.x, y, p.z, wall.rot, color);
  };

  // =========================================================================
  // МЕНЕДЖЕРЫ ПРОСТРАНСТВЕННЫХ СЛОТОВ ДЛЯ ПРЕДОТВРАЩЕНИЯ ПЕРЕСЕЧЕНИЙ
  // =========================================================================

  // 1. Слоты стен: wall -> Array<{ minT, maxT, minY, maxY }>
  const wallOccupied = new Map();
  for (const wall of walls) {
    const occ = [];
    // Если на стене есть дверной проём, сразу резервируем проём с запасом
    if (room.doors[wall.dir]) {
      occ.push({
        minT: -dw / 2 - 0.45,
        maxT: dw / 2 + 0.45,
        minY: 0,
        maxY: dh + 0.5
      });
    }
    wallOccupied.set(wall, occ);
  }

  const isWallSlotFree = (wall, minT, maxT, minY, maxY) => {
    const span = wall.len / 2 - 0.3;
    if (minT < -span || maxT > span) return false;
    if (minY < 0.2 || maxY > h - 0.3) return false;
    const occ = wallOccupied.get(wall) || [];
    for (const r of occ) {
      if (rectsOverlap(minT, maxT, minY, maxY, r.minT, r.maxT, r.minY, r.maxY)) {
        return false;
      }
    }
    return true;
  };

  const reserveWallSlot = (wall, minT, maxT, minY, maxY) => {
    const occ = wallOccupied.get(wall);
    if (occ) occ.push({ minT, maxT, minY, maxY });
  };

  // 2. Слоты пола: Array<{ minX, maxX, minZ, maxZ }>
  const floorOccupied = [];

  // Препятствия и блоки арены
  for (const b of room.blocks || []) {
    floorOccupied.push({
      minX: b.x - b.w / 2 - 0.3,
      maxX: b.x + b.w / 2 + 0.3,
      minZ: b.z - b.d / 2 - 0.3,
      maxZ: b.z + b.d / 2 + 0.3
    });
  }

  // Яма (отверстие в полу)
  if (room.pit) {
    const pit = room.pit;
    const pitX0 = pit.x - pit.w / 2;
    const pitX1 = pit.x + pit.w / 2;
    const pitZ0 = pit.z - pit.d / 2;
    const pitZ1 = pit.z + pit.d / 2;
    floorOccupied.push({
      minX: pitX0 - 0.6,
      maxX: pitX1 + 0.6,
      minZ: pitZ0 - 0.6,
      maxZ: pitZ1 + 0.6
    });
  }

  // Зоны прохода перед дверями
  for (const wall of walls) {
    if (!room.doors[wall.dir]) continue;
    const doorClearDepth = 3.6;
    let minX, maxX, minZ, maxZ;
    if (wall.dir === "north") {
      minX = cx - dw / 2 - 0.3;
      maxX = cx + dw / 2 + 0.3;
      minZ = cz - d / 2 - 0.5;
      maxZ = cz - d / 2 + doorClearDepth;
    } else if (wall.dir === "south") {
      minX = cx - dw / 2 - 0.3;
      maxX = cx + dw / 2 + 0.3;
      minZ = cz + d / 2 - doorClearDepth;
      maxZ = cz + d / 2 + 0.5;
    } else if (wall.dir === "west") {
      minX = cx - w / 2 - 0.5;
      maxX = cx - w / 2 + doorClearDepth;
      minZ = cz - dw / 2 - 0.3;
      maxZ = cz + dw / 2 + 0.3;
    } else {
      minX = cx + w / 2 - doorClearDepth;
      maxX = cx + w / 2 + 0.5;
      minZ = cz - dw / 2 - 0.3;
      maxZ = cz + dw / 2 + 0.3;
    }
    floorOccupied.push({ minX, maxX, minZ, maxZ });
  }

  const isFloorSlotFree = (minX, maxX, minZ, maxZ, pad = 0.8) => {
    if (minX < cx - w / 2 + pad || maxX > cx + w / 2 - pad) return false;
    if (minZ < cz - d / 2 + pad || maxZ > cz + d / 2 - pad) return false;
    for (const r of floorOccupied) {
      if (rectsOverlap(minX, maxX, minZ, maxZ, r.minX, r.maxX, r.minZ, r.maxZ)) {
        return false;
      }
    }
    return true;
  };

  const reserveFloorSlot = (minX, maxX, minZ, maxZ) => {
    floorOccupied.push({ minX, maxX, minZ, maxZ });
  };

  // 3. Слоты потолка: Array<{ minX, maxX, minZ, maxZ }>
  const ceilingOccupied = [];
  // Блоки арены, доходящие почти до потолка
  for (const b of room.blocks || []) {
    if (b.y + b.h >= h - 1.6) {
      ceilingOccupied.push({
        minX: b.x - b.w / 2 - 0.4,
        maxX: b.x + b.w / 2 + 0.4,
        minZ: b.z - b.d / 2 - 0.4,
        maxZ: b.z + b.d / 2 + 0.4
      });
    }
  }

  const isCeilingSlotFree = (minX, maxX, minZ, maxZ) => {
    const pad = 1.2;
    if (minX < cx - w / 2 + pad || maxX > cx + w / 2 - pad) return false;
    if (minZ < cz - d / 2 + pad || maxZ > cz + d / 2 - pad) return false;
    for (const r of ceilingOccupied) {
      if (rectsOverlap(minX, maxX, minZ, maxZ, r.minX, r.maxX, r.minZ, r.maxZ)) {
        return false;
      }
    }
    return true;
  };

  const reserveCeilingSlot = (minX, maxX, minZ, maxZ) => {
    ceilingOccupied.push({ minX, maxX, minZ, maxZ });
  };

  // =========================================================================
  // 2. ТЕМАТИЧЕСКИЕ ОБЪЕКТЫ (ПРОПЫ У СТЕН)
  // =========================================================================
  // Пропы — самые крупные элементы, размещаются первыми и резервируют
  // как стену (wallSlot), так и пол (floorSlot).
  const propFn = {
    lab: buildLabProps,
    warehouse: buildWarehouseProps,
    server: buildServerProps,
    bio: buildBioProps
  }[theme.id];

  if (propFn) {
    const propCount = Math.min(4, Math.max(1, count(cfg.props != null ? cfg.props : 2.5)));
    let placedProps = 0;

    for (let attempt = 0; attempt < 32 && placedProps < propCount; attempt++) {
      const wall = rng.choice(walls);
      const span = wall.len / 2 - 1.8;
      if (span <= 0.5) continue;
      const t = rng.range(-span, span);

      // Примерные размеры зоны пропа
      const propW = 2.2;
      const propH = 2.4;
      const propDepth = 1.3;

      // Проверяем стену
      if (!isWallSlotFree(wall, t - propW / 2 - 0.3, t + propW / 2 + 0.3, 0.2, propH)) {
        continue;
      }

      // Проверяем пол
      const base = wallPoint(wall, t, 0);
      const corner1 = {
        x: base.x + wall.tx * (-propW / 2) + wall.nx * 0.1,
        z: base.z + wall.tz * (-propW / 2) + wall.nz * 0.1
      };
      const corner2 = {
        x: base.x + wall.tx * (propW / 2) + wall.nx * propDepth,
        z: base.z + wall.tz * (propW / 2) + wall.nz * propDepth
      };
      const minX = Math.min(corner1.x, corner2.x);
      const maxX = Math.max(corner1.x, corner2.x);
      const minZ = Math.min(corner1.z, corner2.z);
      const maxZ = Math.max(corner1.z, corner2.z);

      if (!isFloorSlotFree(minX - 0.2, maxX + 0.2, minZ - 0.2, maxZ + 0.2, 0.05)) {
        continue;
      }

      // Резервируем
      reserveWallSlot(wall, t - propW / 2 - 0.3, t + propW / 2 + 0.3, 0.2, propH);
      reserveFloorSlot(minX - 0.2, maxX + 0.2, minZ - 0.2, maxZ + 0.2);

      const ctx = {
        wall,
        base,
        rng,
        theme,
        roomH: h,
        pulseA,
        pulseB,
        at: (dt, dn) => ({
          x: base.x + wall.tx * dt + wall.nx * dn,
          z: base.z + wall.tz * dt + wall.nz * dn
        }),
        boxAt,
        cylAt,
        glowBox,
        pulseBox,
        addTransparent,
        addSolid
      };

      propFn(ctx);
      placedProps++;
    }
  }

  // =========================================================================
  // 3. ПЛАКАТЫ-ТАБЛО С АБСУРДНЫМИ НАДПИСЯМИ
  // =========================================================================
  const signCount = Math.min(2, Math.max(1, count(cfg.signs != null ? cfg.signs : 1.5)));
  const texts = rng.shuffle(SIGN_TEXTS.slice());
  let placedSigns = 0;

  for (let attempt = 0; attempt < 30 && placedSigns < signCount; attempt++) {
    const wall = rng.choice(walls);
    const sw = rng.range(2.0, 2.6);
    const sh = sw * 0.5;
    const span = wall.len / 2 - sw / 2 - 0.5;
    if (span <= 0.4) continue;

    const t = rng.range(-span, span);
    const y = rng.range(2.2, Math.min(3.6, h - 1.2));

    if (!isWallSlotFree(wall, t - sw / 2 - 0.35, t + sw / 2 + 0.35, y - sh / 2 - 0.35, y + sh / 2 + 0.35)) {
      continue;
    }

    reserveWallSlot(wall, t - sw / 2 - 0.35, t + sw / 2 + 0.35, y - sh / 2 - 0.35, y + sh / 2 + 0.35);

    // Рамка плаката
    wallBox(wall, t, y, sw + 0.16, sh + 0.16, 0.08, 0.05, theme.trim, true);

    // Текстурированная плоскость надписи
    const text = texts[placedSigns % texts.length];
    const geo = new THREE.PlaneGeometry(sw, sh);
    geo.rotateY(wall.rot);
    const p = wallPoint(wall, t, 0.1);
    geo.translate(p.x, y, p.z);
    const mat = new THREE.MeshBasicMaterial({ map: getSignTexture(theme, text) });
    group.add(new THREE.Mesh(geo, mat));

    placedSigns++;
  }

  // =========================================================================
  // 4. НАСТЕННЫЕ ПАНЕЛИ УПРАВЛЕНИЯ
  // =========================================================================
  const panelCount = Math.min(4, Math.max(1, count(cfg.panels != null ? cfg.panels : 3)));
  let placedPanels = 0;

  for (let attempt = 0; attempt < 40 && placedPanels < panelCount; attempt++) {
    const wall = rng.choice(walls);
    const tw = rng.range(1.2, 1.9);
    const th = rng.range(0.7, 1.2);
    const span = wall.len / 2 - tw / 2 - 0.5;
    if (span <= 0.4) continue;

    const t = rng.range(-span, span);
    const y = rng.range(1.5, Math.min(3.2, h - 1.2));

    // Исключаем наложение на другие панели, плакаты, пропы и двери!
    if (!isWallSlotFree(wall, t - tw / 2 - 0.35, t + tw / 2 + 0.35, y - th / 2 - 0.35, y + th / 2 + 0.35)) {
      continue;
    }

    reserveWallSlot(wall, t - tw / 2 - 0.35, t + tw / 2 + 0.35, y - th / 2 - 0.35, y + th / 2 + 0.35);

    // Корпус панели
    wallBox(wall, t, y, tw, th, 0.09, 0.08, theme.panel, true);

    // Кнопки-индикаторы на панели
    const cols = [theme.accent, theme.doorGlow];
    for (let k = 0; k < 2; k++) {
      const off = (k === 0 ? -1 : 1) * (tw / 2 - 0.22);
      const bp = wallPoint(wall, t + off, 0.14);
      glowBox(0.08, 0.08, 0.03, bp.x, y + th / 2 - 0.18, bp.z, wall.rot, cols[k]);
    }

    placedPanels++;
  }

  // =========================================================================
  // 5. ТРУБЫ НА СТЕНАХ
  // =========================================================================
  const pipeCount = Math.min(3, Math.max(1, count(cfg.pipes != null ? cfg.pipes : 2)));
  let placedPipes = 0;

  for (let attempt = 0; attempt < 30 && placedPipes < pipeCount; attempt++) {
    const wall = rng.choice(walls);
    const len = rng.range(2.6, Math.min(wall.len * 0.55, 6.5));
    const half = len / 2;
    const span = wall.len / 2 - half - 0.4;
    if (span <= 0.4) continue;

    const t = rng.range(-span, span);
    const y = rng.range(2.6, Math.min(h - 1.2, 5.5));
    const radius = rng.range(0.1, 0.16);

    if (!isWallSlotFree(wall, t - half - 0.2, t + half + 0.2, y - 0.3, y + 0.3)) {
      continue;
    }

    reserveWallSlot(wall, t - half - 0.2, t + half + 0.2, y - 0.3, y + 0.3);

    const p = wallPoint(wall, t, 0.18);
    const axis = wall.tx !== 0 ? "x" : "z";

    cylAt(radius, radius, len, p.x, y, p.z, theme.pipe, axis, 10, true);

    // Вертикальные отводы на концах
    const drops = rng.rangeInt(1, 2);
    for (let k = 0; k < drops; k++) {
      const sign = k === 0 ? -1 : 1;
      const ep = wallPoint(wall, t + sign * half, 0.18);
      const drop = rng.range(0.6, 1.4);
      cylAt(radius, radius, drop, ep.x, y - drop / 2, ep.z, theme.pipe, "y", 10, true);
    }

    // Хомуты-крепления
    const clampCount = Math.max(1, Math.round(len / 2.0));
    for (let k = 0; k < clampCount; k++) {
      const ct = t - half + (k + 0.5) * (len / clampCount);
      const cp = wallPoint(wall, ct, 0.12);
      if (axis === "x") {
        boxAt(0.1, 0.34, 0.1, cp.x, y, cp.z, 0, theme.trim, true);
      } else {
        boxAt(0.1, 0.34, 0.1, cp.x, y, cp.z, Math.PI / 2, theme.trim, true);
      }
    }

    placedPipes++;
  }

  // =========================================================================
  // 6. ПОТОЛОК: СВЕТИЛЬНИКИ И ВЕНТИЛЯЦИЯ
  // =========================================================================
  const lampCount = Math.max(1, count(cfg.lamps != null ? cfg.lamps : 3));
  let placedLamps = 0;

  for (let attempt = 0; attempt < 30 && placedLamps < lampCount; attempt++) {
    const lx = rng.range(cx - w / 2 + 2.5, cx + w / 2 - 2.5);
    const lz = rng.range(cz - d / 2 + 2.5, cz + d / 2 - 2.5);
    const hw = 1.0;
    const hd = 0.5;

    if (!isCeilingSlotFree(lx - hw - 0.8, lx + hw + 0.8, lz - hd - 0.8, lz + hd + 0.8)) {
      continue;
    }

    reserveCeilingSlot(lx - hw - 0.8, lx + hw + 0.8, lz - hd - 0.8, lz + hd + 0.8);

    // Корпус светильника
    boxAt(1.75, 0.1, 0.62, lx, h - 0.08, lz, 0, theme.metal, true);

    // Светящаяся панель светильника
    const lg = new THREE.BoxGeometry(1.45, 0.05, 0.42);
    lg.translate(lx, h - 0.15, lz);
    lampGeos.push(lg);
    lampPositions.push({ x: lx, y: h - 0.22, z: lz });

    placedLamps++;
  }

  const ventCount = Math.max(1, count(cfg.vents != null ? cfg.vents : 2));
  let placedVents = 0;

  for (let attempt = 0; attempt < 30 && placedVents < ventCount; attempt++) {
    const vx = rng.range(cx - w / 2 + 2.5, cx + w / 2 - 2.5);
    const vz = rng.range(cz - d / 2 + 2.5, cz + d / 2 - 2.5);
    const hw = 0.8;
    const hd = 0.6;

    if (!isCeilingSlotFree(vx - hw - 0.6, vx + hw + 0.6, vz - hd - 0.6, vz + hd + 0.6)) {
      continue;
    }

    reserveCeilingSlot(vx - hw - 0.6, vx + hw + 0.6, vz - hd - 0.6, vz + hd + 0.6);

    boxAt(1.3, 0.09, 0.8, vx, h - 0.06, vz, 0, theme.metal, true);
    for (let k = 0; k < 4; k++) {
      const zOff = -0.27 + k * 0.18;
      boxAt(1.02, 0.03, 0.09, vx, h - 0.12, vz + zOff, 0, theme.trim, false);
    }

    placedVents++;
  }

  // =========================================================================
  // 7. СВЕТЯЩАЯСЯ ОБВОДКА ДВЕРНЫХ ПРОЁМОВ (ЦВЕТ СВЕТА ДВЕРЕЙ ТЕМЫ)
  // =========================================================================
  for (const wall of walls) {
    if (!room.doors[wall.dir]) continue;
    // Верхняя рамка над проёмом
    wallGlow(wall, 0, dh + 0.16, dw + 0.5, 0.16, 0.12, 0.08, theme.doorGlow);
    // Боковые стойки проёма
    for (const side of [-1, 1]) {
      const t = side * (dw / 2 + 0.22);
      wallGlow(wall, t, dh / 2, 0.12, dh, 0.12, 0.08, theme.doorGlow);
    }
  }

  // =========================================================================
  // 8. ДЕКОРАЦИИ ПОЛА: РАЗМЕТКА, ПЯТНА, ЛУЖИ, БУМАГИ
  // Все накладки подняты минимум до y = 0.032 и используют polygonOffset,
  // чтобы полностью исключить z-fighting с основным полом комнат.
  // =========================================================================
  const floorOverlayGeos = [];

  // Разметка пола (не светлее и не ярче пола больше чем на 25%)
  const markingCount = count(cfg.markings != null ? cfg.markings : 3);
  let placedMarkings = 0;
  for (let attempt = 0; attempt < 25 && placedMarkings < markingCount; attempt++) {
    const len = rng.range(1.5, 3.2);
    const thick = rng.range(0.18, 0.28);
    const rot = rng.next() < 0.5 ? 0 : Math.PI / 2;
    const mx = rng.range(cx - w / 2 + 2, cx + w / 2 - 2);
    const mz = rng.range(cz - d / 2 + 2, cz + d / 2 - 2);

    const halfX = (rot === 0 ? len : thick) / 2;
    const halfZ = (rot === 0 ? thick : len) / 2;

    if (!isFloorSlotFree(mx - halfX, mx + halfX, mz - halfZ, mz + halfZ)) {
      continue;
    }

    reserveFloorSlot(mx - halfX - 0.2, mx + halfX + 0.2, mz - halfZ - 0.2, mz + halfZ + 0.2);

    const geo = new THREE.PlaneGeometry(rot === 0 ? len : thick, rot === 0 ? thick : len);
    geo.rotateX(-Math.PI / 2);
    geo.translate(mx, 0.032, mz);
    const markingCol = clampMarkingColor(theme.marking, theme.floor);
    paint(geo, markingCol);
    floorOverlayGeos.push(geo);

    placedMarkings++;
  }

  // Пятна (полупрозрачные, на высоте 0.034 с polygonOffset)
  const stainCount = count(cfg.stains != null ? cfg.stains : 2.5);
  let placedStains = 0;
  for (let attempt = 0; attempt < 20 && placedStains < stainCount; attempt++) {
    const r = rng.range(0.6, 1.4);
    const sx = rng.range(cx - w / 2 + 2, cx + w / 2 - 2);
    const sz = rng.range(cz - d / 2 + 2, cz + d / 2 - 2);

    if (!isFloorSlotFree(sx - r, sx + r, sz - r, sz + r)) {
      continue;
    }

    const geo = new THREE.CircleGeometry(r, 12);
    geo.rotateX(-Math.PI / 2);
    geo.scale(1, 1, rng.range(0.7, 1.3));
    geo.translate(sx, 0.034, sz);
    addTransparent("floor_stain", 0.36, THREE.FrontSide, geo, theme.stain, true);

    placedStains++;
  }

  // Лужи (полупрозрачные, на высоте 0.036 с polygonOffset)
  const puddleCount = count(cfg.puddles != null ? cfg.puddles : 2.5);
  let placedPuddles = 0;
  for (let attempt = 0; attempt < 20 && placedPuddles < puddleCount; attempt++) {
    const r = rng.range(0.5, 1.2);
    const px = rng.range(cx - w / 2 + 2, cx + w / 2 - 2);
    const pz = rng.range(cz - d / 2 + 2, cz + d / 2 - 2);

    if (!isFloorSlotFree(px - r, px + r, pz - r, pz + r)) {
      continue;
    }

    const geo = new THREE.CircleGeometry(r, 12);
    geo.rotateX(-Math.PI / 2);
    geo.scale(1, 1, rng.range(0.6, 1.4));
    geo.translate(px, 0.036, pz);
    addTransparent("floor_puddle", 0.52, THREE.FrontSide, geo, theme.puddle, true);

    placedPuddles++;
  }

  // Разбросанные бумаги (на высоте 0.038)
  const paperCount = count(cfg.papers != null ? cfg.papers : 5);
  for (let i = 0; i < paperCount; i++) {
    const px = rng.range(cx - w / 2 + 1.8, cx + w / 2 - 1.8);
    const pz = rng.range(cz - d / 2 + 1.8, cz + d / 2 - 1.8);
    if (!isFloorSlotFree(px - 0.25, px + 0.25, pz - 0.25, pz + 0.25)) continue;

    const geo = new THREE.PlaneGeometry(0.36, 0.5);
    geo.rotateX(-Math.PI / 2);
    geo.rotateY(rng.range(0, Math.PI * 2));
    geo.translate(px, 0.038 + rng.range(0, 0.004), pz);
    paint(geo, theme.paper);
    floorOverlayGeos.push(geo);
  }

  // =========================================================================
  // 9. СЛИЯНИЕ МЕШЕЙ И ОПТИМИЗАЦИЯ DRAW CALLS
  // =========================================================================
  if (lambertGeos.length > 0) {
    const merged = BufferGeometryUtils.mergeGeometries(lambertGeos);
    const mat = getMaterial(0xffffff, { vertexColors: true });
    group.add(new THREE.Mesh(merged, mat));
  }

  if (floorOverlayGeos.length > 0) {
    const merged = BufferGeometryUtils.mergeGeometries(floorOverlayGeos);
    const mat = getMaterial(0xffffff, {
      vertexColors: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });
    group.add(new THREE.Mesh(merged, mat));
  }

  if (basicGeos.length > 0) {
    const merged = BufferGeometryUtils.mergeGeometries(basicGeos);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    group.add(new THREE.Mesh(merged, mat));
  }

  let lampMat = null;
  const lampHalos = [];
  if (lampGeos.length > 0) {
    const merged = BufferGeometryUtils.mergeGeometries(lampGeos);
    lampMat = new THREE.MeshBasicMaterial({ color: theme.lamp, toneMapped: false });
    group.add(new THREE.Mesh(merged, lampMat));

    // Спрайтовые ореолы светильников (subtle lamp halo)
    const haloTex = getLampHaloTexture();
    if (haloTex) {
      for (const pos of lampPositions) {
        const haloMat = new THREE.SpriteMaterial({
          map: haloTex,
          color: theme.lamp,
          transparent: true,
          opacity: 0.32,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        });
        const sprite = new THREE.Sprite(haloMat);
        sprite.position.set(pos.x, pos.y, pos.z);
        sprite.scale.set(2.4, 2.4, 1.0);
        group.add(sprite);
        lampHalos.push(sprite);
      }
    }
  }

  const pulseMats = [];
  if (pulseA.length > 0) {
    const merged = BufferGeometryUtils.mergeGeometries(pulseA);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    group.add(new THREE.Mesh(merged, mat));
    pulseMats.push({ mat, phase: 0, speed: 6.2 });
  }
  if (pulseB.length > 0) {
    const merged = BufferGeometryUtils.mergeGeometries(pulseB);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    group.add(new THREE.Mesh(merged, mat));
    pulseMats.push({ mat, phase: Math.PI * 0.7, speed: 8.5 });
  }

  for (const bucket of transparentBuckets.values()) {
    if (bucket.geos.length === 0) continue;
    const merged = BufferGeometryUtils.mergeGeometries(bucket.geos);
    const mat = getMaterial(0xffffff, {
      vertexColors: true,
      transparent: true,
      opacity: bucket.opacity,
      depthWrite: false,
      side: bucket.side,
      polygonOffset: !!bucket.isFloor,
      polygonOffsetFactor: bucket.isFloor ? -2 : 0,
      polygonOffsetUnits: bucket.isFloor ? -2 : 0
    });
    group.add(new THREE.Mesh(merged, mat));
  }

  if (edgeGeos.length > 0) {
    const merged = BufferGeometryUtils.mergeGeometries(edgeGeos);
    group.add(new THREE.LineSegments(merged, EDGE_MAT));
  }

  return {
    group,
    pulseMats,
    lampMat,
    lampBase: new THREE.Color(theme.lamp),
    lampHalos
  };
}

// ===========================================================================
// ТЕМАТИЧЕСКИЕ ОБЪЕКТЫ (ПРОПЫ) ДЛЯ 4 ТЕМ
// ===========================================================================

/**
 * 1. Лаборатория: столы, штативы с колбами, светящиеся мензурки
 */
function buildLabProps(ctx) {
  const { wall, at, rng, theme, boxAt, cylAt, glowBox, pulseBox } = ctx;
  const rot = wall.rot;

  // Лабораторный стол со столешницей
  const tp = at(0, 0.85);
  boxAt(1.8, 0.1, 0.9, tp.x, 0.85, tp.z, rot, theme.propMain, true);

  // 4 металлические ножки стола
  for (const st of [-1, 1]) {
    for (const sn of [-1, 1]) {
      const lp = at(st * 0.75, 0.85 + sn * 0.32);
      boxAt(0.08, 0.8, 0.08, lp.x, 0.4, lp.z, rot, theme.metal, true);
    }
  }

  // Колбы на столе со светящейся жидкостью
  const flasks = rng.rangeInt(2, 3);
  for (let i = 0; i < flasks; i++) {
    const fp = at(rng.range(-0.6, 0.6), 0.85 + rng.range(-0.18, 0.18));
    const r = rng.range(0.08, 0.13);
    const hgt = rng.range(0.2, 0.35);
    cylAt(r * 0.5, r, hgt, fp.x, 0.9 + hgt / 2, fp.z, theme.panel, "y", 8, true);
    glowBox(r * 1.1, 0.08, r * 1.1, fp.x, 0.95, fp.z, 0, theme.glow);
  }

  // Лабораторный компьютерный монитор / прибор на краю стола
  const monX = rng.next() < 0.5 ? -0.6 : 0.6;
  const monP = at(monX, 0.75);
  boxAt(0.42, 0.35, 0.12, monP.x, 1.12, monP.z, rot, theme.metal, true);
  glowBox(0.36, 0.28, 0.03, monP.x, 1.12, monP.z, rot, theme.accent);

  // Светящийся прибор на полу у стены
  const bp = at(rng.range(-0.7, 0.7), 0.45);
  cylAt(0.18, 0.22, 0.45, bp.x, 0.22, bp.z, theme.metal, "y", 8, true);
  pulseBox(ctx.pulseA, 0.24, 0.25, 0.24, bp.x, 0.55, bp.z, 0, theme.glow);
}

/**
 * 2. Склад: ящики, бочки, паллеты
 */
function buildWarehouseProps(ctx) {
  const { wall, at, rng, theme, boxAt, cylAt } = ctx;
  const rot = wall.rot;
  const isCrate = rng.next() < 0.55;

  if (isCrate) {
    // Штабель деревянных ящиков со скобами
    const size = rng.range(0.85, 1.25);
    const p = at(0, 0.5 + size / 2);
    boxAt(size, size, size, p.x, size / 2, p.z, rot, theme.propMain, true);

    // Металлическая окантовка ящика
    const fp = at(0, 0.5 + size + 0.02);
    boxAt(size * 0.9, 0.08, 0.06, fp.x, size / 2, fp.z, rot, theme.trim, true);
    boxAt(0.08, size * 0.9, 0.06, fp.x, size / 2, fp.z, rot, theme.trim, true);

    // Второй меньший ящик сверху со смещением
    if (rng.next() < 0.65) {
      const s2 = size * 0.7;
      boxAt(s2, s2, s2, p.x, size + s2 / 2, p.z, rot + 0.2, theme.propAlt, true);
    }
  } else {
    // Металлические промышленные бочки
    const r = rng.range(0.32, 0.38);
    const hgt = rng.range(0.9, 1.15);
    const p = at(0, 0.5 + r);
    cylAt(r, r, hgt, p.x, hgt / 2, p.z, theme.propMain, "y", 12, true);

    // Ободья бочки
    for (const ry of [0.18, hgt - 0.18]) {
      cylAt(r * 1.05, r * 1.05, 0.06, p.x, ry, p.z, theme.trim, "y", 12, true);
    }

    // Вторая бочка рядом
    if (rng.next() < 0.6) {
      const p2 = at(rng.range(-0.7, 0.7), 0.5 + r);
      cylAt(r * 0.92, r * 0.92, hgt * 0.92, p2.x, (hgt * 0.92) / 2, p2.z, theme.propAlt, "y", 12, true);
    }
  }
}

/**
 * 3. Серверная: стойки серверов с мигающими огоньками, кабели
 */
function buildServerProps(ctx) {
  const { wall, at, rng, theme, boxAt, cylAt, pulseBox } = ctx;
  const rot = wall.rot;
  const rackW = rng.range(0.9, 1.2);
  const rackH = rng.range(2.0, 2.4);
  const p = at(0, 0.42);

  // Корпус сервера
  boxAt(rackW, rackH, 0.6, p.x, rackH / 2, p.z, rot, theme.propMain, true);

  // Лицевая панель серверов
  const fp = at(0, 0.72);
  boxAt(rackW * 0.88, rackH * 0.92, 0.04, fp.x, rackH / 2, fp.z, rot, theme.panel, true);

  // Ряды мигающих светодиодов на серверах
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 2; col++) {
      const lp = at((col === 0 ? -0.24 : 0.24) * rackW, 0.76);
      const ly = 0.45 + row * (rackH * 0.18);
      const targetPulse = (row + col) % 2 === 0 ? ctx.pulseA : ctx.pulseB;
      const colHex = col === 0 ? theme.glow : theme.accent;
      pulseBox(targetPulse, 0.07, 0.07, 0.03, lp.x, ly, lp.z, rot, colHex);
    }
  }

  // Кабели от серверной стойки к потолку
  const cableCount = rng.rangeInt(1, 2);
  for (let i = 0; i < cableCount; i++) {
    const cp = at(rng.range(-0.35, 0.35), 0.3);
    const cableH = Math.max(0.4, ctx.roomH - rackH);
    cylAt(0.04, 0.04, cableH, cp.x, rackH + cableH / 2, cp.z, theme.pipe, "y", 6, false);
  }
}

/**
 * 4. Биоотсек: резервуары с мутантами и светящейся слизью, трубы
 */
function buildBioProps(ctx) {
  const { wall, at, rng, theme, boxAt, cylAt, pulseBox, addTransparent, addSolid } = ctx;
  const rot = wall.rot;
  const r = rng.range(0.5, 0.65);
  const hgt = rng.range(1.8, 2.2);
  const p = at(0, 0.85);

  // Металлическое основание резервуара
  cylAt(r * 1.15, r * 1.25, 0.22, p.x, 0.11, p.z, theme.metal, "y", 14, true);

  // Прозрачная стеклянная колба резервуара
  const glass = new THREE.CylinderGeometry(r, r, hgt, 14, 1, true);
  glass.translate(p.x, 0.22 + hgt / 2, p.z);
  addTransparent("glass", 0.26, THREE.DoubleSide, glass, theme.glow);

  // Металлическая крышка резервуара
  cylAt(r * 1.1, r * 1.1, 0.16, p.x, 0.22 + hgt + 0.08, p.z, theme.metal, "y", 14, true);

  // Тёмный силуэт мутанта внутри резервуара
  const my = 0.22 + hgt * 0.45;
  boxAt(r * 0.7, hgt * 0.36, r * 0.55, p.x, my, p.z, rot, theme.propAlt, false);
  const headR = r * 0.32;
  const head = new THREE.SphereGeometry(headR, 10, 8);
  head.translate(p.x, my + hgt * 0.28, p.z);
  addSolid(head, theme.accent, false);

  // Светящаяся слизь на дне колбы
  pulseBox(ctx.pulseA, r * 1.5, 0.14, r * 1.5, p.x, 0.28, p.z, 0, theme.glow);

  // Светящиеся зловещие глаза мутанта
  for (const side of [-1, 1]) {
    const ep = at(side * r * 0.18, 0.85 - r * 0.3);
    ctx.glowBox(0.06, 0.06, 0.03, ep.x, my + hgt * 0.28, ep.z, rot, theme.glow);
  }

  // Вертикальная труба перекачки слизи сбоку от резервуара
  const pp = at(r + 0.28, 0.85);
  cylAt(0.1, 0.1, hgt * 1.1, pp.x, 0.22 + hgt * 0.55, pp.z, theme.pipe, "y", 8, true);
}
