# Migration patch — design-system v1.1 → live Horizon repo

A single-pass patch package. Apply each section as its own branch so you
can revert without taking the rest with you. Every change is targeted at
files that already exist in `ivanmueller/horizon@main` — no new
architecture, no new dependencies, no JSX. The kit is React for review
convenience; your repo is vanilla template strings, and the deltas below
respect that.

Order matters: tokens first (everything cascades), then chrome, then
page-by-page. Smoke-test by clicking through partner dashboard → admin
home → admin Hotels list → admin Hotel detail → admin Bookings after
each branch.

---

## Branch 1 — Token shift (`css_new/horizon-connect-tokens.css`)

Horizon Violet anchors at `--color-violet-500` instead of `-600`. Page
background flips to pure `#FFFFFF`. Focus ring retints. Every
component that reads `--action-primary-default`, `--text-brand`,
`--bg-page`, `--shadow-focus-ring` updates automatically.

```diff
   /* Backgrounds */
-  --bg-page:          var(--color-neutral-50);
+  --bg-page:          #FFFFFF;
   --bg-surface:       #FFFFFF;
   --bg-subtle:        var(--color-neutral-100);
```

```diff
   /* Text */
-  --text-brand:      var(--color-violet-600);
+  --text-brand:      var(--color-violet-500);
```

```diff
   /* Borders */
-  --border-brand:    var(--color-violet-600);
+  --border-brand:    var(--color-violet-500);
```

```diff
   /* Action — primary */
-  --action-primary-default:  var(--color-violet-600);
-  --action-primary-hover:    var(--color-violet-700);
-  --action-primary-pressed:  var(--color-violet-800);
-  --action-primary-disabled: var(--color-violet-300);
+  --action-primary-default:  var(--color-violet-500);
+  --action-primary-hover:    var(--color-violet-600);
+  --action-primary-pressed:  var(--color-violet-700);
+  --action-primary-disabled: var(--color-violet-200);
```

```diff
-  --shadow-focus-ring: 0 0 0 3px rgba(73, 32, 196, 0.18);
+  --shadow-focus-ring: 0 0 0 3px rgba(91, 45, 232, 0.18);
```

> **Dark-mode override at the bottom of the same file** — `bg-page` and
> `bg-surface` already point at neutrals there; no change needed for
> the dark branch.

### Inline-SVG hex sweep

Tokens don't reach hard-coded SVG fills. Grep the whole repo and
replace `#4920C4` → `#5B2DE8`. Expected hits (from a fresh clone):

- `dashboard/hotel/index.html` — QR generator (`dotsOptions.color`,
  `cornersSquareOptions.color`, `cornersDotOptions.color`).
- `admin/index.html` — any QR or chart inline fills.
- `index.html` (Tours marketing) — none expected; Tours uses amber.
- SVG logo files under `images/` if any reference the old hex.

Same sweep applied to `rgb(73, 32, 196)` → `rgb(91, 45, 232)` for any
rgba shadow declarations outside the token file.

---

## Branch 2 — Sidebar search → topbar (`admin/index.html` + `css/admin.css`)

Goal: search input lives in a new sticky topbar, breadcrumb / page
title removed from each route's HTML template, sidebar reclaims that
vertical space.

### `admin/index.html` — markup

Above `<main class="app__main">` (around line 130), insert a new
topbar:

```html
<header class="app__topbar">
  <label class="app__search">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
    <input id="appSearch" type="search" placeholder="Search hotels, bookings, codes…" autocomplete="off" />
    <span class="app__kbd">⌘K</span>
  </label>
  <div class="app__topbar-actions">
    <button type="button" class="app__icbtn" id="appHelp" aria-label="Help">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    </button>
    <button type="button" class="app__icbtn" id="appNotif" aria-label="Notifications">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
    </button>
    <button type="button" class="app__icbtn" id="appSettings" aria-label="Settings">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
    </button>
    <button type="button" class="app__primary" id="appQuickAdd" aria-label="Add">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    </button>
  </div>
</header>
```

Then in **every route renderer that returns `html: \`…\``** (`bookings()`,
`hotels()`, `short-links()`, `tours()`, `payments()`, `billing()`,
`invoices()`, `access-requests()`), delete the entire `<header class="bk-page__head">…</header>` block including the `<h1 class="bk-page__title">` and `<div class="bk-page__actions">` that sit inside it. The page-level actions (`+ Create booking`, `+ Add hotel`, etc.) can either move into the topbar's `appQuickAdd` button as a dropdown, or stay where they are by reusing `<div class="bk-page__actions">` without the surrounding header.

The `hotel-detail` renderer (line 1631) is the one exception — it
keeps its header *and* the back link, because that's the only place
with a "back" affordance. Just delete its `<h1 class="bk-page__title">`
node; keep the back link and actions row.

### `css/admin.css` — new rules

Append to `admin.css` (the topbar is purely additive — no existing
rules collide):

```css
/* ── Topbar (hero bar — Stripe pattern) ───────────────────── */
.app__topbar {
  position: sticky; top: 0; z-index: 50;
  display: flex; align-items: center;
  gap: var(--space-lg);
  padding: var(--space-sm) var(--space-xl);
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-subtle);
}
.app__search {
  display: inline-flex; align-items: center; gap: var(--space-sm);
  flex: 1; max-width: 480px;
  padding: 8px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  color: var(--text-secondary);
}
.app__search input {
  border: 0; outline: 0; background: transparent;
  font: var(--weight-regular) var(--type-body-size)/var(--type-body-line) var(--font-sans);
  color: var(--text-primary);
  flex: 1; min-width: 0;
}
.app__kbd {
  font: var(--weight-medium) 11px/1 var(--font-mono);
  padding: 2px 6px;
  border: 1px solid var(--border-default);
  border-radius: 4px;
  background: var(--bg-subtle);
  color: var(--text-secondary);
}
.app__topbar-actions { margin-left: auto; display: flex; gap: 6px; align-items: center; }
.app__icbtn {
  width: 32px; height: 32px;
  border: 0; background: transparent;
  border-radius: var(--radius-md);
  cursor: pointer; color: var(--text-secondary);
  display: inline-flex; align-items: center; justify-content: center;
}
.app__icbtn:hover { background: var(--bg-subtle); color: var(--text-primary); }
.app__primary {
  width: 32px; height: 32px;
  border: 0; background: var(--action-primary-default);
  color: #fff;
  border-radius: 50%;
  cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  margin-left: 4px;
}
.app__primary:hover { background: var(--action-primary-hover); }
```

### `css/admin.css` — sidebar search removal

If there's a `.sb-search` block (or whatever ID/class your current
sidebar search uses), delete it. If the only sidebar search is markup
inside `admin/index.html`'s `<aside class="app__sidebar">`, just delete
the `<div class="sb-search">…</div>` block from the markup; no CSS
delete needed.

### `css/admin.css` — `--content-top` adjustment

You currently set `--content-top: 85px` (line 93) to leave room for
the per-route page heading. With the page title gone, drop it back to
the topbar's actual height so content sits where it should:

```diff
-  --content-top: 85px;
+  --content-top: 24px;
```

Page renderers that rely on `--content-top` to anchor title baselines
(`.bk-page__head--stack`, `.bk-page__head--invoices`) keep their
existing nudges; they just hang off a smaller fixed offset now.

---

## Branch 3 — Setup pill on the Connect partner dashboard (`dashboard/hotel/index.html`)

Single-purpose pill that reminds the hotel to finish their profile.
Auto-hides when done.

### Markup — inside `.hd-header__inner`, before `.hd-header__actions`

```html
<button type="button" class="hd-setup-pill" id="hdSetupPill" hidden>
  <span class="hd-setup-pill__ring" aria-hidden="true">
    <svg viewBox="0 0 18 18">
      <circle cx="9" cy="9" r="7" class="t" stroke-width="2" fill="none"/>
      <circle cx="9" cy="9" r="7" class="f" stroke-width="2" fill="none" stroke-linecap="round"/>
    </svg>
  </span>
  Complete profile · <span id="hdSetupPillCount">0/5</span>
</button>
```

### CSS — append to `/css/style.css` (Tours brand sheet) or wherever the partner dashboard's chrome lives

```css
.hd-setup-pill {
  display: inline-flex; align-items: center; gap: var(--space-sm);
  padding: 5px 12px 5px 14px;
  border: 1px solid var(--border-default);
  border-radius: 999px;
  background: var(--bg-surface);
  font: var(--weight-medium) var(--type-label-size)/1 var(--font-sans);
  color: var(--text-primary);
  cursor: pointer;
}
.hd-setup-pill:hover { background: var(--bg-subtle); }
.hd-setup-pill__ring { position: relative; width: 16px; height: 16px; }
.hd-setup-pill__ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.hd-setup-pill__ring circle.t { stroke: var(--color-violet-100); }
.hd-setup-pill__ring circle.f { stroke: var(--color-violet-500); transition: stroke-dashoffset var(--transition-base); }
```

### JS — wherever the partner dashboard knows its setup state

```js
function updateSetupPill(done, total) {
  const el     = document.getElementById('hdSetupPill');
  const count  = document.getElementById('hdSetupPillCount');
  const ring   = el && el.querySelector('circle.f');
  if (!el) return;
  if (done >= total) { el.hidden = true; return; }
  el.hidden = false;
  count.textContent = done + '/' + total;
  if (ring) {
    const C = 2 * Math.PI * 7;
    ring.setAttribute('stroke-dasharray',  String(C));
    ring.setAttribute('stroke-dashoffset', String(C * (1 - done / total)));
  }
}
```

Call `updateSetupPill(doneSteps, totalSteps)` from the same code path
that already drives the in-page setup card. They should never disagree.

---

## Branch 4 — Bookings table (`admin/index.html`, `bookings()` renderer)

### Remove the Customer column

In the `bookings()` renderer (line ~1126), the `<thead>` has:

```html
<th>Customer</th>
```

Delete it. In the row template (search for `'<td>' + escapeHtml(b.tour) + '</td>'`
around line 6256, and the second copy at line 6440), there's a
`<td>{customer}</td>` cell — delete it.

The amount cell already carries the inline status pill in the same
markup (`bk-row__amount` + `statusPill`) — that part is already done in
your code, just confirm no other paint paths emit the pill in its own
column.

### Update colSpan in the empty row

The bookings-empty template at the bottom of `bookings()`
(`<tr><td colspan="9">…`) drops from 9 to 8.

```diff
-  <tr><td colspan="9" class="bk-empty">…
+  <tr><td colspan="8" class="bk-empty">…
```

---

## Branch 5 — Hotel detail row alignment (`css/admin.css`)

Production already uses `--bg-muted` for `.hd-avatar` (line 2354) and
the right rail `.hd-side` is *not* sticky (line 2196). Both my flagged
issues are already correct in your code — nothing to migrate.

The one alignment polish that's worth lifting: when Placements /
Managers / Employees rows have a status pill + trailing metadata,
the pill left-edges currently float because the trailing text widths
differ. Add a fixed slot:

```css
/* Right-side cell on hd-emp rows gets a consistent layout slot so
   pills line up regardless of trailing metadata width. */
.hd-section__row > :last-child {
  display: flex; align-items: center; gap: var(--space-lg);
  justify-content: flex-end;
}
.hd-section__row > :last-child .pill,
.hd-section__row > :last-child .bk-pill,
.hd-section__row > :last-child .hd-pill {
  min-width: 96px;
  justify-content: center;
}
.hd-section__row > :last-child > .hd-emp__role,
.hd-section__row > :last-child > .hd-row__meta,
.hd-section__row > :last-child > [data-trail] {
  min-width: 120px;
  text-align: right;
}
```

> Selector reads as "the last child of every `.hd-section__row`" — if
> your rows use a different container class (e.g. `.hd-mgr-row`), swap
> the parent selector. The block is purely additive; if no rows match
> nothing changes.

---

## Verification checklist

After each branch lands:

| Check | Where |
|---|---|
| Primary buttons read brighter | `/admin/`, `/dashboard/hotel/`, `/` |
| Page sits on pure white | every route — `--bg-page` should resolve to `#fff` |
| Focus rings glow brighter | tab through any form |
| QR codes draw in new violet | `/admin/hotels/<slug>/` master QR |
| Topbar shows search + icon row | `/admin/*` every route |
| No page title in chrome | `/admin/bookings/`, `/admin/hotels/`, `/admin/short-links/` |
| Setup pill visible | `/dashboard/hotel/` while setup is incomplete |
| Setup pill hidden | `/dashboard/hotel/` once `done === total` |
| Bookings: no Customer column | `/admin/bookings/` |
| Bookings: status sits next to amount | `/admin/bookings/` |
| Manager / Employee pills line up | `/admin/hotels/<slug>/` Placements / Managers / Employees |
| Right rail scrolls with main column | `/admin/hotels/<slug>/` long scroll |

## What this patch deliberately leaves alone

- The legacy `/css/style.css` (Tours marketing). Tours is a sibling
  brand and its amber tokens should not move with this Connect-side
  shift.
- The Supabase auth flow at `/dashboard/login/` and `/dashboard/setup/`.
  No visual changes there in this round.
- The PDF invoice template (`scripts/horizon/invoice-pdf.mjs`).
  Brand color updates there would need a separate diff against the
  Node module's hex constants.

---

*Generated against the design system on May 21, 2026. If the Connect
codebase has drifted since, treat the line numbers as approximate
landmarks and grep the class names instead — the class names and the
token names are the stable contract, not the line offsets.*
