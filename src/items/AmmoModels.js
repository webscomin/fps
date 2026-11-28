// Сборка и кэширование общих 3D-моделей подбираемых патронов (1-2 вызова отрисовки на предмет)
import * as THREE from "three";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import { CONFIG } from "../config.js";
import * as ModelCache from "../core/ModelCache.js";

const _ammoTemplates = new Map();

/**
 * Привести геометрию к единому формату без индексов (position, normal, uv) для mergeGeometries.
 * @param {THREE.BufferGeometry} srcGeo
 * @param {boolean} [keepColor=false]
 * @returns {THREE.BufferGeometry}
 */
function prepareGeometryForMerge(srcGeo, keepColor = false) {
  const geo = srcGeo.index ? srcGeo.toNonIndexed() : srcGeo.clone();
  if (!geo.getAttribute("normal")) {
    geo.computeVertexNormals();
  }
  const pos = geo.getAttribute("position");
  const count = pos ? pos.count : 0;
  if (!geo.getAttribute("uv")) {
    geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  }
  for (const name of Object.keys(geo.attributes)) {
    if (name !== "position" && name !== "normal" && name !== "uv" && !(keepColor && name === "color")) {
      geo.deleteAttribute(name);
    }
  }
  return geo;
}

/**
 * Нормализовать геометрию по длинной стороне до targetSize с началом координат по центру внизу.
 * @param {THREE.BufferGeometry} geo
 * @param {number} targetSize
 * @returns {number} применённый коэффициент масштаба
 */
function normalizeCenterBottom(geo, targetSize) {
  geo.computeBoundingBox();
  const box = geo.boundingBox;
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
  const scale = targetSize / maxDim;

  geo.translate(-center.x, -box.min.y, -center.z);
  geo.scale(scale, scale, scale);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return scale;
}

/**
 * Настроить текстуру в стиле PSX (NearestFilter, без mipmaps, sRGB) и пометить как общую.
 * @param {THREE.Texture|null} tex
 * @returns {THREE.Texture|null}
 */
function setupPixelTexture(tex) {
  if (!tex) return null;
  tex.userData.shared = true;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function buildShotgunTemplate() {
  const node = ModelCache.getNodeClone("ammoShotgun", "ShotgunAmmoPack") || ModelCache.getSceneClone("ammoShotgun");
  if (!node) {
    console.error("[AmmoModels] Не удалось получить узел ShotgunAmmoPack из ammoShotgun.");
    return null;
  }

  const meshes = [];
  node.updateMatrixWorld(true);
  node.traverse((n) => {
    if (n.isMesh && n.geometry) meshes.push(n);
  });
  if (meshes.length === 0) {
    console.error("[AmmoModels] В модели ammoShotgun не найдены меши.");
    return null;
  }

  const b = CONFIG.ammo?.brightness ?? 1.0;
  const partGeos = [];
  const materials = [];

  for (let i = 0; i < meshes.length; i++) {
    const m = meshes[i];
    const g = prepareGeometryForMerge(m.geometry, false);
    g.applyMatrix4(m.matrixWorld);
    partGeos.push(g);

    const srcMat = Array.isArray(m.material) ? m.material[0] : m.material;
    if (srcMat && srcMat.map) {
      const map = setupPixelTexture(srcMat.map);
      const mat = new THREE.MeshLambertMaterial({
        color: new THREE.Color(b, b, b),
        map,
        alphaTest: 0.5,
        transparent: false,
        side: THREE.DoubleSide
      });
      mat.userData.shared = true;
      materials.push(mat);
    } else {
      const col = srcMat && srcMat.color ? srcMat.color.clone() : new THREE.Color(0.4, 0.4, 0.4);
      col.multiplyScalar(b);
      const mat = new THREE.MeshLambertMaterial({ color: col });
      mat.userData.shared = true;
      materials.push(mat);
    }
  }

  const geo = partGeos.length === 1
    ? partGeos[0]
    : BufferGeometryUtils.mergeGeometries(partGeos, true);
  if (!geo) {
    console.error("[AmmoModels] Не удалось объединить геометрию ammoShotgun.");
    return null;
  }

  const targetSize = CONFIG.ammo?.size?.shotgun ?? 0.40;
  normalizeCenterBottom(geo, targetSize);
  geo.userData.shared = true;

  return {
    geometry: geo,
    material: materials.length === 1 ? materials[0] : materials
  };
}

function buildAk47Template() {
  const boxNode = ModelCache.getNodeClone("ammo", "Ammo_Box_Closed");
  const roundNode = ModelCache.getNodeClone("ammo", "Rifle_caliber_2");
  if (!boxNode || !roundNode) {
    console.error("[AmmoModels] В модели ammo.glb не найдены узлы Ammo_Box_Closed или Rifle_caliber_2.");
    return null;
  }

  boxNode.updateMatrixWorld(true);
  roundNode.updateMatrixWorld(true);

  let boxMesh = null;
  boxNode.traverse((n) => {
    if (!boxMesh && n.isMesh && n.geometry) boxMesh = n;
  });
  let roundMesh = null;
  roundNode.traverse((n) => {
    if (!roundMesh && n.isMesh && n.geometry) roundMesh = n;
  });
  if (!boxMesh || !roundMesh) {
    console.error("[AmmoModels] Не найдены меши в узлах Ammo_Box_Closed / Rifle_caliber_2.");
    return null;
  }

  // Коробка: применяем матрицу узла (включая масштаб), нормализуем к CONFIG.ammo.size.ak47
  const boxGeo = prepareGeometryForMerge(boxMesh.geometry, false);
  boxGeo.applyMatrix4(boxMesh.matrixWorld);
  const targetSize = CONFIG.ammo?.size?.ak47 ?? 0.42;
  const boxScale = normalizeCenterBottom(boxGeo, targetSize);
  const boxTopY = boxGeo.boundingBox.max.y;

  // Патрон: применяем матрицу узла и общий масштаб коробки, центрируем в (0,0,0)
  const baseRound = prepareGeometryForMerge(roundMesh.geometry, false);
  baseRound.applyMatrix4(roundMesh.matrixWorld);
  baseRound.scale(boxScale, boxScale, boxScale);
  baseRound.computeBoundingBox();
  const rCenter = new THREE.Vector3();
  baseRound.boundingBox.getCenter(rCenter);
  baseRound.translate(-rCenter.x, -rCenter.y, -rCenter.z);

  const layout = CONFIG.ammo?.layout?.ak47 || [
    { pos: [-0.03, 0.018, -0.045], rot: [0, 0.12, -Math.PI / 2], scale: 1.0 },
    { pos: [0.01, 0.018, -0.015], rot: [0, -0.06, -Math.PI / 2], scale: 1.0 },
    { pos: [-0.01, 0.018, 0.02], rot: [0, 0.08, -Math.PI / 2], scale: 1.0 },
    { pos: [0.025, 0.046, -0.005], rot: [0.08, -0.18, -Math.PI / 2], scale: 1.0 }
  ];

  const roundGeos = [];
  const mat4 = new THREE.Matrix4();
  const euler = new THREE.Euler();
  const quat = new THREE.Quaternion();
  const posV = new THREE.Vector3();
  const scaleV = new THREE.Vector3();

  for (const item of layout) {
    const rg = baseRound.clone();
    const p = item.pos || [0, 0.018, 0];
    const r = item.rot || [0, 0, -Math.PI / 2];
    const s = item.scale ?? 1.0;
    posV.set(p[0], boxTopY + p[1], p[2]);
    euler.set(r[0], r[1], r[2]);
    quat.setFromEuler(euler);
    scaleV.set(s, s, s);
    mat4.compose(posV, quat, scaleV);
    rg.applyMatrix4(mat4);
    roundGeos.push(rg);
  }

  const roundsMerged = BufferGeometryUtils.mergeGeometries(roundGeos, false);
  const merged = BufferGeometryUtils.mergeGeometries([boxGeo, roundsMerged], true);
  if (!merged) {
    console.error("[AmmoModels] Не удалось объединить геометрию коробки и патронов АК-47.");
    return null;
  }
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  merged.userData.shared = true;

  const b = CONFIG.ammo?.brightness ?? 1.0;
  const tint = CONFIG.ammo?.ak47?.boxTint || [1.1, 1.0, 0.7];

  const origBoxMat = Array.isArray(boxMesh.material) ? boxMesh.material[0] : boxMesh.material;
  const boxMap = setupPixelTexture(origBoxMat && origBoxMat.map ? origBoxMat.map : null);
  const boxMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(tint[0] * b, tint[1] * b, tint[2] * b),
    map: boxMap,
    side: THREE.DoubleSide
  });
  boxMat.userData.shared = true;

  const origRoundMat = Array.isArray(roundMesh.material) ? roundMesh.material[0] : roundMesh.material;
  const roundMap = setupPixelTexture(origRoundMat && origRoundMat.map ? origRoundMat.map : null);
  const roundMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(b, b, b),
    map: roundMap,
    side: THREE.DoubleSide
  });
  roundMat.userData.shared = true;

  return { geometry: merged, material: [boxMat, roundMat] };
}

/**
 * Записать или умножить вершинные цвета геометрии по нормализованной высоте h (или фиксированный цвет).
 * @param {THREE.BufferGeometry} geo
 * @param {(y: number, minY: number, maxY: number) => [number, number, number]} colorFn
 */
function applyVertexColors(geo, colorFn) {
  geo.computeBoundingBox();
  const minY = geo.boundingBox.min.y;
  const maxY = geo.boundingBox.max.y;
  const pos = geo.getAttribute("position");
  const existing = geo.getAttribute("color");
  const colors = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const [r, g, b] = colorFn(y, minY, maxY);
    if (existing) {
      colors[i * 3] = existing.getX(i) * r;
      colors[i * 3 + 1] = existing.getY(i) * g;
      colors[i * 3 + 2] = existing.getZ(i) * b;
    } else {
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

function buildRocketTemplate() {
  const sceneClone = ModelCache.getSceneClone("ammoRocket");
  if (!sceneClone) {
    console.error("[AmmoModels] Не удалось получить сцену ammoRocket.");
    return null;
  }

  sceneClone.updateMatrixWorld(true);
  const cylNode = sceneClone.getObjectByName("Cylinder");
  const bracketNode = sceneClone.getObjectByName("Cylinder001");

  const partGeos = [];
  const bands = CONFIG.ammo?.rocket?.bands || [
    { maxH: 0.20, color: [0.25, 0.25, 0.28] },
    { maxH: 0.62, color: [0.36, 0.40, 0.20] },
    { maxH: 0.68, color: [0.22, 0.22, 0.24] },
    { maxH: 0.94, color: [0.86, 0.30, 0.12] },
    { maxH: 1.01, color: [0.70, 0.70, 0.70] }
  ];
  const bracketCol = CONFIG.ammo?.rocket?.bracketColor || [0.28, 0.28, 0.30];

  const getBandColor = (y, minY, maxY) => {
    const span = Math.max(1e-6, maxY - minY);
    const h = Math.min(1, Math.max(0, (y - minY) / span));
    for (const band of bands) {
      if (h <= band.maxH) return band.color;
    }
    return bands[bands.length - 1].color;
  };

  if (cylNode && cylNode.isMesh && cylNode.geometry) {
    const g = prepareGeometryForMerge(cylNode.geometry, true);
    g.applyMatrix4(cylNode.matrixWorld);
    applyVertexColors(g, getBandColor);
    partGeos.push(g);
  }

  if (bracketNode && bracketNode.isMesh && bracketNode.geometry) {
    const g = prepareGeometryForMerge(bracketNode.geometry, true);
    g.applyMatrix4(bracketNode.matrixWorld);
    applyVertexColors(g, () => bracketCol);
    partGeos.push(g);
  }

  // На случай переименованных мешей берём все оставшиеся меши сцены
  if (partGeos.length === 0) {
    sceneClone.traverse((n) => {
      if (n.isMesh && n.geometry) {
        const g = prepareGeometryForMerge(n.geometry, true);
        g.applyMatrix4(n.matrixWorld);
        applyVertexColors(g, getBandColor);
        partGeos.push(g);
      }
    });
  }

  if (partGeos.length === 0) {
    console.error("[AmmoModels] В модели ammoRocket не найдены меши.");
    return null;
  }

  const merged = partGeos.length === 1 ? partGeos[0] : BufferGeometryUtils.mergeGeometries(partGeos, false);
  if (!merged) {
    console.error("[AmmoModels] Не удалось объединить геометрию ракет.");
    return null;
  }

  // Наклон связки под углом 25° к полу (боеголовки приподняты)
  const tiltDeg = CONFIG.ammo?.rocket?.tiltDeg ?? 25;
  const tiltFromVertical = ((90 - tiltDeg) * Math.PI) / 180;
  merged.rotateZ(-tiltFromVertical);

  const targetSize = CONFIG.ammo?.size?.rocket ?? 0.55;
  normalizeCenterBottom(merged, targetSize);
  merged.userData.shared = true;

  const b = CONFIG.ammo?.brightness ?? 1.0;
  const mat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(b, b, b),
    vertexColors: true
  });
  mat.userData.shared = true;

  return { geometry: merged, material: mat };
}

/**
 * Получить или собрать общий шаблон (геометрия + материалы) для типа патронов.
 * @param {"ammo_shotgun"|"ammo_ak47"|"ammo_rocket"} type
 * @returns {{geometry: THREE.BufferGeometry, material: THREE.Material|THREE.Material[]}|null}
 */
export function getAmmoTemplate(type) {
  if (_ammoTemplates.has(type)) {
    return _ammoTemplates.get(type);
  }

  const key = type === "ammo_shotgun" ? "ammoShotgun" : type === "ammo_ak47" ? "ammo" : type === "ammo_rocket" ? "ammoRocket" : null;
  if (!key || !ModelCache.has(key)) {
    return null;
  }

  let tpl = null;
  try {
    if (type === "ammo_shotgun") {
      tpl = buildShotgunTemplate();
    } else if (type === "ammo_ak47") {
      tpl = buildAk47Template();
    } else if (type === "ammo_rocket") {
      tpl = buildRocketTemplate();
    }
  } catch (err) {
    console.error(`[AmmoModels] Ошибка сборки 3D-модели патронов "${type}":`, err);
    tpl = null;
  }

  _ammoTemplates.set(type, tpl);
  return tpl;
}

/**
 * Создать инстанс Mesh с общей геометрией и общими материалами для подбираемых патронов.
 * @param {"ammo_shotgun"|"ammo_ak47"|"ammo_rocket"} type
 * @returns {THREE.Mesh|null}
 */
export function createAmmoPickupMesh(type) {
  const tpl = getAmmoTemplate(type);
  if (!tpl) return null;
  return new THREE.Mesh(tpl.geometry, tpl.material);
}

const _casingTemplates = new Map();

/**
 * Центрировать геометрию в (0,0,0) и масштабировать по длине Y до targetLength.
 * @param {THREE.BufferGeometry} geo
 * @param {number} targetLength
 */
function normalizeCenterOriginY(geo, targetLength) {
  geo.computeBoundingBox();
  const box = geo.boundingBox;
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const scale = targetLength / Math.max(size.y, 1e-6);
  geo.translate(-center.x, -center.y, -center.z);
  geo.scale(scale, scale, scale);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}

/**
 * Определить границу между гильзой и пулей по резкому сужению радиуса вдоль Y
 * и оставить только треугольники корпуса (центр которых <= границы).
 * @param {THREE.BufferGeometry} srcGeo (неиндексированная)
 * @returns {{geometry: THREE.BufferGeometry, cutoffFound: boolean, cutoffY: number|null}}
 */
export function stripBulletFromCasingGeometry(srcGeo) {
  const geo = srcGeo.index ? srcGeo.toNonIndexed() : srcGeo.clone();
  geo.computeBoundingBox();
  const minY = geo.boundingBox.min.y;
  const maxY = geo.boundingBox.max.y;
  const spanY = Math.max(1e-6, maxY - minY);

  const pos = geo.getAttribute("position");
  const rings = new Map();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const key = Math.round(y * 1000) / 1000;
    const r = Math.hypot(pos.getX(i), pos.getZ(i));
    const prev = rings.get(key);
    if (!prev || r > prev.r) rings.set(key, { y, r });
  }

  const sorted = [...rings.values()].sort((a, b) => a.y - b.y);
  const lowerRadii = sorted.filter((p) => (p.y - minY) / spanY <= 0.5).map((p) => p.r);
  const maxLowerR = lowerRadii.length ? Math.max(...lowerRadii) : 0;

  let cutoffY = null;
  if (maxLowerR > 1e-6) {
    for (const p of sorted) {
      const h = (p.y - minY) / spanY;
      if (h > 0.4 && p.r < maxLowerR * 0.78) {
        cutoffY = p.y;
        break;
      }
    }
  }

  if (cutoffY === null) {
    return { geometry: geo, cutoffFound: false, cutoffY: null };
  }

  const norm = geo.getAttribute("normal");
  const uv = geo.getAttribute("uv");
  const keepPos = [];
  const keepNorm = [];
  const keepUv = [];

  for (let i = 0; i + 2 < pos.count; i += 3) {
    const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    if (cy <= cutoffY) {
      for (let k = 0; k < 3; k++) {
        const idx = i + k;
        keepPos.push(pos.getX(idx), pos.getY(idx), pos.getZ(idx));
        if (norm) keepNorm.push(norm.getX(idx), norm.getY(idx), norm.getZ(idx));
        if (uv) keepUv.push(uv.getX(idx), uv.getY(idx));
      }
    }
  }

  if (keepPos.length === 0) {
    return { geometry: geo, cutoffFound: false, cutoffY: null };
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(keepPos, 3));
  if (keepNorm.length === keepPos.length) {
    out.setAttribute("normal", new THREE.Float32BufferAttribute(keepNorm, 3));
  } else {
    out.computeVertexNormals();
  }
  if (keepUv.length > 0) {
    out.setAttribute("uv", new THREE.Float32BufferAttribute(keepUv, 2));
  }
  return { geometry: out, cutoffFound: true, cutoffY };
}

/**
 * Получить общую геометрию и общий материал для вылетающей гильзы ("shotgun" | "ak47").
 * @param {"shotgun"|"ak47"} type
 * @returns {{geometry: THREE.BufferGeometry, material: THREE.Material}|null}
 */
export function getCasingTemplate(type) {
  if (_casingTemplates.has(type)) {
    return _casingTemplates.get(type);
  }
  if (!ModelCache.has("ammo")) {
    return null;
  }

  const nodeName = type === "shotgun" ? "Shotgun_shell_1" : type === "ak47" ? "Rifle_caliber_2" : null;
  if (!nodeName) return null;

  const node = ModelCache.getNodeClone("ammo", nodeName);
  if (!node) {
    console.error(`[AmmoModels] Узел "${nodeName}" не найден в ammo.glb.`);
    _casingTemplates.set(type, null);
    return null;
  }

  node.updateMatrixWorld(true);
  let srcMesh = null;
  node.traverse((n) => {
    if (!srcMesh && n.isMesh && n.geometry) srcMesh = n;
  });
  if (!srcMesh) {
    console.error(`[AmmoModels] Меш не найден в узле "${nodeName}".`);
    _casingTemplates.set(type, null);
    return null;
  }

  let geo = prepareGeometryForMerge(srcMesh.geometry, false);
  geo.applyMatrix4(srcMesh.matrixWorld);

  if (type === "ak47") {
    const res = stripBulletFromCasingGeometry(geo);
    geo = res.geometry;
    if (!res.cutoffFound) {
      console.warn("[AmmoModels] Не удалось определить границу пули для Rifle_caliber_2, используется целый патрон.");
    }
  }

  const casingCfg = CONFIG.ammo?.casing?.[type] || {};
  const targetLen = casingCfg.length ?? (type === "shotgun" ? 0.075 : 0.055);
  normalizeCenterOriginY(geo, targetLen);
  geo.userData.shared = true;

  const origMat = Array.isArray(srcMesh.material) ? srcMesh.material[0] : srcMesh.material;
  const map = setupPixelTexture(origMat && origMat.map ? origMat.map : null);
  const tint = casingCfg.tint || (type === "shotgun" ? [1.0, 1.0, 1.0] : [0.78, 0.48, 0.30]);
  const mat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(tint[0], tint[1], tint[2]),
    map,
    side: THREE.DoubleSide
  });
  mat.userData.shared = true;

  const tpl = { geometry: geo, material: mat };
  _casingTemplates.set(type, tpl);
  return tpl;
}
