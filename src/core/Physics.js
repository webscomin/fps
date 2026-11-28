// Физика: проверка пересечений луча и AABB, линия видимости, коллизии и вспомогательные функции
import * as THREE from "three";
import { CONFIG } from "../config.js";

const AX = ["x", "y", "z"];
export const EDGE_MAT = new THREE.LineBasicMaterial({
  color: CONFIG.world.outlineColor,
  visible: (CONFIG.graphics && CONFIG.graphics.styleName) === "cartoon"
});

// Переиспользуемый вектор для проверки видимости (не аллоцируем в горячем пути)
const _losDir = new THREE.Vector3();

/**
 * Создаёт 3D-меш с чёрным мультяшным контуром рёбер
 * @param {THREE.BufferGeometry} geo
 * @param {THREE.Material} mat
 * @param {number} [angle=25]
 * @returns {THREE.Mesh}
 */
export function outlined(geo, mat, angle = 25) {
  const m = new THREE.Mesh(geo, mat);
  m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, angle), EDGE_MAT));
  return m;
}

/**
 * Освободить геометрию и материалы объекта (например, удалённого врага или предмета).
 * Общие ресурсы (EDGE_MAT и текстуры с userData.shared) не освобождаются.
 * @param {THREE.Object3D} root
 */
export function disposeObject3D(root) {
  if (!root) return;
  const geometries = new Set();
  const materials = new Set();

  root.traverse((node) => {
    if (node.geometry) geometries.add(node.geometry);
    if (node.material) {
      if (Array.isArray(node.material)) {
        for (const m of node.material) materials.add(m);
      } else {
        materials.add(node.material);
      }
    }
  });

  for (const geo of geometries) {
    // Пропускаем общие ресурсы из кэша моделей
    if (geo.userData && geo.userData.shared) continue;
    geo.dispose();
  }
  for (const mat of materials) {
    if (mat === EDGE_MAT || (mat.userData && mat.userData.shared)) continue;
    const maps = [
      mat.map,
      mat.normalMap,
      mat.roughnessMap,
      mat.metalnessMap,
      mat.aoMap,
      mat.emissiveMap,
      mat.gradientMap
    ];
    for (const t of maps) {
      if (t && !(t.userData && t.userData.shared)) {
        t.dispose();
      }
    }
    mat.dispose();
  }
}

/**
 * Случайное число в диапазоне [-a, a]
 * @param {number} [a=1]
 * @returns {number}
 */
export function rnd(a = 1) {
  return (Math.random() - 0.5) * 2 * a;
}

/**
 * Пересечение луча с AABB (ограничивающим параллелепипедом) с возможностью расширения на радиус r
 * @param {THREE.Vector3} o - точка начала луча
 * @param {THREE.Vector3} d - направление луча (нормализованное)
 * @param {THREE.Vector3} min - минимальный угол коробки
 * @param {THREE.Vector3} max - максимальный угол коробки
 * @param {number} [r=0] - расширение радиуса
 * @returns {{ t: number, a: number, s: number } | null}
 */
export function rayAABB(o, d, min, max, r = 0) {
  let t0 = 0;
  let t1 = Infinity;
  let ha = -1;
  let hs = 0;

  for (let i = 0; i < 3; i++) {
    const k = AX[i];
    const dv = d[k];
    const ov = o[k];
    const lo = min[k] - r;
    const hi = max[k] + r;

    if (Math.abs(dv) < 1e-9) {
      if (ov < lo || ov > hi) return null;
      continue;
    }

    let a = (lo - ov) / dv;
    let b = (hi - ov) / dv;
    let sg = -1;

    if (a > b) {
      const tmp = a;
      a = b;
      b = tmp;
      sg = 1;
    }

    if (a > t0) {
      t0 = a;
      ha = i;
      hs = sg;
    }
    if (b < t1) t1 = b;
    if (t0 > t1) return null;
  }

  return ha < 0 ? null : { t: t0, a: ha, s: hs };
}

/**
 * Проверка прямой линии видимости между двумя точками
 * @param {THREE.Vector3} fromPos
 * @param {THREE.Vector3} toPos
 * @param {Array<{ min: THREE.Vector3, max: THREE.Vector3 }>} boxes
 * @param {number} [radius=0.1]
 * @returns {boolean}
 */
export function checkLineOfSight(fromPos, toPos, boxes, radius = 0.1) {
  const dir = _losDir.subVectors(toPos, fromPos);
  const dist = dir.length();
  if (dist < 1e-5) return true;
  dir.multiplyScalar(1 / dist);

  for (const b of boxes) {
    const hit = rayAABB(fromPos, dir, b.min, b.max, radius);
    if (hit && hit.t < dist - 0.2) {
      return false;
    }
  }
  return true;
}

/**
 * Разрешение коллизии персонажа/сущности с препятствиями по одной оси
 * @param {THREE.Vector3} pos
 * @param {THREE.Vector3} vel
 * @param {number} r - радиус хитбокса
 * @param {number} h - высота хитбокса
 * @param {Array<{ min: THREE.Vector3, max: THREE.Vector3 }>} boxes
 * @param {"x" | "y" | "z"} axis
 * @param {number} [eps=0.0005]
 * @param {number} [floorY=0] - нижний предел мира (для ям арен ниже уровня пола)
 * @returns {boolean} landed - произошло ли приземление на пол/препятствие
 */
export function resolveBoxCollision(pos, vel, r, h, boxes, axis, eps = 0.0005, floorY = 0) {
  let landed = false;

  if (axis === "y" && pos.y < floorY) {
    pos.y = floorY;
    if (vel.y < 0) {
      vel.y = 0;
      landed = true;
    }
  }

  for (const b of boxes) {
    if (
      pos.x + r <= b.min.x || pos.x - r >= b.max.x ||
      pos.z + r <= b.min.z || pos.z - r >= b.max.z ||
      pos.y + h <= b.min.y || pos.y >= b.max.y
    ) {
      continue;
    }

    if (axis === "x") {
      const boxCenterX = (b.min.x + b.max.x) / 2;
      if (vel.x > 0 && pos.x < boxCenterX) {
        pos.x = b.min.x - r - eps;
      } else if (vel.x < 0 && pos.x > boxCenterX) {
        pos.x = b.max.x + r + eps;
      } else {
        pos.x = pos.x < boxCenterX ? b.min.x - r - eps : b.max.x + r + eps;
      }
      vel.x = 0;
    } else if (axis === "z") {
      const boxCenterZ = (b.min.z + b.max.z) / 2;
      if (vel.z > 0 && pos.z < boxCenterZ) {
        pos.z = b.min.z - r - eps;
      } else if (vel.z < 0 && pos.z > boxCenterZ) {
        pos.z = b.max.z + r + eps;
      } else {
        pos.z = pos.z < boxCenterZ ? b.min.z - r - eps : b.max.z + r + eps;
      }
      vel.z = 0;
    } else {
      const boxCenterY = (b.min.y + b.max.y) / 2;
      if (vel.y < 0) {
        pos.y = b.max.y;
        vel.y = 0;
        landed = true;
      } else if (vel.y > 0) {
        pos.y = b.min.y - h - eps;
        vel.y = 0;
      } else {
        if (pos.y + h / 2 >= boxCenterY) {
          pos.y = b.max.y;
          landed = true;
        } else {
          pos.y = b.min.y - h - eps;
        }
        vel.y = 0;
      }
    }
  }

  return landed;
}

/**
 * Пересечение луча с вертикальным конечным цилиндром (хитбокс бочки).
 * @param {THREE.Vector3} o - начало луча
 * @param {THREE.Vector3} d - направление луча (нормализованное)
 * @param {number} cx - центр цилиндра по X
 * @param {number} cz - центр цилиндра по Z
 * @param {number} radius - радиус
 * @param {number} minY - низ цилиндра
 * @param {number} maxY - верх цилиндра
 * @returns {{ t: number, normal: THREE.Vector3 } | null}
 */
export function rayCylinderY(o, d, cx, cz, radius, minY, maxY) {
  let bestT = Infinity;
  let bestNormal = null;

  const ox = o.x - cx;
  const oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;

  // Боковая поверхность
  if (a > 1e-9) {
    const b = 2 * (ox * d.x + oz * d.z);
    const c = ox * ox + oz * oz - radius * radius;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t0 = (-b - sq) / (2 * a);
      const t1 = (-b + sq) / (2 * a);
      for (const t of [t0, t1]) {
        if (t <= 1e-6 || t >= bestT) continue;
        const y = o.y + d.y * t;
        if (y < minY || y > maxY) continue;
        const px = ox + d.x * t;
        const pz = oz + d.z * t;
        const len = Math.hypot(px, pz) || 1;
        bestT = t;
        bestNormal = new THREE.Vector3(px / len, 0, pz / len);
      }
    }
  }

  // Верхняя и нижняя крышки
  if (Math.abs(d.y) > 1e-9) {
    const caps = [
      { y: maxY, ny: 1 },
      { y: minY, ny: -1 }
    ];
    for (const cap of caps) {
      const t = (cap.y - o.y) / d.y;
      if (t <= 1e-6 || t >= bestT) continue;
      const px = ox + d.x * t;
      const pz = oz + d.z * t;
      if (px * px + pz * pz > radius * radius + 1e-6) continue;
      bestT = t;
      bestNormal = new THREE.Vector3(0, cap.ny, 0);
    }
  }

  return bestNormal ? { t: bestT, normal: bestNormal } : null;
}

/**
 * Трассировка луча по миру, мишеням, врагам и бочкам
 * @param {THREE.Vector3} o - начало луча
 * @param {THREE.Vector3} d - направление луча
 * @param {number} maxT - максимальная дальность
 * @param {number} r - радиус луча
 * @param {Array} boxes - коробки стен/препятствий
 * @param {Array} targets - мишени
 * @param {Array} enemies - враги
 * @param {Array} barrels - взрывные бочки (хитбокс-цилиндр)
 * @returns {{ t: number, point: THREE.Vector3, normal: THREE.Vector3, target: Object|null, enemy: Object|null, barrel: Object|null, isHead: boolean } | null}
 */
export function castSceneRay(o, d, maxT, r, boxes, targets = [], enemies = [], barrels = []) {
  let bt = maxT;
  let ba = -1;
  let bs = 0;
  let tg = null;
  let zm = null;
  let brl = null;
  let brlNormal = null;
  let isHead = false;

  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    // Коллайдер бочки пропускаем: у неё отдельный хитбокс-цилиндр
    if (b.isBarrel) continue;
    const h = rayAABB(o, d, b.min, b.max, r);
    if (h && h.t < bt) {
      bt = h.t;
      ba = h.a;
      bs = h.s;
      tg = null;
      zm = null;
    }
  }

  if (d.y < -1e-9) {
    const t = (r - o.y) / d.y;
    if (t >= 0 && t < bt) {
      bt = t;
      ba = 1;
      bs = 1;
      tg = null;
      zm = null;
    }
  }

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (!t.alive) continue;
    const h = rayAABB(o, d, t.min, t.max, r);
    if (h && h.t < bt) {
      bt = h.t;
      ba = h.a;
      bs = h.s;
      tg = t;
      zm = null;
    }
  }

  for (let i = 0; i < enemies.length; i++) {
    const z = enemies[i];
    if (!z.alive) continue;
    const hh = rayAABB(o, d, z.headMin, z.headMax, r);
    if (hh && hh.t < bt) {
      bt = hh.t;
      ba = hh.a;
      bs = hh.s;
      zm = z;
      tg = null;
      isHead = true;
      continue;
    }
    const hb = rayAABB(o, d, z.bodyMin, z.bodyMax, r);
    if (hb && hb.t < bt) {
      bt = hb.t;
      ba = hb.a;
      bs = hb.s;
      zm = z;
      tg = null;
      isHead = false;
    }
  }

  // Бочки: хитбокс-цилиндр (последними, чтобы корректно сравнить t с миром и врагами)
  for (let i = 0; i < barrels.length; i++) {
    const b = barrels[i];
    if (!b || !b.alive) continue;
    const hb = rayCylinderY(o, d, b.pos.x, b.pos.z, b.hitRadius, b.pos.y, b.pos.y + b.hitHeight);
    if (hb && hb.t < bt) {
      bt = hb.t;
      brl = b;
      brlNormal = hb.normal;
      ba = -1;
      tg = null;
      zm = null;
      isHead = false;
    }
  }

  if (ba < 0 && !brl) return null;

  const normal = brlNormal ? brlNormal : new THREE.Vector3(0, 0, 0);
  if (!brlNormal) normal[AX[ba]] = bs;

  const point = o.clone().addScaledVector(d, bt).addScaledVector(normal, -r);

  return {
    t: bt,
    point,
    normal,
    target: tg,
    enemy: zm,
    barrel: brl,
    isHead
  };
}
