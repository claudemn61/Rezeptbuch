(() => {
'use strict';
const APP_VERSION = '1.9.10';

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

const ALLE_FOTO = 'img/alle-rezepte.jpg';
/* Frisch gespeicherte Fotos kurz lokal zeigen, bis GitHub Pages sie ausliefert */
function freshImg(ref) {
  try { const j = JSON.parse(sessionStorage.getItem('rb_fresh') || '{}'); const e = j[ref]; if (e && Date.now() - e.t < 600000) return e.d; } catch {}
  return '';
}
function rememberImg(path, b64) {
  try {
    const j = JSON.parse(sessionStorage.getItem('rb_fresh') || '{}');
    Object.keys(j).forEach(k => { if (Date.now() - j[k].t > 600000) delete j[k]; });
    j[path] = { t: Date.now(), d: 'data:image/jpeg;base64,' + b64 };
    sessionStorage.setItem('rb_fresh', JSON.stringify(j));
  } catch {}
}
function imgUrl(ref, w) {
  if (!ref) return '';
  const fresh = freshImg(ref); if (fresh) return fresh;
  if (ref.startsWith('G:')) return 'https://lh3.googleusercontent.com/' + ref.slice(2).split('?')[0] + '=w' + w;
  return ref;
}

const isHeading = t => /^#\s/.test(t) || (t.length <= 24 && !/[.!?]/.test(t));
const headText = t => t.replace(/^#\s+/, '');

/* ---------- Daten ---------- */
const mkRecipe = r => {
  const o = { ing: [], steps: [], pages: [], ...r, id: r.id || slug(r.n) };
  o.hasText = o.ing.length > 0 || o.steps.length > 0;
  o.fTitle = norm(o.n);
  o.fIng = norm(o.ing.join(' | '));
  o.fSteps = norm(o.steps.join(' | '));
  o.fMisc = norm(o.folder + ' ' + (o.tags || []).join(' ') + ' ' + (o.src || ''));
  return o;
};
const byAlpha = (a, b) => a.n.localeCompare(b.n, 'de');
/* Gleiche Titel bekommen verschiedene IDs (die zuletzt aufgeführte behält die bisherige ID, damit Favoriten/Ordner erhalten bleiben) */
const _tot = {}, _seen = {};
window.REZEPTE.forEach(r => { const s = slug(r.n); _tot[s] = (_tot[s] || 0) + 1; });
const BASE = window.REZEPTE.map(r => { const s = slug(r.n); _seen[s] = (_seen[s] || 0) + 1; return { ...r, id: _seen[s] < _tot[s] ? s + '-' + _seen[s] : s }; });
const asDoc = d => Array.isArray(d) ? { recipes: d, overrides: {}, deleted: [] } : { recipes: (d && d.recipes) || [], overrides: (d && d.overrides) || {}, deleted: (d && d.deleted) || [] };
let DOC = asDoc(null);
const R = [], byId = {};
// Eingebaute Rezepte (data.js) + eigene (meine-rezepte.json: recipes), mit Änderungen (overrides) und Löschungen (deleted)
function setUserRecipes(d) {
  DOC = asDoc(d);
  R.length = 0; Object.keys(byId).forEach(k => delete byId[k]);
  const del = new Set(DOC.deleted);
  BASE.forEach(b => { if (del.has(b.id)) return; const ov = DOC.overrides[b.id]; const o = mkRecipe(ov ? { ...b, ...ov, id: b.id } : b); if (ov) o.edited = true; R.push(o); byId[o.id] = o; });
  DOC.recipes.forEach(x => { if (!x || !x.n) return; const id = x.id || slug(x.n); if (byId[id]) return; const o = mkRecipe({ ...x, id }); o.u = true; R.push(o); byId[id] = o; });
  R.sort(byAlpha);
}
setUserRecipes(store.get('rb_userrec', null));
const folders = [...new Set(BASE.map(r => r.folder))].sort((a, b) => a.localeCompare(b, 'de'));

/* ---------- Zustand ---------- */
const state = {
  letter: '',
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

const letterOf = r => { const c = norm(r.n).charAt(0).toUpperCase(); return /[A-Z]/.test(c) ? c : '#'; };
function letterBar() {
  const cnt = {}; R.forEach(r => { const l = letterOf(r); cnt[l] = (cnt[l] || 0) + 1; });
  return '<div class="abcbar">' + Object.keys(cnt).sort((a, b) => a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b)).map(l => `<button type="button" class="chip" data-letter="${l}" aria-pressed="${state.letter === l}">${l}<small>${cnt[l]}</small></button>`).join('') + '</div>';
}
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
      case 'abc': return !!t.length || (!!state.letter && letterOf(r) === state.letter);
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

function devRsize() { const v = store.get('rb_rsize', null); return ['s', 'm', 'l'].includes(v) ? v : 'm'; }
/* Darstellung (Grösse, Fotos/Icons) gilt nur für dieses Gerät und wird nicht über GitHub abgeglichen */
function devSize(c) {
  const v = store.get('rb_size', null); if (['s', 'm', 'l'].includes(v)) return v;
  const r = ['s', 'm', 'l'].includes(c.size) ? c.size : 'm'; if (['s', 'm', 'l'].includes(c.size)) store.set('rb_size', r); return r;
}
function devPhotos(c) {
  const v = store.get('rb_photos', null); if (typeof v === 'boolean') return v;
  if (typeof c.photos === 'boolean') store.set('rb_photos', c.photos); return c.photos === true;
}
function normalize(c) {
  c = c || {};
  const out = { v: 1, size: devSize(c), rsize: devRsize(), photos: devPhotos(c), fav: (Array.isArray(c.fav) ? c.fav : []).filter(x => byId[x]), assign: {}, folders: [], layouts: {}, docs: {} };
  Object.entries(store.get('rb_layouts', {}) || {}).forEach(([k, v]) => { if (v && typeof v.id === 'string' && v.n > 0) out.layouts[k] = { n: v.n | 0, id: v.id }; });
  const seen = new Set();
  (c.folders || []).forEach(f => {
    if (!f || !f.id || seen.has(f.id)) return; seen.add(f.id);
    out.folders.push({ id: String(f.id), name: String(f.name || f.id), icon: f.icon || ICONS[f.id] || '📁', color: f.color || defColor(f.id), parent: f.parent || null, show: f.show !== false, ...(byId[f.photo] ? { photo: f.photo, ...(typeof f.pimg === 'string' && f.pimg ? { pimg: f.pimg } : {}) } : {}), ...(/^img\/f\//.test(f.img || '') ? { img: f.img } : {}) });
  });
  folders.forEach(b => { if (!seen.has(b)) out.folders.push(defFolder(b)); });
  const ids = new Set(out.folders.map(f => f.id));
  out.folders.forEach(f => { if (f.parent && (!ids.has(f.parent) || f.parent === f.id)) f.parent = null; });
  out.folders.forEach(f => { let p = f, n = 0; while (p && p.parent && n++ < 60) p = out.folders.find(x => x.id === p.parent); if (n >= 60) f.parent = null; });
  Object.entries(c.docs || {}).forEach(([fid, l]) => { const a = (Array.isArray(l) ? l : []).filter(d => d && typeof d.n === 'string' && (/^doc\/[^\s]+\.pdf$/i.test(d.p || '') || (typeof d.id === 'string' && d.id))).map(d => d.p ? { n: d.n, p: d.p } : { id: d.id, n: d.n, t: String(d.t || '').slice(0, 30000), ...(/^doc\/[^\s]+\.jpg$/i.test(d.im || '') ? { im: d.im } : {}) }); if (ids.has(fid) && a.length) out.docs[fid] = a; });
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
const baseFolders = r => {
  const ids = [FB[r.folder] ? r.folder : (cfg.folders[0] || {}).id];
  (r.tags || []).forEach(t => { const f = cfg.folders.find(f => f.id === t || f.name.toLowerCase() === String(t).toLowerCase()); if (f && !ids.includes(f.id)) ids.push(f.id); });
  return ids;
};
const isFolderTag = t => cfg.folders.some(f => f.id === t || f.name.toLowerCase() === String(t).toLowerCase());
const foldersOf = r => { const a = (cfg.assign[r.id] || []).filter(x => FB[x]); return a.length ? a : baseFolders(r); };
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
      const body = { message: 'App: Ordner/Einstellungen aktualisiert', content: b64enc(JSON.stringify((({ size, rsize, photos, layouts, ...rest }) => rest)(cfg), null, 1) + '\n'), branch: 'main' };
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
/* ---------- Eigene Rezepte: Import aus Foto oder Link ---------- */
const UREC_PATH = 'meine-rezepte.json';
const UAPI = `https://api.github.com/repos/${REPO}/contents/${UREC_PATH}`;
const usync = { sha: null };
const lsGet = k => (localStorage.getItem(k) || '').trim();
async function uGet() {
  let r = await fetch(`${UAPI}?ref=main&_=${Date.now()}`, { headers: hdr(getToken()), cache: 'no-store' });
  if (r.status === 401) r = await fetch(`${UAPI}?ref=main&_=${Date.now()}`, { headers: hdr(''), cache: 'no-store' });
  if (r.status === 404) { usync.sha = null; return asDoc(null); }
  if (!r.ok) throw new Error('GET ' + r.status);
  const j = await r.json(); usync.sha = j.sha;
  return asDoc(JSON.parse(b64dec(j.content)));
}
async function loadUserRecipes() {
  try {
    const d = await uGet();
    if (JSON.stringify(d) === JSON.stringify(asDoc(store.get('rb_userrec', null)))) return;
    store.set('rb_userrec', d); setUserRecipes(d); renderFilters();
    if (!state.edit && !document.querySelector('.sheet-bg') && !location.hash.startsWith('#/r/')) refresh();
  } catch {}
}
const putFile = (path, b64, msg, sha) => (/^img\/[uf]\//.test(path) && rememberImg(path, b64), fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
  method: 'PUT', headers: hdr(getToken(), true), body: JSON.stringify({ message: msg, content: b64, branch: 'main', ...(sha ? { sha } : {}) }) }));
// Datei meine-rezepte.json lesen, ändern, schreiben (bei Konflikt neu laden und wiederholen)
async function modifyDoc(fn, msg) {
  if (!getToken()) throw new Error('GitHub-Token fehlt (Einstellungen)');
  for (let i = 0; i < 4; i++) {
    const next = fn(await uGet());
    const r = await putFile(UREC_PATH, b64enc(JSON.stringify({ v: 2, ...next }, null, 1) + '\n'), msg, usync.sha);
    if (r.ok) { store.set('rb_userrec', next); setUserRecipes(next); renderFilters(); return; }
    if (r.status === 409 || r.status === 422) continue;
    if (r.status === 401 || r.status === 403 || r.status === 404) throw new Error('Token ungültig oder ohne Schreibrecht für das Repo');
    throw new Error('Speichern fehlgeschlagen (' + r.status + ')');
  }
  throw new Error('Konflikt beim Speichern, bitte nochmals versuchen');
}
async function saveUserRecipe(rec, files) {
  if (!getToken()) throw new Error('GitHub-Token fehlt (Einstellungen)');
  for (const f of files) {
    const r = await putFile(f.path, f.b64, 'App: Rezeptfoto');
    if (!r.ok) throw new Error('Foto speichern fehlgeschlagen (' + r.status + ')');
  }
  await modifyDoc(d => ({ ...d, recipes: [...d.recipes.filter(x => x.id !== rec.id), rec] }), 'App: Rezept «' + rec.n + '» importiert');
}

/* Bilder verkleinern */
function readImage(file) {
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(file), im = new Image();
    im.onload = () => { URL.revokeObjectURL(u); res(im); };
    im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('Bild «' + (file.name || '') + '» lässt sich nicht öffnen' + (/\.hei[cf]$/i.test(file.name || '') || /hei[cf]/i.test(file.type || '') ? ' (HEIC wird nur in Safari auf iPhone/Mac gelesen; sonst vorher als JPG sichern)' : ''))); };
    im.src = u;
  });
}
/* Bildausschnitt: verschieben, zoomen, beschneiden (Format wie das Titelbild, 3:2) */
function openCrop(src) {
  return new Promise(res => {
    const o = document.createElement('div'); o.className = 'sheet-bg'; o.style.zIndex = '90';
    o.innerHTML = `<div class="sheet imp" role="dialog" aria-label="Ausschnitt wählen"><h3>Ausschnitt wählen</h3>
      <p class="note tiny">Mit dem Finger verschieben, mit zwei Fingern oder dem Regler vergrössern. Was ausserhalb des Rahmens liegt, wird abgeschnitten.</p>
      <div class="cropbox" id="c-box"><img id="c-img" alt="" draggable="false"></div>
      <label class="zoomrow">Zoom <input id="c-zoom" type="range" min="1" max="4" step="0.01" value="1"></label>
      <p class="note tiny err" id="c-msg"></p>
      <div class="acts"><button type="button" class="chip" id="c-cancel">Abbrechen</button><button type="button" class="chip on" id="c-ok" disabled>Übernehmen</button></div></div>`;
    document.body.appendChild(o);
    const box = $('#c-box', o), img = $('#c-img', o), zoomEl = $('#c-zoom', o), ok = $('#c-ok', o);
    let nw = 0, nh = 0, W = 0, H = 0, s0 = 1, zoom = 1, x = 0, y = 0;
    const clamp = () => { const sc = s0 * zoom; x = Math.min(0, Math.max(W - nw * sc, x)); y = Math.min(0, Math.max(H - nh * sc, y)); };
    const apply = () => { clamp(); const sc = s0 * zoom; img.style.width = nw * sc + 'px'; img.style.height = nh * sc + 'px'; img.style.left = x + 'px'; img.style.top = y + 'px'; };
    const setZoom = (z, cx = W / 2, cy = H / 2) => { const old = s0 * zoom; zoom = Math.min(4, Math.max(1, z)); const k = s0 * zoom / old; x = cx - (cx - x) * k; y = cy - (cy - y) * k; zoomEl.value = zoom; apply(); };
    const done = v => { o.remove(); res(v); };
    const im = new Image(); if (/^https?:/.test(src)) im.crossOrigin = 'anonymous';
    im.onload = () => {
      nw = im.naturalWidth; nh = im.naturalHeight; W = box.clientWidth; H = box.clientHeight;
      s0 = Math.max(W / nw, H / nh); x = (W - nw * s0) / 2; y = (H - nh * s0) / 2; img.src = im.src; apply(); ok.disabled = false;
    };
    im.onerror = () => { $('#c-msg', o).textContent = 'Dieses Bild lässt sich hier nicht zuschneiden. Lade es neu hoch (＋ Bilder hinzufügen).'; };
    im.src = src;
    const pts = new Map(); let d0 = 0, z0 = 1;
    box.addEventListener('pointerdown', e => { box.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) { const [p, q] = [...pts.values()]; d0 = Math.hypot(p.x - q.x, p.y - q.y); z0 = zoom; } });
    box.addEventListener('pointermove', e => {
      const p = pts.get(e.pointerId); if (!p) return;
      if (pts.size === 1) { x += e.clientX - p.x; y += e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; apply(); }
      else { p.x = e.clientX; p.y = e.clientY; const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (d0 > 0) setZoom(z0 * d / d0); }
    });
    const up = e => { pts.delete(e.pointerId); };
    box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
    box.addEventListener('wheel', e => { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.1 : 0.9)); }, { passive: false });
    zoomEl.addEventListener('input', () => setZoom(Number(zoomEl.value)));
    $('#c-cancel', o).onclick = () => done(null);
    ok.onclick = () => {
      try {
        const sc = s0 * zoom, cw = 1600, ch = Math.round(1600 * H / W);
        const c = document.createElement('canvas'); c.width = cw; c.height = ch;
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cw, ch);
        g.drawImage(im, -x / sc, -y / sc, W / sc, H / sc, 0, 0, cw, ch);
        done(c.toDataURL('image/jpeg', 0.85));
      } catch { $('#c-msg', o).textContent = 'Zuschneiden nicht möglich (Bild gesperrt). Lade das Bild neu hoch.'; }
    };
  });
}

async function shrink(file, max, q) {
  const im = await readImage(file);
  const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}

/* Texterkennung und Ordnung per Claude-API */
const RECIPE_TOOL = {
  name: 'rezept', description: 'Das erkannte Rezept in strukturierter Form',
  input_schema: { type: 'object', properties: {
    n: { type: 'string', description: 'Rezepttitel' },
    ing: { type: 'array', items: { type: 'string' }, description: 'Zutaten, eine pro Eintrag' },
    steps: { type: 'array', items: { type: 'string' }, description: 'Zubereitung, ein Absatz pro Eintrag' },
    port: { type: 'integer', description: 'Für wie viele Personen/Portionen das Rezept gedacht ist, nur wenn angegeben, sonst weglassen' },
    folder: { type: 'string', description: 'Passender Ordnername aus der Liste oder leer' },
    notes: { type: 'string', description: 'Unsicheres oder Unleserliches, sonst leer' }
  }, required: ['n', 'ing', 'steps'] }
};
const recipePrompt = () => `Erfasse das Rezept und gib es über das Werkzeug «rezept» zurück.
Regeln:
- Schweizer Rechtschreibung (ss statt ß), Wortlaut möglichst original; nichts erfinden, nichts ergänzen.
- Zutaten: ein Eintrag pro Zutat, Menge zuerst, z. B. «500 g Zopfmehl», «3/4 EL Salz». Zwischenüberschriften der Zutatenliste (z. B. «Teig») als eigener kurzer Eintrag ohne Punkt.
- Zubereitung: ein Eintrag pro Absatz bzw. Schritt. Zwischenüberschriften (z. B. «Backen») als eigener kurzer Eintrag ohne Satzzeichen.
- Mehrere Bilder sind Seiten desselben Rezepts in der richtigen Reihenfolge.
- Unleserliches mit [?] markieren und in notes kurz nennen.
- port: Anzahl Personen bzw. Portionen laut Rezept (z. B. «für 4 Personen»), nur wenn angegeben.
- folder: bester Ordner aus dieser Liste, sonst leer: ${cfg.folders.map(f => f.name).join(', ')}.`;
async function askClaude(content) {
  const key = lsGet('rb_akey');
  if (!key) throw new Error('Kein Claude-API-Schlüssel hinterlegt (Einstellungen → Import)');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 8192, system: 'Du liest Rezepte aus Fotos, Scans, PDF oder Webseiten. Antworte ausschliesslich, indem du das Tool «rezept» genau einmal aufrufst. Schreibe keinen weiteren Text.', tools: [RECIPE_TOOL], tool_choice: { type: 'auto' }, messages: [{ role: 'user', content }] })
  });
  if (!r.ok) {
    let m = ''; try { m = (await r.json()).error.message; } catch {}
    throw new Error(r.status === 401 ? 'Claude-API-Schlüssel ungültig' : 'Claude-API: ' + r.status + (m ? ' – ' + m : ''));
  }
  const j = await r.json(); const t = (j.content || []).find(c => c.type === 'tool_use');
  if (!t) throw new Error('Claude hat kein Rezept geliefert' + (j.stop_reason === 'max_tokens' ? ' (Antwort zu lang)' : ''));
  return t.input;
}

/* Link: Seite über den Cloudflare-Dienst holen, Rezeptdaten (schema.org) lesen */
async function fetchPage(url) {
  const w = lsGet('rb_worker');
  if (!w) throw new Error('Kein Link-Dienst hinterlegt (Einstellungen → Import)');
  const r = await fetch(w + (w.includes('?') ? '&' : '?') + 'url=' + encodeURIComponent(url));
  if (!r.ok) throw new Error('Seite nicht abrufbar (' + r.status + ')');
  return r.text();
}
const plain = s => { const t = document.createElement('textarea'); t.innerHTML = String(s || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''); return t.value.replace(/\s+/g, ' ').trim(); };
function findRecipeLd(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const x of node) { const r = findRecipeLd(x); if (r) return r; } return null; }
  const t = [].concat(node['@type'] || []);
  if (t.includes('Recipe')) return node;
  return findRecipeLd(node['@graph']) || null;
}
function stepsFromLd(v, out) {
  if (!v) return;
  if (typeof v === 'string') { v.split(/\r?\n+/).map(plain).filter(Boolean).forEach(x => out.push(x)); return; }
  if (Array.isArray(v)) { v.forEach(x => stepsFromLd(x, out)); return; }
  if ([].concat(v['@type'] || []).includes('HowToSection')) { if (v.name) out.push(plain(v.name)); stepsFromLd(v.itemListElement, out); return; }
  const x = plain(v.text || v.name); if (x) out.push(x);
}
function recipeFromHtml(html) {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi; let m;
  while ((m = re.exec(html))) {
    let d; try { d = JSON.parse(m[1].trim()); } catch { continue; }
    const r = findRecipeLd(d); if (!r) continue;
    const steps = []; stepsFromLd(r.recipeInstructions, steps);
    const ing = [].concat(r.recipeIngredient || r.ingredients || []).map(plain).filter(Boolean);
    if (!ing.length && !steps.length) continue;
    const ym = [].concat(r.recipeYield || []).map(String).join(' ').match(/\d+/);
    const cand = [].concat(r.recipeCategory || [], r.recipeCuisine || [], String(r.keywords || '').split(',')).map(x => plain(String(x)).toLowerCase()).filter(Boolean);
    const hit = cfg.folders.find(f => cand.some(c => c === f.name.toLowerCase() || (f.name.length > 3 && c.includes(f.name.toLowerCase()))));
    return { n: plain(r.name), ing, steps, tags: [], folder: hit ? hit.name : '', notes: '', port: ym ? Math.min(99, +ym[0]) : 0 };
  }
  return null;
}
/* Aus eingefügtem Text (z. B. «Probier mal das Rezept … https://…») den Link holen und Tracking-Zusätze entfernen */
function linkFromText(t) {
  const m = String(t || '').match(/https?:\/\/[^\s<>"'«»]+/i); if (!m) return '';
  let s = m[0].replace(/[.,;:!?)\]]+$/, '');
  try { const u = new URL(s); [...u.searchParams.keys()].forEach(k => { if (/^(utm_|fbclid|gclid|mc_|igshid)/i.test(k)) u.searchParams.delete(k); }); u.hash = ''; s = u.href; } catch { return ''; }
  return s;
}
function imageUrlsFromHtml(html, base) {
  const out = [];
  const add = v => { if (!v) return; if (Array.isArray(v)) { v.forEach(add); return; } if (typeof v === 'object') { add(v.url || v.contentUrl); return; } try { const u = new URL(String(v), base).href; if (/^https?:/.test(u) && !out.includes(u)) out.push(u); } catch {} };
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi; let m;
  while ((m = re.exec(html))) { try { const r = findRecipeLd(JSON.parse(m[1].trim())); if (r) { add(r.image); break; } } catch {} }
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
  if (og) add(plain(og[1]));
  return out.slice(0, 2);
}
async function fetchImage(url) {
  const w = lsGet('rb_worker'); if (!w) return null;
  try {
    const r = await fetch(w + (w.includes('?') ? '&' : '?') + 'img=1&url=' + encodeURIComponent(url));
    if (!r.ok) return null;
    const b = await r.blob(); if (!/^image\//.test(b.type)) return null;
    return await shrink(b, 1600, 0.82);
  } catch { return null; }
}
function pageText(html) {
  return plain(html.replace(/<(script|style|noscript|svg|header|footer|nav)[\s\S]*?<\/\1>/gi, ' ')).slice(0, 40000);
}

/* Dialog */
/* Rezept aus Dateien (Foto/PDF) bzw. Text/Link lesen: gemeinsam für Import und «Bearbeiten» */
async function extractFromFiles(files, status) {
  const isPdf = f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
  const images = [], content = [];
  status('Dateien werden vorbereitet …');
  for (const f of files) {
    if (isPdf(f)) {
      if (f.size > 20 * 1024 * 1024) throw new Error('PDF «' + f.name + '» ist zu gross (über 20 MB)');
      const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = () => rej(new Error('PDF lässt sich nicht lesen')); fr.readAsDataURL(f); });
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } });
    } else {
      const u = await shrink(f, 1600, 0.82); images.push(u);
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: u.split(',')[1] } });
    }
  }
  status('Claude liest das Rezept …');
  content.push({ type: 'text', text: recipePrompt() });
  return { rec: await askClaude(content), images };
}
/* Bereits gespeicherte Fotos (Pfad/Google-Bild) für Claude laden */
async function loadImageData(ref) {
  const url = imgUrl(ref, 1800);
  try { const r = await fetch(url, { cache: 'no-store' }); if (r.ok) { const b = await r.blob(); if (/^image\//.test(b.type)) return await shrink(b, 1600, 0.82); } } catch {}
  const d = await fetchImage(url.startsWith('http') ? url : new URL(url, location.href).href);
  if (!d) throw new Error('Ein Foto lässt sich nicht laden (Internet oder Link-Dienst prüfen)');
  return d;
}
async function extractFromDataUrls(urls, status) {
  status('Claude liest die Fotos …');
  const content = urls.map(u => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: u.split(',')[1] } }));
  content.push({ type: 'text', text: recipePrompt() });
  const rec = await askClaude(content);
  if (!(rec.ing || []).length && !(rec.steps || []).length) throw new Error('Auf den Fotos wurde kein Rezepttext gefunden');
  return rec;
}
async function extractFromText(txt, status) {
  const u = /^\s*(https?:\/\/\S+)\s*$/i.test(txt) ? linkFromText(txt) : '';
  let rec;
  if (u) {
    status('Seite wird geladen …');
    const html = await fetchPage(u);
    rec = recipeFromHtml(html);
    if (!rec) { status('Claude liest die Seite …'); rec = await askClaude([{ type: 'text', text: recipePrompt() + '\n\nSeitentext:\n' + pageText(html) }]); }
  } else {
    status('Claude liest den Text …');
    rec = await askClaude([{ type: 'text', text: recipePrompt() + '\n\nRezepttext:\n' + txt.slice(0, 30000) }]);
  }
  if (!(rec.ing || []).length && !(rec.steps || []).length) throw new Error('Es wurde kein Rezept gefunden');
  return rec;
}

function openImport() {
  const o = document.createElement('div'); o.className = 'sheet-bg';
  document.body.appendChild(o);
  const sheet = inner => { o.innerHTML = `<div class="sheet imp" role="dialog" aria-label="Rezept importieren">${inner}</div>`; };
  const folderOpts = sel => flat().map(({ f, depth }) => `<option value="${esc(f.id)}"${f.id === sel ? ' selected' : ''}>${' '.repeat(depth)}${esc(f.icon)} ${esc(f.name)}</option>`).join('');
  let busyOn = false;
  let mode = '';
  const start = (msg = '') => {
    const err = `<p class="note tiny err" id="i-msg">${esc(msg)}</p>`;
    if (mode === 'text') {
      sheet(`<h3>Rezepttext einfügen</h3>
        <label class="grow">Rezept hier einfügen (Titel, Zutaten, Zubereitung)<textarea id="i-text" placeholder="Text einfügen …"></textarea></label>
        ${err}<div class="acts"><button type="button" class="chip" id="i-back0">Zurück</button><button class="chip on" type="button" id="i-textgo">📋 Text importieren</button></div>`);
      o.firstChild.classList.add('full');
    } else if (mode === 'link') {
      sheet(`<h3>Link importieren</h3>
        <label>Link zu einem Rezept<input id="i-url" type="text" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Link einfügen (auch mit Text davor)"></label>
        ${err}<div class="acts"><button type="button" class="chip" id="i-back0">Zurück</button><button class="chip on" type="button" id="i-go">🔗 Link importieren</button></div>`);
      o.firstChild.classList.add('full');
    } else {
      sheet(`<h3>Rezept importieren</h3>
        <p class="note tiny">Woher kommt das Rezept?</p>
        <button class="chip big" type="button" id="i-photo">📷 Foto, Scan oder PDF</button>
        <input id="i-file" type="file" accept="image/*,.heic,.heif,image/heic,image/heif,application/pdf,.pdf" multiple hidden>
        <p class="note tiny">Mehrere Dateien = mehrere Seiten desselben Rezepts, in der richtigen Reihenfolge. Möglich: JPG, PNG, iPhone-Format HEIC und PDF.</p>
        <button class="chip big" type="button" id="i-mtext">📋 Text einfügen (Copy/Paste)</button>
        <button class="chip big" type="button" id="i-mlink">🔗 Link zu einer Webseite</button>
        ${err}<div class="acts"><button type="button" class="chip" id="i-cancel">Schliessen</button></div>`);
    }
  };
  const busy = t => { busyOn = true; sheet(`<h3>Rezept importieren</h3><p class="note">⏳ ${esc(t)}</p>`); };
  /* Zum Abschluss aktiv fragen: in welche(n) Ordner kommt das Rezept? */
  const pickFolders = sugg => new Promise(res => {
    const p = document.createElement('div'); p.className = 'sheet-bg'; p.style.zIndex = '80';
    p.innerHTML = `<div class="sheet imp" role="dialog" aria-label="Ordner wählen"><h3>In welchen Ordner?</h3>
      <p class="note tiny">Du kannst einen oder mehrere Ordner wählen.${sugg ? ' Der Vorschlag der App ist schon angekreuzt, bitte prüfen.' : ''}</p>
      <div class="fpick">${flat().map(({ f, depth }) => `<label class="chk" style="padding-left:${depth * 18}px"><input type="checkbox" value="${esc(f.id)}"${f.id === sugg ? ' checked' : ''}> ${esc(f.icon)} ${esc(f.name)}</label>`).join('')}</div>
      <p class="note tiny err" id="p-msg"></p>
      <div class="acts"><button type="button" class="chip" id="p-cancel">Zurück</button><button type="button" class="chip on" id="p-ok">Speichern</button></div></div>`;
    document.body.appendChild(p);
    p.addEventListener('click', e => {
      if (e.target === p || e.target.closest('#p-cancel')) { p.remove(); res(null); return; }
      if (e.target.closest('#p-ok')) {
        const ids = [...p.querySelectorAll('.fpick input:checked')].map(x => x.value);
        if (!ids.length) { $('#p-msg', p).textContent = 'Bitte mindestens einen Ordner wählen.'; return; }
        p.remove(); res(ids);
      }
    });
  });
  const review = (rec, images, srcUrl) => {
    busyOn = false;
    const sugg = (cfg.folders.find(f => f.name.toLowerCase() === String(rec.folder || '').toLowerCase()) || {}).id || '';
    sheet(`<h3>Prüfen und speichern</h3>
      ${rec.notes ? `<p class="note tiny warn">Hinweis: ${esc(rec.notes)}</p>` : ''}
      ${images.length ? `<div class="pics">${images.map((u, i) => `<div class="pic"><img src="${u}" alt="">
          <label class="chk"><input type="radio" name="r-cov" value="${i}"${i === 0 ? ' checked' : ''}> Titelbild</label>
          <label class="chk"><input type="checkbox" data-keep="${i}" checked> behalten</label>
          <button type="button" class="chip" data-crop="${i}">✂ Ausschnitt</button></div>`).join('')}</div>
        <div class="acts" style="justify-content:flex-start"><button type="button" class="chip" id="r-only">Nur Titelbild behalten</button><button type="button" class="chip" id="r-none">Keine Bilder</button></div>
        <label class="chk"><input id="r-fp" type="checkbox"> Titelbild auch als Foto für den (ersten) gewählten Ordner verwenden</label>` : ''}
      <label>Name<input id="r-n" type="text" value="${esc(rec.n || '')}"></label>
      <label>Rezept für <small>(Personen; die Zutatenmengen im Text gelten für diese Zahl)</small><input id="r-p" type="number" inputmode="numeric" min="1" max="99" value="${rec.port > 0 ? rec.port : ''}" placeholder="z. B. 4"></label>
      <label>Schlagwörter <small>(mit Komma getrennt)</small><input id="r-t" type="text" value=""></label>
      <label>Zutaten <small>(eine pro Zeile)</small><textarea id="r-i" rows="8">${esc((rec.ing || []).join('\n'))}</textarea></label>
      <label>Zubereitung <small>(ein Schritt pro Zeile; kurze Zeile ohne Punkt = Überschrift)</small><textarea id="r-s" rows="10">${esc((rec.steps || []).join('\n'))}</textarea></label>
      <p class="note tiny err" id="i-msg"></p>
      <div class="acts"><button type="button" class="chip" id="i-back">Zurück</button><button type="button" class="chip on" id="r-save">Speichern</button></div>`);
    $('#r-save', o).onclick = async () => {
      const lines = id => $(id, o).value.split('\n').map(x => x.trim()).filter(Boolean);
      const n = $('#r-n', o).value.trim();
      const msg = $('#i-msg', o);
      if (!n) { msg.textContent = 'Bitte einen Namen eingeben.'; return; }
      const chosen = await pickFolders(sugg);
      if (!chosen) return;
      const btn = $('#r-save', o); btn.disabled = true; btn.textContent = 'Speichere …'; msg.textContent = '';
      let id = slug(n) || 'rezept'; if (byId[id]) id += '-' + Date.now().toString(36).slice(-4);
      const covI = Number((o.querySelector('input[name=r-cov]:checked') || { value: 0 }).value);
      const kept = images.map((u, i) => i).filter(i => o.querySelector(`[data-keep="${i}"]`).checked);
      const order = kept.includes(covI) ? [covI, ...kept.filter(i => i !== covI)] : kept;
      const files = order.map((i, n) => ({ path: `img/u/${id}-${n + 1}.jpg`, b64: images[i].split(',')[1] }));
      const out = {
        id, n, folder: chosen[0], src: srcUrl || '',
        tags: $('#r-t', o).value.split(',').map(x => x.trim()).filter(Boolean), port: Math.min(99, Math.max(0, parseInt($('#r-p', o).value, 10) || 0)) || undefined,
        ing: lines('#r-i'), steps: lines('#r-s'),
        cover: files[0] ? files[0].path : '', pages: files.slice(1).map(f => f.path), added: new Date().toISOString().slice(0, 10)
      };
      try {
        await saveUserRecipe(out, files);
        cfg.assign[id] = chosen; persist();
        if (files.length && $('#r-fp', o) && $('#r-fp', o).checked && FB[out.folder]) { FB[out.folder].photo = id; delete FB[out.folder].pimg; persist(); renderFilters(); }
        o.remove(); location.hash = '#/r/' + id;
      }
      catch (e) { btn.disabled = false; btn.textContent = 'Speichern'; msg.textContent = '⚠ ' + e.message; }
    };
    $('#i-back', o).onclick = () => start();
    const syncPics = () => {
      const c = Number((o.querySelector('input[name=r-cov]:checked') || { value: 0 }).value);
      o.querySelectorAll('[data-keep]').forEach(k => { if (Number(k.dataset.keep) === c) { k.checked = true; k.disabled = true; } else k.disabled = false; });
    };
    o.querySelectorAll('[data-crop]').forEach(b => { b.onclick = async () => { const i = Number(b.dataset.crop); const d = await openCrop(images[i]); if (d) { images[i] = d; b.closest('.pic').querySelector('img').src = d; } }; });
    o.querySelectorAll('input[name=r-cov]').forEach(x => x.addEventListener('change', syncPics));
    if ($('#r-only', o)) $('#r-only', o).onclick = () => { o.querySelectorAll('[data-keep]').forEach(k => { k.checked = k.disabled; }); };
    if ($('#r-none', o)) $('#r-none', o).onclick = () => { o.querySelectorAll('[data-keep]').forEach(k => { k.disabled = false; k.checked = false; }); o.querySelectorAll('input[name=r-cov]').forEach(x => { x.disabled = true; }); };
    if (images.length) syncPics();
  };
  const fromPhotos = async files => {
    try {
      const x = await extractFromFiles(files, busy);
      review(x.rec, x.images, '');
    } catch (e) { start('⚠ ' + e.message); }
  };
  const fromLink = async url => {
    try {
      busy('Seite wird geladen …');
      const html = await fetchPage(url);
      let rec = recipeFromHtml(html);
      if (!rec) {
        busy('Claude liest die Seite …');
        rec = await askClaude([{ type: 'text', text: recipePrompt() + '\n\nSeitentext:\n' + pageText(html) }]);
        if (!(rec.ing || []).length && !(rec.steps || []).length) throw new Error('Auf der Seite wurde kein Rezept gefunden');
      }
      busy('Foto wird geladen …');
      const imgs = [];
      for (const u of imageUrlsFromHtml(html, url).slice(0, 1)) { const d = await fetchImage(u); if (d) imgs.push(d); }
      review(rec, imgs, url);
    } catch (e) { start('⚠ ' + e.message); }
  };
  const fromText = async txt => {
    try {
      busy('Claude liest den Text …');
      const rec = await askClaude([{ type: 'text', text: recipePrompt() + '\n\nRezepttext:\n' + txt.slice(0, 30000) }]);
      if (!(rec.ing || []).length && !(rec.steps || []).length) throw new Error('Im Text wurde kein Rezept gefunden');
      review(rec, [], '');
    } catch (e) { start('⚠ ' + e.message); }
  };
  o.addEventListener('click', e => {
    if (e.target === o) { if (!busyOn) o.remove(); return; }
    if (e.target.closest('#i-cancel')) { o.remove(); return; }
    if (e.target.closest('#i-textgo')) {
      const t = $('#i-text', o).value.trim();
      if (t.length < 20) { $('#i-msg', o).textContent = 'Bitte zuerst den Rezepttext einfügen.'; return; }
      const u = /^\s*(https?:\/\/\S+)\s*$/i.test(t) ? linkFromText(t) : '';
      if (u) fromLink(u); else fromText(t);
      return;
    }
    if (e.target.closest('#i-photo')) { $('#i-file', o).click(); return; }
    if (e.target.closest('#i-mtext')) { mode = 'text'; start(); const t = $('#i-text', o); if (t) t.focus(); return; }
    if (e.target.closest('#i-mlink')) { mode = 'link'; start(); const t = $('#i-url', o); if (t) t.focus(); return; }
    if (e.target.closest('#i-back0')) { mode = ''; start(); return; }
    if (e.target.closest('#i-go')) {
      const u = linkFromText($('#i-url', o).value);
      if (!u) { $('#i-msg', o).textContent = 'Keinen Link gefunden. Bitte einen Link mit https:// einfügen.'; return; }
      $('#i-url', o).value = u;
      fromLink(u);
    }
  });
  o.addEventListener('change', e => { if (e.target.id === 'i-file' && e.target.files.length) fromPhotos([...e.target.files]); });
  start();
}

/* Grösstes eingebettetes JPEG-Foto aus einem PDF holen (ohne PDF-Bibliothek: DCT-Streams direkt auslesen) */
async function pdfPhoto(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const str = new TextDecoder('latin1').decode(bytes);
  const cands = []; const re = /stream\r?\n/g; let m;
  while ((m = re.exec(str))) {
    const st = m.index + m[0].length;
    if (bytes[st] !== 0xFF || bytes[st + 1] !== 0xD8 || bytes[st + 2] !== 0xFF) continue;
    let en = str.indexOf('endstream', st); if (en < 0) en = bytes.length;
    while (en > st && bytes[en - 1] <= 32) en--;
    if (en - st > 8000) cands.push(bytes.subarray(st, en));
  }
  cands.sort((a, b) => b.length - a.length);
  for (const c of cands.slice(0, 6)) {
    try {
      const url = URL.createObjectURL(new Blob([c], { type: 'image/jpeg' }));
      const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('x')); i.src = url; });
      URL.revokeObjectURL(url);
      if (im.naturalWidth < 240 || im.naturalHeight < 240) continue;
      const k = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight));
      const cv = document.createElement('canvas'); cv.width = Math.round(im.naturalWidth * k); cv.height = Math.round(im.naturalHeight * k);
      const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(im, 0, 0, cv.width, cv.height);
      return cv.toDataURL('image/jpeg', 0.82);
    } catch {}
  }
  return null;
}
/* PDF in eine Basiswissen-Seite (Titel + Freitext) umwandeln */
async function pdfToPage(file) {
  const key = lsGet('rb_akey');
  if (!key) throw new Error('Kein Claude-API-Schlüssel hinterlegt (Einstellungen → Tokens)');
  const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = () => rej(new Error('PDF lässt sich nicht lesen')); fr.readAsDataURL(file); });
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 16000,
      system: 'Du überträgst den Inhalt eines PDF in eine lesbare Textseite. Antworte ausschliesslich, indem du das Tool «seite» genau einmal aufrufst. Schreibe keinen weiteren Text.',
      tools: [{ name: 'seite', description: 'Textseite aus einem PDF', input_schema: { type: 'object', properties: {
        titel: { type: 'string', description: 'Kurzer Titel der Seite' },
        text: { type: 'string', description: 'Vollständiger Inhalt als Freitext, in der Sprache des PDF, nichts weglassen und nichts erfinden. Zwischentitel als eigene Zeile mit «# » am Anfang. Absätze durch Leerzeilen trennen, Aufzählungen mit «- ». Tabellen zeilenweise als «Spalte: Wert» oder «a | b | c». Keine Nummerierung von Schritten hinzufügen.' } }, required: ['titel', 'text'] } }],
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }, { type: 'text', text: 'Übertrage dieses PDF vollständig in eine Textseite.' }] }] })
  });
  if (!r.ok) { let m = ''; try { m = (await r.json()).error.message; } catch {} throw new Error(r.status === 401 ? 'Claude-API-Schlüssel ungültig' : 'Claude-API: ' + r.status + (m ? ' – ' + m : '')); }
  const j = await r.json(); const t = (j.content || []).find(c => c.type === 'tool_use');
  if (!t || !t.input || !String(t.input.text || '').trim()) throw new Error('Aus dem PDF liess sich kein Text lesen' + (j.stop_reason === 'max_tokens' ? ' (zu lang)' : ''));
  return { n: String(t.input.titel || '').trim() || file.name.replace(/\.pdf$/i, ''), t: String(t.input.text).replace(/\s+$/, '') };
}
/* Basiswissen: je Hauptordner PDFs und eigene Seiten (Foto + Freitext). Dateien unter doc/<ordner>/, Liste in config.json */
const libBlob = {}, libImg = {};
let libRedraw = null;
const docSrc = p => libImg[p] || libBlob[p] || encodeURI(p);
const docNewId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
function openLib(fid) {
  const f = FB[fid]; if (!f) return;
  const o = document.createElement('div'); o.className = 'sheet-bg'; o.style.zIndex = '90';
  o.innerHTML = `<div class="sheet imp full" role="dialog" aria-label="Basiswissen"><h3>📚 Basiswissen</h3>
    <div style="display:flex;gap:10px;margin:2px 0 12px"><button class="chip" type="button" id="l-new" style="flex:1;justify-content:center;text-align:center;padding:6px 8px;font-size:16px" aria-label="Neue Seite mit Text und Foto">📝 Text, Foto</button><button class="chip" type="button" id="l-add" style="flex:1;justify-content:center;text-align:center;padding:6px 8px;font-size:16px" aria-label="PDF einlesen (wird zur Seite)">📄 PDF</button></div>
    <div class="rlist grow" id="l-list" style="overflow:auto"></div>
    <input id="l-file" type="file" accept="application/pdf,.pdf" multiple hidden>
    <p class="note tiny err" id="l-msg"></p>
    <div class="acts"><button type="button" class="chip" id="l-close">Schliessen</button></div></div>`;
  document.body.appendChild(o);
  let busy = false;
  const list = () => (cfg.docs && cfg.docs[fid]) || [];
  const draw = () => {
    const l = list();
    const sub = `Basiswissen · ${esc(f.name)}`;
    const xb = (i, t) => `<button type="button" class="fstar" data-ldel="${i}" aria-label="${t}">✕</button>`;
    const ctr = ' style="display:flex;align-items:center;justify-content:center;font-size:28px"';
    $('#l-list', o).innerHTML = l.length ? l.map((d, i) => d.p
      ? `<a class="rrow" href="${esc(docSrc(d.p))}" target="_blank" rel="noopener"><span class="rph"${ctr}>📄</span><span class="rt"><b>${esc(d.n)}</b><small>PDF · ${sub}</small></span>${xb(i, 'PDF entfernen')}</a>`
      : `<a class="rrow" href="#" data-lpage="${i}"><span class="rph"${d.im ? '' : ctr}>${d.im ? `<img loading="lazy" decoding="async" src="${esc(docSrc(d.im))}" alt="">` : '📝'}</span><span class="rt"><b>${esc(d.n)}</b><small>${sub}</small></span>${xb(i, 'Seite entfernen')}</a>`).join('') : '<p class="note">Noch nichts in diesem Ordner.</p>';
  };
  draw(); libRedraw = draw;
  const msg = t => { $('#l-msg', o).textContent = t; };
  const close = () => { libRedraw = null; o.remove(); };
  o.addEventListener('click', async e => {
    if (e.target === o || e.target.closest('#l-close')) { if (!busy) close(); return; }
    if (busy) return;
    if (e.target.closest('#l-add')) { $('#l-file', o).click(); return; }
    if (e.target.closest('#l-new')) { openDocEdit(fid, null); return; }
    const del = e.target.closest('[data-ldel]');
    if (!del) { const pg = e.target.closest('[data-lpage]'); if (pg) { e.preventDefault(); openDocPage(fid, list()[+pg.dataset.lpage].id); return; } }
    if (del) {
      e.preventDefault();
      const i = +del.dataset.ldel, d = list()[i]; if (!d) return;
      if (!confirm('«' + d.n + '» wirklich entfernen?')) return;
      cfg.docs[fid] = list().filter((_, k) => k !== i); if (!cfg.docs[fid].length) delete cfg.docs[fid];
      persist(); draw(); msg('');
      try { if (d.p) await delFile(d.p); else if (d.im) await delFile(d.im); } catch {}
    }
  });
  $('#l-file', o).addEventListener('change', async e => {
    const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
    busy = true; o.querySelectorAll('button').forEach(b => { b.disabled = true; }); let fileNote = '';
    try {
      if (!getToken()) throw new Error('GitHub-Token fehlt (Einstellungen → Tokens)');
      for (const file of files) {
        if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new Error('«' + file.name + '» ist keine PDF-Datei');
        if (file.size > 20 * 1024 * 1024) throw new Error('«' + file.name + '» ist zu gross (über 20 MB)');
        msg('«' + file.name + '» wird gelesen und umgewandelt …');
        const pg = await pdfToPage(file);
        const id = docNewId(); let im = '', note = '';
        try {
          const ph = await pdfPhoto(file);
          if (ph) {
            const path = `doc/${fid}/${id}-${Date.now().toString(36)}.jpg`;
            const x = await putFile(path, ph.split(',')[1], 'App: Basiswissen-Foto');
            if (x.ok) { libImg[path] = ph; im = path; } else note = ' Das Foto liess sich nicht speichern (' + x.status + ').';
          } else note = ' Im PDF wurde kein Foto gefunden.';
        } catch { note = ' Das Foto liess sich nicht auslesen.'; }
        (cfg.docs[fid] = cfg.docs[fid] || []).push({ id, n: pg.n, t: pg.t, ...(im ? { im } : {}) });
        persist(); draw(); if (note) fileNote = note;
      }
      msg('Als Seite übernommen.' + fileNote + ' Bitte mit ✏️ prüfen und bei Bedarf korrigieren.');
    } catch (err) { msg('⚠ ' + err.message); }
    busy = false; o.querySelectorAll('button').forEach(b => { b.disabled = false; });
  });
}
/* Eigene Basiswissen-Seite anzeigen: wie ein Rezept, aber Freitext; nur ✏️ und 📤 */
function openDocPage(fid, id) {
  const d = ((cfg.docs && cfg.docs[fid]) || []).find(x => x.id === id); if (!d) return;
  const o = document.createElement('div'); o.className = 'docpage'; o.style.cssText = 'position:fixed;inset:0;z-index:95;overflow:auto;background:var(--bg)';
  const body = t => (t || '').split('\n').map(l => /^#\s/.test(l) ? `<h4 class="dh">${esc(l.replace(/^#\s+/, ''))}</h4>` : l.trim() ? `<p class="dp">${esc(l)}</p>` : '<p class="dp sp"></p>').join('');
  const draw = () => {
    const x = ((cfg.docs && cfg.docs[fid]) || []).find(y => y.id === id); if (!x) { o.remove(); return; }
    o.innerHTML = `<main><div class="backrow dback"><button class="back" type="button" id="d-back">‹ Zurück</button></div>
      ${x.im ? `<div class="hero"><img src="${esc(docSrc(x.im))}" alt="${esc(x.n)}"></div>` : ''}
      <div class="head"><h2>${esc(x.n)}</h2></div>
      <div class="meta"><div class="mtop"><span class="fchips"><span class="tag fchip">📚 ${esc((FB[fid] || {}).name || '')}</span></span><span class="dtools"><button type="button" class="chip dbtn" id="d-exp" aria-label="Exportieren" title="Exportieren">📤</button><button type="button" class="chip dbtn" id="d-edit" aria-label="Bearbeiten" title="Bearbeiten">✏️</button></span></div></div>
      <div class="cols"><section class="panel">${body(x.t) || '<p class="note">Noch kein Text.</p>'}</section></div>
      <p style="text-align:center;margin:18px 0 0"><button type="button" class="chip" id="d-back2">Schliessen</button></p></main>`;
  };
  draw(); document.body.appendChild(o);
  o.addEventListener('click', e => {
    const x = ((cfg.docs && cfg.docs[fid]) || []).find(y => y.id === id); if (!x) return;
    if (e.target.closest('#d-back') || e.target.closest('#d-back2')) { o.remove(); return; }
    if (e.target.closest('#d-edit')) { openDocEdit(fid, id, draw); return; }
    if (e.target.closest('#d-exp')) {
      recipeExport({ id: 'doc-' + id, n: x.n, ing: [], steps: (x.t || '').split('\n').map(l => l.trim()).filter(Boolean), cover: x.im ? docSrc(x.im) : '', pages: [], free: true, where: '📚 Basiswissen · ' + ((FB[fid] || {}).name || '') });
    }
  });
}
/* Seite anlegen / bearbeiten */
function openDocEdit(fid, id, after) {
  const cur = id ? ((cfg.docs && cfg.docs[fid]) || []).find(x => x.id === id) : null;
  let d = cur ? { ...cur } : { id: docNewId(), n: '', t: '' }, newData = null, rm = false;
  const o = document.createElement('div'); o.className = 'sheet-bg'; o.style.zIndex = '100';
  const thumb = () => newData || (!rm && d.im ? docSrc(d.im) : '');
  const draw = () => {
    const keepN = $('#x-n', o) ? $('#x-n', o).value : d.n, keepT = $('#x-t', o) ? $('#x-t', o).value : d.t; d.n = keepN; d.t = keepT;
    const u = thumb();
    o.innerHTML = `<div class="sheet imp full" role="dialog" aria-label="Seite bearbeiten"><h3>${cur ? 'Seite bearbeiten' : 'Neue Seite'}</h3>
      <div class="impline"><span class="pic" style="width:64px;height:64px;flex:none">${u ? `<img src="${esc(u)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:8px">` : ''}</span><button type="button" class="chip" id="x-ph">📷 Foto wählen</button>${u ? '<button type="button" class="chip" id="x-rm" aria-label="Foto entfernen">−</button>' : ''}</div>
      <input id="x-file" type="file" accept="image/*,.heic,.heif" hidden>
      <label>Titel<input id="x-n" type="text" value="${esc(d.n)}"></label>
      <label class="grow">Text <small>(frei; Zeile mit «# » am Anfang = Zwischentitel)</small><textarea id="x-t">${esc(d.t)}</textarea></label>
      <p class="note tiny err" id="x-msg"></p>
      <div class="acts"><button type="button" class="chip" id="x-cancel">Abbrechen</button><button type="button" class="chip on" id="x-save">Speichern</button></div></div>`;
  };
  draw(); document.body.appendChild(o);
  const msg = t => { $('#x-msg', o).textContent = t; };
  let busy = false;
  o.addEventListener('click', async e => {
    if (busy) return;
    if (e.target === o || e.target.closest('#x-cancel')) { o.remove(); return; }
    if (e.target.closest('#x-ph')) { $('#x-file', o).click(); return; }
    if (e.target.closest('#x-rm')) { if (confirm('Foto wirklich entfernen?')) { newData = null; rm = true; draw(); } return; }
    if (e.target.closest('#x-save')) {
      const n = $('#x-n', o).value.trim(), t = $('#x-t', o).value.replace(/\s+$/, '');
      if (!n) { msg('Bitte einen Titel eingeben.'); return; }
      busy = true; o.querySelectorAll('button').forEach(b => { b.disabled = true; });
      try {
        if (!getToken()) throw new Error('GitHub-Token fehlt (Einstellungen → Tokens)');
        const old = cur && cur.im; let im = rm ? '' : (cur && cur.im) || '';
        if (newData) {
          msg('Foto wird gespeichert …');
          const path = `doc/${fid}/${d.id}-${Date.now().toString(36)}.jpg`;
          const x = await putFile(path, newData.split(',')[1], 'App: Basiswissen-Foto');
          if (!x.ok) throw new Error('Foto speichern fehlgeschlagen (' + x.status + ')');
          libImg[path] = newData; im = path;
        }
        const item = { id: d.id, n, t, ...(im ? { im } : {}) };
        const l = cfg.docs[fid] = cfg.docs[fid] || [];
        const k = l.findIndex(x => x.id === d.id); if (k >= 0) l[k] = item; else l.push(item);
        persist(); if (libRedraw) libRedraw();
        o.remove(); if (after) after();
        if (old && old !== im) { try { await delFile(old); } catch {} }
      } catch (err) { busy = false; o.querySelectorAll('button').forEach(b => { b.disabled = false; }); msg('⚠ ' + err.message); }
    }
  });
  $('#x-file', o).addEventListener('change', async e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    try { newData = await shrink(file, 1600, 0.82); rm = false; draw(); } catch (err) { msg('⚠ ' + err.message); }
  });
}
/* Alle Rezepte: bearbeiten, Bilder nachladen/entfernen, löschen */
async function delFile(path) {
  if (!/^(img\/u|doc)\//.test(path)) return;
  const u = `https://api.github.com/repos/${REPO}/contents/${path}`;
  const g = await fetch(`${u}?ref=main&_=${Date.now()}`, { headers: hdr(getToken()), cache: 'no-store' });
  if (g.status === 404) return;
  if (!g.ok) throw new Error('Foto löschen fehlgeschlagen (' + g.status + ')');
  const { sha } = await g.json();
  const r = await fetch(u, { method: 'DELETE', headers: hdr(getToken(), true), body: JSON.stringify({ message: 'App: Rezeptfoto gelöscht', sha, branch: 'main' }) });
  if (!r.ok) throw new Error('Foto löschen fehlgeschlagen (' + r.status + ')');
}
function openEditSheet(r) {
  const o = document.createElement('div'); o.className = 'sheet-bg'; document.body.appendChild(o);
  const port0 = r.port || 4;
  const orig = [r.cover, ...(r.pages || [])].filter(Boolean);
  let items = orig.map(p => ({ path: p, src: imgUrl(p, 300) })), cov = 0, busyOn = false;
  const hasOv = !!DOC.overrides[r.id];
  const draw = (msg = '') => {
    o.innerHTML = `<div class="sheet imp" role="dialog" aria-label="Rezept bearbeiten"><h3>Rezept bearbeiten</h3>
      <div class="impline"><span class="impic" aria-hidden="true">📥</span><button class="secbar" type="button" id="p-imp">Text, jpg, pdf, Link</button></div>
      <div class="picblock"><div class="pics">${items.map((it, i) => `<div class="pic"><img src="${esc(it.src)}" alt="">
        <label class="chk tcov"><input type="radio" name="p-cov" value="${i}"${i === cov ? ' checked' : ''}> Titelbild</label>
        <button type="button" class="chip ib2" data-crop="${i}" aria-label="Ausschnitt" title="Ausschnitt">✂</button>
        <button type="button" class="chip ib2" data-del="${i}" aria-label="Bild entfernen" title="Bild entfernen">−</button>
        <button type="button" class="chip ib2" data-ocr="${i}" aria-label="Text aus diesem Foto lesen" title="Text aus diesem Foto lesen">🔍</button>
        <button type="button" class="chip ib2" id="${i === 0 ? 'p-photo' : 'p-photo' + i}" data-pphoto="${i}" aria-label="Dieses Bild als Ordnerfoto verwenden" title="Dieses Bild als Ordnerfoto verwenden">🖼️</button>
        <button type="button" class="chip ib2" data-padd="1" aria-label="Bilder hinzufügen" title="Bilder hinzufügen">＋</button></div>`).join('') || '<div class="pic"><span class="note tiny" style="flex:1">Keine Bilder.</span><button type="button" class="chip ib2" data-padd="1" aria-label="Bilder hinzufügen" title="Bilder hinzufügen">＋</button></div>'}</div>
      <input id="p-file" type="file" accept="image/*,.heic,.heif,image/heic,image/heif" multiple hidden></div>
      <label>Name<input id="e-n" type="text" value="${esc(r.n)}"></label>
      <label>Rezept für <small>(Personen; die Zutatenmengen im Text gelten für diese Zahl)</small><input id="e-p" type="number" inputmode="numeric" min="1" max="99" value="${r.port || 4}"></label>
      <label>Schlagwörter <small>(mit Komma getrennt)</small><input id="e-t" type="text" value="${esc((r.tags || []).join(', '))}"></label>
      <label>Zutaten <small>(eine pro Zeile)</small><textarea id="e-i" rows="8">${esc(r.ing.join('\n'))}</textarea></label>
      <label>Zubereitung <small>(ein Schritt pro Zeile; Text markieren, dann ▲ = Titel, ▼ = Text)</small> <span class="hlv"><button type="button" class="chip" data-lvl="up" aria-label="Als Abschnittstitel" title="Als Abschnittstitel">▲</button><button type="button" class="chip" data-lvl="down" aria-label="Als normalen Text" title="Als normalen Text">▼</button></span><textarea id="e-s" rows="10">${esc(r.steps.join('\n'))}</textarea></label>
      <p class="note tiny err" id="p-msg">${esc(msg)}</p>
      <div class="acts"><button type="button" class="chip danger" id="p-delrec">Löschen</button>${hasOv ? '<button type="button" class="chip" id="p-reset">Original</button>' : ''}<button type="button" class="chip" id="p-cancel">Abbrechen</button><button type="button" class="chip on" id="p-save">Speichern</button></div></div>`;
  };
  // Eingaben beim Neuzeichnen (Bild hinzufügen/entfernen) behalten
  const keepText = () => { const g = id => { const e = $(id, o); return e ? e.value : null; }; r = { ...r, port: Math.min(99, Math.max(1, parseInt(g('#e-p'), 10) || r.port || 4)), n: g('#e-n') ?? r.n, tags: (g('#e-t') ?? (r.tags || []).join(',')).split(',').map(x => x.trim()).filter(Boolean), ing: (g('#e-i') ?? r.ing.join('\n')).split('\n').map(x => x.trim()).filter(Boolean), steps: (g('#e-s') ?? r.steps.join('\n')).split('\n').map(x => x.trim()).filter(Boolean) }; };
  const lock = on => { busyOn = on; o.querySelectorAll('button').forEach(b => { b.disabled = on; }); };
  const cleanup = () => {
    let ch = false;
    cfg.folders.forEach(f => { if (f.photo === r.id) { delete f.photo; delete f.pimg; ch = true; } });
    if (cfg.assign[r.id]) { delete cfg.assign[r.id]; ch = true; }
    if (state.fav.has(r.id)) { state.fav.delete(r.id); ch = true; }
    if (ch) persist();
  };
  /* Text/Link/Foto/PDF einlesen und in dieses Rezept übernehmen (Prüfen, dann Speichern) */
  const readInto = () => {
    const q = document.createElement('div'); q.className = 'sheet-bg'; q.style.zIndex = '90';
    q.innerHTML = `<div class="sheet imp full" role="dialog" aria-label="Einlesen"><h3>In dieses Rezept einlesen</h3>
      <p class="note tiny">Text oder Link einfügen, oder Foto/PDF wählen. Danach prüfst du das Ergebnis im Bearbeiten-Fenster und speicherst.</p>
      <label class="grow">Rezepttext oder Link<textarea id="q-text" placeholder="Hier einfügen …"></textarea></label>
      <button class="chip on" type="button" id="q-textgo">📋 Text / Link einlesen</button>
      <button class="chip big" type="button" id="q-photo">📷 Foto, Scan oder PDF wählen</button>
      <input id="q-file" type="file" accept="image/*,.heic,.heif,image/heic,image/heif,application/pdf,.pdf" multiple hidden>
      <div class="seg"><label class="chk"><input type="radio" name="q-mode" value="add" checked> Zutaten und Schritte anfügen</label><label class="chk"><input type="radio" name="q-mode" value="rep"> Ersetzen</label></div>
      <p class="note tiny err" id="q-msg"></p>
      <div class="acts"><button type="button" class="chip" id="q-cancel">Abbrechen</button></div></div>`;
    document.body.appendChild(q);
    let qb = false;
    const st = t => { $('#q-msg', q).textContent = t; };
    const lockQ = on => { qb = on; q.querySelectorAll('button').forEach(b => { b.disabled = on; }); };
    const apply = (rec, imgs) => {
      const rep = (q.querySelector('input[name=q-mode]:checked') || {}).value === 'rep';
      const ing = (rec.ing || []).map(x => String(x).trim()).filter(Boolean), steps = (rec.steps || []).map(x => String(x).trim()).filter(Boolean);
      r = { ...r, ing: rep ? ing : [...r.ing, ...ing], steps: rep ? steps : [...r.steps, ...steps] };
      if (rec.port > 0 && (rep || !r.port)) r.port = Math.min(99, +rec.port);
      imgs.forEach(d => items.push({ dataUrl: d, src: d }));
      q.remove(); draw(imgs.length ? 'Gelesen. Bitte prüfen und speichern. Die Fotos wurden bei «Bilder» hinzugefügt.' : 'Gelesen. Bitte prüfen und speichern.');
    };
    const run = async fn => { lockQ(true); try { const x = await fn(); apply(x.rec, x.images || []); } catch (err) { lockQ(false); st('⚠ ' + err.message); } };
    q.addEventListener('click', e => {
      if (qb) return;
      if (e.target === q || e.target.closest('#q-cancel')) { q.remove(); return; }
      if (e.target.closest('#q-photo')) { $('#q-file', q).click(); return; }
      if (e.target.closest('#q-textgo')) {
        const t = $('#q-text', q).value.trim();
        if (t.length < 20) { st('Bitte zuerst Text oder einen Link einfügen.'); return; }
        run(async () => ({ rec: await extractFromText(t, st) }));
      }
    });
    q.addEventListener('change', e => { if (e.target.id === 'q-file' && e.target.files.length) run(() => extractFromFiles([...e.target.files], st)); });
  };
  draw();
  o.addEventListener('change', async e => {
    if (e.target.name === 'p-cov') { cov = Number(e.target.value); return; }
    if (e.target.id === 'p-file' && e.target.files.length) {
      try { keepText(); for (const f of [...e.target.files]) { const d = await shrink(f, 1600, 0.82); items.push({ dataUrl: d, src: d }); } draw(); }
      catch (err) { draw('⚠ ' + err.message); }
    }
  });
  o.addEventListener('pointerdown', e => { if (e.target.closest('[data-lvl]')) e.preventDefault(); });
  o.addEventListener('click', e => {
    const lb = e.target.closest('[data-lvl]'); if (!lb) return;
    const ta = $('#e-s', o); if (!ta) return;
    const v = ta.value; let a = ta.selectionStart, b = ta.selectionEnd;
    const ls = v.lastIndexOf('\n', a - 1) + 1; let le = v.indexOf('\n', b > a ? b - 1 : b); if (le < 0) le = v.length;
    const up = lb.dataset.lvl === 'up';
    const out = v.slice(ls, le).split('\n').map(l => {
      const t = l.trim(); if (!t) return l;
      if (up) return /^#\s/.test(t) ? t : '# ' + t.replace(/[.!?:]+$/, '');
      const x = headText(t); return (x.length <= 24 && !/[.!?]/.test(x)) ? x + '.' : x;
    }).join('\n');
    ta.value = v.slice(0, ls) + out + v.slice(le);
    ta.focus(); ta.setSelectionRange(ls, ls + out.length);
  });
  o.addEventListener('click', async e => {
    if (e.target === o) { if (!busyOn) o.remove(); return; }
    if (e.target.id === 'p-cancel') { o.remove(); return; }
    if (e.target.id === 'p-add' || e.target.closest('[data-padd]')) { $('#p-file', o).click(); return; }
    if (e.target.id === 'p-imp') { keepText(); readInto(); return; }
    const pph = e.target.closest('[data-pphoto]');
    if (pph) { const it = items[+pph.dataset.pphoto]; if (!it || !it.path) { $('#p-msg', o).textContent = 'Dieses Bild zuerst speichern, danach als Ordnerfoto wählen.'; return; } openPhotoSheet(r, it.path); return; }
    const ocr = e.target.closest('[data-ocr]');
    if (ocr) {
      const only = items[+ocr.dataset.ocr];
      keepText();
      const msg = $('#p-msg', o); lock(true);
      try {
        const urls = []; let k = 0;
        for (const it of [only]) { msg.textContent = 'Foto ' + (++k) + ' wird geladen …'; urls.push(it.dataUrl || await loadImageData(it.path)); }
        const rec = await extractFromDataUrls(urls, t => { msg.textContent = t; });
        const hadNone = !r.ing.length && !r.steps.length;
        const nIng = (rec.ing || []).map(x => String(x).trim()).filter(Boolean), nSt = (rec.steps || []).map(x => String(x).trim()).filter(Boolean);
        const rep = [];
        if (nIng.length && (!r.ing.length || confirm('Auf dem Foto wurden ' + nIng.length + ' Zutaten gefunden. Die vorhandenen Zutaten ersetzen?'))) { r = { ...r, ing: nIng }; rep.push('Zutaten'); }
        if (nSt.length && (!r.steps.length || confirm('Auf dem Foto wurden ' + nSt.length + ' Zeilen Zubereitung gefunden. Die vorhandene Zubereitung ersetzen?'))) { r = { ...r, steps: nSt }; rep.push('Zubereitung'); }
        if (rec.port > 0 && hadNone) r.port = Math.min(99, +rec.port);
        lock(false); draw(rep.length ? 'Übernommen: ' + rep.join(' und ') + '. Bitte prüfen (Mengen, Schritte) und speichern.' : 'Auf diesem Foto wurde nichts übernommen (nichts gefunden oder abgelehnt).');
      } catch (err) { lock(false); msg.textContent = '⚠ ' + err.message; }
      return;
    }
    const cr = e.target.closest('[data-crop]');
    if (cr) { keepText(); const i = Number(cr.dataset.crop), it = items[i]; const d = await openCrop(it.dataUrl || imgUrl(it.path, 1600)); if (d) items[i] = { dataUrl: d, src: d }; draw(); return; }
    const del = e.target.closest('[data-del]');
    if (del) { if (!confirm('Dieses Bild wirklich entfernen?')) return; keepText(); const i = Number(del.dataset.del); items.splice(i, 1); if (cov === i) cov = 0; else if (cov > i) cov--; draw(); return; }
    if (e.target.id === 'p-save') {
      keepText();
      if (!r.n.trim()) { $('#p-msg', o).textContent = 'Bitte einen Namen eingeben.'; return; }
      lock(true); $('#p-msg', o).textContent = 'Speichere …';
      try {
        const ordered = items.length ? [items[cov], ...items.filter((x, i) => i !== cov)] : [];
        const stamp = Date.now().toString(36);
        const files = [];
        ordered.forEach((it, n) => { if (it.dataUrl) { it.path = `img/u/${r.id}-${stamp}-${n + 1}.jpg`; files.push({ path: it.path, b64: it.dataUrl.split(',')[1] }); } });
        for (const f of files) { const x = await putFile(f.path, f.b64, 'App: Rezeptfoto'); if (!x.ok) throw new Error('Foto speichern fehlgeschlagen (' + x.status + ')'); }
        const nv = { n: r.n.trim(), port: r.port, tags: r.tags, ing: r.ing, steps: r.steps, cover: ordered[0] ? ordered[0].path : '', pages: ordered.slice(1).map(p => p.path) };
        await modifyDoc(d => r.u
          ? { ...d, recipes: d.recipes.map(x => x.id === r.id ? { ...x, ...nv } : x) }
          : { ...d, overrides: { ...d.overrides, [r.id]: nv } }, 'App: Rezept «' + nv.n + '» geändert');
        if ((nv.port || 4) !== port0) localStorage.removeItem('rb_port_' + r.id);
        const keep = new Set(ordered.map(p => p.path));
        for (const p of orig) if (!keep.has(p)) { try { await delFile(p); } catch {} }
        o.remove(); renderFilters(); route();
      } catch (err) { lock(false); $('#p-msg', o).textContent = '⚠ ' + err.message; }
      return;
    }
    if (e.target.id === 'p-reset') {
      if (!confirm('Alle Änderungen an «' + r.n + '» verwerfen und das ursprüngliche Rezept wiederherstellen?')) return;
      lock(true); $('#p-msg', o).textContent = 'Stelle wieder her …';
      try {
        await modifyDoc(d => { const ov = { ...d.overrides }; delete ov[r.id]; return { ...d, overrides: ov }; }, 'App: Rezept «' + r.n + '» zurückgesetzt');
        for (const p of orig) { try { await delFile(p); } catch {} }
        o.remove(); renderFilters(); route();
      } catch (err) { lock(false); $('#p-msg', o).textContent = '⚠ ' + err.message; }
      return;
    }
    if (e.target.id === 'p-delrec') {
      if (!confirm('Rezept «' + r.n + '» endgültig löschen?' + (r.u ? ' Die Fotos werden ebenfalls gelöscht.' : ''))) return;
      lock(true); $('#p-msg', o).textContent = 'Lösche …';
      try {
        await modifyDoc(d => r.u
          ? { ...d, recipes: d.recipes.filter(x => x.id !== r.id) }
          : { ...d, deleted: [...new Set([...d.deleted, r.id])], overrides: Object.fromEntries(Object.entries(d.overrides).filter(([k]) => k !== r.id)) }, 'App: Rezept «' + r.n + '» gelöscht');
        for (const p of orig) { try { await delFile(p); } catch {} }
        cleanup(); o.remove(); renderFilters(); location.hash = '';
      } catch (err) { lock(false); $('#p-msg', o).textContent = '⚠ ' + err.message; }
    }
  });
}

function folderPhoto(id) {
  if ((FB[id] || {}).img) return imgUrl(FB[id].img, 240);
  const pr = byId[(FB[id] || {}).photo];
  if (pr && pr.cover) { const pi = FB[id].pimg; return imgUrl(pi && [pr.cover, ...(pr.pages || [])].includes(pi) ? pi : pr.cover, 240); }
  const sub = subtree(id);
  const c = R.filter(r => r.cover && foldersOf(r).some(x => sub.has(x)));
  const best = c.find(r => r.ing && r.ing.length && r.steps && r.steps.length) || c[0];
  return best ? imgUrl(best.cover, 240) : '';
}
function applySize() {
  $$('#photoseg [data-photos]').forEach(b => b.setAttribute('aria-pressed', (b.dataset.photos === '1') === !!cfg.photos));
  document.documentElement.dataset.size = cfg.size; document.documentElement.dataset.rsize = cfg.rsize || 'm';
  $$('#rsizeseg [data-rsize]').forEach(b => b.setAttribute('aria-pressed', b.dataset.rsize === (cfg.rsize || 'm')));
  updGrid();
  $$('#sizeseg [data-size]').forEach(b => b.setAttribute('aria-pressed', b.dataset.size === cfg.size));
}

/* ---------- Startbildschirm & Ordnerseiten ---------- */

function tileHtml(f) {
  const sub = kids(f.id).length;
  const ph = cfg.photos ? folderPhoto(f.id) : '';
  return `<button class="tile${f.show ? '' : ' off'}${ph ? ' hasphoto' : ''}" type="button" data-folder="${esc(f.id)}" style="--c:${esc(f.color)}">
    ${ph ? `<span class="ic photo" style="background-image:url('${esc(ph)}')"></span>` : `<span class="ic">${esc(f.icon)}</span>`}<b>${esc(f.name)}</b><small>${countIn(f.id)}${sub ? ' · ' + sub + '📁' : ''}</small>${state.edit ? '<i class="pen">✎</i>' : ''}</button>`;
}
/* ---------- Raster (Kachel-Muster) ---------- */
const lrow = n => Array.from({ length: n }, (_, i) => [i, 0, 1, 1]);
const lgrid = (c, n, y0 = 0, x0 = 0) => Array.from({ length: n }, (_, i) => [x0 + i % c, y0 + Math.floor(i / c), 1, 1]);
function layoutsFor(n) {
  const L = (id, name, cols, rows, cells) => ({ id, name, cols, rows, cells });
  const t = [];
  if (n === 2) t.push(L('r2', '2 nebeneinander', 2, 1, lrow(2)));
  if (n === 3) t.push(L('r3', '3 nebeneinander', 3, 1, lrow(3)), L('t3', 'Gross links, 2 rechts', 2, 2, [[0, 0, 1, 2], [1, 0, 1, 1], [1, 1, 1, 1]]));
  if (n === 4) t.push(L('r4', '4 nebeneinander', 4, 1, lrow(4)), L('g4', '2 × 2', 2, 2, lgrid(2, 4)));
  if (n === 5) t.push(L('r5', '5 nebeneinander', 5, 1, lrow(5)), L('t5', '1 hohe + 4', 3, 2, [[0, 0, 1, 2], ...lgrid(2, 4, 0, 1)]));
  if (n === 6) t.push(L('g6a', '3 × 2', 3, 2, lgrid(3, 6)), L('g6b', '2 × 3', 2, 3, lgrid(2, 6)));
  if (n === 7) t.push(L('b7', '1 breite oben + 6', 3, 3, [[0, 0, 3, 1], ...lgrid(3, 6, 1)]), L('h7', '1 hohe links + 6 (2 Spalten)', 3, 3, [[0, 0, 1, 3], ...lgrid(2, 6, 0, 1)]), L('t7', '1 hohe links + 6 (3 Spalten)', 4, 2, [[0, 0, 1, 2], ...lgrid(3, 6, 0, 1)]));
  if (n === 8) t.push(L('g8', '4 × 2', 4, 2, lgrid(4, 8)), L('m8', '2 gross + 6', 6, 6, [[0, 0, 3, 2], [3, 0, 3, 2], ...Array.from({ length: 6 }, (_, i) => [(i % 3) * 2, 2 + Math.floor(i / 3) * 2, 2, 2])]));
  if (n === 9) t.push(L('g9', '3 × 3', 3, 3, lgrid(3, 9)), L('t9', '1 hohe + 8', 5, 2, [[0, 0, 1, 2], ...lgrid(4, 8, 0, 1)]));
  if (n >= 10) [3, 4, 5].forEach(c => t.push(L('c' + c, c + ' Spalten', c, Math.ceil(n / c), lgrid(c, n))));
  return t;
}
const gridKey = p => p || 'root';
const shownKids = parent => kids(parent).filter(f => f.show);
const gridCount = parent => shownKids(parent).length + (parent ? 0 : 1);
const activeLayout = parent => { const s = cfg.layouts[gridKey(parent)]; if (!s || s.n !== gridCount(parent)) return null; return layoutsFor(s.n).find(l => l.id === s.id) || null; };
function fitLayout() {
  const t = $('#tiles.lay'); if (!t) return;
  const cols = Number(t.dataset.cols), gap = 8, u = (t.clientWidth - gap * (cols - 1)) / cols;
  if (!(u > 0)) return;
  t.style.gridAutoRows = u * 1.02 + 'px';
  $$('.tile[data-w]', t).forEach(b => b.classList.toggle('compact', u * Number(b.dataset.w) + gap * (Number(b.dataset.w) - 1) < 78));
}
new MutationObserver(fitLayout).observe($('#view'), { childList: true, subtree: true });
window.addEventListener('resize', fitLayout);
function tilesBlock(parent) {
  const list = kids(parent).filter(f => state.edit || f.show);
  const allTile = parent ? '' : `<button class="tile all fixed${cfg.photos ? ' hasphoto' : ''}" type="button" data-folder="alle" style="--c:#46604b">${cfg.photos ? `<span class="ic photo" style="background-image:url('${ALLE_FOTO}')"></span>` : '<span class="ic">📖</span>'}<b>Alle Rezepte</b><small>${R.length}</small></button>`;
  if (!list.length && !state.edit && parent) return '';
  const lay = state.edit || parent ? null : activeLayout(parent); /* Raster nur auf Home */
  let tiles = [allTile, ...list.map(tileHtml)].filter(Boolean);
  if (lay) {
    tiles = tiles.map((h, i) => { const [x, y, w, hh] = lay.cells[i] || [0, 0, 1, 1]; return h.replace('style="--c:', `data-w="${w}" style="grid-column:${x + 1} / span ${w};grid-row:${y + 1} / span ${hh};--c:`); });
  }
  return `<div class="tiles${lay ? ' lay' : ''}" id="tiles" data-parent="${esc(parent || '')}"${lay ? ` data-cols="${lay.cols}" style="grid-template-columns:repeat(${lay.cols},minmax(0,1fr))"` : ''}>${tiles.join('')}${state.edit ? `<button class="tile add fixed" type="button" id="hadd"><span class="ic">＋</span><b>Neuer Ordner</b></button>` : ''}</div>`;
}
/* «Was koche ich heute?»: erst fragen, aus welchen Ordnern gewürfelt wird */
function openRandom() {
  const o = document.createElement('div'); o.className = 'sheet-bg';
  const rows = flat().filter(({ f }) => f.show && countIn(f.id));
  const last = store.get('rb_rand', []);
  o.innerHTML = `<div class="sheet imp" role="dialog" aria-label="Was koche ich heute?"><h3>🎲 Was koche ich heute?</h3>
    <p class="note tiny">Aus welchen Ordnern soll ich ein Rezept vorschlagen? Ein Ordner schliesst seine Unterordner ein. Ohne Auswahl wird aus allen Rezepten gewürfelt.</p>
    <div class="fpick">${rows.map(({ f, depth }) => `<label class="chk" style="padding-left:${depth * 18}px"><input type="checkbox" value="${esc(f.id)}"${last.includes(f.id) ? ' checked' : ''}> ${esc(f.icon)} ${esc(f.name)} <small>(${countIn(f.id)})</small></label>`).join('')}</div>
    <p class="note tiny err" id="rd-msg"></p>
    <div class="acts"><button type="button" class="chip" id="rd-cancel">Abbrechen</button><button type="button" class="chip on" id="rd-go">🎲 Würfeln</button></div></div>`;
  document.body.appendChild(o);
  o.addEventListener('click', e => {
    if (e.target === o || e.target.closest('#rd-cancel')) { o.remove(); return; }
    if (!e.target.closest('#rd-go')) return;
    const ids = [...o.querySelectorAll('.fpick input:checked')].map(x => x.value);
    store.set('rb_rand', ids);
    const set = new Set(); ids.forEach(id => subtree(id).forEach(x => set.add(x)));
    const pool = ids.length ? R.filter(r => foldersOf(r).some(x => set.has(x))) : R;
    if (!pool.length) { $('#rd-msg', o).textContent = 'In dieser Auswahl gibt es keine Rezepte.'; return; }
    const r = pool[Math.floor(Math.random() * pool.length)];
    o.remove(); state.nav = pool.map(x => x.id); location.hash = '#/r/' + r.id;
  });
}
function openGrid(parent) {
  const n = gridCount(parent), opts = layoutsFor(n);
  if (!opts.length) { alert('Für ' + n + (n === 1 ? ' Ordner gibt es kein Raster.' : ' Ordner gibt es kein Raster.')); return; }
  const apply = id => { cfg.layouts[gridKey(parent)] = { n, id }; store.set('rb_layouts', cfg.layouts); state.edit = false; refresh(); updGrid(); };
  if (opts.length === 1) { apply(opts[0].id); return; }
  const o = document.createElement('div'); o.className = 'sheet-bg'; o.style.zIndex = '120';
  const prev = l => `<span class="gprev" style="grid-template-columns:repeat(${l.cols},1fr);grid-auto-rows:${Math.round(44 / Math.max(l.cols, l.rows) * (l.cols > 6 ? 1.6 : 1))}px">${l.cells.slice(0, n).map(([x, y, w, h]) => `<i style="grid-column:${x + 1} / span ${w};grid-row:${y + 1} / span ${h}"></i>`).join('')}</span>`;
  o.innerHTML = `<div class="sheet imp" role="dialog" aria-label="Raster wählen"><h3>Raster für ${n} Kacheln</h3><p class="note tiny">Welche Anordnung soll es sein? Die erste Kachel ist jeweils die grosse, und du kannst die Reihenfolge danach durch Ziehen ändern.</p>
    <div class="gopts">${opts.map(l => `<button type="button" class="gopt" data-g="${l.id}">${prev(l)}<span>${esc(l.name)}</span></button>`).join('')}</div>
    <div class="acts"><button type="button" class="chip" id="g-cancel">Abbrechen</button></div></div>`;
  document.body.appendChild(o);
  o.addEventListener('click', e => { if (e.target === o || e.target.closest('#g-cancel')) { o.remove(); return; } const b = e.target.closest('[data-g]'); if (b) { o.remove(); apply(b.dataset.g); } });
}
const curParent = () => (!state.q && FB[state.filter]) ? state.filter : null;
function barHtml() {
  return `<div class="hbar">${state.edit ? '<span class="hint2">Ziehen = sortieren · antippen = bearbeiten</span>' : '<span></span>'}
    
    </div>
    ${state.edit ? '<div id="savebar" class="savebar"></div>' : ''}`;
}
function renderHome() {
  state.nav = null;
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

($('#top') || document).addEventListener('click', e => {
  if (e.target.closest('#import')) { openImport(); return; }
  if (e.target.closest('#helpbtn')) { openHelp(); return; }
  if (e.target.closest('#hedit')) { state.edit = !state.edit; refresh(); window.scrollTo(0, 0); }
});

/* Favoriten bearbeiten: Reihenfolge per Ziehen, Rezept bearbeiten, entfernen */
view.addEventListener('click', e => {
  const ed = e.target.closest('[data-fedit]'), rm = e.target.closest('[data-frm]');
  if (ed && byId[ed.dataset.fedit]) { openEditSheet(byId[ed.dataset.fedit]); return; }
  if (rm) { state.fav.delete(rm.dataset.frm); persist(); refresh(); }
});
let fdrag = null;
view.addEventListener('pointerdown', e => {
  const h = e.target.closest('.fh'); if (!h) return;
  const row = h.closest('.frow'); fdrag = { row }; row.classList.add('dragging');
  try { h.setPointerCapture(e.pointerId); } catch {}
  e.preventDefault();
});
window.addEventListener('pointermove', e => {
  if (!fdrag) return;
  const el = document.elementFromPoint(e.clientX, e.clientY), over = el && el.closest && el.closest('.frow');
  if (over && over !== fdrag.row) { const b = over.getBoundingClientRect(); over.parentNode.insertBefore(fdrag.row, e.clientY > b.top + b.height / 2 ? over.nextSibling : over); }
});
const endFav = () => {
  if (!fdrag) return;
  fdrag.row.classList.remove('dragging');
  const ids = $$('.frow', view).map(r => r.dataset.id); fdrag = null;
  state.fav = new Set([...ids, ...[...state.fav].filter(x => !ids.includes(x))]); persist();
};
window.addEventListener('pointerup', endFav); window.addEventListener('pointercancel', endFav);

/* Bearbeiten: Sortieren per Ziehen */
let drag = null;
view.addEventListener('pointerdown', e => {
  const tile = state.edit && e.target.closest('#tiles .tile');
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

/* Rezept exportieren: Text oder PDF (über den Druckdialog), mit oder ohne Fotos */
function recipeExport(r) {
  const p = portState(r.id), fac = p.n / p.b;
  const ings = r.ing.map(l => scaleLine(l, fac));
  const pics = [r.cover, ...(r.pages || [])].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i);
  const where = r.where != null ? r.where : foldersOf(r).map(x => folderName(x)).join(' · ');
  const hd = t => r.free ? /^#\s/.test(t) : isHeading(t);
  const asText = () => {
    let k = 0;
    const L = [r.n, '='.repeat(Math.min(40, r.n.length)), where ? where : '', ''];
    if (ings.length) L.push('ZUTATEN (für ' + p.n + ')', ...ings.map(x => '- ' + x), '');
    if (r.steps.length) { if (!r.free) L.push('ZUBEREITUNG'); r.steps.forEach(t => { if (hd(t)) { L.push('', headText(t).toUpperCase()); k = 0; } else L.push(r.free ? t : ++k + '. ' + t); }); }
    return L.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  };
  const asHtml = withPics => {
    let k = 0;
    const steps = r.steps.map(t => hd(t) ? (k = 0, `<h3>${esc(headText(t))}</h3>`) : r.free ? `<p class="st">${esc(t)}</p>` : `<p class="st"><b>${++k}.</b> ${esc(t)}</p>`).join('');
    return `<h1>${esc(r.n)}</h1>${where ? `<p class="pm">${esc(where)}</p>` : ''}
      ${ings.length ? `<h2>Zutaten, für ${p.n}</h2><ul>${ings.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${r.steps.length ? `${r.free ? '' : '<h2>Zubereitung</h2>'}${steps}` : ''}
      ${withPics && pics.length ? `<div class="pa-pics">${pics.map(x => `<img src="${esc(imgUrl(x, 1400))}" alt="">`).join('')}</div>` : ''}`;
  };
  /* Einfaches PDF direkt im Browser erzeugen (A4, Helvetica, Fotos als JPEG) */
  const buildPdf = async withPics => {
    const W = 595, H = 842, M = 50, CW = W - 2 * M;
    const cx = document.createElement('canvas').getContext('2d');
    const wd = (t, sz, b) => { cx.font = (b ? 'bold ' : '') + sz + 'px Helvetica, Arial, sans-serif'; return cx.measureText(t).width; };
    const CP = { '€': 128, '‚': 130, '„': 132, '…': 133, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '–': 150, '—': 151 };
    const enc = t => Array.from(String(t)).map(ch => { const c = ch.charCodeAt(0); const v = CP[ch] || (c < 256 ? c : 63); const x = String.fromCharCode(v); return x === '(' || x === ')' || x === '\\' ? '\\' + x : (v < 32 ? ' ' : x); }).join('');
    const pages = []; let page, y;
    const newPage = () => { page = { ops: [] }; pages.push(page); y = H - M; };
    newPage();
    const text = (t, x, yy, sz, b, gray) => page.ops.push(`BT ${gray ? '0.4 g' : '0 g'} /${b ? 'F2' : 'F1'} ${sz} Tf ${x.toFixed(1)} ${yy.toFixed(1)} Td (${enc(t)}) Tj ET`);
    const wrap = (t, sz, b, w) => { const L = []; let cur = ''; String(t).split(/\s+/).filter(Boolean).forEach(wr => { const tt = cur ? cur + ' ' + wr : wr; if (!cur || wd(tt, sz, b) <= w) cur = tt; else { L.push(cur); cur = wr; } }); if (cur) L.push(cur); return L.length ? L : ['']; };
    const para = (t, o2 = {}) => {
      const sz = o2.sz || 11, b = !!o2.b, ind = o2.ind || 0, lh = sz * 1.35;
      wrap(t, sz, b, CW - ind).forEach((ln, k) => { if (y - lh < M) newPage(); y -= lh; if (k === 0 && o2.pre) text(o2.pre, M, y, sz, b, o2.gray); text(ln, M + ind, y, sz, b, o2.gray); });
      y -= (o2.gap == null ? 3 : o2.gap);
    };
    const imgs = []; let skipped = 0;
    const addPic = async (ref, maxH) => {
      const d = await new Promise(res => {
        const im = new Image(); im.crossOrigin = 'anonymous'; const to = setTimeout(() => res(null), 9000);
        im.onload = () => { clearTimeout(to); try { const sc = Math.min(1, 1200 / Math.max(im.naturalWidth, im.naturalHeight)); const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * sc); c.height = Math.round(im.naturalHeight * sc); const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height); const bin = atob(c.toDataURL('image/jpeg', 0.85).split(',')[1]); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); res({ w: c.width, h: c.height, u }); } catch { res(null); } };
        im.onerror = () => { clearTimeout(to); res(null); }; im.src = imgUrl(ref, 1200);
      });
      if (!d) { skipped++; return; }
      const idx = imgs.push(d) - 1, s2 = Math.min(CW / d.w, maxH / d.h), dw = d.w * s2, dh = d.h * s2;
      if (y - dh < M) newPage(); y -= dh;
      page.ops.push(`q ${dw.toFixed(1)} 0 0 ${dh.toFixed(1)} ${(M + (CW - dw) / 2).toFixed(1)} ${y.toFixed(1)} cm /Im${idx} Do Q`); y -= 10;
    };
    para(r.n, { sz: 20, b: true, gap: 4 });
    if (where) para(where, { sz: 10, gray: true, gap: 8 });
    if (withPics && r.cover) await addPic(r.cover, 280);
    if (ings.length) { y -= 6; para('Zutaten, für ' + p.n, { sz: 13, b: true, gap: 4 }); ings.forEach(x => para(x, { pre: '•', ind: 12, gap: 1.5 })); }
    if (r.steps.length) {
      y -= 10; if (!r.free) para('Zubereitung', { sz: 13, b: true, gap: 4 }); let k = 0;
      r.steps.forEach(t => { if (hd(t)) { k = 0; y -= 4; para(headText(t), { b: true, sz: 11.5, gap: 2 }); } else if (r.free) para(t, { gap: 4 }); else para(t, { pre: ++k + '.', ind: 16, gap: 3 }); });
    }
    if (withPics) { for (const ref of pics.filter(x => x !== r.cover)) await addPic(ref, 420); }
    const parts = [], off = []; let len = 0;
    const put = x => { const u = typeof x === 'string' ? Uint8Array.from(x, ch => ch.charCodeAt(0) & 255) : x; parts.push(u); len += u.length; };
    const obj = (n, body, data) => { off[n] = len; put(n + ' 0 obj\n' + body + (data ? '\nstream\n' : '\n')); if (data) { put(data); put('\nendstream\n'); } put('endobj\n'); };
    const base = 5 + imgs.length, np = pages.length;
    put('%PDF-1.4\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [' + pages.map((_, i) => (base + 2 * i + 1) + ' 0 R').join(' ') + '] /Count ' + np + ' >>');
    obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    imgs.forEach((d, i) => obj(5 + i, `<< /Type /XObject /Subtype /Image /Width ${d.w} /Height ${d.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${d.u.length} >>`, d.u));
    const res = `<< /Font << /F1 3 0 R /F2 4 0 R >>${imgs.length ? ' /XObject << ' + imgs.map((_, i) => `/Im${i} ${5 + i} 0 R`).join(' ') + ' >>' : ''} >>`;
    pages.forEach((pg, i) => {
      const c = pg.ops.join('\n'), cn = base + 2 * i;
      obj(cn, `<< /Length ${c.length} >>`, c);
      obj(cn + 1, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${cn} 0 R /Resources ${res} >>`);
    });
    const N = base + 2 * np, xr = len;
    put('xref\n0 ' + N + '\n0000000000 65535 f \n' + Array.from({ length: N - 1 }, (_, i) => String(off[i + 1]).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size ' + N + ' /Root 1 0 R >>\nstartxref\n' + xr + '\n%%EOF');
    return { blob: new Blob(parts, { type: 'application/pdf' }), skipped };
  };
  const o = document.createElement('div'); o.className = 'sheet-bg'; o.style.zIndex = '110';
  let fmt = 'pdf', ph = pics.length > 0;
  const draw = () => {
    o.innerHTML = `<div class="sheet" role="dialog" aria-label="Exportieren"><h3>Rezept exportieren</h3>
      <div class="xl">Format</div><div class="seg"><button type="button" data-fmt="pdf" aria-pressed="${fmt === 'pdf'}">PDF</button><button type="button" data-fmt="txt" aria-pressed="${fmt === 'txt'}">Text</button></div>
      <div class="xl">Fotos</div><div class="seg"><button type="button" data-ph="1" aria-pressed="${ph}" ${pics.length ? '' : 'disabled'}>mit Fotos</button><button type="button" data-ph="0" aria-pressed="${!ph}">ohne Fotos</button></div>
      <p class="note tiny">${fmt === 'pdf' ? 'Die PDF wird in der App erstellt. Danach öffnet sich das Teilen-Menü, dort wählst du zum Beispiel «In Dateien sichern».' : ph ? 'Text und Fotos werden über das Teilen-Menü weitergegeben, wenn das Gerät das erlaubt.' : 'Der Text wird geteilt, gespeichert oder kopiert.'}${ings.length ? ' Zutatenmengen für ' + p.n + ' Portionen.' : ''}</p>
      <p class="note tiny err" id="x-msg"></p>
      <div class="acts"><button type="button" class="chip" id="x-cancel">Abbrechen</button>${fmt === 'txt' ? '<button type="button" class="chip" id="x-copy">Kopieren</button>' : ''}<button type="button" class="chip on" id="x-go">Exportieren</button></div></div>`;
  };
  draw(); document.body.appendChild(o);
  const msg = t => { const m = $('#x-msg', o); if (m) m.textContent = t; };
  const fname = (slug(r.n) || 'rezept');
  o.addEventListener('click', async e => {
    if (e.target === o || e.target.id === 'x-cancel') { o.remove(); return; }
    const f = e.target.closest('[data-fmt]'); if (f) { fmt = f.dataset.fmt; draw(); return; }
    const q = e.target.closest('[data-ph]'); if (q) { ph = q.dataset.ph === '1'; draw(); return; }
    if (e.target.id === 'x-copy') { try { await navigator.clipboard.writeText(asText()); msg('Kopiert.'); } catch { msg('⚠ Kopieren nicht möglich.'); } return; }
    if (e.target.id !== 'x-go') return;
    if (fmt === 'pdf') {
      $('#x-go', o).disabled = true; msg('PDF wird erstellt …');
      try {
        const { blob, skipped } = await buildPdf(ph);
        const file = new File([blob], fname + '.pdf', { type: 'application/pdf' });
        if (skipped) msg(skipped + ' Foto(s) liessen sich nicht einbetten (blockiert vom Bildserver).');
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file], title: r.n }); if (!skipped) o.remove(); } catch (err) { if (!err || err.name !== 'AbortError') throw err; }
        } else {
          const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fname + '.pdf'; document.body.appendChild(a); a.click(); a.remove();
          if (!skipped) msg('PDF wurde gespeichert.');
        }
      } catch (err) { msg('⚠ PDF konnte nicht erstellt werden: ' + (err && err.message || err)); }
      const g = $('#x-go', o); if (g) g.disabled = false;
      return;
    }
    const text = asText();
    try {
      if (ph && pics.length && navigator.canShare) {
        msg('Fotos werden vorbereitet …');
        const files = [new File([text], fname + '.txt', { type: 'text/plain' })];
        for (let i = 0; i < pics.length; i++) { const b = await (await fetch(imgUrl(pics[i], 1400))).blob(); files.push(new File([b], fname + '-' + (i + 1) + '.jpg', { type: b.type || 'image/jpeg' })); }
        if (navigator.canShare({ files })) { await navigator.share({ files, title: r.n }); o.remove(); return; }
      }
    } catch (err) { if (err && err.name === 'AbortError') return; msg('Fotos liessen sich nicht mitgeben, es wird nur der Text exportiert.'); }
    try {
      if (navigator.share) { await navigator.share({ title: r.n, text }); o.remove(); return; }
    } catch (err) { if (err && err.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })); a.download = fname + '.txt'; document.body.appendChild(a); a.click(); a.remove(); msg('Als Textdatei gespeichert.');
  });
}

/* Rezeptfoto als Foto eines Ordners / Überordners festlegen */
function openPhotoSheet(r, ref) {
  ref = ref || r.cover;
  const ids = []; foldersOf(r).forEach(x => pathOf(x).forEach(f => { if (!ids.includes(f.id)) ids.push(f.id); }));
  const o = document.createElement('div');
  o.className = 'sheet-bg';
  const draw = () => {
    o.innerHTML = `<div class="sheet" role="dialog" aria-label="Ordnerfoto"><h3>Dieses Foto von «${esc(r.n)}» verwenden für</h3><p style="text-align:center"><img src="${esc(imgUrl(ref, 300))}" alt="" style="max-height:120px;max-width:100%;border-radius:8px"></p><div class="mvlist">${ids.map(id => {
      const f = FB[id], on = f.photo === r.id && (f.pimg || r.cover) === ref;
      return `<button type="button" class="mv" data-fp="${esc(id)}">${on ? '✓ ' : ''}${esc(f.icon)} ${esc(pathOf(id).map(x => x.name).join(' › '))}</button>`; }).join('')}</div>
      <p class="note tiny">Antippen setzt oder entfernt das Foto. Ohne Auswahl nimmt die App automatisch ein passendes Rezeptfoto. Sichtbar bei Einstellungen → Ordner-Kacheln → Fotos.</p>
      <div class="acts"><button type="button" class="chip on" id="fp-ok">Fertig</button></div></div>`;
  };
  draw(); document.body.appendChild(o);
  o.addEventListener('click', e => {
    if (e.target === o || e.target.id === 'fp-ok') { o.remove(); return; }
    const b = e.target.closest('[data-fp]'); if (!b) return;
    const f = FB[b.dataset.fp];
    if (f.photo === r.id && (f.pimg || r.cover) === ref) { delete f.photo; delete f.pimg; } else { f.photo = r.id; if (ref === r.cover) delete f.pimg; else f.pimg = ref; }
    persist(); renderFilters(); draw();
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
    <div class="fimgrow"><span class="fthumb" id="e-fthumb"></span><span class="fimgbtns"><button type="button" class="chip" id="e-fpick">📷 Eigenes Foto wählen</button><button type="button" class="chip ib2" id="e-frm" aria-label="Foto entfernen" title="Foto entfernen">−</button></span><input id="e-ffile" type="file" accept="image/*,.heic,.heif,image/heic,image/heif" hidden></div>
    <p class="note tiny">Ein Foto für diesen Ordner, auch wenn es in keinem Rezept vorkommt. Es erscheint auf der Kachel, wenn in den Einstellungen «Fotos» gewählt ist.</p>
    <p class="note tiny err" id="e-msg"></p>
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
  let img = m.img || '', newData = '';
  const drawThumb = () => { const t = $('#e-fthumb', o), u = newData || imgUrl(img, 160); t.innerHTML = u ? `<img src="${esc(u)}" alt="">` : '<span>🖼</span>'; $('#e-frm', o).hidden = !u; };
  drawThumb();
  let saving = false;
  const save = async () => {
    if (saving) return; saving = true;
    const msg = $('#e-msg', o);
    try {
      const f = {
        ...m, id: m.id, name: $('#e-label', o).value.trim() || (isNew ? 'Neuer Ordner' : m.name),
        icon: $('#e-icon', o).value.trim() || '📁', color, parent: $('#e-parent', o).value || null, show: $('#e-show', o).checked
      };
      const old = m.img || '';
      if (newData) {
        if (!getToken()) throw new Error('GitHub-Token fehlt (Einstellungen → Tokens)');
        msg.textContent = 'Foto wird gespeichert …';
        const path = `img/f/${m.id}-${Date.now().toString(36)}.jpg`;
        const x = await putFile(path, newData.split(',')[1], 'App: Ordnerfoto');
        if (!x.ok) throw new Error('Foto speichern fehlgeschlagen (' + x.status + ')');
        f.img = path;
      } else if (!img) delete f.img;
      if (isNew) cfg.folders.push(f); else cfg.folders[cfg.folders.findIndex(x => x.id === m.id)] = f;
      persist(); renderFilters(); done();
      if (old && old !== f.img) { try { await delFile(old); } catch {} }
    } catch (err) { saving = false; msg.textContent = '⚠ ' + err.message; }
  };
  o.addEventListener('change', async e => {
    if (e.target.id !== 'e-ffile' || !e.target.files.length) return;
    try { newData = await shrink(e.target.files[0], 800, 0.82); drawThumb(); $('#e-msg', o).textContent = ''; }
    catch (err) { $('#e-msg', o).textContent = '⚠ ' + (err.message || 'Foto nicht lesbar'); }
    e.target.value = '';
  });
  o.addEventListener('click', e => {
    if (e.target === o) return isNew ? o.remove() : save();
    const em = e.target.closest('[data-e]'); if (em) { $('#e-icon', o).value = em.dataset.e; upd(); return; }
    if (e.target.closest('.cpick')) return;
    const c = e.target.closest('[data-c]'); if (c) { color = c.dataset.c; $$('.swatches button', o).forEach(b => b.setAttribute('aria-pressed', b === c)); upd(); return; }
    if (e.target.id === 'e-fpick') { $('#e-ffile', o).click(); return; }
    if (e.target.id === 'e-frm') { img = ''; newData = ''; drawThumb(); return; }
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

function syncTopBtns() {
  const e = $('#hedit'), i = $('#import'); if (!e || !i) return;
  e.setAttribute('aria-pressed', state.edit); e.textContent = state.edit ? '✓' : '✏️'; e.title = e.ariaLabel = state.edit ? 'Fertig' : 'Ordner bearbeiten';
  i.hidden = !!state.edit;
}
function refresh() {
  syncTopBtns();
  const home = isHome() && !location.hash.startsWith('#/r/');
  filtersEl.style.display = '';
  renderFilters();
  home ? renderHome() : renderList();
}

/* ---------- Darstellung ---------- */
function applyTheme() {
  const t = state.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  $$('#settings [data-theme]').forEach(b => b.setAttribute('aria-pressed', b.dataset.theme === t));
}

function renderFilters() {
  const items = [['home', 'Home'], ['abc', 'ABC'], ['fav', 'Favoriten']];
  const onHome = isHome() && !location.hash.startsWith('#/r/');
  const act = onHome ? 'home' : state.filter;
  filtersEl.innerHTML = items.map(([k, l]) =>
    `<button class="chip" type="button" data-f="${esc(k)}" aria-pressed="${act === k}">${esc(l)}</button>`).join('');
}

const rviewBtn = () => `<button type="button" class="chip vbtn ${state.rview === 'list' ? 'sym' : 'lst'}" id="rview" aria-label="${state.rview === 'list' ? 'Als Symbole anzeigen' : 'Als Liste anzeigen'}">${state.rview === 'list' ? 'Symbole' : 'Liste'}</button>`;
const favBtn = r => `<button type="button" class="fstar" data-fstar="${esc(r.id)}" aria-pressed="${state.fav.has(r.id)}" aria-label="Favorit">${state.fav.has(r.id) ? '★' : '☆'}</button>`;
function renderList() {
  state.rview = store.get('rb_rview', 'grid');
  const t = tokens(state.q);
  const res = search(state.q);
  if (!state.q && state.filter === 'fav') { const ord = [...state.fav]; res.sort((a, b) => ord.indexOf(a.r.id) - ord.indexOf(b.r.id)); }
  state.nav = res.map(x => x.r.id);
  const inFolder = !state.q && FB[state.filter];
  if (!state.q && state.filter === 'abc' && !state.letter) { countEl.textContent = R.length; clearEl.hidden = true; view.innerHTML = letterBar(); return; }
  const abcHead = !state.q && state.filter === 'abc' ? letterBar() : '';
  const head = (inFolder || !res.length ? '' : `<div class="vrow">${rviewBtn()}</div>`) + (abcHead || (inFolder ? `<nav class="crumbs">${FB[state.filter] && !FB[state.filter].parent ? `<button type="button" class="chip libbtn" data-lib="${esc(state.filter)}" aria-label="Basiswissen" title="Basiswissen">📚</button>` : ''}${res.length ? rviewBtn() : ''}${state.edit ? '<button type="button" class="chip upbtn" data-up aria-label="Zurück">‹ Zurück</button>' : ''}<a href="#" data-crumb="">Start</a>${pathOf(state.filter).map((f, i, a) => ' › ' + (i < a.length - 1 ? `<a href="#" data-crumb="${esc(f.id)}">${esc(f.name)}</a>` : `<b>${esc(f.name)}</b>`)).join('')}</nav>${barHtml()}${tilesBlock(state.filter)}` : ''));
  countEl.textContent = res.length === R.length ? R.length : res.length + '/' + R.length;
  clearEl.hidden = !state.q;
  if (state.edit && inFolder) { view.innerHTML = `<section class="home editing">${head}</section>`; setSync(sync.msg, sync.kind); return; }
  if (!res.length && !state.q && inFolder && kids(state.filter).some(f => f.show)) { view.innerHTML = head; return; }
  if (!res.length) {
    view.innerHTML = head + `<div class="empty"><b>${state.q ? 'Nichts gefunden' : state.filter === 'fav' ? 'Noch keine Favoriten' : 'Hier ist noch nichts'}</b>${state.q ? 'Für „' + esc(state.q) + '“ gibt es keine Treffer.' : state.filter === 'fav' ? 'Tippe im Rezept auf den Stern, dann erscheint es hier.' : 'In diesem Ordner liegen noch keine Rezepte.'}
      ${state.q && R.some(r => !r.hasText) ? '<br><small>Rezepte, die nur als Foto vorliegen, lassen sich nur über den Titel finden.</small>' : ''}</div>`;
    return;
  }
  const hint = state.q && state.filter !== 'text'
    ? `<p class="hint">Suche in Titel, Zutaten und Zubereitung. Reine Foto-Rezepte werden nur über den Titel gefunden.</p>` : '';
  if (state.edit && !state.q && state.filter === 'fav') {
    view.innerHTML = `<p class="hint2 fhint">Am ⠿ ziehen = Reihenfolge ändern · ✏️ = Rezept bearbeiten · ✕ = aus Favoriten entfernen</p><div class="rlist" id="frlist">${res.map(({ r }) => `<div class="rrow frow" data-id="${esc(r.id)}"><span class="fh" aria-label="Verschieben">⠿</span><span class="rph">${r.cover ? `<img loading="lazy" decoding="async" src="${esc(imgUrl(r.cover, 160))}" alt="">` : ''}</span><span class="rt"><b>${esc(r.n)}</b></span><button type="button" class="chip fb" data-fedit="${esc(r.id)}" aria-label="Rezept bearbeiten">✏️</button><button type="button" class="chip fb" data-frm="${esc(r.id)}" aria-label="Aus Favoriten entfernen">✕</button></div>`).join('')}</div>`;
    return;
  }
  if (state.rview === 'list') {
    view.innerHTML = head + hint + '<div class="rlist">' + res.map(({ r }) => `<a class="rrow" href="#/r/${r.id}"><span class="rph">${r.cover ? `<img loading="lazy" decoding="async" src="${esc(imgUrl(r.cover, 160))}" alt="">` : ''}</span><span class="rt"><b>${highlight(r.n, t)}</b><small>${foldersOf(r).map(x => esc(folderName(x))).join(' · ')}${r.hasText ? '' : ' · Foto'}</small></span>${favBtn(r)}</a>`).join('') + '</div>';
    return;
  }
  view.innerHTML = head + hint + '<div class="grid">' + res.map(({ r, hit }) => {
    const sn = snippet(r, hit, t);
    return `<a class="card" href="#/r/${r.id}">
      <div class="ph">${r.cover ? `<img loading="lazy" decoding="async" src="${esc(imgUrl(r.cover, 480))}" alt="">` : ''}</div>
      <div class="body"><h3>${highlight(r.n, t)}</h3>
      ${sn ? `<div class="sn">${sn}</div>` : ''}
      <div class="tags">${foldersOf(r).map(x => `<span class="tag">${esc(folderName(x))}</span>`).join('')}${r.hasText ? '' : '<span class="tag photo">Foto</span>'}</div></div>${favBtn(r)}</a>`;
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
function portBaseHtml(r) {
  const p = portState(r.id);
  return `<input class="pn small" id="pbase" type="number" inputmode="numeric" min="1" max="99" value="${p.b}" aria-label="Rezept ist gedacht für">`;
}
function portBarHtml(r) {
  const p = portState(r.id);
  return `<div class="port" id="port"><span class="pl">Portionen</span>
    <button type="button" class="pbtn" data-act="dec" aria-label="Weniger">−</button>
    <input class="pn" id="pn" type="number" inputmode="numeric" min="1" max="99" value="${p.n}" aria-label="Portionen">
    <button type="button" class="pbtn" data-act="inc" aria-label="Mehr">+</button>
</div>
    <p class="note" id="pnote" ${p.n === p.b ? 'hidden' : ''}>Mengen in der Zubereitung werden nicht umgerechnet.</p>`;
}
function setPort(r, patch) {
  const old = portState(r.id);
  // «Rezept für» (b) ist nur eine Angabe zum Rezept: die angezeigten Mengen bleiben gleich (Faktor n/b bleibt)
  if (patch.b != null && patch.n == null) patch = { ...patch, n: old.n === old.b ? patch.b : Math.round(old.n / old.b * patch.b) };
  const p = { ...old, ...patch };
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
  const ing = r.ing.length ? `<section class="panel"><h3 class="zh">Zutaten, für ${portBaseHtml(r)}</h3>${portBarHtml(r)}<ul class="ing">${ingListHtml(r)}</ul></section>` : '';
  const steps = r.steps.length ? `<section class="panel"><h3>Zubereitung</h3><ol class="steps">${
    r.steps.map(s => isHeading(s) ? `<li class="h"><b>${esc(headText(s))}</b></li>` : `<li>${esc(s)}</li>`).join('')}</ol></section>` : '';
  const pagesTitle = r.hasText ? 'Fotos' : 'Rezeptseiten (Fotos)';
  const pages = r.pages.length ? `<section class="panel"><h3>${pagesTitle}</h3>${
    r.hasText ? '' : '<p class="note">Dieses Rezept liegt nur als Foto vor. Zum Vergrössern antippen.</p>'}
    <div class="${r.hasText ? 'gallery' : 'pages'}">${r.pages.map(p =>
      `<img loading="lazy" decoding="async" src="${esc(imgUrl(p, r.hasText ? 400 : 900))}" data-full="${esc(imgUrl(p, 1800))}" alt="${esc(r.n)}">`).join('')}</div></section>` : '';
  let host = '';
  if (r.src) { try { host = new URL(r.src).hostname.replace(/^(www|m)\./, ''); } catch {} }
  view.innerHTML = `
    <div class="backrow"><button class="back" type="button" id="back">‹ Zurück</button>${host ? `<a class="srcl" href="${esc(r.src)}" target="_blank" rel="noopener">Quelle: ${esc(host)}</a>` : ''}</div>
    ${r.cover ? `<div class="hero"><img src="${esc(imgUrl(r.cover, 1200))}" data-full="${esc(imgUrl(r.cover, 1800))}" alt="${esc(r.n)}"></div>` : ''}
    <div class="head"><h2>${esc(r.n)}</h2>
      <button class="star" type="button" id="star" aria-pressed="${state.fav.has(r.id)}" aria-label="Favorit">${state.fav.has(r.id) ? '★' : '☆'}</button></div>
    <div class="meta"><div class="mtop"><span class="fchips">${foldersOf(r).map(x => `<span class="tag fchip">${esc((FB[x] || {}).icon || '')} ${esc(folderName(x))}<button type="button" data-rmf="${esc(x)}" aria-label="Aus Ordner entfernen">×</button></span>`).join('')}</span><span class="dtools"><button type="button" class="chip dbtn" id="fmulti" aria-label="Ordner wählen" title="Ordner wählen">📁</button><button type="button" class="chip dbtn" id="rexp" aria-label="Exportieren" title="Exportieren">📤</button><button type="button" class="chip dbtn" id="rmgr" aria-label="Bearbeiten" title="Bearbeiten">✏️</button></span></div>${(r.tags || []).filter(t => !isFolderTag(t)).length ? `<div class="mtags">${r.tags.filter(t => !isFolderTag(t)).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}</div>
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
  const sr = $('#searchrow'); if (sr) sr.style.display = r ? 'none' : ''; filtersEl.style.display = r ? 'none' : '';
  if (r) { document.title = r.n + ' · Rezeptbuch'; pushRecent(r.id); renderDetail(r); }
  else {
    document.title = 'Rezeptbuch';
    refresh();
    requestAnimationFrame(() => window.scrollTo(0, state.scroll));
  }
}
window.addEventListener('hashchange', route);
/* Wischen im Rezept: zum vorherigen/nächsten Rezept der Liste */
let sw = null;
function neighbor(dir) {
  const cur = decodeURIComponent(location.hash.slice(4));
  let list = state.nav && state.nav.includes(cur) ? state.nav : null;
  if (!list) list = R.slice().sort((a, b) => a.n.localeCompare(b.n, 'de')).map(r => r.id);
  const i = list.indexOf(cur), nx = list[i + dir];
  if (i < 0 || !nx) return;
  location.replace('#/r/' + nx); window.scrollTo(0, 0);
}
document.addEventListener('touchstart', e => {
  sw = null;
  if (!/^#\/r\//.test(location.hash) || e.touches.length !== 1 || (e.target.closest && e.target.closest('input,textarea,select,.sheet-bg,.fullpage,#lightbox'))) return;
  const lb = $('#lightbox'); if (lb && !lb.hidden) return;
  sw = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
}, { passive: true });
document.addEventListener('touchend', e => {
  if (!sw) return;
  const t = e.changedTouches[0], dx = t.clientX - sw.x, dy = t.clientY - sw.y, dt = Date.now() - sw.t; sw = null;
  if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.8 || dt > 700) return;
  neighbor(dx < 0 ? 1 : -1);
}, { passive: true });
window.addEventListener('scroll', () => { if (!location.hash.startsWith('#/r/')) state.scroll = window.scrollY; }, { passive: true });

/* ---------- Ereignisse ---------- */
qEl.addEventListener('input', () => { state.q = qEl.value.trim(); refresh(); });
qEl.addEventListener('keydown', e => { if (e.key === 'Enter') qEl.blur(); if (e.key === 'Escape') { qEl.value = ''; state.q = ''; refresh(); } });
clearEl.addEventListener('click', () => { qEl.value = ''; state.q = ''; refresh(); qEl.focus(); });
$('#brand').addEventListener('click', () => { qEl.value = ''; state.q = ''; state.filter = 'alle'; state.browse = false; state.edit = false; state.scroll = 0; renderFilters(); if (location.hash) location.hash = ''; else route(); });
view.addEventListener('click', e => { const lib = e.target.closest('[data-lib]'); if (lib) { e.preventDefault(); openLib(lib.dataset.lib); return; } });
view.addEventListener('click', e => { const lb = e.target.closest('[data-letter]'); if (!lb) return; state.letter = lb.dataset.letter; refresh(); window.scrollTo(0, 0); });
filtersEl.addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  if (b.dataset.f === 'home') { qEl.value = ''; state.q = ''; state.filter = 'alle'; state.browse = false; state.edit = false; if (location.hash) { location.hash = ''; return; } }
  else { state.filter = b.dataset.f; state.letter = ''; state.browse = true; state.edit = false; }
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
  if (t.id === 'pbase') { clearTimeout(baseTimer); baseTimer = setTimeout(() => saveBase(r.id, v), 900); }
});
/* «Rezept für» gehört zum Rezept: mit Token wird es gespeichert und gilt auf allen Geräten, sonst nur lokal */
let baseTimer = 0;
async function saveBase(id, b) {
  const r = byId[id]; if (!r || !getToken() || (r.port || 4) === b) return;
  try {
    await modifyDoc(d => r.u
      ? { ...d, recipes: d.recipes.map(x => x.id === id ? { ...x, port: b } : x) }
      : { ...d, overrides: { ...d.overrides, [id]: { ...(d.overrides[id] || {}), port: b } } }, 'App: Rezept «' + r.n + '» – Personenzahl');
    const p = portState(id);
    if (p.n === p.b) localStorage.removeItem('rb_port_' + id); else store.set('rb_port_' + id, { n: p.n });
  } catch (e) { /* bleibt lokal gespeichert */ }
}
function setFolders(r, list) {
  list = [...new Set(list)];
  const bf = baseFolders(r);
  if (list.length === bf.length && list.every(x => bf.includes(x))) delete cfg.assign[r.id]; else cfg.assign[r.id] = list;
  persist(); renderFilters(); renderDetail(r);
}
/* Ordner eines Rezepts: Mehrfachauswahl */
function openFolderMulti(r) {
  const cur = foldersOf(r), p = document.createElement('div'); p.className = 'sheet-bg';
  p.innerHTML = `<div class="sheet imp" role="dialog" aria-label="Ordner wählen"><h3>📁 In welchen Ordnern liegt das Rezept?</h3>
    <p class="note tiny">Du kannst mehrere Ordner ankreuzen.</p>
    <div class="fpick">${flat().map(({ f, depth }) => `<label class="chk" style="padding-left:${depth * 18}px"><input type="checkbox" value="${esc(f.id)}"${cur.includes(f.id) ? ' checked' : ''}> ${esc(f.icon)} ${esc(f.name)}</label>`).join('')}</div>
    <p class="note tiny err" id="fm-msg"></p>
    <div class="acts"><button type="button" class="chip" id="fm-cancel">Abbrechen</button><button type="button" class="chip on" id="fm-ok">Speichern</button></div></div>`;
  document.body.appendChild(p);
  p.addEventListener('click', e => {
    if (e.target === p || e.target.closest('#fm-cancel')) { p.remove(); return; }
    if (!e.target.closest('#fm-ok')) return;
    const ids = [...p.querySelectorAll('.fpick input:checked')].map(x => x.value);
    if (!ids.length) { $('#fm-msg', p).textContent = 'Bitte mindestens einen Ordner wählen.'; return; }
    p.remove(); setFolders(r, [...cur.filter(x => ids.includes(x)), ...ids.filter(x => !cur.includes(x))]);
  });
}
view.addEventListener('click', e => {
  if (e.target.closest('#import')) { openImport(); return; }
  if (e.target.closest('#hedit')) { state.edit = !state.edit; refresh(); window.scrollTo(0, 0); return; }
  if (e.target.closest('#rview')) { store.set('rb_rview', (store.get('rb_rview', 'grid') === 'list') ? 'grid' : 'list'); refresh(); return; }
  if (e.target.closest('#hadd')) { openTileEditor(null, ($('#tiles') || {}).dataset ? $('#tiles').dataset.parent || null : null); return; }
  if (e.target.closest('[data-up]')) {
    const par = (FB[state.filter] || {}).parent;
    if (par && FB[par]) state.filter = par; else { state.filter = 'alle'; state.browse = false; }
    renderFilters(); refresh(); window.scrollTo(0, 0); return;
  }
  const crumb = e.target.closest('[data-crumb]');
  if (crumb) { e.preventDefault(); state.edit = false; if (crumb.dataset.crumb) state.filter = crumb.dataset.crumb; else { state.filter = 'alle'; state.browse = false; } renderFilters(); refresh(); window.scrollTo(0, 0); return; }
  const tile = e.target.closest('.tile');
  if (tile && state.edit) return;
  if (tile && tile.classList.contains('add')) return;
  if (tile) { state.filter = tile.dataset.folder; state.browse = true; renderFilters(); refresh(); window.scrollTo(0, 0); return; }
  if (e.target.closest('#random')) { openRandom(); return; }
  const back = e.target.closest('#back');
  if (back) { history.length > 1 ? history.back() : (location.hash = ''); return; }
  const fs = e.target.closest('[data-fstar]');
  if (fs) {
    e.preventDefault();
    const id = fs.dataset.fstar;
    state.fav.has(id) ? state.fav.delete(id) : state.fav.add(id);
    persist();
    fs.setAttribute('aria-pressed', state.fav.has(id)); fs.textContent = state.fav.has(id) ? '★' : '☆';
    renderFilters(); return;
  }
  const star = e.target.closest('#star');
  if (star) {
    const r = byId[decodeURIComponent(location.hash.slice(4))];
    state.fav.has(r.id) ? state.fav.delete(r.id) : state.fav.add(r.id);
    persist();
    star.setAttribute('aria-pressed', state.fav.has(r.id)); star.textContent = state.fav.has(r.id) ? '★' : '☆';
    renderFilters(); return;
  }
  if (e.target.closest('#rexp')) { const r = byId[decodeURIComponent(location.hash.slice(4))]; if (r) recipeExport(r); return; }
  if (e.target.closest('#rmgr')) { const r = byId[decodeURIComponent(location.hash.slice(4))]; if (r) openEditSheet(r); return; }
  if (e.target.closest('#fmulti')) { const r = byId[decodeURIComponent(location.hash.slice(4))]; if (r) openFolderMulti(r); return; }
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



/* ---------- Hilfe ---------- */
const HELP = [
  ['Die Startseite', 'Oben stehen <b>Home</b> (Ordnerkacheln), <b>ABC</b> (alle Rezepte nach Anfangsbuchstaben) und <b>Favoriten</b> (Rezepte mit Stern). Das Suchfeld durchsucht Titel, Zutaten und Zubereitung.', [['Zu Home', 'home'], ['ABC öffnen', 'abc'], ['Favoriten öffnen', 'fav']]],
  ['Ein Rezept ansehen', 'Rezept antippen. <b>Nach links oder rechts wischen</b> wechselt zum nächsten bzw. vorherigen Rezept der Liste. Mit dem <b>Stern</b> machst du es zum Favoriten. Bei <b>Portionen</b> rechnest du die Mengen um. Die Kästchen bei den Zutaten kannst du beim Einkaufen oder Kochen abhaken. Ein Tipp aufs Bild vergrössert es.', []],
  ['Rezept bearbeiten oder löschen', 'Im Rezept auf <b>✏️</b> tippen: Titel, Zutaten, Zubereitung und Bilder ändern, das Rezept auf den Originalzustand zurücksetzen oder löschen. Das gilt für alle Rezepte, auch die alten.', []],
  ['Ordner eines Rezepts ändern', 'Im Rezept zeigen die Chips oben die Ordner. Mit <b>×</b> nimmst du das Rezept aus einem Ordner, mit <b>📁</b> wählst du mehrere Ordner auf einmal an. Das Titelbild als Foto eines Ordners verwendest du im Bearbeiten-Fenster unter «Bild» mit <b>🖼️</b>.', []],
  ['Ordner verwalten', 'Auf der Startseite <b>✏️</b> antippen. Dann kannst du Ordner antippen (Name, Symbol, Farbe, Foto), per Ziehen sortieren, neue anlegen, unter «Liegt in» in einen anderen Ordner schieben und Das Raster für Home schaltest du in den Einstellungen ein (dort bekommst du passende Anordnungen vorgeschlagen). Grösse von Ordnern und Rezepten stellst du ebenfalls dort ein. Nochmals <b>✓</b> tippen beendet das Bearbeiten.', [['Bearbeiten starten', 'edit']]],
  ['Rezept importieren', 'Mit <b>➕</b> wählst du zuerst die Quelle: Foto, Scan oder PDF (Claude liest den Text), einen Link einfügen (z. B. von chefkoch.de) oder Rezepttext per Copy/Paste einfügen. Du siehst vor dem Speichern eine Vorschau und kannst alles korrigieren.', [['Import öffnen', 'import']]],
  ['Einstellungen', 'Das Zahnrad oben rechts öffnet die Einstellungen als ganze Seite (Schliessen mit ×): hell/dunkel, Grösse und Aussehen der Kacheln und Der Knopf <b>🔑 Tokens</b> führt zu den Eingabefeldern für GitHub-Token, Claude-Schlüssel und Link-Dienst.', [['Einstellungen öffnen', 'settings']]],
  ['Basiswissen (📚)', 'In jedem Hauptordner steht oben rechts ein <b>📚</b>. Dort sammelst du Wissen zu diesem Ordner: mit <b>＋ Seite</b> eine eigene Seite mit Foto und frei editierbarem Text (✏️ bearbeiten, 📤 exportieren), mit <b>＋ PDF einlesen</b> ein PDF (bis 20 MB), das Claude in eine solche Seite umwandelt. Dafür braucht es den Claude-Schlüssel. Mit <b>✕</b> entfernst du einen Eintrag. Dafür braucht es den GitHub-Token.'],
  ['Token, Schlüssel, Worker', '<b>GitHub-Token</b>: damit du Änderungen speichern darfst. <b>Claude-Schlüssel</b>: für den Foto-Import. <b>Worker-Adresse</b>: für den Link-Import. Ohne diese Angaben kannst du die App nur lesen.', [['Token eintragen', 'tok'], ['Import-Angaben', 'akey']]],
  ['Wenn etwas nicht stimmt', 'Die App ganz schliessen (auf dem iPhone im App-Wechsler nach oben wischen) und neu öffnen. Hilft das nicht, die App vom Home-Bildschirm löschen und neu hinzufügen. Neue Fotos erscheinen auf anderen Geräten erst nach 1–2 Minuten.', []]
];
function openHelp() {
  const o = document.createElement('div'); o.className = 'sheet-bg';
  o.innerHTML = `<div class="sheet imp help" role="dialog" aria-label="Hilfe"><h3>Hilfe</h3>
    ${HELP.map(([t, body, acts], i) => `<details${i === 0 ? ' open' : ''}><summary>${t}</summary><p>${body}</p>${acts.length ? `<div class="hacts">${acts.map(([l, a]) => `<button type="button" class="chip" data-act="${a}">${l} ›</button>`).join('')}</div>` : ''}</details>`).join('')}
    <div class="acts"><button type="button" class="chip on" id="h-close">Schliessen</button></div></div>`;
  document.body.appendChild(o);
  o.addEventListener('click', e => {
    if (e.target === o || e.target.closest('#h-close')) { o.remove(); return; }
    const b = e.target.closest('[data-act]'); if (!b) return;
    o.remove();
    const a = b.dataset.act;
    setTimeout(() => {
      if (['home', 'abc', 'fav'].includes(a)) { const f = $(`#filters [data-f=${a}]`); if (f) f.click(); }
      else if (a === 'edit') { if (state.edit !== true) $('#hedit').click(); }
      else if (a === 'import') openImport();
      else if (a === 'settings') openSet();
      else { openTok(); const el = $('#' + a); if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 2500); } }
    }, 50);
  });
}

/* ---------- Einstellungen ---------- */
const settingsEl = $('#settings'), tokensEl = $('#tokens');
const lockPage = () => { document.body.style.overflow = (settingsEl.hidden && tokensEl.hidden) ? '' : 'hidden'; };
const openSet = () => { settingsEl.hidden = false; lockPage(); };
const openTok = () => { settingsEl.hidden = false; tokensEl.hidden = false; lockPage(); };
$('#gear').addEventListener('click', e => { e.stopPropagation(); openSet(); });
const onSet = async e => {
  if (e.target.closest('#setclose')) { tokensEl.hidden = true; settingsEl.hidden = true; lockPage(); return; }
  if (e.target.closest('#tokclose')) { tokensEl.hidden = true; lockPage(); return; }
  if (e.target.closest('#opentok')) { tokensEl.hidden = false; lockPage(); return; }
  const sz = e.target.closest('#sizeseg [data-size]');
  const rz = e.target.closest('#rsizeseg [data-rsize]');
  if (rz) { cfg.rsize = rz.dataset.rsize; store.set('rb_rsize', cfg.rsize); applySize(); return; }
  const gb = e.target.closest('#gridseg [data-grid]');
  if (gb) { if (gb.dataset.grid === 'off') { delete cfg.layouts[gridKey(null)]; store.set('rb_layouts', cfg.layouts); refresh(); updGrid(); } else openGrid(null); return; }
  if (sz) { cfg.size = sz.dataset.size; store.set('rb_size', cfg.size); applySize(); return; }
  const ph = e.target.closest('#photoseg [data-photos]');
  if (ph) { cfg.photos = ph.dataset.photos === '1'; store.set('rb_photos', cfg.photos); applySize(); refresh(); return; }
  if (e.target.closest('#tokpaste')) {
    try { $('#tok').value = (await navigator.clipboard.readText()).trim(); setSync($('#tok').value ? 'Token eingefügt, jetzt «OK» tippen' : 'Zwischenablage ist leer', ''); }
    catch { setSync('Zugriff auf die Zwischenablage nicht erlaubt: ins Feld tippen und lange drücken → Einfügen', 'err'); }
    return;
  }
  const pb = e.target.closest('[data-paste]');
  if (pb) {
    const inp = $('#' + pb.dataset.paste);
    try { inp.value = (await navigator.clipboard.readText()).trim(); } catch { setSync('Zwischenablage nicht erlaubt: ins Feld tippen, lange drücken → Einfügen', 'err'); }
    return;
  }
  const sv = e.target.closest('[data-save]');
  if (sv) {
    const id = sv.dataset.save, key = id === 'akey' ? 'rb_akey' : 'rb_worker', v = $('#' + id).value.trim();
    if (v) localStorage.setItem(key, v); else localStorage.removeItem(key);
    $('#' + id).value = ''; updImp(); return;
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
};
settingsEl.addEventListener('click', onSet); tokensEl.addEventListener('click', onSet);
applyTheme();
function updImp() {
  const a = $('#akeystate'), w = $('#wurlstate');
  if (a) a.textContent = lsGet('rb_akey') ? 'Claude-Schlüssel ist auf diesem Gerät hinterlegt.' : 'Kein Claude-Schlüssel hinterlegt.';
  updHint();
  if (w) w.textContent = lsGet('rb_worker') ? 'Link-Dienst: ' + lsGet('rb_worker').replace(/^https?:\/\//, '') : 'Kein Link-Dienst hinterlegt.';
}
function updGrid() {
  const on = !!activeLayout(null), n = gridCount(null);
  $$('#gridseg [data-grid]').forEach(b => b.setAttribute('aria-pressed', (b.dataset.grid === 'on') === on));
  const el = $('#gridnote'); if (el) el.textContent = on ? 'Raster ist aktiv (' + n + ' Kacheln auf Home). «Ein» tippen für eine andere Anordnung.' : 'Aus. «Ein» tippen: die App schlägt passende Anordnungen für die ' + n + ' Kacheln auf Home vor.';
}
function updHint() { const el = $('#tokhint'); if (el) el.textContent = 'GitHub-Token ' + (getToken() ? '✓' : '✗') + ' · Claude-Schlüssel ' + (lsGet('rb_akey') ? '✓' : '✗') + ' · Link-Dienst ' + (lsGet('rb_worker') ? '✓' : '✗'); }
function updTok() { const el = $('#tokstate'); if (el) el.textContent = getToken() ? 'Token ist auf diesem Gerät hinterlegt.' : 'Kein Token hinterlegt.'; updHint(); }
updTok(); updImp(); applySize(); $('#tok').addEventListener('keydown', e => { if (e.key === 'Enter') $('#toksave').click(); }); $('#vertag').textContent = 'v' + APP_VERSION; $('#ver').textContent = 'Version ' + APP_VERSION + ' · ' + R.length + ' Rezepte'; setSync(getToken() ? '' : 'Nur lesen (kein Token eingetragen)', '');

/* ---------- Start ---------- */
renderFilters();
route();
loadRemote(); loadUserRecipes();
if (getToken() && sync.dirty) flush();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !sync.dirty) loadRemote(true); });
let reloaded = false;
if ('serviceWorker' in navigator && navigator.serviceWorker.controller) navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
})();
