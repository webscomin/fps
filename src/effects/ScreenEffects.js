// Пост-обработка: EffectComposer с именованными проходами.
//
// Базовая цепочка для PSX:
// RenderPass -> UnrealBloomPass (слабый) -> OverlayPass (вьюмодель) ->
// ExtraPasses (drunk, weed) -> OutputPass (sRGB) ->
// PsxDitherPass (Bayer 4x4 дизеринг + квантование цвета + зернистость) -> VignettePass.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Pass } from "three/addons/postprocessing/Pass.js";
import { CONFIG } from "../config.js";
import { getQualitySettings, setTexturesEnabled, updateSnapResolution } from "../world/Materials.js";

/**
 * Проход, который дорисовывает вьюмодель оружия прямо в кадр композера
 * (после bloom, до шейдеров расходников), чтобы оружие тоже двоилось/плыло.
 */
class OverlayPass extends Pass {
  constructor() {
    super();
    this.needsSwap = false;
    this.renderFn = null;
  }

  render(renderer, writeBuffer, readBuffer) {
    if (!this.renderFn) return;
    if (CONFIG.graphics && CONFIG.graphics.weaponInComposer === false) return;
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(readBuffer);
    renderer.state.buffers.depth.setMask(true);
    renderer.clearDepth();
    this.renderFn(renderer);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
  }
}

// Финальный проход: виньетка. Работает уже в sRGB (после OutputPass).
const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    strength: { value: CONFIG.graphics.vignette.strength },
    softness: { value: CONFIG.graphics.vignette.softness }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float strength;
    uniform float softness;
    varying vec2 vUv;

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec2 p = vUv - 0.5;
      float dist = length(p) * 1.41421356;
      float inner = mix(0.62, 0.38, softness);
      float vig = smoothstep(inner, 0.98, dist);
      color.rgb *= mix(1.0, 1.0 - strength, vig);
      gl_FragColor = color;
    }
  `
};

// Финальный шейдер PSX: упорядоченный Bayer 4x4 дизеринг, квантование цвета до 24-32 уровней и шум (зернистость)
const PsxDitherShader = {
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2(320, 240) },
    colorLevels: { value: (CONFIG.graphics && CONFIG.graphics.colorLevels) || 32.0 },
    ditherStrength: { value: (CONFIG.graphics && CONFIG.graphics.ditherStrength != null) ? CONFIG.graphics.ditherStrength : 1.0 },
    grainStrength: { value: (CONFIG.graphics && CONFIG.graphics.grainStrength != null) ? CONFIG.graphics.grainStrength : 0.04 },
    grainEnabled: { value: (CONFIG.graphics && CONFIG.graphics.grainEnabled !== false) ? 1.0 : 0.0 },
    brightness: { value: (CONFIG.graphics && CONFIG.graphics.brightness != null) ? CONFIG.graphics.brightness : 1.2 },
    contrast: { value: (CONFIG.graphics && CONFIG.graphics.contrast != null) ? CONFIG.graphics.contrast : 1.05 },
    gamma: { value: (CONFIG.graphics && CONFIG.graphics.gamma != null) ? CONFIG.graphics.gamma : 0.9 },
    lift: { value: (CONFIG.graphics && CONFIG.graphics.lift != null) ? CONFIG.graphics.lift : 0.04 },
    time: { value: 0 }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float colorLevels;
    uniform float ditherStrength;
    uniform float grainStrength;
    uniform float grainEnabled;
    uniform float brightness;
    uniform float contrast;
    uniform float gamma;
    uniform float lift;
    uniform float time;
    varying vec2 vUv;

    // 4x4 Bayer matrix scaled to [0, 1)
    float getBayer4(vec2 coord) {
      int x = int(mod(coord.x, 4.0));
      int y = int(mod(coord.y, 4.0));
      int idx = x + y * 4;
      if (idx == 0) return 0.0 / 16.0;
      if (idx == 1) return 8.0 / 16.0;
      if (idx == 2) return 2.0 / 16.0;
      if (idx == 3) return 10.0 / 16.0;
      if (idx == 4) return 12.0 / 16.0;
      if (idx == 5) return 4.0 / 16.0;
      if (idx == 6) return 14.0 / 16.0;
      if (idx == 7) return 6.0 / 16.0;
      if (idx == 8) return 3.0 / 16.0;
      if (idx == 9) return 11.0 / 16.0;
      if (idx == 10) return 1.0 / 16.0;
      if (idx == 11) return 9.0 / 16.0;
      if (idx == 12) return 15.0 / 16.0;
      if (idx == 13) return 7.0 / 16.0;
      if (idx == 14) return 13.0 / 16.0;
      return 5.0 / 16.0;
    }

    float rand(vec2 co) {
      return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec4 col = texture2D(tDiffuse, vUv);

      // Коррекция яркости, контраста, приподнятые тени и гамма (перед дизерингом и квантованием)
      col.rgb = col.rgb * brightness;
      col.rgb = (col.rgb - 0.5) * contrast + 0.5 + lift;
      col.rgb = pow(max(vec3(0.0), col.rgb), vec3(gamma));
      col.rgb = clamp(col.rgb, 0.0, 1.0);

      // 1. Дизеринг и квантование цвета (с нижним порогом 0.02, чтобы тени не чернели в ноль)
      if (ditherStrength > 0.001 && colorLevels > 1.0) {
        vec2 coord = vUv * resolution;
        float bayer = getBayer4(coord) - 0.5;
        col.rgb += (bayer * ditherStrength) / colorLevels;
        col.rgb = clamp(floor(col.rgb * colorLevels + 0.5) / colorLevels, 0.02, 1.0);
      }

      // 2. Ступенчатая зернистость (film grain) на частоте 12 Гц, без стробоскопа на 60+ FPS
      if (grainStrength > 0.001 && grainEnabled > 0.5) {
        float steppedTime = floor(time * 12.0) / 12.0;
        float noise = (rand(vUv + fract(steppedTime * 0.17)) - 0.5) * grainStrength;
        col.rgb = clamp(col.rgb + noise, 0.0, 1.0);
      }

      gl_FragColor = col;
    }
  `
};

export class ScreenEffects {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {Object} [opts]
   * @param {string} [opts.quality]
   */
  constructor(renderer, scene, camera, opts = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    this.drunkAmount = 0;
    this.weedAmount = 0;
    this._time = 0;

    const size = renderer.getSize(new THREE.Vector2());
    this._width = Math.max(1, size.x);
    this._height = Math.max(1, size.y);

    const isPsx = (CONFIG.graphics && CONFIG.graphics.styleName) !== "cartoon";
    const bloomCfg = isPsx
      ? ((CONFIG.graphics.style && CONFIG.graphics.style.psx) || CONFIG.graphics.bloom)
      : ((CONFIG.graphics.style && CONFIG.graphics.style.cartoon) || CONFIG.graphics.bloom);

    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(this._width, this._height),
      bloomCfg.bloomStrength != null ? bloomCfg.bloomStrength : bloomCfg.strength,
      bloomCfg.bloomRadius != null ? bloomCfg.bloomRadius : bloomCfg.radius,
      bloomCfg.bloomThreshold != null ? bloomCfg.bloomThreshold : bloomCfg.threshold
    );

    this.overlayPass = new OverlayPass();
    this.outputPass = new OutputPass();

    // PSX Dither & Quantization pass
    this.ditherPass = new ShaderPass(PsxDitherShader);
    this.ditherPass.material.toneMapped = false;
    this.ditherPass.material.uniforms.resolution.value.set(this._width, this._height);

    // Vignette pass
    this.vignettePass = new ShaderPass(VignetteShader);
    this.vignettePass.material.toneMapped = false;

    // Именованные дополнительные проходы (пьяный экран, косяк, инверсия...)
    this.extraPasses = new Map();

    this.quality = "high";
    this.settings = getQualitySettings("high");
    this.bloomEnabled = true;
    this.vignetteEnabled = true;
    this.ditherEnabled = isPsx;

    this.setQuality(opts.quality || CONFIG.graphics.mode || "high", false);
  }

  /**
   * Переключить режим качества: low / medium / high.
   * @param {"low"|"medium"|"high"} mode
   * @param {boolean} [applySize=true]
   */
  setQuality(mode, applySize = true) {
    const settings = getQualitySettings(mode);
    this.quality = mode;
    this.settings = settings;
    this.bloomEnabled = !!settings.bloom;
    this.vignetteEnabled = settings.vignette !== false;

    const isPsx = (CONFIG.graphics && CONFIG.graphics.styleName) !== "cartoon";
    this.ditherEnabled = isPsx && settings.dither !== false;

    setTexturesEnabled(settings.textures !== false);

    const maxRatio = settings.pixelRatio || 1;
    const ratio = Math.min(window.devicePixelRatio || 1, maxRatio);
    this.renderer.setPixelRatio(ratio);

    if (applySize) this._rebuild();
    else this._rebuild();
  }

  /**
   * Обновить стиль пост-обработки (psx / cartoon).
   * @param {"psx"|"cartoon"} styleName
   */
  setStyle(styleName) {
    const isPsx = styleName !== "cartoon";
    const bloomCfg = isPsx
      ? ((CONFIG.graphics.style && CONFIG.graphics.style.psx) || CONFIG.graphics.bloom)
      : ((CONFIG.graphics.style && CONFIG.graphics.style.cartoon) || CONFIG.graphics.bloom);

    this.bloomPass.strength = bloomCfg.bloomStrength != null ? bloomCfg.bloomStrength : bloomCfg.strength;
    this.bloomPass.radius = bloomCfg.bloomRadius != null ? bloomCfg.bloomRadius : bloomCfg.radius;
    this.bloomPass.threshold = bloomCfg.bloomThreshold != null ? bloomCfg.bloomThreshold : bloomCfg.threshold;

    this.ditherEnabled = isPsx && this.settings.dither !== false;
    this._rebuild();
  }

  /**
   * Пересобрать цепочку проходов (порядок фиксирован):
   * 1. RenderPass (сцена)
   * 2. UnrealBloomPass (слабый bloom)
   * 3. OverlayPass (вьюмодель оружия)
   * 4. ExtraPasses (drunk, weed...)
   * 5. OutputPass (sRGB тонемаппинг)
   * 6. PsxDitherPass (Bayer 4x4 дизеринг и квантование)
   * 7. VignettePass (виньетка)
   * @private
   */
  _rebuild() {
    const passes = this.composer.passes;
    passes.length = 0;

    // 1. Сцена
    this.composer.addPass(this.renderPass);

    // 2. Bloom
    if (this.bloomEnabled) this.composer.addPass(this.bloomPass);

    // 3. Вьюмодель оружия — после bloom, чтобы её тоже обрабатывали экранные эффекты расходников
    this.composer.addPass(this.overlayPass);

    // 4. Эффекты расходников (Drunk -> WeedTrail -> Weed)
    const priorities = { drunk: 0, weedTrail: 1, weed: 2 };
    const names = Array.from(this.extraPasses.keys()).sort(
      (a, b) => (priorities[a] ?? 10) - (priorities[b] ?? 10)
    );
    for (const name of names) {
      const entry = this.extraPasses.get(name);
      if (entry && entry.enabled !== false) this.composer.addPass(entry.pass);
    }

    // 5. Output sRGB
    this.composer.addPass(this.outputPass);

    // 6. PSX Dither & Color Quantization (только в режиме PSX и не на Low)
    if (this.ditherEnabled) {
      this.composer.addPass(this.ditherPass);
    }

    // 7. Виньетка
    if (this.vignetteEnabled) {
      this.composer.addPass(this.vignettePass);
    }

    this._applySizes();
  }

  /** @private */
  _applySizes() {
    const pr = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(pr);

    const scale = this.settings.bloomScale != null ? this.settings.bloomScale : 1;
    this.bloomPass.setSize(
      Math.max(1, Math.round(this._width * pr * scale)),
      Math.max(1, Math.round(this._height * pr * scale))
    );

    if (this.ditherPass && this.ditherPass.material && this.ditherPass.material.uniforms) {
      this.ditherPass.material.uniforms.resolution.value.set(
        Math.max(1, Math.round(this._width * pr)),
        Math.max(1, Math.round(this._height * pr))
      );
    }
  }

  /**
   * Добавить именованный проход (например, drunk/weed/invert).
   * @param {string} name
   * @param {Object} pass
   */
  addPass(name, pass) {
    if (!name || !pass) return;
    this.extraPasses.set(name, { pass, enabled: true });
    this._rebuild();
  }

  /**
   * Убрать проход по имени.
   * @param {string} name
   */
  removePass(name) {
    if (this.extraPasses.delete(name)) this._rebuild();
  }

  /**
   * Задать колбэк отрисовки вьюмодели оружия внутри композера.
   * @param {(renderer: THREE.WebGLRenderer) => void} fn
   */
  setOverlayRenderer(fn) {
    this.overlayPass.renderFn = typeof fn === "function" ? fn : null;
  }

  /**
   * Установить uniform именованного прохода.
   * @param {string} name
   * @param {string} uniform
   * @param {*} value
   * @returns {boolean}
   */
  setUniform(name, uniform, value) {
    const entry = this.extraPasses.get(name);
    if (!entry || !entry.pass || !entry.pass.uniforms) return false;
    const u = entry.pass.uniforms[uniform];
    if (!u) return false;
    u.value = value;
    return true;
  }

  /**
   * Включить/выключить проход (bloom, vignette, dither или добавленный по имени).
   * @param {string} name
   * @param {boolean} enabled
   */
  setPassEnabled(name, enabled) {
    if (name === "bloom") {
      this.bloomEnabled = !!enabled;
      this._rebuild();
      return;
    }
    if (name === "vignette") {
      this.vignetteEnabled = !!enabled;
      this._rebuild();
      return;
    }
    if (name === "dither") {
      this.ditherEnabled = !!enabled;
      this._rebuild();
      return;
    }
    const entry = this.extraPasses.get(name);
    if (entry) {
      entry.enabled = !!enabled;
      this._rebuild();
    }
  }

  /** @param {string} name */
  hasPass(name) {
    if (name === "bloom") return this.bloomEnabled;
    if (name === "vignette") return this.vignetteEnabled;
    if (name === "dither") return this.ditherEnabled;
    const entry = this.extraPasses.get(name);
    return !!(entry && entry.enabled !== false);
  }

  setDrunk(amount) {
    this.drunkAmount = amount;
  }

  setWeed(amount) {
    this.weedAmount = amount;
  }

  setBrightness(val) {
    if (this.ditherPass && this.ditherPass.material && this.ditherPass.material.uniforms && this.ditherPass.material.uniforms.brightness) {
      this.ditherPass.material.uniforms.brightness.value = Number(val) || 1.2;
    }
  }

  setGrainEnabled(enabled) {
    if (this.ditherPass && this.ditherPass.material && this.ditherPass.material.uniforms && this.ditherPass.material.uniforms.grainEnabled) {
      this.ditherPass.material.uniforms.grainEnabled.value = enabled ? 1.0 : 0.0;
    }
  }

  /**
   * Обновление времени для анимации шума и эффектов.
   * @param {number} dt
   */
  update(dt = 0.016) {
    this._time += dt;
    if (this.ditherPass && this.ditherPass.material && this.ditherPass.material.uniforms) {
      this.ditherPass.material.uniforms.time.value = this._time;
    }
  }

  /**
   * Изменение размера окна/канваса.
   * @param {number} width
   * @param {number} height
   */
  setSize(width, height) {
    this._width = Math.max(1, width);
    this._height = Math.max(1, height);
    this.composer.setSize(this._width, this._height);
    updateSnapResolution(this._width, this._height);
    this._applySizes();
  }

  /**
   * Рендер пост-обработки.
   * @param {number} [dt]
   */
  render(dt) {
    this.composer.render(dt);
  }

  dispose() {
    this.composer.dispose();
  }
}
