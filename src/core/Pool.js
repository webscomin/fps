// Универсальный пул объектов для переиспользования частиц, декалей, снарядов и элементов

export class Pool {
  /**
   * @param {Function} factory - функция создания нового объекта
   * @param {number} initialSize - начальный размер пула
   * @param {Function} [resetFn] - функция сброса объекта перед выдачей
   */
  constructor(factory, initialSize = 0, resetFn = null) {
    this.factory = factory;
    this.resetFn = resetFn;
    this.items = [];
    this.currentIndex = 0;

    for (let i = 0; i < initialSize; i++) {
      this.items.push(this.factory(i));
    }
  }

  /**
   * Получить следующий элемент по кругу (ring buffer) или свободный
   */
  getNext() {
    if (this.items.length === 0) return null;
    const item = this.items[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.items.length;
    if (this.resetFn) this.resetFn(item);
    return item;
  }

  /**
   * Найти свободный элемент по предикату
   * @param {Function} predicate
   */
  findFree(predicate) {
    return this.items.find(predicate) || null;
  }

  /**
   * Выполнить действие для всех элементов
   * @param {Function} callback
   */
  forEach(callback) {
    for (let i = 0; i < this.items.length; i++) {
      callback(this.items[i], i);
    }
  }

  /**
   * Сбросить указатель
   */
  reset() {
    this.currentIndex = 0;
  }
}
