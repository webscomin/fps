// Общая текстура подсказки "[E] ДОБИТЬ" для всех врагов.
// Раньше каждый зомби/мутант создавал собственный canvas и CanvasTexture,
// что давало лишние аллокации и загрузки в GPU на каждой волне.
import * as THREE from "three";

let cachedTexture = null;

/**
 * @returns {THREE.CanvasTexture}
 */
export function getGloryPromptTexture() {
  if (cachedTexture) return cachedTexture;

  const cv = document.createElement("canvas");
  cv.width = 256;
  cv.height = 64;
  const ctx = cv.getContext("2d");
  ctx.font = "900 36px 'Trebuchet MS', Verdana, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffd23f";
  ctx.strokeStyle = "#1b1340";
  ctx.lineWidth = 7;
  ctx.strokeText("[E] ДОБИТЬ", 128, 32);
  ctx.fillText("[E] ДОБИТЬ", 128, 32);

  cachedTexture = new THREE.CanvasTexture(cv);
  // Текстура общая: не освобождать при удалении отдельного врага
  cachedTexture.userData.shared = true;
  return cachedTexture;
}
