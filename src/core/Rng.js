// Детерминированный генератор псевдослучайных чисел (алгоритм mulberry32)
// Обеспечивает воспроизводимость процедурной генерации: один seed = один и тот же уровень

export class Rng {
  /**
   * @param {string|number} [seed]
   */
  constructor(seed) {
    this.setSeed(seed);
  }

  /**
   * Установить сид генератора (число или текстовая строка)
   * @param {string|number} [seed]
   */
  setSeed(seed) {
    if (typeof seed === "string" && seed.trim().length > 0) {
      this.seedStr = seed.trim();
      if (/^[0-9a-fA-F]{1,8}$/.test(this.seedStr)) {
        // Это сид в том же hex-виде, в котором мы его показываем и сохраняем
        // (например, после случайной генерации). Восстанавливаем числовое
        // значение напрямую, иначе повторная загрузка того же сида даст
        // другую планировку (строка хешировалась бы иначе).
        this.initialSeed = (parseInt(this.seedStr, 16) >>> 0) || 1;
      } else {
        // Хеширование строки в 32-битное беззнаковое целое (FNV-1a)
        let h = 2166136261 >>> 0;
        for (let i = 0; i < this.seedStr.length; i++) {
          h = Math.imul(h ^ this.seedStr.charCodeAt(i), 16777619) >>> 0;
        }
        this.initialSeed = h || 1;
      }
    } else if (typeof seed === "number" && !isNaN(seed)) {
      this.initialSeed = (seed >>> 0) || 1;
      this.seedStr = this.initialSeed.toString(16).toUpperCase().padStart(8, "0");
    } else {
      // Случайный 8-значный hex-сид
      this.initialSeed = (Math.random() * 0xffffffff) >>> 0 || 1;
      this.seedStr = this.initialSeed.toString(16).toUpperCase().padStart(8, "0");
    }
    this.s = this.initialSeed;
  }

  /**
   * Сгенерировать следующее псевдослучайное число в диапазоне [0, 1)
   * Алгоритм mulberry32
   * @returns {number}
   */
  next() {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Вещественное число в диапазоне [min, max)
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  range(min, max) {
    return min + this.next() * (max - min);
  }

  /**
   * Целое число в диапазоне [min, max] (включительно)
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  rangeInt(min, max) {
    return Math.floor(min + this.next() * (max - min + 1));
  }

  /**
   * Случайный элемент из массива
   * @template T
   * @param {T[]} arr
   * @returns {T|null}
   */
  choice(arr) {
    if (!arr || arr.length === 0) return null;
    return arr[Math.floor(this.next() * arr.length)];
  }

  /**
   * Перемешивание массива на месте (алгоритм Фишера-Йетса)
   * @template T
   * @param {T[]} arr
   * @returns {T[]}
   */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}
