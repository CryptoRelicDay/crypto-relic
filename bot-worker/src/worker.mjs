// Telegram-версия «Крипто-реликвии дня» на Cloudflare Workers (webhook + KV).
// Тот же детерминированный движок, что у сайта: ../../web/engine.mjs.
// Открытия дублируются в общую ленту сайта (feed-воркер сам всё перепроверит).

import { rollDrop, RARITIES } from '../../web/engine.mjs';

const FEED_URL = 'https://crypto-relic-feed.cryptorelicday.workers.dev';
const SITE = 'https://cryptorelicday.github.io/crypto-relic/';

const RARITY_EMOJI = {
  common: '⚪', uncommon: '🟢', rare: '🔵', epic: '🟣', legendary: '🟠', mythic: '🔴',
};

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

// ---------- Маяк дня: первый запрос дня фиксирует блок в KV для всех ----------
async function getBeacon(env) {
  const date = todayUTC();
  const key = 'beacon:' + date;
  const cached = await env.BOTKV.get(key);
  if (cached) return JSON.parse(cached);
  try {
    const [hashRes, heightRes] = await Promise.all([
      fetch('https://mempool.space/api/blocks/tip/hash'),
      fetch('https://mempool.space/api/blocks/tip/height'),
    ]);
    const beacon = { hash: (await hashRes.text()).trim(), height: parseInt(await heightRes.text(), 10) };
    if (!/^[0-9a-f]{64}$/.test(beacon.hash) || !Number.isFinite(beacon.height)) throw new Error('bad beacon');
    await env.BOTKV.put(key, JSON.stringify(beacon), { expirationTtl: 3 * 24 * 3600 });
    return beacon;
  } catch {
    return { hash: 'offline-' + date, height: 0 };
  }
}

function userKey(from) {
  return from.username ? '@' + from.username.toLowerCase() : 'id' + from.id;
}

function updateStreak(rec, dateStr) {
  if (rec.streakLast === dateStr) return rec.streakCount || 0;
  const prev = new Date(dateStr); prev.setUTCDate(prev.getUTCDate() - 1);
  const prevStr = prev.toISOString().slice(0, 10);
  rec.streakCount = rec.streakLast === prevStr ? (rec.streakCount || 0) + 1 : 1;
  rec.streakLast = dateStr;
  return rec.streakCount;
}

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

async function tg(env, method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return r.json();
}

function send(env, chatId, text, extra = {}) {
  return tg(env, 'sendMessage', {
    chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra,
  });
}

// ---------- Команды ----------

async function cmdStart(env, chatId) {
  await send(env, chatId,
    'Привет! Это <b>Крипто-реликвия дня</b>.\n\n' +
    'Раз в день ты открываешь один кейс, запечатанный хешем сегодняшнего биткоин-блока. ' +
    'Что выпадет — зависит от твоего ника. Реролла нет.\n\n' +
    '/open — открыть реликвию дня\n' +
    '/collection — твоя коллекция\n' +
    '/streak — сколько дней подряд\n' +
    '/odds — шансы редкостей\n\n' +
    `🌐 Веб-версия и лента дропов: ${SITE}`);
}

async function cmdOpen(env, chatId, from, ctx) {
  const date = todayUTC();
  const key = userKey(from);
  const beacon = await getBeacon(env);
  const drop = rollDrop(beacon, key, date);

  const recKey = 'user:' + key;
  const rec = JSON.parse((await env.BOTKV.get(recKey)) || '{"collection":[],"streakCount":0,"streakLast":null}');

  if (rec.collection.some((c) => c.date === date)) {
    await send(env, chatId, '⏳ Сегодня ты уже открывал. Вот твоя реликвия дня:\n\n' + formatDrop(drop, rec.streakCount || 0));
    // лента могла не знать про дроп (сбой/старая версия) — дошлём, дубли она отсеет
    if (beacon.height > 0) {
      ctx.waitUntil(fetch(FEED_URL + '/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: key, hash: beacon.hash, height: beacon.height }),
      }).catch(() => {}));
    }
    return;
  }

  const streak = updateStreak(rec, date);
  rec.collection.unshift({
    date, name: drop.name, rarity: drop.rarity.label, rarityKey: drop.rarity.key,
    height: drop.beaconHeight, float: drop.float, serial: drop.serial, trait: drop.trait,
  });
  rec.collection = rec.collection.slice(0, 300);
  await env.BOTKV.put(recKey, JSON.stringify(rec));

  await send(env, chatId, formatDrop(drop, streak));

  // дублируем в общую ленту сайта; feed-воркер сам верифицирует блок и пересчитает дроп
  if (beacon.height > 0) {
    ctx.waitUntil(fetch(FEED_URL + '/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: key, hash: beacon.hash, height: beacon.height }),
    }).catch(() => {}));
  }
}

async function cmdCollection(env, chatId, from) {
  const rec = JSON.parse((await env.BOTKV.get('user:' + userKey(from))) || 'null');
  if (!rec || !rec.collection.length) {
    await send(env, chatId, 'Коллекция пуста. Открой первую: /open');
    return;
  }
  const lines = rec.collection.slice(0, 20).map((c) => {
    const e = RARITY_EMOJI[c.rarityKey] || '⚪';
    return `${e} <b>${c.name}</b> — ${c.rarity} · #${c.height} · ${c.date}`;
  });
  const total = rec.collection.length;
  await send(env, chatId, `📦 Твоя коллекция (${total}):\n\n${lines.join('\n')}` + (total > 20 ? `\n\n…и ещё ${total - 20}` : ''));
}

async function cmdStreak(env, chatId, from) {
  const rec = JSON.parse((await env.BOTKV.get('user:' + userKey(from))) || 'null');
  await send(env, chatId, `🔥 Твой стрик: <b>${rec?.streakCount || 0}</b> дн. подряд.`);
}

async function cmdOdds(env, chatId) {
  const total = RARITIES.reduce((s, r) => s + r.weight, 0);
  const lines = RARITIES.map((r) => {
    const e = RARITY_EMOJI[r.key] || '⚪';
    return `${e} ${r.label}: ${((r.weight / total) * 100).toFixed(2)}%`;
  });
  await send(env, chatId, `🎲 Шансы:\n\n${lines.join('\n')}\n\nВсё проверяемо: дроп — чистая функция от блока и ника, исходник открыт.`);
}

// ---------- Webhook ----------

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    if (req.method === 'POST' && url.pathname === '/webhook') {
      if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
        return new Response('forbidden', { status: 403 });
      }
      let update;
      try { update = await req.json(); } catch { return new Response('ok'); }

      const msg = update.message;
      if (!msg || !msg.text || !msg.from) return new Response('ok');

      const text = msg.text.trim();
      const chatId = msg.chat.id;
      try {
        if (/^\/start/.test(text)) await cmdStart(env, chatId);
        else if (/^\/open/.test(text)) await cmdOpen(env, chatId, msg.from, ctx);
        else if (/^\/collection/.test(text)) await cmdCollection(env, chatId, msg.from);
        else if (/^\/streak/.test(text)) await cmdStreak(env, chatId, msg.from);
        else if (/^\/odds/.test(text)) await cmdOdds(env, chatId);
        else if (msg.chat.type === 'private') await send(env, chatId, 'Не понял. Команды: /open /collection /streak /odds');
      } catch (e) {
        // не роняем webhook — Telegram иначе будет ретраить один и тот же апдейт
      }
      return new Response('ok');
    }

    return new Response('crypto-relic-bot: use Telegram', { status: 200 });
  },
};
