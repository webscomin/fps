// Стиль-метр (Style Meter) в духе Doom Eternal / Ultrakill / DMC:
// чистая игровая логика без прямого обращения к DOM.
import { CONFIG } from "../config.js";

export class StyleMeter {
  constructor(game = null) {
    this.game = game;
    this.rank = 0; // 0..5
    this.value = 0; // 0..100 внутри ступени
    this.idleTimer = 0; // время с последнего убийства / начисления очков
    this.freezeTimer = 0; // заморозка затухания (при переходе на след. уровень)
    this.decayMult = 1; // множитель затухания от перка «Стильный»

    this.lastKillTime = -1;
    this.lastWeapon = null;
    this.killHistory = []; // таймстемпы последних убийств для мультикилла
    this.recentBonuses = []; // последние бонусы для UI: { id, text, pts, time }
    this._bonusIdSeq = 0;
    this._lastRankUpFlashTime = -10;

    // Внешние колбэки для визуальных и аудио эффектов
    this.onRankUp = null;
    this.onRankDown = null;
    this.onScoreGained = null;
  }

  get cfg() {
    return CONFIG.style || {};
  }

  get ranks() {
    return (
      this.cfg.ranks || [
        { name: "ПУСТО", mult: 1.0, color: "#888888", decay: 6 },
        { name: "РАЗМИНКА", mult: 1.2, color: "#e2e8f0", decay: 9 },
        { name: "ЖЁСТКО", mult: 1.5, color: "#facc15", decay: 13 },
        { name: "КРОВАВО", mult: 2.0, color: "#fb923c", decay: 18 },
        { name: "БЕЗУМИЕ", mult: 3.0, color: "#ef4444", decay: 24 },
        { name: "БОГ", mult: 4.0, color: "#f43f5e", decay: 24 }
      ]
    );
  }

  getRankInfo(rank = this.rank) {
    const r = Math.max(0, Math.min(this.ranks.length - 1, rank));
    return this.ranks[r];
  }

  getMultiplier() {
    return this.getRankInfo().mult;
  }

  getRankName() {
    return this.getRankInfo().name;
  }

  getRankColor() {
    return this.getRankInfo().color;
  }

  /**
   * Бонус шанса выпадения предметов: +4% за каждую ступень выше 2, потолок 25%
   * @returns {number} 0..0.25
   */
  getDropBonus() {
    const perRank = this.cfg.dropBonusPerRank ?? 0.04;
    const maxBonus = this.cfg.maxDropBonus ?? 0.25;
    const aboveTwo = Math.max(0, this.rank - 2);
    return Math.min(maxBonus, aboveTwo * perRank);
  }

  /**
   * Заморозить затухание шкалы на указанное количество секунд.
   * @param {number} duration
   */
  freeze(duration = 3.0) {
    this.freezeTimer = Math.max(this.freezeTimer, duration);
    this.idleTimer = 0;
  }

  /**
   * Полный сброс метра (смерть, рестарт).
   */
  reset() {
    this.rank = 0;
    this.value = 0;
    this.idleTimer = 0;
    this.freezeTimer = 0;
    this.lastKillTime = -1;
    this.lastWeapon = null;
    this.killHistory.length = 0;
    this.recentBonuses.length = 0;
  }

  /**
   * Снятие шкалы при получении урона игроком:
   * снимает 25 единиц шкалы и откатывает ступень не более чем на одну за раз.
   * @param {number} [drainAmount]
   */
  drainOnDamage(drainAmount) {
    const drain = drainAmount !== undefined ? drainAmount : (this.cfg.damageDrain ?? 25);
    if (this.rank === 0) {
      this.value = Math.max(0, this.value - drain);
    } else {
      if (this.value >= drain) {
        this.value -= drain;
      } else {
        const remaining = drain - this.value;
        const oldRank = this.rank;
        this.rank -= 1;
        // Откатывает ступень не более чем на одну за раз
        this.value = Math.max(0, 100 - remaining);
        this._notifyRankDown(oldRank, this.rank);
      }
    }
  }

  /**
   * Обработка события смерти врага
   * @param {Object} info
   * @param {string} info.enemyType
   * @param {string} info.weapon
   * @param {boolean} info.isHeadshot
   * @param {boolean} info.isGloryKill
   * @param {boolean} info.inAir
   * @param {boolean} info.isExplosion
   * @param {number} info.time - в секундах
   */
  onEnemyKilled(info) {
    const P = this.cfg.points || {
      kill: 8,
      headshot: 6,
      glory: 20,
      inAir: 6,
      explosion: 8,
      multikill: 15,
      switchWeapon: 5,
      quickKill: 4
    };

    const now = info.time !== undefined ? info.time : performance.now() / 1000;
    let earnedPoints = 0;
    const earnedBonuses = [];

    // Предотвращение дублирования бонусов одного типа на одном враге
    const enemy = info.enemy;
    if (enemy) {
      if (enemy._styleKilled) return;
      enemy._styleKilled = true;
    }
    const canAward = (type) => {
      if (!enemy) return true;
      if (!enemy._styleBonuses) enemy._styleBonuses = new Set();
      if (enemy._styleBonuses.has(type)) return false;
      enemy._styleBonuses.add(type);
      return true;
    };

    // 1. Обычное убийство (+8)
    if (canAward("kill")) {
      earnedPoints += P.kill;
      earnedBonuses.push({ text: "УБИЙСТВО", pts: P.kill });
    }

    // 2. Добивание (+20) или Хедшот (+6)
    if (info.isGloryKill) {
      if (canAward("glory")) {
        earnedPoints += P.glory;
        earnedBonuses.push({ text: "ДОБИТ", pts: P.glory });
      }
    } else if (info.isHeadshot) {
      if (canAward("headshot")) {
        earnedPoints += P.headshot;
        earnedBonuses.push({ text: "ХЕДШОТ", pts: P.headshot });
      }
    }

    // 3. Убийство в воздухе (+6)
    if (info.inAir && canAward("inAir")) {
      earnedPoints += P.inAir;
      earnedBonuses.push({ text: "В ВОЗДУХЕ", pts: P.inAir });
    }

    // 4. Убийство взрывом или бочкой (+8)
    if ((info.isExplosion || info.weapon === "explosion" || info.weapon === "barrel") && canAward("explosion")) {
      earnedPoints += P.explosion;
      earnedBonuses.push({ text: "ВЗРЫВ", pts: P.explosion });
    }

    // 5. Убийство другим оружием, чем предыдущее (+5)
    if (
      this.lastWeapon &&
      info.weapon &&
      info.weapon !== this.lastWeapon &&
      !info.isGloryKill &&
      info.weapon !== "glory" &&
      canAward("switchWeapon")
    ) {
      earnedPoints += P.switchWeapon;
      earnedBonuses.push({ text: "СМЕНА ОРУЖИЯ", pts: P.switchWeapon });
    }

    // 6. Быстрое убийство: менее 1.5 с после предыдущего (+4)
    const quickWindow = this.cfg.quickKillWindow ?? 1.5;
    if (this.lastKillTime > 0 && now - this.lastKillTime < quickWindow && canAward("quickKill")) {
      earnedPoints += P.quickKill;
      earnedBonuses.push({ text: "БЫСТРО", pts: P.quickKill });
    }

    // 7. Мультикилл: 3 убийства за 1.2 с (+15)
    const multiWindow = this.cfg.multikillWindow ?? 1.2;
    if (canAward("multikillCount")) {
      this.killHistory.push(now);
      while (this.killHistory.length > 0 && now - this.killHistory[0] > multiWindow) {
        this.killHistory.shift();
      }
      if (this.killHistory.length >= 3) {
        this.killHistory.length = 0; // серия сработала
        earnedPoints += P.multikill;
        earnedBonuses.push({ text: "МУЛЬТИКИЛЛ", pts: P.multikill });
      }
    }

    // Обновляем состояние предыдущего убийства
    if (earnedPoints > 0) {
      this.lastKillTime = now;
      if (!info.isGloryKill && info.weapon !== "glory") {
        this.lastWeapon = info.weapon;
      }
      this.addPoints(earnedPoints, earnedBonuses);
    }
  }

  /**
   * Начислить очки стиля и зарегистрировать бонусы
   * @param {number} pts
   * @param {Array<{ text: string, pts: number }>} bonuses
   */
  addPoints(pts, bonuses = []) {
    if (pts <= 0) return;
    this.idleTimer = 0;
    this.value += pts;

    const now = performance.now() / 1000;
    for (const b of bonuses) {
      this.recentBonuses.push({
        id: ++this._bonusIdSeq,
        text: `${b.text} +${b.pts}`,
        pts: b.pts,
        time: now
      });
    }

    // Оставляем последние 3 бонуса
    while (this.recentBonuses.length > 3) {
      this.recentBonuses.shift();
    }

    if (this.onScoreGained) {
      this.onScoreGained(pts);
    }

    // Повышение ступеней
    while (this.value >= 100 && this.rank < 5) {
      this.value -= 100;
      const oldRank = this.rank;
      this.rank += 1;
      this._notifyRankUp(oldRank, this.rank);
    }

    if (this.rank >= 5) {
      this.rank = 5;
      this.value = Math.min(100, this.value);
    }
  }

  /**
   * Обновление затухания и устаревания бонусов
   * @param {number} dt
   */
  update(dt) {
    if (this.freezeTimer > 0) {
      this.freezeTimer = Math.max(0, this.freezeTimer - dt);
      return;
    }

    this.idleTimer += dt;
    const decayDelay = this.cfg.decayDelay ?? 2.5;
    if (this.idleTimer > decayDelay) {
      const decayTime = Math.min(dt, this.idleTimer - decayDelay);
      const decayRates = this.cfg.decayRates || [6, 9, 13, 18, 24, 24];
      const rate = decayRates[this.rank] || 6;
      this.value -= rate * (this.decayMult || 1) * decayTime;

      if (this.value < 0) {
        if (this.rank > 0) {
          const oldRank = this.rank;
          this.rank -= 1;
          this.value = Math.max(0, 100 + this.value);
          this._notifyRankDown(oldRank, this.rank);
        } else {
          this.value = 0;
        }
      }
    }

    // Удаление бонусов старше 1.5 с
    const now = performance.now() / 1000;
    this.recentBonuses = this.recentBonuses.filter((b) => now - b.time < 1.5);
  }

  _notifyRankUp(oldRank, newRank) {
    const now = performance.now() / 1000;
    const canFlash = now - this._lastRankUpFlashTime >= 1.0;
    if (canFlash) {
      this._lastRankUpFlashTime = now;
    }
    const info = this.getRankInfo(newRank);
    if (this.onRankUp) {
      this.onRankUp(newRank, oldRank, info, canFlash);
    }
  }

  _notifyRankDown(oldRank, newRank) {
    const info = this.getRankInfo(newRank);
    if (this.onRankDown) {
      this.onRankDown(newRank, oldRank, info);
    }
  }

  /**
   * Получить снимок состояния для HUD
   */
  getState() {
    return {
      rank: this.rank,
      value: this.value,
      name: this.getRankName(),
      color: this.getRankColor(),
      mult: this.getMultiplier(),
      recentBonuses: [...this.recentBonuses]
    };
  }
}
