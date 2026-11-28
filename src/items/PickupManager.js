// Менеджер подбираемых предметов: стартовый спавн, выпадение лута при смерти врагов и очистка
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { rnd } from "../core/Physics.js";
import { Pickup } from "./Pickup.js";

export class PickupManager {
  /**
   * @param {THREE.Scene} scene
   * @param {Object} game
   */
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.pickups = [];
  }

  /**
   * Спавн стартовых предметов на арене или в комнатах процедурного уровня
   */
  spawnStartPickups() {
    this.clear();

    const world = this.game ? this.game.world : null;
    if (world && world.startRoom) {
      // Предметы в стартовой комнате
      const sc = world.startRoom.center;
      this.spawnAt(sc.x - 3.0, 0, sc.z - 3.0, "medkit");
      this.spawnAt(sc.x + 3.0, 0, sc.z - 3.0, "ammo_shotgun");
      this.spawnAt(sc.x - 3.0, 0, sc.z + 3.0, "ammo_ak47");
      this.spawnAt(sc.x + 3.0, 0, sc.z + 3.0, "armor");

      // Предметы в комнатах типа loot: 4–6 штук на полу и на постаментах, без охраны
      for (const room of world.rooms) {
        if (room.type === "loot") this.spawnLootRoom(room);
      }
      return;
    }

    const spawns = CONFIG.pickups.initialSpawns;

    for (const c of spawns.medkits) {
      this.spawnAt(c[0], c[1], c[2], "medkit");
    }

    for (const c of spawns.armor) {
      this.spawnAt(c[0], c[1], c[2], "armor");
    }

    for (const c of spawns.shotgunAmmo) {
      this.spawnAt(c[0], c[1], c[2], "ammo_shotgun");
    }

    for (const c of spawns.ak47Ammo) {
      this.spawnAt(c[0], c[1], c[2], "ammo_ak47");
    }

    for (const c of spawns.rocketAmmo) {
      this.spawnAt(c[0], c[1], c[2], "ammo_rocket");
    }
  }

  /**
   * Лут-комната: 4–6 предметов, часть на постаментах, часть на полу
   * @param {Object} room
   */
  spawnLootRoom(room) {
    const pool = ["medkit", "armor", "ammo_shotgun", "ammo_ak47", "ammo_rocket"];
    const count = 4 + Math.floor(Math.random() * 3); // 4–6
    const c = room.center;
    let placed = 0;

    // Два постамента в центре комнаты (см. Room.buildLootPedestals)
    const pedestals = [
      { x: c.x - 2.5, y: 0.8, z: c.z },
      { x: c.x + 2.5, y: 0.8, z: c.z }
    ];
    for (const p of pedestals) {
      if (placed >= count) break;
      this.spawnAt(p.x, p.y, p.z, pool[Math.floor(Math.random() * pool.length)]);
      placed++;
    }

    // Остальные — на полу по углам/периметру, не задевая постаменты
    const spots = [
      { x: c.x - 4.5, z: c.z - 4.5 },
      { x: c.x + 4.5, z: c.z - 4.5 },
      { x: c.x - 4.5, z: c.z + 4.5 },
      { x: c.x + 4.5, z: c.z + 4.5 },
      { x: c.x, z: c.z - 4.8 },
      { x: c.x, z: c.z + 4.8 }
    ];
    for (const s of spots) {
      if (placed >= count) break;
      this.spawnAt(s.x, 0, s.z, pool[Math.floor(Math.random() * pool.length)]);
      placed++;
    }

    // Дополнительно 2–3 расходника на полу
    const cc = CONFIG.drops.consumables;
    if (cc) {
      const n = Math.max(
        0,
        cc.lootRoomMin + Math.floor(Math.random() * (cc.lootRoomMax - cc.lootRoomMin + 1))
      );
      const extras = [
        { x: c.x - 1.6, z: c.z + 2.2 },
        { x: c.x + 1.6, z: c.z + 2.2 },
        { x: c.x - 1.6, z: c.z - 2.2 },
        { x: c.x + 1.6, z: c.z - 2.2 }
      ];
      for (let i = 0; i < n && i < extras.length; i++) {
        this.spawnAt(extras[i].x, 0, extras[i].z, this.randomConsumableType());
      }
    }
  }

  /** Случайный тип расходника. */
  randomConsumableType() {
    return Math.random() < 0.5 ? "vodka" : "joint";
  }

  /**
   * Вспомогательный спавн неподвижного парящего предмета
   */
  spawnAt(x, y, z, type) {
    const p = new Pickup(this.scene, type, x, y, z, new THREE.Vector3(0, 0, 0));
    p.hovering = true;
    p.hoverBaseY = y + 0.35;
    this.pickups.push(p);
    return p;
  }

  /**
   * Выпадение предметов из поверженного врага
   * @param {THREE.Vector3} pos
   * @param {boolean} isGloryKill
   * @param {boolean} wasStunned
   */
  spawnDrops(pos, isGloryKill, wasStunned) {
    const cc = CONFIG.drops.consumables;
    const dropMult = this.game?.difficultyCfg?.dropChanceMult ?? 1;

    const addP = (type, vx, vy, vz) => {
      if (this.pickups.length >= CONFIG.pickups.maxActive) {
        const oldest = this.pickups.shift();
        oldest.destroy();
      }
      const p = new Pickup(this.scene, type, pos.x, pos.y + 0.8, pos.z, new THREE.Vector3(vx, vy, vz));
      this.pickups.push(p);
    };

    if (isGloryKill) {
      // При добивании: аптечки, патроны к наиболее исчерпанному оружию и шанс брони
      for (let i = 0; i < CONFIG.drops.gloryMedkits; i++) {
        addP("medkit", (i === 0 ? -1.2 : 1.2) + rnd(0.2), 4.2, rnd(1));
      }

      const wpns = this.game.weapons || (this.game.weaponManager ? this.game.weaponManager.weapons : (this.game.combat ? this.game.combat.weapons : []));
      let minRatio = wpns[0].ammo / wpns[0].cfg.maxAmmo;
      let minType = "ammo_shotgun";

      if (wpns[1].ammo / wpns[1].cfg.maxAmmo < minRatio) {
        minRatio = wpns[1].ammo / wpns[1].cfg.maxAmmo;
        minType = "ammo_ak47";
      }
      if (wpns[2].ammo / wpns[2].cfg.maxAmmo < minRatio) {
        minType = "ammo_rocket";
      }
      for (let i = 0; i < CONFIG.drops.gloryAmmo; i++) {
        addP(minType, rnd(1), 4.5, -1.2 - i * 0.4);
      }

      if (Math.random() < CONFIG.drops.gloryArmorChance * dropMult) {
        addP("armor", rnd(1), 4.8, 1.2);
      }

      // Расходник из добитого врага
      if (cc && Math.random() < cc.gloryChance * dropMult) {
        addP(this.randomConsumableType(), rnd(1.2), 5.0, rnd(1.2));
      }
    } else {
      const styleBonus = this.game?.styleMeter ? this.game.styleMeter.getDropBonus() : 0;
      const baseAmmoChance = wasStunned ? CONFIG.drops.stunnedKillChance : CONFIG.drops.normalAmmoChance;
      const ammoChance = Math.min(1.0, (baseAmmoChance + styleBonus) * dropMult);
      if (Math.random() < ammoChance) {
        const ammoTypes = ["ammo_shotgun", "ammo_ak47", "ammo_rocket"];
        addP(ammoTypes[Math.floor(Math.random() * ammoTypes.length)], rnd(1.2), 3.8, rnd(1.2));
      }

      const baseHpChance = wasStunned ? CONFIG.drops.stunnedHpChance : CONFIG.drops.normalHpChance;
      const hpChance = Math.min(1.0, (baseHpChance + styleBonus) * dropMult);
      if (Math.random() < hpChance) {
        addP("medkit", rnd(1.2), 3.8, rnd(1.2));
      }

      // Расходник из обычного врага
      if (cc && Math.random() < cc.normalChance * dropMult) {
        addP(this.randomConsumableType(), rnd(1.2), 3.8, rnd(1.2));
      }
    }
  }

  /**
   * Награда за зачистку арены: 2 расходника у центра арены.
   * @param {Object} arena
   */
  spawnArenaClearConsumables(arena) {
    const cc = CONFIG.drops.consumables;
    if (!cc) return;
    const room = arena && (arena.room || arena);
    const center = room && room.center ? room.center : null;
    const fallback = this.game && this.game.player ? this.game.player.pos : null;
    const c = center || fallback;
    if (!c) return;

    const count = Math.max(0, cc.arenaClear ?? 2);
    for (let i = 0; i < count; i++) {
      const angle = (i / Math.max(1, count)) * Math.PI * 2 + Math.random() * 0.6;
      const radius = 2.0 + Math.random() * 1.5;
      this.spawnAt(
        c.x + Math.cos(angle) * radius,
        0,
        c.z + Math.sin(angle) * radius,
        this.randomConsumableType()
      );
    }
  }

  /**
   * Спавн произвольного предмета в заданной позиции (например, 30% дроп робота)
   * @param {THREE.Vector3} pos
   * @param {string} type
   */
  spawnCustomDrop(pos, type) {
    if (this.pickups.length >= CONFIG.pickups.maxActive) {
      const oldest = this.pickups.shift();
      oldest.destroy();
    }
    const p = new Pickup(this.scene, type, pos.x, pos.y + 0.8, pos.z, new THREE.Vector3(rnd(1.2), 3.8, rnd(1.2)));
    this.pickups.push(p);
    return p;
  }

  update(dt, player, fx) {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.update(dt, player, this.game, fx);
      if (!p.alive) {
        this.pickups.splice(i, 1);
      }
    }
  }

  onModelsReady() {
    for (const p of this.pickups) {
      if (p && p.refreshAmmoModel) p.refreshAmmoModel();
    }
  }

  clear() {
    for (const p of this.pickups) {
      p.destroy();
    }
    this.pickups = [];
  }
}
