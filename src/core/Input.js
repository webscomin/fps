// Обработка пользовательского ввода: клавиатура, мышь, захват курсора (Pointer Lock)

export class Input {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Object} callbacks
   */
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.keys = {};
    this.isMouseDown = false;
    this.isLocked = false;

    this.bindEvents();
  }

  requestLock() {
    try {
      const res = this.canvas.requestPointerLock();
      if (res && typeof res.catch === "function") {
        return res.catch((err) => {
          if (this.callbacks.onLockError) this.callbacks.onLockError(err);
        });
      }
      return res;
    } catch (err) {
      if (this.callbacks.onLockError) this.callbacks.onLockError(err);
      return Promise.resolve();
    }
  }

  exitLock() {
    if (document.exitPointerLock) {
      document.exitPointerLock();
    }
  }

  bindEvents() {
    document.addEventListener("pointerlockchange", () => {
      this.isLocked = document.pointerLockElement === this.canvas;
      this.isMouseDown = false;
      if (!this.isLocked) {
        this.keys = {};
      }
      if (this.callbacks.onLockChange) {
        this.callbacks.onLockChange(this.isLocked);
      }
    });

    document.addEventListener("mousemove", (e) => {
      if (this.isLocked && this.callbacks.onMouseMove) {
        this.callbacks.onMouseMove(e.movementX, e.movementY);
      }
    });

    document.addEventListener("keydown", (e) => {
      if (this.callbacks.onKeyDown) {
        this.callbacks.onKeyDown(e);
      }
    });

    document.addEventListener("keyup", (e) => {
      this.keys[e.code] = false;
      if (this.callbacks.onKeyUp) {
        this.callbacks.onKeyUp(e);
      }
    });

    document.addEventListener("mousedown", (e) => {
      if (e.button === 0) {
        this.isMouseDown = true;
        if (this.callbacks.onMouseDown) {
          this.callbacks.onMouseDown(e);
        }
      }
    });

    document.addEventListener("mouseup", (e) => {
      if (e.button === 0) {
        this.isMouseDown = false;
        if (this.callbacks.onMouseUp) {
          this.callbacks.onMouseUp(e);
        }
      }
    });

    document.addEventListener(
      "wheel",
      (e) => {
        if (this.isLocked && this.callbacks.onWheel) {
          this.callbacks.onWheel(Math.sign(e.deltaY));
        }
      },
      { passive: true }
    );
  }
}
