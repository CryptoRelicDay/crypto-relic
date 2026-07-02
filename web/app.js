import { rollDrop, dropLine } from './engine.mjs';

// ---------- Вспомогательное ----------
const $ = (id) => document.getElementById(id);
const todayUTC = () => new Date().toISOString().slice(0, 10);

const els = {
  beacon: $('beacon'), uname: $('uname'), openBtn: $('openBtn'), hint: $('hint'),
  cardHost: $('cardHost'), shareRow: $('shareRow'), shareX: $('shareX'), copyLink: $('copyLink'),
  grid: $('grid'), emptyColl: $('emptyColl'), streak: $('streak'),
};

let BEACON = null;         // { hash, height }
let currentDrop = null;    // последний показанный дроп

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

// ---------- Хранилище коллекции ----------
function loadCollection() {
  try { return JSON.parse(localStorage.getItem('collection') || '[]'); }
  catch { return []; }
}
function saveToCollection(drop) {
  const coll = loadCollection();
  if (coll.some((c) => c.date === drop.date && c.username === drop.username)) return;
  coll.unshift({
    date: drop.date, username: drop.username, name: drop.name,
    rarityKey: drop.rarity.key, rarityLabel: drop.rarity.label, color: drop.rarity.color,
    height: drop.beaconHeight, float: drop.float, serial: drop.serial, trait: drop.trait,
  });
  localStorage.setItem('collection', JSON.stringify(coll.slice(0, 200)));
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
  els.streak.textContent = `Стрик: ${raw.count || 0} дн.`;
}

// ---------- Рендер карточки ----------
function renderCard(drop, { preview = false } = {}) {
  const r = drop.rarity;
  els.cardHost.hidden = false;
  els.cardHost.innerHTML = `
    <div class="relic" style="--rar:${r.color};--glow:${r.glow}">
      <span class="rar-badge">${r.label}</span>
      <p class="name">${drop.name}</p>
      ${drop.trait ? `<p class="trait">✦ ${drop.trait}</p>` : '<p class="trait" style="visibility:hidden">–</p>'}
      <div class="meta">
        <span>Флоат <b>${drop.float}</b></span>
        <span>Печать <b>${drop.serial}</b></span>
        <span>Ник <b>${drop.username}</b></span>
      </div>
      <div class="origin">Добыто из блока <b>#${drop.beaconHeight}</b> · ${drop.beaconShort}… · ${drop.date}</div>
    </div>`;
  els.shareRow.hidden = false;
  currentDrop = drop;
  els.hint.textContent = preview
    ? `Это дроп ника «${drop.username}». Вбей свой и открой собственный ☝️`
    : 'Реликвия дня зафиксирована. Возвращайся завтра за новой.';
}

// ---------- Рендер коллекции ----------
function renderCollection() {
  const coll = loadCollection();
  els.emptyColl.hidden = coll.length > 0;
  els.grid.innerHTML = coll.map((c) => `
    <div class="cell" style="--cl:${c.color}">
      <div class="cr">${c.rarityLabel}</div>
      <div class="cn">${c.name}</div>
      <div class="cd">#${c.height} · ${c.date}</div>
    </div>`).join('');
}

// ---------- Открытие ----------
function alreadyOpenedToday(username) {
  return loadCollection().some((c) => c.date === todayUTC() && c.username === username.trim().toLowerCase());
}

function doOpen() {
  const username = els.uname.value.trim();
  if (!username) { els.hint.textContent = 'Введи ник — без него дропа нет.'; return; }
  if (!BEACON) { els.hint.textContent = 'Ещё гружу блок, секунду…'; return; }

  const uname = username.toLowerCase();
  const date = todayUTC();
  const drop = rollDrop(BEACON, uname, date);

  if (alreadyOpenedToday(uname)) {
    renderCard(drop);
    els.hint.textContent = 'Сегодня этот ник уже открывал. Вот твоя реликвия дня.';
    return;
  }

  saveToCollection(drop);
  const streak = updateStreak(date);
  renderCard(drop);
  renderCollection();
  renderStreak();
  els.streak.textContent = `Стрик: ${streak} дн.`;
  els.uname.value = uname;
  localStorage.setItem('lastUser', uname);
}

// ---------- Шеринг ----------
function shareUrl(username) {
  const base = location.origin + location.pathname;
  return `${base}?u=${encodeURIComponent(username)}`;
}
function shareToX() {
  if (!currentDrop) return;
  const text = `Моя крипто-реликвия дня: ${dropLine(currentDrop)}.\nПроверь, что выпадет твоему нику 👇`;
  const url = shareUrl(currentDrop.username);
  const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  window.open(intent, '_blank', 'noopener');
}
async function copyLink() {
  if (!currentDrop) return;
  try {
    await navigator.clipboard.writeText(shareUrl(currentDrop.username));
    els.copyLink.textContent = 'Скопировано ✓';
    setTimeout(() => (els.copyLink.textContent = 'Скопировать ссылку'), 1500);
  } catch { els.hint.textContent = 'Не удалось скопировать — скопируй ссылку из адресной строки.'; }
}

// ---------- Инициализация ----------
async function init() {
  renderCollection();
  renderStreak();

  els.openBtn.addEventListener('click', doOpen);
  els.uname.addEventListener('keydown', (e) => { if (e.key === 'Enter') doOpen(); });
  els.shareX.addEventListener('click', shareToX);
  els.copyLink.addEventListener('click', copyLink);

  BEACON = await getBeacon();
  if (BEACON.height > 0) {
    els.beacon.innerHTML = `Печать дня: блок <b>#${BEACON.height}</b> · ${BEACON.hash.slice(0, 10)}…`;
  } else {
    els.beacon.innerHTML = `Оффлайн-режим · маяк из даты ${todayUTC()}`;
  }
  els.openBtn.disabled = false;

  // Deep-link ?u=ник — показать превью чужого дропа (виральный крючок).
  const params = new URLSearchParams(location.search);
  const uParam = params.get('u');
  if (uParam) {
    const drop = rollDrop(BEACON, uParam.toLowerCase(), todayUTC());
    renderCard(drop, { preview: true });
    els.uname.placeholder = 'вбей свой ник…';
  } else {
    const last = localStorage.getItem('lastUser');
    if (last) els.uname.value = last;
  }
}

init();
