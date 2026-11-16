(() => {
'use strict';
const APP_VERSION = '1.5.1';

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
  // Ordner mit Unterordnern: ohne Suchbegriff nur die direkt zugeordneten Rezepte, den Rest zeigen die Unterordner
  const fset = FB[state.filter] ? (!t.length && kids(state.filter).some(f => f.show) ? new Set([state.filter]) : subtree(state.filter)) : null;
  let list = R.filter(r => {
    switch (state.filter) {
      case 'fav': return state.fav.has(r.id);
      case 'text': return r.hasText;
      case 'foto': return !r.hasText;
      case 'alle': return true;
      default: return fset ? foldersOf(r).some(x => fset.has(x)) : true;
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

/* ---------- Konfiguration: Ordner, Favoriten, Grösse (liegt als config.json im Repo) ---------- */
const REPO = 'claudemn61/Rezeptbuch', CFG_PATH = 'config.json';
const ICONS = {
  Brote:'🍞', Reisgerichte:'🍚', Kuchen:'🍰', Asiatisch:'🥢', Beilagen:'🥔', Dessert:'🍮', Dips:'🥣', Eierspeisen:'🍳',
  'Eintöpfe':'🍲', Fisch:'🐟', Fleisch:'🥩', 'Gebäck':'🥐', 'Geflügel':'🍗', 'Gemüse':'🥕', 'Getränke':'🍹', 'Gewürze':'🌶️',
  Gratin:'🧀', Kartoffel:'🥔', Kekse:'🍪', 'Overnight Oats':'🥣', Pizza:'🍕', Salate:'🥗', Saucen:'🫙', Sauerteig:'🥖',
  Snacks:'🥨', Suppen:'🍜', Tapas:'🫒', Teigwaren:'🍝', Vegetarisch:'🥦', Vorspeisen:'🥟', 'Wähen':'🥧', Wild:'🦌', alle:'📖'
};
const COLORS = ['#b5651d', '#c0504d', '#d98e04', '#6b8f71', '#3f8f8a', '#4f7cac', '#7a5c9e', '#a0527c', '#7a4b3a', '#5f6b73'];
const EMOJI_PICK = ['📁','🍞','🥖','🥐','🍰','🧁','🍪','🍮','🍚','🍝','🍜','🥢','🍲','🥗','🥕','🥦','🥔','🍳','🧀','🥩','🍗','🐟','🦐','🦌','🍕','🥧','🥟','🥨','🫒','🌶️','🍹','☕','🥣','🫙','🍯','🍎','🍓','🍋','🍄','🌿','⭐','❤️','🎂','🎄','🍽️'];
const BUILTIN = new Set(folders);
const defColor = id => COLORS[Math.max(0, folders.indexOf(id)) % COLORS.length];
const defFolder = id => ({ id, name: id, icon: ICONS[id] || '🍽️', color: defColor(id), parent: null, show: true });

function normalize(c) {
  c = c || {};
  const out = { v: 1, size: ['s', 'm', 'l'].includes(c.size) ? c.size : 'm', photos: c.photos === true, fav: (Array.isArray(c.fav) ? c.fav : []).filter(x => byId[x]), assign: {}, folders: [] };
  const seen = new Set();
  (c.folders || []).forEach(f => {
    if (!f || !f.id || seen.has(f.id)) return; seen.add(f.id);
    out.folders.push({ id: String(f.id), name: String(f.name || f.id), icon: f.icon || ICONS[f.id] || '📁', color: f.color || defColor(f.id), parent: f.parent || null, show: f.show !== false });
  });
  folders.forEach(b => { if (!seen.has(b)) out.folders.push(defFolder(b)); });
  const ids = new Set(out.folders.map(f => f.id));
  out.folders.forEach(f => { if (f.parent && (!ids.has(f.parent) || f.parent === f.id)) f.parent = null; });
  out.folders.forEach(f => { let p = f, n = 0; while (p && p.parent && n++ < 60) p = out.folders.find(x => x.id === p.parent); if (n >= 60) f.parent = null; });
  Object.entries(c.assign || {}).forEach(([rid, fid]) => { const l = [].concat(fid).filter(x => ids.has(x)); if (byId[rid] && l.length) out.assign[rid] = [...new Set(l)]; });
  return out;
}
let cfg = normalize(store.get('rb_pending', null) || store.get('rb_cfgcache', null));
let FB = {};
const reindex = () => { FB = Object.fromEntries(cfg.folders.map(f => [f.id, f])); };
reindex();
state.fav = new Set(cfg.fav.length ? cfg.fav : store.get('rb_fav', []));

const kids = parent => cfg.folders.filter(f => (f.parent || null) === (parent || null));
function subtree(id) {
  const s = new Set([id]); let ch = true;
  while (ch) { ch = false; cfg.folders.forEach(f => { if (f.parent && s.has(f.parent) && !s.has(f.id)) { s.add(f.id); ch = true; } }); }
  return s;
}
const foldersOf = r => { const a = (cfg.assign[r.id] || []).filter(x => FB[x]); return a.length ? a : [FB[r.folder] ? r.folder : (cfg.folders[0] || {}).id]; };
const folderName = id => (FB[id] || {}).name || id;
const countIn = id => { const s = subtree(id); return R.filter(r => foldersOf(r).some(x => s.has(x))).length; };
function pathOf(id) { const p = []; let f = FB[id], n = 0; while (f && n++ < 60) { p.unshift(f); f = f.parent && FB[f.parent]; } return p; }
const rootOf = id => (pathOf(id)[0] || {}).id;
function flat(parent = null, depth = 0, skip = null) {
  return kids(parent).flatMap(f => f.id === skip ? [] : [{ f, depth }, ...flat(f.id, depth + 1, skip)]);
}
const newId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

/* ---------- Speichern im Repo (GitHub-API) ---------- */
const API = `https://api.github.com/repos/${REPO}/contents/${CFG_PATH}`;
const sync = { sha: null, timer: null, saving: false, again: false, dirty: !!store.get('rb_pending', null), msg: '', kind: '' };
const getToken = () => (localStorage.getItem('rb_token') || '').trim();
const hdr = (tok, json) => ({ Accept: 'application/vnd.github+json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}) });
const b64enc = s => { const b = new TextEncoder().encode(s); let t = ''; for (let i = 0; i < b.length; i += 8192) t += String.fromCharCode(...b.subarray(i, i + 8192)); return btoa(t); };
const b64dec = s => { const t = atob(s.replace(/\s/g, '')); return new TextDecoder().decode(Uint8Array.from(t, c => c.charCodeAt(0))); };
function setSync(msg, kind) {
  sync.msg = msg; sync.kind = kind;
  const el = $('#syncstat'); if (el) { el.textContent = msg; el.dataset.k = kind || ''; }
  const bar = $('#savebar'); if (bar) { bar.textContent = msg; bar.dataset.k = kind || ''; }
}
async function ghGet() {
  let r = await fetch(`${API}?ref=main&_=${Date.now()}`, { headers: hdr(getToken()), cache: 'no-store' });
  if (r.status === 401) r = await fetch(`${API}?ref=main&_=${Date.now()}`, { headers: hdr(''), cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('GET ' + r.status);
  const j = await r.json(); sync.sha = j.sha;
  return JSON.parse(b64dec(j.content));
}
function persist() {
  cfg.fav = [...state.fav];
  reindex(); sync.dirty = true;
  store.set('rb_pending', cfg);
  clearTimeout(sync.timer);
  if (!getToken()) { setSync('⚠ Nicht gespeichert: GitHub-Token fehlt (Einstellungen)', 'err'); return; }
  setSync('Speichere …', '');
  sync.timer = setTimeout(flush, 700);
}
async function flush() {
  if (sync.saving) { sync.again = true; return; }
  sync.saving = true;
  try {
    for (let i = 0; i < 3; i++) {
      const body = { message: 'App: Ordner/Einstellungen aktualisiert', content: b64enc(JSON.stringify(cfg, null, 1) + '\n'), branch: 'main' };
      if (sync.sha) body.sha = sync.sha;
      const r = await fetch(API, { method: 'PUT', headers: hdr(getToken(), true), body: JSON.stringify(body) });
      if (r.ok) { const j = await r.json(); sync.sha = j.content.sha; sync.dirty = false; localStorage.removeItem('rb_pending'); store.set('rb_cfgcache', cfg); setSync('✓ Gespeichert', 'ok'); break; }
      if (r.status === 409 || r.status === 422) { try { await ghGet(); } catch {} continue; }
      if (r.status === 401 || r.status === 403 || r.status === 404) { setSync('⚠ Token ungültig oder ohne Schreibrecht für das Repo', 'err'); break; }
      throw new Error('PUT ' + r.status);
    }
  } catch { setSync('⚠ Offline: Änderung noch nicht gespeichert', 'err'); }
  sync.saving = false;
  if (sync.again) { sync.again = false; flush(); }
}
async function loadRemote(quiet) {
  try {
    const remote = await ghGet();
    if (sync.dirty) { if (getToken()) flush(); return; }
    if (remote) {
      cfg = normalize(remote); reindex(); state.fav = new Set(cfg.fav); store.set('rb_cfgcache', cfg);
      const legacy = store.get('rb_fav', []).filter(x => byId[x] && !state.fav.has(x));
      if (legacy.length && getToken()) { legacy.forEach(x => state.fav.add(x)); persist(); localStorage.removeItem('rb_fav'); }
    }
    applySize(); renderFilters();
    if (!state.edit && !document.querySelector('.sheet-bg') && !location.hash.startsWith('#/r/')) refresh();
    if (!quiet) setSync(getToken() ? '✓ Aktuell' : 'Nur lesen (kein Token eingetragen)', getToken() ? 'ok' : '');
  } catch { if (!quiet) setSync('Offline: zuletzt geladene Daten', 'err'); }
}
function folderPhoto(id) {
  const sub = subtree(id);
  const c = R.filter(r => r.cover && foldersOf(r).some(x => sub.has(x)));
  const best = c.find(r => r.ing && r.ing.length && r.steps && r.steps.length) || c[0];
  return best ? imgUrl(best.cover, 240) : '';
}
function applySize() {
  $$('#photoseg [data-photos]').forEach(b => b.setAttribute('aria-pressed', (b.dataset.photos === '1') === !!cfg.photos));
  document.documentElement.dataset.size = cfg.size;
  $$('#sizeseg [data-size]').forEach(b => b.setAttribute('aria-pressed', b.dataset.size === cfg.size));
}

/* ---------- Startbildschirm & Ordnerseiten ---------- */
let sel = null; // Auswahl-Modus: Set von Ordner-IDs
function tileHtml(f) {
  const sub = kids(f.id).length;
  const ph = cfg.photos ? folderPhoto(f.id) : '';
  return `<button class="tile${f.show ? '' : ' off'}${ph ? ' hasphoto' : ''}${sel && sel.has(f.id) ? ' sel' : ''}" type="button" data-folder="${esc(f.id)}" style="--c:${esc(f.color)}">
    ${ph ? `<span class="ic photo" style="background-image:url('${esc(ph)}')"></span>` : `<span class="ic">${esc(f.icon)}</span>`}<b>${esc(f.name)}</b><small>${countIn(f.id)}${sub ? ' · ' + sub + '📁' : ''}</small>${sel ? '<i class="pen chk">✓</i>' : state.edit ? '<i class="pen">✎</i>' : ''}</button>`;
}
function tilesBlock(parent) {
  const list = kids(parent).filter(f => state.edit || f.show);
  const all = !parent && !state.edit ? '' : '';
  const allTile = parent ? '' : `<button class="tile all fixed" type="button" data-folder="alle" style="--c:#46604b"><span class="ic">📖</span><b>Alle Rezepte</b><small>${R.length}</small></button>`;
  if (!list.length && !state.edit && parent) return '';
  return `<div class="tiles" id="tiles" data-parent="${esc(parent || '')}">${allTile}${list.map(tileHtml).join('')}${state.edit ? `<button class="tile add fixed" type="button" id="hadd"><span class="ic">＋</span><b>Neuer Ordner</b></button>` : ''}</div>`;
}
function barHtml() {
  return `<div class="hbar">${state.edit ? (sel ? '<span class="hint2">Ordner antippen zum Auswählen</span>' : '<span class="hint2">Ziehen = sortieren · antippen = bearbeiten</span>') : '<span></span>'}
    ${state.edit && !sel ? '<button class="chip" type="button" id="hsel">☑ Mehrere wählen</button>' : ''}
    <button class="chip" type="button" id="hedit" aria-pressed="${state.edit}">${state.edit ? 'Fertig' : '✎ Ordner bearbeiten'}</button></div>
    ${sel ? `<div class="selbar"><span id="selcount">${sel.size} gewählt</span><button class="chip" type="button" id="selcancel">Abbrechen</button><button class="chip" type="button" id="selup" ${sel.size ? '' : 'disabled'}>← Ebene hoch</button><button class="chip" type="button" id="seldown" ${sel.size ? '' : 'disabled'}>→ Ebene tiefer</button><button class="chip on" type="button" id="selmove" ${sel.size ? '' : 'disabled'}>Verschieben nach …</button></div>` : ''}
    ${state.edit ? '<div id="savebar" class="savebar"></div>' : ''}`;
}
function renderHome() {
  countEl.textContent = R.length;
  clearEl.hidden = true;
  const rec = recent().slice(0, 6);
  const fav = R.filter(r => state.fav.has(r.id));
  view.innerHTML = `
    <section class="home${state.edit ? ' editing' : ''}">
      ${barHtml()}
      ${tilesBlock(null)}
      ${state.edit ? '' : `<button class="chip big" type="button" id="random">🎲 Was koche ich heute?</button>
      ${rec.length ? `<h3 class="sec">Zuletzt angesehen</h3><div class="strip">${rec.map(miniCard).join('')}</div>` : ''}
      ${fav.length ? `<h3 class="sec">Favoriten</h3><div class="strip">${fav.map(miniCard).join('')}</div>` : ''}`}
    </section>`;
  if (state.edit) setSync(sync.msg, sync.kind);
}

/* Bearbeiten: Sortieren per Ziehen */
let drag = null;
view.addEventListener('pointerdown', e => {
  const tile = state.edit && !sel && e.target.closest('#tiles .tile');
  if (!tile || tile.classList.contains('fixed') || (e.pointerType === 'mouse' && e.button !== 0)) return;
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
  if (over && over !== drag.tile && !over.classList.contains('fixed')) {
    const kidsEls = [...over.parentNode.children];
    over.parentNode.insertBefore(drag.tile, kidsEls.indexOf(drag.tile) < kidsEls.indexOf(over) ? over.nextSibling : over);
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
    const box = $('#tiles'); const parent = box.dataset.parent || null;
    const ids = $$('.tile[data-folder]', box).map(t => t.dataset.folder).filter(id => FB[id] && (FB[id].parent || null) === parent);
    const slots = cfg.folders.map((f, i) => (f.parent || null) === parent ? i : -1).filter(i => i >= 0);
    const objs = ids.map(id => FB[id]);
    if (objs.length === slots.length) { slots.forEach((ix, j) => { cfg.folders[ix] = objs[j]; }); persist(); renderFilters(); }
  } else if (e.type === 'pointerup') openTileEditor(d.tile.dataset.folder);
}
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

/* Mehrere Ordner unter einen Überordner verschieben */
function openMoveSheet() {
  const ids = [...sel].filter(id => FB[id]);
  const bad = new Set(); ids.forEach(id => subtree(id).forEach(x => bad.add(x)));
  const rows = [`<button type="button" class="mv" data-to="">🏠 Hauptebene</button>`,
    ...flat().filter(({ f }) => !bad.has(f.id)).map(({ f, depth }) =>
      `<button type="button" class="mv" data-to="${esc(f.id)}" style="padding-left:${12 + depth * 18}px">${esc(f.icon)} ${esc(f.name)}</button>`)].join('');
  const o = document.createElement('div');
  o.className = 'sheet-bg';
  o.innerHTML = `<div class="sheet" role="dialog" aria-label="Verschieben"><h3>${ids.length} Ordner verschieben nach</h3><div class="mvlist">${rows}</div>
    <div class="acts"><button type="button" class="chip" id="mv-cancel">Abbrechen</button></div></div>`;
  document.body.appendChild(o);
  o.addEventListener('click', e => {
    if (e.target === o || e.target.id === 'mv-cancel') { o.remove(); return; }
    const b = e.target.closest('.mv'); if (!b) return;
    const to = b.dataset.to || null;
    ids.forEach(id => { FB[id].parent = to; });
    sel = null; o.remove(); persist(); renderFilters(); refresh();
  });
}

/* Ordner bearbeiten / neu anlegen */
function openTileEditor(id, parentForNew) {
  const isNew = !id;
  const m = isNew ? { id: newId(), name: '', icon: '📁', color: COLORS[(cfg.folders.length) % COLORS.length], parent: parentForNew || null, show: true } : { ...FB[id] };
  const builtin = !isNew && BUILTIN.has(m.id);
  const opts = [`<option value="">Hauptebene</option>`, ...flat(null, 0, isNew ? null : m.id).map(({ f, depth }) =>
    `<option value="${esc(f.id)}" ${f.id === m.parent ? 'selected' : ''}>${'\u2003'.repeat(depth)}${esc(f.icon)} ${esc(f.name)}</option>`)].join('');
  const o = document.createElement('div');
  o.className = 'sheet-bg';
  o.innerHTML = `<div class="sheet" role="dialog" aria-label="Ordner bearbeiten">
    <h3>${isNew ? 'Neuer Ordner' : 'Ordner bearbeiten'}</h3>
    <div class="row"><span class="prev" id="e-prev" style="--c:${esc(m.color)}">${esc(m.icon)}</span>
      <label>Name<input id="e-label" type="text" maxlength="40" value="${esc(m.name)}" placeholder="z. B. Sonntagsessen"></label></div>
    <label>Symbol <small>(eigenes Emoji eintippen oder wählen)</small><input id="e-icon" type="text" maxlength="8" value="${esc(m.icon)}"></label>
    <div class="emojis">${EMOJI_PICK.map(x => `<button type="button" data-e="${x}">${x}</button>`).join('')}</div>
    <div class="swatches">${COLORS.map(c => `<button type="button" data-c="${c}" style="background:${c}" aria-pressed="${c === m.color}" aria-label="Farbe"></button>`).join('')}<label class="cpick" title="Eigene Farbe"><input id="e-color" type="color" value="${/^#[0-9a-f]{6}$/i.test(m.color) ? esc(m.color) : '#888888'}"><span>Eigene Farbe</span></label></div>
    <label>Liegt in<select id="e-parent">${opts}</select></label>
    <label class="chk"><input id="e-show" type="checkbox" ${m.show ? 'checked' : ''}> Anzeigen</label>
    <div class="acts">
      ${isNew ? '<button type="button" class="chip" id="e-cancel">Abbrechen</button>' : builtin ? '<button type="button" class="chip" id="e-reset">Standard</button>' : '<button type="button" class="chip danger" id="e-del">Löschen</button>'}
      <button type="button" class="chip on" id="e-ok">${isNew ? 'Anlegen' : 'Fertig'}</button>
    </div>
  </div>`;
  document.body.appendChild(o);
  let color = m.color;
  const upd = () => { $('#e-prev', o).textContent = $('#e-icon', o).value || '📁'; $('#e-prev', o).style.setProperty('--c', color); };
  const done = () => { o.remove(); refresh(); };
  const save = () => {
    const f = {
      id: m.id, name: $('#e-label', o).value.trim() || (isNew ? 'Neuer Ordner' : m.name),
      icon: $('#e-icon', o).value.trim() || '📁', color, parent: $('#e-parent', o).value || null, show: $('#e-show', o).checked
    };
    if (isNew) cfg.folders.push(f); else cfg.folders[cfg.folders.findIndex(x => x.id === m.id)] = f;
    persist(); renderFilters(); done();
  };
  o.addEventListener('click', e => {
    if (e.target === o) return isNew ? o.remove() : save();
    const em = e.target.closest('[data-e]'); if (em) { $('#e-icon', o).value = em.dataset.e; upd(); return; }
    if (e.target.closest('.cpick')) return;
    const c = e.target.closest('[data-c]'); if (c) { color = c.dataset.c; $$('.swatches button', o).forEach(b => b.setAttribute('aria-pressed', b === c)); upd(); return; }
    if (e.target.id === 'e-cancel') { o.remove(); return; }
    if (e.target.id === 'e-reset') { const d = defFolder(m.id); Object.assign(FB[m.id], { name: d.name, icon: d.icon, color: d.color, show: true }); persist(); renderFilters(); done(); return; }
    if (e.target.id === 'e-del') {
      if (!confirm('Ordner «' + m.name + '» löschen? Unterordner rücken eine Ebene hoch, Rezepte kehren in ihren ursprünglichen Ordner zurück.')) return;
      cfg.folders.forEach(f => { if (f.parent === m.id) f.parent = m.parent || null; });
      Object.keys(cfg.assign).forEach(k => { cfg.assign[k] = cfg.assign[k].filter(x => x !== m.id); if (!cfg.assign[k].length) delete cfg.assign[k]; });
      cfg.folders = cfg.folders.filter(f => f.id !== m.id);
      if (state.filter === m.id) state.filter = m.parent || 'alle';
      persist(); renderFilters(); done(); return;
    }
    if (e.target.id === 'e-ok') save();
  });
  $('#e-icon', o).addEventListener('input', upd);
  $('#e-color', o).addEventListener('input', e => { color = e.target.value; $$('.swatches button', o).forEach(b => b.setAttribute('aria-pressed', b.dataset.c === color)); upd(); });
  if (isNew) $('#e-label', o).focus();
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
  kids(null).filter(f => f.show).forEach(f => items.push([f.id, f.name, countIn(f.id)]));
  const act = FB[state.filter] ? rootOf(state.filter) : state.filter;
  filtersEl.innerHTML = items.map(([k, l, n]) =>
    `<button class="chip" type="button" data-f="${esc(k)}" aria-pressed="${act === k}">${esc(l)}<small>${n}</small></button>`).join('');
}

function renderList() {
  const t = tokens(state.q);
  const res = search(state.q);
  const inFolder = !state.q && FB[state.filter];
  const head = inFolder ? `<nav class="crumbs"><a href="#" data-crumb="">Start</a>${pathOf(state.filter).map((f, i, a) => ' › ' + (i < a.length - 1 ? `<a href="#" data-crumb="${esc(f.id)}">${esc(f.name)}</a>` : `<b>${esc(f.name)}</b>`)).join('')}</nav>${barHtml()}${tilesBlock(state.filter)}` : '';
  countEl.textContent = res.length === R.length ? R.length : res.length + ' von ' + R.length;
  clearEl.hidden = !state.q;
  if (state.edit && inFolder) { view.innerHTML = `<section class="home editing">${head}</section>`; setSync(sync.msg, sync.kind); return; }
  if (!res.length) {
    view.innerHTML = head + `<div class="empty"><b>Nichts gefunden</b>${state.q ? 'Für „' + esc(state.q) + '“ gibt es keine Treffer.' : 'In dieser Auswahl ist noch nichts.'}
      ${state.q && R.some(r => !r.hasText) ? '<br><small>Rezepte, die nur als Foto vorliegen, lassen sich nur über den Titel finden.</small>' : ''}</div>`;
    return;
  }
  const hint = state.q && state.filter !== 'text'
    ? `<p class="hint">Suche in Titel, Zutaten und Zubereitung. Reine Foto-Rezepte werden nur über den Titel gefunden.</p>` : '';
  view.innerHTML = head + hint + '<div class="grid">' + res.map(({ r, hit }) => {
    const sn = snippet(r, hit, t);
    return `<a class="card" href="#/r/${r.id}">
      <div class="ph">${r.cover ? `<img loading="lazy" decoding="async" src="${esc(imgUrl(r.cover, 480))}" alt="">` : ''}</div>
      <div class="body"><h3>${highlight(r.n, t)}</h3>
      ${sn ? `<div class="sn">${sn}</div>` : ''}
      <div class="tags">${foldersOf(r).map(x => `<span class="tag">${esc(folderName(x))}</span>`).join('')}${r.hasText ? '' : '<span class="tag photo">Foto</span>'}${state.fav.has(r.id) ? '<span class="tag fav">★</span>' : ''}</div></div></a>`;
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
    <div class="meta">${foldersOf(r).map(x => `<span class="tag fchip">${esc((FB[x] || {}).icon || '')} ${esc(folderName(x))}<button type="button" data-rmf="${esc(x)}" aria-label="Aus Ordner entfernen">×</button></span>`).join('')}<label class="fsel"><select id="fadd"><option value="">＋ Ordner</option>${flat().filter(({ f }) => !foldersOf(r).includes(f.id)).map(({ f, depth }) => `<option value="${esc(f.id)}">${'\u2003'.repeat(depth)}${esc(f.icon)} ${esc(f.name)}</option>`).join('')}</select></label>${(r.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}${host ? `<a href="${esc(r.src)}" target="_blank" rel="noopener">Quelle: ${esc(host)}</a>` : ''}</div>
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
function setFolders(r, list) {
  list = [...new Set(list)];
  if (list.length === 1 && list[0] === r.folder) delete cfg.assign[r.id]; else cfg.assign[r.id] = list;
  persist(); renderFilters(); renderDetail(r);
}
view.addEventListener('change', e => {
  if (e.target.id !== 'fadd' || !e.target.value) return;
  const r = byId[decodeURIComponent(location.hash.slice(4))]; if (!r) return;
  setFolders(r, [...foldersOf(r), e.target.value]);
});
view.addEventListener('click', e => {
  if (e.target.closest('#hedit')) { state.edit = !state.edit; sel = null; refresh(); window.scrollTo(0, 0); return; }
  if (e.target.closest('#hsel')) { sel = new Set(); refresh(); return; }
  if (e.target.closest('#selcancel')) { sel = null; refresh(); return; }
  if (e.target.closest('#selup') && sel && sel.size) {
    [...sel].forEach(id => { const f = FB[id]; if (f && f.parent && !sel.has(f.parent)) f.parent = (FB[f.parent] || {}).parent || null; });
    sel = null; persist(); renderFilters(); refresh(); return;
  }
  if (e.target.closest('#seldown') && sel && sel.size) {
    const chosen = new Set(sel);
    chosen.forEach(id => {
      const f = FB[id]; if (!f) return;
      const sib = kids(f.parent || null); let i = sib.indexOf(f) - 1;
      while (i >= 0 && chosen.has(sib[i].id)) i--;
      if (i >= 0) f.parent = sib[i].id;
    });
    sel = null; persist(); renderFilters(); refresh(); return;
  }
  if (e.target.closest('#selmove')) { if (sel && sel.size) openMoveSheet(); return; }
  if (e.target.closest('#hadd')) { openTileEditor(null, ($('#tiles') || {}).dataset ? $('#tiles').dataset.parent || null : null); return; }
  const crumb = e.target.closest('[data-crumb]');
  if (crumb) { e.preventDefault(); state.edit = false; if (crumb.dataset.crumb) state.filter = crumb.dataset.crumb; else { state.filter = 'alle'; state.browse = false; } renderFilters(); refresh(); window.scrollTo(0, 0); return; }
  const tile = e.target.closest('.tile');
  if (tile && state.edit && sel) {
    if (tile.classList.contains('fixed') || !tile.dataset.folder) return;
    const id = tile.dataset.folder;
    sel.has(id) ? sel.delete(id) : sel.add(id);
    tile.classList.toggle('sel', sel.has(id));
    const c = $('#selcount'); if (c) c.textContent = sel.size + ' gewählt';
    ['#selmove', '#selup', '#seldown'].forEach(q => { const b = $(q); if (b) b.disabled = !sel.size; });
    return;
  }
  if (tile && state.edit) return;
  if (tile && tile.classList.contains('add')) return;
  if (tile) { state.filter = tile.dataset.folder; state.browse = true; renderFilters(); refresh(); window.scrollTo(0, 0); return; }
  if (e.target.closest('#random')) { const r = R[Math.floor(Math.random() * R.length)]; location.hash = '#/r/' + r.id; return; }
  const back = e.target.closest('#back');
  if (back) { history.length > 1 ? history.back() : (location.hash = ''); return; }
  const star = e.target.closest('#star');
  if (star) {
    const r = byId[decodeURIComponent(location.hash.slice(4))];
    state.fav.has(r.id) ? state.fav.delete(r.id) : state.fav.add(r.id);
    persist();
    star.setAttribute('aria-pressed', state.fav.has(r.id)); star.textContent = state.fav.has(r.id) ? '★' : '☆';
    renderFilters(); return;
  }
  const rmf = e.target.closest('[data-rmf]');
  if (rmf) {
    const r = byId[decodeURIComponent(location.hash.slice(4))];
    const cur = foldersOf(r);
    if (cur.length > 1) setFolders(r, cur.filter(x => x !== rmf.dataset.rmf));
    return;
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
  const sz = e.target.closest('#sizeseg [data-size]');
  if (sz) { cfg.size = sz.dataset.size; applySize(); persist(); return; }
  const ph = e.target.closest('#photoseg [data-photos]');
  if (ph) { cfg.photos = ph.dataset.photos === '1'; applySize(); persist(); refresh(); return; }
  if (e.target.closest('#tokpaste')) {
    try { $('#tok').value = (await navigator.clipboard.readText()).trim(); setSync($('#tok').value ? 'Token eingefügt, jetzt «OK» tippen' : 'Zwischenablage ist leer', ''); }
    catch { setSync('Zugriff auf die Zwischenablage nicht erlaubt: ins Feld tippen und lange drücken → Einfügen', 'err'); }
    return;
  }
  if (e.target.closest('#toksave')) {
    const v = $('#tok').value.trim();
    if (v) localStorage.setItem('rb_token', v); else localStorage.removeItem('rb_token');
    $('#tok').value = ''; updTok();
    if (v) { sync.dirty = true; store.set('rb_pending', cfg); persist(); } else setSync('Nur lesen (kein Token eingetragen)', '');
    return;
  }
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
function updTok() { const el = $('#tokstate'); if (el) el.textContent = getToken() ? 'Token ist auf diesem Gerät hinterlegt.' : 'Kein Token hinterlegt.'; }
updTok(); applySize(); $('#tok').addEventListener('keydown', e => { if (e.key === 'Enter') $('#toksave').click(); }); $('#vertag').textContent = 'v' + APP_VERSION; $('#ver').textContent = 'Version ' + APP_VERSION + ' · ' + R.length + ' Rezepte'; setSync(getToken() ? '' : 'Nur lesen (kein Token eingetragen)', '');

/* ---------- Start ---------- */
renderFilters();
route();
loadRemote();
if (getToken() && sync.dirty) flush();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !sync.dirty) loadRemote(true); });
let reloaded = false;
if ('serviceWorker' in navigator && navigator.serviceWorker.controller) navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
})();
