(() => {
'use strict';

/* ---------- Hilfsfunktionen ---------- */
const $ = (s, el = document) => el.querySelector(s);
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
const folders = [...new Set(R.map(r => r.folder))];

/* ---------- Zustand ---------- */
const state = {
  q: '',
  filter: store.get('rb_filter', 'alle'),   // alle | fav | text | foto | <Ordnername>
  fav: new Set(store.get('rb_fav', [])),
  scroll: 0
};
if (state.filter !== 'alle' && !['fav','text','foto'].includes(state.filter) && !folders.includes(state.filter)) state.filter = 'alle';

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

function renderFilters() {
  const nFav = R.filter(r => state.fav.has(r.id)).length;
  const items = [
    ['alle', 'Alle', R.length],
    ['fav', '★ Favoriten', nFav],
    ['text', 'Mit Text', R.filter(r => r.hasText).length],
    ['foto', 'Nur Fotos', R.filter(r => !r.hasText).length]
  ];
  if (folders.length > 1) folders.forEach(f => items.push([f, f, R.filter(r => r.folder === f).length]));
  filtersEl.innerHTML = items.map(([k, l, n]) =>
    `<button class="chip" type="button" data-f="${esc(k)}" aria-pressed="${state.filter === k}">${esc(l)}<small>${n}</small></button>`).join('');
}

function renderList() {
  const t = tokens(state.q);
  const res = search(state.q);
  countEl.textContent = res.length === R.length ? R.length + ' Rezepte' : res.length + ' von ' + R.length;
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

function renderDetail(r) {
  const done = new Set(store.get('rb_done_' + r.id, []));
  const ing = r.ing.length ? `<section class="panel"><h3>Zutaten</h3><ul class="ing">${
    r.ing.map((l, i) => `<li data-i="${i}" class="${done.has(i) ? 'done' : ''}"><span class="box"></span><span>${esc(l)}</span></li>`).join('')}</ul></section>` : '';
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
  $('.searchbox').style.display = $('#filters').style.display = r ? 'none' : '';
  if (r) { document.title = r.n + ' · Rezeptbuch'; renderDetail(r); }
  else {
    document.title = 'Rezeptbuch';
    renderList();
    requestAnimationFrame(() => window.scrollTo(0, state.scroll));
  }
}
window.addEventListener('hashchange', route);
window.addEventListener('scroll', () => { if (!location.hash.startsWith('#/r/')) state.scroll = window.scrollY; }, { passive: true });

/* ---------- Ereignisse ---------- */
qEl.addEventListener('input', () => { state.q = qEl.value.trim(); renderList(); });
qEl.addEventListener('keydown', e => { if (e.key === 'Enter') qEl.blur(); if (e.key === 'Escape') { qEl.value = ''; state.q = ''; renderList(); } });
clearEl.addEventListener('click', () => { qEl.value = ''; state.q = ''; renderList(); qEl.focus(); });
$('#brand').addEventListener('click', () => { qEl.value = ''; state.q = ''; state.filter = 'alle'; state.scroll = 0; renderFilters(); location.hash = ''; route(); });
filtersEl.addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  state.filter = b.dataset.f; store.set('rb_filter', state.filter);
  renderFilters(); renderList(); window.scrollTo(0, 0);
});
document.addEventListener('keydown', e => {
  if (e.key === '/' && document.activeElement !== qEl && !location.hash.startsWith('#/r/')) { e.preventDefault(); qEl.focus(); qEl.select(); }
});

view.addEventListener('click', e => {
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

/* ---------- Start ---------- */
renderFilters();
route();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
