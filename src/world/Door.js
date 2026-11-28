// Дверь в проёме комнаты: две створки, анимация раздвижения, коллайдер,
// активный только когда дверь закрыта. Закрыта — красная, открыта — зелёная.
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { createToonMaterial } from "./Materials.js";

const DIRECTIONS = ["north", "south", "west", "east"];

export class Door {
  /**
   * @param {Object} world - World (нужен для world.boxes)
   * @param {Object} room - Room, в проёме которого ставится дверь
   * @param {"north"|"south"|"west"|"east"} dir
   * @param {Object} [opts]
   * @param {boolean} [opts.startOpen=true]
   */
  constructor(world, room, dir, opts = {}) {
    this.world = world;
    this.room = room;
    this.dir = dir;
    this.roomGroup = room.group;

    const C = CONFIG.level;
    this.width = C.corridorWidth;
    this.height = C.corridorHeight;
    this.animTime = CONFIG.waves.arenas.doorAnimTime || 0.4;

    // 1 — полностью открыта, 0 — закрыта
    this.openAmount = opts.startOpen === false ? 0 : 1;
    this.targetOpen = this.openAmount;
    this.combat = false;
    this._colliderActive = false;
    this._closedMin = null;
    this._closedMax = null;

    this.build();
    this.registerCollider();

    if (this.openAmount <= 0.001) {
      this._setCollider(true);
    }
    this.applyColor();
  }

  /**
   * Построение меша двери: группа в центре проёма, створки раздвигаются по X
   */
  build() {
    const room = this.room;
    const cx = room.center.x;
    const cz = room.center.z;
    const T = CONFIG.level.wallThickness;

    let x = cx;
    let z = cz;
    let rotationY = 0;

    if (this.dir === "north") {
      z = cz - room.d / 2 - T / 2;
    } else if (this.dir === "south") {
      z = cz + room.d / 2 + T / 2;
    } else if (this.dir === "west") {
      x = cx - room.w / 2 - T / 2;
      rotationY = Math.PI / 2;
    } else if (this.dir === "east") {
      x = cx + room.w / 2 + T / 2;
      rotationY = Math.PI / 2;
    }

    this.group = new THREE.Group();
    this.group.position.set(x, this.height / 2, z);
    this.group.rotation.y = rotationY;

    const panelW = this.width / 2;
    const panelT = 0.34;

    this.panelMat = createToonMaterial(0x1c3b2a);
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0x2eff6a, toneMapped: false });

    const panelGeo = new THREE.BoxGeometry(panelW, this.height, panelT);
    const glowGeo = new THREE.BoxGeometry(0.08, this.height * 0.96, panelT + 0.06);

    this.panels = [];
    for (let i = 0; i < 2; i++) {
      const sign = i === 0 ? -1 : 1;
      const panel = new THREE.Mesh(panelGeo, this.panelMat);
      panel.position.x = sign * (panelW / 2);
      this.group.add(panel);

      const glow = new THREE.Mesh(glowGeo, this.glowMat);
      glow.position.x = sign * -(panelW / 2 - 0.06);
      panel.add(glow);

      this.panels.push({ mesh: panel, sign });
    }

    // Верхняя перекладина, чтобы проём читался как дверь
    const lintel = new THREE.Mesh(
      new THREE.BoxGeometry(this.width + 0.3, 0.16, panelT + 0.1),
      this.panelMat
    );
    lintel.position.y = this.height / 2 - 0.08;
    this.group.add(lintel);

    this.roomGroup.add(this.group);
    this.applyOpenAmount();
  }

  /**
   * AABB-коллайдер проёма. Добавляется в комнату и мир один раз;
   * при открытии «паркуется» далеко вниз, чтобы не участвовать в коллизиях.
   */
  registerCollider() {
    const room = this.room;
    const T = CONFIG.level.wallThickness;
    const halfT = Math.max(0.22, T * 0.28);
    const hw = this.width / 2;
    const hh = this.height;

    let minX;
    let maxX;
    let minZ;
    let maxZ;

    if (this.dir === "north" || this.dir === "south") {
      const z = this.group.position.z;
      minX = room.center.x - hw;
      maxX = room.center.x + hw;
      minZ = z - halfT;
      maxZ = z + halfT;
    } else {
      const x = this.group.position.x;
      minX = x - halfT;
      maxX = x + halfT;
      minZ = room.center.z - hw;
      maxZ = room.center.z + hw;
    }

    this._closedMin = new THREE.Vector3(minX, 0, minZ);
    this._closedMax = new THREE.Vector3(maxX, hh, maxZ);

    this.box = {
      min: this._closedMin.clone(),
      max: this._closedMax.clone(),
      isDoor: true
    };
    // Пока дверь открыта, коллайдер выключен
    this.box.min.set(0, -1000, 0);
    this.box.max.set(0, -999, 0);

    room.boxes.push(this.box);
    if (this.world && this.world.boxes && this.world.boxes !== room.boxes) {
      this.world.boxes.push(this.box);
    }
  }

  /**
   * Включить/выключить коллайдер
   * @param {boolean} active
   */
  _setCollider(active) {
    if (active === this._colliderActive) return;
    this._colliderActive = active;
    if (active) {
      this.box.min.copy(this._closedMin);
      this.box.max.copy(this._closedMax);
    } else {
      this.box.min.set(0, -1000, 0);
      this.box.max.set(0, -999, 0);
    }
  }

  /**
   * Закрыть дверь на время боя (красная подсветка)
   */
  close() {
    this.targetOpen = 0;
    this.combat = true;
    this.applyColor();
  }

  /**
   * Открыть дверь (зелёная подсветка)
   */
  open() {
    this.targetOpen = 1;
    this.combat = false;
    this._setCollider(false);
    this.applyColor();
  }

  applyColor() {
    if (!this.panelMat || !this.glowMat) return;
    if (this.combat || this.targetOpen < 0.5) {
      this.panelMat.color.setHex(0x3a0d14);
      this.panelMat.emissive.setHex(0x5c0a18);
      this.glowMat.color.setHex(0xff2e4a);
    } else {
      const glowCol = (this.room && this.room.theme && this.room.theme.doorGlow != null)
        ? this.room.theme.doorGlow
        : 0x2eff6a;
      this.panelMat.color.setHex(0x1c3b2a);
      this.panelMat.emissive.setHex(0x0a2a14);
      this.glowMat.color.setHex(glowCol);
    }
  }

  applyOpenAmount() {
    const panelW = this.width / 2;
    const shift = this.openAmount * (this.width / 2 + 0.08);
    for (const p of this.panels) {
      p.mesh.position.x = p.sign * (panelW / 2) + p.sign * shift;
    }
  }

  update(dt) {
    if (Math.abs(this.openAmount - this.targetOpen) > 0.0001) {
      const step = dt / Math.max(0.01, this.animTime);
      if (this.openAmount < this.targetOpen) {
        this.openAmount = Math.min(this.targetOpen, this.openAmount + step);
      } else {
        this.openAmount = Math.max(this.targetOpen, this.openAmount - step);
      }
      this.applyOpenAmount();
      if (this.openAmount <= 0.25) {
        this._setCollider(true);
      } else {
        this._setCollider(false);
      }
    }
  }

  destroy() {
    if (this.group) {
      this.roomGroup.remove(this.group);
      this.group.traverse((node) => {
        if (node.geometry) node.geometry.dispose();
        if (node.material) node.material.dispose();
      });
    }
    const roomBoxes = this.room ? this.room.boxes : null;
    if (roomBoxes) {
      const i = roomBoxes.indexOf(this.box);
      if (i !== -1) roomBoxes.splice(i, 1);
    }
    if (this.world && this.world.boxes) {
      const i = this.world.boxes.indexOf(this.box);
      if (i !== -1) this.world.boxes.splice(i, 1);
    }
    this.group = null;
  }

  static get DIRECTIONS() {
    return DIRECTIONS;
  }
}
