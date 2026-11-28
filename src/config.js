  // Конфигурация игры: параметры мира, игрока, оружия, врагов, добиваний, предметов и эффектов

export const CONFIG = {
  // Графика: качество, пост-обработка и процедурные материалы
  graphics: {
    // Режим по умолчанию (low | medium | high)
    mode: "high",
    storageKey: "fps_graphics_quality",
    // Стиль графики: "psx" (ретро-хоррор PS1) или "cartoon" (мультяшный)
    styleName: "psx",
    styleStorageKey: "fps_graphics_style",
    // Высота пиксельного буфера (240 | 360 | 480 | null для выкл)
    pixelHeight: 360,
    pixelHeightStorageKey: "fps_pixel_height",
    // Рендеринг оружия в руках: true (внутри EffectComposer через OverlayPass) | false (поверх композера)
    weaponInComposer: false,
    weaponInComposerStorageKey: "fps_weapon_in_composer",
    // Дрожание вершин PS1 (0: выкл, 1: слабо, 2: сильно)
    vertexSnap: 1,
    vertexSnapStorageKey: "fps_vertex_snap",
    // Зернистость (film grain) PS1
    grainEnabled: true,
    grainStorageKey: "fps_grain_enabled",
    grainStrength: 0.04,
    // Мерцание ламп в комнатах
    flickerEnabled: true,
    flickerStorageKey: "fps_flicker_enabled",
    // Яркость PSX пост-прохода (слайдер в меню 0.7 - 1.8)
    brightness: 1.2,
    brightnessStorageKey: "fps_brightness",
    contrast: 1.05,
    gamma: 0.9,
    lift: 0.04,
    // Фиксированный пул точечных источников света (требование 2.1: постоянное число света в сцене)
    maxPointLights: 6,
    // Общий свет
    hemiIntensity: 1.0,
    ambientIntensity: 0.25,
    dirIntensity: 0.6,
    // Квантование и дизеринг (число уровней на канал)
    colorLevels: 32,
    ditherStrength: 1.0,
    // Стиль отображения зомби: "toon" (мультяшный MeshToonMaterial с контуром) или "pbr" (MeshStandardMaterial из glTF)
    zombieStyle: "pbr",
    zombieStyleStorageKey: "fps_zombie_style",
    // Пресеты стилей
    style: {
      psx: {
        toon: false,
        outlines: false,
        pixelHeight: 360,
        colorLevels: 32,
        ditherStrength: 1.0,
        grainStrength: 0.04,
        vertexSnap: 1,
        bloomStrength: 0.35,
        bloomRadius: 0.35,
        bloomThreshold: 0.85,
        ambientMultiplier: 1.0,
        sunMultiplier: 1.0,
        hitFlashColor: 0xfff4c0,
        bloodColor: 0x660a14,
        slimeColor: 0x2e4a18,
        fogDensity: 0.014
      },
      cartoon: {
        toon: true,
        outlines: true,
        pixelHeight: null,
        colorLevels: 256,
        ditherStrength: 0.0,
        grainStrength: 0.0,
        vertexSnap: 0,
        bloomStrength: 0.5,
        bloomRadius: 0.4,
        bloomThreshold: 0.85,
        ambientMultiplier: 1.0,
        sunMultiplier: 1.0,
        hitFlashColor: 0xffffff,
        bloodColor: 0xb81414,
        slimeColor: 0x44cc22,
        fogDensity: 0.012
      }
    },
    // Bloom: сила, радиус, порог (CONFIG.graphics.bloom)
    bloom: {
      strength: 0.35,
      radius: 0.35,
      threshold: 0.85
    },
    // Виньетка: слабее до 0.25
    vignette: {
      strength: 0.25,
      softness: 0.45
    },
    // Настройки режимов качества
    modes: {
      low: {
        bloom: false,
        bloomScale: 0.5,
        textures: false,
        pixelRatio: 1,
        vignette: true,
        dither: false,
        vertexSnap: 0
      },
      medium: {
        bloom: true,
        bloomScale: 0.5,
        textures: true,
        pixelRatio: 1,
        vignette: true,
        dither: true,
        vertexSnap: 0
      },
      high: {
        bloom: true,
        bloomScale: 1,
        textures: true,
        pixelRatio: 1,
        vignette: true,
        dither: true,
        vertexSnap: 1
      }
    },
    // Автоснижение: средний FPS за окно (сек) ниже порога
    autoDowngrade: {
      window: 5,
      fpsThreshold: 40
    }
  },

  // Процедурная генерация уровня
  level: {
    gridSize: 4,          // сетка 4x4 ячеек
    cellSize: 64,         // размер ячейки 64x64 м (арена до 56 м + стены)
    minRooms: 7,          // мин. число комнат
    maxRooms: 10,         // макс. число комнат
    corridorWidth: 6.0,   // ширина коридора (м)
    corridorHeight: 5.0,  // высота коридора (м)
    wallThickness: 1.0,   // толщина стен комнат и коридоров (м)
    maxStepHeight: 1.8,   // макс. шаг по высоте для двойного прыжка (правило достижимости)
    stepUpHeight: 0.5,    // макс. уступ, на который игрок поднимается без прыжка (м)
    minPassageWidth: 4.0, // мин. свободный проход между препятствиями (м)
    blockClearance: 1.5,  // мин. расстояние от блоков до стен и между блоками
    doorClearance: 6.0,   // свободная зона перед проёмами (м)
    centerClearance: 8.0, // свободная зона в центре арены (м)
    arenaMinSize: 44,     // мин. размер арены (м)
    arenaMaxSize: 56,     // макс. размер арены (м)
    arenaMinHeight: 12,   // мин. высота потолка арены (м)
    arenaMaxHeight: 16,   // макс. высота потолка арены (м)
    arenaMinBlocks: 6,    // мин. количество блоков на арене
    arenaMaxBlocks: 12,   // макс. количество блоков на арене
    pitDepth: 4,          // глубина ямы (м)
    pitDamage: 10,        // урон при падении в яму
    worldFloorY: -8,      // страховочный «пол» мира ниже уровня ям
    // Визуальный декор комнат (без коллайдеров): плотность и вероятности
    decor: {
      enabled: true,
      density: 1.0,          // общий множитель плотности декора
      flickerChance: 0.2,    // доля комнат с мигающими лампами
      floorTile: 6.0,        // размер тайла напольного узора (м)
      pipes: 2,              // трубы на стенах (шт. на комнату)
      panels: 3,             // панели на стенах
      signs: 1.5,            // плакаты-табло
      lamps: 3,              // светильники на потолке
      vents: 2,              // вентиляционные решётки
      puddles: 2.5,          // лужи на полу
      stains: 2.5,           // пятна на полу
      papers: 5,             // разбросанные бумаги
      markings: 3,           // декали разметки
      props: 2.5             // тематические объекты (столы/ящики/стойки/резервуары)
    },
    roomTypes: {
      start: { w: 18, d: 18, h: 8, color: 0x38b000, wallColor: 0x2ee6d6, name: "Старт" },
      loot:  { w: 16, d: 16, h: 8, color: 0xffd23f, wallColor: 0xff9f1c, name: "Склад" },
      arena: { w: 48, d: 48, h: 14, color: 0xff4f8b, wallColor: 0x7c5cff, name: "Арена" },
      exit:  { w: 24, d: 24, h: 12, color: 0x4cc9f0, wallColor: 0x4361ee, name: "Выход" }
    }
  },

  // Мир
  world: {
    roomSize: 40,
    wallHeight: 10,
    wallThickness: 2,
    fogColor: 0x2a3430,
    fogNear: 25,
    fogFar: 70,
    fogDensity: 0.014, // базовая плотность FogExp2 (видимость ~55-70 м, серо-зелёный туман)
    floorTileSize: 128,
    floorTileRepeat: 10, // roomSize / 4
    hemisphereLight: {
      skyColor: 0x8fa0a8,
      groundColor: 0x3a3f42,
      intensity: 1.0
    },
    ambientLight: {
      color: 0xffffff,
      intensity: 0.25
    },
    sunLight: {
      color: 0xffffff,
      intensity: 0.6,
      x: 10,
      y: 25,
      z: 8
    },
    wallColors: [0x424944, 0x4a3628, 0x161a24, 0x2b3323],
    outlineColor: 0x1b1340,
    obstacles: [
      { x: -10, z: -8, w: 4, h: 1, d: 4, color: 0xff9f1c },
      { x: -4, z: -12, w: 4, h: 2, d: 4, color: 0x7c5cff },
      { x: 4, z: -12, w: 4, h: 3, d: 4, color: 0xff4f8b },
      { x: 12, z: -8, w: 4, h: 4.5, d: 4, color: 0x2ee6d6 },
      { x: 12, z: 2, w: 6, h: 1.5, d: 3, color: 0x8ae234 },
      { x: -12, z: 6, w: 3, h: 2.5, d: 8, color: 0xffd23f },
      { x: 0, z: -2, w: 6, h: 0.6, d: 6, color: 0x4da3ff },
      { x: 0, z: -2, w: 2.5, h: 1.2, d: 2.5, color: 0xff4f8b, y: 0.6 },
      { x: -16, z: 16, w: 1.5, h: 6, d: 1.5, color: 0x7c5cff },
      { x: 16, z: 16, w: 1.5, h: 6, d: 1.5, color: 0x7c5cff }
    ],
    targets: [
      { x: -15, y: 0, z: 15, color: 0xff4f8b },
      { x: -15, y: 0, z: 11, color: 0x7c5cff }
    ]
  },

  // Игрок
  player: {
    health: 100,
    maxHealth: 100,
    armor: 0,
    maxArmor: 100,
    radius: 0.4,
    height: 1.8,
    eyeHeight: 1.62,
    spawn: { x: 0, z: 15 },
    invulnTime: 0.2,
    armorAbsorptionRatio: 0.66,
    lowHpThreshold: 25,
    vignetteTime: 0.3,
    dmgIndicatorTime: 0.65,
    shakeAmpOnDamage: 0.045,
    shakeDurOnDamage: 0.28,
    deathCamFallSpeed: 4.5,
    deathCamMinY: 0.25,
    deathCamLerpSpeed: 2.5,
    recoilDampSpeed: 9,
    collisionSubstepDist: 0.2,
    collisionEps: 0.0005
  },

  // Движение
  movement: {
    moveSpeed: 14,
    groundAccel: 160,
    airAccel: 70,
    gravity: 42,
    jumpHeight: 2.2,
    maxJumps: 2,
    maxFallSpeed: 55
  },

  // Рывок
  dash: {
    dashSpeed: 40,
    dashDuration: 0.17,
    dashCooldown: 1.5,
    airYFactor: 0.3,
    dashFov: 108
  },

  // Стиль-метр (комбо-система)
  style: {
    ranks: [
      { name: "ПУСТО", mult: 1.0, color: "#888888", decay: 6 },
      { name: "РАЗМИНКА", mult: 1.2, color: "#e2e8f0", decay: 9 },
      { name: "ЖЁСТКО", mult: 1.5, color: "#facc15", decay: 13 },
      { name: "КРОВАВО", mult: 2.0, color: "#fb923c", decay: 18 },
      { name: "БЕЗУМИЕ", mult: 3.0, color: "#ef4444", decay: 24 },
      { name: "БОГ", mult: 4.0, color: "#f43f5e", decay: 24 }
    ],
    points: {
      kill: 8,
      headshot: 6,
      glory: 20,
      inAir: 6,
      explosion: 8,
      multikill: 15,
      switchWeapon: 5,
      quickKill: 4
    },
    decayDelay: 2.5,
    decayRates: [6, 9, 13, 18, 24, 24],
    damageDrain: 25,
    dropBonusPerRank: 0.04,
    maxDropBonus: 0.25,
    armorPerKill: 2,
    godDamageReduction: 0.10,
    weaponEmissiveMax: 0.25,
    multikillWindow: 1.2,
    quickKillWindow: 1.5
  },

  // Камера
  camera: {
    fov: 77,
    fovStorageKey: "fps_fov",
    gloryFov: 74,
    fovLerp: 14,
    mouseSensitivity: 0.0022,
    near: 0.15,
    far: 160
  },

  // Враги
  enemies: {
    meleeMaxHeightDiff: 1.3,
    unreachable: {
      heightThreshold: 1.5,      // порог разницы высот, при котором игрок считается недосягаемым (м)
      ringMinDist: 2.0,          // минимальная дистанция от основания блока (м)
      ringMaxDist: 3.5,          // максимальная дистанция от основания блока (м)
      speedFactor: 0.3,          // скорость перемещения по кольцу (30% от обычной)
      checkInterval: 1.0,        // интервал проверки досягаемости игрока (с)
      stopDurationMin: 1.5,      // минимальное время остановки для рычания/взгляда вверх (с)
      stopDurationMax: 2.8,      // максимальное время остановки (с)
      moveDurationMin: 2.0,      // минимальное время перемещения к новой точке кольца (с)
      moveDurationMax: 4.0       // максимальное время перемещения (с)
    },
    zombie: {
      health: 60,
      speed: 4.5,
      speedVar: 0.15,
      damage: 12,
      attackRange: 1.6,
      attackCooldown: 0.9,
      attackWindup: 0.35,
      scoreValue: 100,
      headshotBonus: 50,
      aggroRange: 35,
      alertRadius: 20,
      staggerTime: 0.18,
      stuckCheckInterval: 0.8,
      stuckMinMoveDist: 0.25,
      sidestepDuration: 0.6,
      separationDist: 0.9,
      separationPushForce: 3.5,
      hitboxRadius: 0.42,
      hitboxHeight: 1.9,
      collisionEps: 0.001,

      // Визуальная 3D-модель (public/models/zombie.glb)
      model: {
        path: "/models/zombie.glb",
        height: 2.0,                  // целевая высота модели (тело с головой под хитбокс)
        rawHeight: 1.85,               // базовая высота исходного SkinnedMesh в glb
        rotationY: 0,                  // поворот внутри группы (модель смотрит в +Z, yaw 0 = +Z)
        offsetY: 0,                    // смещение по высоте Y (ступни на полу y = 0)
        toonColorMultiplier: 1.15,     // множитель цвета в режиме toon для мультяшного стиля
        outlineThickness: 0.018,       // толщина инвертированного контура вдоль нормалей
        clips: {
          idle: { clipName: "ZombieWalk", timeScale: 0.25 },
          chase: { clipName: "ZombieRun", baseSpeed: 1.619, minScale: 1.2, maxScale: 3.2 },
          attack: {
            swipe: { clipName: "ZombieSwipe", hitTime: 0.948 },
            bite: { clipName: "ZombieBite", hitTime: 0.82 }
          },
          stagger: { clipName: "ZombieStumble", timeScale: 4.0 },
          stunned: { clipName: "ZombieStumble" },
          unreachable: { clipName: "ZombieWalk", timeScale: 0.5 }
        }
      }
    },

    // Мутант — крупный враг с прыжковой атакой и ударом по земле
    mutant: {
      health: 220,
      speed: 6,
      speedVar: 0.1,
      leapDamage: 20,          // урон при приземлении прыжка
      slamDamage: 25,           // урон удара по земле
      scoreValue: 250,
      headshotBonus: 100,
      aggroRange: 40,
      alertRadius: 25,
      staggerTime: 0.14,        // короткий стаггер (сопротивление)
      knockbackResist: 0.7,     // 70% сопротивления отбрасыванию
      bloodColor: 0x2e4a18,     // тёмная болотно-зелёная слизь

      // Прыжок (leap)
      leapMinDist: 5,           // мин. дистанция для прыжка (м)
      leapMaxDist: 14,          // макс. дистанция для прыжка (м)
      leapWindup: 0.5,          // пауза-замах перед прыжком (с)
      leapSpeed: 18,            // скорость полёта по дуге (м/с → определяет длительность)
      leapArcHeight: 5.5,       // высота дуги над стартом (м), хватает на блок 4.5 м
      leapDamageRadius: 2.5,    // радиус урона при приземлении (м)
      leapCooldown: 4.0,        // перезарядка прыжка (с)

      // Удар по земле (slam)
      slamRange: 3.2,           // макс. дистанция для начала slam-атаки (м)
      slamWindup: 0.6,          // замах перед ударом (с)
      slamRadius: 3.5,          // радиус AoE-урона (м)
      slamKnockback: 14,        // сила отбрасывания игрока
      slamRecovery: 0.4,        // время восстановления после удара (с)
      slamCooldown: 1.0,        // перезарядка удара (с)

      // Хитбокс (1.5x от зомби)
      hitboxRadius: 0.63,
      hitboxHeight: 3.0,
      hitboxBodyTop: 2.2,       // верх тела / низ головы
      hitboxHeadRadius: 0.42,
      collisionEps: 0.001,

      // Расталкивание
      separationDist: 1.4,
      separationPushForce: 4.0,

      // Куски при смерти
      gibsNormal: 16,           // обычная смерть
      gibsHeadshot: 18,         // хедшот
      gibsGlory: 18,            // добивание

      // Спавн
      startWave: 3,             // мутанты появляются с 3-й волны
      perZombies: 4,            // 1 мутант на каждые 4 зомби
      maxAlive: 4               // не больше 4 одновременно
    },

    // Робот — летающий дрон-шар с лазерными залпами
    robot: {
      health: 130,
      speed: 5,
      speedVar: 0.1,
      damage: 10,               // урон лазерного снаряда
      scoreValue: 150,
      headshotBonus: 50,        // бонус за попадание в глаз-линзу
      aggroRange: 45,
      alertRadius: 25,
      preferredDistMin: 12,     // предпочтительная дистанция мин (м)
      preferredDistMax: 20,     // предпочтительная дистанция макс (м)
      tooCloseDist: 10,         // если ближе 10 м — отлетает назад
      tooFarDist: 22,           // если дальше 22 м — приближается
      flightHeightMin: 1.5,     // мин. высота полёта над полом (м)
      flightHeightMax: 3.5,     // макс. высота полёта над полом (м)
      elevatedPlayerOffset: 1.0,// превышение над игроком на блоке (+1 м)
      strafeIntervalMin: 1.5,   // интервал смены направления стрейфа мин (с)
      strafeIntervalMax: 3.0,   // интервал смены направления стрейфа макс (с)
      chargeDuration: 0.8,      // время зарядки лазера (с)
      burstCount: 3,            // количество выстрелов в очереди
      burstInterval: 0.15,      // интервал между выстрелами (с)
      attackCooldown: 2.2,      // перезарядка между залпами (с)
      projectileSpeed: 38,      // скорость лазерного снаряда
      projectileRadius: 0.15,   // радиус снаряда для коллизий
      projectileLife: 3.0,      // время жизни снаряда (с)
      staggerTime: 0.18,        // время стаггера (с)
      staggerPushDist: 1.0,     // дистанция отлёта при стаггере (м)
      deathSpinTime: 0.8,       // время падения и вращения перед взрывом (с)
      dropChance: 0.3,          // 30% шанс выпадения брони или патронов
      hitboxRadius: 0.72,       // широкий радиус хитбокса призрака
      hitboxHeight: 1.6,        // высота хитбокса под 3D-модель (1.6 м)
      hitboxEyeRadius: 0.34,    // радиус хитбокса головы/глаза (крит/хедшот)
      separationDist: 1.6,
      separationPushForce: 3.5,
      collisionEps: 0.001,
      maxProjectiles: 40,       // лимит активных снарядов врагов
      oilColor: 0x1a1a24,       // цвет масла вместо крови
      projectileCoreColor: 0x2ee6d6, // светящееся бирюзовое ядро
      projectileGlowColor: 0x9d4edd, // светящаяся фиолетовая оболочка
      startWave: 2,             // роботы появляются со 2-й волны
      perZombies: 5,            // 1 робот на каждые 5 зомби
      maxAlive: 5,              // не больше 5 одновременно

      // Визуальная 3D-модель призрака (public/models/ghost.glb)
      model: {
        path: "/models/ghost.glb",
        height: 1.6,             // целевая высота модели призрака (по умолчанию 1.6)
        rotationY: 0,            // поворот по Y (0 = лицом в +Z к игроку)
        offsetY: 0,              // вертикальное смещение относительно центра хитбокса
        clips: {
          idle: { clipName: "idle ghost", timeScale: 1.0 },
          patrol: { clipName: "idle ghost", timeScale: 1.0 },
          strafe: { clipName: "movement ghost", timeScale: 1.0 },
          moveFast: { clipName: "movement fast ghost.001", timeScale: 1.0 },
          charge: { clipName: "spell ghost 1", baseDuration: 2.667 }, // timeScale = 2.667 / chargeDuration
          shoot: { clipName: "spell ghost 2", timeScale: 3.0 },       // ускорение до 1 секунды
          stagger: { clipName: "hit reaction ghost.001", timeScale: 1.5 },
          death: { clipName: "death ghost.002", timeScale: 1.0, duration: 0.6 }
        }
      }
    },

    // Пугало с серпом (StrawReaper) — высокий опасный рукопашный противник
    reaper: {
      health: 180,
      speed: 6.0,
      speedVar: 0.1,
      damage: 30,
      scoreValue: 220,
      headshotBonus: 60,
      aggroRange: 40,
      attackRange: 2.8,
      attackCooldown: 1.2,
      attackWindup: 0.5,
      staggerTime: 0.2,
      staggerTilt: 0.25,        // наклон при стаггере (рад)
      staggerKnockbackResist: 0.5, // 50% сопротивления отбрасыванию
      separationDist: 1.1,
      separationPushForce: 3.5,
      recoveryDamageMult: 1.5,  // множитель урона в уязвимом состоянии после рывка
      ambushChance: 0.3,        // шанс заспавниться в неподвижной засаде

      // Рывок пугала (charge) с замахом и полосой поражения
      charge: {
        windup: 0.6,            // время замаха перед рывком (с)
        dashDistance: 15,        // максимальная дистанция рывка (м)
        dashSpeed: 25,          // скорость рывка (м/с)
        damage: 40,             // урон при попадании рывком
        width: 1.5,             // ширина полосы поражения рывка (м)
        cooldown: 5.0,          // перезарядка рывка (с)
        minDist: 6,             // мин. дистанция до игрока для рывка (м)
        maxDist: 14,            // макс. дистанция до игрока для рывка (м)
        maxHeightDiff: 1.5,     // макс. разница высот с игроком для рывка (м)
        recoveryTime: 1.2       // время уязвимости и восстановления после рывка (с)
      },

      stuckCheckInterval: 0.4,
      stuckMinMoveDist: 0.2,
      sidestepDuration: 0.6,
      hitboxRadius: 0.55,
      hitboxHeight: 2.25,
      hitboxHeadRadius: 0.44,
      hitboxHeadY: 1.55,
      strawColors: [0xcca033, 0xb8860b, 0xd4af37, 0x8b5a2b, 0x5c4033],
      bloodColor: 0xb8860b,     // частицы соломы вместо крови
      model: {
        path: "/models/reaper.glb",
        height: 2.1,
        rawHeight: 1.1045,
        rotationY: 0,
        offsetY: 0,
        lockHipsXZ: true,
        fps: 30,
        segments: {
          walk: [11.5, 12.8],
          raise: [5.1, 5.6],
          attack: [6.2, 7.5],
          idleStaff: [7.4, 11.3],
          shuffle: [11.4, 12.9],
          idleHunched: [13.0, 22.4]
        },
        clips: {
          chase: { clipName: "walk", timeScale: 1.0 },
          melee: { clipName: "attack", hitOffset: 1.1 },
          idle: { clipName: "idleStaff", timeScale: 1.0 },
          unreachable: { clipName: "idleHunched", timeScale: 1.0 }
        }
      }
    }
  },

  // Добивания (Glory Kills)
  glory: {
    useLegacy: false,      // флаг для сохранения старых 3 анимаций (punch, rip, kick)
    stunThreshold: 0.25,   // порог оглушения (< 25% HP)
    stunDuration: 6.0,     // длительность оглушения (с)
    range: 4.5,            // макс. дистанция для начала добивания
    angle: 45,             // конус взгляда (градусы)
    duration: 0.9,         // общая длительность добивания (с)
    dashDuration: 0.15,    // быстрый подлёт к врагу (с)
    timeScale: 0.3,        // замедление времени
    score: 200,            // очки за добивание
    stopDistance: 1.6,     // расстояние остановки перед врагом (1.6 м по ТЗ)
    executeTime: 0.35,     // момент расправы / выстрела
    invulnBonusTime: 0.3,

    // Параметры выстрела в упор (новое зрелищное добивание в стиле Doom Eternal)
    shot: {
      dashDuration: 0.15,       // подлёт 0.15 с
      aimDuration: 0.20,        // прицеливание 0.2 с реального времени
      stopDistance: 1.6,        // остановка на 1.6 м от врага
      hitstopDuration: 0.06,    // хит-стоп 0.06 с реального времени
      slowTimeScale: 0.3,       // замедление времени timeScale = 0.3 для сцены
      shakeDuration: 0.3,       // тряска экрана для дробовика (с)
      ak47BurstCount: 3,        // очередь из 3 выстрелов АК-47 в грудь
      ak47BurstDuration: 0.2,   // длительность очереди АК-47 (с)
      ak47ShakeDuration: 0.4,   // тряска врага от очереди АК-47 (с)
      rocketRadius: 2.0,        // радиус мини-взрыва ракетницы
      decapGeyserDuration: 0.4, // фонтан крови/слизи из шеи (с)
      shotgunStandDuration: 0.3,// тело стоит после выстрела дробовика (с)
      shotgunFallDuration: 0.5,  // тело падает назад (с)
      notificationDuration: 1.2  // уведомление «ДОБИТ!» (с)
    }
  },

  // Выпадение предметов
  drops: {
    normalAmmoChance: 0.20,
    normalHpChance: 0.10,
    stunnedKillChance: 0.35,
    stunnedHpChance: 0.25,
    gloryMedkits: 2,
    gloryAmmo: 1,
    gloryArmorChance: 0.40,
    // Расходники (водка/косяк): шансы и награды
    consumables: {
      normalChance: 0.08,   // шанс из обычного врага
      gloryChance: 0.20,    // шанс из добитого врага
      arenaClear: 2,        // штук после зачистки арены
      lootRoomMin: 2,       // минимум в loot-комнате
      lootRoomMax: 3        // максимум в loot-комнате
    }
  },

  // Взрывные бочки в аренах
  barrels: {
    model: "high",        // "high" | "low" — вариант красной бочки из barrel.glb
    color: "Red",         // цвет/префикс узла модели ("Red_Barrel_High")
    perArena: 6,          // бочек на арену (4–8)
    health: 30,           // запас прочности бочки
    radius: 5,            // радиус взрыва (м)
    damageEnemies: 80,    // урон врагам в центре, линейно падает к краю
    damagePlayer: 20,     // урон игроку в радиусе
    chainDelay: 0.15,     // задержка цепной реакции (с)
    flashDuration: 0.28   // длительность вспышки/кольца ударной волны (с)
  },

  // Подбираемые предметы
  pickups: {
    medkitHp: 25,
    armorAp: 25,
    shotgunAmmo: 8,
    ak47Ammo: 30,
    rocketAmmo: 4,
    pickupRadius: 1.2,
    magnetRadius: 4.0,
    life: 20.0,
    blinkTime: 5.0,
    blinkSpeed: 14,
    maxActive: 40,
    initialSpawns: {
      medkits: [[-10, 0, -8], [4, 3, -12], [12, 0, 2], [-4, 2, -12]],
      armor: [[0, 1.8, -2], [12, 4.5, -8]],
      shotgunAmmo: [[-12, 2.5, 6], [0, 0, 8]],
      ak47Ammo: [[-10, 1, -8], [14, 0, -14]],
      rocketAmmo: [[4, 0, -6], [-14, 0, 12]]
    }
  },

  // Параметры забега: карточки перков и особые механики
  run: {
    perkChoices: 3,          // сколько карточек показывать между уровнями
    perkMaxStacks: 3,        // лимит копий одного перка по умолчанию
    lastChanceThreshold: 0.2,// HP ниже 20%
    lastChanceDuration: 3.0, // замедление времени (с)
    lastChanceTimeScale: 0.6,// множитель времени
    lastChanceCooldown: 40   // перезарядка «Последнего шанса» (с)
  },

  // Сложность: множители урона, HP и количества врагов, очков и дропа
  difficulty: {
    default: "normal",
    storageKey: "fps_difficulty",
    order: ["easy", "normal", "hard"],
    modes: {
      easy: {
        id: "easy",
        name: "ЛЁГКИЙ",
        damageMult: 0.7,
        enemyHpMult: 0.8,
        enemyCountMult: 0.8,
        scoreMult: 0.7,
        dropChanceMult: 1.25
      },
      normal: {
        id: "normal",
        name: "НОРМАЛЬНЫЙ",
        damageMult: 1.0,
        enemyHpMult: 1.0,
        enemyCountMult: 1.0,
        scoreMult: 1.0,
        dropChanceMult: 1.0
      },
      hard: {
        id: "hard",
        name: "ЖЁСТКИЙ",
        damageMult: 1.35,
        enemyHpMult: 1.25,
        enemyCountMult: 1.2,
        scoreMult: 1.5,
        dropChanceMult: 0.8
      }
    }
  },

  // Локальные рекорды забегов
  records: {
    storageKey: "fps_records_v1",
    dailyStorageKey: "fps_daily_records_v1",
    maxEntries: 5
  },

  // Перки между уровнями. maxStacks ограничивает число копий.
  perks: [
    {
      id: "light_legs",
      name: "Лёгкие ноги",
      desc: "+8% к скорости передвижения.",
      rarity: "common",
      icon: "legs",
      color: "#e6c86e",
      maxStacks: 3
    },
    {
      id: "double_dash",
      name: "Двойной рывок",
      desc: "+1 заряд рывка. Можно рвать дистанцию дважды.",
      rarity: "rare",
      icon: "dash",
      color: "#e08a5a",
      maxStacks: 1
    },
    {
      id: "shotgun_beast",
      name: "Дробовик-зверь",
      desc: "+25% урона дробовика.",
      rarity: "common",
      icon: "shotgun",
      color: "#d9b45c",
      maxStacks: 3
    },
    {
      id: "kalash_storm",
      name: "Калаш-шторм",
      desc: "+20% к скорострельности АК-47.",
      rarity: "common",
      icon: "ak47",
      color: "#c8b050",
      maxStacks: 3
    },
    {
      id: "rocket_cassette",
      name: "Ракета-кассета",
      desc: "+4 ракеты к максимуму и +30% радиуса взрыва.",
      rarity: "common",
      icon: "rocket",
      color: "#e07b5a",
      maxStacks: 3
    },
    {
      id: "thick_skin",
      name: "Толстая шкура",
      desc: "+15 к максимуму HP. Сразу лечит 30 HP.",
      rarity: "common",
      icon: "shield",
      color: "#8fbf7a",
      maxStacks: 3,
      mods: { healOnPick: 30 }
    },
    {
      id: "vampire",
      name: "Вампир",
      desc: "Добивания восстанавливают 15 HP.",
      rarity: "common",
      icon: "fang",
      color: "#c96a7a",
      maxStacks: 3
    },
    {
      id: "magnet",
      name: "Магнит",
      desc: "+50% к радиусу подбора и магнита.",
      rarity: "common",
      icon: "magnet",
      color: "#c9a86a",
      maxStacks: 3
    },
    {
      id: "last_chance",
      name: "Последний шанс",
      desc: "При HP ниже 20% время замедляется на 3 с. Раз в 40 с.",
      rarity: "rare",
      icon: "clock",
      color: "#d95f5f",
      maxStacks: 1
    },
    {
      id: "armor_for_blood",
      name: "Броня за кровь",
      desc: "+1 брони за каждое убийство.",
      rarity: "common",
      icon: "armor",
      color: "#7aa5c9",
      maxStacks: 3
    },
    {
      id: "barrel_friend",
      name: "Бочкам привет",
      desc: "Взрывы бочек больше не вредят.",
      rarity: "rare",
      icon: "barrel",
      color: "#c9b46a",
      maxStacks: 1
    },
    {
      id: "stylish",
      name: "Стильный",
      desc: "Затухание стиля медленнее на 30%.",
      rarity: "common",
      icon: "star",
      color: "#d9c85c",
      maxStacks: 3
    },
    {
      id: "jumper",
      name: "Прыгун",
      desc: "Двойной прыжок выше на 15%.",
      rarity: "common",
      icon: "spring",
      color: "#7ac9a8",
      maxStacks: 3
    },
    {
      id: "drunk_master",
      name: "Пьяный мастер",
      desc: "Водка: +20% защиты и +5 с. Косяк: +5 с.",
      rarity: "rare",
      icon: "bottle",
      color: "#b57ac9",
      maxStacks: 1
    }
  ],

  // Эффекты: цвета крови; лимиты частиц/декалей/гибов задаются в своих секциях ниже
  effects: {
    blood: {
      zombieColor: 0x660a14, // тёмно-красная густая кровь
      humanColor: 0x770c18
    },
    particles: {
      maxCount: 400
    },
    decals: {
      maxCount: 80, // лимит декалей крови не больше 80
      decalLife: 25,
      decalFadeTime: 3.0,
      decalScaleDefault: 1.0,
      splatterTexSize: 64
    },
    explosions: {
      maxCount: 4,
      duration: 0.3,
      lightDuration: 0.25,
      lightIntensity: 6,
      lightDistance: 25
    },
    popups: {
      maxCount: 20,
      duration: 0.7,
      fadeDuration: 0.25,
      riseDistance: 1.25
    },
    gibs: {
      maxCount: 60,
      life: 6.0,
      gravity: 32,
      bounceFactor: 0.42,
      minBounceSpeed: 2.0,
      stopBounceSpeed: 0.8,
      groundFriction: 0.75,
      fadeDuration: 0.6
    },

    // Расходники: длительность, сила эффекта и множители
    maxDuration: 60,         // максимальное время жизни одного эффекта (с)
    maxStack: 3,             // максимум штук каждого расходника в инвентаре
    initialStrength: 0.5,    // сила при первом приёме
    strengthStep: 0.25,      // прирост силы при повторном приёме
    strengthThreshold: 0.5,  // с этой силы множители работают в полную величину

    vodka: {
      duration: 25,          // длительность (с)
      moveSpeedMult: 1.08,   // хмельная уверенность
      damageTakenMult: 0.7   // получаемый урон при силе >= 0.5
    },

    joint: {
      duration: 20,          // длительность (с)
      moveSpeedMult: 0.95,   // расслабленная походка
      timeScaleMult: 0.8,    // замедление мира
      gravityMult: 0.7       // более лёгкие прыжки
    },

    // Переключатель «Ослабить эффекты» в меню паузы
    reduced: {
      active: false,
      storageKey: "fps_reduced_effects",
      visualScale: 0.5       // во сколько раз ослаблять визуальную силу
    },

    // Экранные эффекты и ощущения от расходников
    screen: {
      drunk: {
        attack: 0.8,          // плавный вход (с)
        release: 2.0,         // плавный выход (с)
        hangover: 3.0,        // отходняк после выхода (с)
        hangoverBlur: 0.35,   // остаточная сила размытия в отходняке
        swayPeriod: 5.0,      // период раскачивания камеры (с)
        swayBaseDeg: 2.0,     // базовый крен (градусы)
        swayStrengthDeg: 6.0, // добавка крена при силе 1 (градусы)
        driftMax: 0.25,       // боковой занос направления при силе 1
        sensMin: 0.7,         // чувствительность мыши при силе 1
        sensLerp: 4.0         // скорость сглаживания чувствительности
      },
      weed: {
        attack: 0.8,
        release: 1.6,
        huePeriod: 6.0,       // полный круг смены оттенка (с)
        trailDamp: 0.35,      // сила шлейфа
        faceChance: 0.25,     // шанс смешного лица над врагом
        faceDuration: 3.0,    // время жизни лица (с)
        faceIntervalMin: 1.2, // интервал проверки лиц (с)
        faceIntervalMax: 2.4,
        audioFreq: 62,        // низкий «булькающий» тон (Гц)
        audioGain: 0.045
      }
    }
  },

  // Отладочные переключатели
  debug: {
    // Читы: F2 — меню читов, F3 — панель диагностики, F5 — новый уровень,
    // плюс window.dbg в консоли. При false эти клавиши и dbg недоступны.
    // F4 (миникарта) работает всегда и от чита не зависит.
    cheats: true
  },

  // Сочность и отклик (Game Feel)
  feel: {
    intensity: 1.0,           // общий множитель интенсивности эффектов
    reduced: false,            // режим «ослабить эффекты»

    audio: {
      pitchVariation: 0.08,    // случайная вариация высоты звуков (±8%)
      pickupStreakWindow: 1.6, // окно накопления серии подбора (с)
      pickupStreakStep: 1.05946,// повышение тона на 1 полутон за предмет
      heartbeatThreshold: 28,  // порог здоровья для тревожного сердцебиения
      heartbeatInterval: 0.85  // период удара сердца (с)
    },

    weapon: {
      swayAmount: 0.0018,      // отставание оружия при поворотах мыши
      swayReturnSpeed: 12,     // скорость пружинного возврата оружия
      swayMax: 0.05,           // максимальное смещение от мыши
      recoilSpringStiffness: 140, // жёсткость пружины отдачи оружия
      recoilSpringDamping: 14, // демпфирование пружины
      airBobDamp: 0.002,       // реакция оружия на прыжки и падение в воздухе
      kickZ: {
        shotgun: 0.28,
        ak47: 0.06,
        rocket: 0.55
      },
      rotX: {
        shotgun: 0.1,
        ak47: 0.01,
        rocket: 0.45
      }
    },

    camera: {
      shakeMult: 1.0,          // множитель силы тряски камеры
      dashFovKick: 10,         // пинок FOV при рывке
      jumpFovKick: 3.5,        // пинок FOV при прыжке
      strafeRollDeg: 1.6,      // наклон камеры (крен) при боковом стрейфе A/D (градусы)
      strafeRollSpeed: 10,     // скорость сглаживания наклона
      landShakeVelThresh: 7.0, // порог вертикальной скорости падения для тряски
      landShakeAmp: 0.08,      // сила тряски при жёстком приземлении
      landShakeDur: 0.22       // длительность тряски при приземлении
    },

    enemy: {
      squashDuration: 0.12,    // длительность сплющивания (сквош) при попадании (с)
      squashScaleY: 0.12,      // сплющивание по высоте (-12%)
      squashScaleXZ: 0.06,     // расширение вширь (+6%)
      killHitstopDuration: 0.04,// хит-стоп (замирание) при убийстве врага (с)
      multikillWindow: 1.0,    // окно мультикилла (с)
      multikillMinKills: 3,    // минимум 3 убийства за 1 секунду
      multikillSlowDuration: 0.4,// длительность замедления времени (с)
      multikillTimeScale: 0.35 // коэффициент замедления при мультикилле
    },

    damageNumbers: {
      groupWindow: 0.20,       // окно объединения урона в одну цифру (с)
      bounceHeight: 0.35,      // высота подскока цифры урона
      critThreshold: 35        // порог урона для красного цвета
    },

    hitmarker: {
      hitDuration: 0.14,
      killDuration: 0.24
    },

    particles: {
      shellCasingsMax: 16,     // максимум активных гильз на полу
      dustLandCount: 12,       // частицы пыли при приземлении
      dustDashCount: 8,        // частицы пыли при рывке
      rocketSmokeCount: 14     // частицы дыма после ракет
    }
  },

  combat: {
    switchDelay: 0.08,
    viewmodelSwitchSpeed: 7,
    targetHp: 100,
    targetRespawn: 4,
    hitMarkerDuration: 0.18,
    flashDuration: 0.05,
    lightDuration: 0.08,
    viewmodelBobSpeed: 10,
    viewmodelBobAmpX: 0.014,
    viewmodelBobAmpY: 0.012,
    viewmodelBobRot: 0.018
  },

  // Вьюмодель дробовика: настройки 3D-модели shotgun.glb
  viewmodel: {
    shotgun: {
      model: "shotgun",
      useModel: true,
      length: 1.33,
      scale: 1,
      brightness: 1.8,
      pos: { x: 0.3, y: -0.6, z: -0.55 },
      rot: { x: -0.09, y: 1.61, z: 0.11 },
      assembly: {
        stock: { x: -7, y: 0, z: 26 },
        handguard: { x: 141, y: 0, z: 17 }
      },
      hands: {
        armsPos: { x: 0.08, y: -0.18, z: -0.22 },
        armsScale: 1.1,
        right: {
          x: -49, y: 85, z: 16,
          rot: { x: 0, y: 0, z: 0 },
          parent: "gun",
          curl: { thumb: 0.7, index: 0.5, middle: 1, ring: 1, pinky: 1 }
        },
        left: {
          x: 83, y: 87, z: -22,
          rot: { x: 0.8, y: -2.24, z: -2.1 },
          parent: "Tactical_Handguard_V1",
          curl: { thumb: 0, index: 0.3, middle: 0.25, ring: 0.3, pinky: 0.4 }
        }
      },
      muzzle: { x: 250, y: 85, z: 32 },
      eject: { x: 168, y: 10, z: 44, side: 1 },
      shell: { scale: 2.5 },
      pump: { distance: 0.15, returnTime: 0.45 }
    },
    ak47: {
      model: "ak47",
      useModel: true,
      length: 1.62,
      scale: 1,
      brightness: 1.25,
      pos: { x: 0.27, y: -0.15, z: -0.6 },
      rot: { x: 0.01, y: 1.66, z: 0.06 },
      muzzle: { x: 1, y: -0.03, z: 0 },
      eject: { x: 0.05, y: 0.07, z: 0.03, side: 1 },
      shell: { scale: 1.8 },
      hands: {
        armsPos: { x: -0.06, y: -0.19, z: -0.19 },
        armsScale: 1.28,
        right: {
          x: -18,
          y: -4,
          z: 14,
          rot: { x: -0.36, y: -0.18, z: 0.1 },
          parent: "gun",
          curl: { thumb: 0, index: 0.5, middle: 1, ring: 1, pinky: 1 }
        },
        left: {
          x: 34,
          y: -8,
          z: -3,
          rot: { x: -0.94, y: -0.78, z: 1.46 },
          parent: "gun",
          curl: { thumb: 0.2, index: 0.4, middle: 1, ring: 0.55, pinky: 1 }
        }
      }
    },
    rocket: {
      model: "rocket",
      useModel: true,
      length: 1.85,
      scale: 1,
      brightness: 1.3,
      pos: { x: 0.45, y: -0.25, z: -0.15 },
      rot: { x: 0.01, y: 0.06, z: 0.01 },
      muzzle: { x: 0, y: 0.02, z: -0.92 },
      backblast: { x: 0, y: 0.02, z: 0.50 },
      hands: {
        armsPos: { x: 0.08, y: -0.18, z: -0.22 },
        armsScale: 1.6,
        right: {
          x: 0.02,
          y: -0.12,
          z: -0.2,
          rot: { x: 0.064, y: -0.127, z: 1.558 },
          parent: "gun",
          curl: { thumb: 0.7, index: 0.5, middle: 1, ring: 1, pinky: 1 }
        },
        left: {
          x: -0.06,
          y: -0.24,
          z: -0.74,
          rot: { x: 2.76, y: 0.3, z: 2.68 },
          parent: "gun",
          curl: { thumb: 0.8, index: 1, middle: 1, ring: 1, pinky: 1 }
        }
      },
      glory: {
        pos: { x: 0.08, y: -0.14, z: -0.58 },
        rot: { x: 0.08, y: 0.05, z: 0 }
      }
    },
    arms: {
      useModel: true,
      mode: "baked",
      breathing: true,
      pose: "knife_idle",
      timeScale: 0.6,
      inflateEnabled: true,
      inflate: {
        upperArm: 0.030,
        forearm: 0.026,
        hand: 0.008,
        fingers: 0.002
      },
      sleeves: true,
      sleeveColor: [0.32, 0.36, 0.24],
      sleeveStartV: 0.53,
      hideWeaponsForTest: false,
      triggerFinger: {
        shotgun: 0.6,
        ak47: 0.6,
        rocket: 0.0
      },
      pole: {
        right: { x: 0.5, y: -1.0, z: 0.3 },
        left: { x: -0.5, y: -1.0, z: 0.3 }
      },
      handRot: {
        right: { x: -1.48, y: 0.11, z: -1.263 },
        left: { x: 1.57, y: 0.0, z: 3.14 }
      },
      pos: { x: 0.08, y: -0.18, z: -0.22 },
      rot: { x: 0, y: 0, z: 0 },
      scale: 1.1
    }
  },

  // Оружие
  weapons: {
    shotgun: {
      name: "Дробовик",
      pellets: 10,
      spread: 4,
      damage: 8,
      range: 40,
      falloffStart: 15,
      falloffMin: 0.4,
      cooldown: 0.8,
      ammo: 12,
      maxAmmo: 40,
      recoil: 3,
      shake: 0.012,
      shakeTime: 0.15,
      kickBack: 1,
      airPush: 4,
      pushEnemy: 10
    },
    
    ak47: {
      name: "АК-47",
      damage: 12,
      cooldown: 0.1, // 10 выстрелов в секунду (fireRate = 0.1 с)
      ammo: 150,
      maxAmmo: 300,
      range: 80,
      falloffStart: 40,
      falloffEnd: 80,
      falloffMin: 0.6,
      spread: {
        min: 0.8,
        max: 3.0,
        perShot: 0.12,
        recover: 0.25
      },
      recoilCamera: {
        pitch: 0.22,   // подъём камеры вверх за выстрел (градусы)
        yaw: 0.15,     // случайное смещение влево/вправо за выстрел (градусы)
        maxPitch: 2.5  // максимальное накопление подъёма за очередь (градусы)
      },
      shake: 0.003,
      shakeTime: 0.05,
      kickBack: 0.35,
      pushEnemy: 3
    },
    rocket: {
      name: "Ракетница",
      damage: 100,
      cooldown: 1.1,
      ammo: 12,
      maxAmmo: 24,
      projSpeed: 35,
      projRadius: 0.15,
      life: 4,
      explosionRadius: 6,
      explosionDamage: 100,
      jumpForce: 30,
      recoil: 7.5,
      shake: 0.055,
      shakeTime: 0.35,
      kickBack: 1.5,
      pushEnemy: 26,
      smokeInterval: 0.09
    }
  },

  // Волны, арены и прогрессия уровней
  waves: {
    bannerDuration: 2000,
    clearBannerDuration: 2400,
    minSpawnDistFromPlayer: 12,
    spawnMargin: 3,
    maxSpawnAttempts: 50,
    maxAliveLimit: 18,
    spawnInterval: 0.25,

    // Боевая логика арен
    arenas: {
      doorAnimTime: 0.4,          // анимация дверей (с)
      activateDepth: 4.0,         // насколько глубоко нужно зайти от проёма (м)
      startDelay: 1.5,            // пауза после закрытия дверей до первой волны (с)
      spawnPoints: 8,             // точек спавна по периметру
      minSpawnDistFromPlayer: 10, // мин. дистанция спавна от игрока (м)
      maxAlive: 16,               // лимит одновременно живых на арене
      maxReapers: 4,              // лимит одновременно живых пугал на арене
      waveMin: 2,
      waveMax: 3,
      nextWaveAliveRatio: 0.2,    // следующая волна при остатке < 20%
      nextWaveTimeout: 25,        // ...или через 25 с
      robotHeightMin: 3.0,        // высота спавна роботов (м)
      robotHeightMax: 5.0,
      difficultyPerArena: 0.12,   // каждая следующая арена на +12% врагов
      clearRewardRadius: 1.9,
      clearReward: ["medkit", "armor", "ammo_shotgun", "ammo_ak47", "ammo_rocket"]
    },

    // Босс-заглушка (каждый 3-й уровень, комната exit)
    boss: {
      everyLevels: 3,
      scale: 2,
      health: 1500,
      zombieInterval: 10,
      scoreBonus: 2000
    },

    levelScale: 1.15, // прирост количества врагов за уровень

    // Таблица прогрессии 1–8: количество врагов на одну арену (суммарно по волнам)
    levels: [
      { level: 1, zombie: 8,  mutant: 0, robot: 3, reaper: 2, maxAlive: 16, waves: 2 },
      { level: 2, zombie: 9,  mutant: 1, robot: 3, reaper: 2, maxAlive: 16, waves: 3 },
      { level: 3, zombie: 10, mutant: 1, robot: 4, reaper: 3, maxAlive: 16, waves: 3 },
      { level: 4, zombie: 11, mutant: 2, robot: 4, reaper: 3, maxAlive: 16, waves: 3 },
      { level: 5, zombie: 12, mutant: 2, robot: 4, reaper: 4, maxAlive: 18, waves: 3 },
      { level: 6, zombie: 13, mutant: 3, robot: 5, reaper: 4, maxAlive: 18, waves: 3 },
      { level: 7, zombie: 15, mutant: 3, robot: 5, reaper: 5, maxAlive: 18, waves: 3 },
      { level: 8, zombie: 17, mutant: 4, robot: 6, reaper: 6, maxAlive: 18, waves: 3 }
    ]
  },

  // Реплики Васи
  quotes: {
    quoteCooldown: 4.0,
    quoteDisplayTime: 1500,
    killsPerQuote: 3,
    consumeQuotes: {
      vodka: [
        "Вздрогнем за медицину, ёпта!",
        "Вот теперь мир не такой кусачий!",
        "Главное — скальпель не пропивать!",
        "Ик... а зомби-то в двух головах!"
      ],
      joint: [
        "Расслабься, Вася, зомби тоже спешат...",
        "Кажется, стены дышат. Это норма?",
        "Ща как поплывём по коридорам...",
        "Кислоты бы ещё, но и так неплохо."
      ]
    },
    // Короткая реплика при максимальной силе водки
    drunkMaxQuotes: [
      "КАПИТАЛЬНО НАТАЩИЛСЯ! Держись, медицина!",
      "Я не пьяный, я стерильный!",
      "Зомби плывут... красиво плывут."
    ],
    killQuotes: [
      "Минус один упырь!",
      "Не стой на линии огня, плесень!",
      "Оп, и в фарш!",
      "Халат испачкал, растяпа!",
      "Анатомический театр закрывается!",
      "Лови маслину, чучело!"
    ],
    damageQuotes: [
      "Ах ты гнида кусачая!",
      "Зубы выбью, зомбятина!",
      "Халат свой грязный убери!",
      "Больно же, тварь!",
      "Руки коротки меня жрать!",
      "Ща добавки получишь!"
    ],
      lowHealthQuotes: [
      "Так, Вася, соберись, не подыхать же тут!",
      "Кажись, шкурку попортили...",
      "Не дождётесь, гады!",
      "Аптечку бы... или хотя бы бинт!",
      "В глазах темнеет, но ствол ещё в руке!",
      "Только через мой труп... стоп, нет!"
    ]
  },

  // 3D-модели подбираемых патронов (размеры, яркость, раскладка и полосы раскраски ракет)
  ammo: {
    brightness: 1.0,
    size: {
      shotgun: 0.85,
      ak47: 0.72,
      rocket: 0.80
    },
    ak47: {
      boxTint: [1.1, 1.0, 0.7]
    },
    layout: {
      ak47: [
        { pos: [-0.03, 0.018, -0.045], rot: [0, 0.12, -Math.PI / 2], scale: 1.0 },
        { pos: [0.01, 0.018, -0.015], rot: [0, -0.06, -Math.PI / 2], scale: 1.0 },
        { pos: [-0.01, 0.018, 0.02], rot: [0, 0.08, -Math.PI / 2], scale: 1.0 },
        { pos: [0.025, 0.046, -0.005], rot: [0.08, -0.18, -Math.PI / 2], scale: 1.0 }
      ]
    },
    rocket: {
      tiltDeg: 25,
      bracketColor: [0.28, 0.28, 0.30],
      bands: [
        { maxH: 0.20, color: [0.25, 0.25, 0.28] },
        { maxH: 0.62, color: [0.36, 0.40, 0.20] },
        { maxH: 0.68, color: [0.22, 0.22, 0.24] },
        { maxH: 0.94, color: [0.86, 0.30, 0.12] },
        { maxH: 1.01, color: [0.70, 0.70, 0.70] }
      ]
    },
    casing: {
      shotgun: {
        length: 0.075,
        tint: [1.0, 1.0, 1.0]
      },
      ak47: {
        length: 0.055,
        tint: [0.78, 0.48, 0.30]
      }
    }
  }
};
