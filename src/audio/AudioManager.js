// Аудиосистема игры: синтезированные звуки через Web Audio API (без внешних файлов)
// AudioContext создаётся лениво — только после первого жеста пользователя (клик/клавиша)
import { CONFIG } from "../config.js";

export class AudioManager {
  constructor() {
    this.soundEnabled = true;

    // Загрузка сохранённого уровня громкости
    let savedVol = 0.55;
    try {
      const stored = localStorage.getItem("fps_master_volume");
      if (stored !== null) savedVol = parseFloat(stored);
    } catch (e) {}
    this.masterVolume = Math.max(0, Math.min(1, isNaN(savedVol) ? 0.55 : savedVol));

    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.sounds = {};

    // Состояние серии подбора предметов (с повышением тона)
    this.pickupStreak = 0;
    this.lastPickupTime = 0;

    // Состояние сердцебиения при низком здоровье
    this.heartbeatTimer = 0;
    if (typeof window !== "undefined") {
      window._gameAudioInstance = this;
    }
  }

  /**
   * Создать или возобновить аудиоконтекст. Вызывается из Game.startGameWithSeed().
   */
  init() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      this.soundEnabled = false;
      return;
    }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.masterVolume;
    this.master.connect(this.ctx.destination);

    // Односекундный буфер белого шума для выстрелов, взрывов и шагов
    const len = this.ctx.sampleRate;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  /** Установить общую громкость 0..1 и сохранить в localStorage */
  setVolume(vol) {
    this.masterVolume = Math.max(0, Math.min(1, vol));
    if (this.master) this.master.gain.value = this.masterVolume;
    try {
      localStorage.setItem("fps_master_volume", this.masterVolume.toString());
    } catch (e) {}
  }

  /**
   * Случайная вариация высоты (detune) для разнообразия звуков
   * @param {number} [range]
   * @returns {number} множитель частоты (например 0.94 .. 1.06)
   */
  getPitchDetune(range) {
    const varRange =
      range !== undefined
        ? range
        : (CONFIG.feel && CONFIG.feel.audio && CONFIG.feel.audio.pitchVariation) || 0.08;
    return 1 + (Math.random() - 0.5) * 2 * varRange;
  }

  /** Тональный звук с частотной модуляцией и ADSR-огибающей */
  tone(freq, endFreq, dur, type = "sine", gain = 0.2, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, freq), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Шум с фильтром и огибающей */
  noise(dur, gain, filterFreq, filterType = "lowpass", delay = 0) {
    if (!this.ctx || !this.noiseBuffer) return;
    const t = this.ctx.currentTime + delay;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuffer;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = Math.max(10, filterFreq);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(this.master);
    s.start(t);
    s.stop(t + dur + 0.02);
  }

  /**
   * Обновление периодического сердцебиения при низком здоровье игрока
   * @param {number} dt
   * @param {number} health
   * @param {number} maxHealth
   */
  updateHeartbeat(dt, health, maxHealth) {
    const threshold = (CONFIG.feel && CONFIG.feel.audio && CONFIG.feel.audio.heartbeatThreshold) || 28;
    if (health > 0 && health <= threshold) {
      this.heartbeatTimer -= dt;
      if (this.heartbeatTimer <= 0) {
        const interval = (CONFIG.feel && CONFIG.feel.audio && CONFIG.feel.audio.heartbeatInterval) || 0.85;
        this.heartbeatTimer = interval;
        this.play("heartbeat", 0.9);
      }
    } else {
      this.heartbeatTimer = 0;
    }
  }

  /**
   * Воспроизведение звука по имени
   * @param {string} soundName
   * @param {number} [volume=1.0]
   */
  play(soundName, volume = 1.0) {
    if (!this.soundEnabled || !this.ctx || this.ctx.state === "closed") return;

    switch (soundName) {
      // 1. ДРОБОВИК: низкий удар с плотным шумом и саб-басом
      case "shot_shotgun": {
        const det = this.getPitchDetune(0.06);
        this.noise(0.24, 0.65 * volume, 850 * det, "lowpass");
        this.tone(150 * det, 40 * det, 0.22, "square", 0.35 * volume);
        this.tone(75 * det, 30 * det, 0.28, "sine", 0.5 * volume);
        break;
      }

      // 2. АК-47: короткий сухой хлопок с плотным нижним «ударом» и шумовым «треском»
      case "shot_ak47": {
        const now = this.ctx ? this.ctx.currentTime : performance.now() / 1000;
        // Ограничиваем частоту голосов (не менее 0.055 с между звуками), чтобы не было каши при непрерывной очереди
        if (this._lastAkShot && now - this._lastAkShot < 0.055) {
          break;
        }
        this._lastAkShot = now;

        const det = this.getPitchDetune(0.06);
        const rndVol = volume * (0.92 + Math.random() * 0.16);

        // Нижний пробивной удар (180 -> 48 Гц)
        this.tone(180 * det, 48 * det, 0.075, "triangle", 0.45 * rndVol);
        // Металлический сухой щелчок затвора
        this.tone(340 * det, 90 * det, 0.035, "square", 0.18 * rndVol);
        // Пороховой шумовой треск
        this.noise(0.065, 0.35 * rndVol, 1750 * det, "bandpass");
        break;
      }

      // 3. РАКЕТНИЦА: низкий глухой хлопок с шипением и коротким «свистом» ракеты (громче и ниже дробовика)
      case "shot_rocket": {
        const det = this.getPitchDetune(0.06);
        // Глубокий низкий хлопок ниже дробовика (95 -> 22 Гц и 65 -> 20 Гц)
        this.tone(95 * det, 22 * det, 0.44, "sine", 0.78 * volume);
        this.tone(65 * det, 20 * det, 0.38, "triangle", 0.55 * volume);
        // Глухой плотный шум выхлопа + шипение
        this.noise(0.45, 0.68 * volume, 320 * det, "lowpass");
        this.noise(0.32, 0.34 * volume, 1600 * det, "bandpass", 0.02);
        // Короткий «свист» улетающей ракеты
        this.tone(950 * det, 340 * det, 0.26, "sine", 0.22 * volume, 0.04);
        break;
      }

      // МЕХАНИЧЕСКИЙ ЩЕЛЧОК РАКЕТНИЦЫ (два тона при опускании трубы после выстрела)
      case "rocket_reload_click": {
        const det = this.getPitchDetune(0.05);
        this.tone(420 * det, 260 * det, 0.035, "triangle", 0.18 * volume);
        this.tone(680 * det, 480 * det, 0.03, "square", 0.12 * volume, 0.055);
        break;
      }

      // ПЕРЕЗАРЯДКА ОРУЖИЯ
      case "reload": {
        const det = this.getPitchDetune(0.04);
        this.tone(320 * det, 180 * det, 0.045, "triangle", 0.22 * volume);
        this.noise(0.05, 0.14 * volume, 1200 * det, "bandpass", 0.02);
        this.tone(540 * det, 760 * det, 0.04, "square", 0.14 * volume, 0.22);
        break;
      }

      // СУХОЙ ЩЕЛЧОК (ПУСТОЙ МАГАЗИН)
      case "empty_click": {
        const det = this.getPitchDetune(0.06);
        this.tone(900 * det, 420 * det, 0.025, "square", 0.16 * volume);
        break;
      }

      // ВЗРЫВ РАКЕТЫ: глубокий удар, треск и пламя
      case "explosion": {
        const det = this.getPitchDetune(0.08);
        this.noise(0.6, 0.7 * volume, 420 * det);
        this.tone(110 * det, 24 * det, 0.55, "sine", 0.45 * volume);
        this.noise(0.25, 0.35 * volume, 1800, "bandpass", 0.03);
        break;
      }

      // ВЗРЫВ БОЧКИ: низкий бум, металлический лязг и разлетающиеся обломки
      case "barrel_explosion": {
        const det = this.getPitchDetune(0.1);
        this.noise(0.7, 0.72 * volume, 380 * det, "lowpass");
        this.tone(100 * det, 22 * det, 0.6, "sine", 0.5 * volume);
        this.tone(260 * det, 70 * det, 0.14, "square", 0.2 * volume, 0.01);
        this.noise(0.28, 0.35 * volume, 2100, "bandpass", 0.03);
        this.noise(0.5, 0.2 * volume, 900, "highpass", 0.12);
        break;
      }

      // ПОПАДАНИЕ ПО ВРАГУ: чёткий тактильный щелчок с вариациями высоты
      case "hit": {
        const det = this.getPitchDetune(0.12);
        this.tone(850 * det, 420 * det, 0.045, "triangle", 0.22 * volume);
        this.noise(0.03, 0.18 * volume, 3200 * det, "highpass");
        break;
      }

      // ХЕДШОТ: звонкий сочный перезвон (гармоника «дзынь»)
      case "headshot": {
        const det = this.getPitchDetune(0.04);
        this.tone(1760 * det, 1760 * det, 0.18, "sine", 0.26 * volume);
        this.tone(2640 * det, 2640 * det, 0.14, "triangle", 0.2 * volume);
        this.tone(880 * det, 440 * det, 0.08, "square", 0.12 * volume);
        break;
      }

      // УБИЙСТВО: тяжёлый отклик с хрустом и подтверждением
      case "kill": {
        const det = this.getPitchDetune(0.06);
        this.tone(440 * det, 110 * det, 0.22, "sawtooth", 0.28 * volume);
        this.tone(220 * det, 55 * det, 0.28, "triangle", 0.32 * volume);
        this.noise(0.14, 0.28 * volume, 1100, "bandpass");
        break;
      }

      // МУЛЬТИКИЛЛ: триумфальный фанфарный аккорд
      case "multikill": {
        this.tone(440, 440, 0.28, "triangle", 0.25 * volume);
        this.tone(554.37, 554.37, 0.28, "triangle", 0.25 * volume, 0.05);
        this.tone(659.25, 659.25, 0.32, "triangle", 0.3 * volume, 0.1);
        this.tone(880, 880, 0.4, "sine", 0.35 * volume, 0.15);
        this.noise(0.2, 0.25 * volume, 2000, "bandpass", 0.15);
        break;
      }

      // РЫВОК: свист рассекаемого воздуха
      case "dash": {
        const det = this.getPitchDetune(0.08);
        this.noise(0.22, 0.34 * volume, 2800 * det, "bandpass");
        this.tone(350 * det, 700 * det, 0.18, "sine", 0.16 * volume);
        break;
      }

      // ПРЫЖОК
      case "jump": {
        const det = this.getPitchDetune(0.06);
        this.tone(260 * det, 480 * det, 0.12, "triangle", 0.16 * volume);
        break;
      }

      // ДВОЙНОЙ ПРЫЖОК: звонче и выше тоном
      case "double_jump": {
        const det = this.getPitchDetune(0.06);
        this.tone(420 * det, 720 * det, 0.13, "sine", 0.18 * volume);
        this.noise(0.08, 0.12 * volume, 3200, "highpass");
        break;
      }

      // ПРИЗЕМЛЕНИЕ: плотный глухой шлепок
      case "land": {
        const det = this.getPitchDetune(0.06);
        this.noise(0.14, 0.35 * volume, 350 * det, "lowpass");
        this.tone(120 * det, 45 * det, 0.16, "sine", 0.32 * volume);
        break;
      }

      // ШАГИ: тихий глухой шаг по полу
      case "step": {
        const det = this.getPitchDetune(0.14);
        this.noise(0.06, 0.08 * volume, 380 * det, "lowpass");
        this.tone(75 * det, 40 * det, 0.05, "sine", 0.07 * volume);
        break;
      }

      // ПАДЕНИЕ ГИЛЬЗЫ ДРОБОВИКА: тихий металлический щелчок (синтез)
      case "shell_drop":
      case "shell": {
        const det = this.getPitchDetune(0.12);
        this.tone(2400 * det, 1200 * det, 0.025, "triangle", 0.07 * volume);
        this.noise(0.02, 0.05 * volume, 4200 * det, "highpass");
        break;
      }

      // ПАДЕНИЕ ГИЛЬЗЫ АК-47: тихий латунный звон (не чаще 4 звуков в секунду)
      case "shell_drop_ak": {
        const now = (this.ctx ? this.ctx.currentTime : 0) || performance.now() * 0.001;
        if (this._lastAkShellSound && now - this._lastAkShellSound < 0.25) {
          break;
        }
        this._lastAkShellSound = now;
        const det = this.getPitchDetune(0.15);
        this.tone(3600 * det, 2200 * det, 0.03, "sine", 0.055 * volume);
        this.tone(5200 * det, 3400 * det, 0.02, "triangle", 0.03 * volume);
        break;
      }

      // ПОДБОР ПРЕДМЕТА: с повышением тона при серии в течение 1.6 с
      case "pickup": {
        const now = (this.ctx ? this.ctx.currentTime : 0) || performance.now() * 0.001;
        const windowSec =
          (CONFIG.feel && CONFIG.feel.audio && CONFIG.feel.audio.pickupStreakWindow) || 1.6;
        if (now - this.lastPickupTime < windowSec) {
          this.pickupStreak = Math.min(8, this.pickupStreak + 1);
        } else {
          this.pickupStreak = 0;
        }
        this.lastPickupTime = now;

        const semitone =
          (CONFIG.feel && CONFIG.feel.audio && CONFIG.feel.audio.pickupStreakStep) || 1.05946;
        const streakPitch = Math.pow(semitone, this.pickupStreak);

        this.tone(520 * streakPitch, 520 * streakPitch, 0.09, "sine", 0.18 * volume);
        this.tone(780 * streakPitch, 780 * streakPitch, 0.12, "sine", 0.18 * volume, 0.08);
        break;
      }

      // УРОН ИГРОКУ: глухой удар и помехи
      case "damage": {
        const det = this.getPitchDetune(0.08);
        this.noise(0.2, 0.35 * volume, 1100 * det, "bandpass");
        this.tone(180 * det, 75 * det, 0.2, "square", 0.22 * volume);
        break;
      }

      // СЕРДЦЕБИЕНИЕ: тревожный низкий двойной стук при низком здоровье
      case "heartbeat": {
        this.tone(70, 35, 0.14, "sine", 0.36 * volume);
        this.tone(60, 30, 0.14, "sine", 0.3 * volume, 0.12);
        this.noise(0.12, 0.15 * volume, 200, "lowpass");
        break;
      }

      // ДОБИВАНИЕ
      case "glory": {
        this.tone(180, 60, 0.5, "sawtooth", 0.32 * volume);
        this.noise(0.35, 0.3 * volume, 500, "lowpass", 0.1);
        this.tone(700, 120, 0.35, "triangle", 0.15 * volume, 0.18);
        break;
      }

      // ВОЛНА
      case "wave": {
        this.tone(330, 330, 0.18, "triangle", 0.18 * volume);
        this.tone(440, 440, 0.25, "triangle", 0.18 * volume, 0.18);
        break;
      }

      // ПОВЫШЕНИЕ СТУПЕНИ СТИЛЯ: аккорд/глиссандо, высота растёт со ступенью
      case "style_rank_up": {
        const rank = typeof volume === "number" && volume >= 1 ? Math.min(5, Math.round(volume)) : 1;
        this.playStyleRankUp(rank);
        break;
      }

      // ПОНИЖЕНИЕ СТУПЕНИ СТИЛЯ: тихий звук падения и приглушения
      case "style_rank_down": {
        this.playStyleRankDown(volume);
        break;
      }

      default:
        break;
    }
  }

  /**
   * Воспроизведение звука повышения ступени стиля (высота тона растёт со ступенью)
   * @param {number} [rank=1]
   */
  playStyleRankUp(rank = 1) {
    if (!this.soundEnabled || !this.ctx || this.ctx.state === "closed") return;
    const baseFreqs = [280, 360, 460, 580, 740, 960];
    const freq = baseFreqs[Math.max(0, Math.min(5, rank))] || 360;
    const det = this.getPitchDetune(0.03);
    this.tone(freq * det, freq * 1.35 * det, 0.2, "triangle", 0.35);
    this.tone(freq * 1.25 * det, freq * 1.8 * det, 0.25, "sine", 0.3, 0.04);
  }

  /**
   * Воспроизведение тихого звука понижения ступени стиля
   * @param {number} [volume=1.0]
   */
  playStyleRankDown(volume = 1.0) {
    if (!this.soundEnabled || !this.ctx || this.ctx.state === "closed") return;
    const det = this.getPitchDetune(0.04);
    this.tone(280 * det, 110 * det, 0.3, "sine", 0.2 * volume);
    this.noise(0.16, 0.1 * volume, 320, "lowpass");
  }
}
