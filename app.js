(() => {
'use strict';

/* ---------- Hilfsfunktionen ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Normalisierung ohne Längenänderung (damit Treffer im Originaltext markiert werden können)
const nc = ch => {
  if (ch === 'ß') return 's';
  const d = ch.normalize('NFD')[0];
  return d.toLowerCase();
};
const norm = s => Array.from(String(s), c => c.length === 1 ? nc(c) : c.toLowerCase()).join('');

const slug = s => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

function imgUrl(ref, w) {
  if (!ref) return '';
  if (ref.startsWith('G:')) return 'https://lh3.googleusercontent.com/' + ref.slice(2).split('?')[0] + '=w' + w;
  return ref;
}

const isHeading = t => t.length <= 24 && !/[.!?]/.test(t);

/* ---------- Daten ---------- */
const R = window.REZEPTE.map(r => {
  const hasText = r.ing.length > 0 || r.steps.length > 0;
  const o = { ...r, id: slug(r.n), hasText };
  o.fTitle = norm(r.n);
  o.fIng = norm(r.ing.join(' | '));
  o.fSteps = norm(r.steps.join(' | '));
  o.fMisc = norm(r.folder + ' ' + (r.tags || []).join(' ') + ' ' + (r.src || ''));
  return o;
}).sort((a, b) => a.n.localeCompare(b.n, 'de'));
const byId = Object.fromEntries(R.map(r => [r.id, r]));
const folders = [...new Set(R.map(r => r.folder))].sort((a, b) => a.localeCompare(b, 'de'));

/* ---------- Zustand ---------- */
const state = {
  q: '',
  filter: 'alle',   // alle | fav | text | foto | <Ordnername>
  browse: false,    // true = Liste statt Startbildschirm
  edit: false,      // Startbildschirm im Bearbeitungsmodus
  theme: store.get('rb_theme', 'auto'),
  fav: new Set(store.get('rb_fav', [])),
  scroll: 0
};

/* ---------- Suche ---------- */
function tokens(q) { return norm(q).split(/\s+/).filter(Boolean); }

function search(q) {
  const t = tokens(q);
  let list = R.filter(r => {
    switch (state.filter) {
      case 'fav': return state.fav.has(r.id);
      case 'text': return r.hasText;
      case 'foto': return !r.hasText;
      case 'alle': return true;
      default: return r.folder === state.filter;
    }
  });
  if (!t.length) return list.map(r => ({ r, score: 0, hit: null }));
  const out = [];
  for (const r of list) {
    let score = 0, ok = true, hit = null;
    for (const w of t) {
      const inT = r.fTitle.indexOf(w);
      const inI = r.fIng.indexOf(w);
      const inS = r.fSteps.indexOf(w);
      const inM = r.fMisc.indexOf(w);
      if (inT < 0 && inI < 0 && inS < 0 && inM < 0) { ok = false; break; }
      if (inT >= 0) score += (inT === 0 || /[^a-z0-9]/.test(r.fTitle[inT - 1])) ? 10 : 6;
      if (inI >= 0) { score += 3; hit = hit || { kind: 'ing', w }; }
      if (inS >= 0) { score += 1; hit = hit || { kind: 'step', w }; }
      if (inT < 0 && inI < 0 && inS < 0) score += 0.5;
    }
    if (ok) out.push({ r, score, hit });
  }
  out.sort((a, b) => b.score - a.score || a.r.n.localeCompare(b.r.n, 'de'));
  return out;
}

function highlight(text, t) {
  if (!t.length) return esc(text);
  const n = norm(text);
  const mask = new Array(text.length).fill(false);
  for (const w of t) {
    let i = n.indexOf(w);
    while (i >= 0) { for (let k = i; k < i + w.length; k++) mask[k] = true; i = n.indexOf(w, i + w.length); }
  }
  let out = '', open = false;
  const chars = Array.from(text); // Länge bleibt gleich, da norm() Zeichen 1:1 abbildet
  for (let i = 0; i < chars.length; i++) {
    if (mask[i] && !open) { out += '<mark>'; open = true; }
    if (!mask[i] && open) { out += '</mark>'; open = false; }
    out += esc(chars[i]);
  }
  return out + (open ? '</mark>' : '');
}

function snippet(r, hit, t) {
  if (!hit) return '';
  if (hit.kind === 'ing') {
    const lines = r.ing.filter(l => t.some(w => norm(l).includes(w))).slice(0, 3);
    return 'Zutaten: ' + lines.map(l => highlight(l, t)).join(' · ');
  }
  const s = r.steps.find(l => t.some(w => norm(l).includes(w))) || '';
  const n = norm(s);
  const i = Math.max(0, n.indexOf(hit.w) - 30);
  const part = s.slice(i, i + 110);
  return 'Zubereitung: ' + (i > 0 ? '… ' : '') + highlight(part, t) + (i + 110 < s.length ? ' …' : '');
}

/* ---------- Ansichten ---------- */
const view = $('#view');
const qEl = $('#q');
const clearEl = $('#clear');
const filtersEl = $('#filters');
const countEl = $('#count');


/* ---------- Startbildschirm ---------- */
const isHome = () => !state.q && !state.browse;
const recent = () => store.get('rb_recent', []).map(id => byId[id]).filter(Boolean);
const pushRecent = id => store.set('rb_recent', [id, ...store.get('rb_recent', []).filter(x => x !== id)].slice(0, 8));

function miniCard(r) {
  return `<a class="card mini" href="#/r/${r.id}">
    <div class="ph">${r.cover ? `<img loading="lazy" decoding="async" src="${esc(imgUrl(r.cover, 360))}" alt="">` : ''}</div>
    <div class="body"><h3>${esc(r.n)}</h3></div></a>`;
}

/* ---------- Startbildschirm: Ordner-Icons (sortierbar, editierbar) ---------- */
const ICONS = {
  Brote:'🍞', Reisgerichte:'🍚', Kuchen:'🍰', Asiatisch:'🥢', Beilagen:'🥔', Dessert:'🍮', Dips:'🥣', Eierspeisen:'🍳',
  'Eintöpfe':'🍲', Fisch:'🐟', Fleisch:'🥩', 'Gebäck':'🥐', 'Geflügel':'🍗', 'Gemüse':'🥕', 'Getränke':'🍹', 'Gewürze':'🌶️',
  Gratin:'🧀', Kartoffel:'🥔', Kekse:'🍪', 'Overnight Oats':'🥣', Pizza:'🍕', Salate:'🥗', Saucen:'🫙', Sauerteig:'🥖',
  Snacks:'🥨', Suppen:'🍜', Tapas:'🫒', Teigwaren:'🍝', Vegetarisch:'🥦', Vorspeisen:'🥟', 'Wähen':'🥧', Wild:'🦌', alle:'📖'
};
const COLORS = ['#b5651d', '#c0504d', '#d98e04', '#6b8f71', '#3f8f8a', '#4f7cac', '#7a5c9e', '#a0527c', '#7a4b3a', '#5f6b73'];
const EMOJI_PICK = ['🍞','🥖','🥐','🍰','🧁','🍪','🍮','🍚','🍝','🍜','🥢','🍲','🥗','🥕','🥦','🥔','🍳','🧀','🥩','🍗','🐟','🦐','🦌','🍕','🥧','🥟','🥨','🫒','🌶️','🍹','☕','🥣','🫙','🍯','🍎','🍓','🍋','🍄','🌿','⭐','❤️','🎂','🎄','🍽️'];
const FOLDER_COLORS = Object.fromEntries(folders.map((f, i) => [f, COLORS[i % COLORS.length]]));
FOLDER_COLORS.alle = '#46604b';
const home = (() => { const h = store.get('rb_home', {}); return { order: h.order || [], meta: h.meta || {} }; })();
const saveHome = () => store.set('rb_home', home);
const tileMeta = k => ({ icon: ICONS[k] || '🍽️', color: FOLDER_COLORS[k] || COLORS[0], label: k === 'alle' ? 'Alle Rezepte' : k, show: true, ...(home.meta[k] || {}) });
function orderedKeys() {
  const all = ['alle', ...folders];
  const known = home.order.filter(k => all.includes(k));
  return [...known, ...all.filter(k => !known.includes(k))];
}
const orderedFolders = () => orderedKeys().filter(k => k !== 'alle');

function tileHtml(k) {
  const m = tileMeta(k);
  const n = k === 'alle' ? R.length : R.filter(r => r.folder === k).length;
  return `<button class="tile${m.show ? '' : ' off'}" type="button" data-folder="${esc(k)}" style="--c:${esc(m.color)}">
    <span class="ic">${esc(m.icon)}</span><b>${esc(m.label)}</b><small>${n}</small>${state.edit ? '<i class="pen">✎</i>' : ''}</button>`;
}

function renderHome() {
  countEl.textContent = R.length;
  clearEl.hidden = true;
  const keys = orderedKeys().filter(k => state.edit || k === 'alle' || tileMeta(k).show);
  const rec = recent().slice(0, 6);
  const fav = R.filter(r => state.fav.has(r.id));
  view.innerHTML = `
    <section class="home${state.edit ? ' editing' : ''}">
      <div class="hbar">
        ${state.edit ? '<span class="hint2">Ziehen zum Sortieren, antippen zum Bearbeiten</span><button class="chip" type="button" id="hreset">Zurücksetzen</button>' : '<span></span>'}
        <button class="chip" type="button" id="hedit" aria-pressed="${state.edit}">${state.edit ? 'Fertig' : '✎ Bearbeiten'}</button>
      </div>
      <div class="tiles" id="tiles">${keys.map(tileHtml).join('')}</div>
      ${state.edit ? '' : `<button class="chip big" type="button" id="random">🎲 Was koche ich heute?</button>
      ${rec.length ? `<h3 class="sec">Zuletzt angesehen</h3><div class="strip">${rec.map(miniCard).join('')}</div>` : ''}
      ${fav.length ? `<h3 class="sec">Favoriten</h3><div class="strip">${fav.map(miniCard).join('')}</div>` : ''}`}
    </section>`;
}

/* Bearbeiten: Sortieren per Ziehen */
let drag = null;
view.addEventListener('pointerdown', e => {
  const tile = state.edit && e.target.closest('.tile');
  if (!tile || (e.pointerType === 'mouse' && e.button !== 0)) return;
  drag = { tile, x: e.clientX, y: e.clientY, on: false, id: e.pointerId, ghost: null, dx: 0, dy: 0 };
});
window.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.on) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
    drag.on = true;
    const r = drag.tile.getBoundingClientRect();
    drag.dx = drag.x - r.left; drag.dy = drag.y - r.top;
    const g = drag.tile.cloneNode(true);
    g.classList.add('ghost'); g.style.width = r.width + 'px'; g.style.height = r.height + 'px';
    document.body.appendChild(g); drag.ghost = g;
    drag.tile.classList.add('lifted');
  }
  e.preventDefault();
  drag.ghost.style.transform = `translate(${e.clientX - drag.dx}px,${e.clientY - drag.dy}px)`;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const over = el && el.closest && el.closest('#tiles .tile');
  if (over && over !== drag.tile) {
    const kids = [...over.parentNode.children];
    over.parentNode.insertBefore(drag.tile, kids.indexOf(drag.tile) < kids.indexOf(over) ? over.nextSibling : over);
  }
  const vh = window.innerHeight;
  drag.scroll = e.clientY < 90 ? -14 : e.clientY > vh - 90 ? 14 : 0;
}, { passive: false });
setInterval(() => { if (drag && drag.on && drag.scroll) window.scrollBy(0, drag.scroll); }, 16);
function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag; drag = null;
  if (d.ghost) d.ghost.remove();
  if (d.on) {
    d.tile.classList.remove('lifted');
    home.order = $$('#tiles .tile').map(t => t.dataset.folder);
    saveHome(); renderFilters();
  } else if (e.type === 'pointerup') openTileEditor(d.tile.dataset.folder);
}
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

/* Bearbeiten: Symbol, Name, Farbe, Sichtbarkeit */
function openTileEditor(k) {
  const m = tileMeta(k);
  const o = document.createElement('div');
  o.className = 'sheet-bg';
  o.innerHTML = `<div class="sheet" role="dialog" aria-label="Ordner bearbeiten">
    <h3>Ordner bearbeiten</h3>
    <div class="row"><span class="prev" id="e-prev" style="--c:${esc(m.color)}">${esc(m.icon)}</span>
      <label>Name<input id="e-label" type="text" maxlength="30" value="${esc(m.label)}"></label></div>
    <label>Symbol <small>(eigenes Emoji eintippen oder wählen)</small><input id="e-icon" type="text" maxlength="8" value="${esc(m.icon)}"></label>
    <div class="emojis">${EMOJI_PICK.map(x => `<button type="button" data-e="${x}">${x}</button>`).join('')}</div>
    <div class="swatches">${COLORS.map(c => `<button type="button" data-c="${c}" style="background:${c}" aria-pressed="${c === m.color}" aria-label="Farbe"></button>`).join('')}</div>
    ${k === 'alle' ? '' : `<label class="chk"><input id="e-show" type="checkbox" ${m.show ? 'checked' : ''}> Auf Startseite anzeigen</label>`}
    <div class="acts"><button type="button" class="chip" id="e-reset">Standard</button><button type="button" class="chip on" id="e-ok">Fertig</button></div>
  </div>`;
  document.body.appendChild(o);
  let color = m.color;
  const upd = () => { $('#e-prev', o).textContent = $('#e-icon', o).value || '🍽️'; $('#e-prev', o).style.setProperty('--c', color); };
  const close = (save) => {
    if (save) {
      const meta = { icon: $('#e-icon', o).value.trim() || ICONS[k] || '🍽️', color, label: $('#e-label', o).value.trim() || (k === 'alle' ? 'Alle Rezepte' : k), show: k === 'alle' ? true : $('#e-show', o).checked };
      home.meta[k] = meta; saveHome();
    }
    o.remove(); refresh();
  };
  o.addEventListener('click', e => {
    if (e.target === o) return close(true);
    const em = e.target.closest('[data-e]'); if (em) { $('#e-icon', o).value = em.dataset.e; upd(); return; }
    const c = e.target.closest('[data-c]'); if (c) { color = c.dataset.c; $$('.swatches button', o).forEach(b => b.setAttribute('aria-pressed', b === c)); upd(); return; }
    if (e.target.id === 'e-reset') { delete home.meta[k]; saveHome(); o.remove(); refresh(); return; }
    if (e.target.id === 'e-ok') close(true);
  });
  $('#e-icon', o).addEventListener('input', upd);
}

function refresh() {
  const home = isHome() && !location.hash.startsWith('#/r/');
  filtersEl.style.display = home ? 'none' : '';
  home ? renderHome() : renderList();
}

/* ---------- Darstellung ---------- */
function applyTheme() {
  const t = state.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  $$('#settings [data-theme]').forEach(b => b.setAttribute('aria-pressed', b.dataset.theme === t));
}

function renderFilters() {
  const nFav = R.filter(r => state.fav.has(r.id)).length;
  const items = [
    ['alle', 'Alle', R.length],
    ['fav', '★ Favoriten', nFav],
    ['text', 'Mit Text', R.filter(r => r.hasText).length],
    ['foto', 'Nur Fotos', R.filter(r => !r.hasText).length]
  ];
  if (folders.length > 1) orderedFolders().forEach(f => items.push([f, f, R.filter(r => r.folder === f).length]));
  filtersEl.innerHTML = items.map(([k, l, n]) =>
    `<button class="chip" type="button" data-f="${esc(k)}" aria-pressed="${state.filter === k}">${esc(l)}<small>${n}</small></button>`).join('');
}

function renderList() {
  const t = tokens(state.q);
  const res = search(state.q);
  countEl.textContent = res.length === R.length ? R.length : res.length + ' von ' + R.length;
  clearEl.hidden = !state.q;
  if (!res.length) {
    view.innerHTML = `<div class="empty"><b>Nichts gefunden</b>${state.q ? 'Für „' + esc(state.q) + '“ gibt es keine Treffer.' : 'In dieser Auswahl ist noch nichts.'}
      ${state.q && R.some(r => !r.hasText) ? '<br><small>Rezepte, die nur als Foto vorliegen, lassen sich nur über den Titel finden.</small>' : ''}</div>`;
    return;
  }
  const hint = state.q && state.filter !== 'text'
    ? `<p class="hint">Suche in Titel, Zutaten und Zubereitung. Reine Foto-Rezepte werden nur über den Titel gefunden.</p>` : '';
  view.innerHTML = hint + '<div class="grid">' + res.map(({ r, hit }) => {
    const sn = snippet(r, hit, t);
    return `<a class="card" href="#/r/${r.id}">
      <div class="ph">${r.cover ? `<img loading="lazy" decoding="async" src="${esc(imgUrl(r.cover, 480))}" alt="">` : ''}</div>
      <div class="body"><h3>${highlight(r.n, t)}</h3>
      ${sn ? `<div class="sn">${sn}</div>` : ''}
      <div class="tags"><span class="tag">${esc(r.folder)}</span>${r.hasText ? '' : '<span class="tag photo">Foto</span>'}${state.fav.has(r.id) ? '<span class="tag fav">★</span>' : ''}</div></div></a>`;
  }).join('') + '</div>';
}


/* ---------- Portionen ---------- */
const FR = { '½': .5, '¼': .25, '¾': .75, '⅓': 1/3, '⅔': 2/3 };
const NUM = String.raw`(?:\d+(?:[.,]\d+)?(?:\s+\d\/\d)?|\d\/\d|[½¼¾⅓⅔])`;
const QTY = new RegExp(`^(${NUM})(?:(\\s*[-–]\\s*)(${NUM}))?(?=$|[\\s.,;]|[a-zA-ZäöüÄÖÜ])`);
function parseNum(t) {
  t = t.trim();
  if (FR[t] != null) return FR[t];
  let m = t.match(/^(\d+)\s+(\d)\/(\d)$/); if (m) return +m[1] + m[2] / m[3];
  m = t.match(/^(\d)\/(\d)$/); if (m) return m[1] / m[2];
  return parseFloat(t.replace(',', '.'));
}
function fmtNum(v) {
  if (v >= 10) return String(Math.round(v));
  const q = Math.round(v * 4) / 4;
  if (Math.abs(v - q) > .06 && v >= 1) return String(Math.round(v * 10) / 10).replace('.', ',');
  const w = Math.floor(q), f = q - w;
  const fs = f === .25 ? '1/4' : f === .5 ? '1/2' : f === .75 ? '3/4' : '';
  if (q === 0) return String(Math.round(v * 100) / 100).replace('.', ',');
  return (w ? w : '') + (w && fs ? ' ' : '') + fs;
}
function scaleLine(l, f) {
  if (f === 1) return l;
  const m = l.match(QTY); if (!m) return l;
  const a = parseNum(m[1]); if (!isFinite(a)) return l;
  let out = fmtNum(a * f);
  if (m[3]) { const b = parseNum(m[3]); if (isFinite(b)) out += m[2] + fmtNum(b * f); }
  return out + l.slice(m[0].length);
}
function portState(id) {
  const p = store.get('rb_port_' + id, null) || {};
  const def = (byId[id] && byId[id].port) || 4;
  const b = Math.max(1, Math.min(99, +p.b || def));
  return { b, n: Math.max(1, Math.min(99, +p.n || b)) };
}
function ingListHtml(r) {
  const done = new Set(store.get('rb_done_' + r.id, []));
  const p = portState(r.id), f = p.n / p.b;
  return r.ing.map((l, i) => `<li data-i="${i}" class="${done.has(i) ? 'done' : ''}"><span class="box"></span><span>${esc(scaleLine(l, f))}</span></li>`).join('');
}
function portBarHtml(r) {
  const p = portState(r.id);
  return `<div class="port" id="port"><span class="pl">Portionen</span>
    <button type="button" class="pbtn" data-act="dec" aria-label="Weniger">−</button>
    <input class="pn" id="pn" type="number" inputmode="numeric" min="1" max="99" value="${p.n}" aria-label="Portionen">
    <button type="button" class="pbtn" data-act="inc" aria-label="Mehr">+</button>
    <span class="pb">Rezept für <input class="pn small" id="pbase" type="number" inputmode="numeric" min="1" max="99" value="${p.b}" aria-label="Rezept ist gedacht für"></span></div>
    <p class="note" id="pnote" ${p.n === p.b ? 'hidden' : ''}>Mengen in der Zubereitung werden nicht umgerechnet.</p>`;
}
function setPort(r, patch) {
  const p = { ...portState(r.id), ...patch };
  p.b = Math.max(1, Math.min(99, Math.round(p.b) || 4)); p.n = Math.max(1, Math.min(99, Math.round(p.n) || p.b));
  const def = r.port || 4;
  if (p.b === def && p.n === def) localStorage.removeItem('rb_port_' + r.id); else store.set('rb_port_' + r.id, p);
  const ul = $('.ing'); if (ul) ul.innerHTML = ingListHtml(r);
  const note = $('#pnote'); if (note) note.hidden = p.n === p.b;
  const pn = $('#pn'), pb = $('#pbase');
  if (pn && document.activeElement !== pn) pn.value = p.n;
  if (pb && document.activeElement !== pb) pb.value = p.b;
}

function renderDetail(r) {
  const done = new Set(store.get('rb_done_' + r.id, []));
  const ing = r.ing.length ? `<section class="panel"><h3>Zutaten</h3>${portBarHtml(r)}<ul class="ing">${ingListHtml(r)}</ul></section>` : '';
  const steps = r.steps.length ? `<section class="panel"><h3>Zubereitung</h3><ol class="steps">${
    r.steps.map(s => isHeading(s) ? `<li class="h"><b>${esc(s)}</b></li>` : `<li>${esc(s)}</li>`).join('')}</ol></section>` : '';
  const pagesTitle = r.hasText ? 'Fotos' : 'Rezeptseiten (Fotos)';
  const pages = r.pages.length ? `<section class="panel"><h3>${pagesTitle}</h3>${
    r.hasText ? '' : '<p class="note">Dieses Rezept liegt nur als Foto vor. Zum Vergrössern antippen.</p>'}
    <div class="${r.hasText ? 'gallery' : 'pages'}">${r.pages.map(p =>
      `<img loading="lazy" decoding="async" src="${esc(imgUrl(p, r.hasText ? 400 : 900))}" data-full="${esc(imgUrl(p, 1800))}" alt="${esc(r.n)}">`).join('')}</div></section>` : '';
  let host = '';
  if (r.src) { try { host = new URL(r.src).hostname.replace(/^(www|m)\./, ''); } catch {} }
  view.innerHTML = `
    <button class="back" type="button" id="back">‹ Zurück</button>
    ${r.cover ? `<div class="hero"><img src="${esc(imgUrl(r.cover, 1200))}" data-full="${esc(imgUrl(r.cover, 1800))}" alt="${esc(r.n)}"></div>` : ''}
    <div class="head"><h2>${esc(r.n)}</h2>
      <button class="star" type="button" id="star" aria-pressed="${state.fav.has(r.id)}" aria-label="Favorit">${state.fav.has(r.id) ? '★' : '☆'}</button></div>
    <div class="meta"><span class="tag">${esc(r.folder)}</span>${(r.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}${host ? `<a href="${esc(r.src)}" target="_blank" rel="noopener">Quelle: ${esc(host)}</a>` : ''}</div>
    <div class="cols ${ing && steps ? 'two' : ''}">${ing}${steps}${pages}</div>`;
  countEl.textContent = '';
  window.scrollTo(0, 0);
}

/* ---------- Routing ---------- */
function route() {
  const m = location.hash.match(/^#\/r\/(.+)$/);
  const r = m && byId[decodeURIComponent(m[1])];
  document.body.classList.toggle('detail', !!r);
  if (r) state.edit = false;
  $('.searchbox').style.display = filtersEl.style.display = r ? 'none' : '';
  if (r) { document.title = r.n + ' · Rezeptbuch'; pushRecent(r.id); renderDetail(r); }
  else {
    document.title = 'Rezeptbuch';
    refresh();
    requestAnimationFrame(() => window.scrollTo(0, state.scroll));
  }
}
window.addEventListener('hashchange', route);
window.addEventListener('scroll', () => { if (!location.hash.startsWith('#/r/')) state.scroll = window.scrollY; }, { passive: true });

/* ---------- Ereignisse ---------- */
qEl.addEventListener('input', () => { state.q = qEl.value.trim(); refresh(); });
qEl.addEventListener('keydown', e => { if (e.key === 'Enter') qEl.blur(); if (e.key === 'Escape') { qEl.value = ''; state.q = ''; refresh(); } });
clearEl.addEventListener('click', () => { qEl.value = ''; state.q = ''; refresh(); qEl.focus(); });
$('#brand').addEventListener('click', () => { qEl.value = ''; state.q = ''; state.filter = 'alle'; state.browse = false; state.edit = false; state.scroll = 0; renderFilters(); if (location.hash) location.hash = ''; else route(); });
filtersEl.addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  state.filter = b.dataset.f; state.browse = true;
  renderFilters(); refresh(); window.scrollTo(0, 0);
});
document.addEventListener('keydown', e => {
  if (e.key === '/' && document.activeElement !== qEl && !location.hash.startsWith('#/r/')) { e.preventDefault(); qEl.focus(); qEl.select(); }
});

view.addEventListener('input', e => {
  const t = e.target; if (t.id !== 'pn' && t.id !== 'pbase') return;
  const v = parseInt(t.value, 10); if (!(v >= 1)) return;
  const r = byId[decodeURIComponent(location.hash.slice(4))];
  setPort(r, t.id === 'pn' ? { n: v } : { b: v });
});
view.addEventListener('click', e => {
  if (e.target.closest('#hedit')) { state.edit = !state.edit; refresh(); window.scrollTo(0, 0); return; }
  if (e.target.closest('#hreset')) { if (confirm('Reihenfolge, Namen, Symbole und Farben der Ordner zurücksetzen?')) { home.order = []; home.meta = {}; saveHome(); renderFilters(); refresh(); } return; }
  const tile = e.target.closest('.tile');
  if (tile && state.edit) return;
  if (tile) { state.filter = tile.dataset.folder; state.browse = true; renderFilters(); refresh(); window.scrollTo(0, 0); return; }
  if (e.target.closest('#random')) { const r = R[Math.floor(Math.random() * R.length)]; location.hash = '#/r/' + r.id; return; }
  const back = e.target.closest('#back');
  if (back) { history.length > 1 ? history.back() : (location.hash = ''); return; }
  const star = e.target.closest('#star');
  if (star) {
    const r = byId[decodeURIComponent(location.hash.slice(4))];
    state.fav.has(r.id) ? state.fav.delete(r.id) : state.fav.add(r.id);
    store.set('rb_fav', [...state.fav]);
    star.setAttribute('aria-pressed', state.fav.has(r.id)); star.textContent = state.fav.has(r.id) ? '★' : '☆';
    renderFilters(); return;
  }
  const pbtn = e.target.closest('.pbtn');
  if (pbtn) {
    const r = byId[decodeURIComponent(location.hash.slice(4))];
    setPort(r, { n: portState(r.id).n + (pbtn.dataset.act === 'inc' ? 1 : -1) }); return;
  }
  const li = e.target.closest('.ing li');
  if (li) {
    const r = byId[decodeURIComponent(location.hash.slice(4))];
    const done = new Set(store.get('rb_done_' + r.id, []));
    const i = +li.dataset.i;
    done.has(i) ? done.delete(i) : done.add(i);
    li.classList.toggle('done', done.has(i));
    store.set('rb_done_' + r.id, [...done]); return;
  }
  const img = e.target.closest('img[data-full]');
  if (img) openLightbox(img.dataset.full);
});

const lb = $('#lightbox');
function openLightbox(src) { $('img', lb).src = src; lb.hidden = false; }
lb.addEventListener('click', () => { lb.hidden = true; $('img', lb).removeAttribute('src'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !lb.hidden) lb.click(); });


/* ---------- Einstellungen ---------- */
const settingsEl = $('#settings');
$('#gear').addEventListener('click', e => { e.stopPropagation(); settingsEl.hidden = !settingsEl.hidden; });
document.addEventListener('click', e => { if (!settingsEl.hidden && !e.target.closest('#settings')) settingsEl.hidden = true; });
settingsEl.addEventListener('click', async e => {
  const t = e.target.closest('[data-theme]');
  if (t) { state.theme = t.dataset.theme; store.set('rb_theme', state.theme); applyTheme(); return; }
  if (e.target.closest('#update')) {
    e.target.textContent = 'Aktualisiere …';
    try {
      (await navigator.serviceWorker.getRegistrations()).forEach(r => r.unregister());
      (await caches.keys()).forEach(k => caches.delete(k));
    } catch {}
    setTimeout(() => location.reload(), 400);
  }
});
applyTheme();

/* ---------- Start ---------- */
renderFilters();
route();
let reloaded = false;
if ('serviceWorker' in navigator && navigator.serviceWorker.controller) navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
})();
