# Horizon Tours — Marketing kit (sibling brand)

A small sample of the **Tours** sibling brand — the consumer-facing booking site. Demonstrates how the same architecture re-themes:

| What diverges | Connect | Tours |
|---|---|---|
| Primary colour | Violet `#3543E6` | Amber `#E0691C` |
| Neutrals | Cool, violet-tinted | Warm, amber-tinted |
| Radius hierarchy | 4 / 8 / 12 / 16 | 8 / 12 / 16 / 20 |
| Contextual spacing | Static | More generous |
| Tone | Direct, infrastructural | Warm, sensory, plainspoken |

The page deliberately includes a **sibling band** near the footer that links back to Connect with a faint violet treatment — this is the system's documented `≤1%` sibling-link accent.

## What's here

- Sticky nav with amber primary CTA
- Full-bleed dark-mountain hero with amber glow (placeholder for the production photo)
- Social-proof bar with stars + tabular figures
- 3-up tour-card grid (image fallbacks where no photography is staged)
- 3-up "Why Horizon" feature cards
- Sibling band → links to Connect
- Dark footer

## Caveats

- The hero photo and tour-card images use SVG/gradient fallbacks. In production, swap to the `/images/` assets that ship with the repo (`moraine-lake-banff.webp`, `LakeLouise-Canoe.jpg`, etc).
- This is a demo of the sibling theme — not a feature-complete Tours site. The full marketing surface (Lake Louise sunrise canoe page, Gondola page, blog) is out of scope for this kit.
