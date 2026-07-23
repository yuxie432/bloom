/* =========================================================================
 * app.js — Pour-Over Journal (local-first PWA)
 * ========================================================================= */
import { getAll, get, put, remove, uid, exportAll, importAll } from './db.js';

/* ---------- Reference data ---------- */

// Pour-over techniques. Add your own by picking "Custom…".
const POUR_TEMPLATES = [
  'Single continuous pour',
  'Bloom + single pour',
  'Bloom + 2 pours',
  'Bloom + 3 pours (pulse)',
  'Pulse — 4 to 6 pours',
  'Hoffmann / Tetsu 4:6',
  'Rao spin',
  'Center pour (no agitation)',
  'Spiral / concentric pour',
  'High-agitation (aggressive)',
  'Low-and-slow gooseneck',
  'Immersion + drawdown (Clever/Switch)',
];

const ROAST_LEVELS = ['Light', 'Medium-light', 'Medium', 'Medium-dark', 'Dark'];

const PROCESS_METHODS = [
  'Washed', 'Natural', 'Honey', 'Anaerobic natural', 'Anaerobic washed',
  'Carbonic maceration', 'Wet-hulled', 'Yeast / co-ferment', 'Other',
];

// Tasting axes shown as 0–5 sliders, each with a coaching hint.
const TASTE_AXES = [
  ['aroma',      'Aroma',      'Floral, fruity, nutty, chocolatey, spicy — what hits your nose?'],
  ['acidity',    'Acidity',    'Brightness/liveliness. Citrusy & crisp vs. flat. 0 = none, 5 = vibrant'],
  ['sweetness',  'Sweetness',  'Sugar-like roundness — caramel, honey, ripe fruit'],
  ['body',       'Body',       'Weight/texture in the mouth. Tea-like & light vs. syrupy & heavy'],
  ['bitterness', 'Bitterness', 'Often over-extraction. 0 = none, 5 = harsh (usually you want it low)'],
  ['aftertaste', 'Aftertaste', 'The finish — how long & pleasant the flavour lingers'],
];

/* ---------- App state ---------- */
let beans = [];
let brews = [];
let editing = { store: null, record: null }; // currently open form

/* ---------- Small helpers ---------- */
const $  = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const todayISO = () => new Date().toISOString().slice(0, 10);
const num = (v) => (v === '' || v == null || isNaN(+v) ? null : +v);

function starStr(r) {
  if (!r) return '<span style="color:var(--muted)">unrated</span>';
  const full = '★'.repeat(Math.round(r));
  const empty = '☆'.repeat(5 - Math.round(r));
  return `<span class="stars">${full}${empty}</span>`;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2200);
}

function beanLabel(b) {
  if (!b) return 'Unknown bean';
  const bits = [b.originCountry, b.originRegion].filter(Boolean).join(' · ');
  const name = bits || b.varietal || 'Bean';
  return b.roaster ? `${name} — ${b.roaster}` : name;
}

/* ---------- Derived: average rating per bean ---------- */
function beanAvgRating(beanId) {
  const rated = brews.filter((x) => x.beanId === beanId && x.rating);
  if (!rated.length) return null;
  return rated.reduce((s, x) => s + x.rating, 0) / rated.length;
}
function beanBrewCount(beanId) {
  return brews.filter((x) => x.beanId === beanId).length;
}

/* =========================================================================
 * RENDERING
 * ========================================================================= */

function renderBrews() {
  const el = $('#brewList');
  if (!brews.length) {
    el.innerHTML = emptyState('No brews yet', 'Tap “+ New brew” after your next cup.');
    return;
  }
  const sorted = [...brews].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  el.innerHTML = sorted.map((x) => {
    const bean = beans.find((b) => b.id === x.beanId);
    const ratio = x.dose && x.waterMass ? `1:${(x.waterMass / x.dose).toFixed(1)}` : null;
    const meta = [
      x.dose ? `${x.dose} g` : null,
      x.waterMass ? `${x.waterMass} g water` : null,
      ratio,
      x.waterTemp ? `${x.waterTemp}°C` : null,
      x.pourTemplate || null,
    ].filter(Boolean);
    return `
      <div class="card" data-edit="brews" data-id="${x.id}">
        <div class="row1">
          <div>
            <div class="title">${esc(beanLabel(bean))}</div>
            <div class="sub">${esc(x.date || '')}${x.grindSetting ? ' · grind ' + esc(x.grindSetting) : ''}</div>
          </div>
          ${starStr(x.rating)}
        </div>
        <div class="meta">${meta.map((m) => `<span class="pill">${esc(m)}</span>`).join('')}</div>
        ${x.flavorNotes ? `<div class="sub" style="margin-top:8px">“${esc(x.flavorNotes)}”</div>` : ''}
      </div>`;
  }).join('');
}

function renderBeans() {
  const el = $('#beanList');
  if (!beans.length) {
    el.innerHTML = emptyState('No beans yet', 'Add a bag of beans, then log brews against it.');
    return;
  }
  const sorted = [...beans].sort((a, b) => (b.purchaseDate || '').localeCompare(a.purchaseDate || ''));
  el.innerHTML = sorted.map((b) => {
    const avg = beanAvgRating(b.id);
    const n = beanBrewCount(b.id);
    const meta = [
      b.roastLevel, b.process, b.varietal,
      b.producer, b.mass ? `${b.mass} g` : null,
    ].filter(Boolean);
    return `
      <div class="card" data-edit="beans" data-id="${b.id}">
        <div class="row1">
          <div>
            <div class="title">${esc(beanLabel(b))}</div>
            <div class="sub">${n} brew${n === 1 ? '' : 's'}${avg ? ` · avg ${avg.toFixed(1)}` : ''}</div>
          </div>
          ${starStr(avg)}
        </div>
        <div class="meta">${meta.map((m) => `<span class="pill">${esc(m)}</span>`).join('')}</div>
      </div>`;
  }).join('');
}

function emptyState(t, s) {
  return `<div class="empty"><p style="font-size:34px">☕</p><p><strong>${esc(t)}</strong></p><p>${esc(s)}</p></div>`;
}

/* ---------- Stats ---------- */
function renderStats() {
  const el = $('#statsBody');
  if (!brews.length) {
    el.innerHTML = emptyState('No statistics yet', 'Log a few brews and insights will appear here.');
    return;
  }
  const now = new Date();
  const ym = now.toISOString().slice(0, 7);
  const cupsThisMonth = brews.filter((x) => (x.date || '').startsWith(ym)).length;
  const rated = brews.filter((x) => x.rating);
  const avgAll = rated.length ? (rated.reduce((s, x) => s + x.rating, 0) / rated.length) : null;

  // cups per month, last 6
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d.toISOString().slice(0, 7));
  }
  const perMonth = months.map((m) => ({
    label: monthLabel(m),
    value: brews.filter((x) => (x.date || '').startsWith(m)).length,
  }));

  const roasterCounts = countBy(brews.map((x) => {
    const b = beans.find((z) => z.id === x.beanId);
    return b && b.roaster ? b.roaster : null;
  }));
  const processCounts = countBy(brews.map((x) => {
    const b = beans.find((z) => z.id === x.beanId);
    return b && b.process ? b.process : null;
  }));

  // favourite process by AVERAGE rating (min 2 cups)
  const processRatings = avgBy(brews, (x) => {
    const b = beans.find((z) => z.id === x.beanId);
    return b && b.process ? b.process : null;
  });
  const favProcess = topEntry(processRatings.filter((p) => p.n >= 2).length
    ? processRatings.filter((p) => p.n >= 2) : processRatings, 'avg');

  const topRoaster = topEntry(roasterCounts, 'value');

  // top beans by avg rating (min 1 rated brew)
  const beanScores = beans
    .map((b) => ({ label: beanLabel(b), avg: beanAvgRating(b.id), n: beanBrewCount(b.id) }))
    .filter((b) => b.avg != null)
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 5);

  el.innerHTML = `
    <div class="stat-cards">
      <div class="stat"><div class="num">${brews.length}</div><div class="lbl">total brews</div></div>
      <div class="stat"><div class="num">${cupsThisMonth}</div><div class="lbl">cups this month</div></div>
      <div class="stat"><div class="num">${avgAll ? avgAll.toFixed(1) : '—'}</div><div class="lbl">avg rating</div></div>
      <div class="stat"><div class="num">${beans.length}</div><div class="lbl">beans logged</div></div>
    </div>

    ${topRoaster ? `<div class="stat-cards">
      <div class="stat"><div class="num" style="font-size:18px">${esc(topRoaster.label)}</div><div class="lbl">most-brewed roaster (${topRoaster.value}×)</div></div>
      <div class="stat"><div class="num" style="font-size:18px">${favProcess ? esc(favProcess.label) : '—'}</div><div class="lbl">top process by rating${favProcess ? ` (${favProcess.avg.toFixed(1)})` : ''}</div></div>
    </div>` : ''}

    ${barBlock('Cups per month', perMonth)}
    ${roasterCounts.length ? barBlock('Brews by roaster', roasterCounts.sort((a, b) => b.value - a.value).slice(0, 6)) : ''}
    ${processCounts.length ? barBlock('Brews by process', processCounts.sort((a, b) => b.value - a.value)) : ''}
    ${beanScores.length ? barBlock('Top beans (avg rating)', beanScores.map((b) => ({ label: b.label, value: +b.avg.toFixed(1) })), 5) : ''}
  `;
}

function barBlock(title, rows, max) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.value));
  const body = rows.map((r) => `
    <div class="bar-row">
      <div class="bl" title="${esc(r.label)}">${esc(r.label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.round((r.value / m) * 100)}%"></div></div>
      <div class="bv">${r.value}</div>
    </div>`).join('');
  return `<div class="chart-block"><h4>${esc(title)}</h4>${body}</div>`;
}

function countBy(arr) {
  const m = new Map();
  arr.filter(Boolean).forEach((k) => m.set(k, (m.get(k) || 0) + 1));
  return [...m.entries()].map(([label, value]) => ({ label, value }));
}
function avgBy(items, keyFn) {
  const m = new Map();
  items.forEach((x) => {
    const k = keyFn(x);
    if (!k || !x.rating) return;
    if (!m.has(k)) m.set(k, { sum: 0, n: 0 });
    const o = m.get(k); o.sum += x.rating; o.n += 1;
  });
  return [...m.entries()].map(([label, o]) => ({ label, avg: o.sum / o.n, n: o.n }));
}
function topEntry(rows, field) {
  if (!rows.length) return null;
  return [...rows].sort((a, b) => b[field] - a[field])[0];
}
function monthLabel(ym) {
  const [y, m] = ym.split('-');
  return new Date(+y, +m - 1, 1).toLocaleString('en', { month: 'short' });
}

/* =========================================================================
 * FORMS
 * ========================================================================= */

function openModal(title) {
  $('#modalTitle').textContent = title;
  $('#modal').hidden = false;
}
function closeModal() {
  $('#modal').hidden = true;
  $('#modalForm').innerHTML = '';
  $('#modalForm').onsubmit = null;
  $('#deleteBtn').hidden = true;
  $('.modal-foot .primary').style.display = ''; // menu mode hides it; always restore
  editing = { store: null, record: null };
}

function field(label, inner, hint) {
  return `<div><label>${esc(label)}</label>${inner}${hint ? `<div class="field-hint">${esc(hint)}</div>` : ''}</div>`;
}
function textInput(name, val = '', ph = '', type = 'text') {
  return `<input name="${name}" type="${type}" value="${esc(val)}" placeholder="${esc(ph)}" />`;
}
function selectInput(name, opts, val = '') {
  const o = ['<option value="">—</option>']
    .concat(opts.map((x) => `<option value="${esc(x)}"${x === val ? ' selected' : ''}>${esc(x)}</option>`));
  return `<select name="${name}">${o.join('')}</select>`;
}

/* ---- Bean form ---- */
function beanForm(rec = {}) {
  editing = { store: 'beans', record: rec };
  const f = $('#modalForm');
  f.innerHTML = `
    <div class="grid2">
      ${field('Roaster', textInput('roaster', rec.roaster, 'e.g. Onyx'))}
      ${field('Origin country', textInput('originCountry', rec.originCountry, 'e.g. Ethiopia'))}
    </div>
    <div class="grid2">
      ${field('Region / area', textInput('originRegion', rec.originRegion, 'e.g. Guji'))}
      ${field('Producer / farm', textInput('producer', rec.producer, 'e.g. Tabe Burka'))}
    </div>
    <div class="grid2">
      ${field('Roast level', selectInput('roastLevel', ROAST_LEVELS, rec.roastLevel))}
      ${field('Process', selectInput('process', PROCESS_METHODS, rec.process))}
    </div>
    <div class="grid2">
      ${field('Varietal', textInput('varietal', rec.varietal, 'e.g. Heirloom'))}
      ${field('Mass (g)', textInput('mass', rec.mass, '250', 'number'))}
    </div>
    <div class="grid2">
      ${field('Purchase date', textInput('purchaseDate', rec.purchaseDate || todayISO(), '', 'date'))}
      ${field('Roast date', textInput('roastDate', rec.roastDate, '', 'date'))}
    </div>
    ${field('Price', textInput('price', rec.price, 'optional', 'number'))}
    ${field('Notes', `<textarea name="notes" placeholder="Anything else about the bag...">${esc(rec.notes || '')}</textarea>`)}
  `;
  $('#deleteBtn').hidden = !rec.id;
  openModal(rec.id ? 'Edit bean' : 'New bean');
}

/* ---- Brew form ---- */
function brewForm(rec = {}) {
  editing = { store: 'brews', record: rec };
  const f = $('#modalForm');
  const beanOpts = beans.length
    ? `<select name="beanId">${['<option value="">— select a bean —</option>']
        .concat(beans.map((b) => `<option value="${b.id}"${b.id === rec.beanId ? ' selected' : ''}>${esc(beanLabel(b))}</option>`)).join('')}</select>`
    : `<div class="field-hint">Add a bean first (Beans tab), then it appears here.</div>`;

  const sliders = TASTE_AXES.map(([key, lbl, hint]) => {
    const v = rec[key] ?? 0;
    return field(lbl, `
      <div class="slider-row">
        <input type="range" name="${key}" min="0" max="5" step="1" value="${v}" oninput="this.nextElementSibling.textContent=this.value" />
        <span class="val">${v}</span>
      </div>`, hint);
  }).join('');

  f.innerHTML = `
    <div class="grid2">
      ${field('Date', textInput('date', rec.date || todayISO(), '', 'date'))}
      ${field('Brew time', textInput('brewTime', rec.brewTime, 'mm:ss'))}
    </div>
    ${field('Bean', beanOpts)}

    <div class="section-label">Recipe</div>
    <div class="grid2">
      ${field('Dose (g)', textInput('dose', rec.dose, '15', 'number'))}
      ${field('Water (g)', textInput('waterMass', rec.waterMass, '250', 'number'))}
    </div>
    <div class="grid2">
      ${field('Water temp (°C)', textInput('waterTemp', rec.waterTemp, '93', 'number'))}
      ${field('Grind setting', textInput('grindSetting', rec.grindSetting, 'e.g. C40 · 22 clicks'))}
    </div>
    ${field('Pour technique', selectInput('pourTemplate', POUR_TEMPLATES, rec.pourTemplate))}

    <div class="section-label">Tasting — score 0 (none) to 5 (intense)</div>
    ${sliders}

    <div class="section-label">Impressions</div>
    ${field('Overall rating', ratingWidget(rec.rating || 0))}
    ${field('Flavour notes', `<textarea name="flavorNotes" placeholder="Blueberry, jasmine, brown sugar, clean finish...">${esc(rec.flavorNotes || '')}</textarea>`,
      'What did you actually taste? Fruit, florals, nuts, chocolate, spice?')}
    ${field('Brew notes', `<textarea name="notes" placeholder="What worked, what to change next time...">${esc(rec.notes || '')}</textarea>`,
      'e.g. slightly sour → grind finer / hotter water next time')}
  `;
  $('#deleteBtn').hidden = !rec.id;
  openModal(rec.id ? 'Edit brew' : 'New brew');
}

function ratingWidget(val) {
  let html = '<div class="rating" data-rating>';
  for (let i = 1; i <= 5; i++) {
    html += `<button type="button" data-star="${i}" class="${i <= val ? 'on' : ''}">★</button>`;
  }
  html += `</div><input type="hidden" name="rating" value="${val}" />`;
  return html;
}

/* ---- Save ---- */
async function saveForm(e) {
  e.preventDefault();
  if (!editing.store) return; // menu mode has no record to save
  const fd = new FormData($('#modalForm'));
  const store = editing.store;
  const rec = { ...editing.record };

  if (store === 'beans') {
    Object.assign(rec, {
      roaster: fd.get('roaster')?.trim() || '',
      originCountry: fd.get('originCountry')?.trim() || '',
      originRegion: fd.get('originRegion')?.trim() || '',
      producer: fd.get('producer')?.trim() || '',
      roastLevel: fd.get('roastLevel') || '',
      process: fd.get('process') || '',
      varietal: fd.get('varietal')?.trim() || '',
      mass: num(fd.get('mass')),
      price: num(fd.get('price')),
      purchaseDate: fd.get('purchaseDate') || '',
      roastDate: fd.get('roastDate') || '',
      notes: fd.get('notes')?.trim() || '',
    });
  } else {
    if (!fd.get('beanId')) { toast('Pick a bean for this brew.'); return; }
    Object.assign(rec, {
      date: fd.get('date') || todayISO(),
      brewTime: fd.get('brewTime')?.trim() || '',
      beanId: fd.get('beanId'),
      dose: num(fd.get('dose')),
      waterMass: num(fd.get('waterMass')),
      waterTemp: num(fd.get('waterTemp')),
      grindSetting: fd.get('grindSetting')?.trim() || '',
      pourTemplate: fd.get('pourTemplate') || '',
      rating: num(fd.get('rating')) || 0,
      flavorNotes: fd.get('flavorNotes')?.trim() || '',
      notes: fd.get('notes')?.trim() || '',
    });
    for (const [k] of TASTE_AXES) rec[k] = num(fd.get(k)) || 0;
  }

  await put(store, rec);
  await reload();
  closeModal();
  toast('Saved ☕');
}

async function deleteCurrent() {
  const { store, record } = editing;
  if (!record?.id) return;
  if (!confirm('Delete this entry? This cannot be undone.')) return;
  await remove(store, record.id);
  await reload();
  closeModal();
  toast('Deleted');
}

/* =========================================================================
 * MENU: backup / restore / sample data
 * ========================================================================= */
function openMenu() {
  editing = { store: null, record: null };
  $('#modalForm').innerHTML = `
    <div class="menu-list">
      <button type="button" data-menu="export">Export backup (.json)
        <span class="desc">Save all beans &amp; brews to a file — for backups or moving to another device.</span></button>
      <button type="button" data-menu="import">Import backup (.json)
        <span class="desc">Merge a backup file into this device.</span></button>
      <button type="button" data-menu="sample">Load sample data
        <span class="desc">Add a few example beans &amp; brews to see how it works.</span></button>
    </div>`;
  $('#deleteBtn').hidden = true;
  $('#modalForm').onsubmit = (e) => e.preventDefault();
  $('.modal-foot .primary').style.display = 'none';
  openModal('Data & backup');
}

async function doExport() {
  const data = await exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pourover-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Backup downloaded');
}

function doImport() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'application/json,.json';
  inp.onchange = async () => {
    const file = inp.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const res = await importAll(data, 'merge');
      await reload();
      closeModal();
      toast(`Imported ${res.beans} beans, ${res.brews} brews`);
    } catch (err) {
      toast(err.message || 'Import failed');
    }
  };
  inp.click();
}

async function loadSample() {
  const b1 = { id: uid(), roaster: 'Onyx Coffee Lab', originCountry: 'Ethiopia', originRegion: 'Guji',
    producer: 'Shakiso', roastLevel: 'Light', process: 'Natural', varietal: 'Heirloom',
    mass: 250, purchaseDate: todayISO(), notes: '' };
  const b2 = { id: uid(), roaster: 'Sey Coffee', originCountry: 'Colombia', originRegion: 'Huila',
    producer: 'El Paraiso', roastLevel: 'Medium-light', process: 'Anaerobic washed', varietal: 'Caturra',
    mass: 200, purchaseDate: todayISO(), notes: '' };
  await put('beans', b1); await put('beans', b2);
  const mk = (beanId, d, rating, over) => ({
    id: uid(), date: d, beanId, dose: 15, waterMass: 250, waterTemp: 93,
    grindSetting: 'C40 · 22', pourTemplate: 'Hoffmann / Tetsu 4:6',
    aroma: 4, acidity: 4, sweetness: 4, body: 3, bitterness: 1, aftertaste: 4,
    rating, flavorNotes: '', notes: '', ...over });
  await put('brews', mk(b1.id, todayISO(), 5, { flavorNotes: 'Blueberry, jasmine, clean' }));
  await put('brews', mk(b1.id, todayISO(), 4, {}));
  await put('brews', mk(b2.id, todayISO(), 4, { flavorNotes: 'Tropical, boozy, syrupy' }));
  await reload();
  closeModal();
  toast('Sample data loaded');
}

/* =========================================================================
 * NAV + WIRING
 * ========================================================================= */
function switchView(name) {
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  if (name === 'stats') renderStats();
}

async function reload() {
  [beans, brews] = await Promise.all([getAll('beans'), getAll('brews')]);
  renderBrews();
  renderBeans();
  if ($('#view-stats').classList.contains('active')) renderStats();
}

function wireEvents() {
  // bottom tabs
  $$('.tab').forEach((t) => t.addEventListener('click', () => switchView(t.dataset.view)));

  // header menu
  $('#menuBtn').addEventListener('click', openMenu);

  // clicks: new buttons, edit cards, modal actions, menu, rating stars
  document.addEventListener('click', (e) => {
    const act = e.target.closest('[data-action]')?.dataset.action;
    if (act === 'new-brew') return brewForm();
    if (act === 'new-bean') return beanForm();
    if (act === 'close-modal') { $('.modal-foot .primary').style.display = ''; return closeModal(); }

    const card = e.target.closest('[data-edit]');
    if (card) {
      const rec = (card.dataset.edit === 'beans' ? beans : brews).find((r) => r.id === card.dataset.id);
      if (rec) return card.dataset.edit === 'beans' ? beanForm(rec) : brewForm(rec);
    }

    const menu = e.target.closest('[data-menu]')?.dataset.menu;
    if (menu === 'export') return doExport();
    if (menu === 'import') return doImport();
    if (menu === 'sample') return loadSample();

    const star = e.target.closest('[data-star]');
    if (star) {
      const v = +star.dataset.star;
      const box = star.closest('[data-rating]');
      $$('[data-star]', box).forEach((s) => s.classList.toggle('on', +s.dataset.star <= v));
      box.nextElementSibling.value = v;
    }
  });

  $('#modalForm').addEventListener('submit', saveForm);
  $('#deleteBtn').addEventListener('click', deleteCurrent);
}

/* ---------- Boot ---------- */
async function init() {
  wireEvents();
  await reload();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
init();
