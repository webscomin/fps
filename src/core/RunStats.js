// Статистика забега и локальные рекорды (обычные и ежедневные).
import { CONFIG } from "../config.js";

export function formatRunTime(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return m + ":" + (rest < 10 ? "0" : "") + rest;
}

function todayKey() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}${mm}${dd}`;
}

function dateLabel() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getFullYear()}`;
}

export class RunStats {
  /**
   * @param {Object} game
   */
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.active = false;
    this.elapsed = 0;
    this.maxRank = 0;
    this.maxRankName = "ПУСТО";
    this.seed = "";
    this.difficulty = CONFIG.difficulty?.default || "normal";
    this.daily = false;
  }

  /**
   * Начать новый забег.
   * @param {Object} opts
   * @param {string} opts.seed
   * @param {string} opts.difficulty
   * @param {boolean} [opts.daily]
   */
  start(opts = {}) {
    this.reset();
    this.seed = opts.seed || "";
    this.difficulty = opts.difficulty || CONFIG.difficulty?.default || "normal";
    this.daily = !!opts.daily;
    this.active = true;
  }

  stop() {
    this.active = false;
  }

  /**
   * Учитывать только реальное время игры (вызывается из игрового цикла).
   * @param {number} dt
   * @param {Object} styleMeter
   */
  update(dt, styleMeter) {
    if (!this.active || !(dt > 0)) return;
    this.elapsed += dt;
    if (styleMeter && styleMeter.rank > this.maxRank) {
      this.maxRank = styleMeter.rank;
      this.maxRankName = styleMeter.getRankName();
    }
  }

  /**
   * Итоговая сводка забега.
   * @param {Array} perkEntries
   * @returns {Object}
   */
  summary(perkEntries = []) {
    const game = this.game;
    const mode = CONFIG.difficulty?.modes?.[this.difficulty] || {};
    return {
      date: dateLabel(),
      dailyKey: todayKey(),
      seed: this.seed || (game.world ? game.world.seed : ""),
      difficulty: this.difficulty,
      difficultyName: mode.name || this.difficulty,
      daily: this.daily,
      level: game.levelManager ? game.levelManager.level : 1,
      kills: game.kills || 0,
      glory: game.gloryKills || 0,
      maxRank: this.maxRank,
      maxRankName: this.maxRankName,
      time: this.elapsed,
      perks: perkEntries.map((p) => ({ id: p.id, name: p.name, count: p.count, icon: p.icon, color: p.color })),
      score: game.score || 0
    };
  }
}

export class RecordStore {
  constructor() {
    const cfg = CONFIG.records || {};
    this.storageKey = cfg.storageKey || "fps_records_v1";
    this.dailyStorageKey = cfg.dailyStorageKey || "fps_daily_records_v1";
    this.maxEntries = cfg.maxEntries || 5;
  }

  /** @private */
  _read(key) {
    try {
      const raw = localStorage.getItem(key);
      const data = raw ? JSON.parse(raw) : null;
      if (data && typeof data === "object") {
        if (data.list && Array.isArray(data.list)) return data;
        return { list: [], ...data };
      }
    } catch (_) {}
    return { list: [] };
  }

  /** @private */
  _write(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (_) {}
  }

  /**
   * Топ записей. Для ежедневных — по конкретному сиду/дню.
   * @param {boolean} daily
   * @param {string} [seed]
   * @returns {Array}
   */
  getTop(daily = false, seed = "") {
    if (daily) {
      const all = this._read(this.dailyStorageKey);
      const list = all[seed] && Array.isArray(all[seed]) ? all[seed] : [];
      return list.slice(0, this.maxEntries);
    }
    const data = this._read(this.storageKey);
    return (data.list || []).slice(0, this.maxEntries);
  }

  /**
   * Лучший счёт забега.
   * @param {boolean} daily
   * @param {string} [seed]
   * @returns {number|null}
   */
  getBest(daily = false, seed = "") {
    const top = this.getTop(daily, seed);
    return top.length > 0 ? top[0].score : null;
  }

  /**
   * Сохранить результат и вернуть топ + признак нового рекорда.
   * @param {Object} record
   * @param {boolean} daily
   * @param {string} [seed]
   * @returns {{top:Array, isRecord:boolean, best:number|null}}
   */
  add(record, daily = false, seed = "") {
    const key = daily ? this.dailyStorageKey : this.storageKey;
    const data = this._read(key);
    const bucketKey = daily ? seed || record.dailyKey || "daily" : "list";
    const list = daily
      ? (data[bucketKey] && Array.isArray(data[bucketKey]) ? data[bucketKey].slice() : [])
      : (data.list || []).slice();
    const previousBest = list.length > 0 ? list[0].score : null;

    // Храним только нужные поля, чтобы localStorage не разрастался.
    list.push({
      score: record.score,
      level: record.level,
      kills: record.kills,
      glory: record.glory,
      time: record.time,
      date: record.date,
      difficulty: record.difficulty,
      seed: record.seed,
      daily: !!record.daily
    });
    list.sort((a, b) => b.score - a.score);
    if (list.length > this.maxEntries) list.length = this.maxEntries;

    if (daily) {
      data[bucketKey] = list;
    } else {
      data.list = list;
    }
    this._write(key, data);

    return {
      top: list.slice(),
      isRecord: previousBest === null || record.score > previousBest,
      best: list.length > 0 ? list[0].score : null
    };
  }
}
