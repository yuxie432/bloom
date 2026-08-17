# 🌸 Bloom

A local-first pour-over coffee journal. Log every brew, keep an inventory of your
beans, and watch your statistics build up. It installs to an iPhone or a Windows
laptop like a native app, works offline, and stores all data on-device — no
account required.

## Features

- **Brews** — date, bean, grinder, grind, dose, water temp, device, filter paper,
  and a **technique template** (Single pour, Two-stage, Three-stage, Four-stage,
  Switch immersion, Equal pulse, Cold brew) that shows the right pour/time fields.
  A half-star overall rating, flavour notes and brew notes. The flavour-notes box
  pre-fills the selected bean's roaster tasting notes as a placeholder. The device
  picker is ordered by how often you use each device; filter papers follow a fixed
  order (Hario, Mola, Abaca, Origami Wave, Origami Cone). Time fields auto-insert
  the colon (type `230` → `2:30`). The list is grouped by date, newest first, and
  brews from the same day are ordered newest-edited first.
- **Beans** — roaster, country, region, producer, lot, one or more varietals
  (multi-select), roast level, process, mass, price (¥), flavour notes, and a
  half-star rating. The rating is either set manually or, if left blank, the
  average of the bean's brews' ratings **rounded to the nearest half-star**. The
  roaster picker is ordered by recency then frequency — a roaster you just added
  centrally sits on top, then fresh unbrewed bags, then established roasters by
  pack count and most-recent brew. Roaster / country / varietal are pick-or-add
  lists; region, producer and lot are free text. Bean cards show the rating, brew
  count and grams left; tap a bean to see full details and every brew made from
  it, each linking to the full record.
- **Equipment & option lists** — manage grinders, devices, filter papers, roasters,
  countries, varietals, processes and the defaults for new brews from
  **⋮ → Equipment & option lists**. Roaster / country / varietal lists include every
  value already used by your beans, not only manually-added ones.
- **Consumption** — grams remaining is tracked automatically (bag mass minus brew
  doses); bags show a *Finished* tag when empty or when marked finished.
- **Stats** — headline cards (coffee in stock, packs open, beans consumed, total
  brews, total spend, average ¥/g), pie charts of your bean packs (country, process,
  roaster) and bar charts (varietal counts, average bean rating by country / process
  / roaster, cups per month, brews by technique, brews by device). Rating charts use
  each bean's displayed rating (manual value, or the half-star brew average).
- **Local-first, optional cloud sync** — everything lives in the browser's IndexedDB
  and the app works fully offline. Export/import a JSON backup from the ⋮ menu, or
  sign in with Google to mirror beans & brews across devices via Firestore.

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

> The app does not register a caching service worker (`sw.js` is a one-time reset
> worker that clears any old cache). To make installed devices fetch changed files,
> bump the `?v=` query string where they're loaded — in `index.html` for
> `styles.css` / `app.js`, and in the `db.js` / `sync.js` imports at the top of
> `app.js` / `sync.js`.

## Files

| File | Purpose |
|------|---------|
| `index.html` | App shell |
| `styles.css` | Styling |
| `app.js` | UI, forms, stats, rendering |
| `db.js` | IndexedDB storage + settings |
| `sync.js` | Optional Google / Firebase Firestore cloud sync (layered on `db.js`) |
| `clean-backup.html` | Standalone tool to strip legacy tasting-scale fields from a backup |
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

## iPhone ↔ laptop sync

Cloud sync is built in (`sync.js`). Without sign-in the app is fully local; when you
sign in with Google it mirrors every write to Firebase Firestore and merges remote
records back into IndexedDB by `updatedAt` (last-write-wins per record), so your
iPhone and laptop stay in sync. `db.js` remains the only file that touches local
storage, and every record carries an `updatedAt` timestamp used for conflict
resolution.
