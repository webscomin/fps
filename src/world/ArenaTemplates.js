// Шаблоны арен: наборы блоков, лестниц-рамп, платформ, центральных структур-ориентиров.
// Каждый шаблон строит геометрию в локальных координатах комнаты (центр = 0,0),
// после чего применяются вариативность, проверка линий взгляда
// и перевод в мировые координаты.
import { CONFIG } from "../config.js";

const DEG30 = Math.tan((30 * Math.PI) / 180);
const STEP_H = 0.45;
const DOOR_DIRS = ["north", "south", "west", "east"];

/**
 * Метрики лестницы: количество ступеней, высота ступени и длина подъёма.
 * @param {number} rise - суммарный подъём (м)
 */
export function stairMetrics(rise) {
  const n = Math.max(1, Math.ceil(Math.abs(rise) / STEP_H));
  const stepH = Math.abs(rise) / n;
  const run = Math.min(0.95, stepH / DEG30);
  return { n, stepH, run, length: n * run };
}

/**
 * Добавить лестницу из ступеней.
 * @param {Array} out - список блоков (локальные координаты)
 * @param {Object} o
 * @param {"+x"|"-x"|"+z"|"-z"} o.dir - направление подъёма
 * @param {number} o.start - координата нижнего края вдоль оси подъёма
 * @param {number} o.cross - центр по перпендикулярной оси
 * @param {number} o.width - ширина лестницы
 * @param {number} o.fromY - высота нижней ступени
 * @param {number} o.toY - высота верхней ступени
 * @param {number} [o.length] - длина пролёта (иначе 30°)
 * @param {number} o.group - id группы (одна конструкция)
 */
function addStairs(out, o) {
  const rise = o.toY - o.fromY;
  if (rise <= 0.001) return 0;
  const { n, stepH, run } = stairMetrics(rise);
  const actualRun = o.length ? o.length / n : run;
  const alongX = o.dir === "+x" || o.dir === "-x";
  const sign = o.dir === "+x" || o.dir === "+z" ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const top = o.fromY + (i + 1) * stepH;
    const center = o.start + sign * (i * actualRun + actualRun / 2);
    out.push({
      x: alongX ? center : o.cross,
      z: alongX ? o.cross : center,
      w: alongX ? actualRun : o.width,
      d: alongX ? o.width : actualRun,
      bottom: o.fromY,
      top,
      kind: "ramp",
      group: o.group,
      walkable: true
    });
  }
  return n * actualRun;
}

/** Блок в локальных координатах (bottom/top — низ и верх) */
function B(x, z, w, d, bottom, top, kind, group, walkable = true, optional = false) {
  return { x, z, w, d, bottom, top, kind, group, walkable, optional };
}

/** Зазор между прямоугольниками в плоскости XZ (0 = касаются/пересекаются) */
function gapXZ(a, b) {
  const dx = Math.max(0, Math.max(a.x - a.w / 2 - (b.x + b.w / 2), b.x - b.w / 2 - (a.x + a.w / 2)));
  const dz = Math.max(0, Math.max(a.z - a.d / 2 - (b.z + b.d / 2), b.z - b.d / 2 - (a.z + a.d / 2)));
  return Math.hypot(dx, dz);
}

/** Пересечение прямоугольников в плоскости XZ */
function overlapXZ(a, b, pad = 0) {
  return (
    a.x - a.w / 2 < b.x + b.w / 2 + pad &&
    a.x + a.w / 2 > b.x - b.w / 2 - pad &&
    a.z - a.d / 2 < b.z + b.d / 2 + pad &&
    a.z + a.d / 2 > b.z - b.d / 2 - pad
  );
}

/** Зоны перед дверями в локальных координатах комнаты */
function doorZonesLocal(room) {
  const zones = [];
  const D = CONFIG.level.doorClearance;
  const halfDoor = (CONFIG.level.corridorWidth + 0.6) / 2;
  const hx = room.w / 2;
  const hz = room.d / 2;
  if (room.doors.north) zones.push({ x: 0, z: -hz + D / 2, w: halfDoor * 2, d: D });
  if (room.doors.south) zones.push({ x: 0, z: hz - D / 2, w: halfDoor * 2, d: D });
  if (room.doors.west) zones.push({ x: -hx + D / 2, z: 0, w: D, d: halfDoor * 2 });
  if (room.doors.east) zones.push({ x: hx - D / 2, z: 0, w: D, d: halfDoor * 2 });
  return zones;
}

// ────────────────────────────────────────────────────────────────────────────
// Шаблоны
// ────────────────────────────────────────────────────────────────────────────

/**
 * 1. Кольцо: центральная башня-реактор (landmark), кольцевая платформа
 *    шириной 5 м на высоте 3.6 м, 4 лестницы по диагоналям.
 */
function ringTemplate(rng, room) {
  const blocks = [];
  const tierH = 3.6;
  const th = 0.5;
  const R = 13.0; // внешний радиус
  const r = 8.0;  // внутренний радиус (ширина яруса R - r = 5.0 м)

  // 1. Центральная структура-ориентир: башня-реактор с энерго-ядром
  blocks.push(B(0, 0, 6, 6, 0, 10.0, "landmark", 1, false));
  blocks.push(B(0, 0, 4, 4, 10.0, 12.5, "landmark", 1, false));

  // 2. Кольцевой ярус шириной 5 м на высоте 3.6 м (без тупиков)
  const barTop = tierH;
  const barBottom = tierH - th;
  blocks.push(B(0, -(R + r) / 2, 2 * R, R - r, barBottom, barTop, "platform", 2));
  blocks.push(B(0, (R + r) / 2, 2 * R, R - r, barBottom, barTop, "platform", 3));
  blocks.push(B(-(R + r) / 2, 0, R - r, 2 * r, barBottom, barTop, "platform", 4));
  blocks.push(B((R + r) / 2, 0, R - r, 2 * r, barBottom, barTop, "platform", 5));

  // 3. Лестницы со ступенями <= 0.45 м (снаружи кольца по диагоналям x = ±13)
  const m = stairMetrics(tierH);
  const L = m.length;
  const zs = [6.5, -6.5];
  for (const z of zs) {
    for (const s of [1, -1]) {
      addStairs(blocks, {
        dir: s > 0 ? "-x" : "+x",
        start: s * (R + L),
        cross: z,
        width: 3,
        fromY: 0,
        toY: tierH,
        group: 10 + (s > 0 ? 0 : 1) + (z > 0 ? 0 : 2)
      });
    }
  }

  return { blocks, targetTierHeight: tierH, allowCenter: true };
}

/**
 * 2. Ярусы: второй ярус 3.6 м шириной 5 м по периметру, третий ярус 7.2 м
 *    с центральной башней-реактором (landmark), лестницы между всеми уровнями.
 */
function tiersTemplate(rng, room) {
  const blocks = [];
  const half = room.w / 2;
  const RO = Math.max(12, half - 7);     // внешний радиус яруса 2
  const RI = Math.max(7, RO - 5);        // внутренний радиус (ширина RO - RI = 5.0 м)
  const L2 = 3.6;
  const L3 = 7.2;
  const th = 0.5;

  // Центральная структура-ориентир: реакторная колонна со световым ядром
  blocks.push(B(0, 0, 4, 4, 0, 11.0, "landmark", 25, false));

  // Второй ярус (периметр) шириной 5 м на высоте 3.6 м
  const b2 = L2 - th;
  blocks.push(B(0, -(RO + RI) / 2, 2 * RO, RO - RI, b2, L2, "platform", 20));
  blocks.push(B(0, (RO + RI) / 2, 2 * RO, RO - RI, b2, L2, "platform", 21));
  blocks.push(B(-(RO + RI) / 2, 0, RO - RI, 2 * RI, b2, L2, "platform", 22));
  blocks.push(B((RO + RI) / 2, 0, RO - RI, 2 * RI, b2, L2, "platform", 23));

  // Третий ярус — центральная платформа на высоте 7.2 м
  const platHalf = Math.max(5, Math.min(7, RI - 6));
  blocks.push(B(0, 0, platHalf * 2, platHalf * 2, L3 - th, L3, "platform", 24, true));

  // Лестницы с пола на ярус 2 (север и юг, x = ±6)
  const m = stairMetrics(L2);
  const lenA = Math.max(6.0, m.length);
  addStairs(blocks, {
    dir: "+z",
    start: -(RO + lenA),
    cross: 6,
    width: 3,
    fromY: 0,
    toY: L2,
    length: lenA,
    group: 26
  });
  addStairs(blocks, {
    dir: "-z",
    start: RO + lenA,
    cross: -6,
    width: 3,
    fromY: 0,
    toY: L2,
    length: lenA,
    group: 27
  });

  // Лестница с яруса 2 на ярус 3
  const span = RI - platHalf;
  if (span >= 3.0) {
    addStairs(blocks, {
      dir: "-x",
      start: RI,
      cross: 0,
      width: 3,
      fromY: L2,
      toY: L3,
      length: span,
      group: 28
    });
  }

  return { blocks, targetTierHeight: L2, allowCenter: true };
}

/**
 * 3. Яма: центральная яма 16x16, мосты вровень с полом, центральный реактор (landmark),
 *    ярусы-платформы шириной 5 м на высоте 3.6 м с лестницами с обеих сторон.
 */
function pitTemplate(rng, room) {
  const blocks = [];
  const depth = CONFIG.level.pitDepth || 4;
  const pit = { x: 0, z: 0, w: 16, d: 16, depth };
  const half = room.w / 2;
  const tierH = 3.6;

  // Центральная структура-ориентир: реакторный столб, возвышающийся из ямы
  blocks.push(B(0, 0, 3.2, 3.2, -depth, 8.5, "landmark", 49, false));

  // Мосты вровень с полом (top = 0)
  const bridgeTop = 0;
  const bridgeBottom = -0.4;
  const bridgeLen = pit.w;
  blocks.push(B(0, 0, bridgeLen, 4, bridgeBottom, bridgeTop, "bridge", 40));
  blocks.push(B(0, 0, 4, bridgeLen, bridgeBottom, bridgeTop, "bridge", 41));

  // Ярусы шириной 5 м на высоте 3.6 м по бокам (запад и восток)
  const tierX = Math.min(half - 5.5, 14.5);
  const tierLen = 14;
  blocks.push(B(-tierX, 0, 5, tierLen, tierH - 0.5, tierH, "platform", 43, true));
  blocks.push(B(tierX, 0, 5, tierLen, tierH - 0.5, tierH, "platform", 44, true));

  // Лестницы на ярусы 3.6 м с обеих сторон
  addStairs(blocks, {
    dir: "+z",
    start: -(tierLen / 2 + 6),
    cross: -tierX,
    width: 3,
    fromY: 0,
    toY: tierH,
    length: 6,
    group: 45
  });
  addStairs(blocks, {
    dir: "-z",
    start: tierLen / 2 + 6,
    cross: tierX,
    width: 3,
    fromY: 0,
    toY: tierH,
    length: 6,
    group: 46
  });

  // Угловые невысокие платформы 1.2 м со ступенями
  let g = 50;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const px = sx * 11;
      const pz = sz * 11;
      const top = 1.2;
      blocks.push(B(px, pz, 5, 5, 0, top, "platform", g++, true));
      addStairs(blocks, {
        dir: sx > 0 ? "-x" : "+x",
        start: sx * 16.5,
        cross: pz,
        width: 3,
        fromY: 0,
        toY: top,
        length: 3,
        group: g++
      });
    }
  }

  return { blocks, pit, targetTierHeight: tierH, allowCenter: true };
}

/**
 * 4. Крест: центральный энерго-монумент (landmark), 4 угловых яруса 6x6
 *    (ширина >= 5 м) на высоте 3.6 м с лестницами, укрытия в рукавах.
 */
function crossTemplate(rng, room) {
  const blocks = [];
  const half = room.w / 2;
  const d = Math.max(12, Math.min(14, half - 8));
  const pd = d;
  const coverH = 1.6;
  const coverLen = 8;
  const tierH = 3.6;

  // Центральная структура-ориентир: энерго-фонтан / реакторный обелиск
  blocks.push(B(0, 0, 5, 5, 0, 1.2, "landmark", 59, false));
  blocks.push(B(0, 0, 3, 3, 1.2, 9.5, "landmark", 59, false));

  // Укрытия в рукавах (если есть дверь в рукаве, оставляем проход шириной >= 5 м открытым)
  const armHasDoor = (dir) => room.doors && room.doors[dir];
  if (!armHasDoor("east")) {
    blocks.push(B(d, 0, 1.6, coverLen, 0, coverH, "block", 60, false));
  } else {
    blocks.push(B(d, 4.5, 1.6, 2.5, 0, coverH, "block", 60, false));
    blocks.push(B(d, -4.5, 1.6, 2.5, 0, coverH, "block", 60, false));
  }
  if (!armHasDoor("west")) {
    blocks.push(B(-d, 0, 1.6, coverLen, 0, coverH, "block", 61, false));
  } else {
    blocks.push(B(-d, 4.5, 1.6, 2.5, 0, coverH, "block", 61, false));
    blocks.push(B(-d, -4.5, 1.6, 2.5, 0, coverH, "block", 61, false));
  }
  if (!armHasDoor("south")) {
    blocks.push(B(0, d, coverLen, 1.6, 0, coverH, "block", 62, false));
  } else {
    blocks.push(B(4.5, d, 2.5, 1.6, 0, coverH, "block", 62, false));
    blocks.push(B(-4.5, d, 2.5, 1.6, 0, coverH, "block", 62, false));
  }
  if (!armHasDoor("north")) {
    blocks.push(B(0, -d, coverLen, 1.6, 0, coverH, "block", 63, false));
  } else {
    blocks.push(B(4.5, -d, 2.5, 1.6, 0, coverH, "block", 63, false));
    blocks.push(B(-4.5, -d, 2.5, 1.6, 0, coverH, "block", 63, false));
  }

  // Угловые ярусы 6x6 (ширина 6 м >= 5 м) на высоте 3.6 м со ступенями
  let g = 70;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const px = sx * pd;
      const pz = sz * pd;
      blocks.push(B(px, pz, 6, 6, 0, tierH, "platform", g++, true));

      const m = stairMetrics(tierH);
      const edgeZ = pz - sz * 3;
      addStairs(blocks, {
        dir: sz > 0 ? "+z" : "-z",
        start: edgeZ - sz * m.length,
        cross: px,
        width: 3,
        fromY: 0,
        toY: tierH,
        group: g++
      });
    }
  }

  return { blocks, targetTierHeight: tierH, allowCenter: true };
}

/**
 * 5. Колонны: центральная башня-монолит со световым маяком (landmark),
 *    4 угловых яруса шириной 5 м на высоте 3.6 м со ступенями, высокие колонны.
 */
function columnsTemplate(rng, room) {
  const blocks = [];
  const tierH = 3.6;

  // Центральная структура-ориентир: грандиозный монолит-маяк со смотровым ярусом
  blocks.push(B(0, 0, 5, 5, 0, 10.5, "landmark", 79, false));

  const corners = [
    [-11.5, -11.5],
    [11.5, -11.5],
    [-11.5, 11.5],
    [11.5, 11.5]
  ];
  const edgeMids = [
    [0, -12],
    [0, 12],
    [-12, 0],
    [12, 0]
  ];

  // Все 4 угловые платформы шириной 5 м на высоте 3.6 м получают лестницы
  let g = 81;
  for (let i = 0; i < 4; i++) {
    const [x, z] = corners[i];
    const sx = Math.sign(x) || 1;
    blocks.push(B(x, z, 5, 5, 0, tierH, "platform", g++, true));

    const m = stairMetrics(tierH);
    addStairs(blocks, {
      dir: sx > 0 ? "-x" : "+x",
      start: x + sx * (2.5 + m.length),
      cross: z,
      width: 3,
      fromY: 0,
      toY: tierH,
      group: g++
    });
  }

  // Высокие колонны-укрытия по серединам сторон (высота 3.5-5.5 м)
  for (const [x, z] of edgeMids) {
    const h = rng.range(3.5, 5.5);
    const isNorth = z < -1 && x === 0;
    const isSouth = z > 1 && x === 0;
    const isWest = x < -1 && z === 0;
    const isEast = x > 1 && z === 0;
    const hasDoor =
      (isNorth && room.doors?.north) ||
      (isSouth && room.doors?.south) ||
      (isWest && room.doors?.west) ||
      (isEast && room.doors?.east);

    if (!hasDoor) {
      blocks.push(B(x, z, 4, 4, 0, h, "block", g++, false, true));
    } else {
      // При наличии двери разносим колонны по бокам от прохода (центр свободен)
      if (x === 0) {
        blocks.push(B(-4.5, z, 3, 3, 0, h, "block", g++, false, true));
        blocks.push(B(4.5, z, 3, 3, 0, h, "block", g++, false, true));
      } else {
        blocks.push(B(x, -4.5, 3, 3, 0, h, "block", g++, false, true));
        blocks.push(B(x, 4.5, 3, 3, 0, h, "block", g++, false, true));
      }
    }
  }

  return { blocks, targetTierHeight: tierH, allowCenter: true };
}

/**
 * 6. Лабиринт укрытий: центральная сторожевая башня (landmark),
 *    подвесной ярус шириной 5 м на высоте 3.6 м с лестницами с обеих сторон,
 *    угловые платформы и волнообразные стены.
 */
function mazeTemplate(rng, room) {
  const blocks = [];
  const halfX = room.w / 2;
  const halfZ = room.d / 2;
  const zones = doorZonesLocal(room);
  const tierH = 3.6;

  // Центральная структура-ориентир: дозорная башня-маяк
  blocks.push(B(0, 0, 5, 5, 0, 9.5, "landmark", 99, false));

  // Подвесной ярус шириной 5 м (длина 16 м) на высоте 3.6 м через центр к краю
  blocks.push(B(0, 10.5, 16, 5, tierH - 0.5, tierH, "platform", 101, true));

  // Лестницы на подвесной ярус с восточной и западной сторон
  addStairs(blocks, {
    dir: "-x",
    start: 13,
    cross: 10.5,
    width: 3,
    fromY: 0,
    toY: tierH,
    length: 5,
    group: 102
  });
  addStairs(blocks, {
    dir: "+x",
    start: -13,
    cross: 10.5,
    width: 3,
    fromY: 0,
    toY: tierH,
    length: 5,
    group: 103
  });

  // Угловые платформы со ступенями
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const px = sx * (halfX - 6);
      const pz = sz * (halfZ - 6);
      const top = 1.35;
      blocks.push(B(px, pz, 5, 5, 0, top, "platform", 110 + blocks.length, true));

      const m = stairMetrics(top);
      const edgeZ = pz - sz * 2.5;
      addStairs(blocks, {
        dir: sz > 0 ? "+z" : "-z",
        start: edgeZ - sz * m.length,
        cross: px,
        width: 3,
        fromY: 0,
        toY: top,
        group: 120 + blocks.length
      });
    }
  }

  // Стены укрытий лабиринта
  const edgeBlocks = blocks.slice();
  const required = 8;
  const extra = rng.rangeInt(0, 3);
  const target = required + extra;
  const bands = [-12, -6, 6, 12];
  const walls = [];
  let attempt = 0;
  while (walls.length < target && attempt < 500) {
    attempt++;
    const band = bands[attempt % bands.length];
    const z = band + rng.range(-0.2, 0.2);
    const len = rng.range(4.5, 7.0);
    const maxX = halfX - len / 2 - 2.0;
    if (maxX < -maxX) continue;
    const x = rng.range(-maxX, maxX);
    const h = rng.range(1.6, 2.4);
    const wall = B(x, z, len, 1.2, 0, h, "block", 200 + walls.length, false, walls.length >= required);

    // Не перекрываем центр 7x7
    if (overlapXZ(wall, { x: 0, z: 0, w: 7, d: 7 }, 0.2)) continue;

    // Не перекрываем зоны дверей
    let nearDoor = false;
    for (const zone of zones) {
      if (overlapXZ(wall, zone, 0.3)) {
        nearDoor = true;
        break;
      }
    }
    if (nearDoor) continue;

    // Проход >= minPassageWidth
    let tooClose = false;
    for (const other of walls) {
      if (gapXZ(wall, other) < CONFIG.level.minPassageWidth) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) {
      for (const other of edgeBlocks) {
        if (gapXZ(wall, other) < CONFIG.level.minPassageWidth) {
          tooClose = true;
          break;
        }
      }
    }
    if (tooClose) continue;

    walls.push(wall);
  }
  blocks.push(...walls);

  return { blocks, targetTierHeight: tierH, allowCenter: true };
}

export const ARENA_TEMPLATES = [
  { id: "ring", name: "Кольцо", build: ringTemplate },
  { id: "tiers", name: "Ярусы", build: tiersTemplate },
  { id: "pit", name: "Яма", build: pitTemplate },
  { id: "cross", name: "Крест", build: crossTemplate },
  { id: "columns", name: "Колонны", build: columnsTemplate },
  { id: "maze", name: "Лабиринт укрытий", build: mazeTemplate }
];

/**
 * Пересечение 2D-отрезка с прямоугольником (AABB) в плоскости XZ.
 */
function rayIntersectsBoxXZ(p0, p1, box) {
  const minX = box.x - box.w / 2;
  const maxX = box.x + box.w / 2;
  const minZ = box.z - box.d / 2;
  const maxZ = box.z + box.d / 2;

  let tmin = 0;
  let tmax = 1;
  const dx = p1.x - p0.x;
  const dz = p1.z - p0.z;

  if (Math.abs(dx) < 1e-8) {
    if (p0.x < minX || p0.x > maxX) return false;
  } else {
    const t1 = (minX - p0.x) / dx;
    const t2 = (maxX - p0.x) / dx;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
    if (tmin > tmax) return false;
  }

  if (Math.abs(dz) < 1e-8) {
    if (p0.z < minZ || p0.z > maxZ) return false;
  } else {
    const t1 = (minZ - p0.z) / dz;
    const t2 = (maxZ - p0.z) / dz;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
    if (tmin > tmax) return false;
  }

  return true;
}

/**
 * Проверка видимости арены (выборка 20 пар точек) и добавление стен-укрытий высотой 2.5 м,
 * если просматривается более 70% арены.
 */
function enforceSightlines(room, blocks, zones, rng) {
  const coverBlocks = blocks.filter((b) => b.y <= 1.6 && b.y + b.h >= 1.6);
  const bd = room.bounds;

  const sampleFloorPoint = () => {
    for (let i = 0; i < 50; i++) {
      const x = rng.range(bd.min.x + 3.5, bd.max.x - 3.5);
      const z = rng.range(bd.min.z + 3.5, bd.max.z - 3.5);
      if (room.pit) {
        const p = room.pit;
        if (x > p.x - p.w / 2 && x < p.x + p.w / 2 && z > p.z - p.d / 2 && z < p.z + p.d / 2) {
          continue;
        }
      }
      let inside = false;
      for (const b of coverBlocks) {
        if (x > b.x - b.w / 2 && x < b.x + b.w / 2 && z > b.z - b.d / 2 && z < b.z + b.d / 2) {
          inside = true;
          break;
        }
      }
      if (!inside) return { x, z };
    }
    return { x: room.center.x + rng.range(-6, 6), z: room.center.z + rng.range(-6, 6) };
  };

  const measureVisibility = () => {
    let visible = 0;
    for (let i = 0; i < 20; i++) {
      const p1 = sampleFloorPoint();
      const p2 = sampleFloorPoint();
      let blocked = false;
      for (const b of coverBlocks) {
        if (rayIntersectsBoxXZ(p1, p2, b)) {
          blocked = true;
          break;
        }
      }
      if (!blocked) visible++;
    }
    return visible / 20;
  };

  let visRatio = measureVisibility();
  if (visRatio <= 0.7) return;

  // Добавляем до 4 стен-укрытий высотой 2.5 м
  let barriersAdded = 0;
  const candidateOffsets = [
    { x: -7, z: -7, w: 4.5, d: 1.2 },
    { x: 7, z: -7, w: 1.2, d: 4.5 },
    { x: -7, z: 7, w: 1.2, d: 4.5 },
    { x: 7, z: 7, w: 4.5, d: 1.2 },
    { x: 0, z: -10, w: 5.0, d: 1.2 },
    { x: 0, z: 10, w: 5.0, d: 1.2 },
    { x: -10, z: 0, w: 1.2, d: 5.0 },
    { x: 10, z: 0, w: 1.2, d: 5.0 }
  ];
  rng.shuffle(candidateOffsets);

  for (const cand of candidateOffsets) {
    if (barriersAdded >= 4) break;
    // Не ставим укрытия прямо по осям проёмов дверей
    if (cand.x === 0 && (room.doors?.north || room.doors?.south)) continue;
    if (cand.z === 0 && (room.doors?.west || room.doors?.east)) continue;

    const wx = room.center.x + cand.x;
    const wz = room.center.z + cand.z;
    const barrier = {
      x: wx,
      z: wz,
      w: cand.w,
      d: cand.d,
      y: 0,
      h: 2.5,
      kind: "block",
      walkable: false,
      groupId: 500 + barriersAdded
    };

    // Проверка границ комнаты
    if (
      barrier.x - barrier.w / 2 < bd.min.x + 3.0 ||
      barrier.x + barrier.w / 2 > bd.max.x - 3.0 ||
      barrier.z - barrier.d / 2 < bd.min.z + 3.0 ||
      barrier.z + barrier.d / 2 > bd.max.z - 3.0
    ) {
      continue;
    }

    // Не перекрываем зоны дверей
    let nearDoor = false;
    for (const zone of zones) {
      if (overlapXZ(barrier, zone, 0.5)) {
        nearDoor = true;
        break;
      }
    }
    if (nearDoor) continue;

    // Проверяем свободный проход >= 4.0 м до других препятствий
    let tooClose = false;
    for (const b of blocks) {
      if (overlapXZ(barrier, b, 0.1)) {
        tooClose = true;
        break;
      }
      if (b.kind === "block" && !b.walkable && b.y < 2.2) {
        if (gapXZ(barrier, b) < CONFIG.level.minPassageWidth - 0.05) {
          tooClose = true;
          break;
        }
      }
    }
    if (tooClose) continue;

    blocks.push(barrier);
    coverBlocks.push(barrier);
    barriersAdded++;
    visRatio = measureVisibility();
    if (visRatio <= 0.7) break;
  }
}

/**
 * Применить вариативность (зеркала, поворот, пропуск необязательных блоков)
 * и перевести блоки в мировые координаты.
 * @param {Object} layout - { blocks, pit?, targetTierHeight?, allowCenter? }
 * @param {Object} room
 * @param {Object} rng
 */
export function finalizeArenaLayout(layout, room, rng) {
  const rot = rng.rangeInt(0, 3);
  const mirrorX = rng.next() < 0.5;
  const mirrorZ = rng.next() < 0.5;
  const swap = rot % 2 === 1;

  const transform = (x, z) => {
    let nx = mirrorX ? -x : x;
    let nz = mirrorZ ? -z : z;
    for (let k = 0; k < rot; k++) {
      const tx = -nz;
      nz = nx;
      nx = tx;
    }
    return { x: nx, z: nz };
  };

  const blocks = [];
  for (const b of layout.blocks) {
    if (b.optional && rng.next() < 0.18) continue;
    const p = transform(b.x, b.z);
    blocks.push({
      x: room.center.x + p.x,
      z: room.center.z + p.z,
      w: swap ? b.d : b.w,
      d: swap ? b.w : b.d,
      y: b.bottom,
      h: b.top - b.bottom,
      kind: b.kind,
      walkable: b.walkable !== false,
      groupId: b.group
    });
  }

  let pit = null;
  if (layout.pit) {
    const p = transform(layout.pit.x, layout.pit.z);
    pit = {
      x: room.center.x + p.x,
      z: room.center.z + p.z,
      w: swap ? layout.pit.d : layout.pit.w,
      d: swap ? layout.pit.w : layout.pit.d,
      depth: layout.pit.depth
    };
  }

  // Зоны дверей и каналы прямого прохода к дверям в мировых координатах
  const C = CONFIG.level;
  const bd = room.bounds;
  const worldDoorZones = [];
  const doorChannels = [];
  const halfChan = (C.corridorWidth + 0.6) / 2;

  for (const dir of DOOR_DIRS) {
    if (!room.doors[dir]) continue;
    if (dir === "north") {
      worldDoorZones.push({ x: room.center.x, z: bd.min.z + C.doorClearance / 2, w: C.corridorWidth + 0.6, d: C.doorClearance });
      doorChannels.push({ x: room.center.x, z: (bd.min.z + room.center.z) / 2, w: halfChan * 2, d: room.center.z - bd.min.z });
    } else if (dir === "south") {
      worldDoorZones.push({ x: room.center.x, z: bd.max.z - C.doorClearance / 2, w: C.corridorWidth + 0.6, d: C.doorClearance });
      doorChannels.push({ x: room.center.x, z: (bd.max.z + room.center.z) / 2, w: halfChan * 2, d: bd.max.z - room.center.z });
    } else if (dir === "west") {
      worldDoorZones.push({ x: bd.min.x + C.doorClearance / 2, z: room.center.z, w: C.doorClearance, d: C.corridorWidth + 0.6 });
      doorChannels.push({ x: (bd.min.x + room.center.x) / 2, z: room.center.z, w: room.center.x - bd.min.x, d: halfChan * 2 });
    } else {
      worldDoorZones.push({ x: bd.max.x - C.doorClearance / 2, z: room.center.z, w: C.doorClearance, d: C.corridorWidth + 0.6 });
      doorChannels.push({ x: (bd.max.x + room.center.x) / 2, z: room.center.z, w: bd.max.x - room.center.x, d: halfChan * 2 });
    }
  }

  // Проверяем блоки шаблона: препятствия на уровне пола не должны перекрывать зоны дверей и проходы
  const validBlocks = blocks.filter((b) => {
    if (b.kind === "bridge" || b.kind === "landmark") return true;
    if (b.walkable && b.y >= 2.2) return true;
    for (const dz of worldDoorZones) {
      if (overlapXZ(b, dz, 0.1)) return false;
    }
    if (b.walkable === false || (b.kind === "block" && b.y < 2.2)) {
      for (const ch of doorChannels) {
        if (overlapXZ(b, ch, 0)) return false;
      }
    }
    return true;
  });

  // Проверка видимости и добавление стен-укрытий
  enforceSightlines(room, validBlocks, worldDoorZones, rng);

  return { blocks: validBlocks, pit };
}

/**
 * Проверить геометрию арены на соответствие правилам:
 * границы, пересечения, проходы, зоны дверей, центр, центральная структура-ориентир,
 * достижимость платформ.
 * @param {Object} room - комната с заполненными blocks/pit/arenaAllowCenter
 * @returns {{ ok: boolean, issues: string[] }}
 */
export function validateArenaRoom(room) {
  const C = CONFIG.level;
  const blocks = room.blocks || [];
  const bd = room.bounds;
  const issues = [];
  if (blocks.length === 0) return { ok: true, issues };

  const minX = (b) => b.x - b.w / 2;
  const maxX = (b) => b.x + b.w / 2;
  const minZ = (b) => b.z - b.d / 2;
  const maxZ = (b) => b.z + b.d / 2;
  const top = (b) => b.y + b.h;

  // 1. Блоки внутри комнаты (не в стенах)
  for (const b of blocks) {
    if (
      minX(b) < bd.min.x + 0.4 ||
      maxX(b) > bd.max.x - 0.4 ||
      minZ(b) < bd.min.z + 0.4 ||
      maxZ(b) > bd.max.z - 0.4
    ) {
      issues.push("block out of room bounds");
      break;
    }
  }

  // 2. Пересечения блоков (мосты могут пересекаться между собой)
  outer: for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i];
      const b = blocks[j];
      if (a.kind === "bridge" || b.kind === "bridge") continue;
      if (
        minX(a) < maxX(b) - 0.02 &&
        maxX(a) > minX(b) + 0.02 &&
        minZ(a) < maxZ(b) - 0.02 &&
        maxZ(a) > minZ(b) + 0.02 &&
        a.y < top(b) - 0.02 &&
        top(a) > b.y + 0.02
      ) {
        issues.push("block overlap");
        break outer;
      }
    }
  }

  // 3. Проход >= minPassageWidth между препятствиями (укрытия/колонны)
  outer2: for (let i = 0; i < blocks.length; i++) {
    const a = blocks[i];
    if (a.kind !== "block" || a.walkable) continue;
    if (a.y >= 2.2) continue;
    for (let j = i + 1; j < blocks.length; j++) {
      const b = blocks[j];
      if (b.kind !== "block" || b.walkable) continue;
      if (b.y >= 2.2) continue;
      if (a.groupId === b.groupId) continue;
      if (gapXZ(a, b) < C.minPassageWidth - 0.05) {
        issues.push("passage too narrow");
        break outer2;
      }
    }
  }

  // 4. Зоны перед дверями (проходимая часть на уровне пола)
  for (const b of blocks) {
    if (b.y >= 2.2 || b.y + b.h <= 0.6) continue;
    for (const dir of DOOR_DIRS) {
      if (!room.doors[dir]) continue;
      let zone;
      if (dir === "north") {
        zone = { x: room.center.x, z: bd.min.z + C.doorClearance / 2, w: C.corridorWidth + 0.6, d: C.doorClearance };
      } else if (dir === "south") {
        zone = { x: room.center.x, z: bd.max.z - C.doorClearance / 2, w: C.corridorWidth + 0.6, d: C.doorClearance };
      } else if (dir === "west") {
        zone = { x: bd.min.x + C.doorClearance / 2, z: room.center.z, w: C.doorClearance, d: C.corridorWidth + 0.6 };
      } else {
        zone = { x: bd.max.x - C.doorClearance / 2, z: room.center.z, w: C.doorClearance, d: C.corridorWidth + 0.6 };
      }
      if (overlapXZ(b, zone, 0)) {
        issues.push("door approach blocked");
        break;
      }
    }
  }

  // 5. Центр арены свободен (или только низкая платформа/высокая конструкция)
  if (!room.arenaAllowCenter) {
    const center = {
      x: room.center.x,
      z: room.center.z,
      w: C.centerClearance,
      d: C.centerClearance
    };
    for (const b of blocks) {
      if (b.y >= 2.2 || b.y + b.h <= 0.6) continue;
      if (overlapXZ(b, center, 0)) {
        issues.push("center occupied");
        break;
      }
    }
  }

  // 6. Центральная структура-ориентир
  const hasLandmark = blocks.some((b) => b.kind === "landmark");
  if (!hasLandmark) {
    issues.push("missing central landmark");
  }

  // 7. Достижимость платформ (BFS по верхним поверхностям)
  const surfaces = [
    { x: room.center.x, z: room.center.z, w: room.w, d: room.d, top: 0 }
  ];
  for (const b of blocks) {
    if (b.walkable === false) continue;
    surfaces.push({ x: b.x, z: b.z, w: b.w, d: b.d, top: b.y + b.h });
  }
  const reached = new Set([0]);
  const queue = [0];
  const adjacent = (a, b) => {
    const dx = Math.max(0, Math.abs(a.x - b.x) - (a.w + b.w) / 2);
    const dz = Math.max(0, Math.abs(a.z - b.z) - (a.d + b.d) / 2);
    return Math.hypot(dx, dz) <= 0.6 + 1e-6;
  };

  while (queue.length > 0) {
    const i = queue.pop();
    for (let j = 0; j < surfaces.length; j++) {
      if (reached.has(j)) continue;
      if (Math.abs(surfaces[i].top - surfaces[j].top) > C.maxStepHeight + 1e-6) continue;
      if (!adjacent(surfaces[i], surfaces[j])) continue;
      reached.add(j);
      queue.push(j);
    }
  }

  for (let i = 1; i < surfaces.length; i++) {
    if (surfaces[i].top > 0.6 + 1e-6 && !reached.has(i)) {
      issues.push("unreachable platform");
      break;
    }
  }

  // 8. Яма должна быть внутри комнаты с запасом
  if (room.pit) {
    const p = room.pit;
    if (
      p.x - p.w / 2 < bd.min.x + 2 ||
      p.x + p.w / 2 > bd.max.x - 2 ||
      p.z - p.d / 2 < bd.min.z + 2 ||
      p.z + p.d / 2 > bd.max.z - 2
    ) {
      issues.push("pit out of bounds");
    }
  }

  return { ok: issues.length === 0, issues };
}
