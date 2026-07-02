// Ежедневный пост «дроп дня» для X от @CryptoRelicDay.
// Два режима (env POST_MODE):
//   draft (по умолчанию) — только составить текст и записать в draft.txt;
//   live — опубликовать через POST /2/tweets (нужны кредиты X API).
// Без зависимостей: OAuth 1.0a подпись на node:crypto.

import crypto from 'node:crypto';
import fs from 'node:fs';

const MODE = process.env.POST_MODE === 'live' ? 'live' : 'draft';

const {
  X_CONSUMER_KEY, X_CONSUMER_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET,
} = process.env;

if (MODE === 'live' && (!X_CONSUMER_KEY || !X_CONSUMER_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_TOKEN_SECRET)) {
  console.error('Missing X API credentials in env');
  process.exit(1);
}

const SITE = 'https://cryptorelicday.github.io/crypto-relic/';
const LAUNCH_DATE = '2026-07-02'; // Day 1

const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

function oauth1Header(method, url) {
  const p = {
    oauth_consumer_key: X_CONSUMER_KEY,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: X_ACCESS_TOKEN,
    oauth_version: '1.0',
  };
  const paramStr = Object.keys(p).sort().map((k) => `${enc(k)}=${enc(p[k])}`).join('&');
  const base = [method.toUpperCase(), enc(url), enc(paramStr)].join('&');
  const key = `${enc(X_CONSUMER_SECRET)}&${enc(X_ACCESS_TOKEN_SECRET)}`;
  p.oauth_signature = crypto.createHmac('sha1', key).update(base).digest('base64');
  return 'OAuth ' + Object.keys(p).sort().map((k) => `${enc(k)}="${enc(p[k])}"`).join(', ');
}

async function getBeacon() {
  const [hash, height] = await Promise.all([
    fetch('https://mempool.space/api/blocks/tip/hash').then((r) => r.text()),
    fetch('https://mempool.space/api/blocks/tip/height').then((r) => r.text()),
  ]);
  return { hash: hash.trim(), height: parseInt(height, 10) };
}

function dayNumber() {
  const today = new Date().toISOString().slice(0, 10);
  const diff = Math.round((Date.parse(today) - Date.parse(LAUNCH_DATE)) / 86400000);
  return diff + 1;
}

async function postTweet(text) {
  const url = 'https://api.twitter.com/2/tweets';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: oauth1Header('POST', url),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });
  const body = await res.text();
  return { status: res.status, body };
}

const beacon = await getBeacon();
const text = [
  `⛓️ Day ${dayNumber()}. Block #${beacon.height} is sealed.`,
  '',
  `${beacon.hash.slice(0, 10)}…`,
  '',
  "Today's relic pool is live. One drop per name. Gone at midnight UTC.",
  '',
  SITE,
].join('\n');

console.log('--- tweet text ---');
console.log(text);
console.log('------------------');

fs.writeFileSync('draft.txt', text);

if (MODE !== 'live') {
  console.log('POST_MODE=draft — текст записан в draft.txt, публикации не было.');
  process.exit(0);
}

const { status, body } = await postTweet(text);
console.log('HTTP', status);
console.log(body);

if (status !== 201) {
  // 403 с "duplicate content" — уже постили сегодня, не считаем ошибкой
  if (status === 403 && body.includes('duplicate')) {
    console.log('Duplicate — already posted today, OK.');
    process.exit(0);
  }
  process.exit(1);
}
