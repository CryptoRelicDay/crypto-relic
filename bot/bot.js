// bot.js — Telegram-версия "Крипто-реликвии дня".
// Использует ТОТ ЖЕ движок, что и веб (../web/engine.mjs).
// В Telegram сценарий "напиши -> получи дроп" бесплатен и без лимитов на чтение.
//
// Запуск:
//   1) npm install
//   2) BOT_TOKEN=xxxx npm start      (получи токен у @BotFather)
//
// Состояние хранится в store.json (для free-деплоя на serverless замени на KV — см. README).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import TelegramBot from 'node-telegram-bot-api';
import { rollDrop, dropLine, RARITIES } from '../web/engine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE = path.join(__dirname, 'store.json');

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  console.error('Нет BOT_TOKEN. Запусти: BOT_TOKEN=<токен от @BotFather> npm start');
  process.exit(1);
}

// ---------- Маяк дня (биткоин-блок), кэш на дату ----------
let beaconCache = { date: null, beacon: null };
async function getBeacon() {
  const date = new Date().toISOString().slice(0, 10);
  if (beaconCache.date === date && beaconCache.beacon) return beaconCache.beacon;
  try {
    const [hashRes, heightRes] = await Promise.all([
      fetch('https://mempool.space/api/blocks/tip/hash'),
      fetch('https://mempool.space/api/blocks/tip/height'),
    ]);
    const hash = (await hashRes.text()).trim();
    const height = parseInt(await heightRes.text(), 10);
    beaconCache = { date, beacon: { hash, height } };
  } catch {
    beaconCache = { date, beacon: { hash: 'offline-' + date, height: 0 } };
  }
  return beaconCache.beacon;
}

// ---------- Хранилище ----------
function loadStore() {
  try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch { return {}; }
}
function saveStore(data) {
  fs.writeFileSync(STORE, JSON.stringify(data, null, 2));
}

function userKey(msg) {
  return msg.from.username ? '@' + msg.from.username.toLowerCase() : 'id' + msg.from.id;
}

function updateStreak(rec, dateStr) {
  if (rec.streakLast === dateStr) return rec.streakCount || 0;
  const prev = new Date(dateStr); prev.setUTCDate(prev.getUTCDate() - 1);
  const prevStr = prev.toISOString().slice(0, 10);
  rec.streakCount = rec.streakLast === prevStr ? (rec.streakCount || 0) + 1 : 1;
  rec.streakLast = dateStr;
  return rec.streakCount;
}

// ---------- Форматирование ----------
const RARITY_EMOJI = {
  common: '⚪', uncommon: '🟢', rare: '🔵', epic: '🟣', legendary: '🟠', mythic: '🔴',
};

function formatDrop(drop, streak) {
  const e = RARITY_EMOJI[drop.rarity.key] || '⚪';
  const trait = drop.trait ? `\n✦ <b>${drop.trait}</b>` : '';
  return [
    `${e} <b>${drop.name}</b>`,
    `${drop.rarity.label}${trait}`,
    '',
    `Флоат: <code>${drop.float}</code>`,
    `Печать: <code>${drop.serial}</code>`,
    `Блок: <b>#${drop.beaconHeight}</b> · <code>${drop.beaconShort}…</code>`,
    '',
    `🔥 Стрик: <b>${streak}</b> дн.`,
  ].join('\n');
}

// ---------- Бот ----------
const bot = new TelegramBot(TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    'Привет! Это <b>Крипто-реликвия дня</b>.\n\n' +
    'Раз в день ты открываешь один кейс, запечатанный хешем сегодняшнего биткоин-блока. ' +
    'Что выпадет — зависит от твоего ника. Реролла нет.\n\n' +
    '/open — открыть реликвию дня\n' +
    '/collection — твоя коллекция\n' +
    '/streak — сколько дней подряд\n' +
    '/odds — шансы редкостей',
    { parse_mode: 'HTML' });
});

bot.onText(/\/open/, async (msg) => {
  const date = new Date().toISOString().slice(0, 10);
  const key = userKey(msg);
  const beacon = await getBeacon();
  const drop = rollDrop(beacon, key, date);

  const store = loadStore();
  const rec = store[key] || { collection: [], streakCount: 0, streakLast: null };

  const openedToday = rec.collection.some((c) => c.date === date);
  if (openedToday) {
    bot.sendMessage(msg.chat.id,
      '⏳ Сегодня ты уже открывал. Вот твоя реликвия дня:\n\n' +
      formatDrop(drop, rec.streakCount || 0), { parse_mode: 'HTML' });
    return;
  }

  const streak = updateStreak(rec, date);
  rec.collection.unshift({
    date, name: drop.name, rarity: drop.rarity.label, rarityKey: drop.rarity.key,
    height: drop.beaconHeight, float: drop.float, serial: drop.serial, trait: drop.trait,
  });
  rec.collection = rec.collection.slice(0, 300);
  store[key] = rec;
  saveStore(store);

  bot.sendMessage(msg.chat.id, formatDrop(drop, streak), { parse_mode: 'HTML' });
});

bot.onText(/\/collection/, (msg) => {
  const key = userKey(msg);
  const store = loadStore();
  const rec = store[key];
  if (!rec || !rec.collection.length) {
    bot.sendMessage(msg.chat.id, 'Коллекция пуста. Открой первую: /open');
    return;
  }
  const lines = rec.collection.slice(0, 20).map((c) => {
    const e = RARITY_EMOJI[c.rarityKey] || '⚪';
    return `${e} <b>${c.name}</b> — ${c.rarity} · #${c.height} · ${c.date}`;
  });
  const total = rec.collection.length;
  bot.sendMessage(msg.chat.id,
    `📦 Твоя коллекция (${total}):\n\n${lines.join('\n')}` + (total > 20 ? `\n\n…и ещё ${total - 20}` : ''),
    { parse_mode: 'HTML' });
});

bot.onText(/\/streak/, (msg) => {
  const key = userKey(msg);
  const rec = loadStore()[key];
  const count = rec?.streakCount || 0;
  bot.sendMessage(msg.chat.id, `🔥 Твой стрик: <b>${count}</b> дн. подряд.`, { parse_mode: 'HTML' });
});

bot.onText(/\/odds/, (msg) => {
  const total = RARITIES.reduce((s, r) => s + r.weight, 0);
  const lines = RARITIES.map((r) => {
    const e = RARITY_EMOJI[r.key] || '⚪';
    const pct = ((r.weight / total) * 100).toFixed(2);
    return `${e} ${r.label}: ${pct}%`;
  });
  bot.sendMessage(msg.chat.id, `🎲 Шансы:\n\n${lines.join('\n')}`, { parse_mode: 'HTML' });
});

console.log('Бот запущен. Пиши ему /start в Telegram.');
