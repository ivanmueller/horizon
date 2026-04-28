// Horizon — monthly commission invoice generator
//
// Reads confirmed bookings from Supabase for a period and writes one
// PDF per hotel to invoices/<period>/<hotel-code>.pdf.
//
// Setup (one-time):
//   npm install
//
// Run:
//   npm run invoices -- --month=2026-05
//   npm run invoices -- --month=2026-05 --hotel=fairmont-ll
//   npm run invoices -- --from=2026-05-01 --to=2026-05-31
//   npm run invoices                      # defaults to last full calendar month
//
// Or directly:
//   node --env-file=scripts/supabase/.env scripts/horizon/generate-invoices.mjs --month=2026-05
//
// Hotels with zero bookings in the period are skipped (no empty PDFs).
// Output is gitignored — PDFs contain guest names + emails.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

const CORAL = "#FF6B4A";
const NEAR_BLACK = "#1A1A2E";
const MID_GRAY = "#6B7280";
const BORDER = "#EAEAE5";
const SURFACE = "#FAFAF7";

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
      label: `${formatLongDate(args.from)} – ${formatLongDate(args.to)}`,
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

// ── PDF rendering ─────────────────────────────────────────────────────
function drawHeader(doc, hotel, range, invoiceNumber) {
  // Coral logo square + wordmark.
  doc.save();
  doc.roundedRect(50, 50, 32, 32, 6).fill(CORAL);
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(20).text("h", 60, 56);
  doc.restore();

  doc.font("Helvetica-Bold").fontSize(18).fillColor(NEAR_BLACK).text("Horizon Tours", 92, 56);
  doc.font("Helvetica").fontSize(10).fillColor(MID_GRAY).text("gowithhorizon.com", 92, 76);

  // Right-aligned invoice meta.
  doc.font("Helvetica").fontSize(10).fillColor(MID_GRAY)
    .text("Commission statement", 400, 56, { width: 145, align: "right" });
  doc.font("Helvetica-Bold").fontSize(10).fillColor(NEAR_BLACK)
    .text(invoiceNumber, 400, 70, { width: 145, align: "right" });
  doc.font("Helvetica").fontSize(9).fillColor(MID_GRAY)
    .text(`Generated ${formatLongDate(ymd(new Date()))}`, 400, 84, { width: 145, align: "right" });

  // Hotel name + period.
  doc.y = 115;
  doc.x = 50;
  doc.font("Helvetica-Bold").fontSize(20).fillColor(NEAR_BLACK).text(hotel.name);
  doc.font("Helvetica").fontSize(11).fillColor(MID_GRAY).text(`Period: ${range.label}`);
  doc.moveDown(1);
}

function drawSummary(doc, hotel, totals) {
  const y = doc.y + 4;
  const cardH = totals.kickbacks_total > 0 ? 134 : 116;

  doc.save();
  doc.roundedRect(50, y, 495, cardH, 8).fillAndStroke(SURFACE, BORDER);
  doc.restore();

  let cy = y + 14;
  function row(label, value, opts = {}) {
    doc.font("Helvetica").fontSize(10).fillColor(MID_GRAY).text(label, 65, cy);
    doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(opts.big ? 14 : 10)
      .fillColor(opts.coral ? CORAL : NEAR_BLACK)
      .text(value, 350, cy - (opts.big ? 2 : 0), { width: 180, align: "right" });
    cy += opts.big ? 24 : 18;
  }
  function rule() {
    doc.moveTo(65, cy + 2).lineTo(530, cy + 2).strokeColor(BORDER).stroke();
    cy += 8;
  }

  row("Total bookings", String(totals.bookings));
  row("Gross revenue", formatMoney(totals.revenue));
  row("Commission rate", `${hotel.commission_pct}%`);
  rule();
  row("Commission owed", formatMoney(totals.commission_owed), { bold: true });
  if (totals.kickbacks_total > 0) {
    row("Plus kickbacks owed", formatMoney(totals.kickbacks_total));
  }
  rule();
  row("Total payable", formatMoney(totals.total_payable), {
    bold: true,
    big: true,
    coral: true,
  });

  doc.y = y + cardH + 18;
  doc.x = 50;
}

function drawKickbackBreakdown(doc, kickbacks) {
  if (!kickbacks || kickbacks.length === 0) return;
  doc.font("Helvetica-Bold").fontSize(12).fillColor(NEAR_BLACK).text("Kickback breakdown", 50);
  doc.moveDown(0.5);
  drawTable(doc, {
    cols: [
      { label: "Staff", width: 180 },
      { label: "Rate", width: 60, align: "right" },
      { label: "Bookings", width: 75, align: "right" },
      { label: "Revenue", width: 90, align: "right" },
      { label: "Kickback", width: 90, align: "right" },
    ],
    rows: kickbacks.map((k) => [
      k.staff_name,
      `${k.kickback_pct}%`,
      String(k.bookings),
      formatMoney(k.revenue),
      formatMoney(k.kickback_owed),
    ]),
  });
  doc.moveDown(1);
}

function drawBookings(doc, records) {
  doc.font("Helvetica-Bold").fontSize(12).fillColor(NEAR_BLACK).text("Bookings", 50);
  doc.moveDown(0.5);
  if (records.length === 0) {
    doc.font("Helvetica").fontSize(10).fillColor(MID_GRAY).text("No confirmed bookings in this period.");
    return;
  }
  drawTable(doc, {
    cols: [
      { label: "Booked",      width: 60 },
      { label: "Tour date",   width: 60 },
      { label: "Guest",       width: 110 },
      { label: "Tour",        width: 130 },
      { label: "Trav.",       width: 35,  align: "right" },
      { label: "Amount",      width: 70,  align: "right" },
      { label: "Attribution", width: 80 },
    ],
    rows: records.map((r) => {
      const travelers = (r.adults || 0) + (r.youth || 0) + (r.infants || 0);
      const attr = r.staff && r.staff.name ? r.staff.name : "hotel pool";
      return [
        formatShortDate(r.created_at),
        formatShortDate(r.date),
        r.lead_name || "—",
        r.tour_title || "—",
        String(travelers),
        formatMoney(r.amount || 0),
        attr,
      ];
    }),
  });
}

function drawTable(doc, { cols, rows }) {
  const startX = 50;
  const lineH = 18;
  const totalW = cols.reduce((s, c) => s + c.width, 0);
  let y = doc.y;

  // Header row.
  let x = startX;
  doc.font("Helvetica-Bold").fontSize(9).fillColor(MID_GRAY);
  cols.forEach((c) => {
    doc.text(c.label, x, y, { width: c.width, align: c.align || "left" });
    x += c.width;
  });
  y += lineH - 4;
  doc.moveTo(startX, y).lineTo(startX + totalW, y).strokeColor(BORDER).stroke();
  y += 4;

  // Body rows; paginate when we approach the bottom margin.
  doc.font("Helvetica").fontSize(9).fillColor(NEAR_BLACK);
  rows.forEach((row) => {
    if (y + lineH > 760) {
      doc.addPage();
      y = 60;
    }
    x = startX;
    cols.forEach((c, i) => {
      doc.text(String(row[i] ?? ""), x, y, {
        width: c.width,
        align: c.align || "left",
        ellipsis: true,
        lineBreak: false,
      });
      x += c.width;
    });
    y += lineH;
  });
  doc.y = y;
  doc.x = startX;
}

function drawFooter(doc) {
  const totalPages = doc.bufferedPageRange().count;
  for (let i = 0; i < totalPages; i++) {
    doc.switchToPage(i);
    doc.font("Helvetica").fontSize(9).fillColor(MID_GRAY).text(
      "Payable by the 15th of the following month. Questions? hello@gowithhorizon.com",
      50, 800, { width: 495, align: "center" },
    );
  }
}

// ── Per-hotel generator ───────────────────────────────────────────────
async function generateForHotel(hotel, range, outDir) {
  const fields =
    "id,confirmation_code,date,time,adults,youth,infants,amount,currency," +
    "tour_title,tour_id,lead_name,bokun_tracking_code,created_at," +
    "staff:hotel_staff(id,code,name,kickback_pct)";
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
  const totals = { bookings: records.length, revenue: 0, commission_owed: 0, kickbacks_total: 0 };
  const staffMap = new Map();
  for (const r of records) {
    totals.revenue += r.amount;
    totals.commission_owed += (r.amount * commissionPct) / 100;
    if (r.staff) {
      const code = r.staff.code;
      let s = staffMap.get(code);
      if (!s) {
        s = {
          staff_code:    code,
          staff_name:    r.staff.name,
          kickback_pct:  Number(r.staff.kickback_pct) || 0,
          bookings:      0,
          revenue:       0,
          kickback_owed: 0,
        };
        staffMap.set(code, s);
      }
      const kAmt = (r.amount * s.kickback_pct) / 100;
      s.bookings += 1;
      s.revenue += r.amount;
      s.kickback_owed += kAmt;
      totals.kickbacks_total += kAmt;
    }
  }
  totals.revenue         = round2(totals.revenue);
  totals.commission_owed = round2(totals.commission_owed);
  totals.kickbacks_total = round2(totals.kickbacks_total);
  totals.total_payable   = round2(totals.commission_owed + totals.kickbacks_total);
  staffMap.forEach((s) => {
    s.revenue       = round2(s.revenue);
    s.kickback_owed = round2(s.kickback_owed);
  });

  const dir = path.join(outDir, range.slug);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${hotel.code}.pdf`);
  const invoiceNumber = `HZN-${range.slug}-${hotel.code}`.toUpperCase();

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

  drawHeader(doc, { ...hotel, commission_pct: commissionPct }, range, invoiceNumber);
  drawSummary(doc, { ...hotel, commission_pct: commissionPct }, totals);
  drawKickbackBreakdown(doc, Array.from(staffMap.values()));
  drawBookings(doc, records);
  drawFooter(doc);
  doc.end();

  console.log(
    `  ${hotel.code}: ${records.length} booking(s) → ${path.relative(REPO, file)}`,
  );
  return file;
}

// ── Helpers ───────────────────────────────────────────────────────────
function ymd(d) {
  return (
    d.getUTCFullYear() + "-" +
    String(d.getUTCMonth() + 1).padStart(2, "0") + "-" +
    String(d.getUTCDate()).padStart(2, "0")
  );
}
function round2(n) { return Math.round(n * 100) / 100; }
function formatMoney(n) {
  return "CA$" + (Math.round((n || 0) * 100) / 100).toFixed(2);
}
function formatShortDate(s) {
  if (!s) return "—";
  if (typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [, m, d] = s.split("-").map(Number);
    return `${monthShort(m)} ${d}`;
  }
  const dd = new Date(s);
  if (isNaN(dd.getTime())) return "—";
  return `${monthShort(dd.getMonth() + 1)} ${dd.getDate()}`;
}
function formatLongDate(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || "";
  const [y, m, d] = s.split("-").map(Number);
  return `${monthShort(m)} ${d}, ${y}`;
}
function monthShort(m) {
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1] || "";
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
      "&select=id,code,name,location,type,commission_pct,kickback_pool_pct,bokun_tracking_code",
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
