// Вид оружия от первого лица (Viewmodel): 3D-модели пушек и рук, покачивание при ходьбе, анимация смены и вспышки
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { outlined } from "../core/Physics.js";
import { getNodeClone, getFirstMeshNode, getSceneClone, hasShotgunModel, hasAk47Model, hasRocketModel, hasArmsModel, createArmsInstance, rebuildArmsGeometry, rebuildArmsTexture } from "../core/ModelCache.js";
import { createToonMaterial } from "../world/Materials.js";
import { getCasingTemplate } from "../items/AmmoModels.js";
import { createArmChain, solveTwoBoneIK } from "./ArmIK.js";
import { bakeArm } from "./ArmBake.js";

const _tmpMuzzleW = new THREE.Vector3();
const _tmpEjectW = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

// Переиспользуемые объекты для IK рук (без аллокаций на каждом кадре)
const _ikTargetR = new THREE.Vector3();
const _ikTargetL = new THREE.Vector3();
const _ikBlendR = new THREE.Vector3();
const _ikBlendL = new THREE.Vector3();
const _ikPrevR = new THREE.Vector3();
const _ikPrevL = new THREE.Vector3();
const _ikPoleR = new THREE.Vector3();
const _ikPoleL = new THREE.Vector3();
const _gunWorldQ = new THREE.Quaternion();
const _handTargetQR = new THREE.Quaternion();
const _handTargetQL = new THREE.Quaternion();
const _handEuler = new THREE.Euler();
const _handBaseQ = new THREE.Quaternion();
const _handWpnQ = new THREE.Quaternion();

export class Viewmodel {
  /**
   * @param {THREE.Scene} scene - основная сцена для динамического света вспышки
   * @param {THREE.Camera} camera - основная камера игрока
   * @param {Object} [audio=null] - звуковой менеджер игры
   */
  constructor(scene, camera, audio = null) {
    this.mainScene = scene;
    this.mainCamera = camera;
    this.audio = audio || (typeof window !== "undefined" ? window._gameAudioInstance : null);

    this.wScene = new THREE.Scene();
    this.wScene.fog = null; // В wScene НИКОГДА не должно быть тумана
    const aspect = typeof window !== "undefined" ? window.innerWidth / window.innerHeight : 16 / 9;
    this.wCam = new THREE.PerspectiveCamera(54, aspect, 0.01, 20);

    // Объёмное студийное освещение wScene (контраст граней + контровой свет)
    this.hemiLight = new THREE.HemisphereLight(0xdde5ee, 0x3b424d, 0.85);
    this.wScene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xffffff, 1.15);
    this.dirLight.position.set(-1.8, 3.2, 0.8);
    this.wScene.add(this.dirLight);

    this.rimLight = new THREE.DirectionalLight(0xffe8cc, 0.75);
    this.rimLight.position.set(2.2, 1.4, -2.2);
    this.wScene.add(this.rimLight);

    this.view = new THREE.Group();
    this.wScene.add(this.view);

    this.armsGroup = new THREE.Group();
    this.armsGroup.visible = false;
    this.wScene.add(this.armsGroup);
    this.armsState = null;
    this.bakedArms = {};
    this.proceduralHands = [];
    this.armsTargetLerp = 1;
    this.armsBreathT = 0;
    this.armsDebugVisible = false;
    this.armsReach = { right: true, left: true };

    const markerGeo = new THREE.SphereGeometry(0.015, 8, 6);
    const mkMarker = () => {
      const m = new THREE.Mesh(
        markerGeo,
        new THREE.MeshBasicMaterial({ color: 0x22ff44, depthTest: false })
      );
      m.renderOrder = 1001;
      m.visible = false;
      this.wScene.add(m);
      return m;
    };
    this.handTargetMarkers = { right: mkMarker(), left: mkMarker() };

    // Динамический свет вспышки выстрела в основном мире (перемещается в точку дула при выстреле)
    this.mLight = new THREE.PointLight(0xffaa40, 0, 24);
    this.mainScene.add(this.mLight);

    this.models = {};
    this.proceduralHands = [];

    const useArmsModel = CONFIG.viewmodel?.arms?.useModel !== false && hasArmsModel();
    this.currentWeaponId = "shotgun";
    this.kick = 0;
    this.appear = 1;
    this.flashT = 0;
    this.flashMaxT = CONFIG.combat.flashDuration;
    this.lightT = 0;
    this.lightMaxT = CONFIG.combat.lightDuration;
    this.bobT = 0;
    this.bobA = 0;
    this.airDipSmooth = 0;
    this.akShotCount = 0;
    this.akShakeT = 0;
    this.rocketClickTimer = 0;

    // Пружинная отдача (Spring recoil)
    this.recoilPos = new THREE.Vector3();
    this.recoilVel = new THREE.Vector3();
    this.recoilRot = new THREE.Vector3();
    this.recoilRotVel = new THREE.Vector3();

    // Запаздывание мыши (Mouse sway / lag)
    this.swayX = 0;
    this.swayY = 0;

    // Откат цевья дробовика (pump action)
    this.pumpActive = false;
    this.pumpTimer = 0;
    this.handguardNode = null;
    this.handguardBasePos = new THREE.Vector3(141, 0, 17);

    // Пул гильз дробовика в wScene (ровно 10 гильз, никаких новых мешей при выстрелах)
    this.shellPool = [];
    this.shellIndex = 0;
    this.pendingShells = [];

    // Пул гильз и дымка АК-47 в wScene (30 латунных гильз, 10 клубов дыма)
    this.akShellPool = [];
    this.akShellIndex = 0;
    this.akSmokePool = [];
    this.akSmokeIndex = 0;

    // Пулы дымка дула и заднего выхлопа ракетницы в wScene
    this.rocketSmokePool = [];
    this.rocketSmokeIndex = 0;
    this.rocketBackblastPool = [];
    this.rocketBackblastIndex = 0;

    // Параметры позы добивания (выдвижение вперёд и подъём к линии прицела)
    this.gloryPose = {
      active: false,
      timer: 0,
      duration: 0.2,
      weaponId: null,
      startPos: new THREE.Vector3(0.28, -0.24, -0.46),
      startRot: new THREE.Euler(0, 0, 0),
      targetPos: new THREE.Vector3(0.05, -0.10, -0.72),
      targetRot: new THREE.Euler(0.04, 0, 0),
      returning: false,
      returnTimer: 0,
      returnDuration: 0.15
    };

    this.buildModels();
  }

  buildModels() {
    // Очищаем старые модели при перестроении (например, при смене стиля)
    while (this.view.children.length > 0) {
      this.view.remove(this.view.children[0]);
    }
    this.models = {};
    this.proceduralHands = [];

    const useArmsModel = CONFIG.viewmodel?.arms?.useModel !== false && hasArmsModel();

    const isPsx = (CONFIG.graphics && CONFIG.graphics.styleName) !== "cartoon";
    const H = Math.PI / 2;
    const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const cyl = (r, l, s) => new THREE.CylinderGeometry(r, r, l, s || 12);
    const sph = (r) => new THREE.SphereGeometry(r, 10, 8);
    const cone = (r, l) => new THREE.ConeGeometry(r, l, 12);
    const tor = (r, tube) => new THREE.TorusGeometry(r, tube, 8, 16);

    const part = (geo, color, x, y, z, rx, ry, rz) => {
      const mat = createToonMaterial(color, {
        excludeSnap: true,
        emissive: 0x222222,
        emissiveIntensity: 0.12
      });
      mat.depthTest = true;
      mat.depthWrite = true;
      const m = isPsx ? new THREE.Mesh(geo, mat) : outlined(geo, mat);
      m.renderOrder = 999;
      m.position.set(x, y, z);
      if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
      return m;
    };

    const partE = (geo, color, emissive, x, y, z, ei) => {
      const mat = createToonMaterial(color, {
        emissive: emissive || 0x222222,
        emissiveIntensity: ei || 0.8,
        excludeSnap: true
      });
      mat.depthTest = true;
      mat.depthWrite = true;
      const m = isPsx ? new THREE.Mesh(geo, mat) : outlined(geo, mat);
      m.renderOrder = 999;
      m.position.set(x, y, z);
      return m;
    };

    // Цвета рук: в PSX — грязная бледная кожа и тёмный рукав
    const skinColor = isPsx ? 0xc8a488 : 0xf5c6a0;
    const cuffColor = isPsx ? 0x383c44 : 0xffffff;

    const mkHand = (x, y, z, rx, ry, rz) => {
      const hg = new THREE.Group();
      const handMat = createToonMaterial(skinColor, {
        excludeSnap: true,
        emissive: 0x222222,
        emissiveIntensity: 0.12
      });
      handMat.depthTest = true;
      handMat.depthWrite = true;
      const handMesh = isPsx
        ? new THREE.Mesh(box(0.11, 0.12, 0.14), handMat)
        : outlined(box(0.11, 0.12, 0.14), handMat);
      handMesh.renderOrder = 999;
      hg.add(handMesh);

      const cuffMat = createToonMaterial(cuffColor, {
        excludeSnap: true,
        emissive: 0x222222,
        emissiveIntensity: 0.12
      });
      cuffMat.depthTest = true;
      cuffMat.depthWrite = true;
      const cuff = isPsx
        ? new THREE.Mesh(box(0.12, 0.035, 0.15), cuffMat)
        : outlined(box(0.12, 0.035, 0.15), cuffMat);
      cuff.renderOrder = 999;
      cuff.position.y = 0.078;
      hg.add(cuff);

      const thumbMat = createToonMaterial(skinColor, {
        excludeSnap: true,
        emissive: 0x222222,
        emissiveIntensity: 0.12
      });
      thumbMat.depthTest = true;
      thumbMat.depthWrite = true;
      const thumb = isPsx
        ? new THREE.Mesh(box(0.04, 0.055, 0.04), thumbMat)
        : outlined(box(0.04, 0.055, 0.04), thumbMat);
      thumb.renderOrder = 999;
      thumb.position.set(0.065, -0.01, -0.04);
      hg.add(thumb);

      hg.position.set(x, y, z);
      if (rx || ry || rz) hg.rotation.set(rx || 0, ry || 0, rz || 0);
      hg.userData.isProceduralHand = true;
      hg.visible = !useArmsModel;
      this.proceduralHands.push(hg);
      return hg;
    };

    /* ДРОБОВИК: 3D-модель из shotgun.glb или процедурная запасная */
    const sgCfg = CONFIG.viewmodel?.shotgun || {};
    const useShotgunModel = sgCfg.useModel !== false && hasShotgunModel();
    if (useShotgunModel) {
      this._buildShotgunModel(sgCfg);
    } else {
      this._buildShotgunProcedural(isPsx);
    }

    /* АК-47: 3D-модель из ak47.glb или процедурная запасная */
    const akCfg = CONFIG.viewmodel?.ak47 || {};
    const useAkModel = akCfg.useModel !== false && hasAk47Model();
    if (useAkModel) {
      this._buildAk47Model(akCfg, mkHand);
    } else {
      this._buildAk47Procedural(isPsx, part, box, cyl, sph, mkHand, H);
    }

    /* РАКЕТНИЦА: 3D-модель из rocket.glb или процедурная запасная */
    const rlCfg = CONFIG.viewmodel?.rocket || {};
    const useRocketModel = rlCfg.useModel !== false && hasRocketModel();
    if (useRocketModel) {
      this._buildRocketModel(rlCfg, mkHand);
    } else {
      this._buildRocketProcedural(isPsx, part, box, cyl, cone, sph, mkHand, H);
    }

    // Инициализация/обновление пула гильз (ровно 10 гильз для дробовика, 30 гильз и дымок для АК-47)
    this._initShellPool();
    this._initAkShellPool();
    this._initAkSmokePool();
    this._initRocketPools();

    // 3D-руки от первого лица (arms_rig.glb)
    this._buildArmsModel();
    this._bakeAllWeaponArms();

    // Гарантируем, что активна и видна строго одна модель оружия (предотвращает наложение при смене качества/стиля)
    this.switchWeapon(this.currentWeaponId || "shotgun");
  }

  /** @private */
  _clearBakedArms() {
    if (!this.bakedArms) return;
    for (const wId of Object.keys(this.bakedArms)) {
      const pair = this.bakedArms[wId];
      if (!pair) continue;
      if (pair.right && pair.right.armRoot) pair.right.armRoot.removeFromParent();
      if (pair.left && pair.left.armRoot) pair.left.armRoot.removeFromParent();
    }
    this.bakedArms = {};
  }

  /** Запечь позы правой и левой руки для указанного оружия. @private */
  _bakeWeaponArms(weaponId) {
    if (!this.bakedArms) this.bakedArms = {};
    const prev = this.bakedArms[weaponId];
    if (prev) {
      if (prev.right && prev.right.armRoot) prev.right.armRoot.removeFromParent();
      if (prev.left && prev.left.armRoot) prev.left.armRoot.removeFromParent();
    }

    const armsCfg = CONFIG.viewmodel?.arms || {};
    if (armsCfg.useModel === false || !hasArmsModel()) {
      delete this.bakedArms[weaponId];
      return;
    }

    const gunRoot = this._getWeaponGunRoot(weaponId);
    if (!gunRoot) return;

    const bp = this._getWeaponBasePos(weaponId);
    this.view.position.set(bp.x, bp.y, bp.z);
    this.view.rotation.set(0, 0, 0);
    this.view.updateMatrixWorld(true);

    const right = bakeArm({ weaponId, side: "right", wScene: this.wScene, gunRoot });
    const left = bakeArm({ weaponId, side: "left", wScene: this.wScene, gunRoot });
    this.bakedArms[weaponId] = { right, left };

    if (weaponId === this.currentWeaponId) {
      this.armsReach.right = right ? !!right.reachable : true;
      this.armsReach.left = left ? !!left.reachable : true;
    }
  }

  /** Запечь позы рук для всех оружий (shotgun, ak47, rocket). @private */
  _bakeAllWeaponArms() {
    this._clearBakedArms();
    const armsCfg = CONFIG.viewmodel?.arms || {};
    if (armsCfg.useModel === false || !hasArmsModel()) {
      this._syncArmsVisibility();
      return;
    }

    const prevPos = this.view.position.clone();
    const prevRot = this.view.rotation.clone();

    for (const wId of ["shotgun", "ak47", "rocket"]) {
      this._bakeWeaponArms(wId);
    }

    this.view.position.copy(prevPos);
    this.view.rotation.copy(prevRot);
    this.view.updateMatrixWorld(true);
    this._syncArmsVisibility();
  }

  /** Перепечь руки для конкретного оружия (вызывается из редактора). */
  rebakeWeaponArms(weaponId = this.currentWeaponId) {
    const prevPos = this.view.position.clone();
    const prevRot = this.view.rotation.clone();
    this._bakeWeaponArms(weaponId);
    this.view.position.copy(prevPos);
    this.view.rotation.copy(prevRot);
    this.view.updateMatrixWorld(true);
    this._syncArmsVisibility();
  }

  /** Перепечь руки для всех оружий (при смене глобальных настроек рук). */
  rebakeAllArms() {
    this._bakeAllWeaponArms();
  }

  /**
   * Пересоздать общую утолщённую геометрию и/или текстуру рукавов и обновить клоны.
   * @param {{geometry?: boolean, texture?: boolean}} [opts]
   */
  refreshArmsGeometryAndTexture({ geometry = true, texture = true } = {}) {
    if (geometry) {
      const newGeo = rebuildArmsGeometry();
      if (newGeo) {
        if (this.armsState && this.armsState.skinnedMesh) {
          this.armsState.skinnedMesh.geometry = newGeo;
        }
        if ((CONFIG.viewmodel?.arms?.mode || "baked") === "baked") {
          this.rebakeAllArms();
        } else if (this.bakedArms) {
          for (const wId of Object.keys(this.bakedArms)) {
            const pair = this.bakedArms[wId];
            if (!pair) continue;
            for (const entry of [pair.right, pair.left]) {
              if (!entry || !entry.modelGroup) continue;
              entry.modelGroup.traverse((node) => {
                if (node.isSkinnedMesh) node.geometry = newGeo;
              });
            }
          }
        }
      }
    }
    if (texture) {
      rebuildArmsTexture();
    }
  }

  /** Синхронизировать видимость запечённых рук, liveIK/anim и процедурных кистей. @private */
  _syncArmsVisibility() {
    const armsCfg = CONFIG.viewmodel?.arms || {};
    const mode = armsCfg.mode || "baked";
    const useModel = armsCfg.useModel !== false && hasArmsModel();
    const isBaked = useModel && mode === "baked";

    if (this.bakedArms) {
      for (const wId of Object.keys(this.bakedArms)) {
        const pair = this.bakedArms[wId];
        if (!pair) continue;
        const vis = isBaked && wId === this.currentWeaponId;
        if (pair.right && pair.right.armRoot) pair.right.armRoot.visible = vis;
        if (pair.left && pair.left.armRoot) pair.left.armRoot.visible = vis;
      }
    }

    if (this.armsGroup) {
      this.armsGroup.visible = useModel && !isBaked && !!this.armsState;
    }
    this._setProceduralHandsVisible(!useModel);
  }

  /** @private */
  _setProceduralHandsVisible(visible) {
    if (!this.proceduralHands) return;
    for (const hg of this.proceduralHands) {
      if (hg) hg.visible = !!visible;
    }
  }

  /**
   * Сборка 3D-модели рук от первого лица внутри wScene.
   * @private
   */
  _buildArmsModel() {
    while (this.armsGroup.children.length > 0) {
      this.armsGroup.remove(this.armsGroup.children[0]);
    }
    this.armsState = null;

    const armsCfg = CONFIG.viewmodel?.arms || {};
    if (armsCfg.useModel === false || !hasArmsModel()) {
      this.armsGroup.visible = false;
      this._setProceduralHandsVisible(true);
      return;
    }

    const inst = createArmsInstance();
    if (!inst) {
      this.armsGroup.visible = false;
      this._setProceduralHandsVisible(true);
      return;
    }

    let poseName = armsCfg.pose || "knife_idle";
    if (!inst.actions[poseName]) {
      console.warn(`[Viewmodel] Клип рук "${poseName}" не найден. Доступные клипы:`, inst.clipNames);
      poseName = "guard_idle";
      if (!inst.actions[poseName]) {
        console.warn("[Viewmodel] Запасной клип \"guard_idle\" не найден. Используются процедурные перчатки.");
        this.armsGroup.visible = false;
        this._setProceduralHandsVisible(true);
        return;
      }
    }

    const action = inst.actions[poseName];
    action.reset();
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.play();
    inst.mixer.timeScale = armsCfg.timeScale ?? 0.6;
    inst.mixer.update(0.016);

    const wrapper = new THREE.Group();
    wrapper.rotation.y = Math.PI;
    wrapper.add(inst.modelGroup);
    this.armsGroup.add(wrapper);

    // Вычисляем смещение кости camera один раз после установки позы
    this.armsGroup.position.set(0, 0, 0);
    this.armsGroup.rotation.set(0, 0, 0);
    this.armsGroup.scale.setScalar(1);
    this.armsGroup.updateMatrixWorld(true);

    const camBone = inst.modelGroup.getObjectByName("camera");
    if (camBone) {
      const camPos = new THREE.Vector3();
      camBone.getWorldPosition(camPos);
      wrapper.position.set(-camPos.x, -camPos.y, -camPos.z);
    }

    const chainR = createArmChain(inst.modelGroup, "R");
    const chainL = createArmChain(inst.modelGroup, "L");
    const fingerBones = new Map();
    for (const boneName of Object.keys(inst.fingerPoses?.fist || {})) {
      const b = inst.modelGroup.getObjectByName(boneName);
      if (b) fingerBones.set(boneName, b);
    }

    if ((armsCfg.mode || "ik") === "ik") {
      action.stop();
    }

    this.armsState = {
      ...inst,
      wrapper,
      activeAction: action,
      currentClip: poseName,
      paused: false,
      chainR,
      chainL,
      fingerBones
    };
    this.armsGroup.visible = true;
    this._setProceduralHandsVisible(false);
    this.applyArmsTransform();
  }

  /** Включить / выключить отладочные маркеры целей кистей. */
  setArmsDebugVisible(visible) {
    this.armsDebugVisible = !!visible;
    const mode = CONFIG.viewmodel?.arms?.mode || "baked";
    if (this.handTargetMarkers) {
      this.handTargetMarkers.right.visible = !!visible && mode === "liveIK";
      this.handTargetMarkers.left.visible = !!visible && mode === "liveIK";
    }
  }

  /** Сменить режим рук ("baked" | "liveIK" | "anim"). */
  setArmsMode(mode) {
    if (!CONFIG.viewmodel) CONFIG.viewmodel = {};
    if (!CONFIG.viewmodel.arms) CONFIG.viewmodel.arms = {};
    const normalized = mode === "anim" ? "anim" : (mode === "liveIK" || mode === "ik") ? "liveIK" : "baked";
    CONFIG.viewmodel.arms.mode = normalized;

    if (normalized === "baked") {
      if (this.armsState && this.armsState.activeAction) {
        this.armsState.activeAction.stop();
      }
      if (!this.bakedArms || !this.bakedArms[this.currentWeaponId]) {
        this._bakeAllWeaponArms();
      }
      if (this.handTargetMarkers) {
        this.handTargetMarkers.right.visible = false;
        this.handTargetMarkers.left.visible = false;
      }
      this._syncArmsVisibility();
      return;
    }

    if (!this.armsState && hasArmsModel() && CONFIG.viewmodel.arms.useModel !== false) {
      this._buildArmsModel();
    }
    if (this.armsState) {
      if (normalized === "anim") {
        this.setArmsClip(this.armsState.currentClip || CONFIG.viewmodel.arms.pose || "knife_idle");
        this.setArmsPaused(false);
        if (this.handTargetMarkers) {
          this.handTargetMarkers.right.visible = false;
          this.handTargetMarkers.left.visible = false;
        }
      } else {
        if (this.armsState.activeAction) this.armsState.activeAction.stop();
        if (this.handTargetMarkers) {
          this.handTargetMarkers.right.visible = this.armsDebugVisible;
          this.handTargetMarkers.left.visible = this.armsDebugVisible;
        }
      }
    }
    this._syncArmsVisibility();
  }

  /** Прикрепить пустышки Grip_R / Grip_L из .glb к gunRoot, если они есть. @private */
  _attachGripNodes(modelKey, gunRoot) {
    const gripR = getNodeClone(modelKey, "Grip_R");
    const gripL = getNodeClone(modelKey, "Grip_L");
    if (gripR) {
      gunRoot.add(gripR);
      gunRoot.userData.gripR = gripR;
    }
    if (gripL) {
      gunRoot.add(gripL);
      gunRoot.userData.gripL = gripL;
    }
  }

  /** @private */
  _getWeaponGunRoot(weaponId) {
    const m = this.models[weaponId];
    if (!m) return null;
    return (m.userData && m.userData.gunRoot) || m;
  }

  /** @private */
  _getWeaponHandsConfig(weaponId) {
    const cfg = CONFIG.viewmodel?.[weaponId]?.hands;
    if (cfg && cfg.right && cfg.left) return cfg;
    if (weaponId === "shotgun") {
      return {
        right: { x: 10, y: -15, z: 26, rot: { x: 0, y: 0, z: 0 } },
        left: { x: 141, y: -15, z: 17, rot: { x: 0, y: 0, z: 0 } }
      };
    }
    if (weaponId === "ak47") {
      return {
        right: { x: -1.1, y: -0.25, z: 0.0, rot: { x: 0, y: 0, z: 0 } },
        left: { x: 0.85, y: 0.05, z: 0.0, rot: { x: 0, y: 0, z: 0 } }
      };
    }
    return {
      right: { x: 0.0, y: -0.18, z: 0.05, rot: { x: 0, y: 0, z: 0 } },
      left: { x: 0.0, y: -0.16, z: -0.35, rot: { x: 0, y: 0, z: 0 } }
    };
  }

  /** @private */
  _applyFingerPoses(weaponId) {
    if (!this.armsState || !this.armsState.fingerBones) return;
    const { fist, trigger } = this.armsState.fingerPoses || {};
    if (!fist) return;

    const tfCfg = CONFIG.viewmodel?.arms?.triggerFinger;
    let blend = 0;
    if (typeof tfCfg === "number") {
      blend = tfCfg;
    } else if (tfCfg && typeof tfCfg === "object") {
      blend = tfCfg[weaponId] ?? (weaponId === "rocket" ? 0 : 0.6);
    } else {
      blend = weaponId === "rocket" ? 0 : 0.6;
    }
    blend = Math.max(0, Math.min(1, blend));

    for (const [boneName, bone] of this.armsState.fingerBones) {
      const fistQ = fist[boneName];
      if (!fistQ) continue;
      const trigQ = trigger ? trigger[boneName] : null;
      if (trigQ && blend > 0) {
        bone.quaternion.copy(fistQ).slerp(trigQ, blend);
      } else {
        bone.quaternion.copy(fistQ);
      }
    }
  }

  /** Применить pos/rot/scale из CONFIG.viewmodel.arms. */
  applyArmsTransform() {
    if (!this.armsGroup) return;
    const cfg = CONFIG.viewmodel?.arms || {};
    const p = cfg.pos || {};
    const r = cfg.rot || {};
    const s = cfg.scale ?? 1.0;
    this.armsGroup.position.set(p.x || 0, p.y || 0, p.z || 0);
    this.armsGroup.rotation.set(r.x || 0, r.y || 0, r.z || 0);
    this.armsGroup.scale.setScalar(s);
  }

  /** Список доступных анимационных клипов рук. */
  getArmsClipNames() {
    return this.armsState ? this.armsState.clipNames : [];
  }

  /** Переключить анимацию рук (из редактора F2). */
  setArmsClip(clipName) {
    if (!this.armsState || !this.armsState.actions[clipName]) return false;
    if (this.armsState.activeAction) {
      this.armsState.activeAction.stop();
    }
    const next = this.armsState.actions[clipName];
    next.reset();
    next.setLoop(THREE.LoopRepeat, Infinity);
    next.play();
    this.armsState.activeAction = next;
    this.armsState.currentClip = clipName;
    if (CONFIG.viewmodel?.arms) CONFIG.viewmodel.arms.pose = clipName;
    if (this.armsState.paused) {
      this.armsState.mixer.timeScale = CONFIG.viewmodel?.arms?.timeScale ?? 0.6;
      this.armsState.mixer.update(0.016);
      this.armsState.mixer.timeScale = 0;
    }
    return true;
  }

  /** Пауза / воспроизведение анимации рук. */
  setArmsPaused(paused) {
    if (!this.armsState) return;
    this.armsState.paused = !!paused;
    this.armsState.mixer.timeScale = this.armsState.paused ? 0 : (CONFIG.viewmodel?.arms?.timeScale ?? 0.6);
  }

  /**
   * Сборка вьюмодели дробовика из 3D-модели shotgun.glb.
   * Части: Tactical_Body (без смещения), Tactical_Stock_V1, Tactical_Handguard_V1 (с оффсетами из cfg.assembly).
   * Ориентация: модель X вперёд, Z вверх → игра -Z вперёд, Y вверх.
   * @param {Object} cfg - CONFIG.viewmodel.shotgun
   * @private
   */
  _buildShotgunModel(cfg) {
    const isPsx = (CONFIG.graphics && CONFIG.graphics.styleName) !== "cartoon";

    const gunRoot = new THREE.Group();
    gunRoot.name = "shotgun_root";

    // --- Определяем структуру модели ---
    // Новая модель (5 узлов): Tactical_Body содержит Stock, Trigger, Handguard как дочерних.
    //   Shell лежит отдельно (гильза — не нужна для вьюмодели).
    // Стратегия: клонируем Body с дочерними, НЕ клонируем Stock/Handguard отдельно.
    //   Скрываем Trigger. Shell не берём.

    let body = getNodeClone("shotgun", "Tactical_Body");
    let usedHierarchy = false;

    if (body) {
      usedHierarchy = true;
      // Скрываем Trigger (мизерный, невидимый)
      const trigger = body.getObjectByName("Tactical_Trigger");
      if (trigger) trigger.visible = false;

      gunRoot.add(body);
      console.info("[Viewmodel] shotgun.glb: иерархическая модель (Body + дочерние Stock, Handguard).");
    } else {
      // Fallback: модель без именованных узлов (единый меш)
      const fallbackBody = getFirstMeshNode("shotgun");
      if (fallbackBody) {
        console.warn(
          "[Viewmodel] Узел Tactical_Body не найден в shotgun.glb — используется первый меш модели."
        );
        body = fallbackBody;
        gunRoot.add(body);
      }
    }

    if (!body) {
      console.warn("[Viewmodel] Нет мешей в shotgun.glb — процедурная запасная модель.");
      this._buildShotgunProcedural(isPsx);
      return;
    }

    // Ориентация из конфига — cfg.rot задаёт ФИНАЛЬНУЮ ротацию.
    // По умолчанию (если rot не задан): -90° по Y (ствол +X → -Z в игре).
    gunRoot.rotation.order = "YXZ";
    gunRoot.rotation.set(
      cfg.rot?.x ?? 0,
      cfg.rot?.y ?? (-Math.PI / 2),
      cfg.rot?.z ?? 0
    );

    // Измеряем Box3 ДО assembly-оффсетов (части у начала координат) —
    // масштаб должен быть таким же, как при настройке в редакторе
    const preBox = new THREE.Box3().setFromObject(gunRoot);
    const preSize = preBox.getSize(new THREE.Vector3());
    const modelLength = Math.max(preSize.x, preSize.y, preSize.z);
    const baseScale = modelLength > 1e-6 ? (cfg.length ?? 0.9) / modelLength : 1;
    gunRoot.scale.setScalar(baseScale * (cfg.scale ?? 1));

    console.info(
      `[Viewmodel] shotgun.glb: Box3 размеры x=${preSize.x.toFixed(2)} y=${preSize.y.toFixed(2)} z=${preSize.z.toFixed(2)}, ` +
      `максимум=${modelLength.toFixed(2)}, масштаб=${baseScale.toFixed(4)}, итоговая длина=${(modelLength * baseScale).toFixed(2)} м`
    );

    // Assembly-оффсеты ПОСЛЕ масштабирования — двигаем дочерние узлы внутри body
    // (позиции задаются в единицах модели, до масштаба — scale gunRoot их пересчитает автоматически)
    if (usedHierarchy && cfg.assembly) {
      const stockOff = cfg.assembly.stock;
      const handOff = cfg.assembly.handguard;
      if (stockOff) {
        const stockNode = body.getObjectByName("Tactical_Stock_V1");
        if (stockNode) stockNode.position.set(stockOff.x, stockOff.y, stockOff.z);
      }
      if (handOff) {
        const handNode = body.getObjectByName("Tactical_Handguard_V1");
        if (handNode) {
          handNode.position.set(handOff.x, handOff.y, handOff.z);
          this.handguardNode = handNode;
          this.handguardBasePos.set(handOff.x, handOff.y, handOff.z);
        }
      }
    }

    // Позиция модели внутри this.view — ноль.
    // Смещение задаётся через this.view.position в update() из cfg.pos.
    gunRoot.position.set(0, 0, 0);
    this._attachGripNodes("shotgun", gunRoot);

    gunRoot.updateMatrixWorld(true);

    // Материалы: MeshStandardMaterial с текстурами из модели (baseColor, normal, emissive, metallic/roughness)
    const brightness = cfg.brightness ?? 1.8;
    gunRoot.traverse((node) => {
      if (node.isMesh && node.material) {
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        mats.forEach((mat) => {
          const texSetNearest = (tex) => {
            if (!tex) return;
            tex.magFilter = THREE.NearestFilter;
            tex.minFilter = THREE.NearestFilter;
            tex.generateMipmaps = false;
            tex.colorSpace = THREE.SRGBColorSpace;
          };
          texSetNearest(mat.map);
          if (mat.normalMap) {
            mat.normalMap.magFilter = THREE.NearestFilter;
            mat.normalMap.minFilter = THREE.NearestFilter;
            mat.normalMap.generateMipmaps = false;
          }
          if (mat.emissiveMap) {
            mat.emissiveMap.magFilter = THREE.NearestFilter;
            mat.emissiveMap.minFilter = THREE.NearestFilter;
            mat.emissiveMap.generateMipmaps = false;
          }

          const newMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            map: mat.map,
            normalMap: mat.normalMap || null,
            emissiveMap: mat.emissiveMap || null,
            emissive: mat.emissiveMap ? new THREE.Color(0xffffff) : new THREE.Color(0x000000),
            emissiveIntensity: mat.emissiveMap ? 0.5 : 0,
            metalness: (mat.metalness != null) ? mat.metalness * 0.6 : 0.3,
            roughness: (mat.roughness != null) ? mat.roughness : 0.7,
            metalnessMap: mat.metalnessMap || null,
            roughnessMap: mat.roughnessMap || null,
            depthTest: true,
            depthWrite: true
          });
          newMat.userData.shared = true;
          newMat.color.multiplyScalar(brightness);
          node.material = newMat;
        });
      }
    });

    // 1. Точка дула: CONFIG.viewmodel.shotgun.muzzle { x, y, z } в локальных координатах gunRoot
    const muz = cfg.muzzle || { x: 199, y: 0, z: 32 };
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(20, 8, 6),
      new THREE.MeshBasicMaterial({ color: isPsx ? 0xffdf80 : 0xfff1a0 })
    );
    flash.position.set(muz.x, muz.y, muz.z);
    flash.visible = false;
    flash.renderOrder = 999;
    gunRoot.add(flash);
    gunRoot.userData.flash = flash;
    gunRoot.userData._isModel = true;

    // Маркер точки дула для редактора (маленькая сфера)
    const muzzleMarker = new THREE.Mesh(
      new THREE.SphereGeometry(5.5, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xff2222 })
    );
    muzzleMarker.name = "muzzleMarker";
    muzzleMarker.position.set(muz.x, muz.y, muz.z);
    muzzleMarker.visible = false;
    muzzleMarker.renderOrder = 1000;
    gunRoot.add(muzzleMarker);
    gunRoot.userData.muzzleMarker = muzzleMarker;

    // Маркер точки выброса гильз для редактора (маленькая сфера)
    const ej = cfg.eject || { x: 15, y: 6, z: 25 };
    const ejectMarker = new THREE.Mesh(
      new THREE.SphereGeometry(4.5, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0x22ff44 })
    );
    ejectMarker.name = "ejectMarker";
    ejectMarker.position.set(ej.x, ej.y, ej.z);
    ejectMarker.visible = false;
    ejectMarker.renderOrder = 1000;
    gunRoot.add(ejectMarker);
    gunRoot.userData.ejectMarker = ejectMarker;

    gunRoot.visible = this.currentWeaponId === "shotgun";
    this.view.add(gunRoot);
    this.models.shotgun = gunRoot;

    // Инициализация/обновление пула гильз в wScene
    this._initShellPool();

    console.info(
      `[Viewmodel] Дробовик загружен из shotgun.glb: длина модели ${modelLength.toFixed(2)} у.е., масштаб ${baseScale.toFixed(4)}`
    );
    gunRoot.userData._baseLength = modelLength;
  }

  /**
   * Сборка вьюмодели АК-47 из 3D-модели ak47.glb.
   * Поддерживает как цельную модель (AK47_PSX: ствол по -Z, верх +Y),
   * так и иерархическую (AK-47_Body).
   * @param {Object} cfg - CONFIG.viewmodel.ak47
   * @param {Function} mkHand - построитель рук/перчаток
   * @private
   */
  _buildAk47Model(cfg, mkHand) {
    const isPsx = (CONFIG.graphics && CONFIG.graphics.styleName) !== "cartoon";

    const wrapper = new THREE.Group();
    wrapper.name = "ak47_wrapper";

    const gunRoot = new THREE.Group();
    gunRoot.name = "ak47_root";

    let body =
      getNodeClone("ak47", "ak-47") ||
      getNodeClone("ak47", "AK47_PSX") ||
      getNodeClone("ak47", "AK-47_Body");
    let usedHierarchy = false;

    if (body) {
      usedHierarchy = body.name === "AK-47_Body";
      gunRoot.add(body);
    } else {
      const fallbackBody = getFirstMeshNode("ak47");
      if (fallbackBody) {
        body = fallbackBody;
        gunRoot.add(body);
      }
    }

    if (!body) {
      console.warn("[Viewmodel] Нет мешей в ak47.glb — процедурная запасная модель АК-47.");
      this._buildAk47ProceduralFallback();
      return;
    }

    // Ориентация из конфига
    gunRoot.rotation.order = "YXZ";
    gunRoot.rotation.set(
      cfg.rot?.x ?? 0.02,
      cfg.rot?.y ?? -1.5,
      cfg.rot?.z ?? 0.08
    );

    // Измеряем Box3 для масштабирования до cfg.length
    const preBox = new THREE.Box3().setFromObject(gunRoot);
    const preSize = preBox.getSize(new THREE.Vector3());
    const modelLength = Math.max(preSize.x, preSize.y, preSize.z) || 0.97;
    const baseScale = modelLength > 1e-6 ? (cfg.length ?? 0.95) / modelLength : 1;
    gunRoot.scale.setScalar(baseScale * (cfg.scale ?? 1));

    // Assembly-оффсеты (только для иерархической модели, если есть дочерние узлы)
    if (usedHierarchy && cfg.assembly) {
      const partMap = {
        stock: "AK-47_Stock_V1",
        magazine: "AK-47_Magazine_V1",
        grip: "AK-47_Grip_V1",
        trigger: "AK-47_Trigger"
      };
      for (const [key, nodeName] of Object.entries(partMap)) {
        const off = cfg.assembly[key];
        const node = body.getObjectByName(nodeName);
        if (node) {
          if (!node.userData._basePos) {
            node.userData._basePos = node.position.clone();
          }
          if (off) {
            node.position.set(
              node.userData._basePos.x + (off.x || 0),
              node.userData._basePos.y + (off.y || 0),
              node.userData._basePos.z + (off.z || 0)
            );
          }
        }
      }
    }

    gunRoot.position.set(0, 0, 0);
    this._attachGripNodes("ak47", gunRoot);
    gunRoot.updateMatrixWorld(true);

    // Материалы: MeshPhongMaterial с поддержкой vertexColors и бликами металла (без vertex snap)
    const brightness = cfg.brightness ?? 1.25;
    const matCache = new Map();
    const toPhong = (mat) => {
      if (!mat) return mat;
      const cacheKey = mat.uuid;
      if (matCache.has(cacheKey)) return matCache.get(cacheKey);

      if (mat.map) {
        mat.map.magFilter = THREE.NearestFilter;
        mat.map.minFilter = THREE.NearestFilter;
        mat.map.generateMipmaps = false;
        mat.map.colorSpace = THREE.SRGBColorSpace;
        mat.map.needsUpdate = true;
      }

      let baseCol = mat.color ? mat.color.clone() : new THREE.Color(0xffffff);
      // Если у материала нет текстуры (как Wood Base 01 / Metal scratched), придаём характерный оттенок дерева/стали
      if (!mat.map && mat.name) {
        const lower = mat.name.toLowerCase();
        if (lower.includes("wood")) {
          baseCol = new THREE.Color(0x7a4220);
        } else if (lower.includes("metal")) {
          baseCol = new THREE.Color(0x3c424a);
        }
      }
      const hasEmissive = mat.emissive && (mat.emissive.r > 0 || mat.emissive.g > 0 || mat.emissive.b > 0);
      const newMat = new THREE.MeshPhongMaterial({
        color: baseCol.clone().multiplyScalar(brightness),
        map: mat.map || null,
        vertexColors: !!mat.vertexColors,
        specular: new THREE.Color(0x686868),
        shininess: 32,
        emissive: hasEmissive ? mat.emissive.clone() : new THREE.Color(0x000000),
        emissiveIntensity: hasEmissive ? (mat.emissiveIntensity ?? 1.0) : 0,
        depthTest: true,
        depthWrite: true
      });
      newMat.userData.shared = true;
      newMat.userData._baseColor = baseCol;
      matCache.set(cacheKey, newMat);
      return newMat;
    };

    gunRoot.traverse((node) => {
      if (node.isMesh && node.material) {
        if (Array.isArray(node.material)) {
          node.material = node.material.map(toPhong);
        } else {
          node.material = toPhong(node.material);
        }
      }
    });

    // Нормализованный якорь в метрах внутри gunRoot (1 у.е. = 1 м, независимо от масштаба FBX)
    const fxAnchor = new THREE.Group();
    fxAnchor.name = "ak47_fx_anchor";
    const invScale = baseScale > 1e-6 ? 1 / baseScale : 1;
    fxAnchor.scale.setScalar(invScale);
    gunRoot.add(fxAnchor);

    // Точка дула и вспышка (звезда с 4 лучами, размер 0.18 м, случайный поворот)
    const muz = cfg.muzzle || { x: 0.52, y: 0.04, z: 0 };
    const flashRadius = 0.09; // диаметр 0.18 м
    const starGeo = new THREE.BufferGeometry();
    const rOuter = flashRadius;
    const rInner = flashRadius * 0.22;
    const verts = [];
    const addStarPlane = (isXY) => {
      for (let i = 0; i < 4; i++) {
        const a0 = (i * Math.PI) / 2;
        const a1 = a0 + Math.PI / 4;
        const a2 = a0 - Math.PI / 4;
        const p0 = [Math.cos(a0) * rOuter, Math.sin(a0) * rOuter];
        const p1 = [Math.cos(a1) * rInner, Math.sin(a1) * rInner];
        const p2 = [Math.cos(a2) * rInner, Math.sin(a2) * rInner];
        if (isXY) {
          verts.push(0, 0, 0, p0[0], p0[1], 0, p1[0], p1[1], 0);
          verts.push(0, 0, 0, p2[0], p2[1], 0, p0[0], p0[1], 0);
        } else {
          verts.push(0, 0, 0, 0, p0[0], p0[1], 0, p1[0], p1[1]);
          verts.push(0, 0, 0, 0, p2[0], p2[1], 0, p0[0], p0[1]);
        }
      }
    };
    addStarPlane(false);
    addStarPlane(true);
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    const flashMat = new THREE.MeshBasicMaterial({
      color: isPsx ? 0xffdf80 : 0xfff1a0,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const flash = new THREE.Mesh(starGeo, flashMat);
    flash.position.set(muz.x, muz.y, muz.z);
    flash.visible = false;
    flash.renderOrder = 999;
    fxAnchor.add(flash);

    const markerRadius = 0.022;
    const muzzleMarker = new THREE.Mesh(
      new THREE.SphereGeometry(markerRadius, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xff2222 })
    );
    muzzleMarker.name = "muzzleMarker";
    muzzleMarker.position.set(muz.x, muz.y, muz.z);
    muzzleMarker.visible = false;
    muzzleMarker.renderOrder = 1000;
    fxAnchor.add(muzzleMarker);

    const ej = cfg.eject || { x: 0.05, y: 0.05, z: 0.03 };
    const ejectMarker = new THREE.Mesh(
      new THREE.SphereGeometry(markerRadius, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0x22ff44 })
    );
    ejectMarker.name = "ejectMarker";
    ejectMarker.position.set(ej.x, ej.y, ej.z);
    ejectMarker.visible = false;
    ejectMarker.renderOrder = 1000;
    fxAnchor.add(ejectMarker);

    wrapper.add(gunRoot);

    wrapper.visible = this.currentWeaponId === "ak47";
    wrapper.userData.flash = flash;
    wrapper.userData.muzzleMarker = muzzleMarker;
    wrapper.userData.ejectMarker = ejectMarker;
    wrapper.userData.gunRoot = gunRoot;
    wrapper.userData._isModel = true;
    wrapper.userData._baseLength = modelLength;

    this.view.add(wrapper);
    this.models.ak47 = wrapper;

    console.info(
      `[Viewmodel] АК-47 загружен из ak47.glb: длина модели ${modelLength.toFixed(2)} у.е., масштаб ${baseScale.toFixed(4)}, итоговая длина=${(modelLength * baseScale).toFixed(2)} м`
    );
  }

  /**
   * Запасная процедурная модель АК-47 (используется если ak47.glb не загрузился или useModel = false)
   * @private
   */
  _buildAk47Procedural(isPsx, part, box, cyl, sph, mkHand, H) {
    const barrelCol = 0x22252a;
    const receiverCol = isPsx ? 0x3d4734 : 0x47533c;
    const woodCol = isPsx ? 0x5a3219 : 0x6e3c1e;
    const metalDark = 0x1c1e22;
    const magCol = isPsx ? 0x26292e : 0x2e3238;

    const g = new THREE.Group();
    g.add(part(cyl(0.045, 0.52, 12), barrelCol, 0, 0.02, -0.36, H));
    g.add(part(cyl(0.035, 0.34, 12), metalDark, 0, 0.065, -0.28, H));
    g.add(part(box(0.012, 0.04, 0.015), metalDark, 0, 0.08, -0.58));
    g.add(part(cyl(0.05, 0.08, 12), metalDark, 0, 0.02, -0.62, H));
    g.add(part(box(0.09, 0.12, 0.32), receiverCol, 0, 0.01, -0.08));
    g.add(part(box(0.075, 0.085, 0.22), woodCol, 0, 0.03, -0.32));

    const mag = part(box(0.05, 0.18, 0.09), magCol, 0, -0.12, -0.14);
    mag.rotation.x = -0.25;
    g.add(mag);

    const grip = part(box(0.05, 0.14, 0.07), woodCol, 0, -0.12, 0.05);
    grip.rotation.x = 0.35;
    g.add(grip);

    g.add(part(box(0.065, 0.11, 0.26), woodCol, 0, -0.02, 0.22));

    const handsCfg = CONFIG.viewmodel?.ak47?.hands;
    const hr = handsCfg?.right || { x: 0, y: -0.11, z: 0.05 };
    const hl = handsCfg?.left || { x: 0, y: 0.01, z: -0.3 };
    g.add(mkHand(hr.x, hr.y, hr.z, 0.2));
    g.add(mkHand(hl.x, hl.y, hl.z, 0.35));

    const flash = new THREE.Mesh(sph(0.12), new THREE.MeshBasicMaterial({ color: 0xffd266 }));
    flash.position.set(0, 0.02, -0.66);
    flash.visible = false;
    flash.renderOrder = 999;
    g.add(flash);

    g.visible = this.currentWeaponId === "ak47";
    g.userData.flash = flash;
    this.view.add(g);
    this.models.ak47 = g;
  }

  /**
   * Вспомогательный fallback, если _buildAk47Model вызван без локальных хелперов
   * @private
   */
  _buildAk47ProceduralFallback() {
    const isPsx = (CONFIG.graphics && CONFIG.graphics.styleName) !== "cartoon";
    const mat = (col) => createToonMaterial(col);
    const part = (geo, col, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = outlined(geo, mat(col));
      m.position.set(x, y, z);
      if (rx || ry || rz) m.rotation.set(rx, ry, rz);
      m.renderOrder = 999;
      return m;
    };
    const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const cyl = (r, l, seg = 12) => new THREE.CylinderGeometry(r, r, l, seg);
    const sph = (r) => new THREE.SphereGeometry(r, 10, 8);
    const mkHand = (x, y, z, rz = 0) => {
      const g = new THREE.Group();
      const palm = outlined(box(0.08, 0.075, 0.1), mat(0x2e2e36));
      palm.renderOrder = 999;
      g.add(palm);
      g.position.set(x, y, z);
      if (rz) g.rotation.z = rz;
      return g;
    };
    this._buildAk47Procedural(isPsx, part, box, cyl, sph, mkHand, Math.PI / 2);
  }

  /**
   * Сборка вьюмодели ракетницы из 3D-модели rocket.glb.
   * Клонирует всю сцену целиком с сохранением матриц преобразования узлов.
   * Ось ствола +Z (дуло), тыл -Z. Поворот Y = 3.1416 направляет дуло вперёд (-Z).
   * @param {Object} cfg - CONFIG.viewmodel.rocket
   * @param {Function} mkHand - построитель рук/перчаток
   * @private
   */
  _buildRocketModel(cfg, mkHand) {
    const isPsx = (CONFIG.graphics && CONFIG.graphics.styleName) !== "cartoon";

    const rocketScene = getSceneClone("rocket");
    if (!rocketScene) {
      console.warn("[Viewmodel] Сцена rocket.glb не найдена — процедурная запасная ракетница.");
      this._buildRocketProceduralFallback();
      return;
    }

    const gunRoot = new THREE.Group();
    gunRoot.name = "rocket_root";

    // Измеряем Box3 сцены (новая модель: Z от -0.92 дуло до +0.50 тыл)
    rocketScene.updateMatrixWorld(true);
    const preBox = new THREE.Box3().setFromObject(rocketScene);
    const preSize = preBox.getSize(new THREE.Vector3());
    const modelLength = Math.max(preSize.x, preSize.y, preSize.z) || 1.42;
    const baseScale = modelLength > 1e-6 ? (cfg.length ?? 1.35) / modelLength : 1;

    // Смещаем тыл (+Z) к центру вращения (0,0,0), чтобы при отдаче ракетница откидывалась к плечу
    const rotY = cfg.rot?.y ?? 0.05;
    const isFlipped = Math.abs(rotY) > Math.PI * 0.5;
    rocketScene.position.z = isFlipped ? -preBox.min.z : -preBox.max.z;
    gunRoot.add(rocketScene);

    gunRoot.rotation.order = "YXZ";
    gunRoot.rotation.set(
      cfg.rot?.x ?? 0.02,
      rotY,
      cfg.rot?.z ?? -0.02
    );
    gunRoot.scale.setScalar(baseScale * (cfg.scale ?? 1));
    gunRoot.position.set(0, 0, 0);
    this._attachGripNodes("rocket", gunRoot);
    gunRoot.updateMatrixWorld(true);

    // Материалы: MeshLambertMaterial для каждого материала (поддержка vertexColors + glow_orange)
    const brightness = cfg.brightness ?? 1.3;
    const lambertCache = new Map();
    const toLambert = (mat) => {
      if (!mat) return mat;
      if (lambertCache.has(mat.uuid)) return lambertCache.get(mat.uuid);

      if (mat.map) {
        mat.map.magFilter = THREE.NearestFilter;
        mat.map.minFilter = THREE.NearestFilter;
        mat.map.generateMipmaps = false;
        mat.map.colorSpace = THREE.SRGBColorSpace;
        mat.map.needsUpdate = true;
      }

      let baseCol = mat.color ? mat.color.clone() : new THREE.Color(0xffffff);
      // Если у материала нет текстуры (как Wood Base 01 / Metal scratched), придаём характерный оттенок дерева/стали
      if (!mat.map && mat.name) {
        const lower = mat.name.toLowerCase();
        if (lower.includes("wood")) {
          baseCol = new THREE.Color(0x7a4220);
        } else if (lower.includes("metal")) {
          baseCol = new THREE.Color(0x3c424a);
        }
      }
      const hasEmissive = mat.emissive && (mat.emissive.r > 0 || mat.emissive.g > 0 || mat.emissive.b > 0);
      const newMat = new THREE.MeshLambertMaterial({
        color: baseCol.clone().multiplyScalar(brightness),
        map: mat.map || null,
        vertexColors: !!mat.vertexColors,
        emissive: hasEmissive ? mat.emissive.clone() : new THREE.Color(0x000000),
        emissiveIntensity: hasEmissive ? (mat.emissiveIntensity ?? 1.0) : 0,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: true
      });
      newMat.userData.shared = true;
      newMat.userData._baseColor = baseCol;
      lambertCache.set(mat.uuid, newMat);
      return newMat;
    };

    rocketScene.traverse((node) => {
      if (node.isMesh && node.material) {
        if (Array.isArray(node.material)) {
          node.material = node.material.map(toLambert);
        } else {
          node.material = toLambert(node.material);
        }
      }
    });

    // Вспышка выстрела (яркая звезда) и маркеры дула/выхлопа в координатах модели
    const muz = cfg.muzzle || { x: 0, y: 0.02, z: -0.92 };
    const rOuter = baseScale > 1e-6 ? 0.16 / baseScale : 0.16;
    const rInner = rOuter * 0.24;
    const starGeo = new THREE.BufferGeometry();
    const sVerts = [];
    const addStar = (isXZ) => {
      for (let i = 0; i < 4; i++) {
        const a0 = (i * Math.PI) / 2;
        const a1 = a0 + Math.PI / 4;
        const a2 = a0 - Math.PI / 4;
        const p0 = [Math.cos(a0) * rOuter, Math.sin(a0) * rOuter];
        const p1 = [Math.cos(a1) * rInner, Math.sin(a1) * rInner];
        const p2 = [Math.cos(a2) * rInner, Math.sin(a2) * rInner];
        if (isXZ) {
          sVerts.push(0, 0, 0, p0[0], 0, p0[1], p1[0], 0, p1[1]);
          sVerts.push(0, 0, 0, p2[0], 0, p2[1], p0[0], 0, p0[1]);
        } else {
          sVerts.push(0, 0, 0, p0[0], p0[1], 0, p1[0], p1[1], 0);
          sVerts.push(0, 0, 0, p2[0], p2[1], 0, p0[0], p0[1], 0);
        }
      }
    };
    addStar(false);
    addStar(true);
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(sVerts, 3));
    const flash = new THREE.Mesh(
      starGeo,
      new THREE.MeshBasicMaterial({
        color: isPsx ? 0xffdf80 : 0xfff1a0,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    flash.position.set(muz.x, muz.y, muz.z);
    flash.visible = false;
    flash.renderOrder = 999;
    rocketScene.add(flash);

    const markerRadius = baseScale > 1e-6 ? 0.035 / baseScale : 0.035;
    const muzzleMarker = new THREE.Mesh(
      new THREE.SphereGeometry(markerRadius, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xff2222 })
    );
    muzzleMarker.name = "muzzleMarker";
    muzzleMarker.position.set(muz.x, muz.y, muz.z);
    muzzleMarker.visible = false;
    muzzleMarker.renderOrder = 1000;
    rocketScene.add(muzzleMarker);

    const bb = cfg.backblast || { x: 0, y: 0.02, z: 0.50 };
    const backblastMarker = new THREE.Mesh(
      new THREE.SphereGeometry(markerRadius, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0x22ff44 })
    );
    backblastMarker.name = "backblastMarker";
    backblastMarker.position.set(bb.x, bb.y, bb.z);
    backblastMarker.visible = false;
    backblastMarker.renderOrder = 1000;
    rocketScene.add(backblastMarker);

    gunRoot.visible = this.currentWeaponId === "rocket";
    gunRoot.userData.flash = flash;
    gunRoot.userData.muzzleMarker = muzzleMarker;
    gunRoot.userData.backblastMarker = backblastMarker;
    gunRoot.userData._isModel = true;
    gunRoot.userData._baseLength = modelLength;

    this.view.add(gunRoot);
    this.models.rocket = gunRoot;

    console.info(
      `[Viewmodel] Ракетница загружена из rocket.glb: длина=${modelLength.toFixed(2)} у.е., масштаб=${baseScale.toFixed(4)}, итого=${(modelLength * baseScale).toFixed(2)} м`
    );
  }

  /**
   * Запасная процедурная модель ракетницы (если rocket.glb не загрузилась или useModel = false)
   * @private
   */
  _buildRocketProcedural(isPsx, part, box, cyl, cone, sph, mkHand, H) {
    const tubeCol = isPsx ? 0xc25e26 : 0xff9f1c;
    const boreCol = isPsx ? 0x3e444c : 0x3a3a3a;
    const coneCol = isPsx ? 0x8a4528 : 0xff4f8b;
    const finCol = isPsx ? 0x544c66 : 0x7c5cff;
    const rearCol = isPsx ? 0x663e26 : 0x8b4513;
    const nozzleCol = isPsx ? 0x424654 : 0x2a2a3a;
    const sightRailCol = isPsx ? 0x505864 : 0x555568;
    const sightPostCol = isPsx ? 0x9a7032 : 0xffd23f;
    const gripCol = isPsx ? 0x383c44 : 0x1b1340;
    const guardCol = isPsx ? 0x8e5c26 : 0xffd23f;

    const g = new THREE.Group();
    g.add(part(cyl(0.115, 0.88, 16), tubeCol, 0, 0.02, -0.38, H));
    g.add(part(cyl(0.09, 0.9, 16), boreCol, 0, 0.02, -0.38, H));
    g.add(part(cone(0.075, 0.18), coneCol, 0, 0.02, -0.86, -H));
    g.add(part(cyl(0.065, 0.14), coneCol, 0, 0.02, -0.76, H));
    g.add(part(box(0.16, 0.018, 0.06), finCol, 0, 0.02, -0.68));
    g.add(part(box(0.018, 0.16, 0.06), finCol, 0, 0.02, -0.68));
    g.add(part(cyl(0.125, 0.05, 16), rearCol, 0, 0.02, 0.08, H));
    g.add(part(cyl(0.095, 0.04, 16), nozzleCol, 0, 0.02, 0.11, H));
    g.add(part(box(0.028, 0.028, 0.38), sightRailCol, 0, 0.155, -0.28));
    g.add(part(box(0.018, 0.045, 0.018), sightPostCol, 0, 0.19, -0.48));
    g.add(part(box(0.035, 0.035, 0.018), sightPostCol, 0, 0.185, -0.08));
    g.add(part(box(0.075, 0.15, 0.055), gripCol, 0, -0.1, -0.48));
    g.add(part(box(0.075, 0.17, 0.075), gripCol, 0, -0.11, 0.02));
    g.add(part(box(0.018, 0.035, 0.055), guardCol, 0.125, 0.02, -0.13));
    g.add(part(box(0.018, 0.035, 0.055), guardCol, -0.125, 0.02, -0.13));
    g.add(mkHand(0, -0.1, -0.48, 0.3));
    g.add(mkHand(0, -0.15, 0.02, 0.2));

    const flash = new THREE.Mesh(sph(0.15), new THREE.MeshBasicMaterial({ color: isPsx ? 0xffc566 : 0xfff1a0 }));
    flash.position.set(0, 0.02, -0.92);
    flash.visible = false;
    flash.renderOrder = 999;
    g.add(flash);
    g.visible = this.currentWeaponId === "rocket";
    g.userData.flash = flash;
    this.view.add(g);
    this.models.rocket = g;
  }

  /**
   * Вспомогательный fallback для процедурной ракетницы
   * @private
   */
  _buildRocketProceduralFallback() {
    const isPsx = (CONFIG.graphics && CONFIG.graphics.styleName) !== "cartoon";
    const mat = (col) => createToonMaterial(col);
    const part = (geo, col, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = outlined(geo, mat(col));
      m.position.set(x, y, z);
      if (rx || ry || rz) m.rotation.set(rx, ry, rz);
      m.renderOrder = 999;
      return m;
    };
    const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const cyl = (r, l, seg = 12) => new THREE.CylinderGeometry(r, r, l, seg);
    const cone = (r, h, seg = 12) => new THREE.ConeGeometry(r, h, seg);
    const sph = (r) => new THREE.SphereGeometry(r, 10, 8);
    const mkHand = (x, y, z, rz = 0) => {
      const g = new THREE.Group();
      const palm = outlined(box(0.08, 0.075, 0.1), mat(0x2e2e36));
      palm.renderOrder = 999;
      g.add(palm);
      g.position.set(x, y, z);
      if (rz) g.rotation.z = rz;
      return g;
    };
    this._buildRocketProcedural(isPsx, part, box, cyl, cone, sph, mkHand, Math.PI / 2);
  }

  /**
   * Пул из 10 гильз дробовика (Requirement 2).
   * Гильзы живут в wScene (вьюмодель), используют геометрию Tactical_Shell из shotgun.glb.
   * Никаких новых мешей на каждый выстрел.
   * @private
   */
  _initShellPool() {
    let shellGeo = null;
    let shellMat = null;
    let isAmmoCasing = false;

    const casingTpl = getCasingTemplate("shotgun");
    if (casingTpl) {
      shellGeo = casingTpl.geometry;
      shellMat = casingTpl.material;
      isAmmoCasing = true;
    } else if (hasShotgunModel()) {
      const shellNode = getNodeClone("shotgun", "Tactical_Shell");
      if (shellNode && shellNode.geometry) {
        shellGeo = shellNode.geometry;
        shellMat = shellNode.material;
      }
    }
    if (!shellGeo) {
      shellGeo = new THREE.CylinderGeometry(1.5, 1.5, 6.0, 8);
      shellGeo.userData.shared = true;
      shellMat = new THREE.MeshStandardMaterial({ color: 0xb52222, roughness: 0.5, metalness: 0.3 });
      shellMat.userData.shared = true;
    }

    if (this.shellPool && this.shellPool.length === 10) {
      for (const s of this.shellPool) {
        s.mesh.geometry = shellGeo;
        s.mesh.material = shellMat;
        s.mesh.userData.isAmmoCasing = isAmmoCasing;
        s.mesh.visible = false;
        s.life = 0;
      }
      return;
    }

    this.shellPool = [];
    this.shellIndex = 0;
    this.pendingShells = [];
    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(shellGeo, shellMat);
      mesh.userData.isAmmoCasing = isAmmoCasing;
      mesh.visible = false;
      mesh.renderOrder = 998;
      this.wScene.add(mesh);
      this.shellPool.push({
        mesh,
        vel: new THREE.Vector3(),
        rotVel: new THREE.Vector3(),
        life: 0,
        soundPlayed: false
      });
    }
  }

  /**
   * Пул из 30 гильз АК-47 в wScene (общие геометрия и материал из ammo.glb, без утечек).
   * @private
   */
  _initAkShellPool() {
    let shellGeo = null;
    let shellMat = null;
    let isAmmoCasing = false;

    const casingTpl = getCasingTemplate("ak47");
    if (casingTpl) {
      shellGeo = casingTpl.geometry;
      shellMat = casingTpl.material;
      isAmmoCasing = true;
    } else {
      shellGeo = new THREE.CylinderGeometry(0.0045, 0.0048, 0.024, 6);
      shellGeo.userData.shared = true;
      shellMat = new THREE.MeshLambertMaterial({
        color: 0xd4af37,
        emissive: 0x3a2a00,
        emissiveIntensity: 0.25
      });
      shellMat.userData.shared = true;
    }

    if (this.akShellPool && this.akShellPool.length === 30) {
      for (const s of this.akShellPool) {
        s.mesh.geometry = shellGeo;
        s.mesh.material = shellMat;
        s.mesh.userData.isAmmoCasing = isAmmoCasing;
        s.mesh.visible = false;
        s.life = 0;
      }
      return;
    }

    this.akShellPool = [];
    this.akShellIndex = 0;
    for (let i = 0; i < 30; i++) {
      const mesh = new THREE.Mesh(shellGeo, shellMat);
      mesh.userData.isAmmoCasing = isAmmoCasing;
      mesh.visible = false;
      mesh.renderOrder = 998;
      this.wScene.add(mesh);
      this.akShellPool.push({
        mesh,
        vel: new THREE.Vector3(),
        rotVel: new THREE.Vector3(),
        life: 0,
        maxLife: 0.9,
        soundPlayed: false
      });
    }
  }

  /**
   * Пул из 10 клубов дымка у дула АК-47 в wScene (общая геометрия, без роста числа объектов).
   * @private
   */
  _initAkSmokePool() {
    if (this.akSmokePool && this.akSmokePool.length === 10) {
      for (const p of this.akSmokePool) {
        p.mesh.visible = false;
        p.life = 0;
      }
      return;
    }

    const smokeGeo = new THREE.SphereGeometry(0.016, 6, 5);
    smokeGeo.userData.shared = true;

    this.akSmokePool = [];
    this.akSmokeIndex = 0;
    for (let i = 0; i < 10; i++) {
      const smokeMat = new THREE.MeshBasicMaterial({
        color: 0xd0d0d0,
        transparent: true,
        opacity: 0.35,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(smokeGeo, smokeMat);
      mesh.visible = false;
      mesh.renderOrder = 997;
      this.wScene.add(mesh);
      this.akSmokePool.push({
        mesh,
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 0.45
      });
    }
  }

  /**
   * Пулы тёплого дымка у дула (0.1 с) и облака заднего выхлопа (0.5 с) ракетницы в wScene.
   * @private
   */
  _initRocketPools() {
    if (this.rocketSmokePool && this.rocketSmokePool.length === 6) {
      for (const p of this.rocketSmokePool) {
        p.mesh.visible = false;
        p.life = 0;
      }
    } else {
      const geo = new THREE.SphereGeometry(0.04, 6, 5);
      geo.userData.shared = true;
      this.rocketSmokePool = [];
      this.rocketSmokeIndex = 0;
      for (let i = 0; i < 6; i++) {
        const mat = new THREE.MeshBasicMaterial({
          color: 0xffd2a0,
          transparent: true,
          opacity: 0.5,
          depthWrite: false
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.visible = false;
        mesh.renderOrder = 997;
        this.wScene.add(mesh);
        this.rocketSmokePool.push({ mesh, vel: new THREE.Vector3(), life: 0, maxLife: 0.1 });
      }
    }

    if (this.rocketBackblastPool && this.rocketBackblastPool.length === 8) {
      for (const p of this.rocketBackblastPool) {
        p.mesh.visible = false;
        p.life = 0;
      }
    } else {
      const bbGeo = new THREE.SphereGeometry(0.065, 6, 5);
      bbGeo.userData.shared = true;
      this.rocketBackblastPool = [];
      this.rocketBackblastIndex = 0;
      for (let i = 0; i < 8; i++) {
        const mat = new THREE.MeshBasicMaterial({
          color: i % 2 === 0 ? 0xd8d6e0 : 0xffb86c,
          transparent: true,
          opacity: 0.45,
          depthWrite: false
        });
        const mesh = new THREE.Mesh(bbGeo, mat);
        mesh.visible = false;
        mesh.renderOrder = 996;
        this.wScene.add(mesh);
        this.rocketBackblastPool.push({ mesh, vel: new THREE.Vector3(), life: 0, maxLife: 0.5 });
      }
    }
  }

  /**
   * Вызывается, когда initAllModels() завершился: если дробовик был собран
   * процедурно, а модель shotgun.glb уже загрузилась, перестраиваем вьюмодель
   * на 3D-модели.
   */
  onModelsReady() {
    this._initShellPool();
    this._initAkShellPool();

    if (CONFIG.viewmodel?.arms?.useModel !== false && hasArmsModel()) {
      if (!this.armsState) this._buildArmsModel();
      if (!this.bakedArms || Object.keys(this.bakedArms).length === 0) {
        this._bakeAllWeaponArms();
      }
    }

    const sgCfg = CONFIG.viewmodel?.shotgun || {};
    if (sgCfg.useModel === false) return;
    if (!hasShotgunModel()) return;
    // Если текущая модель дробовика — процедурная (нет флага _isModel), пересобираем
    const current = this.models.shotgun;
    if (current && current.userData && current.userData._isModel) return;
    this.buildModels();
  }

  /**
   * Процедурная вьюмодель дробовика (запасный вариант, если shotgun.glb не загружена или useModel=false).
   * @param {boolean} isPsx
   * @private
   */
  _buildShotgunProcedural(isPsx) {
    const H = Math.PI / 2;
    const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const cyl = (r, l, s) => new THREE.CylinderGeometry(r, r, l, s || 12);
    const sph = (r) => new THREE.SphereGeometry(r, 10, 8);

    const part = (geo, color, x, y, z, rx, ry, rz) => {
      const mat = createToonMaterial(color, {
        excludeSnap: true,
        emissive: 0x222222,
        emissiveIntensity: 0.12
      });
      mat.depthTest = true;
      mat.depthWrite = true;
      const m = isPsx ? new THREE.Mesh(geo, mat) : outlined(geo, mat);
      m.renderOrder = 999;
      m.position.set(x, y, z);
      if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
      return m;
    };

    const mkHand = (x, y, z, rx, ry, rz) => {
      const sgCfg = CONFIG.viewmodel?.shotgun || {};
      const hands = sgCfg.hands || {};
      const handSide = (x < 0 || z > 0) ? "left" : "right";
      const h = hands[handSide] || { x, y, z };
      const r = hands[handSide]?.rot || { x: rx || 0, y: ry || 0, z: rz || 0 };

      const hg = new THREE.Group();
      const skinColor = isPsx ? 0xc8a488 : 0xf5c6a0;
      const cuffColor = isPsx ? 0x383c44 : 0xffffff;

      const handMat = createToonMaterial(skinColor, {
        excludeSnap: true,
        emissive: 0x222222,
        emissiveIntensity: 0.12
      });
      handMat.depthTest = true;
      handMat.depthWrite = true;
      const handMesh = isPsx
        ? new THREE.Mesh(box(0.11, 0.12, 0.14), handMat)
        : outlined(box(0.11, 0.12, 0.14), handMat);
      handMesh.renderOrder = 999;
      hg.add(handMesh);

      const cuffMat = createToonMaterial(cuffColor, {
        excludeSnap: true,
        emissive: 0x222222,
        emissiveIntensity: 0.12
      });
      cuffMat.depthTest = true;
      cuffMat.depthWrite = true;
      const cuff = isPsx
        ? new THREE.Mesh(box(0.12, 0.035, 0.15), cuffMat)
        : outlined(box(0.12, 0.035, 0.15), cuffMat);
      cuff.renderOrder = 999;
      cuff.position.y = 0.078;
      hg.add(cuff);

      const thumbMat = createToonMaterial(skinColor, {
        excludeSnap: true,
        emissive: 0x222222,
        emissiveIntensity: 0.12
      });
      thumbMat.depthTest = true;
      thumbMat.depthWrite = true;
      const thumb = isPsx
        ? new THREE.Mesh(box(0.04, 0.055, 0.04), thumbMat)
        : outlined(box(0.04, 0.055, 0.04), thumbMat);
      thumb.renderOrder = 999;
      thumb.position.set(0.065, -0.01, -0.04);
      hg.add(thumb);

      hg.position.set(h.x, h.y, h.z);
      hg.rotation.set(r.x, r.y, r.z);
      return hg;
    };

    const barrelCol = isPsx ? 0x4a525d : 0x9aa5b1;
    const magCol = isPsx ? 0x3e444c : 0x8a8e96;
    const beadCol = isPsx ? 0x926c2e : 0xffd23f;
    const frontSightCol = isPsx ? 0x8a3838 : 0xff4f8b;
    const receiverCol = isPsx ? 0x424750 : 0x6a6580;
    const woodForendCol = isPsx ? 0x6e472a : 0xb5651d;
    const woodStockCol = isPsx ? 0x54361e : 0x8b4513;
    const gripCol = isPsx ? 0x383c44 : 0x1b1340;
    const metalTrigCol = isPsx ? 0x4a525d : 0x4a4a4a;

    const g = new THREE.Group();
    g.add(part(cyl(0.032, 0.72), barrelCol, -0.032, 0.025, -0.5, H));
    g.add(part(cyl(0.032, 0.72), barrelCol, 0.032, 0.025, -0.5, H));
    g.add(part(cyl(0.028, 0.45, 10), magCol, 0, -0.025, -0.4, H));
    g.add(part(cyl(0.052, 0.025), beadCol, 0, 0.025, -0.68, H));
    g.add(part(box(0.018, 0.04, 0.018), frontSightCol, 0, 0.068, -0.82));
    g.add(part(box(0.13, 0.11, 0.2), receiverCol, 0, 0.01, -0.14));
    const forend = part(box(0.11, 0.09, 0.16), woodForendCol, 0, -0.04, -0.42);
    forend.name = "Tactical_Handguard_V1";
    g.add(forend);
    this.handguardNode = forend;
    this.handguardBasePos.set(0, -0.04, -0.42);
    g.add(part(box(0.12, 0.03, 0.08), woodStockCol, 0, -0.065, -0.48));
    g.add(part(box(0.1, 0.09, 0.25), woodForendCol, 0, -0.01, 0.14));
    g.add(part(box(0.1, 0.09, 0.025), metalTrigCol, 0, -0.01, 0.27));
    g.add(part(box(0.085, 0.17, 0.09), gripCol, 0, -0.12, -0.01));
    g.add(part(box(0.055, 0.018, 0.09), metalTrigCol, 0, -0.17, -0.06));
    g.add(part(box(0.035, 0.035, 0.05), metalTrigCol, 0.058, 0.055, -0.08));
    g.add(mkHand(0, -0.08, -0.44, 0.3));
    g.add(mkHand(0, -0.15, 0.01, 0.2));

    const flash = new THREE.Mesh(sph(0.13), new THREE.MeshBasicMaterial({ color: isPsx ? 0xffdf80 : 0xfff1a0 }));
    flash.position.set(0, 0.025, -0.88);
    flash.visible = false;
    flash.renderOrder = 999;
    g.add(flash);
    g.visible = this.currentWeaponId === "shotgun";
    g.userData.flash = flash;

    // Маркеры дула и выброса для процедурного дробовика
    const muzzleMarker = new THREE.Mesh(sph(0.035), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    muzzleMarker.name = "muzzleMarker";
    muzzleMarker.position.set(0, 0.025, -0.88);
    muzzleMarker.visible = false;
    g.add(muzzleMarker);
    g.userData.muzzleMarker = muzzleMarker;

    const ejectMarker = new THREE.Mesh(sph(0.03), new THREE.MeshBasicMaterial({ color: 0x22ff44 }));
    ejectMarker.name = "ejectMarker";
    ejectMarker.position.set(0.08, 0.01, -0.14);
    ejectMarker.visible = false;
    g.add(ejectMarker);
    g.userData.ejectMarker = ejectMarker;

    this.view.add(g);
    this.models.shotgun = g;
  }

  switchWeapon(weaponId) {
    const changed = this.currentWeaponId !== weaponId;
    this.currentWeaponId = weaponId;
    const hideWeapons = !!CONFIG.viewmodel?.arms?.hideWeaponsForTest;
    for (const id in this.models) {
      this.models[id].visible = !hideWeapons && id === weaponId;
      if (this.models[id].userData && this.models[id].userData.flash) {
        this.models[id].userData.flash.visible = false;
      }
    }
    this.appear = 0;
    if (changed && this.armsState) {
      _ikPrevR.copy(_ikBlendR);
      _ikPrevL.copy(_ikBlendL);
      this.armsTargetLerp = 0;
    }
    this.flashT = 0;
    this.lightT = 0;
    this.akShakeT = 0;
    this.rocketClickTimer = 0;
    this.pumpActive = false;
    this.pumpTimer = 0;
    if (this.handguardNode && this.handguardBasePos) {
      this.handguardNode.position.copy(this.handguardBasePos);
    }
    this.pendingShells = [];

    if ((CONFIG.viewmodel?.arms?.mode || "baked") === "baked" && this.bakedArms?.[weaponId]) {
      const pair = this.bakedArms[weaponId];
      this.armsReach.right = pair.right ? !!pair.right.reachable : true;
      this.armsReach.left = pair.left ? !!pair.left.reachable : true;
    }
    this._syncArmsVisibility();
  }

  /**
   * Получить координаты точки дула в мировом пространстве
   * @param {THREE.Vector3} [out]
   * @returns {THREE.Vector3}
   */
  getMuzzleWorldPosition(out = new THREE.Vector3()) {
    const curModel = this.models[this.currentWeaponId];
    if (curModel && curModel.userData.flash) {
      _tmpMuzzleW.set(0, 0, 0);
      curModel.userData.flash.getWorldPosition(_tmpMuzzleW);
      this.mainCamera.getWorldDirection(_dir);
      _right.set(1, 0, 0).applyQuaternion(this.mainCamera.quaternion);
      _up.set(0, 1, 0).applyQuaternion(this.mainCamera.quaternion);
      return out
        .copy(this.mainCamera.position)
        .addScaledVector(_right, _tmpMuzzleW.x)
        .addScaledVector(_up, _tmpMuzzleW.y)
        .addScaledVector(_dir, -_tmpMuzzleW.z);
    }
    this.mainCamera.getWorldDirection(_dir);
    _right.set(1, 0, 0).applyQuaternion(this.mainCamera.quaternion);
    _up.set(0, 1, 0).applyQuaternion(this.mainCamera.quaternion);
    return out
      .copy(this.mainCamera.position)
      .addScaledVector(_dir, 0.9)
      .addScaledVector(_right, 0.3)
      .addScaledVector(_up, -0.2);
  }

  /**
   * Получить координаты точки заднего выхлопа (backblast) в мировом пространстве
   * @param {THREE.Vector3} [out]
   * @returns {THREE.Vector3}
   */
  getBackblastWorldPosition(out = new THREE.Vector3()) {
    const curModel = this.models[this.currentWeaponId];
    if (curModel && curModel.userData.backblastMarker) {
      _tmpEjectW.set(0, 0, 0);
      curModel.userData.backblastMarker.getWorldPosition(_tmpEjectW);
      this.mainCamera.getWorldDirection(_dir);
      _right.set(1, 0, 0).applyQuaternion(this.mainCamera.quaternion);
      _up.set(0, 1, 0).applyQuaternion(this.mainCamera.quaternion);
      return out
        .copy(this.mainCamera.position)
        .addScaledVector(_right, _tmpEjectW.x)
        .addScaledVector(_up, _tmpEjectW.y)
        .addScaledVector(_dir, -_tmpEjectW.z);
    }
    this.mainCamera.getWorldDirection(_dir);
    _right.set(1, 0, 0).applyQuaternion(this.mainCamera.quaternion);
    _up.set(0, 1, 0).applyQuaternion(this.mainCamera.quaternion);
    return out
      .copy(this.mainCamera.position)
      .addScaledVector(_dir, 0.1)
      .addScaledVector(_right, 0.35)
      .addScaledVector(_up, -0.22);
  }

  triggerFlash(kickBack, weaponId = null) {
    const wId = weaponId || this.currentWeaponId;
    this.kick = kickBack;
    if (wId === "ak47") {
      // Короткая вспышка 0.04 с без накопления и мерцания на весь экран
      this.flashT = 0.04;
      this.flashMaxT = 0.04;
      this.lightT = 0.045;
      this.lightMaxT = 0.045;
      const akModel = this.models.ak47;
      if (akModel && akModel.userData.flash) {
        akModel.userData.flash.rotation.z = Math.random() * Math.PI * 2;
      }
    } else if (wId === "rocket") {
      this.flashT = 0.1;
      this.flashMaxT = 0.1;
      this.lightT = 0.16;
      this.lightMaxT = 0.16;
      this.akShakeT = 0.14;
      this.rocketClickTimer = 0.28;
      const rlModel = this.models.rocket;
      if (rlModel && rlModel.userData.flash) {
        rlModel.userData.flash.rotation.z = Math.random() * Math.PI * 2;
      }
    } else {
      this.flashT = CONFIG.combat.flashDuration;
      this.flashMaxT = CONFIG.combat.flashDuration;
      this.lightT = CONFIG.combat.lightDuration;
      this.lightMaxT = CONFIG.combat.lightDuration;
    }
    if (wId) {
      this.triggerRecoil(wId);
    }
    if (wId === "shotgun") {
      this.triggerShotgunEffects();
    } else if (wId === "ak47") {
      this.triggerAk47Effects();
    } else if (wId === "rocket") {
      this.triggerRocketEffects();
    }
  }

  /**
   * Эффекты выстрела ракетницы в wScene:
   * 1. Тёплый дымок у дула на 0.1 с
   * 2. Облако заднего выхлопа (backblast) у границы экрана на 0.5 с
   */
  triggerRocketEffects() {
    const rl = this.models.rocket;
    if (!rl || !rl.visible) return;

    // 1. Тёплый дымок у дула (0.1 с)
    if (this.rocketSmokePool && this.rocketSmokePool.length > 0 && rl.userData.flash) {
      rl.updateMatrixWorld(true);
      _tmpMuzzleW.set(0, 0, 0);
      rl.userData.flash.getWorldPosition(_tmpMuzzleW);
      for (let i = 0; i < 2; i++) {
        const p = this.rocketSmokePool[this.rocketSmokeIndex];
        this.rocketSmokeIndex = (this.rocketSmokeIndex + 1) % this.rocketSmokePool.length;
        p.mesh.position.copy(_tmpMuzzleW);
        p.mesh.scale.setScalar(1.0);
        p.mesh.material.opacity = 0.5;
        p.vel.set((Math.random() - 0.5) * 0.4, 0.3 + Math.random() * 0.3, -1.2 - Math.random() * 0.5);
        p.life = 0.1;
        p.maxLife = 0.1;
        p.mesh.visible = true;
      }
    }

    // 2. Часть облака заднего выхлопа у границы экрана (0.5 с)
    if (this.rocketBackblastPool && this.rocketBackblastPool.length > 0) {
      rl.updateMatrixWorld(true);
      if (rl.userData.backblastMarker) {
        _tmpEjectW.set(0, 0, 0);
        rl.userData.backblastMarker.getWorldPosition(_tmpEjectW);
      } else {
        _tmpEjectW.set(0.35, -0.22, 0.15);
      }
      for (let i = 0; i < 3; i++) {
        const b = this.rocketBackblastPool[this.rocketBackblastIndex];
        this.rocketBackblastIndex = (this.rocketBackblastIndex + 1) % this.rocketBackblastPool.length;
        b.mesh.position.set(
          _tmpEjectW.x + (Math.random() - 0.5) * 0.08,
          _tmpEjectW.y + (Math.random() - 0.5) * 0.08,
          Math.min(-0.25, _tmpEjectW.z)
        );
        b.mesh.scale.setScalar(1.0);
        b.mesh.material.opacity = 0.42;
        b.vel.set((Math.random() - 0.5) * 0.25, 0.15 + Math.random() * 0.2, 0.25 + Math.random() * 0.2);
        b.life = 0.5;
        b.maxLife = 0.5;
        b.mesh.visible = true;
      }
    }
  }

  /**
   * Эффекты выстрела АК-47:
   * 1. Выброс латунной гильзы из окна выброса (пул 30 шт)
   * 2. Дымок у дула раз в 3 выстрела (пул 10 шт)
   * 3. Лёгкая тряска вьюмодели
   */
  triggerAk47Effects() {
    this.akShotCount++;
    this.akShakeT = 0.07;
    this._spawnAk47Shell();
    if (this.akShotCount % 3 === 0) {
      this._spawnAk47Smoke();
    }
  }

  /**
   * Выброс латунной гильзы АК-47 из пула в wScene
   * @private
   */
  _spawnAk47Shell() {
    if (!this.akShellPool || this.akShellPool.length === 0) return;
    const ak = this.models.ak47;
    if (!ak || !ak.visible) return;

    const s = this.akShellPool[this.akShellIndex];
    this.akShellIndex = (this.akShellIndex + 1) % this.akShellPool.length;

    const cfg = CONFIG.viewmodel?.ak47 || {};
    const isModel = !!ak.userData._isModel;
    const gunNode = (ak.userData && ak.userData.gunRoot) || ak;
    if (ak.userData.ejectMarker) {
      ak.updateMatrixWorld(true);
      _tmpEjectW.set(0, 0, 0);
      ak.userData.ejectMarker.getWorldPosition(_tmpEjectW);
    } else {
      const ej = isModel ? (cfg.eject || { x: 0.05, y: 0.05, z: 0.03 }) : { x: 0.05, y: 0.02, z: -0.1 };
      gunNode.updateMatrixWorld(true);
      _tmpEjectW.set(ej.x, ej.y, ej.z);
      gunNode.localToWorld(_tmpEjectW);
    }

    s.mesh.position.copy(_tmpEjectW);
    const shellScaleMult = (cfg.shell && cfg.shell.scale != null) ? cfg.shell.scale : 1.0;
    s.mesh.scale.setScalar(s.mesh.userData.isAmmoCasing ? 1.0 : shellScaleMult);
    s.mesh.quaternion.copy(gunNode.quaternion);

    const side = (cfg.eject && cfg.eject.side != null) ? cfg.eject.side : 1;
    // Вылетает вправо и вверх с вращением
    s.vel.set(
      side * (1.25 + (Math.random() - 0.5) * 0.25),
      1.1 + (Math.random() - 0.5) * 0.25,
      0.2 + (Math.random() - 0.5) * 0.15
    );
    s.rotVel.set(
      18 + (Math.random() - 0.5) * 10,
      14 + (Math.random() - 0.5) * 8,
      16 + (Math.random() - 0.5) * 10
    );
    s.life = 0.9;
    s.maxLife = 0.9;
    s.soundPlayed = false;
    s.mesh.visible = true;
  }

  /**
   * Дымок у дула АК-47 из пула в wScene (раз в 3 выстрела)
   * @private
   */
  _spawnAk47Smoke() {
    if (!this.akSmokePool || this.akSmokePool.length === 0) return;
    const ak = this.models.ak47;
    if (!ak || !ak.visible) return;

    const p = this.akSmokePool[this.akSmokeIndex];
    this.akSmokeIndex = (this.akSmokeIndex + 1) % this.akSmokePool.length;

    const cfg = CONFIG.viewmodel?.ak47 || {};
    const isModel = !!ak.userData._isModel;
    if (ak.userData.flash) {
      ak.userData.flash.updateMatrixWorld(true);
      _tmpMuzzleW.set(0, 0, 0);
      ak.userData.flash.getWorldPosition(_tmpMuzzleW);
    } else {
      const gunNode = (ak.userData && ak.userData.gunRoot) || ak;
      const muz = isModel ? (cfg.muzzle || { x: 0.52, y: 0.04, z: 0 }) : { x: 0, y: 0.02, z: -0.66 };
      gunNode.updateMatrixWorld(true);
      _tmpMuzzleW.set(muz.x, muz.y, muz.z);
      gunNode.localToWorld(_tmpMuzzleW);
    }

    p.mesh.position.copy(_tmpMuzzleW);
    p.mesh.scale.setScalar(1.0);
    p.mesh.material.opacity = 0.35;
    p.vel.set(
      (Math.random() - 0.5) * 0.08,
      0.35 + Math.random() * 0.12,
      -0.25 - Math.random() * 0.1
    );
    p.life = 0.45;
    p.maxLife = 0.45;
    p.mesh.visible = true;
  }

  /**
   * Специфичные эффекты выстрела дробовика:
   * 1. Откат цевья назад по оси ствола с пружинным возвратом
   * 2. Выброс гильзы из окна выброса с задержкой 0.12 с
   */
  triggerShotgunEffects() {
    this.pumpActive = true;
    this.pumpTimer = 0;
    if (!this.pendingShells) this.pendingShells = [];
    this.pendingShells.push(0.12);
  }

  /**
   * Создание вылетающей гильзы из пула в wScene
   * @private
   */
  _spawnShotgunShell() {
    if (!this.shellPool || this.shellPool.length === 0) return;
    const sg = this.models.shotgun;
    if (!sg || !sg.visible) return;

    const s = this.shellPool[this.shellIndex];
    this.shellIndex = (this.shellIndex + 1) % this.shellPool.length;

    const cfg = CONFIG.viewmodel?.shotgun || {};
    const isModel = !!sg.userData._isModel;
    const ej = isModel ? (cfg.eject || { x: 15, y: 6, z: 25 }) : { x: 0.08, y: 0.01, z: -0.14 };

    // Позиция окна выброса в координатах wScene
    sg.updateMatrixWorld(true);
    _tmpEjectW.set(ej.x, ej.y, ej.z);
    sg.localToWorld(_tmpEjectW);

    s.mesh.position.copy(_tmpEjectW);
    const side = (cfg.eject && cfg.eject.side != null) ? cfg.eject.side : 1; // 1: вправо, -1: влево
    if (s.mesh.userData.isAmmoCasing) {
      s.mesh.scale.setScalar(1.0);
    } else {
      const shellScaleMult = (cfg.shell && cfg.shell.scale != null) ? cfg.shell.scale : (cfg.shellScale ?? 1.0);
      const baseScale = isModel ? sg.scale.x : 0.00627;
      s.mesh.scale.setScalar(baseScale * shellScaleMult);
    }
    s.mesh.quaternion.copy(sg.quaternion);

    // Вылетает вбок (side = 1 вправо, side = -1 влево) и вверх (+Y) с вращением
    s.vel.set(
      side * (1.35 + (Math.random() - 0.5) * 0.3),
      1.15 + (Math.random() - 0.5) * 0.3,
      0.35 + (Math.random() - 0.5) * 0.2
    );
    s.rotVel.set(
      14 + (Math.random() - 0.5) * 10,
      10 + (Math.random() - 0.5) * 8,
      12 + (Math.random() - 0.5) * 10
    );
    s.life = 1.2;
    s.soundPlayed = false;
    s.mesh.visible = true;
  }

  /**
   * Отставание (sway / lag) оружия при быстром повороте камеры мышью
   * @param {number} dx
   * @param {number} dy
   */
  addSway(dx, dy) {
    const feel = CONFIG.feel && CONFIG.feel.weapon ? CONFIG.feel.weapon : {};
    const mult = (CONFIG.feel && CONFIG.feel.reduced ? 0.5 : 1.0) * (feel.swayAmount || 0.0018);
    const max = feel.swayMax || 0.05;
    this.swayX = Math.max(-max, Math.min(max, this.swayX - dx * mult));
    this.swayY = Math.max(-max, Math.min(max, this.swayY + dy * mult));
  }

  /**
   * Откат по оси Z и наклон по X/Z с возвратом по пружине (Spring recoil)
   * @param {string} weaponId
   */
  triggerRecoil(weaponId) {
    const feel = CONFIG.feel && CONFIG.feel.weapon ? CONFIG.feel.weapon : {};
    const feelMult =
      (CONFIG.feel && CONFIG.feel.reduced ? 0.4 : 1.0) *
      ((CONFIG.feel && CONFIG.feel.intensity) || 1.0);

    if (weaponId === "ak47") {
      // Отдача АК-47: откат 0.03 м и подъём дула 2°, в серии накапливается до 0.06 м и 5°
      const deg2Rad = (2 * Math.PI) / 180;
      const maxPos = 0.06;
      const maxRot = (5 * Math.PI) / 180;
      this.recoilPos.z = Math.min(maxPos, this.recoilPos.z + 0.03 * feelMult);
      this.recoilRot.x = Math.min(maxRot, this.recoilRot.x + deg2Rad * feelMult);
      this.recoilVel.z = Math.min(0.45, this.recoilVel.z + 0.25 * feelMult);
      this.recoilRotVel.x = Math.min(0.6, this.recoilRotVel.x + 0.3 * feelMult);
      this.recoilRotVel.z += (Math.random() - 0.5) * 0.2 * feelMult;
      return;
    }

    if (weaponId === "rocket") {
      // Тяжёлый удар ракетницы в плечо и задирание трубы вверх
      this.recoilVel.z += 1.65 * feelMult;
      this.recoilRotVel.x += 1.45 * feelMult;
      this.recoilRotVel.z += 0.35 * feelMult;
      return;
    }

    const kickZ = ((feel.kickZ && feel.kickZ[weaponId]) || 0.15) * feelMult;
    const rotX = ((feel.rotX && feel.rotX[weaponId]) || 0.12) * feelMult;
    const rotZ =
      (weaponId === "shotgun" ? 0.03 : 0.04) * feelMult;

    // Импульс скорости отдачи по пружине
    this.recoilVel.z += kickZ * 12;
    this.recoilRotVel.x += rotX * 14;
    this.recoilRotVel.z += rotZ * 10;
  }

  /**
   * Базовая позиция this.view для текущего оружия.
   * Дробовик-модель использует cfg.pos, остальные — стандартные значения.
   * @returns {{x: number, y: number, z: number}}
   * @private
   */
  _getWeaponBasePos(weaponId = this.currentWeaponId) {
    const wCfg = CONFIG.viewmodel?.[weaponId];
    if (wCfg && wCfg.useModel !== false && this.models[weaponId]?.userData?._isModel) {
      return { x: wCfg.pos?.x ?? 0.28, y: wCfg.pos?.y ?? -0.24, z: wCfg.pos?.z ?? -0.46 };
    }
    return { x: 0.28, y: -0.24, z: -0.46 };
  }

  /**
   * Поза добивания — оружие подтягивается к центру экрана.
   * Целевая позиция — смещение от базовой позиции текущего оружия.
   * @param {string} weaponId
   * @param {number} [duration=0.2]
   */
  playGloryPose(weaponId, duration = 0.2) {
    this.gloryPose.active = true;
    this.gloryPose.returning = false;
    this.gloryPose.weaponId = weaponId;
    this.gloryPose.duration = Math.max(0.01, duration);
    this.gloryPose.timer = 0;
    this.gloryPose.startPos.copy(this.view.position);
    this.gloryPose.startRot.copy(this.view.rotation);

    const base = this._getWeaponBasePos();
    const wCfg = CONFIG.viewmodel?.[weaponId];
    if (wCfg && wCfg.glory) {
      this.gloryPose.targetPos.set(
        wCfg.glory.pos?.x ?? (base.x - 0.23),
        wCfg.glory.pos?.y ?? (base.y + 0.14),
        wCfg.glory.pos?.z ?? (base.z - 0.29)
      );
      this.gloryPose.targetRot.set(
        wCfg.glory.rot?.x ?? 0.04,
        wCfg.glory.rot?.y ?? 0,
        wCfg.glory.rot?.z ?? 0
      );
    } else {
      this.gloryPose.targetPos.set(base.x - 0.23, base.y + 0.14, base.z - 0.29);
      this.gloryPose.targetRot.set(0.04, 0, 0);
    }
  }

  /**
   * Завершение позы добивания — оружие возвращается в базовую позицию текущего оружия
   * @param {number} [duration=0.15]
   */
  endGloryPose(duration = 0.15) {
    if (!this.gloryPose.active) return;
    this.gloryPose.active = false;
    this.gloryPose.returning = true;
    this.gloryPose.returnDuration = Math.max(0.01, duration);
    this.gloryPose.returnTimer = 0;
    this.gloryPose.startPos.copy(this.view.position);
    this.gloryPose.startRot.copy(this.view.rotation);
    const base = this._getWeaponBasePos();
    this.gloryPose.targetPos.set(base.x, base.y, base.z);
    this.gloryPose.targetRot.set(0, 0, 0);
  }

  update(dt, player, currentWeaponId, isGloryActive = false) {
    const feel = CONFIG.feel && CONFIG.feel.weapon ? CONFIG.feel.weapon : {};
    const feelWpn = feel;

    // Пружинная отдача (Spring recoil): для ракетницы пружина тяжелее и инертнее
    const isRocket = currentWeaponId === "rocket";
    const springK = isRocket ? 82 : (feelWpn.springK || 100);
    const damp = isRocket ? 10.5 : (feelWpn.damp || 16);

    this.recoilVel.z += (-springK * this.recoilPos.z - damp * this.recoilVel.z) * dt;
    this.recoilPos.z += this.recoilVel.z * dt;

    this.recoilRotVel.x += (-springK * this.recoilRot.x - damp * this.recoilRotVel.x) * dt;
    this.recoilRot.x += this.recoilRotVel.x * dt;

    this.recoilRotVel.z += (-springK * this.recoilRot.z - damp * this.recoilRotVel.z) * dt;
    this.recoilRot.z += this.recoilRotVel.z * dt;

    if (currentWeaponId === "ak47") {
      const maxAkRot = (5 * Math.PI) / 180;
      if (this.recoilPos.z > 0.06) {
        this.recoilPos.z = 0.06;
        if (this.recoilVel.z > 0) this.recoilVel.z = 0;
      }
      if (this.recoilRot.x > maxAkRot) {
        this.recoilRot.x = maxAkRot;
        if (this.recoilRotVel.x > 0) this.recoilRotVel.x = 0;
      }
    }

    // Тряска вьюмодели (лёгкая для АК-47, мощная для ракетницы)
    this.akShakeT = Math.max(0, this.akShakeT - dt);
    const shakeAmp = isRocket ? 0.018 : 0.008;
    const akShakeX = this.akShakeT > 0 ? (Math.random() - 0.5) * shakeAmp : 0;
    const akShakeY = this.akShakeT > 0 ? (Math.random() - 0.5) * shakeAmp : 0;

    // Затухание запаздывания мыши (sway): плавное и без сильного увода в бок
    const swayRecovery = isRocket ? 10 : (feelWpn.swayRecovery || 12);
    this.swayX = THREE.MathUtils.lerp(this.swayX, 0, Math.min(1, dt * swayRecovery));
    this.swayY = THREE.MathUtils.lerp(this.swayY, 0, Math.min(1, dt * swayRecovery));

    this.kick = Math.max(0, this.kick - dt * (isRocket ? 2.4 : 3.5));
    const switchSpeed = isRocket ? 4.5 : (CONFIG.combat.viewmodelSwitchSpeed ?? 7);
    this.appear = Math.min(1, this.appear + dt * switchSpeed);
    if (!Number.isFinite(this.appear)) this.appear = 1;

    const spRaw = Math.sqrt(player.vel.x * player.vel.x + player.vel.z * player.vel.z);
    const sp = Math.min(1, spRaw / (CONFIG.player.moveSpeed || 14));

    const bobSpeedMult = isRocket ? 0.85 : 1.0;
    this.bobA += (sp - this.bobA) * Math.min(1, dt * CONFIG.combat.viewmodelBobSpeed * bobSpeedMult);
    this.bobT += dt * CONFIG.combat.viewmodelBobSpeed * bobSpeedMult * (0.35 + 0.65 * sp);

    const airBobDamp = (feelWpn.airBobDamp || 0.002) * (isRocket ? 0.85 : 1.0);
    const maxAirDip = isRocket ? 0.032 : 0.045;
    const targetAirDip = !player.onGround ? Math.max(-maxAirDip, Math.min(maxAirDip, -player.vel.y * airBobDamp)) : 0;
    this.airDipSmooth = THREE.MathUtils.lerp(this.airDipSmooth || 0, targetAirDip, Math.min(1, dt * 8));
    const airDip = this.airDipSmooth;

    const e = 1 - Math.pow(1 - this.appear, 3);
    const dashK = player.dashTimer > 0 ? player.dashTimer / CONFIG.dash.dashDuration : 0;
    const dashTilt = dashK * (isRocket ? 0.28 : 0.22);
    const switchTilt = (1 - e) * (isRocket ? 0.45 : 0.35);

    if (this.gloryPose.active) {
      this.gloryPose.timer += dt;
      const t = Math.min(1, this.gloryPose.timer / this.gloryPose.duration);
      const ease = 1 - Math.pow(1 - t, 3);
      this.view.position.lerpVectors(this.gloryPose.startPos, this.gloryPose.targetPos, ease);
      this.view.position.z += this.kick * 0.15 + this.recoilPos.z * 0.5;
      this.view.rotation.set(
        THREE.MathUtils.lerp(this.gloryPose.startRot.x, this.gloryPose.targetRot.x, ease) +
          this.kick * 0.25 +
          this.recoilRot.x * 0.5,
        THREE.MathUtils.lerp(this.gloryPose.startRot.y, this.gloryPose.targetRot.y, ease),
        THREE.MathUtils.lerp(this.gloryPose.startRot.z, this.gloryPose.targetRot.z, ease)
      );
    } else if (this.gloryPose.returning) {
      this.gloryPose.returnTimer += dt;
      const t = Math.min(1, this.gloryPose.returnTimer / this.gloryPose.returnDuration);
      const ease = 1 - Math.pow(1 - t, 3);
      this.view.position.lerpVectors(this.gloryPose.startPos, this.gloryPose.targetPos, ease);
      this.view.position.z += this.kick * 0.12;
      this.view.rotation.set(
        THREE.MathUtils.lerp(this.gloryPose.startRot.x, this.gloryPose.targetRot.x, ease) +
          this.kick * 0.18,
        THREE.MathUtils.lerp(this.gloryPose.startRot.y, this.gloryPose.targetRot.y, ease),
        THREE.MathUtils.lerp(this.gloryPose.startRot.z, this.gloryPose.targetRot.z, ease)
      );
      if (t >= 1) {
        this.gloryPose.returning = false;
      }
    } else if (!isGloryActive) {
      // Базовая позиция this.view зависит от активного оружия:
      // - 3D-модели (дробовик, АК-47): из CONFIG.viewmodel[id].pos (настроено в редакторе F2)
      // - процедурные модели: стандартная позиция
      const basePos = this._getWeaponBasePos(currentWeaponId);
      const baseX = basePos.x;
      const baseY = basePos.y;
      const baseZ = basePos.z;
      const bobMult = isRocket ? 1.0 : 1.0;
      const swayMult = isRocket ? 0.55 : 1.0;
      const dropY = (1 - e) * (isRocket ? 0.55 : 0.45);
      this.view.position.set(
        baseX + Math.sin(this.bobT) * CONFIG.combat.viewmodelBobAmpX * this.bobA * bobMult + this.swayX * swayMult + akShakeX,
        baseY +
          Math.abs(Math.cos(this.bobT)) * CONFIG.combat.viewmodelBobAmpY * this.bobA * bobMult -
          dropY +
          airDip +
          this.swayY * 0.5 * swayMult +
          akShakeY,
        baseZ + this.recoilPos.z + this.kick * 0.12
      );
      this.view.rotation.set(
        -(1 - e) * 0.7 +
          this.recoilRot.x +
          this.kick * 0.18 +
          airDip * (isRocket ? 0.9 : 1.5) -
          this.swayY * 0.8 * swayMult,
        Math.sin(this.bobT * 0.5) * CONFIG.combat.viewmodelBobRot * this.bobA * bobMult +
          switchTilt +
          this.swayX * (isRocket ? 0.55 : 1.2) * swayMult,
        -switchTilt * 0.7 - dashTilt + this.recoilRot.z - this.swayX * (isRocket ? 0.4 : 0.5)
      );
    }

    // Обновление 3D-рук ("baked" — без IK; "liveIK" — IK каждый кадр; "anim" — клип анимации)
    const armsCfg = CONFIG.viewmodel?.arms || {};
    const armsMode = armsCfg.mode || "baked";

    if (armsMode === "baked") {
      const pair = this.bakedArms && this.bakedArms[currentWeaponId];
      if (pair && armsCfg.breathing !== false) {
        this.armsBreathT += dt;
        const breathWorld = Math.sin((this.armsBreathT * Math.PI * 2) / 4.0) * 0.002;
        const aScale = armsCfg.scale ?? 1.38;
        for (const entry of [pair.right, pair.left]) {
          if (!entry || !entry.armRoot || !entry.baseLocalPos) continue;
          const entryScale = entry.armsScale ?? aScale;
          const localScaleRatio = (entry.armRoot.scale.y || entryScale) / (entryScale || 1);
          entry.armRoot.position.y = entry.baseLocalPos.y + breathWorld * localScaleRatio;
        }
      }
    } else if (this.armsState && this.armsGroup && this.armsGroup.visible) {
      const mode = armsMode;
      const wpnHandsCfg = this._getWeaponHandsConfig(currentWeaponId);
      const ap = (mode !== "anim" && wpnHandsCfg?.armsPos) || armsCfg.pos || {};
      const ar = armsCfg.rot || {};
      const aScale = (mode !== "anim" && wpnHandsCfg?.armsScale != null) ? wpnHandsCfg.armsScale : (armsCfg.scale ?? 1.0);

      if (mode === "anim") {
        if (!this.armsState.paused) {
          this.armsState.mixer.update(dt);
        }
        const bobX = Math.sin(this.bobT) * (CONFIG.combat.viewmodelBobAmpX || 0.014) * this.bobA * 0.6;
        const bobY = Math.abs(Math.cos(this.bobT)) * (CONFIG.combat.viewmodelBobAmpY || 0.012) * this.bobA * 0.6;
        this.armsGroup.position.set(
          (ap.x || 0) + bobX + this.swayX * 0.4,
          (ap.y || 0) + bobY + airDip * 0.6 + this.swayY * 0.25,
          ap.z || 0
        );
        this.armsGroup.rotation.set(
          (ar.x || 0) + airDip * 0.7 - this.swayY * 0.4,
          (ar.y || 0) + this.swayX * 0.5,
          (ar.z || 0) - dashTilt * 0.5
        );
        this.armsGroup.scale.setScalar(aScale);
      } else {
        const activeModel = this.models[currentWeaponId];
        const gunRoot = this._getWeaponGunRoot(currentWeaponId);
        const shouldSolve =
          gunRoot &&
          (activeModel?.visible || armsCfg.hideWeaponsForTest) &&
          this.armsState.chainR &&
          this.armsState.chainL;

        if (shouldSolve) {
          this.armsBreathT += dt;
          const breathY = Math.sin((this.armsBreathT * Math.PI * 2) / 4.0) * 0.003;

          this.armsGroup.position.set(ap.x || 0, (ap.y || 0) + breathY, ap.z || 0);
          this.armsGroup.rotation.set(ar.x || 0, ar.y || 0, ar.z || 0);
          this.armsGroup.scale.setScalar(aScale);
          this.armsGroup.updateMatrixWorld(true);

          // Обновляем мировые матрицы оружия, чтобы учесть отдачу, покачивание и позу добивания
          this.view.updateMatrixWorld(true);
          gunRoot.updateMatrixWorld(true);

          const handsCfg = this._getWeaponHandsConfig(currentWeaponId);
          const hr = handsCfg.right;
          const hl = handsCfg.left;
          const gripR = gunRoot.userData && gunRoot.userData.gripR;
          const gripL = gunRoot.userData && gunRoot.userData.gripL;

          if (gripR) {
            gripR.getWorldPosition(_ikTargetR);
          } else {
            _ikTargetR.set(hr.x || 0, hr.y || 0, hr.z || 0);
            gunRoot.localToWorld(_ikTargetR);
          }
          if (gripL) {
            gripL.getWorldPosition(_ikTargetL);
          } else {
            _ikTargetL.set(hl.x || 0, hl.y || 0, hl.z || 0);
            gunRoot.localToWorld(_ikTargetL);
          }

          if (this.armsTargetLerp < 1) {
            this.armsTargetLerp = Math.min(1, this.armsTargetLerp + dt / 0.12);
            _ikBlendR.lerpVectors(_ikPrevR, _ikTargetR, this.armsTargetLerp);
            _ikBlendL.lerpVectors(_ikPrevL, _ikTargetL, this.armsTargetLerp);
          } else {
            _ikBlendR.copy(_ikTargetR);
            _ikBlendL.copy(_ikTargetL);
          }

          const hrBase = armsCfg.handRot?.right || { x: 0, y: 0, z: 0 };
          const hrWpn = hr.rot || { x: 0, y: 0, z: 0 };
          if (gripR) gripR.getWorldQuaternion(_gunWorldQ);
          else gunRoot.getWorldQuaternion(_gunWorldQ);
          _handBaseQ.setFromEuler(_handEuler.set(hrBase.x || 0, hrBase.y || 0, hrBase.z || 0));
          _handWpnQ.setFromEuler(_handEuler.set(hrWpn.x || 0, hrWpn.y || 0, hrWpn.z || 0));
          _handTargetQR.copy(_gunWorldQ).multiply(_handBaseQ).multiply(_handWpnQ);

          const hlBase = armsCfg.handRot?.left || { x: 0, y: 0, z: 0 };
          const hlWpn = hl.rot || { x: 0, y: 0, z: 0 };
          if (gripL) gripL.getWorldQuaternion(_gunWorldQ);
          else gunRoot.getWorldQuaternion(_gunWorldQ);
          _handBaseQ.setFromEuler(_handEuler.set(hlBase.x || 0, hlBase.y || 0, hlBase.z || 0));
          _handWpnQ.setFromEuler(_handEuler.set(hlWpn.x || 0, hlWpn.y || 0, hlWpn.z || 0));
          _handTargetQL.copy(_gunWorldQ).multiply(_handBaseQ).multiply(_handWpnQ);

          const pR = armsCfg.pole?.right || { x: 0.5, y: -1.0, z: 0.3 };
          const pL = armsCfg.pole?.left || { x: -0.5, y: -1.0, z: 0.3 };
          _ikPoleR.set(pR.x, pR.y, pR.z);
          _ikPoleL.set(pL.x, pL.y, pL.z);

          const resR = solveTwoBoneIK(this.armsState.chainR, _ikBlendR, _handTargetQR, _ikPoleR, aScale);
          const resL = solveTwoBoneIK(this.armsState.chainL, _ikBlendL, _handTargetQL, _ikPoleL, aScale);
          this.armsReach.right = resR.reachable;
          this.armsReach.left = resL.reachable;

          this._applyFingerPoses(currentWeaponId);

          if (this.handTargetMarkers) {
            this.handTargetMarkers.right.position.copy(_ikBlendR);
            this.handTargetMarkers.left.position.copy(_ikBlendL);
            this.handTargetMarkers.right.material.color.setHex(resR.reachable ? 0x22ff44 : 0xff2222);
            this.handTargetMarkers.left.material.color.setHex(resL.reachable ? 0x22ff44 : 0xff2222);
            this.handTargetMarkers.right.visible = this.armsDebugVisible;
            this.handTargetMarkers.left.visible = this.armsDebugVisible;
          }
        }
      }
    }

    // Откат цевья дробовика (Tactical_Handguard_V1)
    if (this.pumpActive && this.handguardNode) {
      const pumpCfg = CONFIG.viewmodel?.shotgun?.pump || { distance: 0.025, returnTime: 0.18 };
      const returnTime = Math.max(0.01, pumpCfg.returnTime || 0.18);
      this.pumpTimer += dt;
      if (this.pumpTimer >= returnTime) {
        this.pumpActive = false;
        this.handguardNode.position.copy(this.handguardBasePos);
      } else {
        const distMeters = pumpCfg.distance ?? 0.025;
        const isModel = !!(this.models.shotgun && this.models.shotgun.userData._isModel);
        const scale = (this.models.shotgun && this.models.shotgun.scale.x) || 0.00627;
        const distModel = scale > 1e-6 ? distMeters / scale : distMeters;

        const rackTime = Math.min(0.05, returnTime * 0.28);
        let offset = 0;
        if (this.pumpTimer < rackTime) {
          const r = this.pumpTimer / rackTime;
          const k = 1 - Math.pow(1 - r, 2);
          offset = -distModel * k;
        } else {
          const st = (this.pumpTimer - rackTime) / (returnTime - rackTime);
          const springFactor = (1 - st) * Math.cos(st * Math.PI * 0.5);
          offset = -distModel * springFactor;
        }
        if (isModel) {
          this.handguardNode.position.set(
            this.handguardBasePos.x + offset,
            this.handguardBasePos.y,
            this.handguardBasePos.z
          );
        } else {
          const procOffset = (offset / distModel) * distMeters;
          this.handguardNode.position.set(
            this.handguardBasePos.x,
            this.handguardBasePos.y,
            this.handguardBasePos.z - procOffset
          );
        }
      }
    }

    // Задержка выброса гильзы дробовика (0.12 с)
    if (this.pendingShells && this.pendingShells.length > 0) {
      for (let i = this.pendingShells.length - 1; i >= 0; i--) {
        this.pendingShells[i] -= dt;
        if (this.pendingShells[i] <= 0) {
          this.pendingShells.splice(i, 1);
          this._spawnShotgunShell();
        }
      }
    }

    // Обновление физики гильз в wScene
    if (this.shellPool) {
      for (let i = 0; i < this.shellPool.length; i++) {
        const s = this.shellPool[i];
        if (s.life > 0) {
          s.life -= dt;
          if (s.life <= 0) {
            s.mesh.visible = false;
          } else {
            s.vel.y -= 7.5 * dt;
            s.mesh.position.addScaledVector(s.vel, dt);
            s.mesh.rotation.x += s.rotVel.x * dt;
            s.mesh.rotation.y += s.rotVel.y * dt;
            s.mesh.rotation.z += s.rotVel.z * dt;

            // Звук падения гильзы (тихий щелчок, синтез)
            if (!s.soundPlayed && s.life <= 0.8) {
              s.soundPlayed = true;
              const audio = this.audio || (typeof window !== "undefined" ? window._gameAudioInstance : null);
              if (audio) {
                audio.play("shell_drop", 0.7);
              }
            }
          }
        }
      }
    }

    // Обновление физики гильз АК-47 в wScene (пул 30 шт, затухание 0.9 с)
    if (this.akShellPool) {
      const akCfg = CONFIG.viewmodel?.ak47 || {};
      const shellScaleMult = (akCfg.shell && akCfg.shell.scale != null) ? akCfg.shell.scale : 1.0;
      for (let i = 0; i < this.akShellPool.length; i++) {
        const s = this.akShellPool[i];
        if (s.life > 0) {
          s.life -= dt;
          if (s.life <= 0) {
            s.mesh.visible = false;
          } else {
            s.vel.y -= 7.5 * dt;
            s.mesh.position.addScaledVector(s.vel, dt);
            s.mesh.rotation.x += s.rotVel.x * dt;
            s.mesh.rotation.y += s.rotVel.y * dt;
            s.mesh.rotation.z += s.rotVel.z * dt;
            // Плавное уменьшение к концу жизни (последние 0.25 с)
            const fade = Math.min(1, s.life / 0.25);
            const baseScale = s.mesh.userData.isAmmoCasing ? 1.0 : shellScaleMult;
            s.mesh.scale.setScalar(baseScale * fade);

            if (!s.soundPlayed && s.life <= 0.5) {
              s.soundPlayed = true;
              const audio = this.audio || (typeof window !== "undefined" ? window._gameAudioInstance : null);
              if (audio) {
                audio.play("shell_drop_ak", 0.7);
              }
            }
          }
        }
      }
    }

    // Обновление дымка у дула АК-47 в wScene (пул 10 шт)
    if (this.akSmokePool) {
      for (let i = 0; i < this.akSmokePool.length; i++) {
        const p = this.akSmokePool[i];
        if (p.life > 0) {
          p.life -= dt;
          if (p.life <= 0) {
            p.mesh.visible = false;
          } else {
            p.mesh.position.addScaledVector(p.vel, dt);
            const prog = 1 - p.life / p.maxLife;
            p.mesh.scale.setScalar(1 + prog * 2.2);
            p.mesh.material.opacity = 0.35 * (1 - prog);
          }
        }
      }
    }

    // Механический щелчок ракетницы (два тона) во время опускания трубы после выстрела
    if (this.rocketClickTimer > 0) {
      this.rocketClickTimer -= dt;
      if (this.rocketClickTimer <= 0) {
        this.rocketClickTimer = 0;
        const audio = this.audio || (typeof window !== "undefined" ? window._gameAudioInstance : null);
        if (audio) {
          audio.play("rocket_reload_click", 0.85);
        }
      }
    }

    // Обновление тёплого дымка дула ракетницы (0.1 с) и облака выхлопа у края экрана (0.5 с)
    if (this.rocketSmokePool) {
      for (let i = 0; i < this.rocketSmokePool.length; i++) {
        const p = this.rocketSmokePool[i];
        if (p.life > 0) {
          p.life -= dt;
          if (p.life <= 0) {
            p.mesh.visible = false;
          } else {
            p.mesh.position.addScaledVector(p.vel, dt);
            const prog = 1 - p.life / p.maxLife;
            p.mesh.scale.setScalar(1 + prog * 1.8);
            p.mesh.material.opacity = 0.5 * (1 - prog);
          }
        }
      }
    }
    if (this.rocketBackblastPool) {
      for (let i = 0; i < this.rocketBackblastPool.length; i++) {
        const b = this.rocketBackblastPool[i];
        if (b.life > 0) {
          b.life -= dt;
          if (b.life <= 0) {
            b.mesh.visible = false;
          } else {
            b.mesh.position.addScaledVector(b.vel, dt);
            const prog = 1 - b.life / b.maxLife;
            b.mesh.scale.setScalar(1 + prog * 2.4);
            b.mesh.material.opacity = 0.42 * (1 - prog);
          }
        }
      }
    }

    // Вспышка и свет
    this.flashT = Math.max(0, this.flashT - dt);
    this.lightT = Math.max(0, this.lightT - dt);

    const curModel = this.models[currentWeaponId];
    if (curModel && curModel.userData.flash) {
      curModel.userData.flash.visible = this.flashT > 0;
    }

    this.mainCamera.getWorldDirection(_dir);
    _right.set(1, 0, 0).applyQuaternion(this.mainCamera.quaternion);
    _up.set(0, 1, 0).applyQuaternion(this.mainCamera.quaternion);

    if (curModel && curModel.userData.flash) {
      _tmpMuzzleW.set(0, 0, 0);
      curModel.userData.flash.getWorldPosition(_tmpMuzzleW);
      // В пространстве wCam (+X вправо, +Y вверх, -Z вперёд): переводим в мировое пространство камеры
      this.mLight.position
        .copy(this.mainCamera.position)
        .addScaledVector(_right, _tmpMuzzleW.x)
        .addScaledVector(_up, _tmpMuzzleW.y)
        .addScaledVector(_dir, -_tmpMuzzleW.z);
    } else {
      this.mLight.position
        .copy(this.mainCamera.position)
        .addScaledVector(_dir, 0.9)
        .addScaledVector(_right, 0.3)
        .addScaledVector(_up, -0.2);
    }
    // Заметное освещение окружения при стрельбе в темноте (без мерцания на весь экран при очереди АК)
    const maxLight = this.lightMaxT || CONFIG.combat.lightDuration;
    const lightPeak = currentWeaponId === "ak47" ? 2.4 : 4.8;
    this.mLight.intensity = (lightPeak * this.lightT) / maxLight;
  }

  resize(aspect) {
    this.wCam.aspect = aspect;
    this.wCam.updateProjectionMatrix();
  }

  render(renderer) {
    renderer.state.buffers.depth.setMask(true);
    renderer.clearDepth();
    renderer.render(this.wScene, this.wCam);
  }

  /**
   * Подсветка оружия цветом текущей ступени стиля отключена (оружие и руки сохраняют оригинальные цвета).
   * @param {number} rankIndex
   * @param {string|number} colorHex
   */
  setStyleRank(rankIndex, colorHex) {
    this._currentStyleRank = rankIndex;
    this._currentStyleColor = colorHex;
  }

  /**
   * Сбор полной диагностики состояния вьюмодели для F3 (CONFIG.debug.cheats).
   * Проверяет наличие NaN в параметрах пружин, позициях и сбрасывает их в 0 при обнаружении.
   * @returns {Object}
   */
  getDiagnostics() {
    const activeId = this.currentWeaponId || "shotgun";
    const activeModel = this.models[activeId];
    let nanFound = false;

    const checkAndFixNaN = (obj, prop, name) => {
      if (typeof obj[prop] === "number" && (Number.isNaN(obj[prop]) || !Number.isFinite(obj[prop]))) {
        console.warn(`[Viewmodel Diagnostics] NaN/Infinite detected in ${name}! Resetting to 0.`);
        obj[prop] = 0;
        nanFound = true;
      }
    };

    checkAndFixNaN(this.recoilPos, "x", "recoilPos.x");
    checkAndFixNaN(this.recoilPos, "y", "recoilPos.y");
    checkAndFixNaN(this.recoilPos, "z", "recoilPos.z");
    checkAndFixNaN(this.recoilVel, "x", "recoilVel.x");
    checkAndFixNaN(this.recoilVel, "y", "recoilVel.y");
    checkAndFixNaN(this.recoilVel, "z", "recoilVel.z");
    checkAndFixNaN(this.recoilRot, "x", "recoilRot.x");
    checkAndFixNaN(this.recoilRot, "y", "recoilRot.y");
    checkAndFixNaN(this.recoilRot, "z", "recoilRot.z");
    checkAndFixNaN(this, "swayX", "swayX");
    checkAndFixNaN(this, "swayY", "swayY");
    checkAndFixNaN(this, "bobT", "bobT");
    checkAndFixNaN(this, "pumpTimer", "pumpTimer");
    checkAndFixNaN(this.view.position, "x", "view.position.x");
    checkAndFixNaN(this.view.position, "y", "view.position.y");
    checkAndFixNaN(this.view.position, "z", "view.position.z");
    checkAndFixNaN(this.view.rotation, "x", "view.rotation.x");
    checkAndFixNaN(this.view.rotation, "y", "view.rotation.y");
    checkAndFixNaN(this.view.rotation, "z", "view.rotation.z");

    let childMeshCount = 0;
    const materialsSample = [];
    if (activeModel) {
      activeModel.traverse((ch) => {
        if (ch.isMesh) {
          childMeshCount++;
          if (ch.material && materialsSample.length < 4) {
            materialsSample.push({
              name: ch.name || "part",
              depthTest: ch.material.depthTest,
              depthWrite: ch.material.depthWrite,
              transparent: ch.material.transparent,
              opacity: ch.material.opacity
            });
          }
        }
      });
    }

    const worldPos = new THREE.Vector3();
    this.view.getWorldPosition(worldPos);

    const box = new THREE.Box3();
    if (activeModel) {
      box.setFromObject(activeModel);
    }

    return {
      activeWeapon: activeId,
      modelVisible: activeModel ? activeModel.visible : false,
      viewVisible: this.view.visible,
      viewPos: {
        x: Number(this.view.position.x.toFixed(3)),
        y: Number(this.view.position.y.toFixed(3)),
        z: Number(this.view.position.z.toFixed(3))
      },
      viewRot: {
        x: Number(this.view.rotation.x.toFixed(3)),
        y: Number(this.view.rotation.y.toFixed(3)),
        z: Number(this.view.rotation.z.toFixed(3))
      },
      viewScale: {
        x: Number(this.view.scale.x.toFixed(3)),
        y: Number(this.view.scale.y.toFixed(3)),
        z: Number(this.view.scale.z.toFixed(3))
      },
      worldPos: {
        x: Number(worldPos.x.toFixed(3)),
        y: Number(worldPos.y.toFixed(3)),
        z: Number(worldPos.z.toFixed(3))
      },
      box3Min: {
        x: Number(box.min.x.toFixed(3)),
        y: Number(box.min.y.toFixed(3)),
        z: Number(box.min.z.toFixed(3))
      },
      box3Max: {
        x: Number(box.max.x.toFixed(3)),
        y: Number(box.max.y.toFixed(3)),
        z: Number(box.max.z.toFixed(3))
      },
      childMeshCount,
      nanFound,
      wCam: {
        near: this.wCam.near,
        far: this.wCam.far,
        aspect: Number(this.wCam.aspect.toFixed(3)),
        fov: this.wCam.fov
      },
      materialsSample
    };
  }
}
