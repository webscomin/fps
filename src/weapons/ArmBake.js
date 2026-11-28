// Запекание позы 3D-руки под хват оружия и жёсткое прикрепление к gunRoot / узлу цевья
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { createArmsInstance, hasArmsModel } from "../core/ModelCache.js";
import { createArmChain, solveTwoBoneIK } from "./ArmIK.js";

const _targetPos = new THREE.Vector3();
const _targetQuat = new THREE.Quaternion();
const _gunWorldQuat = new THREE.Quaternion();
const _baseEuler = new THREE.Euler();
const _wpnEuler = new THREE.Euler();
const _baseQuat = new THREE.Quaternion();
const _wpnQuat = new THREE.Quaternion();
const _poleVec = new THREE.Vector3();
const _shoulderPos = new THREE.Vector3();
const _shiftDir = new THREE.Vector3();

const DEFAULT_CURL = {
  right: { thumb: 0.7, index: 0.5, middle: 1, ring: 1, pinky: 1 },
  left: { thumb: 0.8, index: 1, middle: 1, ring: 1, pinky: 1 }
};

/**
 * Определить ключ пальца в объекте curl по имени кости.
 * @param {string} boneName
 * @returns {string|null}
 */
function getFingerCurlKey(boneName) {
  if (boneName.startsWith("thumb")) return "thumb";
  if (boneName.startsWith("f_index") || boneName.startsWith("palm01")) return "index";
  if (boneName.startsWith("f_middle") || boneName.startsWith("palm02")) return "middle";
  if (boneName.startsWith("f_ring") || boneName.startsWith("palm03")) return "ring";
  if (boneName.startsWith("f_pinky") || boneName.startsWith("palm04")) return "pinky";
  return null;
}

/**
 * Схлопнуть ненужную сторону руки (плечо и ниже) до масштаба 0.0001.
 * @param {THREE.Object3D} modelGroup
 * @param {"R"|"L"} collapseSide
 */
function collapseArmSide(modelGroup, collapseSide) {
  const shoulder =
    modelGroup.getObjectByName("shoulder" + collapseSide) ||
    modelGroup.getObjectByName("shoulder." + collapseSide);
  if (shoulder) {
    shoulder.scale.setScalar(0.0001);
    return;
  }
  const upper =
    modelGroup.getObjectByName("upper_arm" + collapseSide) ||
    modelGroup.getObjectByName("upper_arm." + collapseSide);
  if (upper) upper.scale.setScalar(0.0001);
}

/**
 * Сбросить все кости в исходную позу покоя (bind).
 * @param {THREE.SkinnedMesh|null} skinnedMesh
 */
function resetToBindPose(skinnedMesh) {
  if (skinnedMesh && skinnedMesh.skeleton && typeof skinnedMesh.skeleton.pose === "function") {
    skinnedMesh.skeleton.pose();
  }
}

/**
 * Применить коэффициенты сжатия пальцев curl = slerp(bind, guard_idle, coeff).
 * @param {THREE.Object3D} modelGroup
 * @param {"R"|"L"} sideSuffix
 * @param {Object} fingerPoses
 * @param {Object} curlCfg
 */
function applyFingerCurl(modelGroup, sideSuffix, fingerPoses, curlCfg) {
  const fist = fingerPoses && fingerPoses.fist ? fingerPoses.fist : {};
  const def = sideSuffix === "R" ? DEFAULT_CURL.right : DEFAULT_CURL.left;
  const curl = curlCfg || def;

  for (const [boneName, fistQ] of Object.entries(fist)) {
    if (!boneName.endsWith(sideSuffix)) continue;
    const key = getFingerCurlKey(boneName);
    if (!key) continue;
    const bone = modelGroup.getObjectByName(boneName);
    if (!bone) continue;
    const k = Math.max(0, Math.min(1, curl[key] ?? def[key] ?? 1));
    // В этот момент кость находится в bind-позе (открытая рука)
    bone.quaternion.slerp(fistQ, k).normalize();
  }
}

/**
 * Найти родительский узел для запечённой руки внутри gunRoot.
 * @param {THREE.Object3D} gunRoot
 * @param {string} parentName
 * @returns {THREE.Object3D}
 */
function resolveTargetParent(gunRoot, parentName) {
  if (!parentName || parentName === "gun") return gunRoot;
  const found = gunRoot.getObjectByName(parentName);
  if (!found) {
    console.warn(`[ArmBake] Узел "${parentName}" не найден в модели оружия — используется gunRoot.`);
    return gunRoot;
  }
  return found;
}

/**
 * Запечь одну руку под хват оружия и прикрепить её как дочерний объект к оружию (Object3D.attach).
 * @param {Object} params
 * @param {string} params.weaponId - "shotgun" | "ak47" | "rocket"
 * @param {"right"|"left"} params.side
 * @param {THREE.Scene} params.wScene
 * @param {THREE.Object3D} params.gunRoot
 * @returns {Object|null} { armRoot, modelGroup, baseLocalPos, side, weaponId }
 */
export function bakeArm({ weaponId, side, wScene, gunRoot }) {
  if (!hasArmsModel() || !wScene || !gunRoot) return null;

  const inst = createArmsInstance();
  if (!inst) return null;

  const armsCfg = CONFIG.viewmodel?.arms || {};
  const wpnCfg = CONFIG.viewmodel?.[weaponId] || {};
  const handsCfg = wpnCfg.hands || {};
  const handCfg = handsCfg[side] || {};
  const sideSuffix = side === "right" ? "R" : "L";
  const otherSuffix = side === "right" ? "L" : "R";

  // Схлопываем противоположную руку, чтобы каждый клон рисовал только одну руку
  collapseArmSide(inst.modelGroup, otherSuffix);

  // а) Помещаем клон в сцену вьюмодели в исходное положение (разворот 180° по Y, camera в 0)
  const armRoot = new THREE.Group();
  armRoot.name = `bakedArm_${weaponId}_${side}`;
  const wrapper = new THREE.Group();
  wrapper.rotation.y = Math.PI;
  wrapper.add(inst.modelGroup);
  armRoot.add(wrapper);
  wScene.add(armRoot);

  resetToBindPose(inst.skinnedMesh);
  armRoot.position.set(0, 0, 0);
  armRoot.rotation.set(0, 0, 0);
  armRoot.scale.setScalar(1);
  armRoot.updateMatrixWorld(true);

  const camBone = inst.modelGroup.getObjectByName("camera");
  if (camBone) {
    const camPos = new THREE.Vector3();
    camBone.getWorldPosition(camPos);
    wrapper.position.set(-camPos.x, -camPos.y, -camPos.z);
  }

  const chain = createArmChain(inst.modelGroup, sideSuffix);
  if (!chain) {
    wScene.remove(armRoot);
    return null;
  }

  const ap = handsCfg.armsPos || armsCfg.pos || { x: 0.08, y: -0.18, z: -0.22 };
  const ar = armsCfg.rot || { x: 0, y: 0, z: 0 };
  const aScale = handsCfg.armsScale ?? armsCfg.scale ?? 1.1;
  armRoot.position.set(ap.x || 0, ap.y || 0, ap.z || 0);
  armRoot.rotation.set(ar.x || 0, ar.y || 0, ar.z || 0);
  armRoot.scale.setScalar(aScale);
  armRoot.updateMatrixWorld(true);

  // б) Цель кисти в мировых координатах gunRoot
  gunRoot.updateMatrixWorld(true);
  _targetPos.set(handCfg.x || 0, handCfg.y || 0, handCfg.z || 0);
  gunRoot.localToWorld(_targetPos);

  gunRoot.getWorldQuaternion(_gunWorldQuat);
  const hrBase = (armsCfg.handRot && armsCfg.handRot[side]) || { x: 0, y: 0, z: 0 };
  const hrWpn = handCfg.rot || { x: 0, y: 0, z: 0 };
  _baseQuat.setFromEuler(_baseEuler.set(hrBase.x || 0, hrBase.y || 0, hrBase.z || 0));
  _wpnQuat.setFromEuler(_wpnEuler.set(hrWpn.x || 0, hrWpn.y || 0, hrWpn.z || 0));
  _targetQuat.copy(_gunWorldQuat).multiply(_baseQuat).multiply(_wpnQuat);

  const pCfg = (armsCfg.pole && armsCfg.pole[side]) || (side === "right" ? { x: 0.5, y: -1.0, z: 0.3 } : { x: -0.5, y: -1.0, z: 0.3 });
  _poleVec.set(pCfg.x, pCfg.y, pCfg.z);

  let ikRes = solveTwoBoneIK(chain, _targetPos, _targetQuat, _poleVec, aScale);

  // Если цель недостижима, сдвигаем весь клон руки вперёд вдоль линии «плечо -> цель»
  if (!ikRes.reachable && ikRes.distance > ikRes.maxReach) {
    chain.upperArm.getWorldPosition(_shoulderPos);
    _shiftDir.subVectors(_targetPos, _shoulderPos).normalize();
    const shift = ikRes.distance - Math.max(0.05, ikRes.maxReach - 0.005);
    armRoot.position.addScaledVector(_shiftDir, shift);
    armRoot.updateMatrixWorld(true);
    ikRes = solveTwoBoneIK(chain, _targetPos, _targetQuat, _poleVec, aScale);
  }

  // в) Пальцы: slerp(bind, guard_idle, curl)
  applyFingerCurl(inst.modelGroup, sideSuffix, inst.fingerPoses, handCfg.curl);

  // г) Запекаем: обновляем матрицы и жёстко прикрепляем к gunRoot или узлу цевья
  armRoot.updateMatrixWorld(true);
  const targetParent = side === "left" ? resolveTargetParent(gunRoot, handCfg.parent) : gunRoot;
  targetParent.attach(armRoot);
  armRoot.updateMatrixWorld(true);

  return {
    armRoot,
    modelGroup: inst.modelGroup,
    weaponId,
    side,
    parent: targetParent,
    baseLocalPos: armRoot.position.clone(),
    armsScale: aScale,
    reachable: ikRes.reachable
  };
}
