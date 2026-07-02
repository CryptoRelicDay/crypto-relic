// engine.mjs — общее ядро "Крипто-реликвии дня".
// Чистый ES-модуль без DOM и без Node API: одинаково работает в браузере и в боте.
// Дроп детерминирован: одинаковый (дата + хеш блока + ник) => одинаковый предмет у всех.

// ---------- Детерминированный хеш и ГПСЧ (identical в браузере и Node) ----------

// cyrb128: строка -> 4x uint32. Стабильный, без зависимостей.
export function cyrb128(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0, k; i < str.length; i++) {
    k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

// mulberry32: seed -> функция, дающая последовательность чисел [0,1).
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Таблица редкостей ----------

export const RARITIES = [
  { key: 'common',    label: 'Обычный',      color: '#9aa4b2', glow: '#9aa4b220', weight: 5000 },
  { key: 'uncommon',  label: 'Необычный',    color: '#4ade80', glow: '#4ade8033', weight: 2600 },
  { key: 'rare',      label: 'Редкий',       color: '#38bdf8', glow: '#38bdf844', weight: 1400 },
  { key: 'epic',      label: 'Эпический',    color: '#a855f7', glow: '#a855f755', weight: 640 },
  { key: 'legendary', label: 'Легендарный',  color: '#f59e0b', glow: '#f59e0b66', weight: 140 },
  { key: 'mythic',    label: 'Мифический',   color: '#f43f5e', glow: '#f43f5e77', weight: 20 },
];

const TOTAL_WEIGHT = RARITIES.reduce((s, r) => s + r.weight, 0);

// ---------- Словари для генерации имён ----------

const ADJECTIVES = [
  'Обугленный', 'Застывший', 'Квантовый', 'Забытый', 'Древний', 'Мерцающий',
  'Хрустальный', 'Теневой', 'Позолоченный', 'Ледяной', 'Пустотный', 'Штормовой',
  'Кровавый', 'Небесный', 'Цифровой', 'Полуночный', 'Расколотый', 'Вечный',
  'Призрачный', 'Изумрудный', 'Обсидиановый', 'Плазменный', 'Руинный', 'Солнечный',
];

const NOUNS = [
  'Осколок', 'Фрагмент', 'Печать', 'Реликвия', 'Талисман', 'Ключ',
  'Кристалл', 'Руна', 'Эмблема', 'Артефакт', 'Ядро', 'Реликт',
  'Медальон', 'Скрижаль', 'Компас', 'Тотем', 'Клинок', 'Ковчег',
];

// Редкие «трейты» — как эффекты у скинов.
const TRAITS = ['Полированный', 'С трещиной', 'Светящийся', 'Гравированный', 'Пульсирующий', 'Зеркальный'];

// ---------- Утилиты ----------

export function utcDate(d) {
  // d опционально: миллисекунды. Возвращает 'YYYY-MM-DD' в UTC.
  const dt = d == null ? null : new Date(d);
  if (!dt) {
    // без аргумента полагаемся на переданную снаружи дату — см. rollDrop(dateStr).
    throw new Error('utcDate: передайте дату явно');
  }
  return dt.toISOString().slice(0, 10);
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

function rollRarity(rng) {
  let x = rng() * TOTAL_WEIGHT;
  for (const r of RARITIES) {
    if (x < r.weight) return r;
    x -= r.weight;
  }
  return RARITIES[0];
}

// ---------- Главная функция дропа ----------

// Детерминированно вычисляет реликвию для (дата, маяк-блок, ник).
// beacon: { hash, height }. username: строка. dateStr: 'YYYY-MM-DD'.
export function rollDrop(beacon, username, dateStr) {
  const uname = String(username || 'anon').trim().toLowerCase();
  const seedStr = `${dateStr}|${beacon.hash}|${uname}`;
  const [s1, s2] = cyrb128(seedStr);
  const rng = mulberry32(s1 ^ s2);

  const rarity = rollRarity(rng);
  const adjective = pick(rng, ADJECTIVES);
  const noun = pick(rng, NOUNS);

  // "Флоат" как у скинов CS: 0.0000–1.0000, чем меньше — тем "чище".
  const float = rng().toFixed(4);

  // Трейт появляется только у редких+.
  const hasTrait = rng() < 0.18 && ['rare', 'epic', 'legendary', 'mythic'].includes(rarity.key);
  const trait = hasTrait ? pick(rng, TRAITS) : null;

  // Серийный номер печати — детерминирован от сида.
  const serialNum = (cyrb128('serial|' + seedStr)[0] % 99999) + 1;
  const serial = '#' + String(serialNum).padStart(5, '0');

  const name = `${adjective} ${noun}`;

  return {
    date: dateStr,
    username: uname,
    rarity: { key: rarity.key, label: rarity.label, color: rarity.color, glow: rarity.glow },
    name,
    adjective,
    noun,
    trait,
    float,
    serial,
    beaconHeight: beacon.height,
    beaconHash: beacon.hash,
    beaconShort: String(beacon.hash).slice(0, 8),
  };
}

// Короткая сводка одной строкой (для шеринга/бота).
export function dropLine(drop) {
  const t = drop.trait ? ` ✦${drop.trait}` : '';
  return `${drop.name} [${drop.rarity.label}]${t} · флоат ${drop.float} · блок #${drop.beaconHeight}`;
}
