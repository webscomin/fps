// Кэш и предзагрузка 3D-моделей (glTF/GLB) с пулом инстансов через SkeletonUtils.clone
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { CONFIG } from "../config.js";
import { getGradientMap, attachVertexSnap } from "../world/Materials.js";

const _cache = new Map();
let _initPromise = null;

/**
 * Подготовить узел бочки из barrel.glb: оставить только нужный узел,
 * заменить материал на общий MeshLambertMaterial с той же картой цвета.
 * @param {THREE.Object3D} scene
 * @param {Object} data
 */
function prepareBarrelNode(scene, data) {
  const cfg = CONFIG.barrels || {};
  const color = cfg.color || "Red";
  const res = String(cfg.model || "high").toLowerCase() === "low" ? "Low" : "High";
  const nodeName = `${color}_Barrel_${res}`;
  const node = scene.getObjectByName(nodeName);

  if (!node) {
    console.warn(`[ModelCache] В barrel.glb не найден узел "${nodeName}". Будет использована запасная бочка.`);
    return;
  }

  const srcMat = Array.isArray(node.material) ? node.material[0] : node.material;
  const map = srcMat && srcMat.map ? srcMat.map : null;
  if (map) {
    // PSX-вид: без mipmaps, ближайшая фильтрация, sRGB
    map.magFilter = THREE.NearestFilter;
    map.minFilter = THREE.NearestFilter;
    map.generateMipmaps = false;
    map.colorSpace = THREE.SRGBColorSpace;
    map.needsUpdate = true;
  } else {
    console.warn(`[ModelCache] У бочки "${nodeName}" нет карты цвета. Используется белый цвет.`);
  }

  // Общий материал для всех бочек: Lambert без металла, bump и normal map.
  const material = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    map
  });
  material.userData.shared = true;
  if (node.geometry) node.geometry.userData.shared = true;
  node.material = material;

  data.barrel = { nodeName, material, texture: map };
}

/**
 * Удалить из сцены все источники света, камеры и пустые узлы без мешей.
 * @param {THREE.Object3D} root
 * @returns {number} количество удалённых узлов
 */
export function pruneNonMeshNodes(root) {
  let removed = 0;
  for (let i = root.children.length - 1; i >= 0; i--) {
    const child = root.children[i];
    if (child.isLight || child.isCamera) {
      root.remove(child);
      removed++;
      continue;
    }
    removed += pruneNonMeshNodes(child);
    if (!child.isMesh && !child.isSkinnedMesh && child.children.length === 0) {
      root.remove(child);
      removed++;
    }
  }
  return removed;
}

/**
 * Загрузка glTF/GLB модели один раз в память.
 * Все геометрии и текстуры помечаются userData.shared = true.
 * @param {string} key
 * @param {string} url
 * @returns {Promise<Object>}
 */
function loadGltfModel(key, url) {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        if (key === "ammoRocket") {
          pruneNonMeshNodes(gltf.scene);
        }

        let skinnedMesh = null;
        const skipNearest = key === "ammoRocket";

        gltf.scene.traverse((node) => {
          node.frustumCulled = false;
          if (node.isMesh || node.isSkinnedMesh) {
            if (node.geometry) {
              node.geometry.userData.shared = true;
            }
            if (node.material) {
              const markMat = (m) => {
                m.userData.shared = true;
                const maps = [
                  m.map,
                  m.normalMap,
                  m.roughnessMap,
                  m.metalnessMap,
                  m.aoMap,
                  m.emissiveMap
                ];
                for (const tex of maps) {
                  if (tex) {
                    tex.userData.shared = true;
                    if (!skipNearest) {
                      tex.magFilter = THREE.NearestFilter;
                      tex.minFilter = THREE.NearestFilter;
                      tex.generateMipmaps = false;
                    }
                  }
                }
              };
              if (Array.isArray(node.material)) {
                node.material.forEach(markMat);
              } else {
                markMat(node.material);
              }
            }
            if (node.isSkinnedMesh && !skinnedMesh) {
              skinnedMesh = node;
            }
          }
        });

        // Обработка анимационных клипов:
        // В клипах ZombieStumble и ZombieDie вырезаем позицию корневой кости (Root.position),
        // чтобы модель оставалась на месте под управлением игрового ИИ.
        const animations = gltf.animations || [];
        for (const clip of animations) {
          if (clip.name === "ZombieStumble" || clip.name === "ZombieDie") {
            clip.tracks = clip.tracks.filter((track) => {
              const isRootPos =
                track.name === "Root.position" ||
                (track.name.toLowerCase().includes("root") && track.name.endsWith(".position"));
              return !isRootPos;
            });
          }
        }

        // Нарезка анимаций пугала (reaper) на сегменты через THREE.AnimationUtils.subclip
        if (key === "reaper") {
          const mainClip = animations.find((a) => a.name === "Scarecrow anim");
          if (!mainClip) {
            console.warn(
              `[ModelCache] В модели "reaper" не найден клип "Scarecrow anim". Доступные клипы:`,
              animations.map((a) => `${a.name} (${a.duration.toFixed(2)}s)`)
            );
          } else {
            const segCfg =
              (CONFIG.enemies.reaper &&
                CONFIG.enemies.reaper.model &&
                CONFIG.enemies.reaper.model.segments) ||
              {};
            const fps =
              (CONFIG.enemies.reaper &&
                CONFIG.enemies.reaper.model &&
                CONFIG.enemies.reaper.model.fps) ||
              30;
            const lockHips =
              CONFIG.enemies.reaper &&
              CONFIG.enemies.reaper.model &&
              CONFIG.enemies.reaper.model.lockHipsXZ;

            for (const [name, range] of Object.entries(segCfg)) {
              if (Array.isArray(range) && range.length >= 2) {
                const [startSec, endSec] = range;
                const startFrame = Math.round(startSec * fps);
                const endFrame = Math.round(endSec * fps);
                const sub = THREE.AnimationUtils.subclip(mainClip, name, startFrame, endFrame, fps);

                if (lockHips) {
                  const hips = sub.tracks.find((t) => t.name.includes("Hips.position"));
                  if (hips && hips.values.length >= 3) {
                    const bindX = 187.54395;
                    const bindZ = -207.70602;
                    for (let i = 0; i < hips.values.length; i += 3) {
                      hips.values[i] = bindX;
                      hips.values[i + 2] = bindZ;
                    }
                  }
                }
                animations.push(sub);
              }
            }
          }
        }

        const data = {
          scene: gltf.scene,
          animations,
          origMaterial: skinnedMesh ? (Array.isArray(skinnedMesh.material) ? skinnedMesh.material[0] : skinnedMesh.material) : null
        };

        // Бочки: готовим только выбранный узел (Red_Barrel_High / Red_Barrel_Low)
        if (key === "barrel") {
          prepareBarrelNode(gltf.scene, data);
        }

        _cache.set(key, data);
        resolve(data);
      },
      undefined,
      (err) => {
        console.error(`[ModelCache] Ошибка загрузки модели "${key}" из "${url}":`, err);
        reject(err);
      }
    );
  });
}

/**
 * Определить группу утолщения для имени кости рук.
 * @param {string} boneName
 * @returns {"upperArm"|"forearm"|"hand"|"fingers"|null}
 */
function classifyArmBoneGroup(boneName) {
  if (!boneName) return null;
  const norm = boneName.replace(/\./g, "").toLowerCase();
  if (norm.startsWith("shoulder") || norm.startsWith("upper_arm")) return "upperArm";
  if (norm.startsWith("forearm")) return "forearm";
  if (norm === "handr" || norm === "handl" || norm.startsWith("palm")) return "hand";
  if (
    norm.startsWith("f_index") ||
    norm.startsWith("f_middle") ||
    norm.startsWith("f_ring") ||
    norm.startsWith("f_pinky") ||
    norm.startsWith("thumb")
  ) {
    return "fingers";
  }
  return null;
}

/**
 * Построить общую утолщённую копию геометрии ArmsMesh с сохранением исходной геометрии.
 * Смещает вершины вдоль сглаженной нормали (усреднённой по совпадающим позициям)
 * пропорционально весам костей по группам upperArm / forearm / hand / fingers.
 * @param {THREE.BufferGeometry} origGeometry
 * @param {THREE.Skeleton|null} skeleton
 * @param {Object} [armsCfg]
 * @returns {THREE.BufferGeometry|null}
 */
export function buildInflatedArmsGeometry(origGeometry, skeleton, armsCfg = {}) {
  if (!origGeometry) return null;
  const geo = origGeometry.clone();
  geo.userData.shared = true;

  if (armsCfg.inflateEnabled === false || !skeleton || !skeleton.bones) {
    return geo;
  }

  const posAttr = geo.getAttribute("position");
  const normAttr = geo.getAttribute("normal");
  const idxAttr = geo.getAttribute("skinIndex");
  const wgtAttr = geo.getAttribute("skinWeight");
  if (!posAttr || !normAttr || !idxAttr || !wgtAttr) return geo;

  const infCfg = armsCfg.inflate || {};
  const inf = {
    upperArm: infCfg.upperArm ?? 0.030,
    forearm: infCfg.forearm ?? 0.026,
    hand: infCfg.hand ?? 0.008,
    fingers: infCfg.fingers ?? 0.002
  };

  const boneGroups = skeleton.bones.map((b) => classifyArmBoneGroup(b.name));
  const count = posAttr.count;

  // Группируем вершины с одинаковой позицией (до 1e-5) для сглаженных нормалей без разрывов сетки
  const posMap = new Map();
  for (let i = 0; i < count; i++) {
    const key =
      Math.round(posAttr.getX(i) * 1e5) +
      "," +
      Math.round(posAttr.getY(i) * 1e5) +
      "," +
      Math.round(posAttr.getZ(i) * 1e5);
    let list = posMap.get(key);
    if (!list) {
      list = [];
      posMap.set(key, list);
    }
    list.push(i);
  }

  const smoothNormals = new Float32Array(count * 3);
  for (const indices of posMap.values()) {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (let k = 0; k < indices.length; k++) {
      const idx = indices[k];
      sx += normAttr.getX(idx);
      sy += normAttr.getY(idx);
      sz += normAttr.getZ(idx);
    }
    const len = Math.hypot(sx, sy, sz);
    if (len > 1e-8) {
      sx /= len;
      sy /= len;
      sz /= len;
    } else {
      sx = 0;
      sy = 1;
      sz = 0;
    }
    for (let k = 0; k < indices.length; k++) {
      const base = indices[k] * 3;
      smoothNormals[base] = sx;
      smoothNormals[base + 1] = sy;
      smoothNormals[base + 2] = sz;
    }
  }

  for (let i = 0; i < count; i++) {
    let wUpper = 0;
    let wForearm = 0;
    let wHand = 0;
    let wFingers = 0;

    for (let j = 0; j < 4; j++) {
      const w = j === 0 ? wgtAttr.getX(i) : j === 1 ? wgtAttr.getY(i) : j === 2 ? wgtAttr.getZ(i) : wgtAttr.getW(i);
      if (w <= 0) continue;
      const bi = j === 0 ? idxAttr.getX(i) : j === 1 ? idxAttr.getY(i) : j === 2 ? idxAttr.getZ(i) : idxAttr.getW(i);
      const grp = boneGroups[Math.round(bi)];
      if (grp === "upperArm") wUpper += w;
      else if (grp === "forearm") wForearm += w;
      else if (grp === "hand") wHand += w;
      else if (grp === "fingers") wFingers += w;
    }

    const d = wUpper * inf.upperArm + wForearm * inf.forearm + wHand * inf.hand + wFingers * inf.fingers;
    if (d !== 0) {
      const base = i * 3;
      posAttr.setXYZ(
        i,
        posAttr.getX(i) + smoothNormals[base] * d,
        posAttr.getY(i) + smoothNormals[base + 1] * d,
        posAttr.getZ(i) + smoothNormals[base + 2] * d
      );
    }
  }

  posAttr.needsUpdate = true;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Собрать общую текстуру рукавов на canvas (шум ткани, складки и светлая манжета у запястья).
 * @param {HTMLImageElement|HTMLCanvasElement} origImage
 * @param {Object} [armsCfg]
 * @returns {THREE.CanvasTexture|null}
 */
function buildArmsSleeveTexture(origImage, armsCfg = {}) {
  if (typeof document === "undefined" || !origImage) return null;

  const w = origImage.width || 512;
  const h = origImage.height || 512;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(origImage, 0, 0, w, h);

  if (armsCfg.sleeves !== false) {
    const startV = Math.max(0, Math.min(1, armsCfg.sleeveStartV ?? 0.53));
    const startY = Math.floor(h * startV);
    const regionH = h - startY;

    if (regionH > 0) {
      const sc = armsCfg.sleeveColor || [0.17, 0.19, 0.12];
      const sr = Math.round((sc[0] ?? 0.17) * 255);
      const sg = Math.round((sc[1] ?? 0.19) * 255);
      const sb = Math.round((sc[2] ?? 0.12) * 255);
      const blend = 0.92;

      const cuffH = Math.min(regionH, 6);
      // 3-4 тёмные складки поперёк предплечья (горизонтальные полосы 2-3 px)
      const foldBands = [0.22, 0.44, 0.66, 0.85].map((t) => ({
        y: Math.floor(regionH * t),
        h: t === 0.44 ? 3 : 2
      }));

      const imgData = ctx.getImageData(0, startY, w, regionH);
      const d = imgData.data;

      for (let ly = 0; ly < regionH; ly++) {
        const isCuff = ly < cuffH;
        let isFold = false;
        if (!isCuff) {
          for (let f = 0; f < foldBands.length; f++) {
            const fb = foldBands[f];
            if (ly >= fb.y && ly < fb.y + fb.h) {
              isFold = true;
              break;
            }
          }
        }

        for (let x = 0; x < w; x++) {
          const i = (ly * w + x) * 4;
          if (d[i + 3] === 0) continue;

          // Детерминированный мелкий шум ткани ±8% яркости
          let hash = ((x * 374761393 + (startY + ly) * 668265263) ^ 0x5bf03635) >>> 0;
          hash = ((hash ^ (hash >>> 13)) * 1274126177) >>> 0;
          const noise = (((hash & 0xffff) / 65535) - 0.5) * 0.16; // -0.08 .. +0.08

          let r = d[i] * (1 - blend) + sr * blend;
          let g = d[i + 1] * (1 - blend) + sg * blend;
          let b = d[i + 2] * (1 - blend) + sb * blend;

          let shade = 1 + noise;
          if (isCuff) shade *= 1.24;
          else if (isFold) shade *= 0.74;

          d[i] = Math.max(0, Math.min(255, Math.round(r * shade)));
          d[i + 1] = Math.max(0, Math.min(255, Math.round(g * shade)));
          d[i + 2] = Math.max(0, Math.min(255, Math.round(b * shade)));
        }
      }
      ctx.putImageData(imgData, 0, startY);
    }
  }

  const finalTex = new THREE.CanvasTexture(canvas);
  finalTex.flipY = false;
  finalTex.colorSpace = THREE.SRGBColorSpace;
  finalTex.magFilter = THREE.NearestFilter;
  finalTex.minFilter = THREE.NearestFilter;
  finalTex.generateMipmaps = false;
  finalTex.userData.shared = true;
  finalTex.needsUpdate = true;
  return finalTex;
}

/**
 * Загрузить текстуру рук и собрать начальную текстуру (с рукавами при sleeves=true).
 * @param {string} texUrl
 * @returns {Promise<{texture: THREE.Texture, origImage: any}>}
 */
function loadArmsTexture(texUrl) {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      texUrl,
      (tex) => {
        const armsCfg = CONFIG.viewmodel?.arms || {};
        const origImage = tex.image || null;
        let finalTex = buildArmsSleeveTexture(origImage, armsCfg);
        if (finalTex) {
          tex.dispose();
        } else {
          finalTex = tex;
          finalTex.flipY = false;
          finalTex.colorSpace = THREE.SRGBColorSpace;
          finalTex.magFilter = THREE.NearestFilter;
          finalTex.minFilter = THREE.NearestFilter;
          finalTex.generateMipmaps = false;
          finalTex.userData.shared = true;
          finalTex.needsUpdate = true;
        }
        resolve({ texture: finalTex, origImage });
      },
      undefined,
      (err) => reject(err)
    );
  });
}

/**
 * Загрузить 3D-модель рук от первого лица (arms_rig.glb + arms_gloves_01.png).
 * @param {string} glbUrl
 * @param {string} texUrl
 * @returns {Promise<Object>}
 */
async function loadArmsModel(glbUrl, texUrl) {
  const [data, texRes] = await Promise.all([
    loadGltfModel("arms", glbUrl),
    loadArmsTexture(texUrl)
  ]);

  const armsTex = texRes.texture;
  const sharedMat = new THREE.MeshLambertMaterial({
    map: armsTex,
    side: THREE.DoubleSide
  });
  sharedMat.userData.shared = true;

  const armsCfg = CONFIG.viewmodel?.arms || {};
  let origGeometry = null;
  let origSkeleton = null;
  let inflatedGeometry = null;

  data.scene.traverse((node) => {
    node.frustumCulled = false;
    if (node.isMesh || node.isSkinnedMesh) {
      if (node.isSkinnedMesh && !origGeometry && node.geometry) {
        origGeometry = node.geometry;
        origGeometry.userData.shared = true;
        origSkeleton = node.skeleton || null;
        inflatedGeometry = buildInflatedArmsGeometry(origGeometry, origSkeleton, armsCfg);
        if (inflatedGeometry) {
          node.geometry = inflatedGeometry;
        }
      } else if (node.geometry) {
        node.geometry.userData.shared = true;
      }

      const oldMats = Array.isArray(node.material) ? node.material : [node.material];
      for (const om of oldMats) {
        if (!om) continue;
        if (om.map && om.map !== armsTex) om.map.dispose();
        om.dispose();
      }
      node.material = sharedMat;
    }
  });

  data.origGeometry = origGeometry;
  data.origSkeleton = origSkeleton;
  data.inflatedGeometry = inflatedGeometry || origGeometry;
  data.origArmsImage = texRes.origImage;
  data.armsMaterial = sharedMat;
  data.armsTexture = armsTex;
  data.armsFingerPoses = extractArmsFingerPoses(data.animations || []);
  return data;
}

/**
 * Извлечь локальные кватернионы пальцев из клипов guard_idle (кулак) и finger_gun_idle (вытянутый указательный) в t = 0.
 * @param {THREE.AnimationClip[]} animations
 * @returns {{fist: Object<string, THREE.Quaternion>, trigger: Object<string, THREE.Quaternion>}}
 */
function extractArmsFingerPoses(animations) {
  const fist = {};
  const trigger = {};
  const isFingerBone = (name) =>
    name.startsWith("palm") || name.startsWith("f_") || name.startsWith("thumb");
  const isTriggerBone = (name) =>
    (name.startsWith("f_index") || name.startsWith("thumb")) && name.endsWith("R");

  const evalClipAtZero = (clip, filterFn, out) => {
    if (!clip) return;
    for (const track of clip.tracks) {
      if (!track.name.endsWith(".quaternion")) continue;
      const boneName = track.name.slice(0, -".quaternion".length);
      if (!filterFn(boneName)) continue;
      const interp = track.createInterpolant();
      const val = interp.evaluate(0);
      out[boneName] = new THREE.Quaternion(val[0], val[1], val[2], val[3]).normalize();
    }
  };

  const guardClip = animations.find((a) => a.name === "guard_idle");
  const fingerGunClip = animations.find((a) => a.name === "finger_gun_idle");
  evalClipAtZero(guardClip, isFingerBone, fist);
  evalClipAtZero(fingerGunClip, isTriggerBone, trigger);

  return { fist, trigger };
}

/**
 * Инициализация всех моделей игры до старта.
 * Вызывается из Game.
 * @returns {Promise<boolean>}
 */
export function initAllModels() {
  if (_initPromise) return _initPromise;

  const zombiePath = (CONFIG.enemies.zombie.model && CONFIG.enemies.zombie.model.path) || "/models/zombie.glb";
  const ghostPath = (CONFIG.enemies.robot && CONFIG.enemies.robot.model && CONFIG.enemies.robot.model.path) || "/models/ghost.glb";
  const reaperPath = (CONFIG.enemies.reaper && CONFIG.enemies.reaper.model && CONFIG.enemies.reaper.model.path) || "/models/reaper.glb";
  const barrelPath = "/models/barrel.glb";
  const shotgunPath = "./models/shotgun.glb";
  const ak47Path = "./models/ak47.glb";
  const rocketPath = "./models/rocket.glb";
  const ammoPath = "./models/ammo.glb";
  const ammoShotgunPath = "./models/ammo_shotgun.glb";
  const ammoRocketPath = "./models/ammo_rocket.glb";
  const armsPath = "./models/arms_rig.glb";
  const armsTexPath = "./models/arms_gloves_01.png";

  _initPromise = Promise.all([
    loadGltfModel("zombie", zombiePath).catch((err) => {
      console.warn("[ModelCache] 3D-модель зомби недоступна. Будет использован запасной процедурный вариант.", err);
      return null;
    }),
    loadGltfModel("ghost", ghostPath).catch((err) => {
      console.warn("[ModelCache] 3D-модель призрака недоступна. Будет использован запасной процедурный вариант.", err);
      return null;
    }),
    loadGltfModel("reaper", reaperPath).catch((err) => {
      console.warn("[ModelCache] 3D-модель пугала (reaper) недоступна. Будет использован запасной процедурный вариант.", err);
      return null;
    }),
    loadGltfModel("barrel", barrelPath).catch((err) => {
      console.warn("[ModelCache] 3D-модель бочки (barrel) недоступна. Будет использована запасная процедурная бочка.", err);
      return null;
    }),
    loadGltfModel("shotgun", shotgunPath).catch((err) => {
      console.warn("[ModelCache] 3D-модель дробовика (shotgun) недоступна. Будет использована процедурная вьюмодель.", err);
      return null;
    }),
    loadGltfModel("ak47", ak47Path).catch((err) => {
      console.warn("[ModelCache] 3D-модель АК-47 (ak47) недоступна. Будет использована процедурная вьюмодель.", err);
      return null;
    }),
    loadGltfModel("rocket", rocketPath).catch((err) => {
      console.warn("[ModelCache] 3D-модель ракетницы (rocket) недоступна. Будет использована процедурная вьюмодель.", err);
      return null;
    }),
    loadGltfModel("ammo", ammoPath).catch((err) => {
      console.error("[ModelCache] 3D-модель патронов АК-47 (ammo) не загрузилась. Будет использован запасной вариант.", err);
      return null;
    }),
    loadGltfModel("ammoShotgun", ammoShotgunPath).catch((err) => {
      console.error("[ModelCache] 3D-модель патронов дробовика (ammoShotgun) не загрузилась. Будет использован запасной вариант.", err);
      return null;
    }),
    loadGltfModel("ammoRocket", ammoRocketPath).catch((err) => {
      console.error("[ModelCache] 3D-модель ракет (ammoRocket) не загрузилась. Будет использован запасной вариант.", err);
      return null;
    }),
    loadArmsModel(armsPath, armsTexPath).catch((err) => {
      console.error("[ModelCache] 3D-модель рук (arms) не загрузилась. Будут использованы процедурные перчатки.", err);
      return null;
    })
  ]).then(() => true);

  return _initPromise;
}

/**
 * Проверка наличия загруженной модели по ключу
 * @param {string} key
 * @returns {boolean}
 */
export function has(key) {
  return _cache.has(key);
}

/**
 * Проверка, загружена ли модель зомби
 * @returns {boolean}
 */
export function hasZombieModel() {
  return _cache.has("zombie");
}

/**
 * Проверка, загружена ли модель призрака
 * @returns {boolean}
 */
export function hasGhostModel() {
  return _cache.has("ghost");
}

/**
 * Проверка, загружена ли модель пугала (reaper)
 * @returns {boolean}
 */
export function hasReaperModel() {
  return _cache.has("reaper");
}

/**
 * Проверка, загружена ли модель бочки
 * @returns {boolean}
 */
export function hasBarrelModel() {
  return _cache.has("barrel");
}

/**
 * Проверка, загружена ли модель дробовика
 * @returns {boolean}
 */
export function hasShotgunModel() {
  return _cache.has("shotgun");
}

/**
 * Проверка, загружена ли модель АК-47
 * @returns {boolean}
 */
export function hasAk47Model() {
  return _cache.has("ak47");
}

/**
 * Проверка, загружена ли модель ракетницы
 * @returns {boolean}
 */
export function hasRocketModel() {
  return _cache.has("rocket");
}

/**
 * Проверка, загружена ли модель рук
 * @returns {boolean}
 */
export function hasArmsModel() {
  return _cache.has("arms");
}

/**
 * Клон всей сцены модели целиком с сохранением матриц преобразования узлов.
 * Геометрия, материал и текстура помечаются userData.shared = true.
 * @param {string} key
 * @returns {THREE.Object3D|null}
 */
export function getSceneClone(key) {
  const cached = _cache.get(key);
  if (!cached || !cached.scene) return null;

  const clone = cached.scene.clone(true);
  clone.traverse((node) => {
    node.frustumCulled = false;
    if (node.geometry) node.geometry.userData.shared = true;
    if (node.material) {
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const mat of mats) {
        mat.userData.shared = true;
        if (mat.map) mat.map.userData.shared = true;
      }
    }
  });
  return clone;
}

/**
 * Клон ТОЛЬКО указанного узла модели (а не всей сцены).
 * Геометрия, материал и текстура остаются общими с кэшем.
 * Используется для бочек: из barrel.glb берётся только Red_Barrel_High/Low.
 * @param {string} key - ключ модели ("barrel")
 * @param {string} nodeName - имя узла (например, "Red_Barrel_High")
 * @returns {THREE.Object3D|null}
 */
export function getNodeClone(key, nodeName) {
  const cached = _cache.get(key);
  if (!cached || !cached.scene || !nodeName) return null;

  const source = cached.scene.getObjectByName(nodeName);
  if (!source) {
    console.warn(`[ModelCache] Узел "${nodeName}" не найден в модели "${key}".`);
    return null;
  }

  const clone = source.clone(true);
  clone.traverse((node) => {
    node.frustumCulled = false;
    if (node.geometry) node.geometry.userData.shared = true;
    if (node.material) {
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const mat of mats) {
        mat.userData.shared = true;
        if (mat.map) mat.map.userData.shared = true;
      }
    }
  });
  return clone;
}

/**
 * Клон первого меша из сцены модели (fallback, если нет именованных узлов).
 * Например, shotgun.glb экспортирован как один неименованный меш.
 * Всё обернуто в try/catch, чтобы не ломать загрузку вьюмодели.
 * @param {string} key - ключ модели
 * @returns {THREE.Object3D|null}
 */
export function getFirstMeshNode(key) {
  try {
    const cached = _cache.get(key);
    if (!cached || !cached.scene) return null;
    let result = null;
    cached.scene.traverse((node) => {
      if (result) return;
      if (node.isMesh && node.geometry) {
        result = node.clone(true);
        result.traverse((n) => {
          n.frustumCulled = false;
          if (n.geometry) n.geometry.userData.shared = true;
          if (n.material) {
            const mats = Array.isArray(n.material) ? n.material : [n.material];
            for (const mat of mats) {
              mat.userData.shared = true;
              if (mat.map) mat.map.userData.shared = true;
            }
          }
        });
      }
    });
    return result;
  } catch (e) {
    console.warn(`[ModelCache] getFirstMeshNode("${key}") error:`, e);
    return null;
  }
}

/**
 * Создать уникальный анимируемый инстанс 3D-модели зомби.
 * Клонирует скелет и иерархию через SkeletonUtils.clone (геометрии и текстуры остаются общими).
 * @returns {Object|null}
 */
export function createZombieInstance() {
  const cached = _cache.get("zombie");
  if (!cached) return null;

  // Клонирование иерархии и скелета
  const modelGroup = SkeletonUtils.clone(cached.scene);
  let skinnedMesh = null;

  modelGroup.traverse((node) => {
    node.frustumCulled = false;
    if (node.isSkinnedMesh && !skinnedMesh) {
      skinnedMesh = node;
    }
  });

  if (!skinnedMesh) {
    console.error("[ModelCache] SkinnedMesh не найден в клонированной модели зомби");
    return null;
  }

  // Создаём индивидуальные материалы для инстанса
  const origMat = cached.origMaterial || skinnedMesh.material;

  // 1. PBR-материал (MeshStandardMaterial из glTF) с текстурами NearestFilter
  const pbrMat = origMat.clone();
  pbrMat.userData.shared = false;
  pbrMat.roughness = 0.9;
  pbrMat.metalness = 0.0;
  if (pbrMat.map) {
    pbrMat.map.userData.shared = true;
    pbrMat.map.minFilter = THREE.NearestFilter;
    pbrMat.map.magFilter = THREE.NearestFilter;
    pbrMat.map.generateMipmaps = false;
  }
  if (pbrMat.normalMap) pbrMat.normalMap.userData.shared = true;
  if (pbrMat.roughnessMap) pbrMat.roughnessMap.userData.shared = true;
  if (pbrMat.metalnessMap) pbrMat.metalnessMap.userData.shared = true;
  attachVertexSnap(pbrMat, { isSkinned: true });

  // 2. Toon-материал (MeshToonMaterial с gradientMap)
  const toonColor = new THREE.Color(0xffffff);
  const mul = (CONFIG.enemies.zombie.model && CONFIG.enemies.zombie.model.toonColorMultiplier) || 1.15;
  toonColor.multiplyScalar(mul);

  const toonMat = new THREE.MeshToonMaterial({
    color: toonColor,
    map: pbrMat.map,
    gradientMap: getGradientMap(),
    side: origMat.side != null ? origMat.side : THREE.DoubleSide
  });
  toonMat.userData.shared = false;

  // 3. Инвертированный контур (inverted-hull)
  const outlineThickness = (CONFIG.enemies.zombie.model && CONFIG.enemies.zombie.model.outlineThickness) || 0.018;
  const outlineMat = new THREE.MeshBasicMaterial({
    color: CONFIG.world.outlineColor || 0x1b1340,
    side: THREE.BackSide
  });
  outlineMat.userData.shared = false;
  outlineMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
       transformed += normal * ${outlineThickness.toFixed(4)};`
    );
  };

  const outlineMesh = new THREE.SkinnedMesh(skinnedMesh.geometry, outlineMat);
  outlineMesh.bind(skinnedMesh.skeleton, skinnedMesh.bindMatrix);
  outlineMesh.scale.copy(skinnedMesh.scale);
  outlineMesh.frustumCulled = false;
  outlineMesh.visible = false;
  modelGroup.add(outlineMesh);

  // Анимационный миксер для данного инстанса
  const mixer = new THREE.AnimationMixer(modelGroup);
  const actions = {};
  for (const clip of cached.animations) {
    actions[clip.name] = mixer.clipAction(clip);
  }

  return {
    modelGroup,
    skinnedMesh,
    outlineMesh,
    mixer,
    actions,
    materials: {
      pbr: pbrMat,
      toon: toonMat
    }
  };
}

/**
 * Создать уникальный анимируемый инстанс 3D-модели призрака.
 * Клонирует скелет и иерархию через SkeletonUtils.clone (геометрии и текстуры остаются общими).
 * Для всех SkinnedMesh и Mesh клонирует материал на каждого врага с frustumCulled = false.
 * @returns {Object|null}
 */
export function createGhostInstance() {
  const cached = _cache.get("ghost");
  if (!cached) return null;

  const modelGroup = SkeletonUtils.clone(cached.scene);
  let skinnedMesh = null;
  const clonedMaterials = [];

  modelGroup.traverse((node) => {
    node.frustumCulled = false;
    if (node.isMesh || node.isSkinnedMesh) {
      if (node.geometry) {
        node.geometry.computeBoundingSphere();
      }
      if (node.material) {
        if (Array.isArray(node.material)) {
          node.material = node.material.map((m) => {
            const cm = m.clone();
            cm.userData.shared = false;
            if (cm.map) {
              cm.map.userData.shared = true;
              cm.map.magFilter = THREE.NearestFilter;
              cm.map.minFilter = THREE.NearestFilter;
              cm.map.generateMipmaps = false;
            }
            attachVertexSnap(cm, { isSkinned: true });
            clonedMaterials.push(cm);
            return cm;
          });
        } else {
          const cm = node.material.clone();
          cm.userData.shared = false;
          if (cm.map) {
            cm.map.userData.shared = true;
            cm.map.magFilter = THREE.NearestFilter;
            cm.map.minFilter = THREE.NearestFilter;
            cm.map.generateMipmaps = false;
          }
          attachVertexSnap(cm, { isSkinned: true });
          node.material = cm;
          clonedMaterials.push(cm);
        }
      }
      if (node.isSkinnedMesh && !skinnedMesh) {
        skinnedMesh = node;
      }
    }
  });

  const mixer = new THREE.AnimationMixer(modelGroup);
  const actions = {};
  for (const clip of cached.animations) {
    actions[clip.name] = mixer.clipAction(clip);
  }

  return {
    modelGroup,
    skinnedMesh,
    clonedMaterials,
    mixer,
    actions
  };
}

/**
 * Создать уникальный анимируемый инстанс 3D-модели пугала (reaper).
 * Клонирует скелет и иерархию через SkeletonUtils.clone (геометрии и текстуры остаются общими).
 * Для всех SkinnedMesh и Mesh клонирует материалы с frustumCulled = false.
 * @returns {Object|null}
 */
export function createReaperInstance() {
  const cached = _cache.get("reaper");
  if (!cached) return null;

  const modelGroup = SkeletonUtils.clone(cached.scene);
  let skinnedMesh = null;
  const clonedMaterials = [];

  modelGroup.traverse((node) => {
    node.frustumCulled = false;
    if (node.isMesh || node.isSkinnedMesh) {
      if (node.geometry) {
        node.geometry.computeBoundingSphere();
      }
      if (node.material) {
        if (Array.isArray(node.material)) {
          node.material = node.material.map((m) => {
            const cm = m.clone();
            cm.userData.shared = false;
            if (cm.map) {
              cm.map.userData.shared = true;
              cm.map.magFilter = THREE.NearestFilter;
              cm.map.minFilter = THREE.NearestFilter;
              cm.map.generateMipmaps = false;
            }
            attachVertexSnap(cm, { isSkinned: true });
            clonedMaterials.push(cm);
            return cm;
          });
        } else {
          const cm = node.material.clone();
          cm.userData.shared = false;
          if (cm.map) {
            cm.map.userData.shared = true;
            cm.map.magFilter = THREE.NearestFilter;
            cm.map.minFilter = THREE.NearestFilter;
            cm.map.generateMipmaps = false;
          }
          attachVertexSnap(cm, { isSkinned: true });
          node.material = cm;
          clonedMaterials.push(cm);
        }
      }
      if (node.isSkinnedMesh && !skinnedMesh) {
        skinnedMesh = node;
      }
    }
  });

  const mixer = new THREE.AnimationMixer(modelGroup);
  const actions = {};
  for (const clip of cached.animations) {
    actions[clip.name] = mixer.clipAction(clip);
  }

  return {
    modelGroup,
    skinnedMesh,
    clonedMaterials,
    mixer,
    actions
  };
}

/**
 * Создать инстанс 3D-модели рук от первого лица через SkeletonUtils.clone.
 * Использует общий MeshLambertMaterial с текстурой arms_gloves_01.png (без PSX-дрожания).
 * @returns {Object|null}
 */
export function createArmsInstance() {
  const cached = _cache.get("arms");
  if (!cached) return null;

  const modelGroup = SkeletonUtils.clone(cached.scene);
  let skinnedMesh = null;

  modelGroup.traverse((node) => {
    node.frustumCulled = false;
    if (node.isSkinnedMesh || node.isMesh) {
      node.renderOrder = 999;
      if (cached.armsMaterial) {
        node.material = cached.armsMaterial;
      }
      if (node.isSkinnedMesh) {
        if (cached.inflatedGeometry) {
          node.geometry = cached.inflatedGeometry;
        }
        if (!skinnedMesh) skinnedMesh = node;
      }
    }
  });

  const mixer = new THREE.AnimationMixer(modelGroup);
  const actions = {};
  const clipNames = [];
  for (const clip of cached.animations || []) {
    actions[clip.name] = mixer.clipAction(clip);
    clipNames.push(clip.name);
  }

  return {
    modelGroup,
    skinnedMesh,
    mixer,
    actions,
    clipNames,
    fingerPoses: cached.armsFingerPoses || { fist: {}, trigger: {} }
  };
}

/**
 * Пересоздать общую утолщённую геометрию рук из исходной и освободить предыдущую.
 * @returns {THREE.BufferGeometry|null}
 */
export function rebuildArmsGeometry() {
  const cached = _cache.get("arms");
  if (!cached || !cached.origGeometry) return null;

  const newGeo = buildInflatedArmsGeometry(cached.origGeometry, cached.origSkeleton, CONFIG.viewmodel?.arms || {});
  if (!newGeo) return null;

  const oldGeo = cached.inflatedGeometry;
  cached.inflatedGeometry = newGeo;

  cached.scene.traverse((node) => {
    if (node.isSkinnedMesh) {
      node.geometry = newGeo;
    }
  });

  if (oldGeo && oldGeo !== cached.origGeometry && oldGeo !== newGeo) {
    oldGeo.dispose();
  }
  return newGeo;
}

/**
 * Пересоздать общую текстуру рукавов и освободить предыдущую.
 * @returns {boolean}
 */
export function rebuildArmsTexture() {
  const cached = _cache.get("arms");
  if (!cached || !cached.origArmsImage || !cached.armsMaterial) return false;

  const newTex = buildArmsSleeveTexture(cached.origArmsImage, CONFIG.viewmodel?.arms || {});
  if (!newTex) return false;

  const oldTex = cached.armsTexture;
  cached.armsTexture = newTex;
  cached.armsMaterial.map = newTex;
  cached.armsMaterial.needsUpdate = true;

  if (oldTex && oldTex !== newTex) {
    oldTex.dispose();
  }
  return true;
}

export default {
  initAllModels,
  has,
  hasZombieModel,
  hasGhostModel,
  hasReaperModel,
  hasBarrelModel,
  hasShotgunModel,
  hasAk47Model,
  hasRocketModel,
  hasArmsModel,
  getNodeClone,
  getSceneClone,
  getFirstMeshNode,
  createZombieInstance,
  createGhostInstance,
  createReaperInstance,
  createArmsInstance
};
