// Фабрика материалов и процедурных текстур.
//
// Стиль PSX (ретро-хоррор): MeshLambertMaterial без тун-шейдинга и контуров,
// текстуры 64x64 / 128x128 с NearestFilter без mipmaps (грязный бетон, ржавчина, трещины, потёки),
// вершинное дрожание (PS1 vertex snapping) через onBeforeCompile.
//
// Стиль Cartoon: MeshToonMaterial + 4-ступенчатый gradientMap + чёрный контур.
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { EDGE_MAT } from "../core/Physics.js";

const _materialCache = new Map();
const _textureCache = new Map();
const _texturedMaterials = new Set();
let _texturesEnabled = true;
let _gradientMap = null;

// Глобальные uniforms для эффекта дрожания вершин PS1 (PS1 vertex jitter)
export const vertexSnapUniform = {
  value: new THREE.Vector2(320, 240)
};
export const vertexSnapEnabled = {
  value: (CONFIG.graphics && CONFIG.graphics.vertexSnap != null) ? CONFIG.graphics.vertexSnap : 1.0
};

/**
 * Установить уровень дрожания вершин (0: выкл, 1: слабо, 2: сильно).
 * @param {number} level
 */
export function setVertexSnap(level) {
  vertexSnapEnabled.value = Number(level) || 0.0;
}

/**
 * Обновить разрешение сетки дрожания вершин при изменении размера рендера.
 * @param {number} width
 * @param {number} height
 */
export function updateSnapResolution(width, height) {
  const h = Math.max(120, height || 240);
  const w = Math.max(160, width || 320);
  // Масштабируем сетку под пиксельное разрешение PS1
  vertexSnapUniform.value.set(w, h);
}

// ---------------------------------------------------------------------------
// Вспомогательные функции
// ---------------------------------------------------------------------------

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1));
  return t * t * (3 - 2 * t);
}

function hexOf(color) {
  return "#" + new THREE.Color(color).getHexString();
}

function mixColor(a, b, t) {
  return "#" + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
}

function darken(color, amount) {
  return mixColor(color, "#000000", amount);
}

function lighten(color, amount) {
  return mixColor(color, "#ffffff", amount);
}

/**
 * Детерминированный ГПСЧ для рисунка текстуры.
 * @param {number} seed
 */
function rngFrom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Toon-градиент
// ---------------------------------------------------------------------------

/**
 * 4-ступенчатая палитра освещения (CanvasTexture 4x1) для cartoon-стиля.
 * @returns {THREE.CanvasTexture}
 */
export function getGradientMap() {
  if (_gradientMap) return _gradientMap;
  if (typeof document === "undefined") return null;

  const steps = [0.24, 0.48, 0.74, 1.0];
  const cv = document.createElement("canvas");
  cv.width = 4;
  cv.height = 1;
  const ctx = cv.getContext("2d");
  for (let i = 0; i < 4; i++) {
    const v = Math.round(steps[i] * 255);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(i, 0, 1, 1);
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.userData.shared = true;
  _gradientMap = tex;
  return tex;
}

// ---------------------------------------------------------------------------
// Прикрепление шейдерного хука для дрожания вершин PS1 (vertex snapping)
// ---------------------------------------------------------------------------

/**
 * Привязать клиповые координаты вершин к фиксированной сетке (PS1 rasterization jitter).
 * Исключает вьюмодель оружия в руках (excludeSnap: true).
 * @param {THREE.Material} mat
 * @param {Object} [opts]
 * @param {boolean} [opts.excludeSnap]
 * @param {boolean} [opts.isSkinned]
 */
export function attachVertexSnap(mat, opts = {}) {
  if (!mat) return mat;
  if (opts.excludeSnap) return mat;

  const prevCompile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prevCompile) prevCompile(shader, renderer);

    shader.uniforms.uSnapRes = vertexSnapUniform;
    shader.uniforms.uSnapEnabled = vertexSnapEnabled;

    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `#include <common>
       uniform vec2 uSnapRes;
       uniform float uSnapEnabled;`
    );

    shader.vertexShader = shader.vertexShader.replace(
      "#include <project_vertex>",
      `#include <project_vertex>
       if (uSnapEnabled > 0.5) {
         vec4 snapClip = gl_Position;
         if (snapClip.w > 0.0) {
           float mult = uSnapEnabled > 1.5 ? 0.65 : 1.0;
           vec2 grid = uSnapRes * mult;
           snapClip.xy = (floor(snapClip.xy / snapClip.w * grid + 0.5) / grid) * snapClip.w;
           gl_Position = snapClip;
         }
       }`
    );
  };
  return mat;
}

// ---------------------------------------------------------------------------
// Процедурные грязные текстуры (PS1: 64x64 и 128x128)
// ---------------------------------------------------------------------------

function paletteFor(theme) {
  const isPsx = (CONFIG.graphics && CONFIG.graphics.styleName) !== "cartoon";
  const wall = theme ? theme.wall : (isPsx ? 0x424944 : 0x8a8f98);
  const floor = theme ? theme.floor : (isPsx ? 0x262b28 : 0x5a5f68);
  const accent = theme ? theme.accent : (isPsx ? 0x4ade80 : 0x3ec6ff);
  const trim = theme ? theme.trim : (isPsx ? 0x2a302c : 0x6b7280);
  const marking = theme ? theme.marking : (isPsx ? 0xb45309 : 0xffd23f);
  return {
    wall: hexOf(wall),
    wallLight: lighten(wall, 0.08),
    wallDark: darken(wall, 0.35),
    floor: hexOf(floor),
    floorLight: lighten(floor, 0.08),
    floorDark: darken(floor, 0.4),
    accent: hexOf(accent),
    trim: hexOf(trim),
    trimDark: darken(trim, 0.45),
    marking: hexOf(marking),
    markingDark: "#0c0a08",
    rust: "#421b0e",
    rustLight: "#6e3318",
    grime: "#101311"
  };
}

function drawNoise(ctx, seed, p, size = 128) {
  ctx.fillStyle = p.wall;
  ctx.fillRect(0, 0, size, size);
  const rand = rngFrom(seed);
  // Базовые грязевые пятна
  for (let i = 0; i < 350; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = rand() * 2.5 + 0.5;
    ctx.fillStyle = rand() < 0.6 ? p.wallDark : p.wallLight;
    ctx.globalAlpha = 0.2 + rand() * 0.3;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Тёмные потёки
  ctx.fillStyle = p.grime;
  for (let i = 0; i < 18; i++) {
    ctx.globalAlpha = 0.25 + rand() * 0.35;
    ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 2, 6 + rand() * 25);
  }
  ctx.globalAlpha = 1;
}

function drawWall(ctx, theme, p, size = 128) {
  ctx.fillStyle = p.wall;
  ctx.fillRect(0, 0, size, size);

  const rand = rngFrom(theme ? theme.wall : 17);

  // Шершавая бетонная основа с шумом
  ctx.fillStyle = p.wallDark;
  for (let i = 0; i < 240; i++) {
    ctx.globalAlpha = 0.15 + rand() * 0.2;
    ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 2, 1 + rand() * 2);
  }

  // Вертикальные швы панелей (шаг 32 или 64)
  ctx.strokeStyle = p.wallDark;
  ctx.lineWidth = 2;
  const step = size >= 128 ? 32 : 16;
  for (let x = 0; x <= size; x += step) {
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();

    // Тонкая грань фаски
    ctx.strokeStyle = p.wallLight;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.moveTo(x + 1, 0);
    ctx.lineTo(x + 1, size);
    ctx.stroke();
    ctx.strokeStyle = p.wallDark;
    ctx.lineWidth = 2;
  }

  // Горизонтальный шов по центру
  ctx.strokeStyle = p.wallDark;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.moveTo(0, size * 0.5);
  ctx.lineTo(size, size * 0.5);
  ctx.stroke();

  // Ржавые потёки сверху вниз
  ctx.fillStyle = p.rust;
  for (let i = 0; i < 14; i++) {
    const x = rand() * size;
    const y = rand() * (size * 0.3);
    const len = 10 + rand() * (size * 0.6);
    ctx.globalAlpha = 0.3 + rand() * 0.4;
    ctx.fillRect(x, y, 1 + rand() * 2.5, len);
  }

  // Грязный налёт снизу
  const grad = ctx.createLinearGradient(0, size * 0.7, 0, size);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(10,12,10,0.6)");
  ctx.fillStyle = grad;
  ctx.globalAlpha = 1;
  ctx.fillRect(0, size * 0.7, size, size * 0.3);
}

function drawFloor(ctx, theme, p, size = 128) {
  const id = theme ? theme.id : "lab";
  const rand = rngFrom((theme ? theme.id.charCodeAt(0) : 9) * 977);

  // Тёмный базовый цвет пола
  ctx.fillStyle = p.floor;
  ctx.fillRect(0, 0, size, size);

  if (id === "warehouse") {
    // Ржавые металлические плиты с царапинами
    const step = size / 2;
    for (let y = 0; y < size; y += step) {
      for (let x = 0; x < size; x += step) {
        ctx.fillStyle = (x + y) % (step * 2) === 0 ? p.floorLight : p.floorDark;
        ctx.fillRect(x, y, step, step);
      }
    }
    // Швы
    ctx.strokeStyle = p.trimDark;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, size - 2, size - 2);
    ctx.beginPath();
    ctx.moveTo(0, step); ctx.lineTo(size, step);
    ctx.moveTo(step, 0); ctx.lineTo(step, size);
    ctx.stroke();

    // Пятна машинного масла и ржавчины
    ctx.fillStyle = "#120a05";
    for (let i = 0; i < 8; i++) {
      ctx.globalAlpha = 0.4 + rand() * 0.4;
      ctx.beginPath();
      ctx.ellipse(rand() * size, rand() * size, 3 + rand() * 12, 2 + rand() * 8, rand() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (id === "server") {
    // Тёмные серверные плиты с тонкими стыками
    const step = size / 4;
    for (let y = 0; y < size; y += step) {
      for (let x = 0; x < size; x += step) {
        ctx.fillStyle = ((x + y) / step) % 2 === 0 ? p.floor : p.floorDark;
        ctx.fillRect(x, y, step, step);
      }
    }
    // Стыки
    ctx.strokeStyle = "#080b10";
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.9;
    for (let i = 0; i <= size; i += step) {
      ctx.beginPath();
      ctx.moveTo(i, 0); ctx.lineTo(i, size);
      ctx.moveTo(0, i); ctx.lineTo(size, i);
      ctx.stroke();
    }
    // Сетка вентиляции / пыль
    ctx.fillStyle = "#040508";
    for (let i = 0; i < 40; i++) {
      ctx.globalAlpha = 0.3;
      ctx.fillRect(rand() * size, rand() * size, 2, 2);
    }
  } else if (id === "bio") {
    // Органические замшелые каменные плиты с лужами слизи
    const step = size / 2;
    for (let y = 0; y < size; y += step) {
      for (let x = 0; x < size; x += step) {
        ctx.fillStyle = rand() < 0.5 ? p.floor : p.floorLight;
        ctx.fillRect(x, y, step, step);
      }
    }
    // Пятна слизи
    ctx.fillStyle = "rgba(22, 40, 16, 0.7)";
    for (let i = 0; i < 10; i++) {
      ctx.beginPath();
      ctx.ellipse(rand() * size, rand() * size, 4 + rand() * 14, 3 + rand() * 9, rand() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Грязные трещины
    ctx.strokeStyle = "#0d140a";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, size - 2, size - 2);
  } else {
    // Лаборатория: грязная растрескавшаяся плитка (без яркой шахматки!)
    const step = size / 4;
    for (let y = 0; y < size; y += step) {
      for (let x = 0; x < size; x += step) {
        // Незначительный разнотон плиток вместо контрастной шахматки
        ctx.fillStyle = rand() < 0.5 ? p.floor : p.floorDark;
        ctx.fillRect(x, y, step, step);
      }
    }
    // Тёмные швы
    ctx.strokeStyle = "#141816";
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.85;
    for (let i = 0; i <= size; i += step) {
      ctx.beginPath();
      ctx.moveTo(i, 0); ctx.lineTo(i, size);
      ctx.moveTo(0, i); ctx.lineTo(size, i);
      ctx.stroke();
    }
    // Трещины на плитках
    ctx.strokeStyle = "#0d100e";
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;
    for (let i = 0; i < 4; i++) {
      const cx = (Math.floor(rand() * 4) + 0.5) * step;
      const cy = (Math.floor(rand() * 4) + 0.5) * step;
      ctx.beginPath();
      ctx.moveTo(cx - 6, cy - 5);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + 8, cy + 6);
      ctx.stroke();
    }
  }

  // Общий налёт копоти и грязи
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "#000000";
  for (let i = 0; i < 60; i++) {
    ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 3, 1 + rand() * 3);
  }
  ctx.globalAlpha = 1;
}

function drawMetal(ctx, p, size = 128) {
  // Ржавый металл с заклёпками и царапинами
  ctx.fillStyle = p.trim;
  ctx.fillRect(0, 0, size, size);

  // Коррозийный градиент
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, p.trimDark);
  grad.addColorStop(0.5, p.trim);
  grad.addColorStop(1, p.rust);
  ctx.fillStyle = grad;
  ctx.globalAlpha = 0.65;
  ctx.fillRect(0, 0, size, size);

  // Царапины и потёртости
  const rand = rngFrom(43);
  ctx.strokeStyle = p.rustLight;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.4;
  for (let i = 0; i < 20; i++) {
    const y = rand() * size;
    ctx.beginPath();
    ctx.moveTo(rand() * (size * 0.3), y);
    ctx.lineTo(size * 0.7 + rand() * (size * 0.3), y + (rand() - 0.5) * 6);
    ctx.stroke();
  }

  // Пятна ржавчины
  ctx.fillStyle = p.rust;
  for (let i = 0; i < 8; i++) {
    ctx.globalAlpha = 0.35 + rand() * 0.35;
    ctx.beginPath();
    ctx.arc(rand() * size, rand() * size, 3 + rand() * 8, 0, Math.PI * 2);
    ctx.fill();
  }

  // Заклёпки по углам
  ctx.fillStyle = "#111412";
  ctx.globalAlpha = 0.9;
  const inset = 10;
  for (const [x, y] of [[inset, inset], [size - inset, inset], [inset, size - inset], [size - inset, size - inset]]) {
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawHazard(ctx, p, size = 128) {
  // Потёртые предупреждающие полосы (жёлтый/чёрный с налётом копоти)
  ctx.fillStyle = "#121008";
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = p.marking;
  const stripe = 24;
  for (let x = -size; x < size * 2; x += stripe * 2) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + stripe, 0);
    ctx.lineTo(x + stripe - size, size);
    ctx.lineTo(x - size, size);
    ctx.closePath();
    ctx.fill();
  }

  // Потёртости и грязь
  const rand = rngFrom(31);
  ctx.fillStyle = "#050505";
  ctx.globalAlpha = 0.45;
  for (let i = 0; i < 80; i++) {
    ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 4, 1 + rand() * 3);
  }
  ctx.globalAlpha = 1;
}

function drawGrate(ctx, p, size = 64) {
  // Проржавевшая решётка
  ctx.fillStyle = "#0a0c0a";
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = p.trim;
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.85;
  for (let i = -size; i < size * 2; i += 16) {
    ctx.beginPath();
    ctx.moveTo(i, 0); ctx.lineTo(i + size, size);
    ctx.moveTo(i + size, 0); ctx.lineTo(i, size);
    ctx.stroke();
  }
  ctx.strokeStyle = p.rust;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, size - 2, size - 2);
  ctx.globalAlpha = 1;
}

/**
 * Получить (и закэшировать) процедурную текстуру темы.
 * В режиме PSX текстуры создаются 128x128 (или 64x64) с NearestFilter без mipmaps.
 * @param {Object} theme
 * @param {"wall"|"floor"|"metal"|"hazard"|"grate"|"noise"} type
 * @returns {THREE.CanvasTexture}
 */
export function getThemeTexture(theme, type) {
  if (typeof document === "undefined") return null;
  const isPsx = (CONFIG.graphics && CONFIG.graphics.styleName) !== "cartoon";
  const themeId = theme && theme.id ? theme.id : "default";
  const key = `${isPsx ? "psx" : "toon"}|${themeId}|${type}`;
  const cached = _textureCache.get(key);
  if (cached) return cached;

  const size = isPsx ? (type === "grate" ? 64 : 128) : 256;
  const cv = document.createElement("canvas");
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext("2d");
  const p = paletteFor(theme);
  const seed = (themeId.charCodeAt(0) || 5) * 7919 + type.length * 131;

  if (type === "floor") drawFloor(ctx, theme, p, size);
  else if (type === "metal") drawMetal(ctx, p, size);
  else if (type === "hazard") drawHazard(ctx, p, size);
  else if (type === "grate") drawGrate(ctx, p, size);
  else if (type === "noise") drawNoise(ctx, seed, p, size);
  else drawWall(ctx, theme, p, size);

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;

  if (isPsx) {
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
  } else {
    tex.anisotropy = 4;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
  }

  tex.userData.shared = true;
  _textureCache.set(key, tex);
  return tex;
}

// ---------------------------------------------------------------------------
// Материалы
// ---------------------------------------------------------------------------

/**
 * Некэшируемый материал (для объектов, которые меняют emissive/цвет динамически).
 * В PSX-режиме: MeshLambertMaterial без toon-шейдинга и с поддержкой vertex snap.
 * @param {number|THREE.Color} color
 * @param {Object} [opts]
 * @returns {THREE.Material}
 */
export function createToonMaterial(color, opts = {}) {
  const isPsx = (CONFIG.graphics && CONFIG.graphics.styleName) !== "cartoon";
  let mat;

  if (isPsx) {
    mat = new THREE.MeshLambertMaterial({
      color,
      vertexColors: !!opts.vertexColors,
      transparent: !!opts.transparent,
      opacity: opts.opacity != null ? opts.opacity : 1,
      side: opts.side != null ? opts.side : THREE.FrontSide,
      emissive: opts.emissive != null ? opts.emissive : 0x000000,
      emissiveIntensity: opts.emissiveIntensity != null ? opts.emissiveIntensity : 1
    });
  } else {
    mat = new THREE.MeshToonMaterial({
      color,
      gradientMap: getGradientMap(),
      vertexColors: !!opts.vertexColors,
      transparent: !!opts.transparent,
      opacity: opts.opacity != null ? opts.opacity : 1,
      side: opts.side != null ? opts.side : THREE.FrontSide,
      emissive: opts.emissive != null ? opts.emissive : 0x000000,
      emissiveIntensity: opts.emissiveIntensity != null ? opts.emissiveIntensity : 1
    });
  }

  if (opts.map) {
    mat.map = opts.map;
    if (isPsx) {
      opts.map.minFilter = THREE.NearestFilter;
      opts.map.magFilter = THREE.NearestFilter;
      opts.map.generateMipmaps = false;
    }
  }
  if (opts.depthWrite === false) mat.depthWrite = false;

  if (isPsx && !opts.excludeSnap) {
    attachVertexSnap(mat, opts);
  }

  return mat;
}

/**
 * Кэширующая фабрика материалов.
 * @param {number|THREE.Color} color
 * @param {Object} [opts]
 * @param {string} [opts.texture] - wall|floor|metal|hazard|grate|noise
 * @param {Object} [opts.theme]
 * @param {boolean} [opts.vertexColors]
 * @param {number} [opts.emissive]
 * @param {number} [opts.emissiveIntensity]
 * @param {boolean} [opts.tint]
 * @param {boolean} [opts.excludeSnap]
 * @returns {THREE.Material}
 */
export function getMaterial(color, opts = {}) {
  const isPsx = (CONFIG.graphics && CONFIG.graphics.styleName) !== "cartoon";
  const textureType = opts.texture || null;
  const theme = opts.theme || null;
  const map = textureType ? getThemeTexture(theme, textureType) : null;
  const tint = !!opts.tint;
  const key = [
    isPsx ? "psx" : "toon",
    color,
    textureType || "-",
    theme && theme.id ? theme.id : "-",
    opts.vertexColors ? 1 : 0,
    opts.emissive != null ? opts.emissive : "-",
    opts.emissiveIntensity != null ? opts.emissiveIntensity : "-",
    opts.transparent ? (opts.opacity != null ? opts.opacity : 1) : "-",
    opts.side != null ? opts.side : "-",
    opts.depthWrite === false ? 0 : 1,
    tint ? 1 : 0,
    opts.polygonOffset ? `po:${opts.polygonOffsetFactor != null ? opts.polygonOffsetFactor : -2}:${opts.polygonOffsetUnits != null ? opts.polygonOffsetUnits : -2}` : "-"
  ].join("|");

  const cached = _materialCache.get(key);
  if (cached) return cached;

  const useWhite = !!map && !tint;
  let mat;

  if (isPsx) {
    mat = new THREE.MeshLambertMaterial({
      color: useWhite ? 0xffffff : color,
      vertexColors: !!opts.vertexColors,
      transparent: !!opts.transparent,
      opacity: opts.opacity != null ? opts.opacity : 1,
      side: opts.side != null ? opts.side : THREE.FrontSide,
      emissive: opts.emissive != null ? opts.emissive : 0x000000,
      emissiveIntensity: opts.emissiveIntensity != null ? opts.emissiveIntensity : 1,
      depthWrite: opts.depthWrite !== false
    });
    if (!opts.excludeSnap) {
      attachVertexSnap(mat, opts);
    }
  } else {
    mat = new THREE.MeshToonMaterial({
      color: useWhite ? 0xffffff : color,
      gradientMap: getGradientMap(),
      vertexColors: !!opts.vertexColors,
      transparent: !!opts.transparent,
      opacity: opts.opacity != null ? opts.opacity : 1,
      side: opts.side != null ? opts.side : THREE.FrontSide,
      emissive: opts.emissive != null ? opts.emissive : 0x000000,
      emissiveIntensity: opts.emissiveIntensity != null ? opts.emissiveIntensity : 1,
      depthWrite: opts.depthWrite !== false
    });
  }

  if (opts.polygonOffset) {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = opts.polygonOffsetFactor != null ? opts.polygonOffsetFactor : -2;
    mat.polygonOffsetUnits = opts.polygonOffsetUnits != null ? opts.polygonOffsetUnits : -2;
  }

  mat.userData.baseColor = new THREE.Color(useWhite ? 0xffffff : color);
  mat.userData.shared = true;
  if (map) {
    mat.map = _texturesEnabled ? map : null;
    mat.userData.textureMap = map;
    mat.userData.textureEnabledColor = new THREE.Color(useWhite ? 0xffffff : color);
    mat.userData.textureDisabledColor = new THREE.Color(color);
    _texturedMaterials.add(mat);
    if (!_texturesEnabled) {
      mat.color.copy(mat.userData.textureDisabledColor);
      mat.needsUpdate = true;
    }
  }

  _materialCache.set(key, mat);
  return mat;
}

/**
 * Включить/выключить процедурные текстуры у всех созданных материалов.
 * @param {boolean} enabled
 */
export function setTexturesEnabled(enabled) {
  if (_texturesEnabled === enabled) return;
  _texturesEnabled = enabled;
  for (const mat of _texturedMaterials) {
    const map = mat.userData.textureMap;
    if (!map) continue;
    mat.map = enabled ? map : null;
    if (enabled) {
      if (mat.userData.textureEnabledColor) {
        mat.color.copy(mat.userData.textureEnabledColor);
      } else {
        mat.color.set(0xffffff);
      }
    } else if (mat.userData.textureDisabledColor) {
      mat.color.copy(mat.userData.textureDisabledColor);
    }
    mat.needsUpdate = true;
  }
}

/**
 * Подключить произвольный материал с собственной текстурой к системе
 * переключения качества.
 * @param {THREE.Material} mat
 * @param {THREE.Texture} map
 * @param {number|THREE.Color} [disabledColor]
 * @returns {THREE.Material}
 */
export function registerTexturedMaterial(mat, map, disabledColor = null) {
  if (!mat || !map) return mat;
  mat.userData.textureMap = map;
  mat.userData.textureEnabledColor = mat.color.clone();
  mat.userData.textureDisabledColor = new THREE.Color(
    disabledColor != null ? disabledColor : mat.color.getHex()
  );
  _texturedMaterials.add(mat);
  if (!_texturesEnabled) {
    mat.map = null;
    mat.color.copy(mat.userData.textureDisabledColor);
    mat.needsUpdate = true;
  }
  return mat;
}

/**
 * Яркий unlit-материал для светящихся полос/неона (попадает в bloom).
 * @param {number|THREE.Color} color
 * @param {number} [intensity=1.6]
 * @returns {THREE.MeshBasicMaterial}
 */
export function getEmissiveMaterial(color, intensity = 1.6) {
  const key = "emissive|" + color + "|" + intensity;
  const cached = _materialCache.get(key);
  if (cached) return cached;
  const c = new THREE.Color(color).multiplyScalar(intensity);
  const mat = new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
  mat.userData.shared = true;
  _materialCache.set(key, mat);
  return mat;
}

/**
 * Переключить глобальный стиль графики (psx | cartoon).
 * Скрывает контуры EDGE_MAT в PSX и очищает кэш материалов.
 * @param {"psx"|"cartoon"} styleName
 */
export function setGraphicsStyle(styleName = "psx") {
  CONFIG.graphics.styleName = styleName;
  const isPsx = styleName !== "cartoon";
  if (EDGE_MAT) {
    EDGE_MAT.visible = !isPsx;
  }
  // Очистка кэшей
  _materialCache.clear();
  _textureCache.clear();
  _texturedMaterials.clear();
}

// ---------------------------------------------------------------------------
// UV и AO
// ---------------------------------------------------------------------------

/**
 * Развернуть UV коробки/стены в мировых координатах.
 * @param {THREE.BufferGeometry} geo
 * @param {number} [scale=4]
 */
export function applyWorldUVs(geo, scale = 4) {
  const pos = geo.attributes.position;
  const normal = geo.attributes.normal;
  const uv = geo.attributes.uv;
  if (!pos || !normal || !uv) return geo;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = Math.abs(normal.getX(i));
    const ny = Math.abs(normal.getY(i));
    const nz = Math.abs(normal.getZ(i));

    let u;
    let v;
    if (ny >= nx && ny >= nz) {
      u = x / scale;
      v = z / scale;
    } else if (nx >= nz) {
      u = z / scale;
      v = y / scale;
    } else {
      u = x / scale;
      v = y / scale;
    }
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
  return geo;
}

/**
 * Имитация ambient occlusion вершинными цветами.
 * @param {THREE.BufferGeometry} geo
 * @param {Object} [opts]
 */
export function applyAO(geo, opts = {}) {
  const pos = geo.attributes.position;
  if (!pos) return geo;

  const mode = opts.mode || "block";
  const strength = opts.strength != null ? opts.strength : 1;
  const minY = opts.minY != null ? opts.minY : 0;
  const maxY = opts.maxY != null ? opts.maxY : minY + 8;
  const hasBounds =
    opts.minX != null && opts.maxX != null && opts.minZ != null && opts.maxZ != null;
  const minX = opts.minX || 0;
  const maxX = opts.maxX || 0;
  const minZ = opts.minZ || 0;
  const maxZ = opts.maxZ || 0;

  const count = pos.count;
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let shade = 1;

    if (mode === "wall") {
      const floorFade = smoothstep(0, 1.7, y - minY);
      const ceilFade = smoothstep(0, 1.5, maxY - y);
      shade = (0.58 + 0.42 * floorFade) * (0.78 + 0.22 * ceilFade);
      if (hasBounds) {
        const dx = Math.min(x - minX, maxX - x);
        const dz = Math.min(z - minZ, maxZ - z);
        const corner = Math.max(dx, dz);
        shade *= 0.78 + 0.22 * clamp01(corner / 1.4);
      }
    } else if (mode === "floor") {
      shade = 0.82;
      if (hasBounds) {
        const dx = Math.min(x - minX, maxX - x);
        const dz = Math.min(z - minZ, maxZ - z);
        const edge = Math.min(dx, dz);
        shade = 0.7 + 0.3 * clamp01(edge / 3.5);
      }
    } else if (mode === "ceiling") {
      shade = 0.62;
      if (hasBounds) {
        const dx = Math.min(x - minX, maxX - x);
        const dz = Math.min(z - minZ, maxZ - z);
        const edge = Math.min(dx, dz);
        shade += 0.12 * clamp01(edge / 4.0);
      }
    } else {
      shade = 0.66 + 0.34 * smoothstep(0, 2.0, y - minY);
    }

    shade = 1 - (1 - shade) * strength;
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
  }

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}

// ---------------------------------------------------------------------------
// Круглая тень-пятно под врагами и предметами
// ---------------------------------------------------------------------------

let _shadowGeo = null;
let _shadowMat = null;

function getShadowResources() {
  if (_shadowGeo && _shadowMat) return { geo: _shadowGeo, mat: _shadowMat };
  if (typeof document === "undefined") {
    _shadowGeo = new THREE.PlaneGeometry(1, 1);
    _shadowMat = new THREE.MeshBasicMaterial();
    return { geo: _shadowGeo, mat: _shadowMat };
  }

  const cv = document.createElement("canvas");
  cv.width = 64;
  cv.height = 64;
  const ctx = cv.getContext("2d");
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, "rgba(0,0,0,0.62)");
  grad.addColorStop(0.55, "rgba(0,0,0,0.38)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.shared = true;

  _shadowGeo = new THREE.PlaneGeometry(1, 1);
  _shadowGeo.rotateX(-Math.PI / 2);
  _shadowMat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  });
  _shadowMat.userData.shared = true;
  return { geo: _shadowGeo, mat: _shadowMat };
}

export function createBlobShadow(size = 1) {
  const { geo, mat } = getShadowResources();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.set(size, 1, size);
  mesh.renderOrder = 1;
  return mesh;
}

export function areTexturesEnabled() {
  return _texturesEnabled;
}

export function getQualitySettings(mode) {
  const modes = CONFIG.graphics.modes || {};
  return modes[mode] || modes.high || { bloom: true, bloomScale: 1, textures: true, pixelRatio: 1 };
}
