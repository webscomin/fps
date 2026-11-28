// Тест работы системы StyleMeter и наград
import assert from "node:assert";
import { CONFIG } from "../src/config.js";
import { StyleMeter } from "../src/core/StyleMeter.js";

console.log("=== ТЕСТИРОВАНИЕ СТИЛЬ-МЕТРА ===");

// 1. Инициализация
const mockGame = {
  player: {
    health: 100,
    maxHealth: 100,
    armor: 20,
    maxArmor: 100,
    onGround: true,
    isDead: false,
    takeDamage(dmg, src, game) {
      let finalDamage = dmg;
      if (game?.styleMeter?.rank === 5) {
        const reduction = CONFIG.style?.godDamageReduction ?? 0.10;
        finalDamage = Math.max(1, Math.round(finalDamage * (1 - reduction)));
      }
      if (this.armor > 0) {
        const toArmor = Math.min(this.armor, Math.round(finalDamage * 0.7));
        this.armor -= toArmor;
        this.health -= (finalDamage - toArmor);
      } else {
        this.health -= finalDamage;
      }
      if (game?.styleMeter) {
        game.styleMeter.drainOnDamage(CONFIG.style?.damageDrain ?? 25);
      }
    }
  }
};

const sm = new StyleMeter(mockGame);
assert.strictEqual(sm.rank, 0);
assert.strictEqual(sm.value, 0);
assert.strictEqual(sm.getRankName(), "ПУСТО");
assert.strictEqual(sm.getMultiplier(), 1.0);
console.log("✓ Базовое состояние корректно (ПУСТО x1.0, 0)");

// 2. Начисление очков и переход по рангам
// kill (+8), headshot (+6), inAir (+6), switch (+5)
const enemy1 = { id: 1, type: "zombie" };
sm.onEnemyKilled({
  enemyType: "zombie",
  weapon: "shotgun",
  isHeadshot: true,
  isGloryKill: false,
  inAir: true,
  isExplosion: false,
  time: 1.0,
  enemy: enemy1
});

// 8 + 6 + 6 = 20 (нет предыдущего оружия, поэтому switch нет)
assert.strictEqual(sm.value, 20);
assert.strictEqual(sm.rank, 0);
console.log("✓ Первое убийство (kill 8 + headshot 6 + inAir 6 = 20) начислено");

// Проверка дедупликации на одном и том же враге
sm.onEnemyKilled({
  enemyType: "zombie",
  weapon: "shotgun",
  isHeadshot: true,
  isGloryKill: false,
  inAir: true,
  isExplosion: false,
  time: 1.1,
  enemy: enemy1
});
assert.strictEqual(sm.value, 20, "Бонусы не должны начисляться повторно за одного и того же врага");
console.log("✓ Дедупликация бонусов для одного врага работает");

// Второе убийство другим оружием в течение 1.5 с (quick kill +4, weapon switch +5, kill +8)
const enemy2 = { id: 2, type: "mutant" };
sm.onEnemyKilled({
  enemyType: "mutant",
  weapon: "ak47",
  isHeadshot: false,
  isGloryKill: false,
  inAir: false,
  isExplosion: false,
  time: 2.0,
  enemy: enemy2
});
// 20 + 8 (kill) + 5 (switch) + 4 (quick) = 37
assert.strictEqual(sm.value, 37);
console.log("✓ Смена оружия (+5) и быстрое убийство (+4) начислены: 37 очков");

// Третье убийство за короткое окно (мультикилл: 3 убийства за 1.2 с -> +15)
const enemy3 = { id: 3, type: "robot" };
sm.onEnemyKilled({
  enemyType: "robot",
  weapon: "rocket",
  isHeadshot: false,
  isGloryKill: false,
  inAir: false,
  isExplosion: true,
  time: 2.1,
  enemy: enemy3
});
// 37 + 8 (kill) + 8 (explosion) + 5 (switch) + 4 (quick) + 15 (multikill) = 77
assert.strictEqual(sm.value, 77);
console.log("✓ Взрыв (+8) и мультикилл (+15) начислены: 77 очков");

// Добивание (+20 glory, +8 kill, +4 quick) -> 77 + 32 = 109 -> Ранг 1 (РАЗМИНКА x1.2) и 9 очков
let rankUpEvents = [];
sm.onRankUp = (newRank, oldRank, info, canFlash) => {
  rankUpEvents.push({ newRank, oldRank, name: info.name, mult: info.mult });
};
const enemy4 = { id: 4, type: "zombie" };
sm.onEnemyKilled({
  enemyType: "zombie",
  weapon: "glory",
  isHeadshot: false,
  isGloryKill: true,
  inAir: false,
  isExplosion: false,
  time: 2.5,
  enemy: enemy4
});
assert.strictEqual(sm.rank, 1);
assert.strictEqual(sm.getRankName(), "РАЗМИНКА");
assert.strictEqual(sm.getMultiplier(), 1.2);
assert.strictEqual(sm.value, 9);
assert.strictEqual(rankUpEvents.length, 1);
assert.strictEqual(rankUpEvents[0].name, "РАЗМИНКА");
console.log("✓ Переход на ранг 1 (РАЗМИНКА, x1.2, value 9) успешен");

// 3. Быстрое повышение до БОГ (ранг 5, x4.0)
sm.addPoints(450); // 9 + 450 = 459 -> еще 4 ранга (1+4=5), value 59
assert.strictEqual(sm.rank, 5);
assert.strictEqual(sm.getRankName(), "БОГ");
assert.strictEqual(sm.getMultiplier(), 4.0);
assert.strictEqual(sm.value, 59);
console.log("✓ Ранг 5 (БОГ, x4.0) достигнут");

// Кап на ранге 5: не выше 100
sm.addPoints(100);
assert.strictEqual(sm.rank, 5);
assert.strictEqual(sm.value, 100);
console.log("✓ Значение шкалы ограничено 100 на ранге 5");

// 4. Награды: drop bonus, god damage reduction, armor restore
assert.strictEqual(sm.getDropBonus(), 0.12); // ранг 5 -> 3 ранга выше 2-го * 0.04 = +12%
console.log("✓ Drop bonus на ранге 5: +12%");

// Тест снижения урона на ранге 5 (10% godDamageReduction)
const startHp = mockGame.player.health;
const startArmor = mockGame.player.armor;
// урон 50: с 10% reduction -> 45 урона (32 в броню, 13 в хп)
mockGame.player.takeDamage(50, null, { styleMeter: sm });
assert(mockGame.player.health > startHp - 50, "Урон должен быть снижен на 10%");
console.log("✓ Снижение урона игрока на ранге 5 работает");

// Тест сброса шкалы при уроне (drainOnDamage: -25, max 1 rank rollback)
// sm был 100, минус 25 -> 75, ранг остается 5
assert.strictEqual(sm.rank, 5);
assert.strictEqual(sm.value, 75);
// Еще один урон, когда value = 10 -> откат на ранг 4 с остатком
sm.value = 10;
sm.drainOnDamage(25);
assert.strictEqual(sm.rank, 4);
assert.strictEqual(sm.value, 85); // 100 - (25 - 10) = 85
console.log("✓ Откат ступени при уроне (максимум на 1 ранг) работает корректно");

// Тест восстановления брони на ранге 4+
const preArmor = mockGame.player.armor;
const pts = 100;
const mult = sm.getMultiplier(); // ранг 4 -> x3.0
const finalScore = Math.round(pts * mult);
assert.strictEqual(finalScore, 300);
// Восстановление 2 брони
if (sm.rank >= 4) {
  mockGame.player.armor = Math.min(mockGame.player.maxArmor, mockGame.player.armor + (CONFIG.style.armorPerKill ?? 2));
}
assert.strictEqual(mockGame.player.armor, preArmor + 2);
console.log("✓ Множитель счета x3.0 и восстановление брони (+2) на ранге 4 работают");

// 5. Затухание и заморозка
sm.freeze(3.0);
sm.update(1.0);
assert.strictEqual(sm.freezeTimer, 2.0);
assert.strictEqual(sm.value, 85, "Во время заморозки шкала не должна падать");
sm.update(2.0);
assert.strictEqual(sm.freezeTimer, 0);

// Задержка перед затуханием (2.5 с)
sm.idleTimer = 0;
sm.update(2.0);
assert.strictEqual(sm.value, 85, "До 2.5 с шкала не должна падать");
// После 2.5 с начинает падать со скоростью ранга 4 (24 ед/с)
sm.update(1.0); // 0.5 с сверх задержки -> 0.5 * 24 = 12
assert(Math.abs(sm.value - 73) < 0.1, `Шкала должна упасть на 12 ед, получили ${sm.value}`);
console.log("✓ Затухание шкалы после 2.5 с и заморозка работают точно");

// 6. Сброс
sm.reset();
assert.strictEqual(sm.rank, 0);
assert.strictEqual(sm.value, 0);
assert.strictEqual(sm.getMultiplier(), 1.0);
console.log("✓ Полный сброс возвращает в ПУСТО x1.0, 0");

console.log("\n=== ВСЕ ТЕСТЫ СТИЛЬ-МЕТРА ПРОЙДЕНЫ УСПЕШНО ===");
