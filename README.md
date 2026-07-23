# 🌸 Bloom

A local-first pour-over coffee tracker. Log every brew, keep an inventory of your
beans, and watch your statistics build up. It installs to your iPhone and Windows
laptop like a real app, works offline, and stores all data on-device — no account
required.

---

## What's in this folder

| File | What it does |
|------|--------------|
| `index.html` | The app shell |
| `styles.css` | Mobile-first styling |
| `app.js` | All app logic (brews, beans, stats, forms) |
| `db.js` | Storage layer (IndexedDB). The one place data lives — swap this to add cloud sync |
| `manifest.webmanifest` | Makes it installable |
| `sw.js` | Service worker → offline support |
| `icons/` | App icons |

---

## Try it right now (locally on your laptop)

A PWA needs to be *served* (opening `index.html` by double-click won't run the
service worker). Easiest way on Windows:

1. Install [Node.js](https://nodejs.org) if you don't have it.
2. Open a terminal (PowerShell) in this folder.
3. Run: `npx serve` (or `python -m http.server 8080`).
4. Open the URL it prints (e.g. `http://localhost:3000`).

Tap the **⋮ menu → Load sample data** to see it populated, then explore.

---

## Publish it free on GitHub Pages

Once published, you get a URL like `https://YOURNAME.github.io/pourover/` that you
open on your iPhone and laptop.

1. Create a free account at [github.com](https://github.com).
2. Create a new **public** repository, e.g. `pourover`.
3. Upload every file in this folder (keep the `icons/` folder). You can drag-and-drop
   them in the GitHub web uploader ("Add file → Upload files").
4. In the repo: **Settings → Pages → Build and deployment**. Set **Source =
   Deploy from a branch**, **Branch = `main`**, folder = `/ (root)`. Save.
5. Wait ~1 minute. Your app is live at the URL shown on that Pages screen.

> Updating later: re-upload the changed files, **and bump `CACHE = 'pourover-v1'`
> to `v2` (etc.) in `sw.js`** so devices pick up the new version.

---

## Install it as an app

**iPhone (Safari):** open your Pages URL → tap the **Share** button → **Add to Home
Screen**. It now opens full-screen with its own icon.

**Windows (Chrome/Edge):** open the URL → click the **install icon** in the address
bar (or menu → *Install Pour-Over Journal*).

---

## How your data is stored (important)

- Data lives **on each device** in the browser's IndexedDB. Private, offline, fast.
- Because it's per-device, **your iPhone and laptop are separate logs** until you
  add cloud sync (below) or move data manually.
- **Back up regularly:** ⋮ menu → **Export backup (.json)**. To move data to another
  device, export on one, then ⋮ → **Import backup** on the other.

---

## Moving your Notion data in

1. In Notion, open your beans database → **••• (top right) → Export**.
   - Export format: **Markdown & CSV**. You'll get a `.csv` per database.
2. Do the same for your brews database.
3. Send me (or open) those two CSVs and I'll write a one-time converter that turns
   them into a `pourover-backup.json` matching this app's format. Then just ⋮ →
   **Import backup** and everything's in.

The data model this app uses:

- **Bean:** roaster, originCountry, originRegion, producer, roastLevel, process,
  varietal, mass, price, purchaseDate, roastDate, notes
- **Brew:** date, beanId (→ links to a bean), dose, waterMass, waterTemp,
  grindSetting, pourTemplate, brewTime, tasting scores (aroma, acidity, sweetness,
  body, bitterness, aftertaste, each 0–5), rating (1–5 overall), flavorNotes, notes

Per-bean average rating is computed automatically from its brews.

---

## Adding iPhone ↔ laptop sync later (Firebase)

The app is built so this is a contained change — only `db.js` needs a sync adapter.
When you're ready:

1. Create a free project at [firebase.google.com](https://firebase.google.com) →
   add a **Firestore** database (test mode is fine to start).
2. Enable **Anonymous** or **Google** sign-in under Authentication.
3. Tell me, and I'll add a small sync layer: writes go to IndexedDB *and* Firestore,
   and on load the two merge by `updatedAt`. You keep offline use; both devices stay
   in sync automatically.

Every record already carries an `id` and `updatedAt` timestamp for exactly this.
