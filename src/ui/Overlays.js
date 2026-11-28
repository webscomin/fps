// Экранные оверлеи забега: карточки перков, итоги, настройки сложности,
// ежедневный забег и иконки взятых перков. Всё создаётся из кода.
import { CONFIG } from "../config.js";
import { formatRunTime } from "../core/RunStats.js";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function todaySeed() {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

function drawStar(ctx, r1, r2, points = 5) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? r1 : r2;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/**
 * Рисует пиксельную иконку перка на canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {Object} perk
 * @param {number} [size]
 */
export function drawPerkIcon(canvas, perk, size = 64) {
  if (!canvas) return;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.scale(size / 64, size / 64);
  ctx.imageSmoothingEnabled = false;
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
  ctx.lineWidth = 5;
  const color = perk.color || "#e6c86e";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  const icon = perk.icon || "star";

  if (icon === "legs") {
    ctx.beginPath();
    ctx.moveTo(-18, -20);
    ctx.lineTo(-4, -2);
    ctx.lineTo(-12, 0);
    ctx.lineTo(-2, 20);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(18, -20);
    ctx.lineTo(4, -2);
    ctx.lineTo(12, 0);
    ctx.lineTo(2, 20);
    ctx.stroke();
    ctx.fillRect(-14, 16, 12, 5);
    ctx.fillRect(2, 16, 12, 5);
  } else if (icon === "dash") {
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.moveTo(-18 + i * 20, -18);
      ctx.lineTo(-2 + i * 20, 0);
      ctx.lineTo(-18 + i * 20, 18);
      ctx.stroke();
    }
    ctx.fillRect(20, -2, 6, 4);
  } else if (icon === "shotgun") {
    ctx.fillRect(-26, -7, 36, 11);
    ctx.beginPath();
    ctx.moveTo(10, -7);
    ctx.lineTo(24, -13);
    ctx.lineTo(24, 10);
    ctx.lineTo(10, 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(-30, -4, 8, 18);
    ctx.fillStyle = "#1b1b1b";
    ctx.fillRect(-2, -6, 4, 4);
    ctx.fillStyle = color;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(-20 + i * 7, 16, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (icon === "ak47") {
    // Силуэт АК-47 в тёплом жёлто-оливковом цвете
    ctx.save();
    ctx.fillStyle = "#d4b85c";
    // Ствол и ствольная коробка
    ctx.fillRect(-22, -3, 40, 5);
    // Ствол вперёд
    ctx.fillRect(8, -2, 16, 3);
    // Газовая трубка
    ctx.fillRect(-6, -6, 20, 3);
    // Мушка
    ctx.fillRect(20, -7, 2, 5);
    // Изогнутый магазин
    ctx.beginPath();
    ctx.moveTo(-2, 2);
    ctx.quadraticCurveTo(4, 14, 10, 20);
    ctx.lineTo(6, 21);
    ctx.quadraticCurveTo(0, 15, -6, 2);
    ctx.closePath();
    ctx.fill();
    // Приклад
    ctx.beginPath();
    ctx.moveTo(-22, -3);
    ctx.lineTo(-32, 6);
    ctx.lineTo(-30, 14);
    ctx.lineTo(-22, 2);
    ctx.closePath();
    ctx.fill();
    // Пистолетная рукоятка
    ctx.fillRect(-12, 2, 5, 11);
    ctx.restore();
  } else if (icon === "rocket") {
    ctx.beginPath();
    ctx.moveTo(0, -26);
    ctx.quadraticCurveTo(12, -6, 10, 12);
    ctx.lineTo(-10, 12);
    ctx.quadraticCurveTo(-12, -6, 0, -26);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(-16, 8, 8, 14);
    ctx.fillRect(8, 8, 8, 14);
    ctx.beginPath();
    ctx.moveTo(-6, 14);
    ctx.lineTo(0, 26);
    ctx.lineTo(6, 14);
    ctx.closePath();
    ctx.fill();
  } else if (icon === "shield") {
    ctx.beginPath();
    ctx.moveTo(0, -26);
    ctx.lineTo(22, -18);
    ctx.lineTo(18, 8);
    ctx.quadraticCurveTo(10, 20, 0, 26);
    ctx.quadraticCurveTo(-10, 20, -18, 8);
    ctx.lineTo(-22, -18);
    ctx.closePath();
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(0, 12);
    ctx.moveTo(-10, 0);
    ctx.lineTo(10, 0);
    ctx.stroke();
  } else if (icon === "fang") {
    ctx.beginPath();
    ctx.moveTo(-18, -16);
    ctx.lineTo(-4, -16);
    ctx.lineTo(-12, 6);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(4, -16);
    ctx.lineTo(18, -16);
    ctx.lineTo(12, 6);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, 10);
    ctx.quadraticCurveTo(12, 18, 0, 28);
    ctx.quadraticCurveTo(-12, 18, 0, 10);
    ctx.fill();
  } else if (icon === "magnet") {
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.arc(0, -2, 16, 0, Math.PI);
    ctx.stroke();
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-16, -2);
    ctx.lineTo(-16, 20);
    ctx.moveTo(16, -2);
    ctx.lineTo(16, 20);
    ctx.stroke();
    ctx.fillRect(-21, 18, 10, 7);
    ctx.fillRect(11, 18, 10, 7);
  } else if (icon === "clock") {
    ctx.beginPath();
    ctx.arc(0, 2, 21, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, 2);
    ctx.lineTo(0, -12);
    ctx.moveTo(0, 2);
    ctx.lineTo(11, 9);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-7, -20);
    ctx.lineTo(-2, -12);
    ctx.lineTo(-9, -6);
    ctx.stroke();
  } else if (icon === "armor") {
    ctx.beginPath();
    ctx.moveTo(0, -26);
    ctx.lineTo(22, -16);
    ctx.lineTo(16, 10);
    ctx.quadraticCurveTo(8, 21, 0, 26);
    ctx.quadraticCurveTo(-8, 21, -16, 10);
    ctx.lineTo(-22, -16);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-7, -2);
    ctx.lineTo(7, -2);
    ctx.lineTo(7, 16);
    ctx.lineTo(-7, 16);
    ctx.closePath();
    ctx.fill();
  } else if (icon === "barrel") {
    ctx.beginPath();
    ctx.moveTo(-14, -22);
    ctx.quadraticCurveTo(-18, 0, -14, 22);
    ctx.lineTo(14, 22);
    ctx.quadraticCurveTo(18, 0, 14, -22);
    ctx.closePath();
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-16, -8);
    ctx.lineTo(16, -8);
    ctx.moveTo(-16, 8);
    ctx.lineTo(16, 8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-26, 12);
    ctx.lineTo(-14, 24);
    ctx.moveTo(-14, 12);
    ctx.lineTo(-26, 24);
    ctx.stroke();
  } else if (icon === "star") {
    drawStar(ctx, 24, 10);
    ctx.fill();
  } else if (icon === "spring") {
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-14, 20);
    ctx.lineTo(12, 12);
    ctx.lineTo(-12, 4);
    ctx.lineTo(12, -4);
    ctx.lineTo(-12, -12);
    ctx.lineTo(10, -20);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(4, -26);
    ctx.lineTo(14, -16);
    ctx.lineTo(4, -6);
    ctx.stroke();
  } else if (icon === "bottle") {
    ctx.beginPath();
    ctx.moveTo(-7, -26);
    ctx.lineTo(7, -26);
    ctx.lineTo(7, -14);
    ctx.quadraticCurveTo(16, -4, 16, 12);
    ctx.lineTo(16, 24);
    ctx.lineTo(-16, 24);
    ctx.lineTo(-16, 12);
    ctx.quadraticCurveTo(-16, -4, -7, -14);
    ctx.closePath();
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-14, 10);
    ctx.lineTo(14, 10);
    ctx.stroke();
    drawStar(ctx, 7, 3, 5);
    ctx.fill();
  } else {
    drawStar(ctx, 22, 9);
    ctx.fill();
  }

  ctx.restore();
}

export class Overlays {
  /**
   * @param {Object} game
   */
  constructor(game) {
    this.game = game;
    this.perkChoices = [];
    this.perkIndex = 0;
    this.onChoose = null;
    this._perkOpen = false;
    this._perkSignature = "";
    this._badgeSignature = "";

    this._buildStartControls();
    this._buildPerkScreen();
    this._buildSummary();
    this._buildBadges();
    this.setDifficulty(game.difficulty || CONFIG.difficulty?.default || "normal");
    this.setMenuVisible(true);
  }

  /** @private */
  _stopEvents(el) {
    if (!el) return;
    const stop = (e) => e.stopPropagation();
    for (const ev of ["click", "mousedown", "pointerdown", "touchstart"]) {
      el.addEventListener(ev, stop);
    }
  }

  /** @private */
  _buildStartControls() {
    const overlay = document.getElementById("overlay");
    const box = document.createElement("div");
    box.id = "runSetup";
    box.className = "runSetup";

    const diffOrder = CONFIG.difficulty?.order || ["easy", "normal", "hard"];
    const modes = CONFIG.difficulty?.modes || {};
    const buttons = diffOrder
      .filter((id) => modes[id])
      .map(
        (id) =>
          `<button type="button" class="diffBtn" data-diff="${id}">${modes[id].name}</button>`
      )
      .join("");

    box.innerHTML =
      `<div class="runRow"><span class="runLabel">СЛОЖНОСТЬ:</span>${buttons}</div>` +
      `<button type="button" id="dailyBtn" class="dailyBtn">ЕЖЕДНЕВНЫЙ ЗАБЕГ</button>` +
      `<div id="dailySeedLabel" class="dailySeedLabel"></div>`;

    const title = document.getElementById("title");
    if (title && title.parentNode) {
      title.insertAdjacentElement("afterend", box);
    } else if (overlay) {
      overlay.insertBefore(box, overlay.firstChild);
    }
    this._stopEvents(box);

    box.querySelectorAll(".diffBtn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.game.setDifficulty(btn.dataset.diff);
      });
    });

    const dailyBtn = box.querySelector("#dailyBtn");
    if (dailyBtn) {
      dailyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.game.startDailyRun();
      });
    }

    this.runSetup = box;
    const dailyLabel = box.querySelector("#dailySeedLabel");
    if (dailyLabel) dailyLabel.textContent = "SEED ДНЯ: " + todaySeed();
  }

  /** @private */
  _buildPerkScreen() {
    const root = document.createElement("div");
    root.id = "perkScreen";
    root.className = "psxModal";
    root.innerHTML =
      '<div class="perkPanel">' +
      '<div class="perkHeader">' +
      '<div class="perkTitle">ВЫБЕРИ ПЕРК</div>' +
      '<div class="perkSub">1–3, колесо мыши или клик</div>' +
      "</div>" +
      '<div class="perkCards" id="perkCards"></div>' +
      '<div class="perkHint">Забег и эффекты на паузе. Перк останется до конца забега.</div>' +
      "</div>";
    document.body.appendChild(root);
    this._stopEvents(root);

    root.addEventListener(
      "wheel",
      (e) => {
        if (!this._perkOpen) return;
        e.preventDefault();
        this.focusNext(e.deltaY > 0 ? 1 : -1);
      },
      { passive: false }
    );

    this.perkScreen = root;
    this.perkCards = root.querySelector("#perkCards");
  }

  /** @private */
  _buildSummary() {
    const root = document.createElement("div");
    root.id = "summaryScreen";
    root.className = "psxModal";
    root.innerHTML =
      '<div class="summaryPanel">' +
      '<div id="summaryTitle" class="summaryTitle">ЗАБЕГ ОКОНЧЕН</div>' +
      '<div id="summaryBody" class="summaryBody"></div>' +
      '<div id="summaryButtons" class="summaryButtons"></div>' +
      "</div>";
    document.body.appendChild(root);
    this._stopEvents(root);
    this.summaryScreen = root;
    this.summaryTitle = root.querySelector("#summaryTitle");
    this.summaryBody = root.querySelector("#summaryBody");
    this.summaryButtons = root.querySelector("#summaryButtons");
  }

  /** @private */
  _buildBadges() {
    const hud = document.getElementById("hud");
    const box = document.createElement("div");
    box.id = "perkBadges";
    if (hud) hud.appendChild(box);
    else document.body.appendChild(box);
    this.badges = box;
  }

  /**
   * Показ/скрытие блока сложности и ежедневного забега.
   * @param {boolean} visible
   */
  setMenuVisible(visible) {
    if (!this.runSetup) return;
    this.runSetup.style.display = visible ? "flex" : "none";
  }

  /**
   * Подсветить выбранную сложность.
   * @param {string} id
   */
  setDifficulty(id) {
    if (!this.runSetup) return;
    this.runSetup.querySelectorAll(".diffBtn").forEach((btn) => {
      const on = btn.dataset.diff === id;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  // ===== Карточки перков =====

  /**
   * @param {Array} perks
   * @param {Function} onChoose
   */
  showPerkChoice(perks, onChoose) {
    if (!this.perkScreen) return;
    this.perkChoices = perks.slice();
    this.perkIndex = 0;
    this.onChoose = onChoose || null;
    this._perkOpen = true;
    this._perkSignature = "";

    this.perkCards.innerHTML = "";
    for (let i = 0; i < this.perkChoices.length; i++) {
      const perk = this.perkChoices[i];
      const card = document.createElement("button");
      card.type = "button";
      card.className = "perkCard " + (perk.rarity === "rare" ? "rare" : "common");
      card.style.setProperty("--perk-color", perk.color || "#e6c86e");

      const iconWrap = document.createElement("div");
      iconWrap.className = "perkIconWrap";
      const canvas = document.createElement("canvas");
      canvas.className = "perkIcon";
      drawPerkIcon(canvas, perk, 76);
      iconWrap.appendChild(canvas);

      const key = document.createElement("div");
      key.className = "perkKey";
      key.textContent = String(i + 1);

      const rarity = document.createElement("div");
      rarity.className = "perkRarity";
      rarity.textContent = perk.rarity === "rare" ? "РЕДКИЙ" : "ОБЫЧНЫЙ";

      const name = document.createElement("div");
      name.className = "perkName";
      name.textContent = perk.name;

      const desc = document.createElement("div");
      desc.className = "perkDesc";
      desc.textContent = perk.desc;

      const taken = this.game.perks ? this.game.perks.getCount(perk.id) : 0;
      const max = this.game.perks ? this.game.perks.maxFor(perk.id) : CONFIG.run?.perkMaxStacks || 3;
      const stacks = document.createElement("div");
      stacks.className = "perkStacks";
      stacks.textContent = "КОПИЙ: " + taken + " / " + max;

      card.appendChild(key);
      card.appendChild(iconWrap);
      card.appendChild(rarity);
      card.appendChild(name);
      card.appendChild(desc);
      card.appendChild(stacks);

      card.addEventListener("mouseenter", () => this.focusIndex(i));
      card.addEventListener("focus", () => this.focusIndex(i));
      card.addEventListener("click", (e) => {
        e.stopPropagation();
        this.chooseIndex(i);
      });

      this.perkCards.appendChild(card);
    }

    this.focusIndex(0);
    this.perkScreen.classList.add("open");
    this.perkScreen.setAttribute("aria-hidden", "false");
  }

  hidePerkChoice() {
    this._perkOpen = false;
    this.onChoose = null;
    this.perkChoices = [];
    if (this.perkScreen) {
      this.perkScreen.classList.remove("open");
      this.perkScreen.setAttribute("aria-hidden", "true");
    }
  }

  /** @param {number} index */
  focusIndex(index) {
    if (!this._perkOpen || this.perkChoices.length === 0) return;
    const n = this.perkChoices.length;
    this.perkIndex = ((index % n) + n) % n;
    const cards = this.perkCards ? this.perkCards.children : [];
    for (let i = 0; i < cards.length; i++) {
      cards[i].classList.toggle("focused", i === this.perkIndex);
    }
  }

  /** @param {number} delta */
  focusNext(delta) {
    if (!this._perkOpen) return;
    this.focusIndex(this.perkIndex + delta);
  }

  /** @param {number} index */
  chooseIndex(index) {
    if (!this._perkOpen || this.perkChoices.length === 0) return;
    const i = Math.max(0, Math.min(this.perkChoices.length - 1, index));
    const perk = this.perkChoices[i];
    const cb = this.onChoose;
    this.hidePerkChoice();
    if (cb) cb(perk);
  }

  chooseFocused() {
    this.chooseIndex(this.perkIndex);
  }

  // ===== Итоги забега =====

  /**
   * @param {Object} summary
   * @param {{top:Array,isRecord:boolean,best:number|null}|null} result
   * @param {Object} [opts]
   * @param {boolean} [opts.debug]
   */
  showSummary(summary, result, opts = {}) {
    if (!this.summaryScreen) return;
    const debug = !!opts.debug;
    const modeName = summary.difficultyName || summary.difficulty || "НОРМАЛЬНЫЙ";

    this.summaryTitle.textContent = debug ? "ОТЛАДОЧНЫЙ ФИНИШ" : "ЗАБЕГ ОКОНЧЕН";
    this.summaryTitle.classList.toggle("debug", debug);

    const recordBanner = result && result.isRecord
      ? '<div class="recordBanner">НОВЫЙ РЕКОРД!</div>'
      : "";

    const rows = (result && result.top ? result.top : []).map((r, i) => {
      const fresh =
        result && result.top && i === 0 && result.isRecord && r.score === summary.score
          ? " fresh"
          : "";
      return (
        `<tr class="${fresh.trim()}">` +
        `<td>${i + 1}</td>` +
        `<td>${r.score}</td>` +
        `<td>${r.level}</td>` +
        `<td>${r.date || "—"}</td>` +
        "</tr>"
      );
    });
    while (rows.length < 5) rows.push('<tr class="empty"><td>—</td><td>—</td><td>—</td><td>—</td></tr>');

    this.summaryBody.innerHTML =
      `<div class="summaryMeta">` +
      `<span>УРОВЕНЬ ${summary.level}</span>` +
      `<span>${modeName}</span>` +
      `<span>${summary.daily ? "ЕЖЕДНЕВНЫЙ" : "SEED: " + summary.seed}</span>` +
      `</div>` +
      recordBanner +
      `<div class="summaryGrid">` +
      `<div class="summaryStat"><span class="sLabel">ВРЕМЯ</span><span class="sVal">${formatRunTime(summary.time)}</span></div>` +
      `<div class="summaryStat"><span class="sLabel">УБИТО</span><span class="sVal">${summary.kills}</span></div>` +
      `<div class="summaryStat"><span class="sLabel">ДОБИВАНИЙ</span><span class="sVal">${summary.glory}</span></div>` +
      `<div class="summaryStat"><span class="sLabel">МАКС. СТИЛЬ</span><span class="sVal">${summary.maxRankName}</span></div>` +
      `<div class="summaryStat"><span class="sLabel">СЧЁТ</span><span class="sVal score">${summary.score}</span></div>` +
      `<div class="summaryStat"><span class="sLabel">ЛУЧШИЙ</span><span class="sVal">${result && result.best != null ? result.best : "—"}</span></div>` +
      `</div>` +
      `<div class="summaryPerks" id="summaryPerks"></div>` +
      `<div class="recordsBlock">` +
      `<div class="recordsTitle">${summary.daily ? "РЕКОРДЫ ДНЯ" : "ТОП-5 ЗАБЕГОВ"}</div>` +
      `<table class="recordsTable"><thead><tr><th>#</th><th>СЧЁТ</th><th>УР.</th><th>ДАТА</th></tr></thead>` +
      `<tbody>${rows.join("")}</tbody></table>` +
      `</div>`;

    const perkBox = this.summaryBody.querySelector("#summaryPerks");
    if (perkBox) {
      if (!summary.perks || summary.perks.length === 0) {
        perkBox.innerHTML = '<span class="noPerks">БЕЗ ПЕРКОВ</span>';
      } else {
        for (const p of summary.perks) {
          const chip = document.createElement("div");
          chip.className = "summaryPerk";
          chip.style.setProperty("--perk-color", p.color || "#e6c86e");
          const canvas = document.createElement("canvas");
          drawPerkIcon(canvas, p, 34);
          chip.appendChild(canvas);
          const label = document.createElement("span");
          label.textContent = p.name + (p.count > 1 ? " ×" + p.count : "");
          chip.appendChild(label);
          perkBox.appendChild(chip);
        }
      }
    }

    this.summaryButtons.innerHTML = "";
    const makeBtn = (text, act, primary = false) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sumBtn" + (primary ? " primary" : "");
      btn.textContent = text;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (act === "again") this.game.restartWithNewSeed();
        else if (act === "same") this.game.restartWithSameSeed();
        else if (act === "menu") this.game.returnToMenu();
      });
      this.summaryButtons.appendChild(btn);
    };
    makeBtn("ЕЩЁ РАЗ", "again", true);
    makeBtn("С ТЕМ ЖЕ SEED", "same");
    makeBtn("В МЕНЮ", "menu");

    this.summaryScreen.classList.add("open");
    this.summaryScreen.setAttribute("aria-hidden", "false");
  }

  hideSummary() {
    if (this.summaryScreen) {
      this.summaryScreen.classList.remove("open");
      this.summaryScreen.setAttribute("aria-hidden", "true");
    }
  }

  get summaryOpen() {
    return !!(this.summaryScreen && this.summaryScreen.classList.contains("open"));
  }

  get perkOpen() {
    return this._perkOpen;
  }

  // ===== Иконки взятых перков =====

  /**
   * @param {Array} entries
   */
  setPerks(entries) {
    if (!this.badges) return;
    const list = entries || [];
    const sig = list.map((p) => p.id + ":" + p.count).join("|");
    if (sig === this._badgeSignature) return;
    this._badgeSignature = sig;
    this.badges.innerHTML = "";

    for (const perk of list) {
      const badge = document.createElement("div");
      badge.className = "perkBadge";
      badge.style.setProperty("--perk-color", perk.color || "#e6c86e");
      badge.title = perk.name + " — " + perk.desc + " (" + perk.count + ")";
      const canvas = document.createElement("canvas");
      drawPerkIcon(canvas, perk, 30);
      badge.appendChild(canvas);
      if (perk.count > 1) {
        const count = document.createElement("span");
        count.className = "perkBadgeCount";
        count.textContent = "×" + perk.count;
        badge.appendChild(count);
      }
      this.badges.appendChild(badge);
    }
  }

  /** Пересобрать карточки при открытии, если счётчики изменились. */
  refreshPerkCards() {
    this._perkSignature = "";
  }
}
