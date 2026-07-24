/* =========================================================================
 * app.js — Bloom pour-over journal (local-first PWA)
 * ========================================================================= */
import {
  getAll, get, put, remove, uid, exportAll, importAll,
  getSettings, saveSettings,
} from './db.js';

/* ---------- Tasting axes (0–5 sliders) with coaching hints ---------- */
const TASTE_AXES = [
  ['aroma',      'Aroma',      'Floral, fruity, nutty, chocolatey, spicy — what hits your nose?'],
  ['acidity',    'Acidity',    'Brightness/liveliness. Citrusy & crisp vs. flat. 0 = none, 5 = vibrant'],
  ['sweetness',  'Sweetness',  'Sugar-like roundness — caramel, honey, ripe fruit'],
  ['body',       'Body',       'Weight/texture in the mouth. Tea-like & light vs. syrupy & heavy'],
  ['bitterness', 'Bitterness', 'Often over-extraction. 0 = none, 5 = harsh (usually kept low)'],
  ['aftertaste', 'Aftertaste', 'The finish — how long & pleasant the flavour lingers'],
];

const ROAST_LEVELS = ['Very light', 'Light', 'Medium-light', 'Medium', 'Medium-dark', 'Dark'];
const PROCESS_METHODS = [
  'Washed', 'Natural', 'Honey', 'Black honey', 'Anaerobic natural', 'Anaerobic washed',
  'Anaerobic honey', 'Anaerobic fermentation washed', 'Carbonic maceration', 'Wet hulling', 'Other',
];

/* ---------- Brew-technique templates ----------
 * Each technique defines the parameters entered for it. Time fields are free
 * text as m:ss; number fields are grams/seconds. */
const TECHNIQUES = {
  'Single pour': { en: '一刀流 — bloom + 1 pour', fields: [
    ['bloomMass', 'Bloom water (g)', 'num'],
    ['bloomTime', '焖蒸时间 · pour starts (m:ss)', 'time'],
    ['totalWater', 'Total water (g)', 'num'],
    ['pourFinishTime', '注水时间 · pour ends (m:ss)', 'time'],
    ['cutoffTime', '萃取时间 · cutoff (m:ss)', 'time'],
  ]},
  'Two-stage': { en: '两段式 — 2 pours, no bloom', fields: [
    ['pour1Mass', '1st pour (g)', 'num'],
    ['pour2Time', '2nd pour starts (m:ss)', 'time'],
    ['totalWater', 'Total water (g)', 'num'],
    ['cutoffTime', 'Cutoff (m:ss)', 'time'],
  ]},
  'Three-stage': { en: '三段式 — bloom + 2 pours', fields: [
    ['bloomMass', 'Bloom water (g)', 'num'],
    ['pour2Time', '2nd pour (m:ss)', 'time'],
    ['pour2Mass', 'after 2nd pour (g)', 'num'],
    ['pour3Time', '3rd pour (m:ss)', 'time'],
    ['totalWater', 'Total water (g)', 'num'],
    ['cutoffTime', 'Cutoff (m:ss)', 'time'],
  ]},
  'Four-stage': { en: '四段式 — bloom + 3 pours', fields: [
    ['bloomMass', 'Bloom water (g)', 'num'],
    ['pour2Time', '2nd pour (m:ss)', 'time'],
    ['pour2Mass', 'after 2nd pour (g)', 'num'],
    ['pour3Time', '3rd pour (m:ss)', 'time'],
    ['pour3Mass', 'after 3rd pour (g)', 'num'],
    ['pour4Time', '4th pour (m:ss)', 'time'],
    ['totalWater', 'Total water (g)', 'num'],
    ['cutoffTime', 'Cutoff (m:ss)', 'time'],
  ]},
  'Switch immersion': { en: '聪明杯浸泡 — steep', fields: [
    ['totalWater', 'Total water (g)', 'num'],
    ['openTime', 'Valve opened (m:ss)', 'time'],
    ['cutoffTime', 'Cutoff (m:ss)', 'time'],
  ]},
  '金龙鱼': { en: 'equal-pour pulse', fields: [
    ['waterPerPour', 'Water per pour (g)', 'num'],
    ['interval', 'Interval between pours (s)', 'num'],
    ['totalWater', 'Total water (g)', 'num'],
    ['cutoffTime', 'Cutoff (m:ss)', 'time'],
  ]},
  'Cold brew': { en: '冷萃 — overnight steep', fields: [
    ['totalWater', 'Total water (g)', 'num'],
    ['steepTime', 'Steep window', 'text'],
    ['yieldMass', 'Yield (g)', 'num'],
  ]},
};
const TECH_KEYS = Object.keys(TECHNIQUES);

/* ---------- App state ---------- */
let beans = [];
let brews = [];
let settings = null;
let editing = { store: null, record: null };

/* ---------- Helpers ---------- */
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
  const place = [b.originRegion, b.producer].filter(Boolean).join(' ');
  const name = place || b.varietal || b.originCountry || 'Bean';
  return b.roaster ? `${b.roaster} · ${name}` : name;
}

/* ---------- Derived ratings ---------- */
function beanBrewAvg(beanId) {
  const rated = brews.filter((x) => x.beanId === beanId && x.rating);
  if (!rated.length) return null;
  return rated.reduce((s, x) => s + x.rating, 0) / rated.length;
}
function beanOverall(b) {
  // manual/imported rating wins; otherwise average of rated brews
  return (b.rating != null && b.rating !== '') ? +b.rating : beanBrewAvg(b.id);
}
function beanBrewCount(beanId) {
  return brews.filter((x) => x.beanId === beanId).length;
}
/* Consumption: grams used = sum of brew doses; remaining vs bag mass. */
function beanConsumption(b) {
  const consumed = brews
    .filter((x) => x.beanId === b.id && x.dose)
    .reduce((s, x) => s + x.dose, 0);
  const mass = b.mass != null ? +b.mass : null;
  const remaining = mass != null ? Math.round((mass - consumed) * 10) / 10 : null;
  const finished = !!b.finished || (remaining != null && remaining <= 0);
  return { consumed: Math.round(consumed * 10) / 10, remaining, finished, mass };
}

/* =========================================================================
 * RENDER — brews
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
    const total = x.waterMass || (x.tech && x.tech.totalWater) || null;
    const ratio = x.dose && total ? `1:${(total / x.dose).toFixed(1)}` : null;
    const tech = x.technique ? `${x.technique}${TECHNIQUES[x.technique] ? '' : ''}` : null;
    const meta = [
      x.dose ? `${x.dose} g` : null,
      total ? `${total} g water` : null,
      ratio,
      x.waterTemp ? `${x.waterTemp}°C` : null,
      tech,
      x.device || null,
    ].filter(Boolean);
    return `
      <div class="card" data-edit="brews" data-id="${x.id}">
        <div class="row1">
          <div>
            <div class="title">${esc(beanLabel(bean))}</div>
            <div class="sub">${esc(x.date || '')}${x.grind != null ? ` · ${esc(x.grind)}格` : ''}${x.grinder ? ` · ${esc(x.grinder)}` : ''}</div>
          </div>
          ${starStr(x.rating)}
        </div>
        <div class="meta">${meta.map((m) => `<span class="pill">${esc(m)}</span>`).join('')}</div>
        ${x.flavorNotes ? `<div class="sub" style="margin-top:8px">“${esc(x.flavorNotes)}”</div>` : ''}
      </div>`;
  }).join('');
}

/* ---------- RENDER — beans ---------- */
function renderBeans() {
  const el = $('#beanList');
  if (!beans.length) {
    el.innerHTML = emptyState('No beans yet', 'Add a bag of beans, then log brews against it.');
    return;
  }
  const sorted = [...beans].sort((a, b) => beanLabel(a).localeCompare(beanLabel(b)));
  el.innerHTML = sorted.map((b) => {
    const overall = beanOverall(b);
    const n = beanBrewCount(b.id);
    const c = beanConsumption(b);
    const status = c.finished
      ? `<span class="tag-done">Finished</span>`
      : (c.remaining != null ? `<span class="pill strong">${c.remaining} g left</span>` : '');
    const meta = [b.originCountry, b.process, b.roastLevel, b.varietal].filter(Boolean);
    return `
      <div class="card${c.finished ? ' finished' : ''}" data-edit="beans" data-id="${b.id}">
        <div class="row1">
          <div>
            <div class="title">${esc(beanLabel(b))}</div>
            <div class="sub">${n} brew${n === 1 ? '' : 's'}${b.originCountry ? ' · ' + esc(b.originCountry) : ''}</div>
          </div>
          <div style="text-align:right">${starStr(overall)}<div style="margin-top:4px">${status}</div></div>
        </div>
        <div class="meta">${meta.map((m) => `<span class="pill">${esc(m)}</span>`).join('')}</div>
        ${b.flavour ? `<div class="sub" style="margin-top:8px">${esc(b.flavour)}</div>` : ''}
      </div>`;
  }).join('');
}

function emptyState(t, s) {
  return `<div class="empty"><p style="font-size:34px">🌸</p><p><strong>${esc(t)}</strong></p><p>${esc(s)}</p></div>`;
}

/* ---------- RENDER — stats ---------- */
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

  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d.toISOString().slice(0, 7));
  }
  const perMonth = months.map((m) => ({
    label: monthLabel(m),
    value: brews.filter((x) => (x.date || '').startsWith(m)).length,
  }));

  const roasterCounts = countBy(brews.map((x) => beanField(x, 'roaster')));
  const processCounts = countBy(brews.map((x) => beanField(x, 'process')));
  const techniqueCounts = countBy(brews.map((x) => x.technique));
  const deviceCounts = countBy(brews.map((x) => x.device));

  const processRatings = avgBy(brews, (x) => beanField(x, 'process'));
  const favProcess = topEntry(
    processRatings.filter((p) => p.n >= 3).length ? processRatings.filter((p) => p.n >= 3) : processRatings, 'avg');
  const topRoaster = topEntry(roasterCounts, 'value');

  const beanScores = beans
    .map((b) => ({ label: beanLabel(b), avg: beanOverall(b) }))
    .filter((b) => b.avg != null)
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 8);

  el.innerHTML = `
    <div class="stat-cards">
      <div class="stat"><div class="num">${brews.length}</div><div class="lbl">total brews</div></div>
      <div class="stat"><div class="num">${cupsThisMonth}</div><div class="lbl">cups this month</div></div>
      <div class="stat"><div class="num">${avgAll ? avgAll.toFixed(1) : '—'}</div><div class="lbl">avg brew rating</div></div>
      <div class="stat"><div class="num">${beans.length}</div><div class="lbl">beans logged</div></div>
    </div>
    ${topRoaster ? `<div class="stat-cards">
      <div class="stat"><div class="num" style="font-size:17px">${esc(topRoaster.label)}</div><div class="lbl">most-brewed roaster (${topRoaster.value}×)</div></div>
      <div class="stat"><div class="num" style="font-size:17px">${favProcess ? esc(favProcess.label) : '—'}</div><div class="lbl">top process by rating${favProcess ? ` (${favProcess.avg.toFixed(1)})` : ''}</div></div>
    </div>` : ''}
    ${barBlock('Cups per month', perMonth)}
    ${roasterCounts.length ? barBlock('Brews by roaster', roasterCounts.sort((a, b) => b.value - a.value).slice(0, 8)) : ''}
    ${techniqueCounts.length ? barBlock('Brews by technique', techniqueCounts.sort((a, b) => b.value - a.value)) : ''}
    ${deviceCounts.length ? barBlock('Brews by device', deviceCounts.sort((a, b) => b.value - a.value)) : ''}
    ${processCounts.length ? barBlock('Brews by process', processCounts.sort((a, b) => b.value - a.value)) : ''}
    ${beanScores.length ? barBlock('Top beans (rating)', beanScores.map((b) => ({ label: b.label, value: +b.avg.toFixed(1) })), 5) : ''}
  `;
}

function beanField(brew, field) {
  const b = beans.find((z) => z.id === brew.beanId);
  return b && b[field] ? b[field] : null;
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
 * MODAL + FORM PLUMBING
 * ========================================================================= */
function openModal(title) { $('#modalTitle').textContent = title; $('#modal').hidden = false; }
function closeModal() {
  $('#modal').hidden = true;
  $('#modalForm').innerHTML = '';
  $('#modalForm').onsubmit = null;
  $('#deleteBtn').hidden = true;
  $('.modal-foot .primary').style.display = '';
  editing = { store: null, record: null };
}
function field(label, inner, hint) {
  return `<div><label>${esc(label)}</label>${inner}${hint ? `<div class="field-hint">${esc(hint)}</div>` : ''}</div>`;
}
function textInput(name, val = '', ph = '', type = 'text') {
  return `<input name="${name}" type="${type}" value="${esc(val)}" placeholder="${esc(ph)}" />`;
}
function selectInput(name, opts, val = '', blank = '—') {
  const o = [`<option value="">${esc(blank)}</option>`]
    .concat(opts.map((x) => `<option value="${esc(x)}"${x === val ? ' selected' : ''}>${esc(x)}</option>`));
  return `<select name="${name}">${o.join('')}</select>`;
}

/* ---------- BEAN form ---------- */
function beanForm(rec = {}) {
  editing = { store: 'beans', record: rec };
  const c = rec.id ? beanConsumption(rec) : null;
  const consHint = c && c.remaining != null
    ? `${c.consumed} g used · ${c.remaining} g left of ${c.mass} g`
    : 'Enter bag mass (g) above to track how much is left.';
  $('#modalForm').innerHTML = `
    <div class="grid2">
      ${field('Roaster', textInput('roaster', rec.roaster, 'e.g. Terraform'))}
      ${field('Origin country', textInput('originCountry', rec.originCountry, 'e.g. Ethiopia'))}
    </div>
    <div class="grid2">
      ${field('Region / area', textInput('originRegion', rec.originRegion, 'e.g. Sidama Bensa'))}
      ${field('Producer / farm', textInput('producer', rec.producer, 'e.g. Shantawene'))}
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
      ${field('Price', textInput('price', rec.price, 'optional'))}
      ${field('Roast date', textInput('roastDate', rec.roastDate, 'optional'))}
    </div>
    ${field('Tasting notes (flavour)', `<textarea name="flavour" placeholder="Jasmine, peach, black tea...">${esc(rec.flavour || '')}</textarea>`,
      'The roaster’s / your flavour descriptors for this bag.')}
    ${field('Overall rating', ratingWidget(rec.rating || 0))}
    ${field('Consumption', `<label class="check"><input type="checkbox" name="finished" ${rec.finished ? 'checked' : ''}/> Mark this bag finished</label>`, consHint)}
    ${field('Notes', `<textarea name="notes" placeholder="Anything else about the bag...">${esc(rec.notes || '')}</textarea>`)}
  `;
  $('#deleteBtn').hidden = !rec.id;
  openModal(rec.id ? 'Edit bean' : 'New bean');
}

/* ---------- BREW form ---------- */
function brewForm(rec = {}) {
  editing = { store: 'brews', record: rec };
  const d = settings.defaults || {};
  const cur = {
    grinder: rec.grinder ?? d.grinder ?? '',
    device: rec.device ?? d.device ?? '',
    paper: rec.paper ?? d.paper ?? '',
    dose: rec.dose ?? d.dose ?? '',
    waterTemp: rec.waterTemp ?? d.waterTemp ?? '',
    technique: rec.technique ?? d.technique ?? TECH_KEYS[0],
  };
  const beanOpts = beans.length
    ? `<select name="beanId">${['<option value="">— select a bean —</option>']
        .concat([...beans].sort((a, b) => beanLabel(a).localeCompare(beanLabel(b)))
          .map((b) => `<option value="${b.id}"${b.id === rec.beanId ? ' selected' : ''}>${esc(beanLabel(b))}</option>`)).join('')}</select>`
    : `<div class="field-hint">Add a bean first (Beans tab), then it appears here.</div>`;

  const sliders = TASTE_AXES.map(([key, lbl, hint]) => {
    const v = rec[key] ?? 0;
    return field(lbl, `
      <div class="slider-row">
        <input type="range" name="${key}" min="0" max="5" step="1" value="${v}" oninput="this.nextElementSibling.textContent=this.value" />
        <span class="val">${v}</span>
      </div>`, hint);
  }).join('');

  $('#modalForm').innerHTML = `
    ${field('Date', textInput('date', rec.date || todayISO(), '', 'date'))}
    ${field('Bean', beanOpts)}

    <div class="section-label">Recipe</div>
    <div class="grid2">
      ${field('Grinder', selectInput('grinder', settings.grinders, cur.grinder))}
      ${field('Grind (格)', textInput('grind', rec.grind, '8.5', 'number'))}
    </div>
    <div class="grid2">
      ${field('Dose (g)', textInput('dose', cur.dose, '15', 'number'))}
      ${field('Water temp (°C)', textInput('waterTemp', cur.waterTemp, '92', 'number'))}
    </div>
    <div class="grid2">
      ${field('Device', selectInput('device', settings.devices, cur.device))}
      ${field('Filter paper', selectInput('paper', settings.papers, cur.paper))}
    </div>

    <div class="section-label">Technique</div>
    ${field('Method', selectInput('technique', TECH_KEYS.map((k) => `${k} · ${TECHNIQUES[k].en}`), techDisplay(cur.technique), 'choose…'))}
    <div id="techFields"></div>

    <div class="section-label">Tasting — 0 (none) to 5 (intense)</div>
    ${sliders}

    <div class="section-label">Impressions</div>
    ${field('Overall rating', ratingWidget(rec.rating || 0))}
    ${field('Flavour notes', `<textarea name="flavorNotes" placeholder="Blueberry, jasmine, clean finish...">${esc(rec.flavorNotes || '')}</textarea>`,
      'What did you actually taste?')}
    ${field('Brew notes', `<textarea name="notes" placeholder="What to change next time...">${esc(rec.notes || '')}</textarea>`,
      'e.g. slightly sour → grind finer next time')}
  `;
  renderTechFields(cur.technique, rec.tech || {});
  // re-render tech fields when method changes
  $('select[name=technique]').addEventListener('change', (e) => {
    const key = techFromDisplay(e.target.value);
    renderTechFields(key, {});
  });
  $('#deleteBtn').hidden = !rec.id;
  openModal(rec.id ? 'Edit brew' : 'New brew');
}

function techDisplay(key) { return TECHNIQUES[key] ? `${key} · ${TECHNIQUES[key].en}` : ''; }
function techFromDisplay(disp) { return (disp || '').split(' · ')[0]; }

function renderTechFields(techKey, values) {
  const box = $('#techFields');
  if (!box) return;
  const t = TECHNIQUES[techKey];
  if (!t) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="grid2">` + t.fields.map(([k, lbl, type]) => {
    const v = values[k] ?? '';
    let inp;
    if (type === 'num') inp = `<input name="tech_${k}" type="number" step="any" value="${esc(v)}" />`;
    else if (type === 'time') inp = `<input name="tech_${k}" type="text" value="${esc(v)}" placeholder="m:ss" />`;
    else inp = `<input name="tech_${k}" type="text" value="${esc(v)}" />`;
    return field(lbl, inp);
  }).join('') + `</div>`;
}

function ratingWidget(val) {
  let html = '<div class="rating" data-rating>';
  for (let i = 1; i <= 5; i++) html += `<button type="button" data-star="${i}" class="${i <= val ? 'on' : ''}">★</button>`;
  html += `</div><input type="hidden" name="rating" value="${val}" />`;
  return html;
}

/* ---------- SAVE ---------- */
async function saveForm(e) {
  e.preventDefault();
  if (!editing.store) return;
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
      price: fd.get('price')?.trim() || '',
      roastDate: fd.get('roastDate')?.trim() || '',
      flavour: fd.get('flavour')?.trim() || '',
      rating: num(fd.get('rating')) || null,
      finished: fd.get('finished') === 'on',
      notes: fd.get('notes')?.trim() || '',
    });
  } else {
    if (!fd.get('beanId')) { toast('Pick a bean for this brew.'); return; }
    const technique = techFromDisplay(fd.get('technique'));
    const tech = {};
    if (TECHNIQUES[technique]) {
      for (const [k, , type] of TECHNIQUES[technique].fields) {
        const raw = fd.get('tech_' + k);
        if (raw == null || raw === '') continue;
        tech[k] = type === 'num' ? num(raw) : raw.trim();
      }
    }
    Object.assign(rec, {
      date: fd.get('date') || todayISO(),
      beanId: fd.get('beanId'),
      grinder: fd.get('grinder') || '',
      grind: num(fd.get('grind')),
      dose: num(fd.get('dose')),
      waterTemp: num(fd.get('waterTemp')),
      device: fd.get('device') || '',
      paper: fd.get('paper') || '',
      technique,
      tech,
      waterMass: tech.totalWater ?? null,
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
 * MENU + SETTINGS
 * ========================================================================= */
function openMenu() {
  editing = { store: null, record: null };
  $('#modalForm').innerHTML = `
    <div class="menu-list">
      <button type="button" data-menu="settings">Equipment &amp; defaults
        <span class="desc">Edit grinders, devices, filter papers, and default recipe values.</span></button>
      <button type="button" data-menu="export">Export backup (.json)
        <span class="desc">Save all data to a file — backups or moving to another device.</span></button>
      <button type="button" data-menu="import">Import backup (.json)
        <span class="desc">Merge a backup or a converted Notion file into this device.</span></button>
      <button type="button" data-menu="sample">Load sample data
        <span class="desc">Add a couple of example beans &amp; brews.</span></button>
    </div>`;
  $('#deleteBtn').hidden = true;
  $('#modalForm').onsubmit = (e) => e.preventDefault();
  $('.modal-foot .primary').style.display = 'none';
  openModal('Menu');
}

function settingsForm() {
  const d = settings.defaults || {};
  const listEditor = (kind, label) => `
    <div class="section-label">${label}</div>
    <div class="chips" data-list="${kind}">
      ${settings[kind].map((v) => `<span class="chip">${esc(v)}<button type="button" data-del-chip="${esc(v)}" data-kind="${kind}">✕</button></span>`).join('')}
    </div>
    <div class="add-row">
      <input type="text" data-add-input="${kind}" placeholder="Add ${label.toLowerCase().replace(/s$/, '')}..." />
      <button type="button" class="ghost" data-add-btn="${kind}">Add</button>
    </div>`;

  $('#modalForm').innerHTML = `
    ${listEditor('grinders', 'Grinders')}
    ${listEditor('devices', 'Devices')}
    ${listEditor('papers', 'Filter papers')}

    <div class="section-label">Defaults for new brews</div>
    <div class="grid2">
      ${field('Grinder', selectInput('d_grinder', settings.grinders, d.grinder))}
      ${field('Device', selectInput('d_device', settings.devices, d.device))}
    </div>
    <div class="grid2">
      ${field('Filter paper', selectInput('d_paper', settings.papers, d.paper))}
      ${field('Technique', selectInput('d_technique', TECH_KEYS, d.technique))}
    </div>
    <div class="grid2">
      ${field('Dose (g)', textInput('d_dose', d.dose, '15', 'number'))}
      ${field('Water temp (°C)', textInput('d_waterTemp', d.waterTemp, '92', 'number'))}
    </div>
  `;
  $('#modalForm').onsubmit = (e) => { e.preventDefault(); saveSettingsForm(); };
  $('.modal-foot .primary').style.display = '';
  $('#deleteBtn').hidden = true;
  editing = { store: 'settings', record: null };
  openModal('Equipment & defaults');
}

async function saveSettingsForm() {
  const fd = new FormData($('#modalForm'));
  settings.defaults = {
    grinder: fd.get('d_grinder') || '',
    device: fd.get('d_device') || '',
    paper: fd.get('d_paper') || '',
    technique: fd.get('d_technique') || '',
    dose: num(fd.get('d_dose')),
    waterTemp: num(fd.get('d_waterTemp')),
  };
  await saveSettings(settings);
  closeModal();
  toast('Settings saved');
}

function handleSettingsClick(e) {
  const del = e.target.closest('[data-del-chip]');
  if (del) {
    const kind = del.dataset.kind, val = del.dataset.delChip;
    settings[kind] = settings[kind].filter((x) => x !== val);
    settingsForm();
    return true;
  }
  const add = e.target.closest('[data-add-btn]');
  if (add) {
    const kind = add.dataset.addBtn;
    const inp = $(`[data-add-input="${kind}"]`);
    const val = inp.value.trim();
    if (val && !settings[kind].includes(val)) settings[kind].push(val);
    settingsForm();
    return true;
  }
  return false;
}

/* ---------- Backup / restore / sample ---------- */
async function doExport() {
  const data = await exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bloom-backup-${todayISO()}.json`;
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
      settings = await getSettings();
      await reload();
      closeModal();
      toast(`Imported ${res.beans} beans, ${res.brews} brews`);
    } catch (err) { toast(err.message || 'Import failed'); }
  };
  inp.click();
}
async function loadSample() {
  const b1 = { id: uid(), roaster: 'Terraform', originCountry: 'Ethiopia', originRegion: 'Sidama Bensa',
    producer: 'Shantawene', roastLevel: 'Light', process: 'Washed', varietal: 'Heirloom',
    mass: 100, flavour: 'Jasmine, peach, black tea', rating: 4 };
  await put('beans', b1);
  const mk = (over) => ({ id: uid(), date: todayISO(), beanId: b1.id, grinder: 'Mavo Phantox Pro',
    grind: 8.5, dose: 15, waterTemp: 92, device: '树脂V60 01', paper: '', technique: 'Three-stage',
    tech: { bloomMass: 45, pour2Time: '0:30', pour2Mass: 130, pour3Time: '1:00', totalWater: 245, cutoffTime: '2:30' },
    waterMass: 245, aroma: 4, acidity: 4, sweetness: 4, body: 3, bitterness: 1, aftertaste: 4,
    rating: 4, flavorNotes: '', notes: '', ...over });
  await put('brews', mk({ rating: 5, flavorNotes: 'Bright, clean, floral' }));
  await put('brews', mk({}));
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
  $$('.tab').forEach((t) => t.addEventListener('click', () => switchView(t.dataset.view)));
  $('#menuBtn').addEventListener('click', openMenu);

  document.addEventListener('click', (e) => {
    if (handleSettingsClick(e)) return;

    const act = e.target.closest('[data-action]')?.dataset.action;
    if (act === 'new-brew') return brewForm();
    if (act === 'new-bean') return beanForm();
    if (act === 'close-modal') return closeModal();

    const card = e.target.closest('[data-edit]');
    if (card) {
      const rec = (card.dataset.edit === 'beans' ? beans : brews).find((r) => r.id === card.dataset.id);
      if (rec) return card.dataset.edit === 'beans' ? beanForm(rec) : brewForm(rec);
    }

    const menu = e.target.closest('[data-menu]')?.dataset.menu;
    if (menu === 'settings') return settingsForm();
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

async function init() {
  wireEvents();
  settings = await getSettings();
  await saveSettings(settings); // persist seeded defaults on first run
  await reload();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
init();
