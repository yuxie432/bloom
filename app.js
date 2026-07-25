/* =========================================================================
 * app.js — Bloom pour-over journal (local-first PWA)
 * ========================================================================= */
import {
  getAll, get, put, remove, uid, exportAll, importAll,
  getSettings, saveSettings, commitSettings, clearAll,
} from './db.js?v=18';
import {
  startSync, signInGoogle, signOutUser, currentUser, resync, wipeRemote,
} from './sync.js?v=18';

/* ---------- Tasting axes (0–5 sliders) ---------- */
const TASTE_AXES = [
  ['aroma',      'Aroma',      'Floral, fruity, nutty, chocolatey, spicy — what hits your nose?'],
  ['acidity',    'Acidity',    'Brightness. Citrusy & crisp vs. flat. 0 = none, 5 = vibrant'],
  ['sweetness',  'Sweetness',  'Sugar-like roundness — caramel, honey, ripe fruit'],
  ['body',       'Body',       'Weight/texture. Tea-like & light vs. syrupy & heavy'],
  ['bitterness', 'Bitterness', 'Often over-extraction. 0 = none, 5 = harsh'],
  ['aftertaste', 'Aftertaste', 'The finish — how long & pleasant it lingers'],
];

const ROAST_LEVELS = ['Very light', 'Light', 'Medium-light', 'Medium', 'Medium-dark', 'Dark'];
const PROCESS_METHODS = [
  'Washed', 'Natural', 'Honey', 'Anaerobic natural', 'Anaerobic washed',
  'Anaerobic honey', 'Wet hulling', 'Other',
];

/* ---------- Brew-technique templates (English) ----------
 * Field tuple: [key, label, type]  where type = num | time | text */
const TECHNIQUES = {
  'Single pour': { en: 'Bloom + 1 pour', fields: [
    ['bloomMass', 'Bloom water (g)', 'num'],
    ['bloomTime', 'Bloom time (m:ss)', 'time'],
    ['totalWater', 'Total water (g)', 'num'],
    ['pourFinishTime', 'Pour ends (m:ss)', 'time'],
    ['cutoffTime', 'Cutoff (m:ss)', 'time'],
  ]},
  'Two-stage': { en: '2 pours, no bloom', fields: [
    ['pour1Mass', 'First pour (g)', 'num'],
    ['pour2Time', 'Second pour at (m:ss)', 'time'],
    ['totalWater', 'Total water (g)', 'num'],
    ['cutoffTime', 'Cutoff (m:ss)', 'time'],
  ]},
  'Three-stage': { en: 'Bloom + 2 pours', fields: [
    ['bloomMass', 'Bloom water (g)', 'num'],
    ['pour2Time', 'Second pour at (m:ss)', 'time'],
    ['pour2Mass', 'After second pour (g)', 'num'],
    ['pour3Time', 'Third pour at (m:ss)', 'time'],
    ['totalWater', 'Total water (g)', 'num'],
    ['cutoffTime', 'Cutoff (m:ss)', 'time'],
  ]},
  'Four-stage': { en: 'Bloom + 3 pours', fields: [
    ['bloomMass', 'Bloom water (g)', 'num'],
    ['pour2Time', 'Second pour at (m:ss)', 'time'],
    ['pour2Mass', 'After second pour (g)', 'num'],
    ['pour3Time', 'Third pour at (m:ss)', 'time'],
    ['pour3Mass', 'After third pour (g)', 'num'],
    ['pour4Time', 'Fourth pour at (m:ss)', 'time'],
    ['totalWater', 'Total water (g)', 'num'],
    ['cutoffTime', 'Cutoff (m:ss)', 'time'],
  ]},
  'Switch immersion': { en: 'Clever / Switch steep', fields: [
    ['totalWater', 'Total water (g)', 'num'],
    ['openTime', 'Valve opened (m:ss)', 'time'],
    ['cutoffTime', 'Cutoff (m:ss)', 'time'],
  ]},
  'Equal pulse': { en: 'Even pours at set intervals', fields: [
    ['waterPerPour', 'Water per pour (g)', 'num'],
    ['interval', 'Interval (s)', 'num'],
    ['totalWater', 'Total water (g)', 'num'],
    ['cutoffTime', 'Cutoff (m:ss)', 'time'],
  ]},
  'Cold brew': { en: 'Overnight steep', fields: [
    ['totalWater', 'Total water (g)', 'num'],
    ['steepTime', 'Steep window', 'text'],
    ['yieldMass', 'Yield (g)', 'num'],
  ]},
};
const TECH_KEYS = Object.keys(TECHNIQUES);

const BREW_PAGE = 20;
const BEAN_PAGE = 12;

/* ---------- App state ---------- */
let beans = [];
let brews = [];
let settings = null;
let editing = { store: null, record: null };
let brewsPage = 0;
let beansPage = 0;
let detailBeanId = null;   // bean whose detail view is open
let returnBeanId = null;   // when set, closing/saving a form returns to that bean's detail

/* ---------- Helpers ---------- */
const $  = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const todayISO = () => new Date().toISOString().slice(0, 10);
const num = (v) => (v === '' || v == null || isNaN(+v) ? null : +v);
const varList = (v) => (Array.isArray(v) ? v : (v ? String(v).split(/[,、]/).map((x) => x.trim()).filter(Boolean) : []));

function starStr(r, big) {
  const cls = `rating-line${big ? ' big' : ''}`;
  if (!r) return `<span class="${cls}"><span class="unrated">unrated</span></span>`;
  let h = `<span class="${cls}"><span class="stars">`;
  for (let i = 1; i <= 5; i++) {
    if (r >= i) h += '★';
    else if (r >= i - 0.5) h += '<span class="halfstar">★</span>';
    else h += '<span class="emptystar">★</span>';
  }
  return h + `</span><span class="rval">${(+r).toFixed(1)}</span></span>`;
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2200);
}
function beanLabel(b) {
  if (!b) return 'Unknown bean';
  const named = [b.producer, b.lot ? `#${b.lot}` : null].filter(Boolean).join(' ');
  const name = named || varList(b.varietal).join(', ') || b.originCountry || 'Bean';
  return b.roaster ? `${b.roaster} · ${name}` : name;
}
function money(n) { return n == null ? '' : '¥' + (Math.round(n * 100) / 100).toLocaleString(); }

/* ---------- Derived ---------- */
function beanBrewAvg(id) {
  const r = brews.filter((x) => x.beanId === id && x.rating);
  return r.length ? r.reduce((s, x) => s + x.rating, 0) / r.length : null;
}
function beanOverall(b) {
  return (b.rating != null && b.rating !== '') ? +b.rating : beanBrewAvg(b.id);
}
function beanBrewCount(id) { return brews.filter((x) => x.beanId === id).length; }
function beanLastBrew(id) {
  return brews.filter((x) => x.beanId === id).reduce((m, x) => (x.date > m ? x.date : m), '');
}
function beanConsumption(b) {
  const consumed = brews.filter((x) => x.beanId === b.id && x.dose).reduce((s, x) => s + x.dose, 0);
  const mass = b.mass != null ? +b.mass : null;
  let remaining;
  if (b.massLeftSet != null && b.massLeftSet !== '') {
    // manual override: value entered, re-based so later brews keep decrementing it
    remaining = Math.round((+b.massLeftSet - (consumed - (b.massLeftSetAt || 0))) * 10) / 10;
  } else {
    remaining = mass != null ? Math.round((mass - consumed) * 10) / 10 : null;
  }
  const finished = !!b.finished || (remaining != null && remaining <= 0);
  return { consumed: Math.round(consumed * 10) / 10, remaining, finished, mass };
}
function beansSorted() {
  return [...beans].sort((a, b) => {
    const la = beanLastBrew(a.id), lb = beanLastBrew(b.id);
    if (!la && !lb) return beanLabel(a).localeCompare(beanLabel(b));
    if (!la) return -1;             // unbrewed (newest) first
    if (!lb) return 1;
    if (la !== lb) return lb.localeCompare(la);
    return beanLabel(a).localeCompare(beanLabel(b));
  });
}
function optionPool(settingsKey, field, isArray) {
  const pool = new Set(settings[settingsKey] || []);
  beans.forEach((b) => {
    const v = b[field];
    if (!v) return;
    if (isArray) varList(v).forEach((x) => x && pool.add(x));
    else pool.add(String(v).trim());
  });
  return [...pool].sort((a, b) => a.localeCompare(b));
}
/* Per-value usage stats for a bean field: how many packs use it + avg rating. */
function usageStats(field, isArray) {
  const stats = new Map();
  const ensure = (k) => { if (!stats.has(k)) stats.set(k, { count: 0, rs: 0, rn: 0 }); return stats.get(k); };
  beans.forEach((b) => {
    const r = beanOverall(b);
    const vals = isArray ? varList(b[field]) : (b[field] ? [String(b[field]).trim()] : []);
    vals.forEach((val) => { const o = ensure(val); o.count += 1; if (r != null) { o.rs += r; o.rn += 1; } });
  });
  return stats;
}
/* Sort values by pack frequency desc, then avg rating desc, then alphabetical. */
function rankedSort(values, field, isArray) {
  const stats = usageStats(field, isArray);
  const rank = (k) => { const o = stats.get(k); return { count: o ? o.count : 0, avg: (o && o.rn) ? o.rs / o.rn : -1 }; };
  return [...values].sort((a, b) => {
    const A = rank(a), B = rank(b);
    if (B.count !== A.count) return B.count - A.count;
    if (B.avg !== A.avg) return B.avg - A.avg;
    return a.localeCompare(b);
  });
}
/* Like optionPool but ordered by usage (for record dropdowns + management lists). */
function optionPoolRanked(settingsKey, field, isArray) {
  const pool = new Set(settings[settingsKey] || []);
  beans.forEach((b) => {
    const v = b[field];
    if (!v) return;
    if (isArray) varList(v).forEach((x) => x && pool.add(x));
    else pool.add(String(v).trim());
  });
  return rankedSort([...pool], field, isArray);
}
// Which managed lists rank by usage, and their bean field + array-ness.
const RANKED_LISTS = {
  roasters: ['roaster', false],
  countries: ['originCountry', false],
  varietals: ['varietal', true],
};
// Processes use a fixed progression, not usage ranking. Anything not listed
// (e.g. later additions) falls to the end, alphabetically, with Other last.
const PROCESS_ORDER = ['Washed', 'Honey', 'Natural', 'Anaerobic washed', 'Anaerobic honey',
  'Anaerobic natural', 'Wet hulling', 'Other'];
function orderByProcess(values) {
  const idx = (v) => { const i = PROCESS_ORDER.indexOf(v); return i === -1 ? PROCESS_ORDER.length : i; };
  return [...values].sort((a, b) => { const d = idx(a) - idx(b); return d !== 0 ? d : a.localeCompare(b); });
}
// Pool of process options (settings list + any used on beans), in fixed order.
function processPool() {
  const pool = new Set(settings.processes || []);
  beans.forEach((b) => { if (b.process) pool.add(String(b.process).trim()); });
  return orderByProcess([...pool]);
}

/* =========================================================================
 * RENDER — brews (paginated)
 * ========================================================================= */
function renderBrews() {
  const el = $('#brewList');
  if (!brews.length) {
    el.innerHTML = emptyState('No brews yet', 'Tap “+ New brew” after your next cup.');
    return;
  }
  const sorted = [...brews].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const pages = Math.max(1, Math.ceil(sorted.length / BREW_PAGE));
  brewsPage = Math.min(brewsPage, pages - 1);
  const slice = sorted.slice(brewsPage * BREW_PAGE, (brewsPage + 1) * BREW_PAGE);
  el.innerHTML = slice.map(brewCard).join('') + pager('brews', brewsPage, pages, sorted.length);
}
function brewCard(x) {
  const bean = beans.find((b) => b.id === x.beanId);
  const total = x.waterMass || (x.tech && x.tech.totalWater) || null;
  const ratio = x.dose && total ? `1:${(total / x.dose).toFixed(1)}` : null;
  const meta = [
    x.dose ? `${x.dose} g` : null, total ? `${total} g water` : null, ratio,
    x.waterTemp ? `${x.waterTemp}°C` : null, x.technique || null, x.device || null,
  ].filter(Boolean);
  return `
    <div class="card" data-edit="brews" data-id="${x.id}">
      <div class="row1">
        <div>
          <div class="title">${esc(beanLabel(bean))}</div>
          <div class="sub">${esc(x.date || '')}${x.grind != null ? ` · grind ${esc(x.grind)}` : ''}${x.grinder ? ` · ${esc(x.grinder)}` : ''}</div>
        </div>
        ${starStr(x.rating, true)}
      </div>
      <div class="meta">${meta.map((m) => `<span class="pill">${esc(m)}</span>`).join('')}</div>
      ${x.flavorNotes ? `<div class="sub" style="margin-top:8px">“${esc(x.flavorNotes)}”</div>` : ''}
    </div>`;
}

/* ---------- RENDER — beans (paginated) ---------- */
function renderBeans() {
  const el = $('#beanList');
  if (!beans.length) {
    el.innerHTML = emptyState('No beans yet', 'Add a bag of beans, then log brews against it.');
    return;
  }
  const sorted = beansSorted();
  const pages = Math.max(1, Math.ceil(sorted.length / BEAN_PAGE));
  beansPage = Math.min(beansPage, pages - 1);
  const slice = sorted.slice(beansPage * BEAN_PAGE, (beansPage + 1) * BEAN_PAGE);
  el.innerHTML = slice.map(beanCard).join('') + pager('beans', beansPage, pages, sorted.length);
}
function beanCard(b) {
  const overall = beanOverall(b);
  const n = beanBrewCount(b.id);
  const c = beanConsumption(b);
  const status = c.finished
    ? `<span class="tag-done">Finished</span>`
    : (c.remaining != null ? `<span class="pill strong">${c.remaining} g left</span>` : '');
  const meta = [b.originCountry, b.originRegion, b.process, ...varList(b.varietal), b.roastLevel].filter(Boolean);
  return `
    <div class="card bean-card" data-detail="${b.id}">
      <div class="bean-top">
        <div class="title">${esc(beanLabel(b))}</div>
        <div class="bean-rating">${starStr(overall, true)}</div>
      </div>
      <div class="sub">${n} brew${n === 1 ? '' : 's'} ${status}</div>
      <div class="meta">${meta.map((m) => `<span class="pill">${esc(m)}</span>`).join('')}</div>
      ${b.flavour ? `<div class="sub" style="margin-top:6px">${esc(b.flavour)}</div>` : ''}
    </div>`;
}
function pager(kind, page, pages, total) {
  if (pages <= 1) return `<div class="pager"><span>${total} total</span></div>`;
  return `<div class="pager">
    <button data-page="${kind}:prev" ${page === 0 ? 'disabled' : ''}>‹ Prev</button>
    <span class="pager-mid">Page
      <input class="pager-input" type="number" inputmode="numeric" min="1" max="${pages}"
        value="${page + 1}" data-goto="${kind}" aria-label="Go to page" />
      / ${pages} · ${total}</span>
    <button data-page="${kind}:next" ${page >= pages - 1 ? 'disabled' : ''}>Next ›</button>
  </div>`;
}
function gotoPage(kind, rawVal, rawMax) {
  const max = Math.max(1, parseInt(rawMax, 10) || 1);
  let p = parseInt(rawVal, 10);
  if (!Number.isFinite(p)) return;
  p = Math.min(max, Math.max(1, p)) - 1;   // clamp to range, 0-indexed
  if (kind === 'brews') { brewsPage = p; renderBrews(); }
  else { beansPage = p; renderBeans(); }
}
function emptyState(t, s) {
  return `<div class="empty"><p style="font-size:34px">🌸</p><p><strong>${esc(t)}</strong></p><p>${esc(s)}</p></div>`;
}

/* =========================================================================
 * BEAN DETAIL (overview + links to brews)
 * ========================================================================= */
function beanDetail(b) {
  editing = { store: null, record: null };
  detailBeanId = b.id;
  const overall = beanOverall(b);
  const c = beanConsumption(b);
  const bb = brews.filter((x) => x.beanId === b.id).sort((a, b2) => (b2.date || '').localeCompare(a.date || ''));
  const info = [
    ['Origin', [b.originCountry, b.originRegion].filter(Boolean).join(' · ')],
    ['Producer', b.producer], ['Lot', b.lot],
    ['Varietal', varList(b.varietal).join(', ')],
    ['Process', b.process], ['Roast', b.roastLevel],
    ['Roast date', b.roastDate], ['Price', money(b.price)],
    ['Bag', c.mass != null ? `${c.mass} g` : ''],
    ['Status', c.finished ? 'Finished' : (c.remaining != null ? `${c.remaining} g left (${c.consumed} g used)` : '')],
  ].filter(([, v]) => v);

  $('#modalForm').innerHTML = `
    <div class="detail-rating">${starStr(overall, true)}</div>
    ${b.flavour ? `<div class="detail-flavour">${esc(b.flavour)}</div>` : ''}
    <div class="detail-grid">
      ${info.map(([k, v]) => `<div><span class="dk">${esc(k)}</span><span class="dv">${esc(v)}</span></div>`).join('')}
    </div>
    ${b.notes ? `<div class="field-hint" style="margin-top:6px">${esc(b.notes)}</div>` : ''}
    <button type="button" class="ghost detail-edit" data-editbean="${b.id}">✎ Edit bean</button>
    <div class="section-label">Brews · ${bb.length}</div>
    <div class="minilist">
      ${bb.length ? bb.map(brewMiniRow).join('') : '<div class="field-hint">No brews logged for this bag yet.</div>'}
    </div>`;
  $('#deleteBtn').hidden = true;
  $('.modal-foot .primary').style.display = 'none';
  $('#modalForm').onsubmit = (e) => e.preventDefault();
  openModal(beanLabel(b));
}
function brewMiniRow(x) {
  const total = x.waterMass || (x.tech && x.tech.totalWater) || null;
  const ratio = x.dose && total ? `1:${(total / x.dose).toFixed(1)}` : '';
  const sub = [
    x.grind != null ? `grind ${x.grind}` : null,
    x.waterTemp ? `${x.waterTemp}°C` : null,
    x.device || null, ratio,
  ].filter(Boolean).join(' · ');
  return `<div class="minirow" data-mini="${x.id}">
    <div class="mr-l">
      <div class="mr-top"><span class="mr-date">${esc(x.date || '')}</span><span class="mr-tech">${esc(x.technique || '')}</span></div>
      <div class="mr-sub">${esc(sub)}</div>
    </div>
    <div class="mr-r">${x.rating ? starStr(x.rating) : '<span class="mr-unrated">—</span>'}<span class="mr-go">›</span></div>
  </div>`;
}

/* =========================================================================
 * RENDER — stats
 * ========================================================================= */
function renderStats() {
  const el = $('#statsBody');
  if (!brews.length) {
    el.innerHTML = emptyState('No statistics yet', 'Log a few brews and insights will appear here.');
    return;
  }
  const now = new Date();

  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d.toISOString().slice(0, 7));
  }
  const perMonth = months.map((m) => ({ label: monthLabel(m), value: brews.filter((x) => (x.date || '').startsWith(m)).length }));

  // pie charts count packs of beans (not brews)
  // Ordered by the fixed process progression so pieBlock's stable value-desc
  // sort breaks pack-count ties by that order (e.g. wet hulling falls last).
  const pIdx = (l) => { const i = PROCESS_ORDER.indexOf(l); return i === -1 ? PROCESS_ORDER.length : i; };
  const beanProcessCounts = countBy(beans.map((b) => b.process)).sort((a, b) => pIdx(a.label) - pIdx(b.label));
  const beanRoasterCounts = countBy(beans.map((b) => b.roaster));
  const beanCountryCounts = countBy(beans.map((b) => b.originCountry));
  const beanVarietalCounts = countBy(beans.flatMap((b) => varList(b.varietal)));
  const techniqueCounts = countBy(brews.map((x) => x.technique));
  const deviceCounts = countBy(brews.map((x) => x.device));

  const processRatings = avgByBeans('process')
    .sort((a, b) => b.avg - a.avg)
    .map((p) => ({ label: p.label, value: +p.avg.toFixed(1) }));

  // stock + price
  const active = beans.filter((b) => !beanConsumption(b).finished);
  const stockG = Math.round(active.reduce((s, b) => { const r = beanConsumption(b).remaining; return s + (r && r > 0 ? r : 0); }, 0));
  const priced = beans.filter((b) => b.price != null);
  const totalSpend = priced.reduce((s, b) => s + b.price, 0);
  // total labelled mass across ALL packs (including unpriced ones)
  const totalMassAll = beans.reduce((s, b) => s + (b.mass || 0), 0);
  // avg per gram = total money spent / total labelled mass of all beans.
  // Unpriced beans add mass but no spend, so this reads a bit low — by design.
  const perGram = totalMassAll ? totalSpend / totalMassAll : null;
  // consumed = total labelled mass − what's still in stock (more reliable than
  // summing brew doses, since some brews weren't logged)
  const consumedTotal = Math.max(0, Math.round(totalMassAll - stockG));

  const beanScores = beans.map((b) => ({ label: beanLabel(b), avg: beanOverall(b) }))
    .filter((b) => b.avg != null).sort((a, b) => b.avg - a.avg).slice(0, 8);

  el.innerHTML = `
    <div class="stat-cards">
      <div class="stat"><div class="num">${stockG} g</div><div class="lbl">coffee in stock</div></div>
      <div class="stat"><div class="num">${active.length}</div><div class="lbl">packs open</div></div>
      <div class="stat"><div class="num">${consumedTotal} g</div><div class="lbl">beans consumed</div></div>
      <div class="stat"><div class="num">${brews.length}</div><div class="lbl">total brews</div></div>
      <div class="stat"><div class="num">${money(Math.round(totalSpend))}</div><div class="lbl">total spent</div></div>
      <div class="stat"><div class="num">${perGram != null ? '¥' + perGram.toFixed(2) : '—'}</div><div class="lbl">average per gram</div></div>
    </div>

    ${pieBlock('Process mix (by packs)', beanProcessCounts, PROCESS_COLORS)}
    ${pieBlock('Roaster mix (by packs)', beanRoasterCounts)}
    ${pieBlock('Country mix (by packs)', groupSmall(beanCountryCounts, 3))}
    ${(() => { const vr = beanVarietalCounts.filter((r) => r.value >= 3).sort((a, b) => b.value - a.value); return vr.length ? barBlock('Varietal mix (by packs, ≥3)', vr) : ''; })()}
    ${processRatings.length ? barBlock('Average rating by process', processRatings, 5) : ''}
    ${barBlock('Cups per month', perMonth)}
    ${techniqueCounts.length ? barBlock('Brews by technique', techniqueCounts.sort((a, b) => b.value - a.value)) : ''}
    ${deviceCounts.length ? barBlock('Brews by device', deviceCounts.sort((a, b) => b.value - a.value)) : ''}
    ${beanScores.length ? barBlock('Top beans (rating)', beanScores.map((b) => ({ label: b.label, value: +b.avg.toFixed(1) })), 5) : ''}
  `;
}
function beanField(brew, field) { const b = beans.find((z) => z.id === brew.beanId); return b && b[field] ? b[field] : null; }
function barBlock(title, rows, max) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.value));
  const body = rows.map((r) => `
    <div class="bar-row"><div class="bl" title="${esc(r.label)}">${esc(r.label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.round((r.value / m) * 100)}%"></div></div>
      <div class="bv">${r.value}</div></div>`).join('');
  return `<div class="chart-block"><h4>${esc(title)}</h4>${body}</div>`;
}
/* Process colours — earthy tones that sit with the coffee/brown theme, still
 * hinting at cup character:
 *   Washed          → fresh green (clean, floral clarity)
 *   Anaerobic washed→ jade green (even more clarity / exotic)
 *   Natural         → terracotta red (fruity, jammy)
 *   Anaerobic natural→ wine plum (fermented / boozy / winey)
 *   Honey / Anaerobic honey → honeyed amber & rust
 *   Carbonic maceration → dusty rose-berry (winey, fruity-funky)
 *   Wet hulling     → moss green (earthy/herbal);  Other → warm taupe */
const PROCESS_COLORS = {
  'Washed': '#6f9e6a',
  'Anaerobic washed': '#4f9e86',
  'Natural': '#c15a3c',
  'Anaerobic natural': '#8a4a63',
  'Honey': '#d99a3c',
  'Anaerobic honey': '#c2703a',
  'Wet hulling': '#6d7a45',
  'Other': '#a08c72',
};
// Warm, brown-friendly palette for the non-process pies (roaster, country).
// Deliberately starts on terracotta (not green) and leans on browns/ambers so
// it sits with the coffee theme. A couple more brown tones than the process set.
const PIE_PALETTE = ['#c15a3c', '#d9a441', '#8a5a3c', '#a85072', '#b3742e', '#6f7d43', '#7d5240', '#8f8a52', '#a08c72', '#5e4632'];
function pieColor(label, i, colorMap) {
  if (colorMap && colorMap[label]) return colorMap[label];
  return PIE_PALETTE[i % PIE_PALETTE.length];
}
const isOtherLabel = (l) => l === 'Other' || l === 'Others';
function pieBlock(title, rows, colorMap) {
  // Stable value-desc sort: any pre-existing tiebreak order in `rows` is kept.
  rows = rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  if (!rows.length) return '';
  if (rows.length > 8) { const rest = rows.slice(7).reduce((s, r) => s + r.value, 0); rows = rows.slice(0, 7).concat([{ label: 'Other', value: rest }]); }
  // Always park an "Other(s)" bucket at the end, even if it outweighs some slices.
  rows = rows.sort((a, b) => (isOtherLabel(a.label) ? 1 : 0) - (isOtherLabel(b.label) ? 1 : 0));
  const total = rows.reduce((s, r) => s + r.value, 0) || 1;
  let acc = 0;
  const stops = rows.map((r, i) => { const a = acc / total * 360; acc += r.value; const b = acc / total * 360; return `${pieColor(r.label, i, colorMap)} ${a}deg ${b}deg`; }).join(', ');
  const legend = rows.map((r, i) => `<div class="leg"><span class="sw" style="background:${pieColor(r.label, i, colorMap)}"></span>${esc(r.label)} <b>${r.value}</b></div>`).join('');
  return `<div class="chart-block"><h4>${esc(title)}</h4><div class="pie-wrap"><div class="pie" style="background:conic-gradient(${stops})"></div><div class="legend">${legend}</div></div></div>`;
}
function countBy(arr) { const m = new Map(); arr.filter(Boolean).forEach((k) => m.set(k, (m.get(k) || 0) + 1)); return [...m.entries()].map(([label, value]) => ({ label, value })); }
// Roll rows with value < min into a single "Others" slice.
function groupSmall(rows, min) {
  const big = rows.filter((r) => r.value >= min);
  const rest = rows.filter((r) => r.value < min).reduce((s, r) => s + r.value, 0);
  return rest > 0 ? big.concat([{ label: 'Others', value: rest }]) : big;
}
function avgByBeans(field) {
  const m = new Map();
  beans.forEach((b) => { const k = b[field], r = beanOverall(b); if (!k || r == null) return; if (!m.has(k)) m.set(k, { s: 0, n: 0 }); const o = m.get(k); o.s += r; o.n += 1; });
  return [...m.entries()].map(([label, o]) => ({ label, avg: o.s / o.n, n: o.n }));
}
function topEntry(rows, f) { return rows.length ? [...rows].sort((a, b) => b[f] - a[f])[0] : null; }
function monthLabel(ym) { const [y, m] = ym.split('-'); return new Date(+y, +m - 1, 1).toLocaleString('en', { month: 'short' }); }

/* =========================================================================
 * MODAL + FORM PLUMBING
 * ========================================================================= */
function openModal(title) { $('#modalTitle').textContent = title; $('#modal').hidden = false; $('.modal-card').scrollTop = 0; }
function closeModal() {
  $('#modal').hidden = true;
  $('#modalForm').innerHTML = '';
  $('#modalForm').onsubmit = null;
  $('#deleteBtn').hidden = true;
  $('.modal-foot .primary').style.display = '';
  editing = { store: null, record: null };
  returnBeanId = null; detailBeanId = null;
}
/* Close a form; if it was opened from a bean detail, go back there (refreshed). */
function closeOrBack() {
  if (returnBeanId) {
    const b = beans.find((x) => x.id === returnBeanId);
    returnBeanId = null;
    if (b) return beanDetail(b);
  }
  closeModal();
}
function field(label, inner, hint) {
  return `<div><label>${esc(label)}</label>${inner}${hint ? `<div class="field-hint">${esc(hint)}</div>` : ''}</div>`;
}
function textInput(name, val = '', ph = '', type = 'text', extra = '') {
  return `<input name="${name}" type="${type}" value="${esc(val)}" placeholder="${esc(ph)}" ${extra} />`;
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
  const consHint = c && c.remaining != null ? `${c.consumed} g used · ${c.remaining} g left of ${c.mass} g`
    : 'Enter bag mass (g) below to track how much is left.';
  const selectedVar = varList(rec.varietal);

  $('#modalForm').innerHTML = `
    <div class="grid2">
      ${field('Roaster', selectInput('roaster', optionPoolRanked('roasters', 'roaster', false), rec.roaster || ''))}
      ${field('Origin country', selectInput('originCountry', optionPoolRanked('countries', 'originCountry', false), rec.originCountry || ''))}
    </div>
    <div class="grid2">
      ${field('Region / area', textInput('originRegion', rec.originRegion, 'e.g. Sidama Bensa'))}
      ${field('Producer / farm', textInput('producer', rec.producer, 'e.g. Shantawene'))}
    </div>
    ${field('Lot', textInput('lot', rec.lot, 'e.g. Alto Quiel'))}

    <div class="section-label">Varietals</div>
    <div class="msel-chips" id="vchips">${selectedVar.map(varChip).join('')}</div>
    <div class="add-row"><select data-vadd><option value="">+ add varietal…</option>${optionPoolRanked('varietals', 'varietal', true).filter((v) => !selectedVar.includes(v)).map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}</select></div>
    <div class="field-hint">Add or rename options centrally in ⋮ → Equipment &amp; options.</div>

    <div class="grid2">
      ${field('Roast level', selectInput('roastLevel', ROAST_LEVELS, rec.roastLevel))}
      ${field('Process', selectInput('process', processPool(), rec.process))}
    </div>
    <div class="grid2">
      ${field('Mass (g)', textInput('mass', rec.mass, '250', 'number'))}
      ${field('Price (¥ CNY)', textInput('price', rec.price, '0.00', 'number', 'step="0.01" inputmode="decimal"'))}
    </div>
    ${field('Mass left (g)', textInput('massLeft', c ? (c.remaining ?? '') : '', 'auto from brews', 'number'), 'Defaults to total − brews used. Type to correct it; clear to reset to auto.')}
    ${field('Roast date', textInput('roastDate', rec.roastDate, '', 'date'))}

    <div class="section-label">Rating &amp; notes</div>
    ${field('Overall rating', ratingWidget(rec.rating || 0))}
    ${field('Tasting notes (flavour)', `<textarea name="flavour" placeholder="Jasmine, peach, black tea...">${esc(rec.flavour || '')}</textarea>`)}
    ${field('Consumption', `<label class="check"><input type="checkbox" name="finished" ${rec.finished ? 'checked' : ''}/> Mark this bag finished</label>`, consHint)}
    ${field('Notes', `<textarea name="notes" placeholder="Anything else about the bag...">${esc(rec.notes || '')}</textarea>`)}
  `;
  $('#deleteBtn').hidden = !rec.id;
  $('.modal-foot .primary').style.display = '';
  openModal(rec.id ? 'Edit bean' : 'New bean');
}
function varChip(v) { return `<span class="chip" data-vchip="${esc(v)}">${esc(v)}<button type="button" data-vdel="${esc(v)}">✕</button></span>`; }

/* ---------- BREW form ---------- */
function brewForm(rec = {}) {
  editing = { store: 'brews', record: rec };
  const d = settings.defaults || {};
  const cur = {
    grinder: rec.grinder ?? d.grinder ?? '', device: rec.device ?? d.device ?? '',
    paper: rec.paper ?? d.paper ?? '', dose: rec.dose ?? d.dose ?? '',
    waterTemp: rec.waterTemp ?? d.waterTemp ?? '', technique: rec.technique ?? d.technique ?? TECH_KEYS[0],
  };
  // bean dropdown: same order as the beans list, excluding finished bags
  const pickable = beansSorted().filter((b) => rec.beanId === b.id || !beanConsumption(b).finished);
  const beanOpts = beans.length
    ? `<select name="beanId"><option value="">— select a bean —</option>${pickable
        .map((b) => `<option value="${b.id}"${b.id === rec.beanId ? ' selected' : ''}>${esc(beanLabel(b))}</option>`).join('')}</select>`
    : `<div class="field-hint">Add a bean first (Beans tab).</div>`;

  const sliders = TASTE_AXES.map(([key, lbl, hint]) => {
    const v = rec[key] ?? 0;
    return field(lbl, `<div class="slider-row"><input type="range" name="${key}" min="0" max="5" step="1" value="${v}" oninput="this.nextElementSibling.textContent=this.value" /><span class="val">${v}</span></div>`, hint);
  }).join('');

  $('#modalForm').innerHTML = `
    ${returnBeanId ? '<button type="button" class="backbtn" data-backbean>‹ Back to bean</button>' : ''}
    ${field('Date', textInput('date', rec.date || todayISO(), '', 'date'))}
    ${field('Bean', beanOpts)}

    <div class="section-label">Recipe</div>
    <div class="grid2">
      ${field('Grinder', selectInput('grinder', settings.grinders, cur.grinder))}
      ${field('Grind', textInput('grind', rec.grind, '8.5', 'number', 'step="any" inputmode="decimal"'))}
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
    ${field('Flavour notes', `<textarea name="flavorNotes" placeholder="Blueberry, jasmine, clean finish...">${esc(rec.flavorNotes || '')}</textarea>`)}
    ${field('Brew notes', `<textarea name="notes" placeholder="What to change next time...">${esc(rec.notes || '')}</textarea>`)}
  `;
  renderTechFields(cur.technique, rec.tech || {});
  $('select[name=technique]').addEventListener('change', (e) => renderTechFields(techFromDisplay(e.target.value), {}));
  $('#deleteBtn').hidden = !rec.id;
  $('.modal-foot .primary').style.display = '';
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
    else if (type === 'time') inp = `<input name="tech_${k}" class="timefield" type="text" inputmode="numeric" value="${esc(v)}" placeholder="m:ss" />`;
    else inp = `<input name="tech_${k}" type="text" value="${esc(v)}" />`;
    return field(lbl, inp);
  }).join('') + `</div>`;
}
function ratingWidget(val) {
  val = +val || 0;
  let stars = '';
  for (let i = 1; i <= 5; i++) {
    const cls = val >= i ? 'full' : (val >= i - 0.5 ? 'half' : '');
    stars += `<span class="rstar ${cls}"><button type="button" class="rh rl" data-val="${i - 0.5}"></button><button type="button" class="rh rr" data-val="${i}"></button></span>`;
  }
  return `<div class="rating2" data-rating>${stars}<button type="button" class="rclear" data-val="0">clear</button></div><input type="hidden" name="rating" value="${val}" />`;
}
function paintRating(box, v) {
  [...box.querySelectorAll('.rstar')].forEach((st, idx) => { const i = idx + 1; st.classList.toggle('full', v >= i); st.classList.toggle('half', v < i && v >= i - 0.5); });
}

/* ---------- SAVE ---------- */
async function saveForm(e) {
  e.preventDefault();
  if (!editing.store) return;
  const fd = new FormData($('#modalForm'));
  const store = editing.store;
  const rec = { ...editing.record };

  if (store === 'beans') {
    const varietals = $$('#vchips .chip').map((c) => c.dataset.vchip);
    // manual "mass left" override: keep it only if it differs from the auto value
    const consumedNow = editing.record?.id ? beanConsumption(editing.record).consumed : 0;
    const newMass = num(fd.get('mass'));
    const autoRem = newMass != null ? Math.round((newMass - consumedNow) * 10) / 10 : null;
    const enteredLeft = num(fd.get('massLeft'));
    let massLeftSet = null, massLeftSetAt = null;
    if (enteredLeft != null && !(autoRem != null && Math.abs(enteredLeft - autoRem) < 0.05)) {
      massLeftSet = enteredLeft; massLeftSetAt = consumedNow;
    }
    Object.assign(rec, {
      roaster: fd.get('roaster') || '', originCountry: fd.get('originCountry') || '',
      originRegion: fd.get('originRegion')?.trim() || '', producer: fd.get('producer')?.trim() || '',
      lot: fd.get('lot')?.trim() || '', varietal: varietals,
      roastLevel: fd.get('roastLevel') || '', process: fd.get('process') || '',
      mass: newMass, price: num(fd.get('price')),
      massLeftSet, massLeftSetAt,
      roastDate: fd.get('roastDate')?.trim() || '', flavour: fd.get('flavour')?.trim() || '',
      rating: num(fd.get('rating')) || null, finished: fd.get('finished') === 'on',
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
      date: fd.get('date') || todayISO(), beanId: fd.get('beanId'),
      grinder: fd.get('grinder') || '', grind: num(fd.get('grind')),
      dose: num(fd.get('dose')), waterTemp: num(fd.get('waterTemp')),
      device: fd.get('device') || '', paper: fd.get('paper') || '',
      technique, tech, waterMass: tech.totalWater ?? null,
      rating: num(fd.get('rating')) || 0, flavorNotes: fd.get('flavorNotes')?.trim() || '',
      notes: fd.get('notes')?.trim() || '',
    });
    for (const [k] of TASTE_AXES) rec[k] = num(fd.get(k)) || 0;
  }
  await put(store, rec);
  await reload();
  closeOrBack();
  toast('Saved ☕');
}
async function deleteCurrent() {
  const { store, record } = editing;
  if (!record?.id) return;
  if (!confirm('Delete this entry? This cannot be undone.')) return;
  if (store === 'beans') returnBeanId = null; // bean gone, nowhere to return
  await remove(store, record.id);
  await reload(); closeOrBack(); toast('Deleted');
}

/* =========================================================================
 * MENU + SETTINGS
 * ========================================================================= */
function openMenu() {
  editing = { store: null, record: null };
  const u = currentUser();
  const authRow = u
    ? `<button type="button" data-menu="signout">Cloud sync · on
        <span class="desc">Signed in as ${esc(u.email || 'your account')}. Beans &amp; brews sync across your devices. Tap to sign out.</span></button>`
    : `<button type="button" data-menu="signin">Sign in to sync (Google)
        <span class="desc">Sync your beans &amp; brews across your iPhone and laptop.</span></button>`;
  $('#modalForm').innerHTML = `
    <div class="menu-list">
      ${authRow}
      <button type="button" data-menu="settings">Equipment &amp; option lists
        <span class="desc">Edit grinders, devices, papers, roasters, countries, varietals, and defaults.</span></button>
      <button type="button" data-menu="export">Export backup (.json)
        <span class="desc">Save all data to a file.</span></button>
      <button type="button" data-menu="import">Import backup (.json)
        <span class="desc">Merge a backup or converted Notion file.</span></button>
      <button type="button" data-menu="erase" class="menu-danger">Erase all data
        <span class="desc">Delete every bean, brew &amp; setting on this device. Cannot be undone.</span></button>
    </div>`;
  $('#deleteBtn').hidden = true;
  $('#modalForm').onsubmit = (e) => e.preventDefault();
  $('.modal-foot .primary').style.display = 'none';
  openModal('Menu');
}
function settingsForm() {
  const d = settings.defaults || {};
  const listEditor = (kind, label) => {
    const raw = settings[kind] || [];
    const vals = kind === 'processes' ? orderByProcess(raw)
      : (RANKED_LISTS[kind] ? rankedSort(raw, RANKED_LISTS[kind][0], RANKED_LISTS[kind][1]) : raw);
    return `
    <div class="section-label">${label}</div>
    <div class="chips" data-list="${kind}">${vals.map((v) => `<span class="chip">${esc(v)}<button type="button" data-del-chip="${esc(v)}" data-kind="${kind}">✕</button></span>`).join('')}</div>
    <div class="add-row"><input type="text" data-add-input="${kind}" placeholder="Add ${label.toLowerCase().replace(/s$/, '')}..." /><button type="button" class="ghost" data-add-btn="${kind}">Add</button></div>`;
  };
  $('#modalForm').innerHTML = `
    ${listEditor('grinders', 'Grinders')}
    ${listEditor('devices', 'Devices')}
    ${listEditor('papers', 'Filter papers')}
    ${listEditor('roasters', 'Roasters')}
    ${listEditor('countries', 'Countries')}
    ${listEditor('varietals', 'Varietals')}
    ${listEditor('processes', 'Processes')}
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
    </div>`;
  $('#modalForm').onsubmit = (e) => { e.preventDefault(); saveSettingsForm(); };
  $('.modal-foot .primary').style.display = '';
  $('#deleteBtn').hidden = true;
  editing = { store: 'settings', record: null };
  openModal('Equipment & options');
}
async function saveSettingsForm() {
  const fd = new FormData($('#modalForm'));
  settings.defaults = {
    grinder: fd.get('d_grinder') || '', device: fd.get('d_device') || '', paper: fd.get('d_paper') || '',
    technique: fd.get('d_technique') || '', dose: num(fd.get('d_dose')), waterTemp: num(fd.get('d_waterTemp')),
  };
  await commitSettings(settings);
  closeModal(); toast('Settings saved');
}
function handleSettingsClick(e) {
  const del = e.target.closest('[data-del-chip]');
  if (del) { const k = del.dataset.kind; settings[k] = settings[k].filter((x) => x !== del.dataset.delChip); settingsForm(); return true; }
  const add = e.target.closest('[data-add-btn]');
  if (add) { const k = add.dataset.addBtn; const inp = $(`[data-add-input="${k}"]`); const v = inp.value.trim(); if (v && !settings[k].includes(v)) settings[k].push(v); settingsForm(); return true; }
  return false;
}

/* ---------- Cloud sync ---------- */
async function doSignIn() {
  try {
    toast('Opening Google sign-in…');
    await signInGoogle();
    // On success onAuthStateChanged runs the initial sync + re-render.
    // (On mobile this may redirect away and return signed in.)
    toast('Signed in — syncing ☁️');
    closeModal();
  } catch (err) {
    toast(err?.message || 'Sign-in failed');
  }
}
async function doSignOut() {
  try {
    await signOutUser();
    toast('Signed out. Data stays on this device.');
    closeModal();
  } catch (err) {
    toast(err?.message || 'Sign-out failed');
  }
}

/* ---------- Backup / restore ---------- */
async function doExport() {
  const data = await exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `bloom-backup-${todayISO()}.json`; a.click();
  URL.revokeObjectURL(a.href); toast('Backup downloaded');
}
function doImport() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'application/json,.json';
  inp.onchange = async () => {
    const file = inp.files[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const res = await importAll(data, 'merge');
      settings = await getSettings();
      // Imported records are written raw, so push them up if signed in.
      if (currentUser()) { try { await resync(); } catch (e) { /* best-effort */ } }
      await reload(); closeModal();
      toast(`Imported ${res.beans} beans, ${res.brews} brews`);
    } catch (err) { toast(err.message || 'Import failed'); }
  };
  inp.click();
}
async function eraseAll() {
  if (!confirm('Erase ALL data on this device — every bean, brew and setting?\n\nThis cannot be undone. (You can re-import a backup afterwards.)')) return;
  if (!confirm('Are you absolutely sure? This wipes everything.')) return;
  // If synced, wipe the cloud copy first so it doesn't just download again.
  if (currentUser()) { try { await wipeRemote(); } catch (e) { /* best-effort */ } }
  await clearAll();
  settings = await getSettings();   // back to seeded defaults
  await saveSettings(settings);
  brewsPage = 0; beansPage = 0;
  await reload();
  closeModal();
  toast('All data erased');
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
  renderBrews(); renderBeans();
  if ($('#view-stats').classList.contains('active')) renderStats();
}
function fmtTimeField(el) {
  const digits = el.value.replace(/\D/g, '').slice(0, 3);
  el.value = digits.length <= 1 ? digits : digits[0] + ':' + digits.slice(1);
}
function wireEvents() {
  $$('.tab').forEach((t) => t.addEventListener('click', () => switchView(t.dataset.view)));
  $('#menuBtn').addEventListener('click', openMenu);

  // Bloom logo = home: jump to Brews, page 1
  const goHome = () => { brewsPage = 0; switchView('brews'); renderBrews(); document.scrollingElement?.scrollTo(0, 0); };
  $('#homeBtn').addEventListener('click', goHome);
  $('#homeBtn').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goHome(); } });

  // auto-colon in time fields
  document.addEventListener('input', (e) => { if (e.target.classList && e.target.classList.contains('timefield')) fmtTimeField(e.target); });

  // varietal "add existing" select + pager "go to page" input
  document.addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-vadd]');
    if (sel && sel.value) {
      const v = sel.value;
      if (!$$('#vchips .chip').some((c) => c.dataset.vchip === v)) $('#vchips').insertAdjacentHTML('beforeend', varChip(v));
      sel.querySelector(`option[value="${CSS.escape(v)}"]`)?.remove();
      sel.value = '';
      return;
    }
    const goto = e.target.closest('.pager-input[data-goto]');
    if (goto) gotoPage(goto.dataset.goto, goto.value, goto.max);
  });
  // Enter also jumps (without waiting for blur)
  document.addEventListener('keydown', (e) => {
    const goto = e.target.closest('.pager-input[data-goto]');
    if (goto && e.key === 'Enter') { e.preventDefault(); gotoPage(goto.dataset.goto, goto.value, goto.max); }
  });

  document.addEventListener('click', (e) => {
    if (handleSettingsClick(e)) return;

    const act = e.target.closest('[data-action]')?.dataset.action;
    if (act === 'new-brew') { returnBeanId = null; return brewForm(); }
    if (act === 'new-bean') { returnBeanId = null; return beanForm(); }
    if (act === 'close-modal') return closeOrBack();

    // back from a form to the bean detail it was opened from
    if (e.target.closest('[data-backbean]')) {
      const b = beans.find((x) => x.id === returnBeanId); returnBeanId = null;
      return b ? beanDetail(b) : closeModal();
    }

    // pagination
    const pg = e.target.closest('[data-page]');
    if (pg) {
      const [kind, dir] = pg.dataset.page.split(':');
      if (kind === 'brews') { brewsPage += dir === 'next' ? 1 : -1; renderBrews(); }
      else { beansPage += dir === 'next' ? 1 : -1; renderBeans(); }
      return;
    }

    // brew mini-row inside a bean detail -> open brew, remember the bean to return to
    const mini = e.target.closest('[data-mini]');
    if (mini) { const rec = brews.find((r) => r.id === mini.dataset.mini); if (rec) { returnBeanId = detailBeanId; return brewForm(rec); } }

    // bean detail (from bean card)
    const det = e.target.closest('[data-detail]');
    if (det) { const b = beans.find((x) => x.id === det.dataset.detail); if (b) { returnBeanId = null; return beanDetail(b); } }
    // edit bean from its detail -> return to detail afterwards
    const eb = e.target.closest('[data-editbean]');
    if (eb) { const b = beans.find((x) => x.id === eb.dataset.editbean); if (b) { returnBeanId = detailBeanId; return beanForm(b); } }

    // brew edit from the main brews list
    const card = e.target.closest('[data-edit]');
    if (card) { const rec = brews.find((r) => r.id === card.dataset.id); if (rec) { returnBeanId = null; return brewForm(rec); } }

    // remove a selected varietal chip
    const vdel = e.target.closest('[data-vdel]');
    if (vdel) { vdel.closest('.chip').remove(); return; }

    const menu = e.target.closest('[data-menu]')?.dataset.menu;
    if (menu === 'signin') return doSignIn();
    if (menu === 'signout') return doSignOut();
    if (menu === 'settings') return settingsForm();
    if (menu === 'export') return doExport();
    if (menu === 'import') return doImport();
    if (menu === 'erase') return eraseAll();

    const rh = e.target.closest('.rating2 [data-val]');
    if (rh) { const v = +rh.dataset.val; const box = rh.closest('[data-rating]'); box.nextElementSibling.value = v; paintRating(box, v); }
  });

  $('#modalForm').addEventListener('submit', saveForm);
  $('#deleteBtn').addEventListener('click', deleteCurrent);
}

async function init() {
  wireEvents();
  settings = await getSettings();
  await saveSettings(settings);
  await reload();

  // Start cloud sync. Harmless if you never sign in; if a session is already
  // saved it restores it, merges the cloud copy, and keeps things live.
  startSync({
    onChange: async () => { settings = await getSettings(); await reload(); },
    onAuth: () => { /* menu re-reads currentUser() when opened */ },
  }).catch((e) => console.warn('sync unavailable', e));

  // This build runs without a service worker so code is always fresh from the
  // network. Proactively remove any previously-installed worker + its caches.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
    if (window.caches) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
  }
}
init();
