// Horizon — monthly commission invoice generator (Node CLI).
//
// Reads confirmed bookings from Supabase for a period and writes one
// PDF per hotel to invoices/<period>/<hotel-code>.pdf.
//
// PDF layout lives in scripts/horizon/invoice-pdf.mjs — same module
// is loaded in the browser by /admin/, so the in-page
// "Invoice" button produces visually identical PDFs.
//
// Setup (one-time):
//   npm install
//
// Run:
//   npm run invoices -- --month=2026-05
//   node --env-file=scripts/supabase/.env scripts/horizon/generate-invoices.mjs --month=2026-05 --hotel=fairmont-ll
//   node --env-file=scripts/supabase/.env scripts/horizon/generate-invoices.mjs --from=2026-05-01 --to=2026-05-31
//   npm run invoices                      # defaults to last full calendar month
//
// Hotels with zero bookings in the period are skipped (no empty PDFs).
// invoices/ is gitignored — PDFs contain guest names + emails.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";

import {
  renderInvoice,
  computeAggregates,
  ymd,
  monthShort,
} from "./invoice-pdf.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

// ── Args ──────────────────────────────────────────────────────────────
function parseArgs() {
  const args = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([a-zA-Z-]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

function resolveRange(args) {
  if (args.from && args.to) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.from) || !/^\d{4}-\d{2}-\d{2}$/.test(args.to)) {
      throw new Error("--from and --to must be YYYY-MM-DD");
    }
    return {
      from: args.from,
      to: args.to,
      label: `${formatLongLocal(args.from)} – ${formatLongLocal(args.to)}`,
      slug: `${args.from}_${args.to}`,
    };
  }
  let month = args.month;
  if (!month) {
    const now = new Date();
    const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    month = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}`;
  }
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error("--month must be YYYY-MM");
  }
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0));
  const monthName = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ][m - 1];
  return {
    from: ymd(first),
    to: ymd(last),
    label: `${monthName} ${y}`,
    slug: month,
  };
}

function formatLongLocal(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const [y, m, d] = s.split("-").map(Number);
  return `${monthShort(m)} ${d}, ${y}`;
}

// ── Supabase fetch (service-role; never callable from a browser) ─────
async function rest(p) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1${p}`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!r.ok) throw new Error(`Supabase ${p} → ${r.status}: ${await r.text()}`);
  return r.json();
}

// ── Per-hotel generator ───────────────────────────────────────────────
async function generateForHotel(hotel, range, outDir) {
  const fields =
    "id,confirmation_code,date,time,adults,youth,infants,amount,currency," +
    "tour_title,tour_id,lead_name,created_at," +
    "staff:hotel_staff(id,code,name,tracking_code,kickback_pct)";
  const q =
    `/bookings?status=eq.confirmed&hotel_id=eq.${hotel.id}` +
    `&created_at=gte.${range.from}T00:00:00.000Z` +
    `&created_at=lte.${range.to}T23:59:59.999Z` +
    `&select=${fields}&order=created_at.asc&limit=10000`;

  const records = (await rest(q)).map((r) => ({
    ...r,
    amount: r.amount != null ? Number(r.amount) : 0,
  }));

  if (records.length === 0) {
    console.log(`  ${hotel.code}: no bookings — skipped`);
    return null;
  }

  const commissionPct = Number(hotel.commission_pct) || 0;
  const { totals, kickbacks } = computeAggregates(records, commissionPct);

  const dir = path.join(outDir, range.slug);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${hotel.code}.pdf`);

  const doc = new PDFDocument({
    size: "A4",
    margin: 50,
    bufferPages: true,
    info: {
      Title:   `Horizon commission ${range.label} — ${hotel.name}`,
      Author:  "Horizon Tours",
      Subject: "Commission statement",
    },
  });
  doc.pipe(fs.createWriteStream(file));

  renderInvoice(doc, {
    hotel: { ...hotel, commission_pct: commissionPct },
    range,
    totals,
    kickbacks,
    records,
  });
  doc.end();

  console.log(
    `  ${hotel.code}: ${records.length} booking(s) → ${path.relative(REPO, file)}`,
  );
  return file;
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error(
      "SUPABASE_URL and SUPABASE_SERVICE_KEY required.\n" +
        "Run via: npm run invoices -- --month=YYYY-MM\n" +
        "Or:      node --env-file=scripts/supabase/.env scripts/horizon/generate-invoices.mjs",
    );
    process.exit(1);
  }

  const args = parseArgs();
  let range;
  try {
    range = resolveRange(args);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  console.log(`Horizon invoice generator — ${range.label}`);
  console.log(`Range: ${range.from} → ${range.to}\n`);

  const hotels = (await rest(
    "/hotels?status=eq.active" +
      "&select=id,code,name,location,type,commission_pct,kickback_pool_pct,default_tracking_code",
  )).filter((h) => !args.hotel || h.code === args.hotel);

  if (hotels.length === 0) {
    console.error(args.hotel ? `Hotel "${args.hotel}" not found or inactive.` : "No active hotels found.");
    process.exit(1);
  }

  const outDir = args.out ? path.resolve(args.out) : path.join(REPO, "invoices");
  let written = 0;
  for (const h of hotels) {
    const file = await generateForHotel(h, range, outDir);
    if (file) written += 1;
  }
  console.log(`\nDone. ${written} invoice(s) written to ${path.relative(REPO, outDir)}/${range.slug}/`);
}

await main();
