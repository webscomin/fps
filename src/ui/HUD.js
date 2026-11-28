// Пользовательский интерфейс: прицел, индикаторы здоровья/брони, рывка, патронов, реплик и виньеток
import { CONFIG } from "../config.js";

export class HUD {
  constructor() {
    const $ = (id) => document.getElementById(id);

    this.el = {
      overlay: $("overlay"),
      title: $("title"),
      deathScreen: $("deathScreen"),
      deathStats: $("deathStats"),
      restartBtn: $("restartBtn"),
      dash: $("dash"),
      dashFill: $("dashFill"),
      dashLabel: $("dashLabel"),
      fps: $("fps"),
      seedBadge: $("seedBadge"),
      seedContainer: $("seedContainer"),
      seedLabel: $("seedLabel"),
      seedInput: $("seedInput"),
      startBtn: $("startBtn"),
      pauseSeedDisplay: $("pauseSeedDisplay"),
      minimap: $("minimap"),
      waveBadge: $("waveBadge"),
      levelBadge: $("levelBadge"),
      arenaBadge: $("arenaBadge"),
      killsBadge: $("killsBadge"),
      scoreBadge: $("scoreBadge"),
      liftHint: $("liftHint"),
      liftArrow: $("liftArrow"),
      levelStats: $("levelStats"),
      levelStatsBody: $("levelStatsBody"),
      hpVal: $("hpVal"),
      hpFill: $("hpFill"),
      apVal: $("apVal"),
      apFill: $("apFill"),
      vignette: $("vignette"),
      gloryVignette: $("gloryVignette"),
      pickupFlash: $("pickupFlash"),
      dmgIndicator: $("dmgIndicator"),
      dmgArc: $("dmgArc"),
      quoteBox: $("quoteBox"),
      waveBanner: $("waveBanner"),
      crosshair: $("crosshair"),
      chRing: $("chRing"),
      chDot: $("chDot"),
      hit: $("hit"),
      wname: $("wname"),
      wammo: $("wammo"),
      slots: $("slots"),
      graphicsPanel: $("graphicsPanel"),
      gfxLow: $("gfxLow"),
      gfxMedium: $("gfxMedium"),
      gfxHigh: $("gfxHigh"),
      perfPrompt: $("perfPrompt"),
      perfText: $("perfText"),
      perfAccept: $("perfAccept"),
      perfDismiss: $("perfDismiss"),
      settingsPanel: $("settingsPanel"),
      volumeSlider: $("volumeSlider"),
      volumeVal: $("volumeVal"),
      reducedEffectsToggle: $("reducedEffectsToggle"),
      dashOverlay: $("dashOverlay"),
      centerTitle: $("centerTitle"),
      hpGhost: $("hpGhost"),
      stylePsx: $("stylePsx"),
      styleCartoon: $("styleCartoon"),
      res240: $("res240"),
      res360: $("res360"),
      res480: $("res480"),
      resOff: $("resOff"),
      snapOff: $("snapOff"),
      snapLow: $("snapLow"),
      snapHigh: $("snapHigh"),
      brightnessSlider: $("brightnessSlider"),
      brightnessVal: $("brightnessVal"),
      fovSlider: $("fovSlider"),
      fovVal: $("fovVal"),
      grainOn: $("grainOn"),
      grainOff: $("grainOff"),
      flickerOn: $("flickerOn"),
      flickerOff: $("flickerOff"),
      debugPanel: $("debugPanel"),
      styleFlash: $("styleFlash"),
      styleContainer: $("styleContainer"),
      styleRank: $("styleRank"),
      styleMult: $("styleMult"),
      styleFill: $("styleFill"),
      styleBonuses: $("styleBonuses"),
      shotgunEditor: $("shotgunEditor")
    };

    this.chMap = {
      shotgun: this.el.chRing,
      ak47: this.el.chDot,
      rocket: this.el.crosshair
    };

    this.hitT = 0;
    this.hitKill = false;
    this.flashTimer = 0;
    this.frames = 0;
    this.fpsTime = 0;
    this.ammoText = "";
    this.prevAmmo = -1;
    this.ghostHp = CONFIG.player.health;
    this._centerTitleTimer = 0;

    this.minimapVisible = true;
    this._levelStatsTimer = 0;

    // HUD расходников и активных эффектов (создаётся динамически)
    this.consumables = { vodka: 0, joint: 0 };
    this._consumableSig = "";
    this._effectNodes = new Map();
    this._setupConsumableHud();
    this._setupEffectsHud();
    this._setupReducedEffectsToggle();
    this._setupZombieStyleToggle();
    this._setupSettingsPanel();

    // Отладочное меню (F2, только при CONFIG.debug.cheats)
    this.debugMenuVisible = false;
    this.onDebugAction = null;
    this._setupDebugMenu();

    // Защита поля ввода сида от перехвата кликов оверлеем (захвата курсора)
    if (this.el.seedContainer) {
      const stopEvent = (e) => e.stopPropagation();
      this.el.seedContainer.addEventListener("click", stopEvent);
      this.el.seedContainer.addEventListener("mousedown", stopEvent);
      this.el.seedContainer.addEventListener("pointerdown", stopEvent);
    }
    if (this.el.seedLabel) {
      this.el.seedLabel.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.el.seedInput) this.el.seedInput.focus();
      });
      this.el.seedLabel.addEventListener("mousedown", (e) => e.stopPropagation());
      this.el.seedLabel.addEventListener("pointerdown", (e) => e.stopPropagation());
    }
    if (this.el.seedInput) {
      this.el.seedInput.addEventListener("click", (e) => e.stopPropagation());
      this.el.seedInput.addEventListener("mousedown", (e) => e.stopPropagation());
      this.el.seedInput.addEventListener("pointerdown", (e) => e.stopPropagation());
      this.el.seedInput.addEventListener("keydown", (e) => e.stopPropagation());
    }

    // Клики по переключателю качества не должны запускать игру/снимать паузу
    if (this.el.graphicsPanel) {
      const stop = (e) => e.stopPropagation();
      this.el.graphicsPanel.addEventListener("click", stop);
      this.el.graphicsPanel.addEventListener("mousedown", stop);
      this.el.graphicsPanel.addEventListener("pointerdown", stop);
    }
  }

  /**
   * Подсветить выбранный режим качества.
   * @param {"low"|"medium"|"high"} mode
   */
  setGraphicsQuality(mode) {
    const map = {
      low: this.el.gfxLow,
      medium: this.el.gfxMedium,
      high: this.el.gfxHigh
    };
    for (const key in map) {
      const btn = map[key];
      if (!btn) continue;
      const on = key === mode;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  /**
   * Подсветить выбранный стиль графики (PSX / Картун).
   * @param {"psx"|"cartoon"} style
   */
  setGraphicsStyle(style) {
    if (this.el.stylePsx) {
      const on = style === "psx";
      this.el.stylePsx.classList.toggle("on", on);
      this.el.stylePsx.setAttribute("aria-pressed", on ? "true" : "false");
    }
    if (this.el.styleCartoon) {
      const on = style === "cartoon";
      this.el.styleCartoon.classList.toggle("on", on);
      this.el.styleCartoon.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  /**
   * Подсветить выбранное разрешение рендера (240 / 360 / 480 / off).
   * @param {number|null} res
   */
  setPixelResolution(res) {
    const map = {
      240: this.el.res240,
      360: this.el.res360,
      480: this.el.res480,
      off: this.el.resOff
    };
    const current = res === null || res === undefined ? "off" : String(res);
    for (const key in map) {
      const btn = map[key];
      if (!btn) continue;
      const on = key === current;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  /**
   * Подсветить уровень дрожания вершин PS1 (0=выкл, 1=слабо, 2=сильно).
   * @param {number} level
   */
  setVertexSnap(level) {
    const map = {
      0: this.el.snapOff,
      1: this.el.snapLow,
      2: this.el.snapHigh
    };
    const current = Number(level) || 0;
    for (const key in map) {
      const btn = map[key];
      if (!btn) continue;
      const on = Number(key) === current;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  /**
   * Установить значение слайдера яркости (0.7 - 1.8).
   * @param {number} val
   */
  setBrightness(val) {
    const v = Number(val) || 1.2;
    if (this.el.brightnessSlider) {
      this.el.brightnessSlider.value = Math.round(v * 100);
    }
    if (this.el.brightnessVal) {
      this.el.brightnessVal.textContent = v.toFixed(2);
    }
  }

  /**
   * Подсветка переключателя зернистости (Вкл/Выкл).
   * @param {boolean} enabled
   */
  setGrainEnabled(enabled) {
    if (this.el.grainOn) {
      this.el.grainOn.classList.toggle("on", !!enabled);
      this.el.grainOn.setAttribute("aria-pressed", enabled ? "true" : "false");
    }
    if (this.el.grainOff) {
      this.el.grainOff.classList.toggle("on", !enabled);
      this.el.grainOff.setAttribute("aria-pressed", !enabled ? "true" : "false");
    }
  }

  /**
   * Подсветка переключателя мигания ламп (Вкл/Выкл).
   * @param {boolean} enabled
   */
  setFlickerEnabled(enabled) {
    if (this.el.flickerOn) {
      this.el.flickerOn.classList.toggle("on", !!enabled);
      this.el.flickerOn.setAttribute("aria-pressed", enabled ? "true" : "false");
    }
    if (this.el.flickerOff) {
      this.el.flickerOff.classList.toggle("on", !enabled);
      this.el.flickerOff.setAttribute("aria-pressed", !enabled ? "true" : "false");
    }
  }

  /**
   * Переключить отображение отладочной панели (F3).
   */
  toggleDebugPanel() {
    if (!this.el.debugPanel) return;
    const isHidden = this.el.debugPanel.style.display === "none";
    this.el.debugPanel.style.display = isHidden ? "block" : "none";
    return isHidden;
  }

  /**
   * Установить значение слайдера FOV.
   * @param {number} val
   */
  setFov(val) {
    if (this.el.fovSlider) this.el.fovSlider.value = String(val);
    if (this.el.fovVal) this.el.fovVal.textContent = String(val);
  }

  /**
   * Обновить текстовую информацию на отладочной панели.
   * @param {Object} data
   */
  updateDebugPanel(data) {
    if (!this.el.debugPanel || this.el.debugPanel.style.display === "none") return;
    let vmText = "";
    if (data.viewmodel) {
      const vm = data.viewmodel;
      vmText = `\n[VIEWMODEL]\n` +
        `Weapon:        ${vm.activeWeapon} (vis: ${vm.modelVisible})\n` +
        `Meshes:        ${vm.childMeshCount} (NaN: ${vm.nanFound ? "ERR" : "OK"})\n` +
        `ViewPos:       ${vm.viewPos.x}, ${vm.viewPos.y}, ${vm.viewPos.z}\n` +
        `ComposerMode:  ${data.weaponInComposer ? "true" : "false"}`;
    }
    let styleText = "";
    if (data.styleRank !== undefined) {
      const mult = data.styleMult ?? data.styleMultiplier ?? 1;
      styleText = `\n[STYLE METER]\n` +
        `Rank:          ${data.styleRank} (${data.styleRankName})\n` +
        `Value:         ${(data.styleValue ?? 0).toFixed(1)} / 100\n` +
        `Multiplier:    x${mult.toFixed(1)}`;
    }
    this.el.debugPanel.textContent =
      `[DEBUG INFO (F3)]\n` +
      `FPS:           ${data.fps}\n` +
      `Frame Time:    ${data.frameTime.toFixed(1)} ms\n` +
      `PointLights:   ${data.activeLights}\n` +
      `Shader Progs:  ${data.programs}\n` +
      `Draw Calls:    ${data.calls}\n` +
      `Triangles:     ${data.triangles.toLocaleString()}\n` +
      `Geometries:    ${data.geometries}\n` +
      `Textures:      ${data.textures}` +
      styleText +
      vmText;
  }

  /**
   * Обновить отображение стиль-метра.
   * @param {Object} state
   */
  updateStyle(state) {
    if (!state || !this.el.styleContainer) return;
    if (this.el.styleRank) {
      this.el.styleRank.textContent = state.name;
    }
    if (this.el.styleMult) {
      this.el.styleMult.textContent = `x${state.mult.toFixed(1)}`;
    }
    if (this.el.styleFill) {
      const pct = Math.max(0, Math.min(100, state.value));
      this.el.styleFill.style.width = `${pct}%`;
    }
    this.el.styleContainer.style.setProperty("--style-rank-color", state.color);

    if (state.rank === 5) {
      this.el.styleContainer.classList.add("pulse");
    } else {
      this.el.styleContainer.classList.remove("pulse");
    }

    if (this.el.styleBonuses) {
      const bonuses = state.recentBonuses || [];
      const currentIds = Array.from(this.el.styleBonuses.children)
        .map((c) => c.dataset.id)
        .join(",");
      const newIds = bonuses.map((b) => b.id).join(",");
      if (currentIds !== newIds) {
        this.el.styleBonuses.innerHTML = "";
        for (const b of bonuses) {
          const div = document.createElement("div");
          div.className = "styleBonusItem";
          div.dataset.id = b.id;
          div.textContent = b.text;
          this.el.styleBonuses.appendChild(div);
        }
      }
    }
  }

  /**
   * Короткая вспышка по краю экрана цвета ступени.
   * @param {string} color
   */
  triggerStyleFlash(color) {
    if (!this.el.styleFlash) return;
    const reduced = !!(CONFIG.feel && CONFIG.feel.reduced);
    const maxOp = reduced ? 0.35 : 0.75;
    this.el.styleFlash.style.setProperty("--style-flash-color", color);
    this.el.styleFlash.style.opacity = String(maxOp);

    if (this._styleFlashTimer) clearTimeout(this._styleFlashTimer);
    this._styleFlashTimer = setTimeout(() => {
      if (this.el.styleFlash) {
        this.el.styleFlash.style.opacity = "0";
      }
      this._styleFlashTimer = 0;
    }, 140);
  }

  /**
   * Короткая белая вспышка по краям экрана при заднем выхлопе ракетницы (<= 0.08 с).
   */
  triggerBackblastFlash() {
    if (!this.el.styleFlash) return;
    const reduced = !!(CONFIG.feel && CONFIG.feel.reduced);
    const maxOp = reduced ? 0.16 : 0.42;
    this.el.styleFlash.style.setProperty("--style-flash-color", "#ffffff");
    this.el.styleFlash.style.opacity = String(maxOp);

    if (this._styleFlashTimer) clearTimeout(this._styleFlashTimer);
    this._styleFlashTimer = setTimeout(() => {
      if (this.el.styleFlash) {
        this.el.styleFlash.style.opacity = "0";
      }
      this._styleFlashTimer = 0;
    }, 75);
  }

  /**
   * Лёгкое встряхивание шкалы стиля при получении очков.
   */
  shakeStyleMeter() {
    if (!this.el.styleContainer) return;
    const reduced = !!(CONFIG.feel && CONFIG.feel.reduced);
    const cls = reduced ? "shake-reduced" : "shake";
    this.el.styleContainer.classList.remove("shake", "shake-reduced");
    void this.el.styleContainer.offsetWidth;
    this.el.styleContainer.classList.add(cls);

    if (this._styleShakeTimer) clearTimeout(this._styleShakeTimer);
    this._styleShakeTimer = setTimeout(() => {
      if (this.el.styleContainer) {
        this.el.styleContainer.classList.remove("shake", "shake-reduced");
      }
      this._styleShakeTimer = 0;
    }, 160);
  }

  /**
   * Показать предложение включить режим производительности.
   * @param {number} fps
   */
  showPerfPrompt(fps) {
    if (!this.el.perfPrompt) return;
    if (this.el.perfText) {
      this.el.perfText.textContent =
        "Средний FPS: " + Math.round(fps) + ". Включить режим производительности?";
    }
    this.el.perfPrompt.classList.add("show");
  }

  /** Скрыть предложение режима производительности. */
  hidePerfPrompt() {
    if (this.el.perfPrompt) this.el.perfPrompt.classList.remove("show");
  }

  /**
   * Переключить отображение миникарты (F4)
   */
  toggleMinimap() {
    this.minimapVisible = !this.minimapVisible;
    if (this.el.minimap) {
      this.el.minimap.style.display = this.minimapVisible ? "block" : "none";
    }
  }

  /**
   * Отрисовка миникарты на канвасе
   * @param {Object} world
   * @param {Object} player
   */
  renderMinimap(world, player, enemyManager = null) {
    if (!this.minimapVisible || !this.el.minimap || !world || !world.rooms) return;

    const cv = this.el.minimap;
    const ctx = cv.getContext("2d");
    const W = cv.width;
    const H = cv.height;

    // Очистка фона миникарты
    ctx.fillStyle = "rgba(27, 19, 64, 0.92)";
    ctx.fillRect(0, 0, W, H);

    // Размер мира: 4x4 сетка с ячейками 36 м = 144 м (-72 до +72)
    const worldSpan = (CONFIG.level.gridSize || 4) * (CONFIG.level.cellSize || 36);
    const halfSpan = worldSpan / 2;
    const pad = 12;
    const mapArea = W - pad * 2;

    const toMapX = (wx) => pad + ((wx + halfSpan) / worldSpan) * mapArea;
    const toMapZ = (wz) => pad + ((wz + halfSpan) / worldSpan) * mapArea;

    // 1. Отрисовка коридоров
    if (world.corridors) {
      ctx.fillStyle = "#6c757d";
      ctx.strokeStyle = "#1b1340";
      ctx.lineWidth = 1.5;

      for (const corr of world.corridors) {
        const ra = corr.roomA;
        const rb = corr.roomB;
        if (!ra || !rb) continue;

        const x1 = Math.min(ra.center.x, rb.center.x);
        const x2 = Math.max(ra.center.x, rb.center.x);
        const z1 = Math.min(ra.center.z, rb.center.z);
        const z2 = Math.max(ra.center.z, rb.center.z);

        const dw = CONFIG.level.corridorWidth || 4;
        const mx1 = toMapX(x1 - (z1 === z2 ? 0 : dw / 2));
        const mz1 = toMapZ(z1 - (x1 === x2 ? 0 : dw / 2));
        const mx2 = toMapX(x2 + (z1 === z2 ? 0 : dw / 2));
        const mz2 = toMapZ(z2 + (x1 === x2 ? 0 : dw / 2));

        ctx.fillRect(mx1, mz1, Math.max(3, mx2 - mx1), Math.max(3, mz2 - mz1));
        ctx.strokeRect(mx1, mz1, Math.max(3, mx2 - mx1), Math.max(3, mz2 - mz1));
      }
    }

    // 2. Отрисовка комнат с цветовым кодированием по типам
    const typeColors = {
      start: "#38b000", // Зелёный
      arena: "#ff4f8b", // Розово-малиновый
      loot:  "#ffd23f", // Золотой
      exit:  "#4cc9f0"  // Неоново-голубой
    };

    for (const room of world.rooms) {
      const rx = toMapX(room.center.x - room.w / 2);
      const rz = toMapZ(room.center.z - room.d / 2);
      const rw = (room.w / worldSpan) * mapArea;
      const rd = (room.d / worldSpan) * mapArea;

      ctx.fillStyle = typeColors[room.type] || "#888";
      ctx.fillRect(rx, rz, rw, rd);

      ctx.strokeStyle = "#1b1340";
      ctx.lineWidth = 2;
      ctx.strokeRect(rx, rz, rw, rd);

      // Иконка / буква типа комнаты
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 9px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const label = room.type === "start" ? "S" : room.type === "exit" ? "EX" : room.type === "loot" ? "$" : "A";
      ctx.fillText(label, rx + rw / 2, rz + rd / 2);
    }

    // 3. Отрисовка позиции игрока
    if (player && player.pos) {
      const px = toMapX(player.pos.x);
      const pz = toMapZ(player.pos.z);

      // Маркер игрока
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(px, pz, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#1b1340";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Стрелка взгляда игрока
      const yaw = player.yaw || 0;
      const arrowLen = 9;
      const ax = px - Math.sin(yaw) * arrowLen;
      const az = pz - Math.cos(yaw) * arrowLen;

      ctx.strokeStyle = "#ffff00";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, pz);
      ctx.lineTo(ax, az);
      ctx.stroke();
    }

    // 4. Отрисовка активных врагов (красные точки, включая пугало)
    if (enemyManager && enemyManager.zombies) {
      ctx.fillStyle = "#e63946";
      for (let i = 0; i < enemyManager.zombies.length; i++) {
        const e = enemyManager.zombies[i];
        if (!e.alive) continue;
        const ex = toMapX(e.pos.x);
        const ez = toMapZ(e.pos.z);
        ctx.beginPath();
        ctx.arc(ex, ez, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Заголовок миникарты
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("КАРТА (F4)", 8, 6);
  }

  /**
   * Установить отображение сида в интерфейсе
   * @param {string} seedStr
   */
  setSeed(seedStr) {
    if (this.el.seedBadge) {
      this.el.seedBadge.textContent = "SEED: " + seedStr;
    }
    if (this.el.pauseSeedDisplay) {
      this.el.pauseSeedDisplay.textContent = "СИД УРОВНЯ: " + seedStr;
    }
  }

  /**
   * Показать экран паузы с текущим сидом
   * @param {string} seedStr
   */
  showPause(seedStr) {
    if (this.el.seedContainer) this.el.seedContainer.style.display = "none";
    if (this.overlays) this.overlays.setMenuVisible(false);
    if (this.el.pauseSeedDisplay) {
      this.el.pauseSeedDisplay.style.display = "block";
      this.el.pauseSeedDisplay.textContent = "СИД УРОВНЯ: " + seedStr;
    }
    if (this.el.title) {
      this.el.title.textContent = "Пауза — нажми, чтобы продолжить";
    }
    this.el.overlay.classList.remove("hidden");
  }

  /**
   * Показать стартовый экран
   */
  showStart() {
    if (this.el.seedContainer) this.el.seedContainer.style.display = "flex";
    if (this.overlays) this.overlays.setMenuVisible(true);
    if (this.el.pauseSeedDisplay) this.el.pauseSeedDisplay.style.display = "none";
    if (this.el.title) {
      this.el.title.textContent = "Нажми, чтобы начать";
    }
    this.el.overlay.classList.remove("hidden");
  }

  /**
   * Инициализация слотов оружия
   * @param {Array} weapons
   */
  initWeaponSlots(weapons) {
    const icons = { shotgun: "💥", ak47: "АК", rocket: "🚀" };
    this.el.slots.innerHTML = weapons
      .map((w, i) => '<div class="slot">' + (i + 1) + " " + (icons[w.id] || "") + "</div>")
      .join("");
  }

  /**
   * Обновить выбранное оружие
   */
  selectWeapon(weapon, index) {
    for (const id in this.chMap) {
      if (this.chMap[id]) {
        this.chMap[id].style.display = id === weapon.id ? "block" : "none";
      }
    }

    const slotElements = this.el.slots.children;
    for (let i = 0; i < slotElements.length; i++) {
      slotElements[i].classList.toggle("on", i === index);
    }

    this.el.wname.textContent = weapon.cfg.name;
    this.ammoText = "";
  }

  showHitMarker(isKill) {
    if (isKill) {
      this.hitKill = true;
      this.hitT = CONFIG.feel?.hitmarker?.killDuration ?? 0.24;
    } else {
      this.hitKill = false;
      this.hitT = CONFIG.feel?.hitmarker?.hitDuration ?? 0.14;
    }
  }

  /**
   * Отображение крупного заголовка по центру экрана («ХЕДШОТ!», «МУЛЬТИКИЛЛ!», «ДОБИТ!»)
   * @param {string} text
   * @param {"headshot"|"multikill"|"glory"} type
   * @param {number} duration
   */
  showCenterTitle(text, type = "headshot", duration = 1000) {
    if (!this.el.centerTitle) return;
    this.el.centerTitle.className = "";
    this.el.centerTitle.textContent = text;
    void this.el.centerTitle.offsetWidth;
    this.el.centerTitle.className = "show " + type;

    if (this._centerTitleTimer) clearTimeout(this._centerTitleTimer);
    this._centerTitleTimer = setTimeout(() => {
      if (this.el.centerTitle) {
        this.el.centerTitle.className = "";
      }
      this._centerTitleTimer = 0;
    }, duration);
  }

  triggerFlash(color) {
    this.el.pickupFlash.className = color;
    this.el.pickupFlash.style.opacity = "1";
    this.flashTimer = 0.22;
  }

  /** Панель настроек (громкость и ослабление эффектов) в меню паузы. @private */
  _setupSettingsPanel() {
    if (this.el.settingsPanel) {
      const stop = (e) => e.stopPropagation();
      this.el.settingsPanel.addEventListener("click", stop);
      this.el.settingsPanel.addEventListener("mousedown", stop);
      this.el.settingsPanel.addEventListener("pointerdown", stop);
    }

    if (this.el.volumeSlider) {
      let savedVol = null;
      try {
        savedVol = localStorage.getItem("fps_master_volume");
      } catch (_) {}
      let vol = savedVol !== null ? parseInt(savedVol, 10) : 55;
      if (isNaN(vol)) vol = 55;
      this.el.volumeSlider.value = vol;
      if (this.el.volumeVal) this.el.volumeVal.textContent = vol + "%";

      this.el.volumeSlider.addEventListener("input", (e) => {
        const val = parseInt(e.target.value, 10);
        if (this.el.volumeVal) this.el.volumeVal.textContent = val + "%";
        try {
          localStorage.setItem("fps_master_volume", String(val));
        } catch (_) {}
        if (window._gameAudioInstance) {
          window._gameAudioInstance.setVolume(val / 100);
        }
      });
    }

    if (this.el.reducedEffectsToggle) {
      let savedReduced = null;
      try {
        savedReduced = localStorage.getItem("fps_reduced_effects");
      } catch (_) {}
      const isReduced = savedReduced === "1" || !!CONFIG.feel.reduced;
      this.el.reducedEffectsToggle.checked = isReduced;
      CONFIG.feel.reduced = isReduced;

      this.el.reducedEffectsToggle.addEventListener("change", (e) => {
        const checked = e.target.checked;
        CONFIG.feel.reduced = checked;
        if (CONFIG.effects && CONFIG.effects.reduced) {
          CONFIG.effects.reduced.active = checked;
        }
        try {
          localStorage.setItem("fps_reduced_effects", checked ? "1" : "0");
        } catch (_) {}
      });
    }
  }

  /**
   * Отладочное меню (F2): компактная ретро-панель с кнопками-читами.
   * Кнопки только вызывают готовые действия игры через this.onDebugAction.
   * @private
   */
  _setupDebugMenu() {
    const root = document.createElement("div");
    root.id = "debugMenu";
    root.setAttribute("aria-hidden", "true");

    const panel = document.createElement("div");
    panel.className = "debugMenuPanel";

    const title = document.createElement("div");
    title.className = "debugMenuTitle";
    title.textContent = "ОТЛАДКА";
    panel.appendChild(title);

    const hint = document.createElement("div");
    hint.className = "debugMenuHint";
    hint.textContent = "F2 — закрыть";
    panel.appendChild(hint);

    const list = document.createElement("div");
    list.className = "debugMenuList";
    panel.appendChild(list);

    // [action, подпись]. Действия обрабатывает Game.handleDebugAction().
    const actions = [
      ["newLevel", "Новый уровень"],
      ["style40", "+40 стиля"],
      ["resetStyle", "Сбросить стиль"],
      ["consumables", "Выдать расходники (по 3)"],
      ["perkChoice", "Окно выбора перка"],
      ["randomPerk", "Случайный перк"],
      ["endRun", "Завершить забег"],
      ["spawnReaper", "Спавн: пугало"],
      ["spawnPhantom", "Спавн: призрак"],
      ["spawnZombie", "Спавн: зомби"],
      ["spawnMutant", "Спавн: мутант"],
      ["spawnBarrel", "Спавн: бочка"],
      ["editShotgun", "Редактор оружия"],
      ["editArms", "Редактор рук"],
      ["toggleHideWeapons", "Скрыть оружие: выкл"],
      ["weaponRender", "Режим оружия: композер"],
      ["god", "Бессмертие: выкл"]
    ];

    this.el.debugMenuButtons = {};
    for (const [action, label] of actions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "debugMenuBtn";
      btn.dataset.action = action;
      btn.textContent = label;
      // Клики по панели не должны доходить до оверлея/захвата курсора
      btn.addEventListener("mousedown", (e) => e.stopPropagation());
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.onDebugAction) this.onDebugAction(action);
      });
      list.appendChild(btn);
      this.el.debugMenuButtons[action] = btn;
    }

    root.appendChild(panel);
    document.body.appendChild(root);
    this.el.debugMenu = root;
  }

  /**
   * Показать/скрыть отладочное меню.
   * @param {boolean} visible
   */
  showDebugMenu(visible) {
    if (!this.el.debugMenu) return;
    this.debugMenuVisible = !!visible;
    this.el.debugMenu.classList.toggle("open", this.debugMenuVisible);
    this.el.debugMenu.setAttribute("aria-hidden", this.debugMenuVisible ? "false" : "true");
  }

  /**
   * Подсветить включатель бессмертия.
   * @param {boolean} on
   */
  setDebugGod(on) {
    const btn = this.el.debugMenuButtons && this.el.debugMenuButtons.god;
    if (!btn) return;
    btn.textContent = "Бессмертие: " + (on ? "вкл" : "выкл");
    btn.classList.toggle("on", !!on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  /**
   * Обновить подпись кнопки скрытия оружия (тест рук).
   * @param {boolean} hidden
   */
  setDebugHideWeapons(hidden) {
    const btn = this.el.debugMenuButtons && this.el.debugMenuButtons.toggleHideWeapons;
    if (!btn) return;
    btn.textContent = "Скрыть оружие: " + (hidden ? "вкл" : "выкл");
    btn.classList.toggle("on", !!hidden);
    btn.setAttribute("aria-pressed", hidden ? "true" : "false");
  }

  /**
   * Обновить подпись переключателя режима рендеринга оружия.
   * @param {boolean} inComposer true — внутри композера, false — поверх экрана
   */
  setDebugWeaponRender(inComposer) {
    const btn = this.el.debugMenuButtons && this.el.debugMenuButtons.weaponRender;
    if (!btn) return;
    btn.textContent = "Режим оружия: " + (inComposer ? "композер" : "экран");
    btn.classList.toggle("on", !!inComposer);
  }

  /**
   * Показать/скрыть редактор вьюмодели дробовика (отладочная панель с ползунками).
   * @param {boolean} visible
   */
  showShotgunEditor(visible) {
    if (!this.el.shotgunEditor) this._setupShotgunEditor();
    this.shotgunEditorVisible = !!visible;
    this.el.shotgunEditor.classList.toggle("open", this.shotgunEditorVisible);
    this.el.shotgunEditor.setAttribute("aria-hidden", this.shotgunEditorVisible ? "false" : "true");

    const vm = window.game && window.game.viewmodel;
    if (visible && window.game && window.game.currentWeapon) {
      const curId = window.game.currentWeapon.id;
      if (curId === "shotgun" || curId === "ak47" || curId === "rocket") {
        this._selectEditorWeapon(curId, false);
      }
    }

    if (vm && vm.models) {
      for (const m of Object.values(vm.models)) {
        if (!m || !m.userData) continue;
        if (m.userData.muzzleMarker) m.userData.muzzleMarker.visible = !!visible;
        if (m.userData.ejectMarker) m.userData.ejectMarker.visible = !!visible;
        if (m.userData.backblastMarker) m.userData.backblastMarker.visible = !!visible;
      }
    }
    if (visible) this._refreshShotgunEditorValues();
  }

  /** @private */
  _getEditorFields(weaponId) {
    if (weaponId === "ak47") {
      return [
        { key: "muzzleX", label: "Дуло X", min: -1, max: 1, step: 0.01, path: ["muzzle", "x"] },
        { key: "muzzleY", label: "Дуло Y", min: -1, max: 1, step: 0.01, path: ["muzzle", "y"] },
        { key: "muzzleZ", label: "Дуло Z", min: -2, max: 2, step: 0.01, path: ["muzzle", "z"] },
        { key: "ejectX", label: "Выброс X", min: -1, max: 1, step: 0.01, path: ["eject", "x"] },
        { key: "ejectY", label: "Выброс Y", min: -1, max: 1, step: 0.01, path: ["eject", "y"] },
        { key: "ejectZ", label: "Выброс Z", min: -2, max: 2, step: 0.01, path: ["eject", "z"] },
        { key: "ejectSide", label: "Сторона гильз (1: право, -1: лево)", min: -1, max: 1, step: 2, path: ["eject", "side"] },
        { key: "shellScale", label: "Размер гильзы", min: 0.2, max: 3, step: 0.05, path: ["shell", "scale"] },
        { key: "posX", label: "Позиция X", min: -2, max: 2, step: 0.05, path: ["pos", "x"] },
        { key: "posY", label: "Позиция Y", min: -2, max: 2, step: 0.05, path: ["pos", "y"] },
        { key: "posZ", label: "Позиция Z", min: -2, max: 2, step: 0.05, path: ["pos", "z"] },
        { key: "rotX", label: "Поворот X (рад)", min: -3.14, max: 3.14, step: 0.05, path: ["rot", "x"] },
        { key: "rotY", label: "Поворот Y (рад)", min: -3.14, max: 3.14, step: 0.05, path: ["rot", "y"] },
        { key: "rotZ", label: "Поворот Z (рад)", min: -3.14, max: 3.14, step: 0.05, path: ["rot", "z"] },
        { key: "length", label: "Длина (м)", min: 0.1, max: 3, step: 0.05, path: ["length"] },
        { key: "brightness", label: "Яркость", min: 0, max: 5, step: 0.05, path: ["brightness"] }
      ];
    }
    if (weaponId === "rocket") {
      return [
        { key: "muzzleX", label: "Дуло X", min: -2, max: 2, step: 0.02, path: ["muzzle", "x"] },
        { key: "muzzleY", label: "Дуло Y", min: -2, max: 2, step: 0.02, path: ["muzzle", "y"] },
        { key: "muzzleZ", label: "Дуло Z", min: -3, max: 3, step: 0.02, path: ["muzzle", "z"] },
        { key: "bbX", label: "Выхлоп X", min: -2, max: 2, step: 0.02, path: ["backblast", "x"] },
        { key: "bbY", label: "Выхлоп Y", min: -2, max: 2, step: 0.02, path: ["backblast", "y"] },
        { key: "bbZ", label: "Выхлоп Z", min: -3, max: 3, step: 0.02, path: ["backblast", "z"] },
        { key: "posX", label: "Позиция X", min: -2, max: 2, step: 0.05, path: ["pos", "x"] },
        { key: "posY", label: "Позиция Y", min: -2, max: 2, step: 0.05, path: ["pos", "y"] },
        { key: "posZ", label: "Позиция Z", min: -2, max: 2, step: 0.05, path: ["pos", "z"] },
        { key: "rotX", label: "Поворот X (рад)", min: -3.14, max: 3.14, step: 0.05, path: ["rot", "x"] },
        { key: "rotY", label: "Поворот Y (рад)", min: -3.14, max: 3.14, step: 0.05, path: ["rot", "y"] },
        { key: "rotZ", label: "Поворот Z (рад)", min: -3.14, max: 3.14, step: 0.05, path: ["rot", "z"] },
        { key: "length", label: "Масштаб", min: 0.1, max: 3, step: 0.05, path: ["length"] },
        { key: "brightness", label: "Яркость", min: 0, max: 5, step: 0.05, path: ["brightness"] }
      ];
    }
    return [
      { key: "stockX", label: "Склад X", min: -200, max: 200, step: 1, path: ["assembly", "stock", "x"] },
      { key: "stockY", label: "Склад Y", min: -200, max: 200, step: 1, path: ["assembly", "stock", "y"] },
      { key: "stockZ", label: "Склад Z", min: -200, max: 200, step: 1, path: ["assembly", "stock", "z"] },
      { key: "handguardX", label: "Цевьё X", min: -200, max: 200, step: 1, path: ["assembly", "handguard", "x"] },
      { key: "handguardY", label: "Цевьё Y", min: -200, max: 200, step: 1, path: ["assembly", "handguard", "y"] },
      { key: "handguardZ", label: "Цевьё Z", min: -200, max: 200, step: 1, path: ["assembly", "handguard", "z"] },
      { key: "muzzleX", label: "Дуло X", min: -50, max: 250, step: 1, path: ["muzzle", "x"] },
      { key: "muzzleY", label: "Дуло Y", min: -50, max: 50, step: 1, path: ["muzzle", "y"] },
      { key: "muzzleZ", label: "Дуло Z", min: -50, max: 100, step: 1, path: ["muzzle", "z"] },
      { key: "ejectX", label: "Выброс X", min: -100, max: 200, step: 1, path: ["eject", "x"] },
      { key: "ejectY", label: "Выброс Y", min: -50, max: 50, step: 1, path: ["eject", "y"] },
      { key: "ejectZ", label: "Выброс Z", min: -50, max: 100, step: 1, path: ["eject", "z"] },
      { key: "ejectSide", label: "Сторона гильз (1: право, -1: лево)", min: -1, max: 1, step: 2, path: ["eject", "side"] },
      { key: "shellScale", label: "Размер гильзы", min: 0.2, max: 3, step: 0.05, path: ["shell", "scale"] },
      { key: "posX", label: "Позиция X", min: -2, max: 2, step: 0.05, path: ["pos", "x"] },
      { key: "posY", label: "Позиция Y", min: -2, max: 2, step: 0.05, path: ["pos", "y"] },
      { key: "posZ", label: "Позиция Z", min: -2, max: 2, step: 0.05, path: ["pos", "z"] },
      { key: "rotX", label: "Поворот X (рад)", min: -3.14, max: 3.14, step: 0.05, path: ["rot", "x"] },
      { key: "rotY", label: "Поворот Y (рад)", min: -3.14, max: 3.14, step: 0.05, path: ["rot", "y"] },
      { key: "rotZ", label: "Поворот Z (рад)", min: -3.14, max: 3.14, step: 0.05, path: ["rot", "z"] },
      { key: "length", label: "Длина (м)", min: 0.1, max: 3, step: 0.05, path: ["length"] },
      { key: "brightness", label: "Яркость", min: 0, max: 5, step: 0.05, path: ["brightness"] }
    ];
  }

  /** @private */
  _selectEditorWeapon(weaponId, switchInGame = true) {
    this.editorWeaponId = weaponId;
    if (this.editorWeaponBtns) {
      for (const [id, btn] of Object.entries(this.editorWeaponBtns)) {
        btn.style.background = id === weaponId ? "#d9b45c" : "rgba(255,255,255,0.1)";
        btn.style.color = id === weaponId ? "#111" : "#fff";
      }
    }
    if (switchInGame && window.game && window.game.weapons && window.game.selectWeapon) {
      const idx = window.game.weapons.findIndex((w) => w.id === weaponId);
      if (idx >= 0) window.game.selectWeapon(idx);
    }
    this._rebuildEditorSliders();
    this._refreshShotgunEditorValues();
  }

  /** @private */
  _rebuildEditorSliders() {
    if (!this.editorList) return;
    this.editorList.innerHTML = "";
    this.shotgunEditorSliders = {};
    const fields = this._getEditorFields(this.editorWeaponId || "shotgun");

    for (const f of fields) {
      const row = document.createElement("div");
      row.className = "shotgunEditorRow";

      const lbl = document.createElement("label");
      lbl.textContent = f.label;
      lbl.className = "shotgunEditorLabel";
      row.appendChild(lbl);

      const val = document.createElement("span");
      val.className = "shotgunEditorVal";
      val.textContent = "0";
      row.appendChild(val);

      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = f.min;
      slider.max = f.max;
      slider.step = f.step;
      slider.className = "shotgunEditorSlider";
      slider.dataset.path = JSON.stringify(f.path);
      slider.addEventListener("input", (e) => {
        const p = JSON.parse(e.target.dataset.path);
        const wId = this.editorWeaponId || "shotgun";
        if (!CONFIG.viewmodel) CONFIG.viewmodel = {};
        if (!CONFIG.viewmodel[wId]) CONFIG.viewmodel[wId] = {};
        let target = CONFIG.viewmodel[wId];
        for (let i = 0; i < p.length - 1; i++) {
          if (!target[p[i]]) target[p[i]] = {};
          target = target[p[i]];
        }
        target[p[p.length - 1]] = parseFloat(e.target.value);
        val.textContent = e.target.value;
        this._applyShotgunEditor();
      });
      row.appendChild(slider);

      this.shotgunEditorSliders[f.key] = { slider, val, path: f.path };
      this.editorList.appendChild(row);
    }
  }

  /** @private */
  _setupShotgunEditor() {
    const root = document.createElement("div");
    root.id = "shotgunEditor";
    root.setAttribute("aria-hidden", "true");

    const panel = document.createElement("div");
    panel.className = "shotgunEditorPanel";

    const title = document.createElement("div");
    title.className = "shotgunEditorTitle";
    title.textContent = "РЕДАКТОР ОРУЖИЯ";
    panel.appendChild(title);

    const hint = document.createElement("div");
    hint.className = "shotgunEditorHint";
    hint.textContent = "Изменения применяются мгновенно. F2 — закрыть.";
    panel.appendChild(hint);

    // Выбор оружия (Дробовик / АК-47 / Ракетница)
    const tabs = document.createElement("div");
    tabs.style.cssText = "display:flex;gap:6px;margin-bottom:8px;";
    this.editorWeaponBtns = {};
    this.editorWeaponId = "shotgun";
    for (const [id, name] of [["shotgun", "Дробовик"], ["ak47", "АК-47"], ["rocket", "Ракетница"]]) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = name;
      b.style.cssText = "flex:1;padding:4px 6px;border:1px solid rgba(255,255,255,0.2);border-radius:4px;cursor:pointer;font-size:12px;font-weight:bold;";
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._selectEditorWeapon(id, true);
      });
      tabs.appendChild(b);
      this.editorWeaponBtns[id] = b;
    }
    panel.appendChild(tabs);

    const list = document.createElement("div");
    list.className = "shotgunEditorList";
    panel.appendChild(list);
    this.editorList = list;

    this._selectEditorWeapon("shotgun", false);

    // Кнопка «Копировать JSON»
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "shotgunEditorCopyBtn";
    copyBtn.textContent = "Копировать JSON";
    copyBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const wId = this.editorWeaponId || "shotgun";
      const json = JSON.stringify((CONFIG.viewmodel && CONFIG.viewmodel[wId]) || {}, null, 2);
      console.log(`[Weapon Editor: ${wId}] Конфиг:`, json);
      try {
        navigator.clipboard.writeText(json);
      } catch (_) {}
      this._flashCopyBtn(copyBtn);
    });
    panel.appendChild(copyBtn);

    root.appendChild(panel);
    document.body.appendChild(root);
    this.el.shotgunEditor = root;
  }

  /**
   * Показать / скрыть редактор 3D-рук (F2 -> Редактор рук).
   * @param {boolean} visible
   */
  showArmsEditor(visible) {
    if (!this.el.armsEditor) this._setupArmsEditor();
    const ed = this.el.armsEditor;
    ed.classList.toggle("open", !!visible);
    ed.setAttribute("aria-hidden", visible ? "false" : "true");
    const vm = window.game && window.game.viewmodel;
    if (vm && vm.setArmsDebugVisible) vm.setArmsDebugVisible(!!visible);
    if (visible) this._refreshArmsEditorValues();
  }

  /** Обновить индикатор достижимости целей в редакторе рук. */
  updateArmsReachIndicator() {
    if (!this.armsReachBadge) return;
    const vm = window.game && window.game.viewmodel;
    const reach = (vm && vm.armsReach) || { right: true, left: true };
    const rTxt = reach.right ? "П: ОК" : "П: ДАЛЕКО";
    const lTxt = reach.left ? "Л: ОК" : "Л: ДАЛЕКО";
    this.armsReachBadge.textContent = `Досягаемость: ${lTxt} | ${rTxt}`;
    this.armsReachBadge.style.background = reach.right && reach.left ? "#1e4d2b" : "#5c1f24";
    this.armsReachBadge.style.color = reach.right && reach.left ? "#8effa6" : "#ff9b9b";
  }

  /** @private */
  _setupArmsEditor() {
    const root = document.createElement("div");
    root.id = "armsEditor";
    root.className = "shotgunEditor";
    root.setAttribute("aria-hidden", "true");
    root.style.cssText = "position:fixed;right:18px;top:20px;bottom:20px;width:320px;z-index:1100;display:none;flex-direction:column;";

    const style = document.createElement("style");
    style.textContent =
      "#armsEditor.open{display:flex !important;}" +
      "#armsEditor .shotgunEditorPanel{display:flex;flex-direction:column;max-height:100%;overflow:hidden;}" +
      "#armsEditor .shotgunEditorList{flex:1 1 auto;min-height:0;overflow-y:auto;padding-right:6px;}" +
      "#armsEditor .shotgunEditorList::-webkit-scrollbar{width:8px;}" +
      "#armsEditor .shotgunEditorList::-webkit-scrollbar-track{background:#121410;}" +
      "#armsEditor .shotgunEditorList::-webkit-scrollbar-thumb{background:#b79444;border-radius:2px;}" +
      "#armsEditor .shotgunEditorCopyBtn{flex-shrink:0;width:100%;}";
    document.head.appendChild(style);

    const panel = document.createElement("div");
    panel.className = "shotgunEditorPanel";

    const title = document.createElement("div");
    title.className = "shotgunEditorTitle";
    title.textContent = "РЕДАКТОР РУК";
    panel.appendChild(title);

    const hint = document.createElement("div");
    hint.className = "shotgunEditorHint";
    hint.textContent = "IK-хват, кисти и анимация. F2 — закрыть.";
    panel.appendChild(hint);

    const reachBadge = document.createElement("div");
    reachBadge.style.cssText = "padding:4px 8px;border-radius:4px;font-size:12px;font-weight:bold;margin-bottom:6px;text-align:center;";
    panel.appendChild(reachBadge);
    this.armsReachBadge = reachBadge;

    const list = document.createElement("div");
    list.className = "shotgunEditorList";
    panel.appendChild(list);
    this.armsEditorList = list;

    // Выбор режима ("baked" | "liveIK" | "anim")
    const modeRow = document.createElement("div");
    modeRow.className = "shotgunEditorRow";
    const modeLbl = document.createElement("div");
    modeLbl.className = "shotgunEditorLabel";
    modeLbl.textContent = "Режим рук:";
    modeRow.appendChild(modeLbl);

    const modeSelect = document.createElement("select");
    modeSelect.style.cssText = "width:100%;padding:4px;margin:4px 0 6px;background:#1c2029;color:#fff;border:1px solid rgba(255,255,255,0.2);border-radius:4px;";
    for (const [val, label] of [
      ["baked", "baked (запечённые)"],
      ["liveIK", "liveIK (IK каждый кадр)"],
      ["anim", "anim (анимация)"]
    ]) {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = label;
      modeSelect.appendChild(opt);
    }
    modeSelect.addEventListener("change", (e) => {
      const vm = window.game && window.game.viewmodel;
      if (vm && vm.setArmsMode) vm.setArmsMode(e.target.value);
      this.updateArmsReachIndicator();
    });
    modeRow.appendChild(modeSelect);
    list.appendChild(modeRow);
    this.armsModeSelect = modeSelect;

    const addSliderRow = (container, label, min, max, step, getVal, setVal) => {
      const row = document.createElement("div");
      row.className = "shotgunEditorRow";
      const lbl = document.createElement("div");
      lbl.className = "shotgunEditorLabel";
      const val = document.createElement("span");
      val.className = "shotgunEditorVal";
      lbl.textContent = label + ": ";
      lbl.appendChild(val);
      row.appendChild(lbl);

      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = min;
      slider.max = max;
      slider.step = step;
      slider.className = "shotgunEditorSlider";
      slider.addEventListener("input", (e) => {
        const num = parseFloat(e.target.value);
        setVal(num);
        val.textContent = e.target.value;
        if ((CONFIG.viewmodel?.arms?.mode || "baked") === "baked") {
          window.game?.viewmodel?.rebakeAllArms?.();
          this.updateArmsReachIndicator();
        }
      });
      row.appendChild(slider);
      container.appendChild(row);
      return { slider, val, getVal };
    };

    const ensureArms = () => {
      if (!CONFIG.viewmodel) CONFIG.viewmodel = {};
      if (!CONFIG.viewmodel.arms) CONFIG.viewmodel.arms = {};
      const a = CONFIG.viewmodel.arms;
      if (!a.pos) a.pos = { x: 0, y: -0.2, z: -0.25 };
      if (!a.rot) a.rot = { x: 0, y: 0, z: 0 };
      if (!a.handRot) a.handRot = { right: { x: 1.35, y: -0.2, z: -1.57 }, left: { x: 1.57, y: 0.25, z: 1.4 } };
      if (!a.pole) a.pole = { right: { x: 0.5, y: -1.0, z: 0.3 }, left: { x: -0.5, y: -1.0, z: 0.3 } };
      if (a.inflateEnabled === undefined) a.inflateEnabled = true;
      if (!a.inflate) a.inflate = { upperArm: 0.030, forearm: 0.026, hand: 0.008, fingers: 0.002 };
      if (a.sleeves === undefined) a.sleeves = true;
      if (!a.sleeveColor) a.sleeveColor = [0.17, 0.19, 0.12];
      if (a.sleeveStartV == null) a.sleeveStartV = 0.53;
      return a;
    };

    this.armsEditorControls = [];
    const bindArmField = (label, min, max, step, getter, setter) => {
      this.armsEditorControls.push(
        addSliderRow(list, label, min, max, step, () => getter(ensureArms()), (v) => setter(ensureArms(), v))
      );
    };

    bindArmField("Кисть П Rot X", -3.14, 3.14, 0.02, (a) => a.handRot.right.x, (a, v) => (a.handRot.right.x = v));
    bindArmField("Кисть П Rot Y", -3.14, 3.14, 0.02, (a) => a.handRot.right.y, (a, v) => (a.handRot.right.y = v));
    bindArmField("Кисть П Rot Z", -3.14, 3.14, 0.02, (a) => a.handRot.right.z, (a, v) => (a.handRot.right.z = v));

    bindArmField("Кисть Л Rot X", -3.14, 3.14, 0.02, (a) => a.handRot.left.x, (a, v) => (a.handRot.left.x = v));
    bindArmField("Кисть Л Rot Y", -3.14, 3.14, 0.02, (a) => a.handRot.left.y, (a, v) => (a.handRot.left.y = v));
    bindArmField("Кисть Л Rot Z", -3.14, 3.14, 0.02, (a) => a.handRot.left.z, (a, v) => (a.handRot.left.z = v));

    bindArmField("Указат. палец", 0, 1, 0.05, (a) => {
      const wId = window.game?.viewmodel?.currentWeaponId || "shotgun";
      if (typeof a.triggerFinger === "number") return a.triggerFinger;
      return (a.triggerFinger && a.triggerFinger[wId]) ?? (wId === "rocket" ? 0 : 0.6);
    }, (a, v) => {
      const wId = window.game?.viewmodel?.currentWeaponId || "shotgun";
      if (!a.triggerFinger || typeof a.triggerFinger !== "object") {
        a.triggerFinger = { shotgun: 0.6, ak47: 0.6, rocket: 0 };
      }
      a.triggerFinger[wId] = v;
    });

    bindArmField("Локоть П X", -2, 2, 0.05, (a) => a.pole.right.x, (a, v) => (a.pole.right.x = v));
    bindArmField("Локоть П Y", -2, 2, 0.05, (a) => a.pole.right.y, (a, v) => (a.pole.right.y = v));
    bindArmField("Локоть П Z", -2, 2, 0.05, (a) => a.pole.right.z, (a, v) => (a.pole.right.z = v));

    bindArmField("Локоть Л X", -2, 2, 0.05, (a) => a.pole.left.x, (a, v) => (a.pole.left.x = v));
    bindArmField("Локоть Л Y", -2, 2, 0.05, (a) => a.pole.left.y, (a, v) => (a.pole.left.y = v));
    bindArmField("Локоть Л Z", -2, 2, 0.05, (a) => a.pole.left.z, (a, v) => (a.pole.left.z = v));

    // Утолщение сетки и рукава (с debounce 150 мс)
    let pendingGeo = false;
    let pendingTex = false;
    const scheduleRebuild = (needGeo, needTex) => {
      if (needGeo) pendingGeo = true;
      if (needTex) pendingTex = true;
      if (this._armsRebuildTimer) clearTimeout(this._armsRebuildTimer);
      this._armsRebuildTimer = setTimeout(() => {
        const g = pendingGeo;
        const t = pendingTex;
        pendingGeo = false;
        pendingTex = false;
        const vm = window.game && window.game.viewmodel;
        if (vm && vm.refreshArmsGeometryAndTexture) {
          vm.refreshArmsGeometryAndTexture({ geometry: g, texture: t });
        }
      }, 150);
    };

    const meshTitle = document.createElement("div");
    meshTitle.className = "shotgunEditorLabel";
    meshTitle.style.cssText = "margin-top:8px;color:#ffd23f;font-weight:bold;";
    meshTitle.textContent = "Толщина и рукава:";
    list.appendChild(meshTitle);

    const addCheckRow = (label, getVal, setVal, onChange) => {
      const row = document.createElement("div");
      row.className = "shotgunEditorRow";
      row.style.cssText = "display:flex;align-items:center;justify-content:space-between;";
      const lbl = document.createElement("span");
      lbl.className = "shotgunEditorLabel";
      lbl.textContent = label;
      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.addEventListener("change", (e) => {
        setVal(!!e.target.checked);
        onChange();
      });
      row.appendChild(lbl);
      row.appendChild(chk);
      list.appendChild(row);
      return { chk, getVal };
    };

    this.armsExtraControls = [];
    this.armsExtraControls.push(
      addCheckRow(
        "Утолщение (inflate)",
        () => ensureArms().inflateEnabled !== false,
        (v) => (ensureArms().inflateEnabled = v),
        () => scheduleRebuild(true, false)
      )
    );

    const addMeshSlider = (label, min, max, step, getter, setter, needGeo, needTex) => {
      const ctrl = addSliderRow(list, label, min, max, step, () => getter(ensureArms()), (v) => {
        setter(ensureArms(), v);
        scheduleRebuild(needGeo, needTex);
      });
      // Переопределяем стандартный handler без мгновенного rebakeAllArms на каждый тик
      const cloneSlider = ctrl.slider.cloneNode(true);
      ctrl.slider.parentNode.replaceChild(cloneSlider, ctrl.slider);
      ctrl.slider = cloneSlider;
      cloneSlider.addEventListener("input", (e) => {
        const num = parseFloat(e.target.value);
        setter(ensureArms(), num);
        ctrl.val.textContent = e.target.value;
        scheduleRebuild(needGeo, needTex);
      });
      this.armsEditorControls.push(ctrl);
    };

    addMeshSlider("Утолщ. Плечо", 0, 0.06, 0.002, (a) => a.inflate.upperArm ?? 0.030, (a, v) => (a.inflate.upperArm = v), true, false);
    addMeshSlider("Утолщ. Предплечье", 0, 0.06, 0.002, (a) => a.inflate.forearm ?? 0.026, (a, v) => (a.inflate.forearm = v), true, false);
    addMeshSlider("Утолщ. Кисть", 0, 0.06, 0.002, (a) => a.inflate.hand ?? 0.008, (a, v) => (a.inflate.hand = v), true, false);
    addMeshSlider("Утолщ. Пальцы", 0, 0.06, 0.001, (a) => a.inflate.fingers ?? 0.002, (a, v) => (a.inflate.fingers = v), true, false);

    this.armsExtraControls.push(
      addCheckRow(
        "Рукава (sleeves)",
        () => ensureArms().sleeves !== false,
        (v) => (ensureArms().sleeves = v),
        () => scheduleRebuild(false, true)
      )
    );

    const colorRow = document.createElement("div");
    colorRow.className = "shotgunEditorRow";
    colorRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;";
    const colorLbl = document.createElement("span");
    colorLbl.className = "shotgunEditorLabel";
    colorLbl.textContent = "Цвет рукава";
    const colorInp = document.createElement("input");
    colorInp.type = "color";
    colorInp.style.cssText = "width:48px;height:22px;border:none;background:none;cursor:pointer;";
    const rgbToHex = (arr) => {
      const toHex = (n) => Math.max(0, Math.min(255, Math.round((n ?? 0) * 255))).toString(16).padStart(2, "0");
      return `#${toHex(arr[0])}${toHex(arr[1])}${toHex(arr[2])}`;
    };
    colorInp.addEventListener("input", (e) => {
      const hex = e.target.value;
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      ensureArms().sleeveColor = [Number(r.toFixed(3)), Number(g.toFixed(3)), Number(b.toFixed(3))];
      scheduleRebuild(false, true);
    });
    colorRow.appendChild(colorLbl);
    colorRow.appendChild(colorInp);
    list.appendChild(colorRow);
    this.armsSleeveColorInput = { inp: colorInp, getHex: () => rgbToHex(ensureArms().sleeveColor || [0.17, 0.19, 0.12]) };

    addMeshSlider("Граница рукава V", 0.3, 0.8, 0.01, (a) => a.sleeveStartV ?? 0.53, (a, v) => (a.sleeveStartV = v), false, true);

    // Контейнер для хватов ТЕКУЩЕГО оружия (перестраивается в _refreshArmsEditorValues)
    const wpnHandsBox = document.createElement("div");
    list.appendChild(wpnHandsBox);
    this.armsWpnHandsBox = wpnHandsBox;
    this.armsWpnHandControls = [];

    // Выбор анимации (18 клипов) + Играть / Пауза
    const animRow = document.createElement("div");
    animRow.className = "shotgunEditorRow";
    animRow.style.marginTop = "8px";

    const animLbl = document.createElement("div");
    animLbl.className = "shotgunEditorLabel";
    animLbl.textContent = "Клип анимации (режим anim):";
    animRow.appendChild(animLbl);

    const select = document.createElement("select");
    select.style.cssText = "width:100%;padding:4px;margin:4px 0 6px;background:#1c2029;color:#fff;border:1px solid rgba(255,255,255,0.2);border-radius:4px;";
    select.addEventListener("change", (e) => {
      const vm = window.game && window.game.viewmodel;
      if (vm && vm.setArmsClip) vm.setArmsClip(e.target.value);
    });
    animRow.appendChild(select);
    this.armsClipSelect = select;

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:6px;";

    const playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.textContent = "Играть";
    playBtn.style.cssText = "flex:1;padding:5px;border:1px solid rgba(255,255,255,0.2);border-radius:4px;background:#264632;color:#fff;cursor:pointer;font-weight:bold;";
    playBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const vm = window.game && window.game.viewmodel;
      if (vm && vm.setArmsClip && select.value) vm.setArmsClip(select.value);
      if (vm && vm.setArmsPaused) vm.setArmsPaused(false);
    });

    const pauseBtn = document.createElement("button");
    pauseBtn.type = "button";
    pauseBtn.textContent = "Пауза";
    pauseBtn.style.cssText = "flex:1;padding:5px;border:1px solid rgba(255,255,255,0.2);border-radius:4px;background:#4a2b2b;color:#fff;cursor:pointer;font-weight:bold;";
    pauseBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const vm = window.game && window.game.viewmodel;
      if (vm && vm.setArmsPaused) vm.setArmsPaused(true);
    });

    btnRow.appendChild(playBtn);
    btnRow.appendChild(pauseBtn);
    animRow.appendChild(btnRow);
    list.appendChild(animRow);

    const hideBtn = document.createElement("button");
    hideBtn.type = "button";
    hideBtn.className = "shotgunEditorCopyBtn";
    hideBtn.style.marginBottom = "6px";
    hideBtn.textContent = "Скрыть / Показать оружие";
    hideBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (window.game && window.game.toggleHideWeaponsForTest) {
        window.game.toggleHideWeaponsForTest();
      }
    });
    panel.appendChild(hideBtn);

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "shotgunEditorCopyBtn";
    copyBtn.textContent = "Копировать JSON";
    copyBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const payload = {
        arms: CONFIG.viewmodel?.arms || {},
        hands: {
          shotgun: CONFIG.viewmodel?.shotgun?.hands || {},
          ak47: CONFIG.viewmodel?.ak47?.hands || {},
          rocket: CONFIG.viewmodel?.rocket?.hands || {}
        }
      };
      const json = JSON.stringify(payload, null, 2);
      console.log("[Arms Editor] Конфиг:", json);
      try {
        navigator.clipboard.writeText(json);
      } catch (_) {}
      this._flashCopyBtn(copyBtn);
    });
    panel.appendChild(copyBtn);

    root.appendChild(panel);
    document.body.appendChild(root);
    this.el.armsEditor = root;
  }

  /** @private */
  _refreshArmsEditorValues() {
    if (!this.armsEditorControls) return;
    const vm = window.game && window.game.viewmodel;
    const wId = (vm && vm.currentWeaponId) || "shotgun";

    if (this.armsModeSelect) {
      const rawMode = CONFIG.viewmodel?.arms?.mode || "baked";
      this.armsModeSelect.value = rawMode === "ik" ? "liveIK" : rawMode;
    }
    for (const c of this.armsEditorControls) {
      const v = c.getVal();
      c.slider.value = v;
      c.val.textContent = v;
    }
    if (this.armsExtraControls) {
      for (const ec of this.armsExtraControls) {
        ec.chk.checked = !!ec.getVal();
      }
    }
    if (this.armsSleeveColorInput) {
      this.armsSleeveColorInput.inp.value = this.armsSleeveColorInput.getHex();
    }

    // Перестраиваем ползунки хватов текущего оружия
    if (this.armsWpnHandsBox) {
      this.armsWpnHandsBox.innerHTML = "";
      this.armsWpnHandControls = [];
      if (!CONFIG.viewmodel) CONFIG.viewmodel = {};
      if (!CONFIG.viewmodel[wId]) CONFIG.viewmodel[wId] = {};
      if (!CONFIG.viewmodel[wId].hands) {
        CONFIG.viewmodel[wId].hands = vm && vm._getWeaponHandsConfig
          ? vm._getWeaponHandsConfig(wId)
          : { right: { x: 0, y: 0, z: 0, rot: { x: 0, y: 0, z: 0 } }, left: { x: 0, y: 0, z: 0, rot: { x: 0, y: 0, z: 0 } } };
      }
      const hands = CONFIG.viewmodel[wId].hands;
      if (!hands.right.rot) hands.right.rot = { x: 0, y: 0, z: 0 };
      if (!hands.left.rot) hands.left.rot = { x: 0, y: 0, z: 0 };

      const header = document.createElement("div");
      header.className = "shotgunEditorLabel";
      header.style.cssText = "margin-top:8px;color:#ffd23f;font-weight:bold;";
      header.textContent = `Хват (${wId}):`;
      this.armsWpnHandsBox.appendChild(header);

      const posMin = wId === "rocket" ? -2 : -200;
      const posMax = wId === "rocket" ? 2 : 250;
      const posStep = wId === "rocket" ? 0.02 : 1;

      const addHandRow = (label, min, max, step, getV, setV) => {
        const row = document.createElement("div");
        row.className = "shotgunEditorRow";
        const lbl = document.createElement("div");
        lbl.className = "shotgunEditorLabel";
        const val = document.createElement("span");
        val.className = "shotgunEditorVal";
        lbl.textContent = label + ": ";
        lbl.appendChild(val);
        row.appendChild(lbl);

        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = min;
        slider.max = max;
        slider.step = step;
        slider.className = "shotgunEditorSlider";
        const cur = getV();
        slider.value = cur;
        val.textContent = cur;
        slider.addEventListener("input", (e) => {
          setV(parseFloat(e.target.value));
          val.textContent = e.target.value;
          if ((CONFIG.viewmodel?.arms?.mode || "baked") === "baked") {
            vm?.rebakeWeaponArms?.(wId);
            this.updateArmsReachIndicator();
          }
        });
        row.appendChild(slider);
        this.armsWpnHandsBox.appendChild(row);
      };

      const defaultCurlR = { thumb: 0.7, index: 0.5, middle: 1, ring: 1, pinky: 1 };
      const defaultCurlL = { thumb: 0.8, index: 1, middle: 1, ring: 1, pinky: 1 };
      if (!hands.right.curl) hands.right.curl = { ...defaultCurlR };
      if (!hands.left.curl) hands.left.curl = { ...defaultCurlL };
      if (!hands.right.parent) hands.right.parent = "gun";
      if (!hands.left.parent) hands.left.parent = wId === "shotgun" ? "Tactical_Handguard_V1" : "gun";
      if (!hands.armsPos) {
        const defPos = CONFIG.viewmodel?.arms?.pos || { x: 0.08, y: -0.18, z: -0.22 };
        hands.armsPos = { x: defPos.x || 0, y: defPos.y || 0, z: defPos.z || 0 };
      }
      if (hands.armsScale == null) {
        hands.armsScale = CONFIG.viewmodel?.arms?.scale ?? 1.1;
      }

      addHandRow("Плечи Pos X", -1, 1, 0.01, () => hands.armsPos.x, (v) => (hands.armsPos.x = v));
      addHandRow("Плечи Pos Y", -1, 1, 0.01, () => hands.armsPos.y, (v) => (hands.armsPos.y = v));
      addHandRow("Плечи Pos Z", -1, 1, 0.01, () => hands.armsPos.z, (v) => (hands.armsPos.z = v));
      addHandRow("Руки Scale", 0.5, 2.2, 0.02, () => hands.armsScale, (v) => (hands.armsScale = v));

      for (const [sideKey, sideLabel] of [["right", "Хват П"], ["left", "Хват Л"]]) {
        addHandRow(`${sideLabel} X`, posMin, posMax, posStep, () => hands[sideKey].x, (v) => (hands[sideKey].x = v));
        addHandRow(`${sideLabel} Y`, posMin, posMax, posStep, () => hands[sideKey].y, (v) => (hands[sideKey].y = v));
        addHandRow(`${sideLabel} Z`, posMin, posMax, posStep, () => hands[sideKey].z, (v) => (hands[sideKey].z = v));
        addHandRow(`${sideLabel} Rot X`, -3.14, 3.14, 0.02, () => hands[sideKey].rot.x, (v) => (hands[sideKey].rot.x = v));
        addHandRow(`${sideLabel} Rot Y`, -3.14, 3.14, 0.02, () => hands[sideKey].rot.y, (v) => (hands[sideKey].rot.y = v));
        addHandRow(`${sideLabel} Rot Z`, -3.14, 3.14, 0.02, () => hands[sideKey].rot.z, (v) => (hands[sideKey].rot.z = v));
        for (const [fingerKey, fingerLabel] of [
          ["thumb", "Большой"],
          ["index", "Указат."],
          ["middle", "Средний"],
          ["ring", "Безымян."],
          ["pinky", "Мизинец"]
        ]) {
          addHandRow(
            `${sideLabel} ${fingerLabel}`,
            0,
            1,
            0.05,
            () => hands[sideKey].curl[fingerKey] ?? 1,
            (v) => (hands[sideKey].curl[fingerKey] = v)
          );
        }
      }
    }

    if (this.armsClipSelect) {
      const clips = vm && vm.getArmsClipNames ? vm.getArmsClipNames() : [];
      this.armsClipSelect.innerHTML = "";
      for (const name of clips) {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        if (name === (vm?.armsState?.currentClip || CONFIG.viewmodel?.arms?.pose)) opt.selected = true;
        this.armsClipSelect.appendChild(opt);
      }
    }

    this.updateArmsReachIndicator();
  }

  /** @private */
  _refreshShotgunEditorValues() {
    if (!this.shotgunEditorSliders) return;
    const wId = this.editorWeaponId || "shotgun";
    if (!CONFIG.viewmodel) CONFIG.viewmodel = {};
    if (!CONFIG.viewmodel[wId]) CONFIG.viewmodel[wId] = {};
    const cfg = CONFIG.viewmodel[wId];
    if (wId === "shotgun") {
      if (!cfg.muzzle) cfg.muzzle = { x: 199, y: 0, z: 32 };
      if (!cfg.eject) cfg.eject = { x: 15, y: 6, z: 25, side: 1 };
      if (cfg.eject.side == null) cfg.eject.side = 1;
      if (!cfg.shell) cfg.shell = { scale: 1.0 };
      if (!cfg.pump) cfg.pump = { distance: 0.025, returnTime: 0.18 };
    } else if (wId === "ak47") {
      if (!cfg.muzzle) cfg.muzzle = { x: 0.01, y: 0.01, z: -0.5 };
      if (!cfg.eject) cfg.eject = { x: 0.04, y: 0.02, z: -0.05, side: 1 };
      if (cfg.eject.side == null) cfg.eject.side = 1;
      if (!cfg.shell) cfg.shell = { scale: 1.4 };
    } else if (wId === "rocket") {
      if (!cfg.pos) cfg.pos = { x: 0.34, y: -0.2, z: -0.15 };
      if (!cfg.rot) cfg.rot = { x: 0.01, y: 0.06, z: 0.01 };
      if (!cfg.muzzle) cfg.muzzle = { x: 0, y: 0.02, z: -0.92 };
      if (!cfg.backblast) cfg.backblast = { x: 0, y: 0.02, z: 0.50 };
      if (cfg.length == null) cfg.length = 1.35;
      if (cfg.brightness == null) cfg.brightness = 1.3;
    }
    for (const [key, { slider, val, path }] of Object.entries(this.shotgunEditorSliders)) {
      let target = cfg;
      for (const p of path) {
        if (target == null) break;
        target = target[p];
      }
      if (typeof target === "number") {
        slider.value = target;
        val.textContent = target;
      }
    }
  }

  /** @private */
  _flashCopyBtn(btn) {
    const orig = btn.textContent;
    btn.textContent = "СКОПИРОВАНО!";
    setTimeout(() => { btn.textContent = orig; }, 800);
  }

  /** @private */
  _applyShotgunEditor() {
    const vm = window.game && window.game.viewmodel;
    const wId = this.editorWeaponId || "shotgun";
    if (!vm || !vm.models[wId]) return;
    const cfg = (CONFIG.viewmodel && CONFIG.viewmodel[wId]) || {};
    const model = vm.models[wId];
    const transformNode = (model.userData && model.userData.gunRoot) || model;

    if (cfg.pos) {
      vm.view.position.set(cfg.pos.x, cfg.pos.y, cfg.pos.z);
    }
    if (cfg.rot) {
      transformNode.rotation.set(cfg.rot.x, cfg.rot.y, cfg.rot.z, "YXZ");
    }
    transformNode.updateMatrixWorld(true);

    // Точка дула и маркер
    if (cfg.muzzle && model.userData.flash) {
      model.userData.flash.position.set(cfg.muzzle.x, cfg.muzzle.y, cfg.muzzle.z);
      if (model.userData.muzzleMarker) {
        model.userData.muzzleMarker.position.set(cfg.muzzle.x, cfg.muzzle.y, cfg.muzzle.z);
      }
    }
    // Точка выброса гильз и маркер (дробовик / АК)
    if (cfg.eject && model.userData.ejectMarker) {
      model.userData.ejectMarker.position.set(cfg.eject.x, cfg.eject.y, cfg.eject.z);
    }
    // Точка заднего выхлопа и маркер (ракетница)
    if (cfg.backblast && model.userData.backblastMarker) {
      model.userData.backblastMarker.position.set(cfg.backblast.x, cfg.backblast.y, cfg.backblast.z);
    }

    // Длина (масштаб)
    if (cfg.length && model.userData._baseLength) {
      const scale = cfg.length / model.userData._baseLength * (cfg.scale || 1);
      transformNode.scale.setScalar(scale);
    } else if (wId === "rocket" && cfg.length) {
      transformNode.scale.setScalar(cfg.length);
    }

    // Яркость материалов
    if (cfg.brightness !== undefined) {
      transformNode.traverse((node) => {
        if (node.isMesh && node.material && node.name !== "muzzleMarker" && node.name !== "ejectMarker" && node.name !== "backblastMarker") {
          const mats = Array.isArray(node.material) ? node.material : [node.material];
          mats.forEach((mat) => {
            if (mat !== model.userData.flash?.material) {
              if (model.userData._isModel && !mat.userData._baseColor) {
                mat.color.setScalar(cfg.brightness);
              } else {
                if (!mat.userData._baseColor) mat.userData._baseColor = mat.color.clone();
                mat.color.copy(mat.userData._baseColor).multiplyScalar(cfg.brightness);
              }
              mat.needsUpdate = true;
            }
          });
        }
      });
    }

    // Сборка частей
    if (cfg.assembly) {
      if (wId === "shotgun") {
        transformNode.traverse((node) => {
          if (node.name === "Tactical_Stock_V1" && cfg.assembly.stock) {
            node.position.set(cfg.assembly.stock.x, cfg.assembly.stock.y, cfg.assembly.stock.z);
          }
          if (node.name === "Tactical_Handguard_V1" && cfg.assembly.handguard) {
            node.position.set(cfg.assembly.handguard.x, cfg.assembly.handguard.y, cfg.assembly.handguard.z);
            if (vm.handguardBasePos) {
              vm.handguardBasePos.set(cfg.assembly.handguard.x, cfg.assembly.handguard.y, cfg.assembly.handguard.z);
            }
          }
        });
      } else if (wId === "ak47") {
        const partMap = {
          stock: "AK-47_Stock_V1",
          magazine: "AK-47_Magazine_V1",
          grip: "AK-47_Grip_V1",
          trigger: "AK-47_Trigger"
        };
        for (const [key, nodeName] of Object.entries(partMap)) {
          const off = cfg.assembly[key];
          const node = transformNode.getObjectByName(nodeName);
          if (node && off) {
            const base = node.userData._basePos || { x: 0, y: 0, z: 0 };
            node.position.set(
              base.x + (off.x || 0),
              base.y + (off.y || 0),
              base.z + (off.z || 0)
            );
          }
        }
      }
      transformNode.updateMatrixWorld(true);
    }
  }

  /** Два слота инвентаря над шкалой здоровья. @private */
  _setupConsumableHud() {
    const box = document.createElement("div");
    box.id = "consumableInventory";
    box.innerHTML =
      '<div class="consumableSlot cs-vodka empty" data-type="vodka">' +
      '<span class="cIcon">В</span>' +
      '<span class="cInfo"><span class="cName">ВОДКА</span><span class="cCount">0</span></span>' +
      '<span class="cKey">7</span>' +
      "</div>" +
      '<div class="consumableSlot cs-joint empty" data-type="joint">' +
      '<span class="cIcon">К</span>' +
      '<span class="cInfo"><span class="cName">КОСЯК</span><span class="cCount">0</span></span>' +
      '<span class="cKey">8</span>' +
      "</div>";

    const stats = document.getElementById("playerStats");
    if (stats) stats.insertBefore(box, stats.firstChild);
    else document.body.appendChild(box);

    this.el.consumableInventory = box;
    this.el.consumableSlots = {};
    box.querySelectorAll(".consumableSlot").forEach((node) => {
      this.el.consumableSlots[node.dataset.type] = {
        root: node,
        count: node.querySelector(".cCount")
      };
    });
  }

  /**
   * Обновить количество расходников.
   * @param {{vodka:number, joint:number}} inv
   */
  updateConsumables(inv) {
    if (!inv || !this.el.consumableSlots) return;
    const max = CONFIG.effects.maxStack ?? 3;
    const sig = (inv.vodka || 0) + ":" + (inv.joint || 0) + ":" + max;
    if (sig === this._consumableSig) return;
    this._consumableSig = sig;

    for (const type of ["vodka", "joint"]) {
      const slot = this.el.consumableSlots[type];
      if (!slot) continue;
      const n = inv[type] || 0;
      slot.count.textContent = String(n);
      slot.root.classList.toggle("empty", n <= 0);
      slot.root.classList.toggle("full", n >= max);
    }
  }

  /** Контейнер иконок активных эффектов в правом верхнем углу. @private */
  _setupEffectsHud() {
    const box = document.createElement("div");
    box.id = "activeEffects";
    const board = document.getElementById("scoreBoard");
    if (board) board.appendChild(box);
    else document.body.appendChild(box);
    this.el.activeEffects = box;
  }

  /**
   * Обновить иконки и полоски времени активных эффектов.
   * @param {Object} effects EffectsManager
   */
  updateEffects(effects) {
    const box = this.el.activeEffects;
    if (!box || !effects) return;

    const list = effects.getActive ? effects.getActive() : [];
    const seen = new Set();
    const names = { vodka: "ВОДКА", joint: "КОСЯК" };

    for (const fx of list) {
      seen.add(fx.type);
      let node = this._effectNodes.get(fx.type);
      if (!node) {
        const root = document.createElement("div");
        root.className = "effectChip fx-" + fx.type;
        root.innerHTML =
          '<div class="fxHead"><span class="fxName"><span class="fxIcon">' +
          (fx.type === "vodka" ? "В" : "К") +
          "</span> " +
          (names[fx.type] || fx.type) +
          '</span><span class="fxTime"></span></div>' +
          '<div class="fxTrack"><div class="fxFill"></div></div>';
        box.appendChild(root);
        node = {
          root,
          time: root.querySelector(".fxTime"),
          fill: root.querySelector(".fxFill")
        };
        this._effectNodes.set(fx.type, node);
      }

      const frac = fx.duration > 0 ? Math.max(0, Math.min(1, fx.timeLeft / fx.duration)) : 0;
      node.fill.style.width = (frac * 100).toFixed(1) + "%";
      node.time.textContent = Math.max(0, fx.timeLeft).toFixed(1) + " с";
      node.root.classList.toggle("warn", frac < 0.25);
    }

    for (const [type, node] of this._effectNodes) {
      if (!seen.has(type)) {
        node.root.remove();
        this._effectNodes.delete(type);
      }
    }
  }

  /** Переключатель «Ослабить эффекты» в меню/паузе. @private */
  _setupReducedEffectsToggle() {
    const cfg =
      CONFIG.effects.reduced ||
      (CONFIG.effects.reduced = { active: false, storageKey: "fps_reduced_effects" });
    const key = cfg.storageKey || "fps_reduced_effects";

    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) cfg.active = saved === "1";
    } catch (err) {
      // localStorage может быть недоступен
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "reducedEffectsBtn";
    btn.className = "fxToggle";

    const refresh = () => {
      btn.textContent = "Ослабить эффекты: " + (cfg.active ? "ВКЛ" : "ВЫКЛ");
      btn.classList.toggle("on", !!cfg.active);
      btn.setAttribute("aria-pressed", cfg.active ? "true" : "false");
    };

    // Клики по переключателю не должны запускать игру/снимать паузу
    const stop = (e) => e.stopPropagation();
    for (const ev of ["click", "mousedown", "pointerdown", "touchstart"]) {
      btn.addEventListener(ev, stop);
    }
    btn.addEventListener("click", () => {
      cfg.active = !cfg.active;
      try {
        localStorage.setItem(key, cfg.active ? "1" : "0");
      } catch (err) {
        // Игнорируем недоступное хранилище
      }
      refresh();
    });

    refresh();
    this.el.reducedEffectsBtn = btn;
    if (this.el.overlay) this.el.overlay.appendChild(btn);
    else document.body.appendChild(btn);
  }

  /** Переключатель стиля зомби в меню/паузе (МУЛЬТЯШНЫЙ / РЕАЛИСТИЧНЫЙ). @private */
  _setupZombieStyleToggle() {
    const box = document.createElement("div");
    box.id = "zombieStylePanel";
    box.className = "zombieStylePanel";
    box.style.display = "flex";
    box.style.alignItems = "center";
    box.style.justifyContent = "center";
    box.style.gap = "8px";
    box.style.marginTop = "10px";
    box.innerHTML = `
      <span class="zombieStyleLabel" style="font-size: 13px; font-weight: bold; color: #fff; text-shadow: 1px 1px 0 #000; letter-spacing: 0.5px;">ЗОМБИ:</span>
      <button class="gfxBtn" id="zombieStyleToon" type="button" data-style="toon">МУЛЬТЯШНЫЙ</button>
      <button class="gfxBtn" id="zombieStylePbr" type="button" data-style="pbr">РЕАЛИСТИЧНЫЙ</button>
    `;

    // Клики по переключателю стиля не должны запускать игру или снимать паузу
    const stop = (e) => e.stopPropagation();
    for (const ev of ["click", "mousedown", "pointerdown", "touchstart"]) {
      box.addEventListener(ev, stop);
    }

    if (this.el.graphicsPanel && this.el.graphicsPanel.parentNode) {
      this.el.graphicsPanel.parentNode.insertBefore(box, this.el.graphicsPanel.nextSibling);
    } else if (this.el.overlay) {
      this.el.overlay.appendChild(box);
    }

    this.el.zombieStylePanel = box;
    this.el.zombieStyleToon = box.querySelector("#zombieStyleToon");
    this.el.zombieStylePbr = box.querySelector("#zombieStylePbr");
  }

  /**
   * Подсветить выбранный стиль зомби.
   * @param {"toon"|"pbr"} style
   */
  setZombieStyle(style) {
    if (this.el.zombieStyleToon) {
      const on = style === "toon";
      this.el.zombieStyleToon.classList.toggle("on", on);
      this.el.zombieStyleToon.setAttribute("aria-pressed", on ? "true" : "false");
    }
    if (this.el.zombieStylePbr) {
      const on = style === "pbr";
      this.el.zombieStylePbr.classList.toggle("on", on);
      this.el.zombieStylePbr.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  setGloryVignette(active) {
    this.el.gloryVignette.style.opacity = active ? "1" : "0";
  }

  showGloryFeed(text, duration = 1200) {
    if (!this.el.gloryFeed) {
      let el = document.getElementById("gloryFeed");
      if (!el) {
        el = document.createElement("div");
        el.id = "gloryFeed";
        if (this.el.hud) this.el.hud.appendChild(el);
        else document.body.appendChild(el);
      }
      this.el.gloryFeed = el;
    }
    this.el.gloryFeed.textContent = text;
    this.el.gloryFeed.classList.add("show");
    if (this._gloryFeedTimer) clearTimeout(this._gloryFeedTimer);
    this._gloryFeedTimer = setTimeout(() => {
      if (this.el.gloryFeed) this.el.gloryFeed.classList.remove("show");
      this._gloryFeedTimer = 0;
    }, duration);
  }

  showWaveBanner(text) {
    this.el.waveBanner.textContent = text;
    this.el.waveBanner.classList.add("show");
    setTimeout(() => {
      this.el.waveBanner.classList.remove("show");
    }, CONFIG.waves.bannerDuration);
  }

  showQuote(text) {
    this.el.quoteBox.textContent = "Вася: " + text;
    this.el.quoteBox.classList.add("show");
    setTimeout(() => {
      this.el.quoteBox.classList.remove("show");
    }, CONFIG.quotes.quoteDisplayTime);
  }

  setLevel(level) {
    if (this.el.levelBadge) {
      this.el.levelBadge.textContent = "УРОВЕНЬ: " + level;
    }
  }

  setArenaProgress(cleared, total) {
    if (this.el.arenaBadge) {
      this.el.arenaBadge.textContent = "АРЕНЫ: " + cleared + " / " + total;
    }
  }

  formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const rest = s % 60;
    return m + ":" + (rest < 10 ? "0" : "") + rest;
  }

  /**
   * Экран статистики пройденного уровня (3 секунды)
   * @param {Object} stats - { level, time, kills, glory, items }
   */
  showLevelStats(stats) {
    if (!this.el.levelStats) return;
    const body = this.el.levelStatsBody;
    if (body) {
      body.innerHTML =
        "Время: " + this.formatTime(stats.time) +
        "<br>Убито: " + stats.kills +
        "<br>Добиваний: " + stats.glory +
        "<br>Найдено предметов: " + stats.items;
    }
    const title = this.el.levelStats.querySelector("h2");
    if (title) title.textContent = "УРОВЕНЬ " + stats.level + " ПРОЙДЕН";
    this.el.levelStats.classList.add("show");

    if (this._levelStatsTimer) clearTimeout(this._levelStatsTimer);
    this._levelStatsTimer = setTimeout(() => {
      if (this.el.levelStats) this.el.levelStats.classList.remove("show");
      this._levelStatsTimer = 0;
    }, 3000);
  }

  hideLevelStats() {
    if (this.el.levelStats) this.el.levelStats.classList.remove("show");
    if (this._levelStatsTimer) {
      clearTimeout(this._levelStatsTimer);
      this._levelStatsTimer = 0;
    }
  }

  setWave(wave, remaining) {
    if (remaining !== undefined) {
      this.el.waveBadge.textContent = "ВОЛНА: " + wave + " | ОСТАЛОСЬ: " + remaining;
    } else {
      this.el.waveBadge.textContent = "ВОЛНА: " + wave;
    }
  }

  setScore(kills, gloryKills, score) {
    this.el.killsBadge.textContent = "УБИТО: " + kills + " | ДОБИТО: " + gloryKills;
    this.el.scoreBadge.textContent = "СЧЁТ: " + score;
  }

  showDeathScreen(level, kills, gloryKills, score) {
    this.el.deathStats.innerHTML =
      "Уровень: " +
      level +
      "<br>Убито: " +
      kills +
      "<br>Добиваний (Glory): " +
      gloryKills +
      "<br>Общий счёт: " +
      score;
    this.el.deathScreen.classList.add("active");
  }

  hideDeathScreen() {
    this.el.deathScreen.classList.remove("active");
  }

  /**
   * Подсказка «Иди к лифту» со стрелкой направления
   */
  updateLiftHint(levelManager, world, player) {
    if (!this.el.liftHint) return;
    const exit = world ? world.exitRoom : null;
    const show = !!(levelManager.liftActive && exit && player && !player.isDead);
    this.el.liftHint.classList.toggle("show", show);
    if (!show) return;

    const dx = exit.center.x - player.pos.x;
    const dz = exit.center.z - player.pos.z;
    const targetAngle = Math.atan2(dx, dz);
    const rel = targetAngle - player.yaw - Math.PI;
    if (this.el.liftArrow) {
      this.el.liftArrow.style.transform = "rotate(" + -rel + "rad)";
    }
  }

  update(dt, player, currentWeapon, enemyManager, world = null, levelManager = null, effects = null, consumables = null) {
    // Обновление миникарты
    if (this.minimapVisible && world && player) {
      this.renderMinimap(world, player, enemyManager);
    }

    // Уровень, арены, волна и остаток врагов
    if (levelManager) {
      this.el.levelBadge.textContent = "УРОВЕНЬ: " + levelManager.level;
      this.el.arenaBadge.textContent =
        "АРЕНЫ: " + levelManager.clearedCount + " / " + levelManager.arenas.length;

      const active = levelManager.getActiveArena();
      if (active) {
        if (active.isBoss) {
          const hp = active.boss && active.boss.alive ? Math.max(0, Math.round(active.boss.hp)) : 0;
          this.el.waveBadge.textContent = "БОСС: " + hp + " HP | ВРАГОВ: " + active.remaining;
        } else {
          this.el.waveBadge.textContent =
            "ВОЛНА: " + active.waveNumber + "/" + active.waveCount +
            " | ВРАГОВ: " + active.remaining;
        }
      } else if (levelManager.allCleared()) {
        this.el.waveBadge.textContent = "АРЕНЫ ЗАЧИЩЕНЫ";
      } else {
        this.el.waveBadge.textContent = "ВОЛНА: — | АРЕН: " + levelManager.arenas.length;
      }

      this.updateLiftHint(levelManager, world, player);
    } else if (enemyManager) {
      const remaining = enemyManager.getRemainingEnemies();
      this.el.waveBadge.textContent = "ВОЛНА: " + enemyManager.wave + " | ОСТАЛОСЬ: " + remaining;
    }

    // Хитмаркер
    if (this.hitT > 0) {
      this.hitT -= dt;
      const duration = this.hitKill
        ? (CONFIG.feel?.hitmarker?.killDuration ?? 0.24)
        : (CONFIG.feel?.hitmarker?.hitDuration ?? 0.14);
      this.el.hit.style.opacity = Math.max(0, this.hitT / duration);
      this.el.hit.classList.toggle("kill", this.hitKill);
    } else {
      this.el.hit.style.opacity = "0";
    }

    // Патроны с анимацией punch при выстреле
    if (currentWeapon) {
      const curAmmo = currentWeapon.ammo;
      if (this.prevAmmo !== -1 && curAmmo < this.prevAmmo && this.el.wammo) {
        this.el.wammo.classList.remove("punch");
        void this.el.wammo.offsetWidth;
        this.el.wammo.classList.add("punch");
      }
      this.prevAmmo = curAmmo;

      const txt = curAmmo + " / " + currentWeapon.cfg.maxAmmo;
      if (txt !== this.ammoText) {
        this.ammoText = txt;
        this.el.wammo.innerHTML =
          curAmmo + " <small>/ " + currentWeapon.cfg.maxAmmo + "</small>";
      }
    }

    // Здоровье с плавной догоняющей полоской (ghost bar)
    const targetHp = Math.max(0, player.health);
    const maxHp = player.maxHealth || 100;
    if (this.ghostHp === undefined) this.ghostHp = targetHp;
    if (targetHp < this.ghostHp) {
      this.ghostHp = Math.max(targetHp, this.ghostHp - dt * (maxHp * 0.75));
    } else {
      this.ghostHp = targetHp;
    }

    this.el.hpVal.textContent = Math.round(targetHp);
    this.el.hpFill.style.width = (targetHp / maxHp * 100) + "%";
    if (this.el.hpGhost) {
      this.el.hpGhost.style.width = (this.ghostHp / maxHp * 100) + "%";
    }
    const isPulseHp = targetHp > 0 && targetHp < (CONFIG.feel?.audio?.heartbeatThreshold ?? 28);
    this.el.hpFill.classList.toggle("low-pulse", isPulseHp);

    this.el.apVal.textContent = Math.round(player.armor);
    this.el.apFill.style.width = Math.max(0, (player.armor / player.maxArmor) * 100) + "%";

    // Виньетка урона и низкого здоровья
    const isLowHp = player.health > 0 && player.health < CONFIG.player.lowHpThreshold;
    this.el.vignette.classList.toggle("low-hp", isLowHp);
    if (player.vignetteT > 0) {
      this.el.vignette.style.opacity = Math.min(1, player.vignetteT / 0.25);
    } else if (!isLowHp) {
      this.el.vignette.style.opacity = "0";
    }

    // Индикатор направления урона
    if (player.dmgIndicatorT > 0) {
      const dx = player.dmgSourcePos.x - player.pos.x;
      const dz = player.dmgSourcePos.z - player.pos.z;
      // Направление «вперёд» игрока = (-sin(yaw), -cos(yaw)), т.е. его угол atan2 = yaw + PI.
      // Вычитаем его, чтобы дуга сверху означала урон спереди, а не сзади.
      const angleToSource = Math.atan2(dx, dz);
      const relAngle = angleToSource - player.yaw - Math.PI;
      this.el.dmgArc.style.transform = "rotate(" + -relAngle + "rad)";
      this.el.dmgIndicator.style.opacity = Math.min(1, player.dmgIndicatorT / 0.4);
    } else {
      this.el.dmgIndicator.style.opacity = "0";
    }

    // Рывок (с учётом зарядов от перка «Двойной рывок»)
    const dashMax = Math.max(1, player.dashChargesMax || 1);
    const charges = Math.max(0, Math.min(dashMax, player.dashCharges ?? 1));
    const dashCdCfg = CONFIG.dash.dashCooldown || 1;
    const recharging = charges < dashMax;
    const recharge = Math.max(0, player.dashRecharge || 0);
    const partial = recharging ? Math.max(0, Math.min(1, 1 - recharge / dashCdCfg)) : 0;
    const fill = ((charges + partial) / dashMax) * 100;
    const ready = charges > 0;
    this.el.dashFill.style.width = fill + "%";
    this.el.dash.classList.toggle("charging", !ready);
    if (dashMax > 1) {
      this.el.dashLabel.textContent =
        "Рывок: " + charges + "/" + dashMax + (recharging ? " · " + recharge.toFixed(1) + " с" : "");
    } else {
      this.el.dashLabel.textContent = ready ? "Рывок готов" : "Рывок: " + recharge.toFixed(1) + " с";
    }

    // Эффект рывка (линии скорости по краям экрана)
    if (this.el.dashOverlay) {
      this.el.dashOverlay.classList.toggle("active", player.dashTimer > 0);
    }

    // FPS
    this.frames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.el.fps.textContent = "FPS: " + Math.round(this.frames / this.fpsTime);
      this.frames = 0;
      this.fpsTime = 0;
    }

    // Вспышка подбора предметов
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) {
        this.el.pickupFlash.style.opacity = "0";
      }
    }

    // Расходники и активные эффекты
    if (consumables) this.updateConsumables(consumables);
    if (effects) this.updateEffects(effects);
  }
}
