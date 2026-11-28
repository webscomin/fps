// Двухкостный IK-решатель для рук от первого лица (плечо -> предплечье -> кисть)
import * as THREE from "three";

const _S = new THREE.Vector3();
const _F = new THREE.Vector3();
const _H = new THREE.Vector3();
const _E = new THREE.Vector3();
const _T = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _perp = new THREE.Vector3();
const _cur = new THREE.Vector3();
const _des = new THREE.Vector3();
const _worldQ = new THREE.Quaternion();
const _parentQ = new THREE.Quaternion();
const _deltaQ = new THREE.Quaternion();
const _newWorldQ = new THREE.Quaternion();
const _upY = new THREE.Vector3(0, 1, 0);

/**
 * Подготовить структуру цепочки костей одной руки и измерить длины L1, L2 в позе покоя.
 * @param {THREE.Object3D} modelRoot
 * @param {"R"|"L"} side
 * @returns {Object|null}
 */
export function createArmChain(modelRoot, side) {
  const upperArm = modelRoot.getObjectByName("upper_arm" + side);
  const forearm = modelRoot.getObjectByName("forearm" + side);
  const hand = modelRoot.getObjectByName("hand" + side);
  if (!upperArm || !forearm || !hand) return null;

  modelRoot.updateMatrixWorld(true);
  upperArm.getWorldPosition(_S);
  forearm.getWorldPosition(_F);
  hand.getWorldPosition(_H);

  const L1 = _S.distanceTo(_F);
  const L2 = _F.distanceTo(_H);

  return {
    side,
    upperArm,
    forearm,
    hand,
    restUpperQuat: upperArm.quaternion.clone(),
    restForearmQuat: forearm.quaternion.clone(),
    restHandQuat: hand.quaternion.clone(),
    L1,
    L2
  };
}

/**
 * Решить двухкостный IK для одной руки без выделения объектов на каждом кадре.
 * @param {Object} chain - результат createArmChain
 * @param {THREE.Vector3} targetWorldPos - мировая позиция цели кисти
 * @param {THREE.Quaternion} targetHandWorldQuat - целевая мировая ориентация кисти
 * @param {THREE.Vector3} poleWorldVec - вектор подсказки локтя в пространстве вьюмодели
 * @param {number} [armsScale=1] - текущий масштаб группы рук
 * @returns {{reachable: boolean, distance: number, maxReach: number}}
 */
export function solveTwoBoneIK(chain, targetWorldPos, targetHandWorldQuat, poleWorldVec, armsScale = 1) {
  const { upperArm, forearm, hand, restUpperQuat, restForearmQuat, restHandQuat } = chain;

  // а) Сброс цепочки в исходную позу покоя и обновление мировых матриц
  upperArm.quaternion.copy(restUpperQuat);
  forearm.quaternion.copy(restForearmQuat);
  hand.quaternion.copy(restHandQuat);
  if (upperArm.parent) {
    upperArm.parent.updateMatrixWorld(true);
  } else {
    upperArm.updateMatrixWorld(true);
  }

  const L1 = chain.L1 * armsScale;
  const L2 = chain.L2 * armsScale;
  const maxReach = L1 + L2;

  // б) Позиция плеча S и расстояние до цели T
  upperArm.getWorldPosition(_S);
  _T.copy(targetWorldPos);

  _dir.subVectors(_T, _S);
  const rawDist = _dir.length();
  const reachable = rawDist <= maxReach;

  const minD = Math.abs(L1 - L2) + 0.001;
  const maxD = Math.max(minD + 0.001, maxReach - 0.001);
  const d = Math.max(minD, Math.min(maxD, rawDist));

  if (rawDist > 1e-6) {
    _dir.divideScalar(rawDist);
  } else {
    _dir.set(0, 0, -1);
  }

  // в-г) Позиция локтя E по закону косинусов и перпендикуляру к pole
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));

  _perp.copy(poleWorldVec).addScaledVector(_dir, -poleWorldVec.dot(_dir));
  if (_perp.lengthSq() < 1e-8) {
    _perp.set(chain.side === "R" ? 1 : -1, -1, 0).addScaledVector(_dir, -_dir.y);
  }
  _perp.normalize();

  _E.copy(_S).addScaledVector(_dir, a).addScaledVector(_perp, h);

  // д) Поворот upper_arm: локальная ось +Y смотрит на E
  upperArm.getWorldQuaternion(_worldQ);
  _cur.copy(_upY).applyQuaternion(_worldQ).normalize();
  _des.subVectors(_E, _S).normalize();
  _deltaQ.setFromUnitVectors(_cur, _des);
  _newWorldQ.multiplyQuaternions(_deltaQ, _worldQ).normalize();

  if (upperArm.parent) {
    upperArm.parent.getWorldQuaternion(_parentQ).invert();
    upperArm.quaternion.multiplyQuaternions(_parentQ, _newWorldQ).normalize();
  } else {
    upperArm.quaternion.copy(_newWorldQ);
  }
  upperArm.updateMatrixWorld(true);

  // Поворот forearm: локальная ось +Y смотрит на T
  forearm.getWorldPosition(_F);
  forearm.getWorldQuaternion(_worldQ);
  _cur.copy(_upY).applyQuaternion(_worldQ).normalize();
  _des.subVectors(_T, _F);
  if (_des.lengthSq() > 1e-8) {
    _des.normalize();
  } else {
    _des.copy(_dir);
  }
  _deltaQ.setFromUnitVectors(_cur, _des);
  _newWorldQ.multiplyQuaternions(_deltaQ, _worldQ).normalize();

  forearm.parent.getWorldQuaternion(_parentQ).invert();
  forearm.quaternion.multiplyQuaternions(_parentQ, _newWorldQ).normalize();
  forearm.updateMatrixWorld(true);

  // е) Ориентация кисти в мировых координатах
  hand.parent.getWorldQuaternion(_parentQ).invert();
  hand.quaternion.multiplyQuaternions(_parentQ, targetHandWorldQuat).normalize();
  hand.updateMatrixWorld(true);

  return { reachable, distance: rawDist, maxReach };
}
