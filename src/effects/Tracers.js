// Пул светящихся трассеров пуль (АК-47 и hitscan-оружие)
import * as THREE from "three";

export class Tracers {
  /**
   * @param {THREE.Scene} scene
   * @param {number} [maxCount=20]
   */
  constructor(scene, maxCount = 20) {
    this.scene = scene;
    this.maxCount = maxCount;
    this.tracers = [];
    this.index = 0;

    const mat = new THREE.LineBasicMaterial({
      color: 0xffe680,
      linewidth: 1,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    for (let i = 0; i < maxCount; i++) {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array([0, 0, 0, 0, 0, -1]);
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const line = new THREE.Line(geo, mat.clone());
      line.visible = false;
      this.scene.add(line);
      this.tracers.push({
        line,
        geo,
        life: 0,
        maxLife: 0.05
      });
    }
  }

  /**
   * Запустить светящийся трассер от дула к точке попадания
   * @param {THREE.Vector3} from
   * @param {THREE.Vector3} to
   * @param {number} [life=0.05]
   */
  spawn(from, to, life = 0.05) {
    const t = this.tracers[this.index];
    this.index = (this.index + 1) % this.maxCount;

    const arr = t.geo.attributes.position.array;
    arr[0] = from.x;
    arr[1] = from.y;
    arr[2] = from.z;
    arr[3] = to.x;
    arr[4] = to.y;
    arr[5] = to.z;
    t.geo.attributes.position.needsUpdate = true;

    t.life = life;
    t.maxLife = life;
    t.line.material.opacity = 0.95;
    t.line.visible = true;
  }

  update(dt) {
    for (let i = 0; i < this.maxCount; i++) {
      const t = this.tracers[i];
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) {
        t.line.visible = false;
      } else {
        t.line.material.opacity = 0.95 * Math.min(1, t.life / t.maxLife);
      }
    }
  }
}
