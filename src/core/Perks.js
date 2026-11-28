// Перки между уровнями: каталог в CONFIG.perks, накопление за забег
// и единые модификаторы для игрока, оружия, подбора и эффектов.
import { CONFIG } from "../config.js";

function baseMods() {
  return {
    moveSpeedMult: 1,
    jumpHeightMult: 1,
    dashCharges: 1,
    maxHealthBonus: 0,
    gloryHeal: 0,
    armorPerKill: 0,
    barrelImmune: false,
    styleDecayMult: 1,
    pickupRadiusMult: 1,
    lastChance: false,
    vodkaDefense: 0,
    vodkaTime: 0,
    jointTime: 0,
    shotgunDamageMult: 1,
    ak47CooldownMult: 1,
    rocketAmmoBonus: 0,
    rocketRadiusMult: 1
  };
}

export class PerkManager {
  /**
   * @param {Object} game
   */
  constructor(game) {
    this.game = game;
    this.counts = new Map();
    this.mods = baseMods();
    this._prevDashMax = 1;
    this._snapshotBase();
  }

  /** Запомнить базовые значения CONFIG, чтобы корректно откатывать перки. */
  _snapshotBase() {
    this._base = {
      shotgunDamage: CONFIG.weapons.shotgun.damage,
      ak47Cooldown: CONFIG.weapons.ak47.cooldown,
      rocketMaxAmmo: CONFIG.weapons.rocket.maxAmmo,
      rocketRadius: CONFIG.weapons.rocket.explosionRadius,
      pickupRadius: CONFIG.pickups.pickupRadius,
      magnetRadius: CONFIG.pickups.magnetRadius,
      playerMaxHealth: CONFIG.player.maxHealth
    };
  }

  get maxStacks() {
    return CONFIG.run?.perkMaxStacks ?? 3;
  }

  /** Максимум копий конкретного перка (по умолчанию из CONFIG.run). */
  maxFor(id) {
    const def = this.getDef(id);
    return def?.maxStacks ?? this.maxStacks;
  }

  getDef(id) {
    return (CONFIG.perks || []).find((p) => p.id === id) || null;
  }

  getCount(id) {
    return this.counts.get(id) || 0;
  }

  canTake(id) {
    const def = this.getDef(id);
    if (!def) return false;
    return this.getCount(id) < this.maxFor(id);
  }

  /** Полный сброс: смерть, новый забег, выход в меню. */
  reset() {
    this.counts.clear();
    this.mods = baseMods();
    this._restoreBase();
    this._prevDashMax = 1;

    const p = this.game.player;
    if (p) {
      p.mods = this.mods;
      p.maxHealth = this._base.playerMaxHealth;
      if (p.health > p.maxHealth) p.health = p.maxHealth;
      p.dashChargesMax = 1;
      p.dashCharges = 1;
      p.jumpHeightMult = 1;
    }
    if (this.game.styleMeter) {
      this.game.styleMeter.decayMult = 1;
    }
    if (this.game.hud && this.game.hud.overlays) {
      this.game.hud.overlays.setPerks([]);
    }
  }

  /** Вернуть изменяемые значения CONFIG к базовым. */
  _restoreBase() {
    const b = this._base;
    if (!b) return;
    CONFIG.weapons.shotgun.damage = b.shotgunDamage;
    CONFIG.weapons.ak47.cooldown = b.ak47Cooldown;
    CONFIG.weapons.rocket.maxAmmo = b.rocketMaxAmmo;
    CONFIG.weapons.rocket.explosionRadius = b.rocketRadius;
    CONFIG.pickups.pickupRadius = b.pickupRadius;
    CONFIG.pickups.magnetRadius = b.magnetRadius;

    // Текущий боезапас не должен превышать уменьшившийся максимум.
    const weapons = this.game.weapons || [];
    for (const w of weapons) {
      if (w.ammo > w.cfg.maxAmmo) w.ammo = w.cfg.maxAmmo;
    }
  }

  /**
   * Добавить перк.
   * @param {string} id
   * @returns {boolean}
   */
  add(id) {
    if (!this.canTake(id)) return false;
    this.counts.set(id, this.getCount(id) + 1);
    this.recompute();

    const def = this.getDef(id);
    const heal = def?.mods?.healOnPick || 0;
    if (heal > 0 && this.game.player && !this.game.player.isDead) {
      const p = this.game.player;
      p.health = Math.min(p.maxHealth, p.health + heal);
    }

    // «Ракета-кассета»: выдать +4 ракеты к текущему боезапасу (потолок maxAmmo)
    if (id === "rocket_cassette") {
      const rocket = this.game.weapons?.find((w) => w.id === "rocket");
      if (rocket) {
        rocket.ammo = Math.min(rocket.cfg.maxAmmo, rocket.ammo + 4);
      }
    }
    return true;
  }

  /** Собрать 3 (или меньше) случайных доступных перка. */
  roll(count = CONFIG.run?.perkChoices ?? 3) {
    const pool = (CONFIG.perks || []).filter((p) => this.canTake(p.id));
    const picked = [];
    while (picked.length < count && pool.length > 0) {
      let total = 0;
      for (const p of pool) total += p.rarity === "rare" ? 0.6 : 1;
      let r = Math.random() * total;
      let idx = 0;
      for (; idx < pool.length; idx++) {
        r -= pool[idx].rarity === "rare" ? 0.6 : 1;
        if (r <= 0) break;
      }
      idx = Math.min(idx, pool.length - 1);
      picked.push(pool.splice(idx, 1)[0]);
    }
    return picked;
  }

  randomAvailable() {
    const list = this.roll(1);
    return list.length > 0 ? list[0] : null;
  }

  /** Пересчитать все модификаторы из накопленных копий. */
  recompute() {
    const mods = baseMods();
    for (const [id, count] of this.counts) {
      switch (id) {
        case "light_legs":
          mods.moveSpeedMult *= 1 + 0.08 * count;
          break;
        case "double_dash":
          mods.dashCharges += count;
          break;
        case "shotgun_beast":
          mods.shotgunDamageMult *= 1 + 0.25 * count;
          break;
        case "kalash_storm":
          mods.ak47CooldownMult /= Math.pow(1.2, count);
          break;
        case "rocket_cassette":
          mods.rocketAmmoBonus += 4 * count;
          mods.rocketRadiusMult *= 1 + 0.3 * count;
          break;
        case "thick_skin":
          mods.maxHealthBonus += 15 * count;
          break;
        case "vampire":
          mods.gloryHeal += 15 * count;
          break;
        case "magnet":
          mods.pickupRadiusMult *= 1 + 0.5 * count;
          break;
        case "last_chance":
          mods.lastChance = true;
          break;
        case "armor_for_blood":
          mods.armorPerKill += count;
          break;
        case "barrel_friend":
          mods.barrelImmune = true;
          break;
        case "stylish":
          mods.styleDecayMult *= Math.pow(0.7, count);
          break;
        case "jumper":
          mods.jumpHeightMult *= 1 + 0.15 * count;
          break;
        case "drunk_master":
          mods.vodkaDefense += 0.2 * count;
          mods.vodkaTime += 5 * count;
          mods.jointTime += 5 * count;
          break;
        default:
          break;
      }
    }

    this.mods = mods;
    const b = this._base;

    // Игрок
    const p = this.game.player;
    if (p) {
      p.mods = mods;
      p.maxHealth = b.playerMaxHealth + mods.maxHealthBonus;
      if (p.health > p.maxHealth) p.health = p.maxHealth;
      p.dashChargesMax = mods.dashCharges;
      if (mods.dashCharges > this._prevDashMax) {
        p.dashCharges = mods.dashCharges;
      }
      p.dashCharges = Math.min(p.dashCharges ?? 1, p.dashChargesMax);
      this._prevDashMax = p.dashChargesMax;
      p.jumpHeightMult = mods.jumpHeightMult;
    }

    // Оружие (cfg читается в момент выстрела)
    CONFIG.weapons.shotgun.damage = b.shotgunDamage * mods.shotgunDamageMult;
    CONFIG.weapons.ak47.cooldown = b.ak47Cooldown * mods.ak47CooldownMult;
    CONFIG.weapons.rocket.maxAmmo = b.rocketMaxAmmo + mods.rocketAmmoBonus;
    CONFIG.weapons.rocket.explosionRadius = b.rocketRadius * mods.rocketRadiusMult;

    // Подбор и магнит
    CONFIG.pickups.pickupRadius = b.pickupRadius * mods.pickupRadiusMult;
    CONFIG.pickups.magnetRadius = b.magnetRadius * mods.pickupRadiusMult;

    // Стиль
    if (this.game.styleMeter) {
      this.game.styleMeter.decayMult = mods.styleDecayMult;
    }

    if (this.game.hud && this.game.hud.overlays) {
      this.game.hud.overlays.setPerks(this.entries());
    }
  }

  /** Список взятых перков для HUD и итогового экрана. */
  entries() {
    const out = [];
    for (const def of CONFIG.perks || []) {
      const count = this.getCount(def.id);
      if (count > 0) out.push({ ...def, count });
    }
    return out;
  }
}
