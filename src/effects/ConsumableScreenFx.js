// Экранные и «телесные» эффекты расходников: шейдеры Drunk/Weed, шлейф, звук.
// Визуальная сила плавно нарастает и затухает независимо от игровых таймеров.
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { AfterimagePass } from "three/addons/postprocessing/AfterimagePass.js";
import { DrunkShader } from "./DrunkShader.js";
import { WeedShader } from "./WeedShader.js";
import { CONFIG } from "../config.js";

export class ConsumableScreenFx {
  /**
   * @param {Object} screenEffects ScreenEffects
   * @param {Object} effects EffectsManager
   * @param {Object} [audio] AudioManager
   */
  constructor(screenEffects, effects, audio = null) {
    this.screenEffects = screenEffects;
    this.effects = effects;
    this.audio = audio;

    this.elapsed = 0;
    this.drunk = 0;        // сглаженная визуальная сила водки
    this.weed = 0;         // сглаженная визуальная сила косяка
    this.hangover = 0;     // отходняк после водки (0..1, 3 сек)
    this.hue = 0;          // текущий сдвиг оттенка 0..1
    this.drunkControl = 0; // сила для камеры/управления (включая отходняк)

    this.drunkPass = new ShaderPass(DrunkShader);
    this.weedPass = new ShaderPass(WeedShader);
    this.trailPass = null; // AfterimagePass создаётся на время косяка

    this._tone = null;
    this._ownCtx = false;
  }

  /**
   * @param {number} dt
   * @param {string} [quality] low | medium | high
   */
  update(dt, quality = "high") {
    if (!(dt > 0)) dt = 1 / 60;
    this.elapsed += dt;

    const cfg = CONFIG.effects.screen;
    const reduced = !!(CONFIG.effects.reduced && CONFIG.effects.reduced.active);
    const vodkaOn = this.effects.has("vodka");
    const jointOn = this.effects.has("joint");

    const targetDrunk = vodkaOn ? this.effects.getStrength("vodka") : 0;
    const targetWeed = jointOn ? this.effects.getStrength("joint") : 0;

    this.drunk = this._ease(this.drunk, targetDrunk, cfg.drunk.attack, cfg.drunk.release, dt);
    this.weed = this._ease(this.weed, targetWeed, cfg.weed.attack, cfg.weed.release, dt);

    // Отходняк: 3 секунды после окончания водки
    if (vodkaOn) {
      this.hangover = Math.max(this.hangover, this.drunk);
    } else if (this.hangover > 0) {
      this.hangover = Math.max(0, this.hangover - dt / Math.max(0.001, cfg.drunk.hangover));
    }

    this.drunkControl = Math.max(this.drunk, this.hangover * 0.5);

    // Сдвиг оттенка: круг за huePeriod, на силе быстрее
    let hueRate = (1 / Math.max(0.001, cfg.weed.huePeriod)) * (1 + 0.4 * this.weed);
    if (reduced) hueRate = Math.min(hueRate, 0.2);
    this.hue = (this.hue + dt * hueRate) % 1;

    const drunkVisual = Math.max(this.drunk, this.hangover * (cfg.drunk.hangoverBlur ?? 0.35));
    const weedVisual = this.weed;
    const low = quality === "low";

    // На low шейдеры отключены, игровые бонусы остаются
    const wantDrunk = !low && drunkVisual > 0.003;
    const wantWeed = !low && weedVisual > 0.003;
    const wantTrail = wantWeed && !reduced;

    this._syncPass("drunk", wantDrunk, this.drunkPass);
    this._syncPass("weed", wantWeed, this.weedPass);
    this._syncTrail(wantTrail);

    if (wantDrunk) {
      this.screenEffects.setUniform("drunk", "time", this.elapsed);
      this.screenEffects.setUniform("drunk", "strength", drunkVisual);
      this.screenEffects.setUniform("drunk", "reduced", reduced ? 1 : 0);
    }
    if (wantTrail) {
      const damp = Math.min(0.9, cfg.weed.trailDamp * weedVisual);
      this.screenEffects.setUniform("weedTrail", "damp", damp);
    }
    if (wantWeed) {
      this.screenEffects.setUniform("weed", "time", this.elapsed);
      this.screenEffects.setUniform("weed", "strength", weedVisual);
      this.screenEffects.setUniform("weed", "hue", this.hue);
      this.screenEffects.setUniform("weed", "reduced", reduced ? 1 : 0);
    }

    // Совместимость с существующим API ScreenEffects
    this.screenEffects.setDrunk(this.drunkControl);
    this.screenEffects.setWeed(weedVisual);

    // Звуковая заглушка звучит только пока косяк активен
    if (jointOn && weedVisual > 0.02) this._startTone();
    else if (!jointOn) this._stopTone();
  }

  /** @private */
  _ease(current, target, attack, release, dt) {
    // Экспоненциальное приближение: ~95% пути за attack/release секунд,
    // без рывков и без перелёта.
    const time = Math.max(0.001, target > current ? attack : release);
    const k = 1 - Math.exp((-3 * dt) / time);
    return current + (target - current) * k;
  }

  /** @private */
  _syncPass(name, want, pass) {
    const added = this.screenEffects.hasPass(name);
    if (want && !added) this.screenEffects.addPass(name, pass);
    else if (!want && added) this.screenEffects.removePass(name);
  }

  /**
   * Шлейф косяка: отдельный ping-pong буфер, создаётся на время эффекта
   * и освобождается при выключении/окончании.
   * @private
   */
  _syncTrail(want) {
    if (want) {
      if (!this.trailPass) {
        this.trailPass = new AfterimagePass();
        this.trailPass.uniforms.damp.value = 0;
      }
      if (!this.screenEffects.hasPass("weedTrail")) {
        this.screenEffects.addPass("weedTrail", this.trailPass);
      }
    } else if (this.trailPass) {
      this.screenEffects.removePass("weedTrail");
      this.trailPass.dispose();
      this.trailPass = null;
    }
  }

  /** @private */
  _startTone() {
    if (this._tone) return;

    // Если аудиоменеджер уже есть, используем только его контекст:
    // до первого жеста он ещё не создан — значит, просто молчим.
    let ctx = null;
    if (this.audio) {
      ctx = this.audio.ctx || null;
      if (!ctx) return;
    } else {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        ctx = new AC();
        this._ownCtx = true;
      } catch (err) {
        return;
      }
    }
    if (ctx.state === "suspended") {
      try {
        ctx.resume();
      } catch (err) {
        // Продолжим без звука
      }
    }

    const cfg = CONFIG.effects.screen.weed;
    try {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = cfg.audioFreq;

      // Медленное «бульканье»: частота и амплитуда гуляют
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 0.7;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 18;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);

      const ampLfo = ctx.createOscillator();
      ampLfo.type = "sine";
      ampLfo.frequency.value = 2.3;
      const ampDepth = ctx.createGain();
      ampDepth.gain.value = cfg.audioGain * 0.5;
      ampLfo.connect(ampDepth);

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 160;

      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      ampDepth.connect(gain.gain);

      osc.connect(filter);
      filter.connect(gain);
      const dest = this.audio && this.audio.master ? this.audio.master : ctx.destination;
      gain.connect(dest);

      osc.start();
      lfo.start();
      ampLfo.start();
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(cfg.audioGain, ctx.currentTime + 0.6);

      this._tone = { ctx, osc, lfo, ampLfo, gain };
    } catch (err) {
      this._tone = null;
    }
  }

  /** @private */
  _stopTone() {
    if (!this._tone) return;
    const { ctx, osc, lfo, ampLfo, gain } = this._tone;
    this._tone = null;

    try {
      const t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setTargetAtTime(0.00001, t, 0.15);
      osc.stop(t + 0.6);
      lfo.stop(t + 0.6);
      ampLfo.stop(t + 0.6);
    } catch (err) {
      // Узел уже остановлен
    }

    if (this._ownCtx) {
      this._ownCtx = false;
      setTimeout(() => {
        try {
          ctx.close();
        } catch (err) {
          // Игнорируем закрытие
        }
      }, 900);
    }
  }

  /**
   * Мягко выключить звук (например, при паузе), не сбрасывая эффекты.
   * При возврате в игру тон снова запустится в update().
   */
  suspend() {
    this._stopTone();
  }

  /** Полный сброс (смерть/рестарт): убрать проходы и звук. */
  reset() {
    this.drunk = 0;
    this.weed = 0;
    this.hangover = 0;
    this.hue = 0;
    this.drunkControl = 0;
    this.screenEffects.removePass("drunk");
    this.screenEffects.removePass("weedTrail");
    this.screenEffects.removePass("weed");
    if (this.trailPass) {
      this.trailPass.dispose();
      this.trailPass = null;
    }
    this._stopTone();
  }

  dispose() {
    this.reset();
  }
}
