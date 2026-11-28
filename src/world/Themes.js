// Визуальные темы уровней: палитры стен, пола, потолка, блоков, туман, фон,
// акцентный свет и подсветка дверей.
// Темы:
// 1. lab       — Лаборатория: бледно-зелёный и серый, грязный камень, холодный зелёный свет
// 2. warehouse — Склад: ржавый коричневый, тёмный пол, грязный янтарь
// 3. server    — Серверная: синевато-чёрный, красные огни, холодный туман
// 4. bio       — Биоотсек: болотный зелёный с жёлтым, слизь, тёмный мох
import { Rng } from "../core/Rng.js";
import { CONFIG } from "../config.js";

export const PSX_THEMES = [
  {
    id: "lab",
    name: "Лаборатория",
    // Стены, пол, потолок (яркость 55-65%, пол +10%, потолок -30%, видимый)
    wall: 0x8e9890,
    floor: 0x9ea8a0,
    ceiling: 0x646c66,
    pit: 0x2b332d,
    // Блоки препятствий арены
    blocks: {
      block: 0x7a867c,
      ramp: 0xa0967a,
      platform: 0x7e8a82,
      bridge: 0x849086
    },
    // Туман и фон (видимость 55-70м)
    fog: 0x2a3430,
    fogDensity: 0.014,
    background: 0x222a27,
    // Освещение
    accent: 0x4ade80,
    lightA: 0x86efac,
    lightB: 0x94a3b8,
    doorGlow: 0x4ade80,
    lamp: 0xc7f9cc,
    // Декор
    pipe: 0x505852,
    panel: 0x5a635d,
    metal: 0x4e5751,
    trim: 0x3a423d,
    puddle: 0x334437,
    stain: 0x2c382f,
    marking: 0x84cc16,
    paper: 0xd1d5db,
    propMain: 0x58645c,
    propAlt: 0x4d5851,
    glow: 0x4ade80,
    signBg: "#1a241f",
    signInk: "#c7f9cc"
  },
  {
    id: "warehouse",
    name: "Склад",
    // Стены, пол, потолок
    wall: 0x988e84,
    floor: 0xa89e92,
    ceiling: 0x6c6258,
    pit: 0x332820,
    // Блоки препятствий арены
    blocks: {
      block: 0x847262,
      ramp: 0xb88854,
      platform: 0x786450,
      bridge: 0x9c7a5a
    },
    // Туман и фон
    fog: 0x322c26,
    fogDensity: 0.014,
    background: 0x28231e,
    // Освещение
    accent: 0xd97706,
    lightA: 0xfbbf24,
    lightB: 0xc2410c,
    doorGlow: 0xd97706,
    lamp: 0xfef08a,
    // Декор
    pipe: 0x544638,
    panel: 0x645444,
    metal: 0x524436,
    trim: 0x3e3226,
    puddle: 0x2c221a,
    stain: 0x221a14,
    marking: 0xd97706,
    paper: 0xe5e7eb,
    propMain: 0x604e3c,
    propAlt: 0x524030,
    glow: 0xd97706,
    signBg: "#261e16",
    signInk: "#fed7aa"
  },
  {
    id: "server",
    name: "Серверная",
    // Стены, пол, потолок
    wall: 0x88909c,
    floor: 0x969ea8,
    ceiling: 0x5e6672,
    pit: 0x222833,
    // Блоки препятствий арены
    blocks: {
      block: 0x707988,
      ramp: 0x8878a0,
      platform: 0x687282,
      bridge: 0x768092
    },
    // Туман и фон
    fog: 0x262b34,
    fogDensity: 0.014,
    background: 0x1e232b,
    // Освещение
    accent: 0xef4444,
    lightA: 0xf87171,
    lightB: 0x38bdf8,
    doorGlow: 0xef4444,
    lamp: 0xfca5a5,
    // Декор
    pipe: 0x444d5c,
    panel: 0x525c6e,
    metal: 0x424a59,
    trim: 0x323a47,
    puddle: 0x222e40,
    stain: 0x1a2230,
    marking: 0xef4444,
    paper: 0xcbd5e1,
    propMain: 0x4c5666,
    propAlt: 0x444e5e,
    glow: 0xef4444,
    signBg: "#181d26",
    signInk: "#fca5a5"
  },
  {
    id: "bio",
    name: "Биоотсек",
    // Стены, пол, потолок
    wall: 0x8a9686,
    floor: 0x98a494,
    ceiling: 0x606c5c,
    pit: 0x242e22,
    // Блоки препятствий арены
    blocks: {
      block: 0x748270,
      ramp: 0xa2a85a,
      platform: 0x6c7c68,
      bridge: 0x7a8a74
    },
    // Туман и фон
    fog: 0x283026,
    fogDensity: 0.014,
    background: 0x20261e,
    // Освещение
    accent: 0x84cc16,
    lightA: 0xa3e635,
    lightB: 0xeab308,
    doorGlow: 0x84cc16,
    lamp: 0xd9f99d,
    // Декор
    pipe: 0x465442,
    panel: 0x546450,
    metal: 0x445240,
    trim: 0x344030,
    puddle: 0x283a22,
    stain: 0x1e2c1a,
    marking: 0x84cc16,
    paper: 0xd1d5db,
    propMain: 0x4e5e4a,
    propAlt: 0x566042,
    glow: 0x84cc16,
    signBg: "#1a2218",
    signInk: "#d9f99d"
  }
];

export const CARTOON_THEMES = [
  {
    id: "lab",
    name: "Лаборатория",
    wall: 0xf0f5fa,
    floor: 0xd8ecf8,
    ceiling: 0xe6f0f8,
    pit: 0x1e2c38,
    blocks: {
      block: 0x54a0d8,
      ramp: 0xffd166,
      platform: 0x8ce0ff,
      bridge: 0x38bdf8
    },
    fog: 0xcfe4f5,
    fogDensity: 0.01,
    background: 0xe2effa,
    accent: 0x0ea5e9,
    lightA: 0xe0f2fe,
    lightB: 0x38bdf8,
    doorGlow: 0x00f0ff,
    lamp: 0xf0fdff,
    pipe: 0x94a3b8,
    panel: 0xf8fafc,
    metal: 0xcbd5e1,
    trim: 0x64748b,
    puddle: 0x38bdf8,
    stain: 0x93c5fd,
    marking: 0x0284c7,
    paper: 0xffffff,
    propMain: 0xe2e8f0,
    propAlt: 0xbae6fd,
    glow: 0x38bdf8,
    signBg: "#0f2338",
    signInk: "#e0f2fe"
  },
  {
    id: "warehouse",
    name: "Склад",
    wall: 0xba6e3a,
    floor: 0x663f22,
    ceiling: 0x482b16,
    pit: 0x24150a,
    blocks: {
      block: 0xf97316,
      ramp: 0xfbbf24,
      platform: 0xea580c,
      bridge: 0xd97706
    },
    fog: 0x784420,
    fogDensity: 0.013,
    background: 0x4d2812,
    accent: 0xf59e0b,
    lightA: 0xffedd5,
    lightB: 0xf97316,
    doorGlow: 0xffaa00,
    lamp: 0xffedd5,
    pipe: 0x78350f,
    panel: 0x92400e,
    metal: 0x573014,
    trim: 0x451a03,
    puddle: 0x2e1809,
    stain: 0x1f0f04,
    marking: 0xfacc15,
    paper: 0xfef3c7,
    propMain: 0xb45309,
    propAlt: 0x78350f,
    glow: 0xfbbf24,
    signBg: "#2d1606",
    signInk: "#fef3c7"
  },
  {
    id: "server",
    name: "Серверная",
    wall: 0x2e2050,
    floor: 0x160f29,
    ceiling: 0x110b20,
    pit: 0x0a0514,
    blocks: {
      block: 0x8b5cf6,
      ramp: 0x06b6d4,
      platform: 0xa855f7,
      bridge: 0x14b8a6
    },
    fog: 0x241640,
    fogDensity: 0.015,
    background: 0x130a24,
    accent: 0x06b6d4,
    lightA: 0xa855f7,
    lightB: 0x06b6d4,
    doorGlow: 0x00f5d4,
    lamp: 0xccfbf1,
    pipe: 0x4c1d95,
    panel: 0x3b236e,
    metal: 0x47307a,
    trim: 0x6d28d9,
    puddle: 0x06b6d4,
    stain: 0x1e1238,
    marking: 0x00f5d4,
    paper: 0xe0e7ff,
    propMain: 0x1e1438,
    propAlt: 0x372363,
    glow: 0x00f5d4,
    signBg: "#120924",
    signInk: "#a5f3fc"
  },
  {
    id: "bio",
    name: "Биоотсек",
    wall: 0x3c5a35,
    floor: 0x233a1f,
    ceiling: 0x192b16,
    pit: 0x0d170b,
    blocks: {
      block: 0x65a30d,
      ramp: 0xeab308,
      platform: 0x84cc16,
      bridge: 0xa3e635
    },
    fog: 0x294224,
    fogDensity: 0.012,
    background: 0x142211,
    accent: 0xa3e635,
    lightA: 0xecfccb,
    lightB: 0x84cc16,
    doorGlow: 0x84cc16,
    lamp: 0xf7fee7,
    pipe: 0x4d6642,
    panel: 0x365330,
    metal: 0x41543b,
    trim: 0x293e24,
    puddle: 0x84cc16,
    stain: 0x192b16,
    marking: 0xeab308,
    paper: 0xfef9c3,
    propMain: 0x2f4d28,
    propAlt: 0x4d7c0f,
    glow: 0xccff00,
    signBg: "#12200e",
    signInk: "#ecfccb"
  }
];

// Активный массив тем (по умолчанию PSX)
export const THEMES = PSX_THEMES.map((t) => ({ ...t, blocks: { ...t.blocks } }));

export const THEMES_BY_ID = {
  lab: THEMES[0],
  warehouse: THEMES[1],
  server: THEMES[2],
  bio: THEMES[3]
};

/**
 * Переключить цветовую палитру тем между PSX и cartoon.
 * @param {"psx"|"cartoon"} styleName
 */
export function applyThemeStyle(styleName = "psx") {
  const source = styleName === "cartoon" ? CARTOON_THEMES : PSX_THEMES;
  for (let i = 0; i < THEMES.length; i++) {
    const src = source[i];
    const dst = THEMES[i];
    Object.assign(dst, src);
    dst.blocks = { ...src.blocks };
  }
}

/**
 * Сид для визуальных решений комнаты. Зависит от данных комнаты,
 * поэтому декор полностью детерминирован и воспроизводим при одном сиде.
 * @param {Object} room
 * @param {string} [salt="theme"]
 * @returns {Rng}
 */
export function createRoomRng(room, salt = "theme") {
  const seed =
    `${salt}|${room.id}|${room.type}|${room.gx},${room.gz}|` +
    `${room.center.x.toFixed(2)},${room.center.z.toFixed(2)}|` +
    `${room.w}x${room.d}x${room.h}`;
  return new Rng(seed);
}

/**
 * Выбрать тему для комнаты из 4 доступных.
 * @param {Object} room
 * @param {Rng} rng
 * @returns {Object}
 */
export function pickRoomTheme(room, rng) {
  return THEMES[rng.rangeInt(0, THEMES.length - 1)];
}

export default {
  THEMES,
  THEMES_BY_ID,
  PSX_THEMES,
  CARTOON_THEMES,
  applyThemeStyle,
  createRoomRng,
  pickRoomTheme
};
