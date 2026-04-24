# Bokun validation + partner sync scripts

Tooling for Phase 0b of the Bokun integration. Zero runtime dependencies
— plain Node (≥ 18, tested on 22), built-in `fetch` and `node:crypto`.

## One-time setup

```sh
cp scripts/bokun/.env.example scripts/bokun/.env
# Paste your Bokun access key + secret key into .env
```

The `.env` file is gitignored. Never commit real credentials.

## The three scripts

Run in this order the first time:

```sh
# 1. Confirm your HMAC signature works against both endpoint families.
node --env-file=scripts/bokun/.env scripts/bokun/check-auth.mjs

# 2. List every live product and confirm availability is queryable.
node --env-file=scripts/bokun/.env scripts/bokun/validate-products.mjs

# 3. Diff partners.json against Bokun sales agents.
node --env-file=scripts/bokun/.env scripts/bokun/sync-partners.mjs
# …then once the plan looks right:
node --env-file=scripts/bokun/.env scripts/bokun/sync-partners.mjs --apply
```

Each script exits 0 on success, non-zero on any failure, so they drop
straight into CI if you want to gate deploys on them later.

## What each script does

### `check-auth.mjs`
Signs one `POST` against the activity endpoint family and one `POST`
against the booking endpoint family. Pure auth check — it doesn't care
what data comes back, only that Bokun accepts the signature. If this
fails it's almost always one of three things: wrong keys, extra
whitespace in `.env`, or a skewed system clock (Bokun signs against UTC
to the second).

### `validate-products.mjs`
Calls `POST /activity.json/search` to enumerate every activity the
vendor owns, filters to ones that are `published` + `bookable` +
non-archived + non-draft, then for each one calls
`GET /activity.json/{id}/availabilities` over a 180-day window. Prints
ID + title + slot count per product. Non-zero exit if any live product
fails to return availability.

Optional flag: `--days=365` widens the availability window.

### `sync-partners.mjs`
Reads `partners.json`, flattens active hotels + active employees into
the canonical set of tracking codes via the rule in
`PARTNERS_NAMING.md` (`trackingCode = code.toUpperCase().replace(/-/g, "_")`),
and verifies the naming convention is internally consistent. Then probes
a list of candidate Bokun endpoints to find which one this account uses
for partner / agent / affiliate management:

```
/sales-agent.json/find-all
/sales-agent.json/list
/extranet/sales-agent.json/find-all
/affiliate.json/find-all
/channel.json/find-all
/booking-channel.json/find-all
```

First non-404 wins. Override the probe with `--list-path=<path>` and
`--create-path=<path>` if your account uses something not in the list
(Bokun support can confirm the exact path).

Default run: prints a plan (what exists, what's missing). No writes.
With `--apply`: creates the missing sales agents using the exact
tracking code from `partners.json`. Commission / kickback percentages
get copied across where present; finance-side configuration (currency,
payout schedule, etc.) still belongs in the Bokun extranet UI.

If every candidate path returns 404 — which happens on Bokun account
tiers that don't expose partner CRUD over the Vendor REST API at all —
the script falls back to step-by-step manual instructions for the
extranet UI. Re-run after manual registration to verify the codes are
present.

## Ongoing workflow

When a new hotel signs:

1. Add the hotel (and employees, if kickback-type) to `partners.json` —
   PR + review.
2. Merge.
3. Run `sync-partners.mjs --apply` against production Bokun. Done.

`sync-partners.mjs` is idempotent: existing tracking codes are skipped,
only the new ones are created. Safe to run after every merge.

## What *isn't* in here

- No commission payout logic — that's Phase 1 and lives elsewhere.
- No booking-creation flows — checkout is still the Stripe worker. This
  tooling is validation + registration only.
- No secrets. `scripts/bokun/.env` is gitignored; every script reads
  credentials from the environment.
