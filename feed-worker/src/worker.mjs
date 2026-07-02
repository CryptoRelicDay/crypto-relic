// Лента последних дропов для «Крипто-реликвии дня».
// Личность не трекается: храним только ник (который человек сам ввёл),
// индексы предмета, редкость и время. Ни IP, ни куки, ни fingerprint.
//
// Анти-чит: воркер НЕ верит клиенту. Он берёт присланный ник + хеш блока,
// проверяет, что блок настоящий и свежий (mempool.space), и ПЕРЕСЧИТЫВАЕТ
// дроп тем же детерминированным движком. Подделать редкость нельзя.

import { rollDrop } from '../../web/engine.mjs';

const ALLOWED_ORIGINS = new Set([
  'https://cryptorelicday.github.io',
  'http://localhost:3000',
]);

const FEED_KEY = 'feed';
const MAX_FEED = 30;
const MAX_NAME = 24;

function cors(origin) {
  const o = ALLOWED_ORIGINS.has(origin) ? origin : 'https://cryptorelicday.github.io';
  return {
    'Access-Control-Allow-Origin': o,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

async function verifyBlock(env, hash, height) {
  if (!/^[0-9a-f]{64}$/.test(hash)) return false;
  // кэш проверок в KV, чтобы не дёргать mempool на каждый POST
  const cacheKey = 'block:' + hash;
  const cached = await env.FEED.get(cacheKey);
  if (cached === String(height)) return true;
  if (cached === 'bad') return false;

  const r = await fetch('https://mempool.space/api/block/' + hash);
  if (!r.ok) { await env.FEED.put(cacheKey, 'bad', { expirationTtl: 3600 }); return false; }
  const b = await r.json();
  // блок должен совпадать по высоте и быть не старше 48 часов
  const fresh = b.timestamp * 1000 > Date.now() - 48 * 3600 * 1000;
  if (b.height !== height || !fresh) { await env.FEED.put(cacheKey, 'bad', { expirationTtl: 3600 }); return false; }
  await env.FEED.put(cacheKey, String(height), { expirationTtl: 48 * 3600 });
  return true;
}

// вычищаем только опасные для HTML символы; буквы/цифры/emoji остаются
function sanitizeName(raw) {
  return String(raw || '').trim().toLowerCase().slice(0, MAX_NAME)
    .replace(/[<>&"'`]/g, '');
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const headers = cors(origin);
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    if (req.method === 'GET' && url.pathname === '/recent') {
      const feed = (await env.FEED.get(FEED_KEY)) || '[]';
      return new Response(feed, { headers });
    }

    if (req.method === 'POST' && url.pathname === '/open') {
      let body;
      try { body = await req.json(); } catch { return new Response('{"error":"bad json"}', { status: 400, headers }); }

      const name = sanitizeName(body.name);
      const hash = String(body.hash || '');
      const height = parseInt(body.height, 10);
      if (!name || !Number.isFinite(height)) return new Response('{"error":"bad input"}', { status: 400, headers });

      if (!(await verifyBlock(env, hash, height))) {
        return new Response('{"error":"unknown or stale block"}', { status: 400, headers });
      }

      const date = todayUTC();
      // Пересчёт на сервере: результат берём ТОЛЬКО отсюда.
      const drop = rollDrop({ hash, height }, name, date, 'en');

      const feed = JSON.parse((await env.FEED.get(FEED_KEY)) || '[]');
      if (feed.some((e) => e.u === name && e.d === date)) {
        return new Response('{"ok":true,"dup":true}', { headers });
      }
      feed.unshift({
        u: name, d: date,
        r: drop.rarity.key, a: drop.adjIndex, n: drop.nounIndex, t: drop.traitIndex,
        h: height, ts: Date.now(),
      });
      await env.FEED.put(FEED_KEY, JSON.stringify(feed.slice(0, MAX_FEED)));
      return new Response('{"ok":true}', { headers });
    }

    return new Response('{"error":"not found"}', { status: 404, headers });
  },
};
