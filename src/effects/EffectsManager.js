// Активные эффекты расходников: водка и косяк.
// Хранит время/силу, считает множители движения, урона, гравитации и времени.
import { CONFIG } from "../config.js";

export class EffectsManager {
  /**
   * @param {Object} [config] секция CONFIG.effects
   */
  constructor(config = CONFIG.effects) {
    this.cfg = config;
    this.active = new Map();
  }

  /**
   * Применить эффект. Повторный приём не создаёт копию:
   * продлевает время и повышает силу на strengthStep.
   * @param {"vodka"|"joint"} type
   * @param {number} [duration] длительность в секундах (по умолчанию из CONFIG)
   * @param {number} [strength] стартовая сила (по умолчанию initialStrength)
   * @returns {Object|null}
   */
  apply(type, duration, strength) {
    const def = this.cfg[type];
    if (!def || typeof def !== "object") return null;

    const maxDuration = this.cfg.maxDuration ?? 60;
    const addTime = Math.max(0, duration != null ? duration : def.duration ?? 0);
    const startStrength = Math.min(
      1,
      Math.max(0, strength != null ? strength : this.cfg.initialStrength ?? 0.5)
    );

    let fx = this.active.get(type);
    if (fx) {
      // Продление и усиление без дубликата
      fx.timeLeft = Math.min(maxDuration, fx.timeLeft + addTime);
      fx.duration = Math.max(fx.duration, fx.timeLeft);
      fx.strength = Math.min(1, fx.strength + (this.cfg.strengthStep ?? 0.25));
    } else {
      const timeLeft = Math.min(maxDuration, addTime);
      fx = { type, timeLeft, duration: timeLeft, strength: startStrength };
      this.active.set(type, fx);
    }
    return fx;
  }

  /**
   * Снять эффект досрочно.
   * @param {string} type
   */
  remove(type) {
    this.active.delete(type);
  }

  /** Снять все эффекты (смерть, рестарт). */
  clear() {
    this.active.clear();
  }

  /**
   * Обновление таймеров. Вызывать с реальным dt (rawDt), чтобы
   * замедление времени добиванием не растягивало эффекты.
   * @param {number} dt
   */
  update(dt) {
    if (!(dt > 0) || this.active.size === 0) return;
    for (const [type, fx] of this.active) {
      fx.timeLeft -= dt;
      if (fx.timeLeft <= 0) this.active.delete(type);
    }
  }

  /** @param {string} type */
  has(type) {
    return this.active.has(type);
  }

  /**
   * Сила эффекта (0, если не активен).
   * @param {string} type
   * @returns {number}
   */
  getStrength(type) {
    const fx = this.active.get(type);
    return fx ? fx.strength : 0;
  }

  /** Активные эффекты для HUD. */
  getActive() {
    return Array.from(this.active.values());
  }

  /**
   * Визуальная сила для будущих экранных шейдеров
   * (учитывает переключатель «Ослабить эффекты»).
   * @param {string} type
   */
  getVisualStrength(type) {
    const s = this.getStrength(type);
    if (s <= 0) return 0;
    return this.cfg.reduced && this.cfg.reduced.active
      ? s * (this.cfg.reduced.visualScale ?? 0.5)
      : s;
  }

  /**
   * Множитель эффекта с учётом силы: до порога растёт линейно,
   * после порога остаётся на заданном значении.
   * @private
   */
  _scale(type, key) {
    const fx = this.active.get(type);
    if (!fx) return 1;
    const def = this.cfg[type];
    const target = def ? def[key] : undefined;
    if (target == null) return 1;
    const threshold = Math.max(0.01, this.cfg.strengthThreshold ?? 0.5);
    const k = Math.min(1, fx.strength / threshold);
    return 1 + (target - 1) * k;
  }

  /** @private */
  _combine(key) {
    let mult = 1;
    for (const type of this.active.keys()) {
      mult *= this._scale(type, key);
    }
    return mult;
  }

  get moveSpeedMult() {
    return this._combine("moveSpeedMult");
  }

  get damageTakenMult() {
    return this._combine("damageTakenMult");
  }

  get gravityMult() {
    return this._combine("gravityMult");
  }

  get timeScaleMult() {
    return this._combine("timeScaleMult");
  }
}
