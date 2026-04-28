// Shared invoice PDF rendering — used by both the local Node script
// (scripts/horizon/generate-invoices.mjs) and the in-dashboard
// generator on /admin/.
//
// This module is environment-agnostic: it never imports `pdfkit`,
// never touches `fs` or `process`. The caller hands it an already-
// instantiated `PDFDocument` (Node or browser build) and the data,
// and it draws the layout. Caller is responsible for ending the doc
// and piping output (file stream in Node, blob-stream in browser).

const CORAL = "#FF6B4A";
const NEAR_BLACK = "#1A1A2E";
const MID_GRAY = "#6B7280";
const BORDER = "#EAEAE5";
const SURFACE = "#FAFAF7";

// ── Public API ────────────────────────────────────────────────────────

// One call → fully laid-out invoice. Caller does:
//   const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
//   doc.pipe(<sink>);
//   renderInvoice(doc, { hotel, range, totals, kickbacks, records });
//   doc.end();
export function renderInvoice(doc, { hotel, range, totals, kickbacks, records }) {
  drawHeader(doc, hotel, range, makeInvoiceNumber(range, hotel));
  drawSummary(doc, hotel, totals);
  drawKickbackBreakdown(doc, kickbacks);
  drawBookings(doc, records);
  drawFooter(doc);
}

// Roll up confirmed bookings into the totals + per-staff kickback
// breakdown the renderer expects. Pure function; no IO. Pass the
// commission_pct as a number (already coerced from the JSON-string
// numeric Postgres returns).
export function computeAggregates(records, commissionPct) {
  const totals = {
    bookings: records.length,
    revenue: 0,
    commission_owed: 0,
    kickbacks_total: 0,
  };
  const staffMap = new Map();

  for (const r of records) {
    const amount = r.amount != null ? Number(r.amount) : 0;
    totals.revenue += amount;
    totals.commission_owed += (amount * commissionPct) / 100;
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
      const kAmt = (amount * s.kickback_pct) / 100;
      s.bookings += 1;
      s.revenue += amount;
      s.kickback_owed += kAmt;
      totals.kickbacks_total += kAmt;
    }
  }

  totals.revenue         = round2(totals.revenue);
  totals.commission_owed = round2(totals.commission_owed);
  totals.kickbacks_total = round2(totals.kickbacks_total);
  totals.total_payable   = round2(totals.commission_owed + totals.kickbacks_total);

  const kickbacks = Array.from(staffMap.values()).map((s) => ({
    ...s,
    revenue:       round2(s.revenue),
    kickback_owed: round2(s.kickback_owed),
  }));

  return { totals, kickbacks };
}

export function makeInvoiceNumber(range, hotel) {
  return `HZN-${range.slug}-${hotel.code}`.toUpperCase();
}

// ── Drawing primitives ────────────────────────────────────────────────

function drawHeader(doc, hotel, range, invoiceNumber) {
  doc.save();
  doc.roundedRect(50, 50, 32, 32, 6).fill(CORAL);
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(20).text("h", 60, 56);
  doc.restore();

  doc.font("Helvetica-Bold").fontSize(18).fillColor(NEAR_BLACK).text("Horizon Tours", 92, 56);
  doc.font("Helvetica").fontSize(10).fillColor(MID_GRAY).text("gowithhorizon.com", 92, 76);

  doc.font("Helvetica").fontSize(10).fillColor(MID_GRAY)
    .text("Commission statement", 400, 56, { width: 145, align: "right" });
  doc.font("Helvetica-Bold").fontSize(10).fillColor(NEAR_BLACK)
    .text(invoiceNumber, 400, 70, { width: 145, align: "right" });
  doc.font("Helvetica").fontSize(9).fillColor(MID_GRAY)
    .text(`Generated ${formatLongDate(ymd(new Date()))}`, 400, 84, { width: 145, align: "right" });

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

  let x = startX;
  doc.font("Helvetica-Bold").fontSize(9).fillColor(MID_GRAY);
  cols.forEach((c) => {
    doc.text(c.label, x, y, { width: c.width, align: c.align || "left" });
    x += c.width;
  });
  y += lineH - 4;
  doc.moveTo(startX, y).lineTo(startX + totalW, y).strokeColor(BORDER).stroke();
  y += 4;

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

// ── Formatters / shared helpers ───────────────────────────────────────

export function ymd(d) {
  return (
    d.getUTCFullYear() + "-" +
    String(d.getUTCMonth() + 1).padStart(2, "0") + "-" +
    String(d.getUTCDate()).padStart(2, "0")
  );
}

export function round2(n) {
  return Math.round(n * 100) / 100;
}

export function formatMoney(n) {
  return "CA$" + (Math.round((n || 0) * 100) / 100).toFixed(2);
}

export function formatShortDate(s) {
  if (!s) return "—";
  if (typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [, m, d] = s.split("-").map(Number);
    return `${monthShort(m)} ${d}`;
  }
  const dd = new Date(s);
  if (isNaN(dd.getTime())) return "—";
  return `${monthShort(dd.getMonth() + 1)} ${dd.getDate()}`;
}

export function formatLongDate(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || "";
  const [y, m, d] = s.split("-").map(Number);
  return `${monthShort(m)} ${d}, ${y}`;
}

export function monthShort(m) {
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1] || "";
}
