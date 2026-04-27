# Phase 0b validation runbook

Pre-build checks for the SetupIntent payment flow on the Banff Hidden Gem
Canoe Tour. Run **all four** before pointing any production traffic at the
new modal. The first one is the architectural keystone — if it fails, we
abandon the SetupIntent design and pivot to Architecture B (see the build
spec).

All steps assume Stripe **test mode**. Bokun's Stripe Connect link must
point at your test Stripe account for the server-side charge in 0b.1 to
land — extranet → Payment providers → Stripe → confirm "test mode" badge.

---

## 0b.1 — does Bokun accept `pm_xxx` in `paymentToken.token`?

The whole spec hangs off this answer.

```sh
# 1. Find a real bookable date inside Bokun's cutoff window
node --env-file=scripts/bokun/.env scripts/bokun/inspect-product.mjs 1162721

# 2. Run the token test against that date
STRIPE_SECRET_KEY=sk_test_… \
node --env-file=scripts/bokun/.env scripts/bokun/test-pm-in-bokun.mjs --date=2026-06-15
```

**Expected outcomes:**

| Script verdict | Meaning | Action |
|---|---|---|
| `✓ PROCEED with Architecture A` | Bokun confirmed the booking with `pm_xxx` | Continue with the spec |
| Token-format rejection | Bokun only accepts legacy `tok_xxx` | Pivot to Architecture B |
| `redirectRequest.url` returned | Channel is REDIRECT — token was ignored | Email Bokun support to switch channel to TOKEN |
| `no such payment_method` | Mismatched Stripe accounts | Re-link Bokun ↔ Stripe (test) |

⚠ The script creates a real reservation. Cancel it from the Bokun
dashboard immediately after the run — the verdict line prints the
`confirmationCode`.

---

## 0b.2 — Bokun → Stripe Connect money flow

In the **Bokun extranet**:

1. Settings → Payment providers → Stripe → confirm "successfully
   connected".
2. Click the blue **Test** button. Enter a real card you own — this makes
   a $1 charge.
3. In `dashboard.stripe.com` (test mode toggle off for this one), confirm
   the charge appears in **your** Stripe account under Payments.
4. Refund yourself.

If the charge goes to a different Stripe account, Bokun is connected to
the wrong one — the SetupIntent flow will fail in production even after
0b.1 passes.

---

## 0b.3 — end-to-end SCA test with a European test card

This validates the live SetupIntent + Elements + 3DS popup + Bokun submit
chain. Has to be done in the browser after Day 5/6 of the build land.

1. Deploy the page + worker to a test Cloudflare Pages preview.
2. Open the canoe-tour page. Pick a date, set 1 adult.
3. In the modal, fill contact info + pickup. Use the EU 3DS test card:
   `4000 0027 6000 3184`, exp `12/30`, CVC `123`.
4. Click Pay. A 3DS popup should appear — complete the challenge.
5. Confirm in Stripe Dashboard (test mode):
   - SetupIntent created with `usage: off_session`
   - PaymentMethod attached to a fresh Customer
   - PaymentIntent (created server-side by Bokun) succeeded against that
     PaymentMethod
6. Confirm in Bokun: the booking shows up in the dashboard, status
   confirmed.
7. Confirm: no second 3DS challenge fired between step 4 and step 6.

If the user gets a second auth prompt after Pay, the off-session usage
flag isn't doing its job — re-check the `usage: off_session` on the
SetupIntent created by `POST /api/stripe/setup-intent`.

---

## 0b.4 — full test card matrix

Run all eight in test mode through the deployed page. Every one should
behave exactly as listed.

| Card | Type | Expected |
|---|---|---|
| `4242 4242 4242 4242` | Basic, no SCA | Setup → confirm immediate |
| `4000 0027 6000 3184` | 3DS challenge | Popup, then confirm |
| `4000 0084 0000 1629` | EU SCA regulated | Popup, then confirm |
| `4000 0000 0000 0341` | Setup OK / charge fails | SetupIntent succeeds, **Bokun submit fails** — UX must say card not charged |
| `4000 0000 0000 9995` | Card declined | SetupIntent fails: `card_declined` |
| `4000 0000 0000 0069` | Expired | `expired_card` |
| `4000 0000 0000 0127` | Wrong CVC | `incorrect_cvc` |
| `4000 0000 0000 0119` | Processing error | `processing_error` |

After all eight pass, do **one** end-to-end live booking with a real card
(refund yourself in Stripe afterwards) before flipping production QR
codes at the new page.

---

## Going live

1. Stripe Dashboard → toggle to live mode.
2. `wrangler secret put STRIPE_SECRET_KEY` from `workers/bokun/` with
   `sk_live_…`.
3. Update the `STRIPE_PUBLISHABLE_KEY` constant in
   `tours/Banff-Hidden-Gem-Canoe-Tour/index.html` to the `pk_live_…` key.
4. Re-run 0b.2 in live mode (single $1 charge + refund) to confirm the
   live-mode Stripe Connect link is healthy.
5. One real booking, refund afterward, verify booking + charge + email.
