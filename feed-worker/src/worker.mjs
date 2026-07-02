// Лента последних дропов для «Крипто-реликвии дня».
// Личность не трекается: храним только ник (который человек сам ввёл),
// индексы предмета, редкость и время. Ни IP, ни куки, ни fingerprint.
//
// Анти-чит: воркер НЕ верит клиенту. Он берёт присланный ник + хеш блока,
// проверяет, что блок настоящий и свежий (mempool.space), и ПЕРЕСЧИТЫВАЕТ
// дроп тем же детерминированным движком. Подделать редкость нельзя.

import { rollDrop, relicName, relicTrait, rarityLabelOf } from '../../web/engine.mjs';

const SITE = 'https://cryptorelicday.github.io/crypto-relic/';

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

// ---------- Дневная статистика (без куки и личных данных) ----------
// stats:YYYY-MM-DD -> { hits, opens, refs: { host: n } }
// RMW по KV не атомарен — при большом трафике возможен лёгкий недосчёт, для нас ок.
async function bumpStats(env, field, refHost) {
  const key = 'stats:' + todayUTC();
  const s = JSON.parse((await env.FEED.get(key)) || '{"hits":0,"opens":0,"refs":{}}');
  s[field] = (s[field] || 0) + 1;
  if (refHost) {
    if (Object.keys(s.refs).length < 100 || s.refs[refHost] != null) {
      s.refs[refHost] = (s.refs[refHost] || 0) + 1;
    }
  }
  await env.FEED.put(key, JSON.stringify(s), { expirationTtl: 90 * 24 * 3600 });
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const headers = cors(origin);
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    // счётчик захода: страница дёргает раз при загрузке
    if (req.method === 'POST' && url.pathname === '/hit') {
      let refHost = '';
      try {
        const b = await req.json();
        if (b.r) refHost = new URL(b.r).hostname.slice(0, 80);
      } catch { /* без реферера */ }
      await bumpStats(env, 'hits', refHost || '(direct)');
      return new Response('{"ok":true}', { headers });
    }

    // агрегированная статистика за последние 7 дней
    if (req.method === 'GET' && url.pathname === '/stats') {
      const out = {};
      const d = new Date();
      for (let i = 0; i < 7; i++) {
        const key = d.toISOString().slice(0, 10);
        const s = await env.FEED.get('stats:' + key);
        if (s) out[key] = JSON.parse(s);
        d.setUTCDate(d.getUTCDate() - 1);
      }
      return new Response(JSON.stringify(out, null, 2), { headers });
    }

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

      // запоминаем дроп на неделю — для персональных OG-превью (/s/ник)
      await env.FEED.put('open:' + date + ':' + name, JSON.stringify({
        r: drop.rarity.key, a: drop.adjIndex, n: drop.nounIndex, t: drop.traitIndex,
        f: drop.float, s: drop.serial, h: height,
      }), { expirationTtl: 7 * 24 * 3600 });

      const feed = JSON.parse((await env.FEED.get(FEED_KEY)) || '[]');
      if (feed.some((e) => e.u === name && e.d === date)) {
        return new Response('{"ok":true,"dup":true}', { headers });
      }
      await bumpStats(env, 'opens');
      feed.unshift({
        u: name, d: date,
        r: drop.rarity.key, a: drop.adjIndex, n: drop.nounIndex, t: drop.traitIndex,
        h: height, ts: Date.now(),
      });
      await env.FEED.put(FEED_KEY, JSON.stringify(feed.slice(0, MAX_FEED)));
      return new Response('{"ok":true}', { headers });
    }

    // Персональное превью дропа: /s/<ник>?d=YYYY-MM-DD&lang=en
    // Краулеры читают мета-теги, живые люди мгновенно уезжают на сайт.
    if (req.method === 'GET' && url.pathname.startsWith('/s/')) {
      const name = sanitizeName(decodeURIComponent(url.pathname.slice(3)));
      const qd = url.searchParams.get('d') || '';
      const date = /^\d{4}-\d{2}-\d{2}$/.test(qd) ? qd
        : /^\d{8}$/.test(qd) ? `${qd.slice(0,4)}-${qd.slice(4,6)}-${qd.slice(6,8)}`
        : todayUTC();
      const lang = url.searchParams.get('lang') === 'ru' ? 'ru' : 'en';
      const target = SITE + '?u=' + encodeURIComponent(name) + '&lang=' + lang + '&d=' + date.replace(/-/g, '');

      let title = 'Crypto Relic Day';
      let desc = "Check what today's Bitcoin block gives your name. One drop a day. No rerolls.";
      let image = SITE + 'og-image.png';

      const raw = name ? await env.FEED.get('open:' + date + ':' + name) : null;
      if (raw) {
        const e = JSON.parse(raw);
        const item = relicName(e.a, e.n, lang);
        const rar = rarityLabelOf(e.r, lang);
        const trait = e.t >= 0 ? ' ✦ ' + relicTrait(e.t, lang) : '';
        title = lang === 'ru'
          ? `${name} выбил: ${item} [${rar}]${trait}`
          : `${name} pulled ${item} [${rar}]${trait}`;
        desc = lang === 'ru'
          ? `Флоат ${e.f} · печать ${e.s} · блок #${e.h}. Проверь, что сегодняшний блок даст твоему нику.`
          : `Float ${e.f} · seal ${e.s} · block #${e.h}. Check what today's block gives YOUR name.`;
        image = SITE + 'og/' + e.r + '.png';
      }

      const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      const html = `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@CryptoRelicDay">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0;url=${esc(target)}">
<script>location.replace(${JSON.stringify(target)});</script>
</head><body><a href="${esc(target)}">Crypto Relic Day →</a></body></html>`;
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
    }

    return new Response('{"error":"not found"}', { status: 404, headers });
  },
};
