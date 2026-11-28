// Главный класс игры: цикл requestAnimationFrame, состояние (меню, игра, пауза, смерть), время и связывание подсистем
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { World } from "../world/World.js";
import { Player } from "../player/Player.js";
import { Input } from "./Input.js";
import { Particles } from "../effects/Particles.js";
import { Decals } from "../effects/Decals.js";
import { Gore } from "../effects/Gore.js";
import { ScreenEffects } from "../effects/ScreenEffects.js";
import { EffectsManager } from "../effects/EffectsManager.js";
import { ConsumableScreenFx } from "../effects/ConsumableScreenFx.js";
import { FunnyFaces } from "../effects/FunnyFaces.js";
import { Tracers } from "../effects/Tracers.js";
import { AudioManager } from "../audio/AudioManager.js";
import { Shotgun } from "../weapons/Shotgun.js";
import { Ak47 } from "../weapons/Ak47.js";
import { RocketLauncher } from "../weapons/RocketLauncher.js";
import { Projectiles } from "../weapons/Projectiles.js";
import { Viewmodel } from "../weapons/Viewmodel.js";
import { EnemyManager } from "../enemies/EnemyManager.js";
import { PickupManager } from "../items/PickupManager.js";
import { BarrelManager } from "../world/ExplosiveBarrel.js";
import { GloryKill } from "../glory/GloryKill.js";
import { LevelGenerator } from "../world/LevelGenerator.js";
import { validateArenaRoom } from "../world/ArenaTemplates.js";
import { LevelManager } from "../world/LevelManager.js";
import { HUD } from "../ui/HUD.js";
import { initAllModels, hasShotgunModel } from "./ModelCache.js";
import { StyleMeter } from "./StyleMeter.js";
import { PerkManager } from "./Perks.js";
import { RunStats, RecordStore } from "./RunStats.js";
import { Overlays } from "../ui/Overlays.js";
import { setGraphicsStyle as setMaterialStyle, setVertexSnap, updateSnapResolution } from "../world/Materials.js";
import { applyThemeStyle } from "../world/Themes.js";

export class Game {
  constructor() {
    this.CONFIG = CONFIG;
    this.state = "menu"; // menu, playing, paused, death
    this.timeScale = 1.0;
    this.clock = new THREE.Clock();

    // Сложность текущего/следующего забега
    this.difficulty = this._loadDifficulty();
    this.runDifficulty = this.difficulty;
    this.difficultyCfg = CONFIG.difficulty.modes[this.difficulty] || CONFIG.difficulty.modes.normal;
    this.runActive = false;
    this.runDaily = false;
    this.modalOpen = false;
    this.summaryOpen = false;
    this.perkChoice = null;
    this._debugFinish = false;
    // Отладочное меню (F2) и режим бессмертия из него
    this.debugMenuOpen = false;
    this.debugGodMode = false;
    // Редактор дробовика и редактор рук (отладочная панель)
    this.shotgunEditorOpen = false;
    this.armsEditorOpen = false;
    this.lastChanceTimer = 0;
    this.lastChanceCooldown = 0;

    // Расходники и эффекты (водка/косяк)
    this.effects = new EffectsManager();
    this.consumables = { vodka: 0, joint: 0 };
    this.lastPickedConsumable = null;

    // Загрузка настроек ретро-хоррор стиля PSX
    this.graphicsStyle = this._loadGraphicsStyle();
    CONFIG.graphics.styleName = this.graphicsStyle;
    applyThemeStyle(this.graphicsStyle);
    setMaterialStyle(this.graphicsStyle);

    CONFIG.graphics.pixelHeight = this._loadPixelHeight();
    CONFIG.graphics.vertexSnap = this._loadVertexSnap();
    setVertexSnap(CONFIG.graphics.vertexSnap);
    this.brightness = this._loadBrightness();
    CONFIG.graphics.brightness = this.brightness;
    this.grainEnabled = this._loadGrainEnabled();
    CONFIG.graphics.grainEnabled = this.grainEnabled;
    this.flickerEnabled = this._loadFlickerEnabled();
    CONFIG.graphics.flickerEnabled = this.flickerEnabled;

    // Настройка Three.js Renderer (без сглаживания для пиксельного ретро-вида)
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.domElement.id = "game-canvas";
    this.renderer.domElement.className = "game-canvas";
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.autoClear = false;
    document.body.prepend(this.renderer.domElement);

    // Основная сцена и камера
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      CONFIG.camera.fov,
      window.innerWidth / window.innerHeight,
      CONFIG.camera.near,
      CONFIG.camera.far
    );

    // Пользовательский интерфейс (HUD)
    this.hud = new HUD();
    this.hud.setGraphicsStyle(this.graphicsStyle);
    this.hud.setPixelResolution(CONFIG.graphics.pixelHeight);
    this.hud.setVertexSnap(CONFIG.graphics.vertexSnap);
    this.hud.setBrightness(this.brightness);
    this.hud.setGrainEnabled(this.grainEnabled);
    this.hud.setFlickerEnabled(this.flickerEnabled);

    // Загрузка сохранённого FOV и режима рендеринга оружия
    const initialFov = this._loadFov();
    this.setFov(initialFov, false);
    this._loadWeaponInComposer();

    // Режим качества графики: сохраняется между сессиями
    this.graphicsQuality = this._loadGraphicsQuality();

    // Инициализация графики и эффектов
    this.particles = new Particles(this.scene);
    this.decals = new Decals(this.scene);
    this.tracers = new Tracers(this.scene);
    this.gore = new Gore(this.scene, this.decals);
    this.screenEffects = new ScreenEffects(this.renderer, this.scene, this.camera, {
      quality: this.graphicsQuality
    });
    this.screenEffects.setStyle(this.graphicsStyle);
    this.audio = new AudioManager();
    this.setupFx();

    // Визуальные эффекты расходников и смешные лица
    this.consumableScreenFx = new ConsumableScreenFx(this.screenEffects, this.effects, this.audio);
    this.funnyFaces = new FunnyFaces(this.scene);
    this._drunkMaxShown = false;

    // Мир и процедурный уровень
    const inputSeed = this.hud.el.seedInput && this.hud.el.seedInput.value.trim()
      ? this.hud.el.seedInput.value.trim()
      : undefined;
    this.world = new World(this.scene, inputSeed);
    this.player = new Player(this.camera);
    if (this.world.startRoom) {
      this.player.reset(this.world.startRoom.center);
    }
    this.hud.setSeed(this.world.seed);

    // Оружие и снаряды
    this.projectiles = new Projectiles(this.scene, this);
    this.weapons = [
      new Shotgun(this),
      new Ak47(this),
      new RocketLauncher(this)
    ];
    this.currentWeaponIndex = 0;
    this.currentWeapon = this.weapons[0];
    this.weaponSwitchTimer = 0;

    // Оружие от первого лица
    this.viewmodel = new Viewmodel(this.scene, this.camera, this.audio);
    // Вьюмодель рисуется внутри композера, чтобы на неё действовали эффекты
    this.screenEffects.setOverlayRenderer((renderer) => this.viewmodel.render(renderer));

    // Первичная подстройка разрешения рендера
    this.onResize();

    // Враги, предметы, добивания
    this.enemyManager = new EnemyManager(this.scene, this.world, this);
    this.pickupManager = new PickupManager(this.scene, this);
    this.barrels = new BarrelManager(this);
    this.gloryKill = new GloryKill(this);

    // Игровая статистика
    this.kills = 0;
    this.gloryKills = 0;
    this.score = 0;
    this.killsSinceQuote = 0;
    this.quoteCooldown = 0;

    // Стиль-метр (комбо-система)
    this.styleMeter = new StyleMeter(this);
    this.styleMeter.onRankUp = (newRank, oldRank, rankInfo, canFlash) => {
      if (canFlash) {
        this.hud.triggerStyleFlash(rankInfo.color);
      }
      this.audio.playStyleRankUp(newRank);
      if (this.hud.showCenterTitle) {
        this.hud.showCenterTitle(rankInfo.name + "!", "style", 1200);
      }
    };
    this.styleMeter.onRankDown = (newRank, oldRank, rankInfo) => {
      this.audio.playStyleRankDown();
    };
    this.styleMeter.onScoreGained = () => {
      this.hud.shakeStyleMeter();
    };

    // Перки между уровнями и статистика забега
    this.perks = new PerkManager(this);
    this.runStats = new RunStats(this);
    this.records = new RecordStore();
    this.overlays = new Overlays(this);
    this.hud.overlays = this.overlays;
    this.overlays.setPerks([]);
    if (this.player) this.player.mods = this.perks.mods;

    // Сочность и отклик (Game Feel)
    this.hitstopTimer = 0;
    this.slowmoTimer = 0;
    this.recentKillTimes = [];

    // Арены, двери, прогрессия уровней и лифт
    this.levelManager = new LevelManager(this);
    this._hookArenaClearConsumables();

    this.hud.initWeaponSlots(this.weapons);
    this.hud.selectWeapon(this.currentWeapon, this.currentWeaponIndex);
    this.hud.setGraphicsQuality(this.graphicsQuality);
    this.hud.updateConsumables(this.consumables);
    this.hud.updateEffects(this.effects);

    // Кнопки отладочного меню (F2) вызывают готовые действия Game
    this.hud.onDebugAction = (action) => this.handleDebugAction(action);
    this.hud.setDebugGod(this.debugGodMode);
    this.hud.setDebugWeaponRender(CONFIG.graphics.weaponInComposer !== false);

    // Стиль зомби (мультяшный / pbr)
    this.zombieStyle = this._loadZombieStyle();
    this.hud.setZombieStyle(this.zombieStyle);

    // Загрузка 3D-моделей до старта игры: блокировка кнопки «ИГРАТЬ»
    this.modelsReady = false;
    if (this.hud.el.startBtn) {
      this.hud.el.startBtn.disabled = true;
      this.hud.el.startBtn.textContent = "Загрузка...";
    }
    initAllModels()
      .then(() => {
        this.modelsReady = true;
        // Уровень уже построен — заменяем запасные бочки настоящей моделью
        if (this.barrels) this.barrels.onModelsReady();
        // Заменяем запасные коробки патронов на 3D-модели
        if (this.pickupManager) this.pickupManager.onModelsReady();
        // Заменяем процедурную вьюмодель дробовика на 3D-модель, если она загрузилась
        if (this.viewmodel) this.viewmodel.onModelsReady();
        if (this.hud.el.startBtn) {
          this.hud.el.startBtn.disabled = false;
          this.hud.el.startBtn.textContent = "ИГРАТЬ";
        }
      })
      .catch((err) => {
        console.error("Failed to load models:", err);
        this.modelsReady = true;
        if (this.barrels) this.barrels.onModelsReady();
        if (this.viewmodel) this.viewmodel.onModelsReady();
        if (this.hud.el.startBtn) {
          this.hud.el.startBtn.disabled = false;
          this.hud.el.startBtn.textContent = "ИГРАТЬ";
        }
      });

    // Автоснижение качества: средний FPS за окно
    this._perfTime = 0;
    this._perfFrames = 0;
    this._perfPromptShown = false;

    // Состояние портала/лифта
    this.portalCooldown = 0;
    this.exitHintShown = false;

    // Предварительная компиляция шейдеров сцены и вьюмодели
    try {
      this.renderer.compile(this.scene, this.camera);
      if (this.viewmodel) {
        this.renderer.compile(this.viewmodel.wScene, this.viewmodel.wCam);
      }
    } catch (e) {
      console.warn("Shader precompilation error:", e);
    }

    // Ввод пользователя
    this.setupInput();

    // Экспорт функции тестирования уровней в консоль
    this.setupTestLevels();

    // Консольный отладочный интерфейс (window.dbg, только при читах)
    this.setupDebugConsole();

    // Слушатель изменения размера окна
    window.addEventListener("resize", () => this.onResize());

    // Запуск главного игрового цикла
    this.loop();
  }

  /** Общий объект эффектов: создаётся один раз, чтобы не аллоцировать в горячем пути */
  setupFx() {
    this._fx = {
      particles: this.particles,
      decals: this.decals,
      tracers: this.tracers,
      gore: this.gore,
      bloodSpray: (p, n, dmg, color) => this.gore.bloodSpray(p, n, dmg, color, this.particles),
      explosion: (p) => this.gore.explosion(p, this.particles),
      popup: (x, y, z, val, isHeadshot) => this.gore.popup(x, y, z, val, isHeadshot),
      zombieGibs: (pos, count, isHeadshot) => this.gore.zombieGibs(pos, count, isHeadshot),
      spawnGibs: (pos, count, colors, isHeadshot) => this.gore.spawnGibs(pos, count, colors, isHeadshot),
      spawnHead: (pos, vel, color, size) => this.gore.spawnHead(pos, vel, color, size),
      sparks: (p, n, color, count) => this.particles.sparks(p, n, color, count)
    };
  }

  // Общий объект эффектов для совместимости
  get fx() {
    return this._fx;
  }

  /**
   * Прочитать сохранённый стиль графики (psx / cartoon).
   * @returns {"psx"|"cartoon"}
   * @private
   */
  _loadGraphicsStyle() {
    try {
      const saved = localStorage.getItem("fps_graphics_style");
      if (saved === "psx" || saved === "cartoon") return saved;
    } catch (_) {}
    return CONFIG.graphics.styleName || "psx";
  }

  /**
   * Прочитать сохранённую высоту виртуального разрешения пикселизации.
   * @returns {number|null}
   * @private
   */
  _loadPixelHeight() {
    try {
      const saved = localStorage.getItem("fps_pixel_height");
      if (saved === "off") return null;
      if (saved !== null) {
        const val = parseInt(saved, 10);
        if (!isNaN(val) && val > 0) return val;
      }
    } catch (_) {}
    return CONFIG.graphics.pixelHeight !== undefined ? CONFIG.graphics.pixelHeight : 360;
  }

  /**
   * Прочитать сохранённую силу дрожания вершин PS1 (0=выкл, 1=слабо, 2=сильно).
   * @returns {number}
   * @private
   */
  _loadVertexSnap() {
    try {
      const saved = localStorage.getItem("fps_vertex_snap");
      if (saved !== null) {
        const val = parseInt(saved, 10);
        if (!isNaN(val)) return val;
      }
    } catch (_) {}
    return CONFIG.graphics.vertexSnap !== undefined ? CONFIG.graphics.vertexSnap : 1;
  }

  /**
   * Переключить визуальный стиль между ретро-хоррором PSX и классическим Картуном.
   * @param {"psx"|"cartoon"} style
   * @param {boolean} [persist=true]
   */
  setGraphicsStyle(style, persist = true) {
    if (style !== "psx" && style !== "cartoon") return;
    this.graphicsStyle = style;
    CONFIG.graphics.styleName = style;

    applyThemeStyle(style);
    setMaterialStyle(style);

    // В PSX стиле зомби всегда PBR без обводки
    if (style === "psx") {
      this.setZombieStyle("pbr", false);
    }

    if (this.screenEffects) {
      this.screenEffects.setStyle(style);
    }
    if (this.viewmodel) {
      this.viewmodel.buildModels();
    }
    if (this.enemyManager) {
      this.enemyManager.updateZombieStyle(this.zombieStyle, this.graphicsQuality);
    }
    this.hud.setGraphicsStyle(style);

    if (persist) {
      try {
        localStorage.setItem("fps_graphics_style", style);
      } catch (_) {}
    }
  }

  /**
   * Установить виртуальную высоту пикселизации (240 / 360 / 480 / null=выкл).
   * @param {number|null} height
   * @param {boolean} [persist=true]
   */
  setPixelHeight(height, persist = true) {
    CONFIG.graphics.pixelHeight = height;
    this.onResize();
    this.hud.setPixelResolution(height);
    if (persist) {
      try {
        localStorage.setItem("fps_pixel_height", height === null ? "off" : String(height));
      } catch (_) {}
    }
  }

  /**
   * Установить силу дрожания вершин PS1 (0=выкл, 1=слабо, 2=сильно).
   * @param {number} level
   * @param {boolean} [persist=true]
   */
  setVertexSnap(level, persist = true) {
    const lvl = Number(level) || 0;
    CONFIG.graphics.vertexSnap = lvl;
    setVertexSnap(lvl);
    this.hud.setVertexSnap(lvl);
    if (persist) {
      try {
        localStorage.setItem("fps_vertex_snap", String(lvl));
      } catch (_) {}
    }
  }

  /**
   * Прочитать сохранённое значение яркости (0.7 - 1.8).
   * @returns {number}
   * @private
   */
  _loadBrightness() {
    try {
      const saved = localStorage.getItem("fps_brightness");
      if (saved !== null) {
        const val = parseFloat(saved);
        if (!isNaN(val) && val >= 0.5 && val <= 2.5) return val;
      }
    } catch (_) {}
    return CONFIG.graphics.brightness !== undefined ? CONFIG.graphics.brightness : 1.2;
  }

  /**
   * Прочитать сохранённое состояние зернистости (film grain).
   * @returns {boolean}
   * @private
   */
  _loadGrainEnabled() {
    try {
      const saved = localStorage.getItem("fps_grain_enabled");
      if (saved !== null) return saved === "1";
    } catch (_) {}
    return CONFIG.graphics.grainEnabled !== false;
  }

  /**
   * Прочитать сохранённое состояние мигания ламп.
   * @returns {boolean}
   * @private
   */
  _loadFlickerEnabled() {
    try {
      const saved = localStorage.getItem("fps_flicker_enabled");
      if (saved !== null) return saved === "1";
    } catch (_) {}
    return CONFIG.graphics.flickerEnabled !== false;
  }

  /**
   * Установить яркость рендера.
   * @param {number} val
   * @param {boolean} [persist=true]
   */
  setBrightness(val, persist = true) {
    const v = Math.max(0.5, Math.min(2.5, Number(val) || 1.2));
    this.brightness = v;
    CONFIG.graphics.brightness = v;
    if (this.screenEffects) {
      this.screenEffects.setBrightness(v);
    }
    this.hud.setBrightness(v);
    if (persist) {
      try {
        localStorage.setItem("fps_brightness", v.toFixed(2));
      } catch (_) {}
    }
  }

  /**
   * Включить/выключить зернистость (film grain).
   * @param {boolean} enabled
   * @param {boolean} [persist=true]
   */
  setGrainEnabled(enabled, persist = true) {
    const en = !!enabled;
    this.grainEnabled = en;
    CONFIG.graphics.grainEnabled = en;
    if (this.screenEffects) {
      this.screenEffects.setGrainEnabled(en);
    }
    this.hud.setGrainEnabled(en);
    if (persist) {
      try {
        localStorage.setItem("fps_grain_enabled", en ? "1" : "0");
      } catch (_) {}
    }
  }

  /**
   * Включить/выключить мигание ламп.
   * @param {boolean} enabled
   * @param {boolean} [persist=true]
   */
  setFlickerEnabled(enabled, persist = true) {
    const en = !!enabled;
    this.flickerEnabled = en;
    CONFIG.graphics.flickerEnabled = en;
    this.hud.setFlickerEnabled(en);
    if (persist) {
      try {
        localStorage.setItem("fps_flicker_enabled", en ? "1" : "0");
      } catch (_) {}
    }
  }

  /**
   * Загрузить сохранённый FOV из localStorage.
   * @returns {number}
   * @private
   */
  _loadFov() {
    try {
      const saved = localStorage.getItem(CONFIG.camera.fovStorageKey || "fps_fov");
      if (saved) {
        const val = parseFloat(saved);
        if (val >= 70 && val <= 100) return val;
      }
    } catch (_) {}
    return CONFIG.camera.fov || 77;
  }

  /**
   * Установить базовый FOV игрока и камеры.
   * @param {number} val
   * @param {boolean} [persist=true]
   */
  setFov(val, persist = true) {
    const fov = Math.max(70, Math.min(100, Math.round(val)));
    CONFIG.camera.fov = fov;
    if (this.camera) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    if (this.player) {
      this.player.fov = fov;
    }
    if (this.hud && this.hud.setFov) {
      this.hud.setFov(fov);
    }
    if (persist) {
      try {
        localStorage.setItem(CONFIG.camera.fovStorageKey || "fps_fov", String(fov));
      } catch (_) {}
    }
  }

  /**
   * Загрузить режим отрисовки оружия из localStorage.
   * @private
   */
  _loadWeaponInComposer() {
    try {
      const saved = localStorage.getItem(CONFIG.graphics.weaponInComposerStorageKey || "fps_weapon_in_composer");
      if (saved !== null) {
        CONFIG.graphics.weaponInComposer = saved === "true";
      }
    } catch (_) {}
  }

  /**
   * Аудит всех плоскостей пола в диапазоне |y| < 0.15 над общим уровнем.
   * Выводит таблицу в консоль по F3 (CONFIG.debug.cheats).
   */
  auditFloorPlanes() {
    const list = [];
    const tempBox = new THREE.Box3();
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();

    this.scene.traverse((obj) => {
      if (obj.isMesh && obj.geometry) {
        tempBox.setFromObject(obj);
        tempBox.getSize(size);
        tempBox.getCenter(center);
        if (Math.abs(center.y) < 0.15 || (tempBox.min.y >= -0.15 && tempBox.max.y <= 0.15)) {
          list.push({
            name: obj.name || obj.parent?.name || obj.geometry.type || "Mesh",
            y: Number(center.y.toFixed(4)),
            dimensions: `${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`,
            material: obj.material ? (Array.isArray(obj.material) ? obj.material.map((m) => m.type).join(",") : obj.material.type) : "none",
            polygonOffset: !!(obj.material && (Array.isArray(obj.material) ? obj.material.some((m) => m.polygonOffset) : obj.material.polygonOffset))
          });
        }
      }
    });

    console.group("=== [F3 AUDIT] FLOOR PLANES IN |y| < 0.15 ===");
    if (list.length > 0) {
      console.table(list);
    } else {
      console.log("No floor planes found in |y| < 0.15.");
    }
    console.groupEnd();
    return list;
  }

  /**
   * Диагностика вьюмодели по F3 (CONFIG.debug.cheats).
   */
  auditViewmodel() {
    if (!this.viewmodel || !this.viewmodel.getDiagnostics) return null;
    const diag = this.viewmodel.getDiagnostics();
    console.group("=== [F3 AUDIT] VIEWMODEL DIAGNOSTICS ===");
    console.log("Active Weapon:", diag.activeWeapon, "| Visible:", diag.modelVisible);
    console.log("View Pos:", diag.viewPos, "Rot:", diag.viewRot, "Scale:", diag.viewScale);
    console.log("World Pos:", diag.worldPos, "Box3:", diag.box3Min, "to", diag.box3Max);
    console.log("Child Meshes:", diag.childMeshCount, "| NaN Detected:", diag.nanFound);
    console.log("wCam near/far/aspect/fov:", diag.wCam);
    console.log("weaponInComposer:", CONFIG.graphics && CONFIG.graphics.weaponInComposer !== false);
    console.log("Materials Sample:", diag.materialsSample);
    console.groupEnd();
    return diag;
  }

  /**
   * Прочитать сохранённый режим качества.
   * @returns {"low"|"medium"|"high"}
   * @private
   */
  _loadGraphicsQuality() {
    const modes = CONFIG.graphics.modes || {};
    try {
      const saved = localStorage.getItem(CONFIG.graphics.storageKey);
      if (saved && modes[saved]) return saved;
    } catch (err) {
      // localStorage может быть недоступен — используем значение по умолчанию
    }
    return modes[CONFIG.graphics.mode] ? CONFIG.graphics.mode : "high";
  }

  /**
   * Прочитать сохранённую сложность (easy / normal / hard).
   * @returns {"easy"|"normal"|"hard"}
   * @private
   */
  _loadDifficulty() {
    const modes = CONFIG.difficulty?.modes || {};
    try {
      const saved = localStorage.getItem(CONFIG.difficulty?.storageKey || "fps_difficulty");
      if (saved && modes[saved]) return saved;
    } catch (_) {}
    return CONFIG.difficulty?.default || "normal";
  }

  /**
   * Выбрать сложность для следующего забега.
   * @param {"easy"|"normal"|"hard"} id
   */
  setDifficulty(id) {
    const modes = CONFIG.difficulty?.modes || {};
    if (!modes[id]) return;
    this.difficulty = id;
    if (!this.runActive || this.state === "menu") {
      this.difficultyCfg = modes[id];
    }
    if (this.overlays) this.overlays.setDifficulty(id);
    try {
      localStorage.setItem(CONFIG.difficulty?.storageKey || "fps_difficulty", id);
    } catch (_) {}
  }

  /**
   * Запустить ежедневный забег с сидом ГГГГММДД.
   */
  startDailyRun() {
    if (!this.modelsReady) return;
    const d = new Date();
    const seed =
      `${d.getFullYear()}` +
      String(d.getMonth() + 1).padStart(2, "0") +
      String(d.getDate()).padStart(2, "0");
    if (this.hud.el.seedInput) this.hud.el.seedInput.value = seed;
    this.startGameWithSeed(seed, { daily: true });
  }

  /**
   * Прочитать сохранённый стиль зомби.
   * @returns {"toon"|"pbr"}
   * @private
   */
  _loadZombieStyle() {
    try {
      const saved = localStorage.getItem("fps_zombie_style");
      if (saved === "toon" || saved === "pbr") return saved;
    } catch (err) {
      // localStorage может быть недоступен
    }
    return CONFIG.graphics.zombieStyle || "toon";
  }

  /**
   * Переключить стиль зомби на лету для всех активных врагов и сохранить в localStorage.
   * @param {"toon"|"pbr"} style
   * @param {boolean} [persist=true]
   */
  setZombieStyle(style, persist = true) {
    if (style !== "toon" && style !== "pbr") return;
    this.zombieStyle = style;
    CONFIG.graphics.zombieStyle = style;
    if (this.enemyManager) {
      this.enemyManager.updateZombieStyle(style, this.graphicsQuality);
    }
    this.hud.setZombieStyle(style);
    if (persist) {
      try {
        localStorage.setItem("fps_zombie_style", style);
      } catch (err) {
        // Игнорируем недоступное хранилище
      }
    }
  }

  /**
   * Переключить режим качества (low / medium / high) и сохранить выбор.
   * @param {"low"|"medium"|"high"} mode
   * @param {boolean} [persist=true]
   */
  setGraphicsQuality(mode, persist = true) {
    if (!CONFIG.graphics.modes || !CONFIG.graphics.modes[mode]) return;
    this.graphicsQuality = mode;
    this.screenEffects.setQuality(mode);
    this.hud.setGraphicsQuality(mode);
    this.hud.hidePerfPrompt();

    // Режим качества влияет на дрожание вершин (на medium и low отключаем)
    if (mode === "low" || mode === "medium") {
      setVertexSnap(0);
    } else {
      setVertexSnap(CONFIG.graphics.vertexSnap);
    }

    // Обновляем обводку зомби (высокое качество = включена обводка в мультяшном стиле)
    if (this.enemyManager) {
      this.enemyManager.updateZombieStyle(this.zombieStyle || CONFIG.graphics.zombieStyle, mode);
    }

    // Сбрасываем окно замера и разрешаем снова предложить автоснижение
    this._perfTime = 0;
    this._perfFrames = 0;
    this._perfPromptShown = false;

    if (persist) {
      try {
        localStorage.setItem(CONFIG.graphics.storageKey, mode);
      } catch (err) {
        // Игнорируем недоступное хранилище
      }
    }
  }

  /**
   * Средний FPS за окно autoDowngrade.window; при низком FPS показывает
   * предложение включить режим производительности.
   * @param {number} dt реальное время кадра (без timeScale)
   * @private
   */
  _trackPerformance(dt) {
    const cfg = CONFIG.graphics.autoDowngrade;
    if (!cfg || this.graphicsQuality === "low" || dt <= 0) return;

    this._perfTime += dt;
    this._perfFrames++;
    if (this._perfTime < cfg.window) return;

    const fps = this._perfFrames / this._perfTime;
    this._perfTime = 0;
    this._perfFrames = 0;

    if (!this._perfPromptShown && fps < cfg.fpsThreshold && this.state === "playing") {
      this._perfPromptShown = true;
      this.hud.showPerfPrompt(fps);
    }
  }

  startGameWithSeed(explicitSeed, opts = {}) {
    if (!this.modelsReady) return;

    // Аудиоконтекст можно создать только после жеста пользователя
    this.audio.init();

    if (this.state === "menu") {
      const inputSeed = explicitSeed !== undefined
        ? (explicitSeed ? String(explicitSeed).trim() : "")
        : (this.hud.el.seedInput ? this.hud.el.seedInput.value.trim() : "");
      this.startRun(inputSeed || undefined, !!opts.daily);
    }
    this.input.requestLock();
  }

  /**
   * Полный старт нового забега с уровня 1.
   * @param {string|undefined} seed undefined = случайный сид
   * @param {boolean} [daily]
   */
  startRun(seed, daily = false) {
    this.runActive = true;
    this.runDaily = !!daily;
    this.runDifficulty = this.difficulty;
    this.difficultyCfg =
      CONFIG.difficulty.modes[this.runDifficulty] || CONFIG.difficulty.modes.normal;

    this.perkChoice = null;
    this.modalOpen = false;
    this.summaryOpen = false;
    this._debugFinish = false;
    this.lastChanceTimer = 0;
    this.lastChanceCooldown = 0;
    this.timeScale = 1.0;
    this.hitstopTimer = 0;
    this.slowmoTimer = 0;
    this.recentKillTimes.length = 0;

    // Сброс счёта, перков и расходников до генерации уровня
    this.kills = 0;
    this.gloryKills = 0;
    this.score = 0;
    this.killsSinceQuote = 0;
    this.quoteCooldown = 0;
    this.weaponSwitchTimer = 0;
    this.perks.reset();
    this.effects.clear();
    if (this.styleMeter) this.styleMeter.reset();
    this.consumableScreenFx.reset();
    this.funnyFaces.clear();
    this._drunkMaxShown = false;
    this.resetConsumables();

    this.levelManager.startLevel(1, seed, { preservePlayer: false });
    this.player.isDead = false;
    this.player.deathCamT = 0;
    this.player.dashCharges = this.player.dashChargesMax;

    this.runStats.start({
      seed: this.world.seed,
      difficulty: this.runDifficulty,
      daily: this.runDaily
    });

    if (seed && this.hud.el.seedInput) this.hud.el.seedInput.value = String(seed);
    this.overlays.hideSummary();
    this.overlays.hidePerkChoice();
    this.overlays.setPerks(this.perks.entries());
    this.hud.hideDeathScreen();
    this.hud.hideLevelStats();
    this.hud.updateConsumables(this.consumables);
    this.hud.updateEffects(this.effects);
    this.hud.setScore(0, 0, 0);
    this.state = "menu";
    this.hud.showStart();
  }

  /** «ЕЩЁ РАЗ» — новый забег со случайным сидом. */
  restartWithNewSeed() {
    if (!this.modelsReady) return;
    this.audio.init();
    const seed =
      "run" +
      Date.now().toString(36) +
      Math.floor(Math.random() * 46656).toString(36);
    this.startRun(seed, false);
    this.input.requestLock();
  }

  /** «С ТЕМ ЖЕ SEED» — новый забег с текущим сидом. */
  restartWithSameSeed() {
    if (!this.modelsReady) return;
    this.audio.init();
    this.startRun(this.world ? this.world.seed : undefined, this.runDaily);
    this.input.requestLock();
  }

  /** Вернуться в меню, сбросив текущий забег. */
  returnToMenu() {
    this.runActive = false;
    this.summaryOpen = false;
    this.modalOpen = false;
    this.perkChoice = null;
    this.perks.reset();
    this.effects.clear();
    if (this.styleMeter) this.styleMeter.reset();
    this.consumableScreenFx.reset();
    this.funnyFaces.clear();
    this._drunkMaxShown = false;
    this.resetConsumables();
    this.kills = 0;
    this.gloryKills = 0;
    this.score = 0;
    this.killsSinceQuote = 0;
    this.player.isDead = false;
    this.player.deathCamT = 0;
    this.levelManager.startLevel(1, this.world ? this.world.seed : undefined, {
      preservePlayer: false
    });
    this.runStats.reset();
    this.overlays.hideSummary();
    this.overlays.hidePerkChoice();
    this.overlays.setPerks([]);
    this.hud.hideDeathScreen();
    this.hud.hideLevelStats();
    this.hud.updateConsumables(this.consumables);
    this.hud.updateEffects(this.effects);
    this.hud.setScore(0, 0, 0);
    this.state = "menu";
    this.hud.showStart();
    if (this.input) this.input.exitLock();
  }

  setupInput() {
    const canvas = this.renderer.domElement;

    this.hud.el.overlay.addEventListener("click", (e) => {
      // Игнорируем клик, если он произошёл внутри блока настройки сида
      if (this.hud.el.seedContainer && this.hud.el.seedContainer.contains(e.target)) {
        return;
      }
      this.startGameWithSeed();
    });

    if (this.hud.el.startBtn) {
      this.hud.el.startBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.startGameWithSeed();
      });
    }

    if (this.hud.el.seedInput) {
      this.hud.el.seedInput.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.code === "Enter") {
          e.preventDefault();
          this.hud.el.seedInput.blur();
          this.startGameWithSeed();
        }
      });
    }

    // Переключатели качества графики в меню/паузе
    const gfxButtons = [
      [this.hud.el.gfxLow, "low"],
      [this.hud.el.gfxMedium, "medium"],
      [this.hud.el.gfxHigh, "high"]
    ];
    for (const [btn, mode] of gfxButtons) {
      if (!btn) continue;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.setGraphicsQuality(mode);
      });
    }

    // Переключатели стиля зомби в меню/паузе
    if (this.hud.el.zombieStyleToon) {
      this.hud.el.zombieStyleToon.addEventListener("click", (e) => {
        e.stopPropagation();
        this.setZombieStyle("toon");
      });
    }
    if (this.hud.el.zombieStylePbr) {
      this.hud.el.zombieStylePbr.addEventListener("click", (e) => {
        e.stopPropagation();
        this.setZombieStyle("pbr");
      });
    }

    // Переключатели стиля графики (PSX / Картун)
    if (this.hud.el.stylePsx) {
      this.hud.el.stylePsx.addEventListener("click", (e) => {
        e.stopPropagation();
        this.setGraphicsStyle("psx");
      });
    }
    if (this.hud.el.styleCartoon) {
      this.hud.el.styleCartoon.addEventListener("click", (e) => {
        e.stopPropagation();
        this.setGraphicsStyle("cartoon");
      });
    }

    // Переключатели чёткости рендера (240 / 360 / 480 / off)
    const resButtons = [
      [this.hud.el.res240, 240],
      [this.hud.el.res360, 360],
      [this.hud.el.res480, 480],
      [this.hud.el.resOff, null]
    ];
    for (const [btn, res] of resButtons) {
      if (!btn) continue;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.setPixelHeight(res);
      });
    }

    // Переключатели дрожания вершин PS1 (0=выкл, 1=слабо, 2=сильно)
    const snapButtons = [
      [this.hud.el.snapOff, 0],
      [this.hud.el.snapLow, 1],
      [this.hud.el.snapHigh, 2]
    ];
    for (const [btn, snap] of snapButtons) {
      if (!btn) continue;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.setVertexSnap(snap);
      });
    }

    // Регулятор яркости (слайдер 0.7 - 1.8)
    if (this.hud.el.brightnessSlider) {
      this.hud.el.brightnessSlider.addEventListener("input", (e) => {
        const val = parseInt(e.target.value, 10) / 100;
        this.setBrightness(val);
      });
    }

    // Регулятор базового FOV (слайдер 70 - 100)
    if (this.hud.el.fovSlider) {
      this.hud.el.fovSlider.addEventListener("input", (e) => {
        const val = parseFloat(e.target.value);
        this.setFov(val);
      });
    }

    // Переключатели зернистости (film grain)
    if (this.hud.el.grainOn) {
      this.hud.el.grainOn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.setGrainEnabled(true);
      });
    }
    if (this.hud.el.grainOff) {
      this.hud.el.grainOff.addEventListener("click", (e) => {
        e.stopPropagation();
        this.setGrainEnabled(false);
      });
    }

    // Переключатели мигания ламп
    if (this.hud.el.flickerOn) {
      this.hud.el.flickerOn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.setFlickerEnabled(true);
      });
    }
    if (this.hud.el.flickerOff) {
      this.hud.el.flickerOff.addEventListener("click", (e) => {
        e.stopPropagation();
        this.setFlickerEnabled(false);
      });
    }

    // Предложение автоснижения качества
    if (this.hud.el.perfAccept) {
      this.hud.el.perfAccept.addEventListener("click", (e) => {
        e.stopPropagation();
        this.setGraphicsQuality("low");
      });
    }
    if (this.hud.el.perfDismiss) {
      this.hud.el.perfDismiss.addEventListener("click", (e) => {
        e.stopPropagation();
        this.hud.hidePerfPrompt();
      });
    }

    this.hud.el.restartBtn.addEventListener("click", () => {
      this.restartGame();
      this.input.requestLock();
    });

    this.input = new Input(canvas, {
      onLockError: () => {
        if (
          this.runActive &&
          !this.modalOpen &&
          !this.perkChoice &&
          !this.summaryOpen &&
          !this.debugMenuOpen &&
          !this.shotgunEditorOpen &&
          !this.armsEditorOpen
        ) {
          this.state = "playing";
          this.hud.el.overlay.classList.add("hidden");
        }
      },
      onLockChange: (isLocked) => {
        // Отладочное меню (F2) держит игру на паузе и не показывает экран паузы
        if (this.debugMenuOpen) {
          if (isLocked) {
            // Захват неожиданно вернулся — просто закрываем меню
            this.closeDebugMenu(false);
            this.state = "playing";
          } else {
            this.state = "paused";
            this.hud.el.overlay.classList.add("hidden");
          }
          return;
        }

        if (this.summaryOpen) {
          this.hud.el.overlay.classList.add("hidden");
          if (isLocked && this.input) this.input.exitLock();
          return;
        }

        if (this.perkChoice || this.modalOpen) {
          this.hud.el.overlay.classList.add("hidden");
          return;
        }

        if (this.state === "menu") {
          if (!isLocked) {
            this.hud.el.overlay.classList.remove("hidden");
            return;
          }
        }

        if (this.player.isDead) {
          this.hud.el.overlay.classList.add("hidden");
          this.state = "death";
          return;
        }

        if (isLocked) {
          this.state = "playing";
          this.hud.el.overlay.classList.add("hidden");
          this.clock.getDelta();
        } else {
          this.state = "paused";
          this.consumableScreenFx.suspend();
          this.hud.showPause(this.world.seed);
        }
      },
      onMouseMove: (dx, dy) => {
        if (this.state === "playing" && !this.player.isDead && !this.gloryKill.isActive) {
          this.player.look(dx, dy, this.viewmodel);
        }
      },
      onKeyDown: (e) => {
        // Если фокус находится в поле ввода сида, игнорируем горячие клавиши игры
        if (document.activeElement === this.hud.el.seedInput) {
          if (e.code === "Enter") {
            e.preventDefault();
            this.hud.el.seedInput.blur();
            this.startGameWithSeed();
          }
          return;
        }

        // Экран выбора перка: 1–3, стрелки, Enter, колесо мыши
        if (this.perkChoice) {
          if (/^Digit[1-3]$/.test(e.code)) {
            e.preventDefault();
            this.overlays.chooseIndex(+e.code[5] - 1);
            return;
          }
          if (e.code === "ArrowLeft" || e.code === "ArrowUp") {
            e.preventDefault();
            this.overlays.focusNext(-1);
            return;
          }
          if (e.code === "ArrowRight" || e.code === "ArrowDown") {
            e.preventDefault();
            this.overlays.focusNext(1);
            return;
          }
          if (e.code === "Enter" || e.code === "Space") {
            e.preventDefault();
            this.overlays.chooseFocused();
            return;
          }
          return;
        }

        if (this.summaryOpen) return;

        // F2 — отладочное меню (открыть/закрыть), только при CONFIG.debug.cheats
        if (e.code === "F2" && this._cheatsEnabled()) {
          e.preventDefault();
          this.toggleDebugMenu();
          return;
        }

        // F3 — панель диагностики (FPS, шейдеры, свет, вьюмодель)
        if (e.code === "F3" && this._cheatsEnabled()) {
          e.preventDefault();
          this.hud.toggleDebugPanel();
          this.auditFloorPlanes();
          this.auditViewmodel();
          return;
        }

        // F4 — переключение миникарты
        if (e.code === "F4") {
          e.preventDefault();
          this.hud.toggleMinimap();
          return;
        }

        // F5 — новый уровень с новым сидом без перезагрузки страницы.
        // preventDefault обязателен: иначе браузер перезагрузит страницу.
        if (e.code === "F5") {
          e.preventDefault();
          if (this._cheatsEnabled()) this.debugNewLevel();
          return;
        }

        if (this.player.isDead) {
          if (e.code === "KeyR") this.restartGame();
          return;
        }
        if (this.state !== "playing" || this.gloryKill.isActive) return;

        if (e.code === "Space") {
          e.preventDefault();
          if (!e.repeat) {
            this.player.jumpQueued = true;
            this.audio.play("jump");
          }
        } else if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
          if (!e.repeat) {
            this.player.dashQueued = true;
            this.audio.play("dash");
          }
        } else if (e.code === "KeyE") {
          if (!e.repeat) this.gloryKill.tryTrigger(this.enemyManager.zombies);
        } else if (e.code === "Digit7") {
          if (!e.repeat) this.useConsumable("vodka");
        } else if (e.code === "Digit8") {
          if (!e.repeat) this.useConsumable("joint");
        } else if (e.code === "KeyQ") {
          if (!e.repeat) this.useLastConsumable();
        } else if (/^Digit[1-3]$/.test(e.code)) {
          this.selectWeapon(+e.code[5] - 1);
        } else if (e.code === "KeyT") {
          this.levelManager.debugSpawnZombie();
        } else {
          this.input.keys[e.code] = true;
        }
      },
      onWheel: (direction) => {
        if (this.perkChoice) {
          this.overlays.focusNext(direction);
          return;
        }
        if (this.state === "playing" && !this.player.isDead && !this.gloryKill.isActive) {
          this.cycleWeapon(direction);
        }
      }
    });
  }

  selectWeapon(index) {
    if (this.gloryKill.isActive) return;
    index = (index + this.weapons.length) % this.weapons.length;
    if (index === this.currentWeaponIndex) return;

    this.currentWeaponIndex = index;
    this.currentWeapon = this.weapons[index];
    this.weaponSwitchTimer = CONFIG.combat.switchDelay;
    this.viewmodel.switchWeapon(this.currentWeapon.id);
    this.hud.selectWeapon(this.currentWeapon, this.currentWeaponIndex);
  }

  cycleWeapon(direction) {
    this.selectWeapon(this.currentWeaponIndex + direction);
  }

  /**
   * Показать выбор перка (между уровнями или кнопка меню «Окно выбора перка»).
   * @param {Function} callback вызывается после выбора
   */
  beginPerkChoice(callback) {
    if (!this.perks || this.perkChoice) {
      if (callback) callback();
      return;
    }
    const choices = this.perks.roll(CONFIG.run?.perkChoices ?? 3);
    if (choices.length === 0) {
      if (callback) callback();
      return;
    }

    this.perkChoice = { choices, callback: callback || null };
    this.modalOpen = true;
    this.hud.el.overlay.classList.add("hidden");
    this.overlays.showPerkChoice(choices, (perk) => this.choosePerk(perk));
    if (this.input) this.input.exitLock();
  }

  /**
   * Применить выбранный перк и продолжить.
   * @param {Object|null} perk
   */
  choosePerk(perk) {
    const choice = this.perkChoice;
    if (!choice) return;
    this.perkChoice = null;
    this.modalOpen = false;
    this.overlays.hidePerkChoice();
    if (perk) {
      this.perks.add(perk.id);
      this.overlays.setPerks(this.perks.entries());
    }
    const cb = choice.callback;
    if (cb) cb();
    if (this.input) this.input.requestLock();
  }

  /** Включены ли отладочные читы (CONFIG.debug.cheats). @returns {boolean} */
  _cheatsEnabled() {
    return !!(CONFIG.debug && CONFIG.debug.cheats);
  }

  /**
   * Можно ли сейчас применять читы: идёт забег, нет модальных экранов.
   * @returns {boolean}
   */
  _canUseDebugCheats() {
    return this._cheatsEnabled() &&
      !this.summaryOpen &&
      !this.perkChoice &&
      !this.modalOpen &&
      !!this.player &&
      !this.player.isDead &&
      (this.state === "playing" || this.state === "paused");
  }

  /** Открыть/закрыть отладочное меню (F2). */
  toggleDebugMenu() {
    if (this.armsEditorOpen) {
      this.toggleArmsEditor();
      return;
    }
    if (this.debugMenuOpen) this.closeDebugMenu();
    else this.openDebugMenu();
  }

  /**
   * Открыть отладочное меню: панель слева, курсор освобождён, Pointer Lock снят,
   * управление игроком заблокировано (state = "paused").
   * @returns {boolean}
   */
  openDebugMenu() {
    if (!this._canUseDebugCheats() || this.debugMenuOpen) return false;

    this.debugMenuOpen = true;
    this.hud.showDebugMenu(true);
    this.hud.setDebugGod(this.debugGodMode);
    this.hud.setDebugWeaponRender(CONFIG.graphics.weaponInComposer !== false);
    this.hud.el.overlay.classList.add("hidden");
    this.hud.hidePerfPrompt();

    // Снимаем захват мыши, чтобы можно было кликать по кнопкам
    if (this.input && this.input.isLocked) {
      this.input.exitLock();
    }
    // Управление игроком блокируется сразу, не дожидаясь события pointerlockchange
    this.state = "paused";
    return true;
  }

  /**
   * Закрыть отладочное меню и вернуть захват мыши.
   * @param {boolean} [relock=true] false — не запрашивать Pointer Lock (перед модальным экраном)
   */
  closeDebugMenu(relock = true) {
    if (!this.debugMenuOpen) return;
    this.debugMenuOpen = false;
    this.hud.showDebugMenu(false);

    if (!relock || !this.input) return;
    const lockRequest = this.input.requestLock();
    if (lockRequest && typeof lockRequest.catch === "function") {
      // Браузер может отклонить захват (например, сразу после Esc) — показываем паузу
      lockRequest.catch(() => {
        this.state = "paused";
        this.hud.showPause(this.world ? this.world.seed : "");
      });
    }
  }

  /**
   * Обработчик кнопок отладочного меню (F2).
   * @param {string} action
   * @returns {boolean}
   */
  handleDebugAction(action) {
    if (!this._cheatsEnabled()) return false;

    switch (action) {
      case "newLevel":
        return this.debugNewLevel();
      case "style40":
        return this.debugAddStyle(40);
      case "resetStyle":
        return this.debugResetStyle();
      case "consumables":
        return this.debugGiveConsumables(3);
      case "god":
        return this.debugToggleGod();
      case "weaponRender":
        return this.toggleWeaponRenderMode();
      case "spawnZombie":
        return !!this.debugSpawnEnemy("zombie");
      case "spawnPhantom":
        return !!this.debugSpawnEnemy("robot");
      case "spawnReaper":
        return !!this.debugSpawnEnemy("reaper");
      case "spawnMutant":
        return !!this.debugSpawnEnemy("mutant");
      case "spawnBarrel":
        return !!this.debugSpawnBarrel();
      case "editShotgun":
        return this.toggleShotgunEditor();
      case "editArms":
        return this.toggleArmsEditor();
      case "toggleHideWeapons":
        return this.toggleHideWeaponsForTest();
      case "randomPerk":
        return this.debugRandomPerk();
      case "perkChoice":
        // Модальный экран перка сам снимает захват — меню закрываем без relock
        if (!this._canUseDebugCheats()) return false;
        this.closeDebugMenu(false);
        this.debugPerkChoice();
        return true;
      case "endRun":
        if (!this._canUseDebugCheats()) return false;
        this.closeDebugMenu(false);
        this.debugFinishRun();
        return true;
      default:
        return false;
    }
  }

  /**
   * Новый уровень с новым сидом без перезагрузки страницы (F5, кнопка меню, dbg.newLevel()).
   * @param {string|number} [seed] без аргумента — случайный сид
   * @returns {boolean}
   */
  debugNewLevel(seed) {
    if (!this._canUseDebugCheats()) return false;
    this.regenerateLevel(seed);
    return true;
  }

  /**
   * Начислить очки стиля (кнопка «+40 стиля», dbg.style(40)).
   * @param {number} [points=40]
   * @returns {boolean}
   */
  debugAddStyle(points = 40) {
    if (!this._cheatsEnabled() || !this.styleMeter) return false;
    const pts = Number(points) > 0 ? Number(points) : 40;
    this.styleMeter.addPoints(pts, [{ text: "ЧИТ", pts }]);
    this.hud.updateStyle(this.styleMeter.getState());
    return true;
  }

  /** Сбросить стиль-метр (кнопка «Сбросить стиль», dbg.resetStyle()). */
  debugResetStyle() {
    if (!this._cheatsEnabled() || !this.styleMeter) return false;
    this.styleMeter.reset();
    if (this.viewmodel && this.viewmodel.setStyleRank) {
      this.viewmodel.setStyleRank(this.styleMeter.rank, this.styleMeter.getRankColor());
    }
    this.hud.updateStyle(this.styleMeter.getState());
    return true;
  }

  /**
   * Выдать по N расходников каждого типа (кнопка «Выдать расходники (по 3)»).
   * @param {number} [count=3] не больше CONFIG.effects.maxStack
   * @returns {boolean}
   */
  debugGiveConsumables(count = 3) {
    if (!this._cheatsEnabled()) return false;
    const max = CONFIG.effects.maxStack ?? 3;
    const n = Math.max(1, Math.min(max, Number(count) || max));

    let given = 0;
    for (const type of ["vodka", "joint"]) {
      for (let i = 0; i < n; i++) {
        if (!this.addConsumable(type)) break;
        given++;
      }
    }

    this.hud.updateConsumables(this.consumables);
    this.hud.showWaveBanner(given > 0 ? "РАСХОДНИКИ: +" + given : "ИНВЕНТАРЬ ПОЛОН");
    return given > 0;
  }

  /**
   * Отладочный спавн врага рядом с игроком (кнопки «Спавн: …», dbg.spawn()).
   * @param {"zombie"|"robot"|"reaper"|"mutant"} type
   * @returns {Object|null} заспавненный враг
   */
  debugSpawnEnemy(type = "zombie") {
    if (!this._cheatsEnabled() || !this.levelManager) return null;
    const enemy = this.levelManager.debugSpawnEnemy(type);
    if (enemy) {
      const names = { zombie: "ЗОМБИ", robot: "ПРИЗРАК", reaper: "ПУГАЛО", mutant: "МУТАНТ" };
      this.hud.showWaveBanner("СПАВН: " + (names[type] || type));
    }
    return enemy;
  }

  /**
   * Отладочный спавн взрывной бочки в 5 м перед игроком (кнопка меню, dbg.spawnBarrel()).
   * @returns {Object|null}
   */
  debugSpawnBarrel() {
    if (!this._cheatsEnabled() || !this.barrels) return null;
    const barrel = this.barrels.spawnInFrontOfPlayer(5);
    if (barrel) this.hud.showWaveBanner("СПАВН: БОЧКА");
    return barrel;
  }

  /**
   * Открыть/закрыть редактор вьюмодели дробовика (отладочная панель F2).
   * @returns {boolean}
   */
  toggleShotgunEditor() {
    if (!this._cheatsEnabled()) return false;
    this.shotgunEditorOpen = !this.shotgunEditorOpen;
    if (this.armsEditorOpen) {
      this.armsEditorOpen = false;
      this.hud.showArmsEditor(false);
    }
    // Закрываем основное отладочное меню при открытии редактора
    this.hud.showDebugMenu(false);
    if (this.shotgunEditorOpen) {
      this.hud.showShotgunEditor(true);
      if (this.input) this.input.exitLock();
    } else {
      this.hud.showShotgunEditor(false);
      if (this.state === "menu") {
        this.input.requestLock();
      }
    }
    return this.shotgunEditorOpen;
  }

  /**
   * Открыть/закрыть редактор 3D-рук (F2 -> Редактор рук).
   * @returns {boolean}
   */
  toggleArmsEditor() {
    if (!this._cheatsEnabled()) return false;
    this.armsEditorOpen = !this.armsEditorOpen;
    if (this.shotgunEditorOpen) {
      this.shotgunEditorOpen = false;
      this.hud.showShotgunEditor(false);
    }
    this.hud.showDebugMenu(false);
    if (this.armsEditorOpen) {
      this.hud.showArmsEditor(true);
      if (this.input) this.input.exitLock();
    } else {
      this.hud.showArmsEditor(false);
      if (this.state === "menu") {
        this.input.requestLock();
      }
    }
    return this.armsEditorOpen;
  }

  /**
   * Скрыть или показать модели оружия для проверки позы рук.
   * @returns {boolean}
   */
  toggleHideWeaponsForTest() {
    if (!this._cheatsEnabled()) return false;
    if (!CONFIG.viewmodel) CONFIG.viewmodel = {};
    if (!CONFIG.viewmodel.arms) CONFIG.viewmodel.arms = {};
    CONFIG.viewmodel.arms.hideWeaponsForTest = !CONFIG.viewmodel.arms.hideWeaponsForTest;
    const hidden = !!CONFIG.viewmodel.arms.hideWeaponsForTest;
    if (this.viewmodel) {
      this.viewmodel.switchWeapon(this.viewmodel.currentWeaponId);
    }
    if (this.hud && this.hud.setDebugHideWeapons) {
      this.hud.setDebugHideWeapons(hidden);
    }
    return hidden;
  }

  /**
   * Переключить режим рендеринга оружия: внутри композера / поверх экрана
   * (бывшая клавиша F10, теперь кнопка меню и dbg.weaponRender()).
   * @returns {boolean} новое значение CONFIG.graphics.weaponInComposer
   */
  toggleWeaponRenderMode() {
    if (!this._cheatsEnabled()) return CONFIG.graphics.weaponInComposer !== false;
    CONFIG.graphics.weaponInComposer = !CONFIG.graphics.weaponInComposer;
    try {
      localStorage.setItem(
        CONFIG.graphics.weaponInComposerStorageKey || "fps_weapon_in_composer",
        String(CONFIG.graphics.weaponInComposer)
      );
    } catch (_) {}
    this.hud.setDebugWeaponRender(CONFIG.graphics.weaponInComposer);
    console.log(
      `[Weapon Render Mode] weaponInComposer = ${CONFIG.graphics.weaponInComposer
        ? "true (OverlayPass inside EffectComposer)"
        : "false (direct render to screen after composer)"}`
    );
    return CONFIG.graphics.weaponInComposer;
  }

  /**
   * Включатель «Бессмертие» (кнопка меню, dbg.god()).
   * Использует существующие i-frames игрока (player.invulnT), новых механик нет.
   * @param {boolean} [force] без аргумента — переключить
   * @returns {boolean} новое состояние
   */
  debugToggleGod(force) {
    if (!this._cheatsEnabled()) return false;
    this.debugGodMode = force === undefined ? !this.debugGodMode : !!force;
    if (!this.debugGodMode && this.player) this.player.invulnT = 0;
    this.hud.setDebugGod(this.debugGodMode);
    this.hud.showWaveBanner(this.debugGodMode ? "БЕССМЕРТИЕ: ВКЛ" : "БЕССМЕРТИЕ: ВЫКЛ");
    return this.debugGodMode;
  }

  /** Консольный интерфейс отладки: window.dbg (только при CONFIG.debug.cheats). */
  setupDebugConsole() {
    if (!this._cheatsEnabled()) return;

    window.dbg = {
      newLevel: (seed) => this.debugNewLevel(seed),
      style: (points = 40) => this.debugAddStyle(points),
      resetStyle: () => this.debugResetStyle(),
      consumables: (count = 3) => this.debugGiveConsumables(count),
      perkChoice: () => this.debugPerkChoice(),
      perk: () => this.debugRandomPerk(),
      endRun: () => this.debugFinishRun(),
      spawnZombie: () => this.debugSpawnEnemy("zombie"),
      spawnPhantom: () => this.debugSpawnEnemy("robot"),
      spawnReaper: () => this.debugSpawnEnemy("reaper"),
      spawnMutant: () => this.debugSpawnEnemy("mutant"),
      spawnBarrel: () => this.debugSpawnBarrel(),
      editShotgun: () => this.toggleShotgunEditor(),
      editArms: () => this.toggleArmsEditor(),
      hideWeapons: () => this.toggleHideWeaponsForTest(),
      spawn: (type) => this.debugSpawnEnemy(type),
      weaponRender: () => this.toggleWeaponRenderMode(),
      god: (force) => this.debugToggleGod(force),
      menu: () => this.toggleDebugMenu(),
      help: () => {
        console.log(
          "[dbg] Отладочные команды (только при CONFIG.debug.cheats):\n" +
          "  dbg.newLevel([seed])   — новый уровень (без seed — случайный)\n" +
          "  dbg.style(40)          — +40 очков стиля\n" +
          "  dbg.resetStyle()       — сбросить стиль\n" +
          "  dbg.consumables(3)     — выдать расходники\n" +
          "  dbg.perkChoice()       — окно выбора перка\n" +
          "  dbg.perk()             — случайный перк\n" +
          "  dbg.endRun()           — завершить забег (итоги без рекорда)\n" +
          "  dbg.spawn('zombie'|'robot'|'reaper'|'mutant')\n" +
          "  dbg.spawnZombie() / dbg.spawnPhantom() / dbg.spawnReaper() / dbg.spawnMutant()\n" +
          "  dbg.spawnBarrel()      — бочка в 5 м перед игроком\n" +
          "  dbg.editShotgun()      — редактор вьюмодели дробовика\n" +
          "  dbg.weaponRender()     — композер/экран для оружия\n" +
          "  dbg.god(true|false)    — бессмертие\n" +
          "  dbg.menu()             — открыть/закрыть меню (F2)"
        );
      }
    };
    console.log("[debug] window.dbg доступен: dbg.help()");
  }

  /** F2-меню: открыть выбор перка без перехода на уровень. */
  debugPerkChoice() {
    if (this.perkChoice) return;
    if (!this.perks || this.perks.roll(1).length === 0) {
      this.hud.showWaveBanner("ВСЕ ПЕРКИ УЖЕ ВЗЯТЫ");
      return;
    }
    this.beginPerkChoice(() => {});
  }

  /** Случайный доступный перк (кнопка меню «Случайный перк», dbg.perk()). */
  debugRandomPerk() {
    if (!this.perks) return false;
    const perk = this.perks.randomAvailable();
    if (!perk) {
      this.hud.showWaveBanner("ВСЕ ПЕРКИ УЖЕ ВЗЯТЫ");
      return false;
    }
    this.perks.add(perk.id);
    this.overlays.setPerks(this.perks.entries());
    this.hud.showWaveBanner("ПЕРК: " + perk.name.toUpperCase());
    return true;
  }

  /** Завершить забег и показать итоги без сохранения рекорда (кнопка меню, dbg.endRun()). */
  debugFinishRun() {
    if (this.summaryOpen) return;
    this._debugFinish = true;
    this.finishRun({ debug: true, save: false });
  }

  /**
   * Общий финиш забега: собрать сводку, сохранить рекорд и показать экран.
   * @param {Object} [opts]
   * @param {boolean} [opts.debug]
   * @param {boolean} [opts.save]
   */
  finishRun(opts = {}) {
    if (this.summaryOpen) return;
    // Захватить перки для итогового экрана, затем сбросить перки при смерти/финише,
    // чтобы они не перенеслись в следующий забег (итоговый экран уже скопировал их).
    const summary = this.runStats.summary(this.perks.entries());
    this.perks.reset();
    this.runStats.stop();
    this.runActive = false;

    let result = null;
    if (opts.save !== false && !opts.debug) {
      result = this.records.add(summary, this.runDaily, summary.seed);
    } else {
      result = {
        top: this.records.getTop(this.runDaily, summary.seed),
        isRecord: false,
        best: this.records.getBest(this.runDaily, summary.seed)
      };
    }

    this.summaryOpen = true;
    this.modalOpen = true;
    this.state = "death";
    this.hud.el.overlay.classList.add("hidden");
    this.hud.hideDeathScreen();
    this.overlays.showSummary(summary, result, { debug: !!opts.debug });
    if (this.input) this.input.exitLock();
  }

  /**
   * «Последний шанс»: кратковременное замедление при низком HP.
   * @returns {boolean}
   */
  tryLastChance() {
    if (!this.perks?.mods?.lastChance) return false;
    if (this.lastChanceCooldown > 0 || this.lastChanceTimer > 0) return false;
    this.lastChanceTimer = CONFIG.run?.lastChanceDuration ?? 3.0;
    this.lastChanceCooldown = CONFIG.run?.lastChanceCooldown ?? 40;
    this.hud.showWaveBanner("ПОСЛЕДНИЙ ШАНС!");
    return true;
  }

  refillAmmo() {
    for (let i = 0; i < this.weapons.length; i++) {
      this.weapons[i].refill();
    }
  }

  damageBarrel(barrel, dmg) {
    if (!this.barrels) return false;
    return this.barrels.damage(barrel, dmg);
  }

  damageTarget(target, dmg) {
    const killed = target.hit(dmg, this.fx);
    this.hud.showHitMarker(killed);
    this.audio.play("hit");
  }

  damageZombie(zombie, dmg, isHead, pushVec, source = null) {
    if (zombie) {
      zombie._lastHitSource = {
        weapon: source?.weapon || this.currentWeapon?.id || "shotgun",
        isExplosion: !!source?.isExplosion,
        isHead: !!isHead,
        inAir: this.player ? !this.player.onGround : false,
        time: performance.now() / 1000
      };
    }
    zombie.takeDamage(dmg, isHead, pushVec, this.fx, this);
    const killed = !zombie.alive;
    this.hud.showHitMarker(killed);
    if (!killed) {
      if (isHead) {
        this.audio.play("headshot");
        if (this.hud.showCenterTitle) {
          this.hud.showCenterTitle("ХЕДШОТ!", "headshot", 800);
        }
      } else {
        this.audio.play("hit");
      }
    }
  }

  onEnemyKilled(info) {
    if (this.styleMeter) {
      this.styleMeter.onEnemyKilled(info);
    }
  }

  triggerFlash(color) {
    this.hud.triggerFlash(color);
  }

  sayQuote(category) {
    if (this.quoteCooldown > 0) return;
    this.quoteCooldown = CONFIG.quotes.quoteCooldown;
    const list = CONFIG.quotes[category + "Quotes"] || CONFIG.quotes.killQuotes;
    const text = list[Math.floor(Math.random() * list.length)];
    this.hud.showQuote(text);
  }

  showWaveBanner(text) {
    this.hud.showWaveBanner(text);
    if (this.audio) this.audio.play("wave");
  }

  onZombieKill(points, isHeadshot, isGloryKill = false, enemy = null) {
    const hitSource = enemy?._lastHitSource;
    const enemyType = enemy?.type || (enemy?.isMutant ? "mutant" : enemy?.isRobot ? "robot" : enemy?.isReaper ? "reaper" : "zombie");
    const killInfo = {
      enemyType: enemyType,
      weapon: isGloryKill ? "glory" : (hitSource?.weapon || this.currentWeapon?.id || "shotgun"),
      isHeadshot: !!isHeadshot,
      isGloryKill: !!isGloryKill,
      inAir: this.player ? !this.player.onGround : false,
      isExplosion: !!(hitSource?.isExplosion),
      time: performance.now() / 1000,
      enemy: enemy
    };

    // Событийная шина убийств
    this.onEnemyKilled(killInfo);

    // Очки умножаются на множитель текущего ранга стиля и сложность
    const mult = this.styleMeter ? this.styleMeter.getMultiplier() : 1.0;
    const diffMult = this.difficultyCfg?.scoreMult ?? 1;
    const finalPoints = Math.round(points * mult * diffMult);

    this.kills++;
    if (isGloryKill) this.gloryKills++;
    this.score += finalPoints;
    this.killsSinceQuote++;

    // Перки: вампир лечит за добивание, «Броня за кровь» даёт броню за убийство
    if (this.player && !this.player.isDead) {
      if (isGloryKill) {
        const heal = this.perks?.mods?.gloryHeal ?? 0;
        if (heal > 0) {
          this.player.health = Math.min(this.player.maxHealth, this.player.health + heal);
        }
      }
      const armorPerKill = this.perks?.mods?.armorPerKill ?? 0;
      if (armorPerKill > 0) {
        this.player.armor = Math.min(this.player.maxArmor, (this.player.armor || 0) + armorPerKill);
      }
    }

    // Начиная с ранга 4 («БЕЗУМИЕ», «БОГ») каждое убийство восстанавливает +2 брони игроку
    if (this.styleMeter && this.styleMeter.rank >= 4 && this.player && !this.player.isDead) {
      const armorGain = CONFIG.style?.armorPerKill ?? 2;
      this.player.armor = Math.min(this.player.maxArmor, (this.player.armor || 0) + armorGain);
    }

    this.audio.play("kill");

    // Хит-стоп (замирание кадра при убийстве)
    if (!CONFIG.feel?.reduced) {
      this.hitstopTimer = CONFIG.feel?.enemy?.killHitstopDuration ?? 0.04;
    }

    // Отслеживание мультикилла (3+ врага за 1.0 с)
    const now = performance.now() / 1000;
    this.recentKillTimes.push(now);
    const window = CONFIG.feel?.enemy?.multikillWindow ?? 1.0;
    while (this.recentKillTimes.length > 0 && now - this.recentKillTimes[0] > window) {
      this.recentKillTimes.shift();
    }

    if (this.recentKillTimes.length >= (CONFIG.feel?.enemy?.multikillMinKills ?? 3)) {
      this.recentKillTimes.length = 0;
      if (!CONFIG.feel?.reduced) {
        this.slowmoTimer = CONFIG.feel?.enemy?.multikillSlowDuration ?? 0.4;
      }
      this.audio.play("multikill");
      if (this.hud.showCenterTitle) {
        this.hud.showCenterTitle("МУЛЬТИКИЛЛ!", "multikill", 1200);
      }
    } else if (isHeadshot) {
      this.audio.play("headshot");
      if (this.hud.showCenterTitle) {
        this.hud.showCenterTitle("ХЕДШОТ!", "headshot", 800);
      }
    } else if (isGloryKill) {
      if (this.hud.showCenterTitle) {
        this.hud.showCenterTitle("ДОБИТ!", "glory", 1000);
      }
    }

    if (this.killsSinceQuote >= CONFIG.quotes.killsPerQuote) {
      this.killsSinceQuote = 0;
      this.sayQuote("kill");
    }

    this.hud.setScore(this.kills, this.gloryKills, this.score);
  }

  /**
   * Награда за зачистку арены без правки LevelManager:
   * оборачиваем его метод onArenaCleared.
   * @private
   */
  _hookArenaClearConsumables() {
    const lm = this.levelManager;
    if (!lm || lm._consumablesHooked) return;
    const original = lm.onArenaCleared.bind(lm);
    lm.onArenaCleared = (arena) => {
      original(arena);
      if (this.pickupManager) this.pickupManager.spawnArenaClearConsumables(arena);
    };
    lm._consumablesHooked = true;
  }

  /**
   * Положить расходник в инвентарь (не больше maxStack).
   * @param {"vodka"|"joint"} type
   * @returns {boolean}
   */
  addConsumable(type) {
    if (type !== "vodka" && type !== "joint") return false;
    const max = CONFIG.effects.maxStack ?? 3;
    if ((this.consumables[type] || 0) >= max) return false;
    this.consumables[type] = (this.consumables[type] || 0) + 1;
    this.lastPickedConsumable = type;
    return true;
  }

  /**
   * Применить расходник (7 — водка, 8 — косяк, Q — последний подобранный).
   * Во время добивания применять нельзя.
   * @param {"vodka"|"joint"} type
   * @returns {boolean}
   */
  useConsumable(type) {
    if (type !== "vodka" && type !== "joint") return false;
    if (this.state !== "playing" || this.player.isDead || this.gloryKill.isActive) return false;
    if ((this.consumables[type] || 0) <= 0) return false;

    this.consumables[type]--;
    const mods = this.perks?.mods;
    const extra = type === "vodka" ? mods?.vodkaTime ?? 0 : mods?.jointTime ?? 0;
    const baseDuration = CONFIG.effects[type]?.duration ?? 0;
    this.effects.apply(type, baseDuration + extra);
    if (this.audio) this.audio.play("pickup");
    this.sayConsumeQuote(type);
    return true;
  }

  /** Применить последний подобранный расходник. */
  useLastConsumable() {
    if (!this.lastPickedConsumable) return false;
    return this.useConsumable(this.lastPickedConsumable);
  }

  /**
   * Реплика Васи при приёме расходника (без общего кулдауна).
   * @param {"vodka"|"joint"} type
   */
  sayConsumeQuote(type) {
    const list = CONFIG.quotes.consumeQuotes ? CONFIG.quotes.consumeQuotes[type] : null;
    if (!list || list.length === 0) return;
    const text = list[Math.floor(Math.random() * list.length)];
    this.hud.showQuote(text);
  }

  /** Сбросить расходники и эффекты (рестарт/новый уровень). */
  resetConsumables() {
    this.consumables.vodka = 0;
    this.consumables.joint = 0;
    this.lastPickedConsumable = null;
  }

  spawnDrops(pos, isGloryKill, wasStunned) {
    this.pickupManager.spawnDrops(pos, isGloryKill, wasStunned);
  }

  onPlayerDeath() {
    this.state = "death";
    if (this.gloryKill) this.gloryKill.cancel();
    if (this.styleMeter) this.styleMeter.reset();
    // Смерть снимает все расходные эффекты
    this.effects.clear();
    this.player.moveSpeedMult = 1;
    this.player.gravityMult = 1;
    this.player.drunkAmount = 0;
    this.consumableScreenFx.reset();
    this.funnyFaces.clear();
    this._drunkMaxShown = false;
    this.hud.updateEffects(this.effects);

    // Итоги забега и локальный рекорд (без отладочного финиша)
    if (!this._debugFinish) {
      this.finishRun({ debug: false, save: true });
    }
  }

  /** Надпись и реплика при максимальной силе водки. @private */
  _updateDrunkCaption() {
    const strength = this.effects.getStrength("vodka");
    if (strength >= 0.9 && !this._drunkMaxShown) {
      this._drunkMaxShown = true;
      this.hud.showWaveBanner("КАПИТАЛЬНО НАТАЩИЛСЯ");
      const list = CONFIG.quotes.drunkMaxQuotes;
      if (list && list.length > 0) {
        this.hud.showQuote(list[Math.floor(Math.random() * list.length)]);
      }
    } else if (strength < 0.85 || !this.effects.has("vodka")) {
      this._drunkMaxShown = false;
    }
  }

  /**
   * Сгенерировать новый уровень (F5 или смена сида)
   * @param {string|number} [seed]
   */
  regenerateLevel(seed) {
    this.weaponSwitchTimer = 0;
    this.effects.clear();
    if (this.styleMeter) this.styleMeter.reset();
    this.consumableScreenFx.reset();
    this.funnyFaces.clear();
    this._drunkMaxShown = false;
    this.player.drunkAmount = 0;
    this.resetConsumables();
    this.hud.updateConsumables(this.consumables);
    this.hud.updateEffects(this.effects);

    this.levelManager.startLevel(1, seed, { preservePlayer: false });

    // Предварительная компиляция шейдеров нового уровня
    try {
      this.renderer.compile(this.scene, this.camera);
      if (this.viewmodel) {
        this.renderer.compile(this.viewmodel.wScene, this.viewmodel.wCam);
      }
    } catch (e) {
      console.warn("Shader precompilation error:", e);
    }

    this.hud.setScore(this.kills, this.gloryKills, this.score);
    this.hud.hideDeathScreen();
    this.showWaveBanner("УРОВЕНЬ: " + this.world.seed);
  }

  /**
   * Вход в лифт теперь полностью обслуживается LevelManager
   * (активен только после зачистки всех арен).
   */
  checkExitPortal(dt) {
    // Оставлено для совместимости с внешними вызовами.
    if (this.levelManager) this.levelManager.checkLiftEntry(dt);
  }

  restartGame() {
    // R на экране итогов = новый забег с тем же сидом
    this.restartWithSameSeed();
  }

  /**
   * Функция тестирования 50 случайных уровней в консоли (testLevels(50))
   */
  setupTestLevels() {
    window.testLevels = (count = 50) => {
      const gen = new LevelGenerator();
      let unreachableExit = 0;
      let intersectingRooms = 0;
      let unreachableBlocks = 0;
      const templateCounts = {};
      const failedSeeds = [];

      for (let i = 0; i < count; i++) {
        const seed = "test_lvl_" + (i + 1) + "_" + Math.floor(Math.random() * 999999);
        try {
          const lvl = gen.generate(seed);

          // 1. Проверка пути start -> exit
          const adj = new Map();
          for (const r of lvl.rooms) adj.set(r.id, []);
          for (const [aKey, bKey] of lvl.edges) {
            const ra = lvl.roomsByCell.get(aKey);
            const rb = lvl.roomsByCell.get(bKey);
            if (ra && rb) {
              adj.get(ra.id).push(rb.id);
              adj.get(rb.id).push(ra.id);
            }
          }

          const q = [lvl.startRoom.id];
          const visited = new Set([lvl.startRoom.id]);
          while (q.length > 0) {
            const cur = q.shift();
            if (cur === lvl.exitRoom.id) break;
            for (const n of adj.get(cur) || []) {
              if (!visited.has(n)) {
                visited.add(n);
                q.push(n);
              }
            }
          }

          if (!visited.has(lvl.exitRoom.id)) {
            unreachableExit++;
            failedSeeds.push({ seed, error: "No path to exit" });
            continue;
          }

          // 2. Проверка комнат на отсутствие пересечений
          let overlap = false;
          for (let a = 0; a < lvl.rooms.length; a++) {
            for (let b = a + 1; b < lvl.rooms.length; b++) {
              const ra = lvl.rooms[a].bounds;
              const rb = lvl.rooms[b].bounds;
              if (
                ra.min.x < rb.max.x &&
                ra.max.x > rb.min.x &&
                ra.min.z < rb.max.z &&
                ra.max.z > rb.min.z
              ) {
                overlap = true;
                break;
              }
            }
            if (overlap) break;
          }
          if (overlap) {
            intersectingRooms++;
            failedSeeds.push({ seed, error: "Room overlap" });
            continue;
          }

          // 3. Проверка геометрии арен: границы, пересечения, проходы,
          //    зоны дверей, центр и достижимость ярусов/платформ
          let blockError = false;
          let arenaIssueText = "";
          for (const r of lvl.rooms) {
            if (r.type !== "arena") continue;
            templateCounts[r.arenaTemplate] = (templateCounts[r.arenaTemplate] || 0) + 1;

            const check = validateArenaRoom(r);
            if (!check.ok) {
              blockError = true;
              arenaIssueText = `${r.arenaTemplate}: ${check.issues.join(", ")}`;
              break;
            }
          }
          if (blockError) {
            unreachableBlocks++;
            failedSeeds.push({ seed, error: "Arena geometry: " + arenaIssueText });
          }
        } catch (err) {
          failedSeeds.push({ seed, error: err.message });
        }
      }

      const totalErrors = unreachableExit + intersectingRooms + unreachableBlocks + (failedSeeds.length - unreachableExit - intersectingRooms - unreachableBlocks);
      console.log("=== РЕЗУЛЬТАТ ТЕСТИРОВАНИЯ testLevels(" + count + ") ===");
      console.log("Проверено сидов:", count);
      console.log("Нет пути до exit:", unreachableExit);
      console.log("Пересечения комнат:", intersectingRooms);
      console.log("Ошибки геометрии арен (блоки/проходы/двери/достижимость):", unreachableBlocks);
      console.log("Шаблоны арен:", templateCounts);
      console.log("ВСЕГО ОШИБОК:", totalErrors);

      return {
        tested: count,
        unreachableExit,
        intersectingRooms,
        unreachableBlocks,
        templateCounts,
        totalErrors,
        failedSeeds
      };
    };
  }

  onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const aspect = width / height;

    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();

    if (this.viewmodel) {
      this.viewmodel.resize(aspect);
    }

    const pixelHeight = CONFIG.graphics && CONFIG.graphics.pixelHeight;
    if (pixelHeight && pixelHeight > 0) {
      const targetH = Math.round(pixelHeight);
      const targetW = Math.max(1, Math.round(targetH * aspect));
      this.renderer.setSize(targetW, targetH, false);
      if (this.screenEffects) {
        this.screenEffects.setSize(targetW, targetH);
      }
      updateSnapResolution(targetW, targetH);
    } else {
      this.renderer.setSize(width, height, true);
      if (this.screenEffects) {
        this.screenEffects.setSize(width, height);
      }
      updateSnapResolution(width, height);
    }
  }

  update(rawDt = 0.016) {
    if (this.armsEditorOpen && this.viewmodel && this.currentWeapon) {
      this.viewmodel.update(rawDt, this.player, this.currentWeapon.id, false);
      if (this.hud && this.hud.updateArmsReachIndicator) {
        this.hud.updateArmsReachIndicator();
      }
      return;
    }
    // Пока открыт выбор перка, итоги или редактор дробовика — мир и эффекты на паузе
    if (this.modalOpen || this.perkChoice || this.summaryOpen || this.shotgunEditorOpen) return;

    if (this.state === "playing" || this.player.isDead) {
      // Эффекты расходников идут по реальному времени (rawDt),
      // чтобы замедление добиванием их не растягивало.
      this.effects.update(rawDt);
      this.consumableScreenFx.update(rawDt, this.graphicsQuality);
      this.player.drunkAmount = this.consumableScreenFx.drunkControl;
      this.player.weedAmount = this.consumableScreenFx.weed;
      this.player.moveSpeedMult =
        this.effects.moveSpeedMult * (this.perks?.mods?.moveSpeedMult ?? 1);
      this.player.gravityMult = this.effects.gravityMult;
      this.funnyFaces.update(rawDt, this.consumableScreenFx.weed, this.enemyManager.zombies);
      this._updateDrunkCaption();

      // Перезарядка «Последнего шанса» идёт по реальному времени
      if (this.lastChanceCooldown > 0) {
        this.lastChanceCooldown = Math.max(0, this.lastChanceCooldown - rawDt);
      }

      // Базовый timeScale (добивание) × замедление от косяка
      let dtScale = this.timeScale * this.effects.timeScaleMult;

      // «Последний шанс»: замедление 3 с при низком HP
      if (this.lastChanceTimer > 0) {
        this.lastChanceTimer = Math.max(0, this.lastChanceTimer - rawDt);
        dtScale *= CONFIG.run?.lastChanceTimeScale ?? 0.6;
      }

      // Хит-стоп (кратковременное замирание кадра при убийстве)
      if (this.hitstopTimer > 0) {
        this.hitstopTimer -= rawDt;
        dtScale = 0;
      } else if (this.slowmoTimer > 0) {
        this.slowmoTimer -= rawDt;
        dtScale *= (CONFIG.feel?.enemy?.multikillTimeScale ?? 0.35);
      }

      const dt = rawDt * dtScale;

      // Пульсирующее тревожное сердцебиение при низком HP
      if (this.audio && this.audio.updateHeartbeat) {
        this.audio.updateHeartbeat(rawDt, this.player.health, this.player.maxHealth);
      }

      // Отладочное бессмертие: постоянно продлеваем существующие i-frames игрока
      if (this.debugGodMode && !this.player.isDead) {
        this.player.invulnT = Math.max(this.player.invulnT, 0.25);
      }

      // Обновление игрока
      this.player.update(dt, this.input.keys, this.world, this.gloryKill.isActive, this);

      // Ловушки арен (яма): возврат на край с уроном
      this.world.updateHazards(dt, this.player, this);

      // Стрельба игрока
      for (let i = 0; i < this.weapons.length; i++) {
        this.weapons[i].update(dt);
      }
      if (this.weaponSwitchTimer > 0) {
        this.weaponSwitchTimer -= dt;
      }

      if (this._emptyClickCooldown > 0) {
        this._emptyClickCooldown = Math.max(0, this._emptyClickCooldown - dt);
      }

      if (
        !this.player.isDead &&
        !this.gloryKill.isActive &&
        this.input.isMouseDown &&
        this.weaponSwitchTimer <= 0
      ) {
        if (this.currentWeapon.canFire()) {
          this.enemyManager.alertInRadius(this.player.pos, CONFIG.enemies.zombie.alertRadius);
          this.currentWeapon.fire(
            this.player,
            this.camera,
            this.world,
            this.world.targets,
            this.enemyManager.zombies,
            this.fx,
            this.projectiles
          );
          this.audio.play("shot_" + this.currentWeapon.id);
          this.viewmodel.triggerFlash(this.currentWeapon.cfg.kickBack, this.currentWeapon.id);
          this.viewmodel.triggerRecoil(this.currentWeapon.id);
        } else if (this.currentWeapon.cool <= 0 && this.currentWeapon.ammo <= 0) {
          if ((this._emptyClickCooldown || 0) <= 0) {
            this.audio.play("empty_click");
            this._emptyClickCooldown = 0.35;
          }
        }
      }

      // Дым для активной ракетницы
      if (this.currentWeapon.id === "rocket") {
        this.currentWeapon.updateSmoke(dt, this.camera, this.fx);
      }

      // Обновление снарядов
      this.projectiles.update(
        dt,
        this.world,
        this.world.targets,
        this.enemyManager.zombies,
        this.fx,
        this.player
      );

      // Обновление добивания
      this.gloryKill.update(dt, this.viewmodel, this.fx, rawDt);

      // Обновление врагов
      this.enemyManager.update(dt, this.player, this.world, this, this.fx);

      // Взрывные бочки: цепные взрывы и мигание (вне активной арены не анимируются)
      if (this.barrels) this.barrels.update(dt);

      // Арены, двери, лифт и прогрессия уровня
      this.levelManager.update(dt);

      // Обновление предметов
      this.pickupManager.update(dt, this.player, this.fx);

      // Обновление эффектов и мира
      this.particles.update(dt);
      this.decals.update(dt);
      this.tracers.update(dt);
      this.gore.update(dt);
      this.screenEffects.update(dt);
      this.world.update(dt, this.player.pos);

      // Обновление вида оружия
      this.viewmodel.update(dt, this.player, this.currentWeapon.id, this.gloryKill.isActive);

      // Обновление стиль-метра (затухание, устаревание бонусов, HUD, свечение оружия)
      if (this.styleMeter) {
        this.styleMeter.update(dt);
        this.hud.updateStyle(this.styleMeter.getState());
        if (this.viewmodel && this.viewmodel.setStyleRank) {
          this.viewmodel.setStyleRank(this.styleMeter.rank, this.styleMeter.getRankColor());
        }
      }

      // Статистика забега и максимальный ранг стиля
      if (this.state === "playing" && !this.player.isDead && this.runStats) {
        this.runStats.update(rawDt, this.styleMeter);
      }

      // Задержка реплик Васи
      if (this.quoteCooldown > 0) {
        this.quoteCooldown -= dt;
      }

      // Обновление интерфейса
      this.hud.update(
        rawDt,
        this.player,
        this.currentWeapon,
        this.enemyManager,
        this.world,
        this.levelManager,
        this.effects,
        this.consumables
      );

      // Автоснижение качества по среднему FPS
      this._trackPerformance(rawDt);
    }
  }

  loop() {
    requestAnimationFrame(() => this.loop());

    const now = performance.now();
    const frameDelta = this._lastFramePerf ? (now - this._lastFramePerf) : 16.6;
    this._lastFramePerf = now;

    if (this._frameCount === undefined) this._frameCount = 0;
    this._frameCount++;

    const curPrograms = (this.renderer.info && this.renderer.info.programs)
      ? this.renderer.info.programs.length
      : 0;
    const activeLights = (this.world && this.world.pointLightPool)
      ? this.world.pointLightPool.filter((l) => l.intensity > 0).length
      : 0;

    // Всплеск времени кадра (> 40 мс) с выявлением причины
    if (frameDelta > 40 && this.state === "playing" && this._frameCount > 10) {
      let reason = "GC / сборка мусора или системная задача";
      if (this._prevProgramsCount !== undefined && curPrograms > this._prevProgramsCount) {
        reason = `Компиляция шейдерной программы (${this._prevProgramsCount} -> ${curPrograms})`;
      } else if (this._prevActiveLights !== undefined && activeLights !== this._prevActiveLights) {
        reason = `Изменилось число видимых источников света (${this._prevActiveLights} -> ${activeLights})`;
      }
      console.warn(`[Frame Spike] ${frameDelta.toFixed(1)} мс | Причина: ${reason}`);
    }

    // Обновление отладочной панели (F3)
    if (this.hud && this.hud.updateDebugPanel) {
      this.hud.updateDebugPanel({
        fps: Math.round(1000 / Math.max(1, frameDelta)),
        frameTime: frameDelta,
        activeLights,
        programs: curPrograms,
        calls: (this.renderer.info && this.renderer.info.render) ? this.renderer.info.render.calls : 0,
        triangles: (this.renderer.info && this.renderer.info.render) ? this.renderer.info.render.triangles : 0,
        geometries: (this.renderer.info && this.renderer.info.memory) ? this.renderer.info.memory.geometries : 0,
        textures: (this.renderer.info && this.renderer.info.memory) ? this.renderer.info.memory.textures : 0,
        viewmodel: this.viewmodel ? this.viewmodel.getDiagnostics() : null,
        weaponInComposer: CONFIG.graphics && CONFIG.graphics.weaponInComposer !== false,
        styleRank: this.styleMeter ? this.styleMeter.rank : 0,
        styleRankName: this.styleMeter ? this.styleMeter.getRankName() : "ПУСТО",
        styleValue: this.styleMeter ? this.styleMeter.value : 0,
        styleMult: this.styleMeter ? this.styleMeter.getMultiplier() : 1.0
      });
    }

    this._prevProgramsCount = curPrograms;
    this._prevActiveLights = activeLights;

    const rawDt = Math.min(this.clock.getDelta(), 0.05);
    this.update(rawDt);

    // EffectComposer (bloom + drunk/weed + виньетка); вьюмодель оружия
    // рисуется внутри композера через OverlayPass (при weaponInComposer: true)
    // или прямо на экран поверх композера (при weaponInComposer: false).
    this.screenEffects.render(rawDt);

    if (CONFIG.graphics && CONFIG.graphics.weaponInComposer === false) {
      this.renderer.setRenderTarget(null);
      this.renderer.autoClear = false;
      this.renderer.state.buffers.depth.setMask(true);
      this.renderer.clearDepth();
      this.viewmodel.render(this.renderer);
    }
  }
}
