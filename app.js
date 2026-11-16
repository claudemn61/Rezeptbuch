(() => {
'use strict';
const APP_VERSION = '1.7.2';

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
function imgUrl(ref, w) {
  if (!ref) return '';
  if (ref.startsWith('G:')) return 'https://lh3.googleusercontent.com/' + ref.slice(2).split('?')[0] + '=w' + w;
  return ref;
}

const isHeading = t => t.length <= 24 && !/[.!?]/.test(t);

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
const BASE = window.REZEPTE.map(r => ({ ...r, id: slug(r.n) }));
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
    out.folders.push({ id: String(f.id), name: String(f.name || f.id), icon: f.icon || ICONS[f.id] || '📁', color: f.color || defColor(f.id), parent: f.parent || null, show: f.show !== false, ...(byId[f.photo] ? { photo: f.photo } : {}) });
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
const putFile = (path, b64, msg, sha) => fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
  method: 'PUT', headers: hdr(getToken(), true), body: JSON.stringify({ message: msg, content: b64, branch: 'main', ...(sha ? { sha } : {}) }) });
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
    im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('Bild «' + (file.name || '') + '» lässt sich nicht öffnen')); };
    im.src = u;
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
    tags: { type: 'array', items: { type: 'string' } },
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
- tags: höchstens 3 passende Schlagwörter (z. B. vegetarisch, Apéro).
- folder: bester Ordner aus dieser Liste, sonst leer: ${cfg.folders.map(f => f.name).join(', ')}.`;
async function askClaude(content) {
  const key = lsGet('rb_akey');
  if (!key) throw new Error('Kein Claude-API-Schlüssel hinterlegt (Einstellungen → Import)');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 4096, tools: [RECIPE_TOOL], tool_choice: { type: 'tool', name: 'rezept' }, messages: [{ role: 'user', content }] })
  });
  if (!r.ok) {
    let m = ''; try { m = (await r.json()).error.message; } catch {}
    throw new Error(r.status === 401 ? 'Claude-API-Schlüssel ungültig' : 'Claude-API: ' + r.status + (m ? ' – ' + m : ''));
  }
  const j = await r.json(); const t = (j.content || []).find(c => c.type === 'tool_use');
  if (!t) throw new Error('Claude hat kein Rezept geliefert');
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
    return { n: plain(r.name), ing, steps, tags: [], folder: '', notes: '' };
  }
  return null;
}
function pageText(html) {
  return plain(html.replace(/<(script|style|noscript|svg|header|footer|nav)[\s\S]*?<\/\1>/gi, ' ')).slice(0, 40000);
}

/* Dialog */
function openImport() {
  const o = document.createElement('div'); o.className = 'sheet-bg';
  document.body.appendChild(o);
  const sheet = inner => { o.innerHTML = `<div class="sheet imp" role="dialog" aria-label="Rezept importieren">${inner}</div>`; };
  const folderOpts = sel => flat().map(({ f, depth }) => `<option value="${esc(f.id)}"${f.id === sel ? ' selected' : ''}>${' '.repeat(depth)}${esc(f.icon)} ${esc(f.name)}</option>`).join('');
  let busyOn = false;
  const start = (msg = '') => {
    sheet(`<h3>Rezept importieren</h3>
      <button class="chip big" type="button" id="i-photo">📷 Foto oder Scan wählen</button>
      <input id="i-file" type="file" accept="image/*" multiple hidden>
      <p class="note tiny">Mehrere Bilder = mehrere Seiten desselben Rezepts, in der richtigen Reihenfolge.</p>
      <label>Oder Link zu einem Rezept<input id="i-url" type="url" inputmode="url" autocapitalize="off" placeholder="https://…"></label>
      <button class="chip on" type="button" id="i-go">🔗 Link importieren</button>
      <p class="note tiny err" id="i-msg">${esc(msg)}</p>
      <div class="acts"><button type="button" class="chip" id="i-cancel">Schliessen</button></div>`);
  };
  const busy = t => { busyOn = true; sheet(`<h3>Rezept importieren</h3><p class="note">⏳ ${esc(t)}</p>`); };
  const review = (rec, images, srcUrl) => {
    busyOn = false;
    const fid = (cfg.folders.find(f => f.name.toLowerCase() === String(rec.folder || '').toLowerCase()) || {}).id || (cfg.folders[0] || {}).id;
    sheet(`<h3>Prüfen und speichern</h3>
      ${rec.notes ? `<p class="note tiny warn">Hinweis: ${esc(rec.notes)}</p>` : ''}
      ${images.length ? `<div class="pics">${images.map((u, i) => `<div class="pic"><img src="${u}" alt="">
          <label class="chk"><input type="radio" name="r-cov" value="${i}"${i === 0 ? ' checked' : ''}> Titelbild</label>
          <label class="chk"><input type="checkbox" data-keep="${i}" checked> behalten</label></div>`).join('')}</div>
        <div class="acts" style="justify-content:flex-start"><button type="button" class="chip" id="r-only">Nur Titelbild behalten</button><button type="button" class="chip" id="r-none">Keine Bilder</button></div>
        <label class="chk"><input id="r-fp" type="checkbox"> Titelbild auch als Foto für den gewählten Ordner verwenden</label>` : ''}
      <label>Name<input id="r-n" type="text" value="${esc(rec.n || '')}"></label>
      <label>Ordner<select id="r-f">${folderOpts(fid)}</select></label>
      <label>Schlagwörter <small>(mit Komma getrennt)</small><input id="r-t" type="text" value="${esc((rec.tags || []).join(', '))}"></label>
      <label>Zutaten <small>(eine pro Zeile)</small><textarea id="r-i" rows="8">${esc((rec.ing || []).join('\n'))}</textarea></label>
      <label>Zubereitung <small>(ein Schritt pro Zeile; kurze Zeile ohne Punkt = Überschrift)</small><textarea id="r-s" rows="10">${esc((rec.steps || []).join('\n'))}</textarea></label>
      <p class="note tiny err" id="i-msg"></p>
      <div class="acts"><button type="button" class="chip" id="i-back">Zurück</button><button type="button" class="chip on" id="r-save">Speichern</button></div>`);
    $('#r-save', o).onclick = async () => {
      const lines = id => $(id, o).value.split('\n').map(x => x.trim()).filter(Boolean);
      const n = $('#r-n', o).value.trim();
      const msg = $('#i-msg', o);
      if (!n) { msg.textContent = 'Bitte einen Namen eingeben.'; return; }
      const btn = $('#r-save', o); btn.disabled = true; btn.textContent = 'Speichere …'; msg.textContent = '';
      let id = slug(n) || 'rezept'; if (byId[id]) id += '-' + Date.now().toString(36).slice(-4);
      const covI = Number((o.querySelector('input[name=r-cov]:checked') || { value: 0 }).value);
      const kept = images.map((u, i) => i).filter(i => o.querySelector(`[data-keep="${i}"]`).checked);
      const order = kept.includes(covI) ? [covI, ...kept.filter(i => i !== covI)] : kept;
      const files = order.map((i, n) => ({ path: `img/u/${id}-${n + 1}.jpg`, b64: images[i].split(',')[1] }));
      const out = {
        id, n, folder: $('#r-f', o).value, src: srcUrl || '',
        tags: $('#r-t', o).value.split(',').map(x => x.trim()).filter(Boolean),
        ing: lines('#r-i'), steps: lines('#r-s'),
        cover: files[0] ? files[0].path : '', pages: files.slice(1).map(f => f.path), added: new Date().toISOString().slice(0, 10)
      };
      try {
        await saveUserRecipe(out, files);
        if (files.length && $('#r-fp', o) && $('#r-fp', o).checked && FB[out.folder]) { FB[out.folder].photo = id; persist(); renderFilters(); }
        o.remove(); location.hash = '#/r/' + id;
      }
      catch (e) { btn.disabled = false; btn.textContent = 'Speichern'; msg.textContent = '⚠ ' + e.message; }
    };
    $('#i-back', o).onclick = () => start();
    const syncPics = () => {
      const c = Number((o.querySelector('input[name=r-cov]:checked') || { value: 0 }).value);
      o.querySelectorAll('[data-keep]').forEach(k => { if (Number(k.dataset.keep) === c) { k.checked = true; k.disabled = true; } else k.disabled = false; });
    };
    o.querySelectorAll('input[name=r-cov]').forEach(x => x.addEventListener('change', syncPics));
    if ($('#r-only', o)) $('#r-only', o).onclick = () => { o.querySelectorAll('[data-keep]').forEach(k => { k.checked = k.disabled; }); };
    if ($('#r-none', o)) $('#r-none', o).onclick = () => { o.querySelectorAll('[data-keep]').forEach(k => { k.disabled = false; k.checked = false; }); o.querySelectorAll('input[name=r-cov]').forEach(x => { x.disabled = true; }); };
    if (images.length) syncPics();
  };
  const fromPhotos = async files => {
    try {
      busy('Bilder werden vorbereitet …');
      const images = []; for (const f of files) images.push(await shrink(f, 1600, 0.82));
      busy('Claude liest das Rezept …');
      const content = [...images.map(u => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: u.split(',')[1] } })), { type: 'text', text: recipePrompt() }];
      review(await askClaude(content), images, '');
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
      review(rec, [], url);
    } catch (e) { start('⚠ ' + e.message); }
  };
  o.addEventListener('click', e => {
    if (e.target === o) { if (!busyOn) o.remove(); return; }
    if (e.target.closest('#i-cancel')) { o.remove(); return; }
    if (e.target.closest('#i-photo')) { $('#i-file', o).click(); return; }
    if (e.target.closest('#i-go')) {
      const u = $('#i-url', o).value.trim();
      if (!/^https?:\/\//i.test(u)) { $('#i-msg', o).textContent = 'Bitte einen Link mit https:// eingeben.'; return; }
      fromLink(u);
    }
  });
  o.addEventListener('change', e => { if (e.target.id === 'i-file' && e.target.files.length) fromPhotos([...e.target.files]); });
  start();
}

/* Alle Rezepte: bearbeiten, Bilder nachladen/entfernen, löschen */
async function delFile(path) {
  if (!/^img\/u\//.test(path)) return;
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
  const orig = [r.cover, ...(r.pages || [])].filter(Boolean);
  let items = orig.map(p => ({ path: p, src: imgUrl(p, 300) })), cov = 0, busyOn = false;
  const hasOv = !!DOC.overrides[r.id];
  const draw = (msg = '') => {
    o.innerHTML = `<div class="sheet imp" role="dialog" aria-label="Rezept bearbeiten"><h3>Rezept bearbeiten</h3>
      <label>Name<input id="e-n" type="text" value="${esc(r.n)}"></label>
      <label>Schlagwörter <small>(mit Komma getrennt)</small><input id="e-t" type="text" value="${esc((r.tags || []).join(', '))}"></label>
      <label>Zutaten <small>(eine pro Zeile)</small><textarea id="e-i" rows="8">${esc(r.ing.join('\n'))}</textarea></label>
      <label>Zubereitung <small>(ein Schritt pro Zeile; kurze Zeile ohne Punkt = Überschrift)</small><textarea id="e-s" rows="10">${esc(r.steps.join('\n'))}</textarea></label>
      <label>Bilder</label>
      <div class="pics">${items.map((it, i) => `<div class="pic"><img src="${esc(it.src)}" alt="">
        <label class="chk"><input type="radio" name="p-cov" value="${i}"${i === cov ? ' checked' : ''}> Titelbild</label>
        <button type="button" class="chip" data-del="${i}">Entfernen</button></div>`).join('') || '<p class="note tiny">Keine Bilder.</p>'}</div>
      <button class="chip big" type="button" id="p-add">＋ Bilder hinzufügen</button>
      <input id="p-file" type="file" accept="image/*" multiple hidden>
      <p class="note tiny err" id="p-msg">${esc(msg)}</p>
      <div class="acts"><button type="button" class="chip danger" id="p-delrec">Rezept löschen</button>${hasOv ? '<button type="button" class="chip" id="p-reset">Original</button>' : ''}<button type="button" class="chip" id="p-cancel">Abbrechen</button><button type="button" class="chip on" id="p-save">Speichern</button></div></div>`;
  };
  // Eingaben beim Neuzeichnen (Bild hinzufügen/entfernen) behalten
  const keepText = () => { const g = id => { const e = $(id, o); return e ? e.value : null; }; r = { ...r, n: g('#e-n') ?? r.n, tags: (g('#e-t') ?? (r.tags || []).join(',')).split(',').map(x => x.trim()).filter(Boolean), ing: (g('#e-i') ?? r.ing.join('\n')).split('\n').map(x => x.trim()).filter(Boolean), steps: (g('#e-s') ?? r.steps.join('\n')).split('\n').map(x => x.trim()).filter(Boolean) }; };
  const lock = on => { busyOn = on; o.querySelectorAll('button').forEach(b => { b.disabled = on; }); };
  const cleanup = () => {
    let ch = false;
    cfg.folders.forEach(f => { if (f.photo === r.id) { delete f.photo; ch = true; } });
    if (cfg.assign[r.id]) { delete cfg.assign[r.id]; ch = true; }
    if (state.fav.has(r.id)) { state.fav.delete(r.id); ch = true; }
    if (ch) persist();
  };
  draw();
  o.addEventListener('change', async e => {
    if (e.target.name === 'p-cov') { cov = Number(e.target.value); return; }
    if (e.target.id === 'p-file' && e.target.files.length) {
      try { keepText(); for (const f of [...e.target.files]) { const d = await shrink(f, 1600, 0.82); items.push({ dataUrl: d, src: d }); } draw(); }
      catch (err) { draw('⚠ ' + err.message); }
    }
  });
  o.addEventListener('click', async e => {
    if (e.target === o) { if (!busyOn) o.remove(); return; }
    if (e.target.id === 'p-cancel') { o.remove(); return; }
    if (e.target.id === 'p-add') { $('#p-file', o).click(); return; }
    const del = e.target.closest('[data-del]');
    if (del) { keepText(); const i = Number(del.dataset.del); items.splice(i, 1); if (cov === i) cov = 0; else if (cov > i) cov--; draw(); return; }
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
        const nv = { n: r.n.trim(), tags: r.tags, ing: r.ing, steps: r.steps, cover: ordered[0] ? ordered[0].path : '', pages: ordered.slice(1).map(p => p.path) };
        await modifyDoc(d => r.u
          ? { ...d, recipes: d.recipes.map(x => x.id === r.id ? { ...x, ...nv } : x) }
          : { ...d, overrides: { ...d.overrides, [r.id]: nv } }, 'App: Rezept «' + nv.n + '» geändert');
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
  const pr = byId[(FB[id] || {}).photo];
  if (pr && pr.cover) return imgUrl(pr.cover, 240);
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
  const allTile = parent ? '' : `<button class="tile all fixed${cfg.photos ? ' hasphoto' : ''}" type="button" data-folder="alle" style="--c:#46604b">${cfg.photos ? `<span class="ic photo" style="background-image:url('${ALLE_FOTO}')"></span>` : '<span class="ic">📖</span>'}<b>Alle Rezepte</b><small>${R.length}</small></button>`;
  if (!list.length && !state.edit && parent) return '';
  return `<div class="tiles" id="tiles" data-parent="${esc(parent || '')}">${allTile}${list.map(tileHtml).join('')}${state.edit ? `<button class="tile add fixed" type="button" id="hadd"><span class="ic">＋</span><b>Neuer Ordner</b></button>` : ''}</div>`;
}
function barHtml() {
  return `<div class="hbar">${state.edit ? (sel ? '<span class="hint2">Ordner antippen zum Auswählen</span>' : '<span class="hint2">Ziehen = sortieren · antippen = bearbeiten</span>') : '<span></span>'}
    ${state.edit && !sel ? '<button class="chip" type="button" id="hsel">☑ Mehrere wählen</button>' : ''}
    </div>
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

($('#top') || document).addEventListener('click', e => {
  if (e.target.closest('#import')) { openImport(); return; }
  if (e.target.closest('#hedit')) { state.edit = !state.edit; sel = null; refresh(); window.scrollTo(0, 0); }
});

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

/* Rezeptfoto als Foto eines Ordners / Überordners festlegen */
function openPhotoSheet(r) {
  const ids = []; foldersOf(r).forEach(x => pathOf(x).forEach(f => { if (!ids.includes(f.id)) ids.push(f.id); }));
  const o = document.createElement('div');
  o.className = 'sheet-bg';
  const draw = () => {
    o.innerHTML = `<div class="sheet" role="dialog" aria-label="Ordnerfoto"><h3>Foto von «${esc(r.n)}» verwenden für</h3><div class="mvlist">${ids.map(id => {
      const f = FB[id], on = f.photo === r.id;
      return `<button type="button" class="mv" data-fp="${esc(id)}">${on ? '✓ ' : ''}${esc(f.icon)} ${esc(pathOf(id).map(x => x.name).join(' › '))}</button>`; }).join('')}</div>
      <p class="note tiny">Antippen setzt oder entfernt das Foto. Ohne Auswahl nimmt die App automatisch ein passendes Rezeptfoto. Sichtbar bei Einstellungen → Ordner-Kacheln → Fotos.</p>
      <div class="acts"><button type="button" class="chip on" id="fp-ok">Fertig</button></div></div>`;
  };
  draw(); document.body.appendChild(o);
  o.addEventListener('click', e => {
    if (e.target === o || e.target.id === 'fp-ok') { o.remove(); return; }
    const b = e.target.closest('[data-fp]'); if (!b) return;
    const f = FB[b.dataset.fp];
    if (f.photo === r.id) delete f.photo; else f.photo = r.id;
    persist(); renderFilters(); draw();
  });
}

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

function syncTopBtns() {
  const e = $('#hedit'), i = $('#import'); if (!e || !i) return;
  e.setAttribute('aria-pressed', state.edit); e.textContent = state.edit ? '✓' : '✏️'; e.title = e.ariaLabel = state.edit ? 'Fertig' : 'Ordner bearbeiten';
  i.hidden = !!state.edit;
}
function refresh() {
  syncTopBtns();
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
  const head = inFolder ? `<nav class="crumbs">${state.edit ? '<button type="button" class="chip upbtn" data-up aria-label="Zurück">‹ Zurück</button>' : ''}<a href="#" data-crumb="">Start</a>${pathOf(state.filter).map((f, i, a) => ' › ' + (i < a.length - 1 ? `<a href="#" data-crumb="${esc(f.id)}">${esc(f.name)}</a>` : `<b>${esc(f.name)}</b>`)).join('')}</nav>${barHtml()}${tilesBlock(state.filter)}` : '';
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
    <div class="meta">${foldersOf(r).map(x => `<span class="tag fchip">${esc((FB[x] || {}).icon || '')} ${esc(folderName(x))}<button type="button" data-rmf="${esc(x)}" aria-label="Aus Ordner entfernen">×</button></span>`).join('')}<label class="fsel"><select id="fadd"><option value="">＋ Ordner</option>${flat().filter(({ f }) => !foldersOf(r).includes(f.id)).map(({ f, depth }) => `<option value="${esc(f.id)}">${'\u2003'.repeat(depth)}${esc(f.icon)} ${esc(f.name)}</option>`).join('')}</select></label>${r.cover ? '<button type="button" class="chip" id="fphoto">🖼 Als Ordnerfoto …</button>' : ''}<button type="button" class="chip" id="rmgr">✎ Bearbeiten</button>${(r.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}${host ? `<a href="${esc(r.src)}" target="_blank" rel="noopener">Quelle: ${esc(host)}</a>` : ''}</div>
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
  if (e.target.closest('#import')) { openImport(); return; }
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
  if (e.target.closest('[data-up]')) {
    const par = (FB[state.filter] || {}).parent;
    if (par && FB[par]) state.filter = par; else { state.filter = 'alle'; state.browse = false; }
    sel = null; renderFilters(); refresh(); window.scrollTo(0, 0); return;
  }
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
  if (e.target.closest('#rmgr')) { const r = byId[decodeURIComponent(location.hash.slice(4))]; if (r) openEditSheet(r); return; }
  if (e.target.closest('#fphoto')) { const r = byId[decodeURIComponent(location.hash.slice(4))]; if (r) openPhotoSheet(r); return; }
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
function updImp() {
  const a = $('#akeystate'), w = $('#wurlstate');
  if (a) a.textContent = lsGet('rb_akey') ? 'Claude-Schlüssel ist auf diesem Gerät hinterlegt.' : 'Kein Claude-Schlüssel hinterlegt.';
  if (w) w.textContent = lsGet('rb_worker') ? 'Link-Dienst: ' + lsGet('rb_worker').replace(/^https?:\/\//, '') : 'Kein Link-Dienst hinterlegt.';
}
function updTok() { const el = $('#tokstate'); if (el) el.textContent = getToken() ? 'Token ist auf diesem Gerät hinterlegt.' : 'Kein Token hinterlegt.'; }
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
