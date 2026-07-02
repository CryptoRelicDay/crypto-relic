import { rollDrop, dropLine, relicName, rarityLabelOf, shortHash, RARITIES } from './engine.mjs';

const FEED_URL = 'https://crypto-relic-feed.cryptorelicday.workers.dev';

// ---------- Вспомогательное ----------
const $ = (id) => document.getElementById(id);
const todayUTC = () => new Date().toISOString().slice(0, 10);

const els = {
  langToggle: $('langToggle'),
  h1: document.querySelector('.head h1'),
  sub: document.querySelector('.head .sub'),
  unameLabel: document.querySelector('.field span'),
  h2: document.querySelector('.collection-head h2'),
  footerP: document.querySelector('.foot p'),
  beacon: $('beacon'), uname: $('uname'), openBtn: $('openBtn'), hint: $('hint'),
  cardHost: $('cardHost'), shareRow: $('shareRow'), shareX: $('shareX'), copyLink: $('copyLink'),
  grid: $('grid'), emptyColl: $('emptyColl'), streak: $('streak'),
  feedSection: $('feedSection'), feedTitle: $('feedTitle'), feedStrip: $('feedStrip'),
};

let BEACON = null;         // { hash, height }
let currentDrop = null;    // последний показанный дроп
let currentPreview = false;
let LANG = 'ru';

// ---------- Словарь интерфейса ----------
const I18N = {
  ru: {
    docTitle: 'Крипто-реликвия дня',
    titleA: 'Крипто-реликвия ', titleB: 'дня',
    sub: 'Один блок. Один день. Один дроп на ник. Реролла нет.',
    beaconLoading: 'Ищу сегодняшний блок…',
    beaconLine: (h, hash) => `Печать дня: блок <b>#${h}</b> · ${hash}…`,
    beaconOffline: (d) => `Оффлайн-режим · маяк из даты ${d}`,
    unameLabel: 'Твой ник',
    unamePlaceholder: 'напр. satoshi',
    unamePreview: 'вбей свой ник…',
    openBtn: 'Открыть реликвию дня',
    shareX: 'Поделиться в 𝕏',
    copyLink: 'Скопировать ссылку',
    copied: 'Скопировано ✓',
    collection: 'Коллекция',
    streak: (n) => `Стрик: ${n} дн.`,
    empty: 'Пока пусто. Открой первую реликвию ☝️',
    footer: 'Дроп детерминирован: <code>дата + хеш блока + ник</code>. Никто не может подкрутить — исходник открыт.',
    metaFloat: 'Флоат', metaSeal: 'Печать', metaNick: 'Ник',
    origin: (h, short, date) => `Добыто из блока <b>#${h}</b> · ${short}… · ${date}`,
    hintFixed: 'Реликвия дня зафиксирована. Возвращайся завтра за новой.',
    hintPreview: (u) => `Это дроп ника «${u}». Вбей свой и открой собственный ☝️`,
    hintNoName: 'Введи ник — без него дропа нет.',
    hintLoading: 'Ещё гружу блок, секунду…',
    hintAlready: 'Сегодня этот ник уже открывал. Вот твоя реликвия дня.',
    hintCopyFail: 'Не удалось скопировать — скопируй ссылку из адресной строки.',
    hintOpening: 'Ломаю печать…',
    shareText: (line) => `Моя крипто-реликвия дня: ${line}.\nПроверь, что выпадет твоему нику 👇`,
    toggleLabel: 'EN',
    feedTitle: 'Последние дропы',
    agoNow: 'только что', agoMin: (n) => `${n} мин назад`, agoHr: (n) => `${n} ч назад`,
  },
  en: {
    docTitle: 'Crypto Relic Day',
    titleA: 'Crypto Relic ', titleB: 'Day',
    sub: 'One block. One day. One drop per name. No rerolls.',
    beaconLoading: 'Finding today’s block…',
    beaconLine: (h, hash) => `Today’s seal: block <b>#${h}</b> · ${hash}…`,
    beaconOffline: (d) => `Offline mode · beacon from date ${d}`,
    unameLabel: 'Your name',
    unamePlaceholder: 'e.g. satoshi',
    unamePreview: 'enter your name…',
    openBtn: 'Open today’s relic',
    shareX: 'Share on 𝕏',
    copyLink: 'Copy link',
    copied: 'Copied ✓',
    collection: 'Collection',
    streak: (n) => `Streak: ${n} d.`,
    empty: 'Empty for now. Open your first relic ☝️',
    footer: 'Drop is deterministic: <code>date + block hash + name</code>. No one can rig it — the source is open.',
    metaFloat: 'Float', metaSeal: 'Seal', metaNick: 'Name',
    origin: (h, short, date) => `Mined from block <b>#${h}</b> · ${short}… · ${date}`,
    hintFixed: 'Today’s relic is locked in. Come back tomorrow for a new one.',
    hintPreview: (u) => `This is “${u}”’s drop. Enter yours and open your own ☝️`,
    hintNoName: 'Enter a name — no drop without it.',
    hintLoading: 'Still loading the block, one sec…',
    hintAlready: 'This name already opened today. Here’s your relic of the day.',
    hintCopyFail: 'Couldn’t copy — grab the link from the address bar.',
    hintOpening: 'Breaking the seal…',
    shareText: (line) => `My crypto relic of the day: ${line}.\nCheck what today’s block gives you 👇`,
    toggleLabel: 'RU',
    feedTitle: 'Latest drops',
    agoNow: 'just now', agoMin: (n) => `${n}m ago`, agoHr: (n) => `${n}h ago`,
  },
};
const t = () => I18N[LANG];

// ---------- Маяк дня (биткоин-блок) ----------
async function getBeacon() {
  const date = todayUTC();
  const cacheKey = 'beacon:' + date;
  const cached = localStorage.getItem(cacheKey);
  if (cached) return JSON.parse(cached);

  try {
    const [hash, height] = await Promise.all([
      fetch('https://mempool.space/api/blocks/tip/hash').then((r) => r.text()),
      fetch('https://mempool.space/api/blocks/tip/height').then((r) => r.text()),
    ]);
    const beacon = { hash: hash.trim(), height: parseInt(height, 10) };
    localStorage.setItem(cacheKey, JSON.stringify(beacon));
    return beacon;
  } catch (e) {
    // Оффлайн-фолбэк: детерминированный псевдо-маяк из даты (без биткоина).
    return { hash: 'offline-' + date, height: 0 };
  }
}

// ---------- Определение языка по региону IP ----------
// RU-язычные страны (СНГ). Легко расширить/сузить.
const RU_REGION = new Set(['RU', 'BY', 'KZ', 'KG', 'TJ', 'UZ', 'AM', 'AZ', 'TM', 'MD']);

function withTimeout(promise, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(timer) };
}

async function fetchCountry() {
  // 1) ipwho.is — JSON, без ключа, CORS, HTTPS
  try {
    const t = withTimeout(null, 2500);
    const r = await fetch('https://ipwho.is/', { signal: t.signal });
    t.done();
    const j = await r.json();
    if (j && j.success !== false && j.country_code) return String(j.country_code).toUpperCase();
  } catch (e) { /* пробуем запасной */ }
  // 2) ipapi.co — отдаёт чистый 2-буквенный код
  try {
    const t = withTimeout(null, 2500);
    const r = await fetch('https://ipapi.co/country/', { signal: t.signal });
    t.done();
    const code = (await r.text()).trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(code)) return code;
  } catch (e) { /* сдаёмся */ }
  return null;
}

// Возвращает 'ru' | 'en' по IP (с кэшем) или null, если определить не удалось.
async function getGeoLang() {
  const cached = localStorage.getItem('geoLang');
  if (cached === 'ru' || cached === 'en') return cached;
  const cc = await fetchCountry();
  if (!cc) return null;
  const lang = RU_REGION.has(cc) ? 'ru' : 'en';
  localStorage.setItem('geoLang', lang);
  localStorage.setItem('geoCountry', cc);
  return lang;
}

// ---------- Хранилище коллекции ----------
function loadCollection() {
  try { return JSON.parse(localStorage.getItem('collection') || '[]'); }
  catch { return []; }
}
function saveToCollection(drop) {
  const coll = loadCollection();
  if (coll.some((c) => c.date === drop.date && c.username === drop.username)) return;
  coll.unshift({
    date: drop.date, username: drop.username,
    rarityKey: drop.rarity.key, color: drop.rarity.color,
    adjIndex: drop.adjIndex, nounIndex: drop.nounIndex, traitIndex: drop.traitIndex,
    height: drop.beaconHeight, float: drop.float, serial: drop.serial,
  });
  localStorage.setItem('collection', JSON.stringify(coll.slice(0, 200)));
}
// Имя/редкость предмета коллекции на текущем языке (с фолбэком для старых записей).
function entryName(c) {
  return c.adjIndex != null ? relicName(c.adjIndex, c.nounIndex, LANG) : (c.name || '');
}
function entryRarity(c) {
  return c.rarityKey ? rarityLabelOf(c.rarityKey, LANG) : (c.rarityLabel || '');
}

// ---------- Стрик ----------
function updateStreak(dateStr) {
  const raw = JSON.parse(localStorage.getItem('streak') || '{"last":null,"count":0}');
  if (raw.last === dateStr) return raw.count;
  const prev = new Date(dateStr); prev.setUTCDate(prev.getUTCDate() - 1);
  const prevStr = prev.toISOString().slice(0, 10);
  raw.count = raw.last === prevStr ? raw.count + 1 : 1;
  raw.last = dateStr;
  localStorage.setItem('streak', JSON.stringify(raw));
  return raw.count;
}
function renderStreak() {
  const raw = JSON.parse(localStorage.getItem('streak') || '{"count":0}');
  els.streak.textContent = t().streak(raw.count || 0);
}

// ---------- Рендер карточки ----------
function renderCard(drop, { preview = false } = {}) {
  const r = drop.rarity;
  const L = t();
  els.cardHost.hidden = false;
  els.cardHost.innerHTML = `
    <div class="relic" style="--rar:${r.color};--glow:${r.glow}">
      <span class="rar-badge">${r.label}</span>
      <p class="name">${drop.name}</p>
      ${drop.trait ? `<p class="trait">✦ ${drop.trait}</p>` : '<p class="trait" style="visibility:hidden">–</p>'}
      <div class="meta">
        <span>${L.metaFloat} <b>${drop.float}</b></span>
        <span>${L.metaSeal} <b>${drop.serial}</b></span>
        <span>${L.metaNick} <b>${drop.username}</b></span>
      </div>
      <div class="origin">${L.origin(drop.beaconHeight, drop.beaconShort, drop.date)}</div>
    </div>`;
  els.shareRow.hidden = false;
  currentDrop = drop;
  currentPreview = preview;
  els.hint.textContent = preview ? L.hintPreview(drop.username) : L.hintFixed;
}

// ---------- Рендер коллекции ----------
function renderCollection() {
  const coll = loadCollection();
  els.emptyColl.hidden = coll.length > 0;
  els.grid.innerHTML = coll.map((c) => `
    <div class="cell" style="--cl:${c.color}">
      <div class="cr">${entryRarity(c)}</div>
      <div class="cn">${entryName(c)}</div>
      <div class="cd">#${c.height} · ${c.date}</div>
    </div>`).join('');
}

// ---------- Лента последних дропов ----------
let FEED_CACHE = [];

function rarityColorOf(key) {
  return (RARITIES.find((r) => r.key === key) || RARITIES[0]).color;
}

function timeAgo(ts) {
  const L = t();
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return L.agoNow;
  if (mins < 60) return L.agoMin(mins);
  return L.agoHr(Math.floor(mins / 60));
}

function renderFeed() {
  els.feedTitle.textContent = t().feedTitle;
  if (!FEED_CACHE.length) { els.feedSection.hidden = true; return; }
  els.feedSection.hidden = false;
  els.feedStrip.textContent = '';
  for (const e of FEED_CACHE) {
    const cell = document.createElement('div');
    cell.className = 'feed-cell';
    cell.style.setProperty('--fc', rarityColorOf(e.r));
    if (e.r === 'legendary' || e.r === 'mythic') cell.style.setProperty('--fglow', rarityColorOf(e.r));
    const u = document.createElement('div'); u.className = 'fu'; u.textContent = e.u;
    const n = document.createElement('div'); n.className = 'fn'; n.textContent = relicName(e.a, e.n, LANG);
    const ti = document.createElement('div'); ti.className = 'ft';
    ti.textContent = `${rarityLabelOf(e.r, LANG)} · ${timeAgo(e.ts)}`;
    cell.append(u, n, ti);
    els.feedStrip.append(cell);
  }
}

async function loadFeed() {
  try {
    const r = await fetch(FEED_URL + '/recent');
    if (!r.ok) return;
    FEED_CACHE = await r.json();
    renderFeed();
  } catch { /* лента не критична — молча пропускаем */ }
}

function reportOpen(drop) {
  if (!BEACON || BEACON.height <= 0) return; // оффлайн-маяк в общую ленту не шлём
  fetch(FEED_URL + '/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: drop.username, hash: BEACON.hash, height: BEACON.height }),
  }).then(() => loadFeed()).catch(() => {});
}

// ---------- Ритуал вскрытия ----------
const SEAL_SVG = `
  <svg class="seal-hex" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <polygon points="32,7 53,19.5 53,44.5 32,57 11,44.5 11,19.5"
             fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="round"/>
    <polygon points="32,19 45,32 32,45 19,32" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>
    <circle cx="32" cy="32" r="4" fill="currentColor"/>
  </svg>`;

function applyRevealEffects(drop) {
  const relic = els.cardHost.querySelector('.relic');
  if (!relic) return;
  const tier = drop.rarity.key;
  relic.classList.add('hot');
  if (['rare', 'epic', 'legendary', 'mythic'].includes(tier)) relic.classList.add('blaze');
  if (['legendary', 'mythic'].includes(tier)) {
    for (let i = 0; i < 16; i++) {
      const s = document.createElement('span');
      s.className = 'spark';
      const angle = (i / 16) * Math.PI * 2 + Math.random() * 0.5;
      const dist = 90 + Math.random() * 120;
      s.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
      s.style.setProperty('--dy', Math.sin(angle) * dist + 'px');
      s.style.setProperty('--dl', (Math.random() * 0.15) + 's');
      relic.append(s);
    }
  }
  if (tier === 'mythic') {
    els.cardHost.classList.add('shake');
    setTimeout(() => els.cardHost.classList.remove('shake'), 500);
  }
}

function playReveal(drop) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) { renderCard(drop); return; }

  els.openBtn.disabled = true;
  els.shareRow.hidden = true;
  els.cardHost.hidden = false;
  els.cardHost.innerHTML = `<div class="seal-stage">${SEAL_SVG}</div>`;
  els.hint.textContent = t().hintOpening;

  setTimeout(() => {
    els.cardHost.querySelector('.seal-stage')?.classList.add('burst');
    setTimeout(() => {
      renderCard(drop);
      applyRevealEffects(drop);
      els.openBtn.disabled = false;
    }, 260);
  }, 1500);
}

// ---------- Открытие ----------
function alreadyOpenedToday(username) {
  return loadCollection().some((c) => c.date === todayUTC() && c.username === username.trim().toLowerCase());
}

function doOpen() {
  const username = els.uname.value.trim();
  if (!username) { els.hint.textContent = t().hintNoName; return; }
  if (!BEACON) { els.hint.textContent = t().hintLoading; return; }

  const uname = username.toLowerCase();
  const date = todayUTC();
  const drop = rollDrop(BEACON, uname, date, LANG);

  if (alreadyOpenedToday(uname)) {
    renderCard(drop);
    els.hint.textContent = t().hintAlready;
    reportOpen(drop); // воркер мог не знать дроп (открыт до фичи/офлайн) — дошлём, дубли он отсеет
    return;
  }

  saveToCollection(drop);
  updateStreak(date);
  renderCollection();
  renderStreak();
  els.uname.value = uname;
  localStorage.setItem('lastUser', uname);
  reportOpen(drop);
  playReveal(drop);
}

// ---------- Шеринг ----------
function shareUrl(username) {
  // Ссылка ведёт через воркер: краулерам он отдаёт персональное превью дропа
  // (карточка редкости + название предмета), людей мгновенно редиректит на сайт.
  // r= — антикэш: каждая кнопка «поделиться» даёт свежий URL, чтобы X не подсунул
  // ранее закэшированную карточку (например, фолбэк до того, как дроп дошёл до воркера).
  const r = Date.now().toString(36).slice(-4);
  return `${FEED_URL}/s/${encodeURIComponent(username)}?d=${todayUTC().replace(/-/g, '')}&lang=${LANG}&r=${r}`;
}
function shareToX() {
  if (!currentDrop) return;
  const text = t().shareText(dropLine(currentDrop));
  const url = shareUrl(currentDrop.username);
  const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  window.open(intent, '_blank', 'noopener');
}
async function copyLink() {
  if (!currentDrop) return;
  try {
    await navigator.clipboard.writeText(shareUrl(currentDrop.username));
    els.copyLink.textContent = t().copied;
    setTimeout(() => (els.copyLink.textContent = t().copyLink), 1500);
  } catch { els.hint.textContent = t().hintCopyFail; }
}

// ---------- Применение языка ко всему интерфейсу ----------
function applyLang() {
  const L = t();
  document.documentElement.lang = LANG;
  document.title = L.docTitle;
  els.langToggle.textContent = L.toggleLabel;
  els.h1.innerHTML = `${L.titleA}<span>${L.titleB}</span>`;
  els.sub.textContent = L.sub;
  els.unameLabel.textContent = L.unameLabel;
  els.h2.textContent = L.collection;
  els.footerP.innerHTML = L.footer;
  els.openBtn.textContent = L.openBtn;
  els.shareX.textContent = L.shareX;
  els.copyLink.textContent = L.copyLink;
  els.emptyColl.textContent = L.empty;

  // ник-плейсхолдер: превью-режим или обычный
  const inPreview = new URLSearchParams(location.search).has('u');
  els.uname.placeholder = inPreview ? L.unamePreview : L.unamePlaceholder;

  // маяк
  if (BEACON) {
    els.beacon.innerHTML = BEACON.height > 0
      ? L.beaconLine(BEACON.height, shortHash(BEACON.hash))
      : L.beaconOffline(todayUTC());
  } else {
    els.beacon.textContent = L.beaconLoading;
  }

  renderStreak();
  renderCollection();
  renderFeed();

  // перерисовать открытую карточку на новом языке (тот же предмет, другие слова)
  if (currentDrop) {
    const redrop = rollDrop(BEACON, currentDrop.username, currentDrop.date, LANG);
    renderCard(redrop, { preview: currentPreview });
  }
}

function switchLang() {
  LANG = LANG === 'ru' ? 'en' : 'ru';
  localStorage.setItem('lang', LANG);
  localStorage.setItem('langManual', '1'); // ручной выбор перебивает гео/браузер навсегда
  applyLang();
}

// ---------- Инициализация ----------
async function init() {
  // Приоритет языка: ручной выбор → ?lang= в ссылке → кэш гео-IP → язык браузера.
  // Мгновенный выбор (без сети), чтобы не было мигания; IP уточняется асинхронно ниже.
  const params = new URLSearchParams(location.search);
  const urlLang = params.get('lang');
  const manual = localStorage.getItem('langManual') === '1';
  const stored = localStorage.getItem('lang');
  const geoCache = localStorage.getItem('geoLang');
  const urlPick = urlLang === 'en' || urlLang === 'ru' ? urlLang : null;
  const manualPick = manual && (stored === 'en' || stored === 'ru') ? stored : null;

  LANG = manualPick
    || urlPick
    || (geoCache === 'en' || geoCache === 'ru' ? geoCache : null)
    || ((navigator.language || 'en').toLowerCase().startsWith('ru') ? 'ru' : 'en');

  els.langToggle.addEventListener('click', switchLang);
  els.openBtn.addEventListener('click', doOpen);
  els.uname.addEventListener('keydown', (e) => { if (e.key === 'Enter') doOpen(); });
  els.shareX.addEventListener('click', shareToX);
  els.copyLink.addEventListener('click', copyLink);

  applyLang();          // отрисовать интерфейс на выбранном языке (BEACON ещё null)

  BEACON = await getBeacon();
  els.openBtn.disabled = false;

  const uParam = params.get('u');
  if (uParam) {
    currentDrop = rollDrop(BEACON, uParam.toLowerCase(), todayUTC(), LANG);
    currentPreview = true;
  } else {
    const last = localStorage.getItem('lastUser');
    if (last) els.uname.value = last;
  }

  applyLang();          // повторно — теперь с загруженным BEACON и (возможно) превью-дропом

  loadFeed();
  setInterval(loadFeed, 30000);

  // счётчик захода: агрегаты по дням, без куки и идентификаторов
  if (location.hostname !== 'localhost') {
    fetch(FEED_URL + '/hit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ r: document.referrer || '' }),
    }).catch(() => {});
  }

  // Уточнение по региону IP — только если язык не выбран вручную, не задан ссылкой
  // и ещё не кэширован. Переключаем, лишь если пользователь пока не трогал тумблер.
  if (!manualPick && !urlPick && !geoCache) {
    const geo = await getGeoLang();
    const stillAuto = localStorage.getItem('langManual') !== '1';
    if (geo && geo !== LANG && stillAuto) {
      LANG = geo;
      applyLang();
    }
  }
}

init();
