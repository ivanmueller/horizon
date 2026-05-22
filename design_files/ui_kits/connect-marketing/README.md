# Horizon Connect — Marketing site kit

The pre-sign-in surface. Single-page static HTML — hero, logos, features, how-it-works, pricing, customer quote, FAQ, final CTA, footer.

## Why static HTML, not React?

Marketing content should be directly editable. Every heading, list item, FAQ answer is a literal element you can click and retype in design-edit mode — no chat round-trip required. Components-as-React is the right choice for the dashboard (interactive state); for marketing pages, the editing experience trumps reuse.

## File map

| File | What |
|---|---|
| `index.html` | The page. Nav + hero + logos + features + steps + pricing + quote + FAQ + CTA + footer. |
| `marketing.css` | Surface styles. Composes with `colors_and_type.css`. |

## Brand notes specific to this surface

- The hero uses a faint vertical wash (`bg-page → #fff`) plus a soft violet radial behind the floating product card. **No full-bleed gradient mesh** — this isn't Stripe.
- Featured pricing tier is the inverted **brand-dark-900** card with Aurora-amber tag — the brand's "this is the one" signal. The Aurora pin is the only place Aurora appears on the marketing page.
- Logos strip is text-only by default (no real partner logos in the repo). Replace `.logos__item` text with real SVGs at handoff.
