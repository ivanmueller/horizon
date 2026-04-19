/* ============================================================
   Horizon Dashboard — Hero strip (benchmark ribbon + KPI cards)
   ------------------------------------------------------------
   Renders the four hero KPIs and the competitive ribbon that
   sits above them.

     1. Commission Earned       — coral value, coral sparkline
     2. Scan → Book Rate        — conversion across all QR
                                  placements in the active window
     3. Avg. per Booking        — commission / booking count
     4. Next Payout             — confirmed-but-unpaid total +
                                  next payout date / countdown

   Brand colour rules enforced here:
     • Coral is used ONLY on the commission value + its sparkline.
     • Deltas use green (▲) / red (▼) / gray (flat) — never coral.
     • Other sparklines render in mid-gray so the eye keeps
       tracking revenue as the single coral signal on the row.

   Reacts to both 'dash:range-change' (header toggle) and
   'dash:filters-change' (pill filters) so every widget stays
   in sync.
   ============================================================ */
(function () {
  'use strict';

  const data = window.HorizonData;
  if (!data) return;

  const DAY_MS = 86400000;
  const TODAY_MS = new Date(data.meta.today + 'T00:00:00').getTime();

  // Centralised range helper — defined in filters.js and
  // exposed on window.HorizonDashboard. Every widget on the
  // page reads its active window through this so the five
  // preset chips (This Month, Last Month, Last 30 Days, YTD,
  // Custom) resolve consistently.
  function getWindow(key) {
    const fn = window.HorizonDashboard && window.HorizonDashboard.range;
    if (fn) return fn(key);
    const endMs = TODAY_MS;
    const startMs = endMs - 29 * DAY_MS;
    return {
      key, startMs, endMs, days: 30, label: 'Last 30 days',
      priorStartMs: startMs - 30 * DAY_MS,
      priorEndMs:   startMs - DAY_MS,
      priorDays: 30, priorLabel: 'Previous 30 days'
    };
  }

  // Resolve brand colours from CSS custom properties so the
  // sparklines automatically follow any future token changes.
  const SPARK_COLORS = {
    'total-commission': readVar('--coral',    '#FF6B4A'),
    'scan-book-rate':   readVar('--mid-gray', '#6B7280'),
    'avg-commission':   readVar('--mid-gray', '#6B7280')
  };

  function readVar(name, fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) {
      return fallback;
    }
  }

  // ---- Formatters ------------------------------------------
  const currencyFmt = (decimals) => new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: data.meta.currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });

  function formatCurrency(n, decimals) {
    const fmt = currencyFmt(decimals == null ? 0 : decimals);
    return fmt.format(n) + ' ' + data.meta.currency;
  }

  function formatPct(n, decimals) {
    const d = decimals == null ? 1 : decimals;
    return n.toFixed(d) + '%';
  }

  function formatPrettyDate(iso) {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-CA', {
      month: 'long', day: 'numeric', year: 'numeric'
    });
  }

  function toIso(ms) {
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function daysUntil(iso) {
    const target = new Date(iso + 'T00:00:00').getTime();
    return Math.max(0, Math.round((target - TODAY_MS) / DAY_MS));
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // Pull from the shared, filter-aware booking pool.
  function pool() {
    const dash = window.HorizonDashboard;
    return (dash && typeof dash.getFilteredBookings === 'function')
      ? dash.getFilteredBookings()
      : data.bookings;
  }

  function bookingDateMs(b) {
    return new Date(b.date + 'T00:00:00').getTime();
  }

  function filterByWindow(bookings, startMs, endMs) {
    return bookings.filter(b => {
      const t = bookingDateMs(b);
      return t >= startMs && t <= endMs;
    });
  }

  function scanCountInWindow(startMs, endMs) {
    return data.scans.reduce((sum, row) => {
      const t = new Date(row.date + 'T00:00:00').getTime();
      return (t >= startMs && t <= endMs) ? sum + row.count : sum;
    }, 0);
  }

  // ---- Metric computation ----------------------------------
  function computeMetrics(rangeKey) {
    const win = getWindow(rangeKey);

    const bookingsPool = pool();
    const cur = filterByWindow(bookingsPool, win.startMs, win.endMs);
    const prv = filterByWindow(bookingsPool, win.priorStartMs, win.priorEndMs);

    const sum = arr => arr.reduce((s, b) => s + b.commission, 0);
    const curScans = scanCountInWindow(win.startMs, win.endMs);
    const prvScans = scanCountInWindow(win.priorStartMs, win.priorEndMs);

    const current = {
      total: sum(cur),
      count: cur.length,
      scans: curScans,
      rate: curScans ? (cur.length / curScans) * 100 : 0,
      avg:  cur.length ? sum(cur) / cur.length : 0
    };
    const prior = {
      total: sum(prv),
      count: prv.length,
      scans: prvScans,
      rate: prvScans ? (prv.length / prvScans) * 100 : 0,
      avg:  prv.length ? sum(prv) / prv.length : 0
    };

    // Pending payout — the amount that will land in the next
    // cycle. Point-in-time, so unaffected by the date toggle.
    const pending = bookingsPool
      .filter(b => b.status === 'confirmed')
      .reduce((s, b) => s + b.commission, 0);

    return { current, prior, pending, win };
  }

  // ---- Daily series (for sparklines) -----------------------
  function dailyIsoList(startMs, endMs) {
    const out = [];
    for (let t = startMs; t <= endMs; t += DAY_MS) out.push(toIso(t));
    return out;
  }

  function dailyCommission(startMs, endMs) {
    const byDate = new Map();
    pool().forEach(b => {
      byDate.set(b.date, (byDate.get(b.date) || 0) + b.commission);
    });
    return dailyIsoList(startMs, endMs).map(iso => byDate.get(iso) || 0);
  }

  function dailyScanRate(startMs, endMs) {
    const bookByDate = new Map();
    pool().forEach(b => {
      bookByDate.set(b.date, (bookByDate.get(b.date) || 0) + 1);
    });
    const scanByDate = new Map();
    data.scans.forEach(s => scanByDate.set(s.date, s.count));
    return dailyIsoList(startMs, endMs).map(iso => {
      const s = scanByDate.get(iso) || 0;
      const b = bookByDate.get(iso) || 0;
      return s > 0 ? (b / s) * 100 : 0;
    });
  }

  function dailyAvg(startMs, endMs) {
    const totalByDate = new Map();
    const countByDate = new Map();
    pool().forEach(b => {
      totalByDate.set(b.date, (totalByDate.get(b.date) || 0) + b.commission);
      countByDate.set(b.date, (countByDate.get(b.date) || 0) + 1);
    });
    return dailyIsoList(startMs, endMs).map(iso => {
      const c = countByDate.get(iso) || 0;
      return c ? (totalByDate.get(iso) / c) : 0;
    });
  }

  // ---- Sparkline renderer ----------------------------------
  // Tiny SVG line, normalised to the given viewBox. A flat
  // series (or all zeros) draws at the vertical midpoint so
  // the card never looks broken.
  function sparklineSvg(values, color) {
    const W = 80, H = 20, PAD = 2;
    if (!values.length) return '';
    const max = Math.max.apply(null, values);
    const min = Math.min.apply(null, values);
    const range = (max - min) || 1;
    const step = values.length > 1 ? W / (values.length - 1) : 0;
    const innerH = H - PAD * 2;
    const flat = (max - min) === 0;
    let d = '';
    values.forEach((v, i) => {
      const x = i * step;
      const y = flat
        ? (H / 2)
        : (PAD + innerH - ((v - min) / range) * innerH);
      d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" ' +
           'xmlns="http://www.w3.org/2000/svg">' +
           '<path d="' + d + '" fill="none" stroke="' + color + '" ' +
           'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
           '</svg>';
  }

  // ---- Trend helpers ---------------------------------------
  // Percentage change → '▲ +12.4% vs. prev.' / gray 'Flat' / 'New'.
  function trendPct(current, prior) {
    if (prior === 0 && current === 0) return { dir: 'flat', magnitude: 0 };
    if (prior === 0) return { dir: 'new', magnitude: null };
    const pct = (current - prior) / prior * 100;
    if (Math.abs(pct) < 0.5) return { dir: 'flat', magnitude: 0 };
    return { dir: pct > 0 ? 'up' : 'down', magnitude: Math.abs(pct) };
  }

  // Absolute-point change (used for the Scan→Book rate, where
  // a percentage-of-a-percentage gets confusing).
  function trendPoints(current, prior) {
    const delta = current - prior;
    if (Math.abs(delta) < 0.05) return { dir: 'flat', magnitude: 0 };
    return { dir: delta > 0 ? 'up' : 'down', magnitude: Math.abs(delta) };
  }

  function trendClass(dir) {
    if (dir === 'up')   return 'kpi-card__trend--up';
    if (dir === 'down') return 'kpi-card__trend--down';
    if (dir === 'neutral') return 'kpi-card__trend--neutral';
    return 'kpi-card__trend--flat';
  }

  function pctTrendText(t) {
    const tail = ' vs. prev.';
    if (t.dir === 'flat') return 'Flat' + tail;
    if (t.dir === 'new')  return 'New'  + tail;
    const arrow = t.dir === 'up' ? '▲' : '▼';
    const sign  = t.dir === 'up' ? '+' : '−';
    return arrow + ' ' + sign + t.magnitude.toFixed(1) + '%' + tail;
  }

  function pointsTrendText(t, unit) {
    const tail = ' vs. prev.';
    if (t.dir === 'flat') return 'Flat' + tail;
    const arrow = t.dir === 'up' ? '▲' : '▼';
    const sign  = t.dir === 'up' ? '+' : '−';
    return arrow + ' ' + sign + t.magnitude.toFixed(1) + unit + tail;
  }

  // ---- DOM helpers -----------------------------------------
  function updateCard(key, payload) {
    const card = document.querySelector('[data-kpi="' + key + '"]');
    if (!card) return;
    const valEl  = card.querySelector('[data-kpi-value]');
    const trnEl  = card.querySelector('[data-kpi-trend]');
    const sprkEl = card.querySelector('[data-kpi-sparkline]');
    if (valEl) valEl.textContent = payload.value;
    if (trnEl) {
      trnEl.className = 'kpi-card__trend ' + trendClass(payload.trendDir);
      trnEl.textContent = payload.trendText;
    }
    if (sprkEl) sprkEl.innerHTML = payload.spark || '';
  }

  // ---- Benchmark ribbon ------------------------------------
  function renderBenchmark() {
    const el = document.querySelector('[data-benchmark-text]');
    const b  = data.benchmark;
    if (!el || !b) return;
    const topPct = Math.max(1, 100 - b.percentile);
    el.innerHTML =
      'You\u2019re in the <strong>top ' + topPct + '%</strong> of ' +
      escapeHtml(b.cohortLabel) + ' ' + escapeHtml(b.periodLabel) +
      ' \u2014 <strong>' + b.multipleOfAverage.toFixed(1) + '\u00D7</strong> ' +
      'the regional average per room.';
  }

  // ---- Master render --------------------------------------
  function render(rangeKey) {
    const m = computeMetrics(rangeKey);

    // Card 1 — Commission Earned
    const commTrend = trendPct(m.current.total, m.prior.total);
    updateCard('total-commission', {
      value: formatCurrency(m.current.total),
      trendDir: commTrend.dir,
      trendText: pctTrendText(commTrend),
      spark: sparklineSvg(dailyCommission(m.win.startMs, m.win.endMs),
                          SPARK_COLORS['total-commission'])
    });

    // Card 2 — Scan → Book Rate
    const rateTrend = trendPoints(m.current.rate, m.prior.rate);
    updateCard('scan-book-rate', {
      value: formatPct(m.current.rate),
      trendDir: rateTrend.dir,
      trendText: pointsTrendText(rateTrend, 'pp'),
      spark: sparklineSvg(dailyScanRate(m.win.startMs, m.win.endMs),
                          SPARK_COLORS['scan-book-rate'])
    });

    // Card 3 — Avg. per Booking
    const avgTrend = trendPct(m.current.avg, m.prior.avg);
    updateCard('avg-commission', {
      value: formatCurrency(m.current.avg, 2),
      trendDir: avgTrend.dir,
      trendText: pctTrendText(avgTrend),
      spark: sparklineSvg(dailyAvg(m.win.startMs, m.win.endMs),
                          SPARK_COLORS['avg-commission'])
    });

    // Card 4 — Next Payout
    const next = data.meta.nextPayoutDate;
    const d = daysUntil(next);
    const rel = d === 0 ? 'today' : (d === 1 ? 'tomorrow' : 'in ' + d + ' days');
    updateCard('next-payout', {
      value: formatCurrency(m.pending),
      trendDir: 'neutral',
      trendText: formatPrettyDate(next) + ' \u00B7 ' + rel,
      spark: ''
    });
  }

  // ---- Wire up --------------------------------------------
  function getActiveRange() {
    const el = document.querySelector('.date-toggle__option[aria-pressed="true"]');
    return (el && el.dataset.range) || '30d';
  }

  window.addEventListener('dash:range-change', function (e) {
    render((e.detail && e.detail.range) || getActiveRange());
  });
  window.addEventListener('dash:filters-change', function () {
    render(getActiveRange());
  });

  function init() {
    renderBenchmark();
    render(getActiveRange());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
