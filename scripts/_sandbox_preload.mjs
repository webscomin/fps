// Временный preload для запуска Vite в песочнице: Vite вызывает exec("net use"),
// а spawn с pipe-stdio запрещён песочницей (EPERM). Подменяем только этот вызов.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const cp = require("node:child_process");
const originalExec = cp.exec;

cp.exec = function patchedExec(command, options, callback) {
  if (typeof command === "string" && command.trim() === "net use") {
    const cb = typeof options === "function" ? options : callback;
    if (typeof cb === "function") process.nextTick(() => cb(null, "", ""));
    return { on() {}, once() {}, kill() {}, unref() {} };
  }
  return originalExec.apply(this, arguments);
};
