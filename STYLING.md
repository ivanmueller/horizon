# Styling — source of truth

Horizon's CSS has **one source of truth: the Claude Design kit in
`design_files/`.** Everything that ships downstream from it. Never edit the
served copies as if they were canonical.

This note lives at the repo root on purpose: `design_files/` is replaced
wholesale whenever Claude Design hands over a new kit, which overwrites its
own `README.md` / `CLAUDE.md`. This file survives those refreshes, so it is
the durable record of how styling is wired.

## The chain

```
design_files/                            SOURCE OF TRUTH (from Claude Design)
  ├─ colors_and_type.css                 authoritative single-import token bundle
  └─ horizon-source/ + production/css_new/   canonical split files
        │   copy  production/css_new/*  →  css_new/
        ▼
css_new/                                 SERVED derivative (synced from above)
        │   loaded by every modern page
        ▼
auth pages · admin shell · /next/ dashboards
```

- **Author upstream, in `design_files/`.** To ship a styling change, update the
  kit there and copy `design_files/production/css_new/*` into `css_new/`.
- **`css_new/` is a derivative, never the source.** Don't hand-edit it as if it
  were canonical. (It used to be treated that way; a second copy —
  `colors_and_type.css` at the repo root — drifted apart from it and the two
  broke each other. That root duplicate has been removed; the only
  `colors_and_type.css` now lives in `design_files/`.)

## Anchor-consistency guard

A delivered kit's split token files (`horizon-source/`, `production/css_new/`)
must agree with `design_files/colors_and_type.css` and the brand-anchor table
in `design_files/CLAUDE.md`:

| Token | Value |
|---|---|
| Connect `--action-primary-default` | `--color-blue-500` (`#4F5BFF`) |
| Connect hover | `--color-blue-600` (`#3543E6`) |
| `--bg-page` | `#FFFFFF` (pure white — never a tinted neutral) |

If a delivered split file sets `--action-primary-default` to `blue-600`, or
`--bg-page` to a tinted neutral, that is a **packaging bug** — correct it to
match `colors_and_type.css` before copying into `css_new/`. (The v1.3 kit
shipped with exactly this inversion in its split files.)

## Legacy

`legacy_css/` (`style.legacy.css`, `admin.legacy.css`) is the pre-Claude
stylesheet stack. It is kept only until the marketing/tours pages and the
admin shell that still load it are migrated onto `css_new/`. Don't extend it.

## Applying a new kit from Claude Design

1. Replace `design_files/` with the new kit (its `project/` contents).
2. Re-check the anchor-consistency guard above and fix any split-file
   packaging bugs.
3. Sync the served copy: `cp design_files/production/css_new/* css_new/`.
4. The new kit may revert `design_files/README.md` / `CLAUDE.md` to calling
   `css_new/` the "source of truth." That's stale — this note is the
   authority. Re-apply those doc fixes if you want them to match.
