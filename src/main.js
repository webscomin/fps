// Точка входа в игру: инициализирует игровой движок после загрузки DOM
import { Game } from "./core/Game.js";

function init() {
  if (!window.game) {
    window.game = new Game();
  }
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
