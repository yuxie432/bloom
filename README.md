# 🌸 Bloom

A local-first pour-over coffee journal. Log every brew, keep an inventory of your
beans, and watch your statistics build up. It installs to an iPhone or a Windows
laptop like a native app, works offline, and stores all data on-device — no
account required.

## Features

- **Brews** — date, bean, grinder, grind, dose, water temp, device, filter paper,
  and a **technique template** (Single pour, Two-stage, Three-stage, Four-stage,
  Switch immersion, Equal pulse, Cold brew) that shows the right pour/time fields.
  A half-star overall rating, flavour notes (with aroma / acidity / sweetness /
  body / bitterness / aftertaste prompts) and brew notes. Time fields
  auto-insert the colon (type `230` → `2:30`).
- **Beans** — roaster, country, region, producer, lot, one or more varietals
  (multi-select), roast level, process, mass, price (¥), flavour notes, and a
  half-star rating. Roaster / country / varietal are pick-or-add lists; region,
  producer and lot are free text. Tap a bean to see its details and every brew
  made from it, each linking to the full record.
- **Consumption** — grams remaining is tracked automatically (bag mass minus brew
  doses); bags show a *Finished* tag when empty or when marked finished.
- **Stats** — totals, cups this month, coffee in stock, spend (total, ¥/g, ¥/cup),
  most-brewed roaster, top process by bean rating, pie charts (process, roaster)
  and bar charts (cups/month, technique, device, top beans).
- **Local-first** — everything lives in the browser's IndexedDB. Export/import a
  JSON backup from the ⋮ menu to back up or move between devices.

## Run locally

A PWA must be *served*, not opened as a file. From this folder:

```
npx serve          # or:  python -m http.server 8080
```

Then open the printed `http://localhost:…` URL.

## Deploy (GitHub Pages)

Push to your repo, then **Settings → Pages → Deploy from branch → main → /(root)**.
Your app goes live at `https://<user>.github.io/<repo>/`. On iPhone Safari use
**Share → Add to Home Screen**; on desktop Chrome/Edge use the install icon.

> When you change any file, bump `CACHE` in `sw.js` (e.g. `pourover-v5` → `v6`) so
> installed devices pick up the update.

## Files

| File | Purpose |
|------|---------|
| `index.html` | App shell |
| `styles.css` | Styling |
| `app.js` | UI, forms, stats, rendering |
| `db.js` | IndexedDB storage + settings (swap here to add cloud sync) |
| `manifest.webmanifest`, `sw.js`, `icons/` | PWA installability & offline |

## Importing Notion data

Notion databases export as **Markdown & CSV** (••• → Export). The one-off
converter (`convert.py`, kept outside the repo) turns those exports into
`bloom-import.json`, which you load via **⋮ → Import backup**. It infers the
grinder from grind size, dates from the grinder era, re-derives technique from the
actual pour count, splits combined lots and multi-bean "collection" bags, and
carries bean ratings and flavour notes across.

## Data model

- **Bean**: roaster, originCountry, originRegion, producer, lot, varietal[],
  roastLevel, process, mass, price, flavour, rating, roastDate, finished, notes
- **Brew**: date, beanId, grinder, grind, dose, waterTemp, device, paper,
  technique (+ template params), rating, flavorNotes, notes

## Adding iPhone ↔ laptop sync later

`db.js` is the only file that touches storage, and every record carries an
`updatedAt` timestamp. To sync, add a Firebase/Firestore (or Supabase) adapter
there that mirrors writes to the cloud and merges on load — the rest of the app
stays unchanged.
