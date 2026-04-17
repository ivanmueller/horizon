/* ============================================================
   Horizon Dashboard — KPI summary cards
   ------------------------------------------------------------
   Computes four headline metrics from HorizonData and renders
   them into the .kpi-grid row. Responds to the date-range
   toggle via the 'dash:range-change' custom event dispatched by
   the header.

     1. Total Commission Earned   (% trend vs. previous period)
     2. Bookings This Period      (absolute trend vs. previous)
     3. Avg Commission per Booking(% trend vs. previous period)
     4. Pending Payout            (no trend — shows next payout)

   Pending payout is point-in-time (sum of 'confirmed' bookings),
   so it does not recompute on range changes.
   ============================================================ */
(function () {
  'use strict';

  const data = window.HorizonData;
  if (!data) return;

  const DAY_MS = 86400000;
  const TODAY_MS = new Date(data.meta.today + 'T00:00:00').getTime();

  // ---- Helpers ---------------------------------------------
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

  function formatPrettyDate(iso) {
    const dt = new Date(iso + 'T00:00:00');
    return dt.toLocaleDateString('en-CA', {
      month: 'long', day: 'numeric', year: 'numeric'
    });
  }

  function daysForRange(rangeKey) {
    if (rangeKey === '7d') return 7;
    if (rangeKey === '90d') return 90;
    return 30; // 30d and custom (until the date picker ships)
  }

  function bookingDateMs(b) {
    return new Date(b.date + 'T00:00:00').getTime();
  }

  function filterByWindow(startMs, endMs) {
    return data.bookings.filter(b => {
      const t = bookingDateMs(b);
      return t >= startMs && t <= endMs;
    });
  }

  // ---- Metric computation ----------------------------------
  function computeMetrics(rangeKey) {
    const days = daysForRange(rangeKey);
    const currentEnd = TODAY_MS;
    const currentStart = currentEnd - (days - 1) * DAY_MS;
    const priorEnd = currentStart - DAY_MS;
    const priorStart = priorEnd - (days - 1) * DAY_MS;

    const current = filterByWindow(currentStart, currentEnd);
    const prior = filterByWindow(priorStart, priorEnd);

    const sumCommission = arr => arr.reduce((s, b) => s + b.commission, 0);
    const cur = {
      total: sumCommission(current),
      count: current.length
    };
    const prv = {
      total: sumCommission(prior),
      count: prior.length
    };
    cur.avg = cur.count ? cur.total / cur.count : 0;
    prv.avg = prv.count ? prv.total / prv.count : 0;

    const pending = data.bookings
      .filter(b => b.status === 'confirmed')
      .reduce((s, b) => s + b.commission, 0);

    return { current: cur, prior: prv, pending };
  }

  // ---- Trend helpers ---------------------------------------
  // Returns { dir: 'up'|'down'|'flat'|'new', magnitude: number }
  function trendPct(current, prior) {
    if (prior === 0 && current === 0) return { dir: 'flat', magnitude: 0 };
    if (prior === 0) return { dir: 'new', magnitude: null };
    const pct = (current - prior) / prior * 100;
    if (Math.abs(pct) < 0.5) return { dir: 'flat', magnitude: 0 };
    return { dir: pct > 0 ? 'up' : 'down', magnitude: Math.abs(pct) };
  }

  function trendAbs(current, prior) {
    const delta = current - prior;
    if (delta === 0) return { dir: 'flat', magnitude: 0 };
    return { dir: delta > 0 ? 'up' : 'down', magnitude: Math.abs(delta) };
  }

  function trendText(trend, kind) {
    const suffix = ' vs. previous period';
    if (trend.dir === 'flat') return 'Flat' + suffix;
    if (trend.dir === 'new')  return 'New' + suffix;
    const arrow = trend.dir === 'up' ? '▲' : '▼';
    const sign  = trend.dir === 'up' ? '+' : '−';
    if (kind === 'pct')     return arrow + ' ' + sign + trend.magnitude.toFixed(1) + '%' + suffix;
    if (kind === 'abs')     return arrow + ' ' + sign + trend.magnitude + suffix;
    return arrow + suffix;
  }

  function trendClass(trend) {
    if (trend.dir === 'up')   return 'kpi-card__trend--up';
    if (trend.dir === 'down') return 'kpi-card__trend--down';
    return 'kpi-card__trend--flat';
  }

  // ---- DOM updates ----------------------------------------
  function setCardText(key, value, trend, trendKind) {
    const card = document.querySelector('[data-kpi="' + key + '"]');
    if (!card) return;
    card.querySelector('[data-kpi-value]').textContent = value;
    const t = card.querySelector('[data-kpi-trend]');
    t.className = 'kpi-card__trend ' + trendClass(trend);
    t.textContent = trendText(trend, trendKind);
  }

  function render(rangeKey) {
    const m = computeMetrics(rangeKey);

    setCardText(
      'total-commission',
      formatCurrency(m.current.total),
      trendPct(m.current.total, m.prior.total),
      'pct'
    );
    setCardText(
      'bookings-count',
      String(m.current.count),
      trendAbs(m.current.count, m.prior.count),
      'abs'
    );
    setCardText(
      'avg-commission',
      formatCurrency(m.current.avg, 2),
      trendPct(m.current.avg, m.prior.avg),
      'pct'
    );

    // Pending Payout — no trend; subtext is the next payout date.
    const pendingCard = document.querySelector('[data-kpi="pending-payout"]');
    if (pendingCard) {
      pendingCard.querySelector('[data-kpi-value]').textContent = formatCurrency(m.pending);
      const sub = pendingCard.querySelector('[data-kpi-trend]');
      sub.className = 'kpi-card__trend kpi-card__trend--neutral';
      sub.textContent = 'Next payout: ' + formatPrettyDate(data.meta.nextPayoutDate);
    }
  }

  // ---- Wire up --------------------------------------------
  function getActiveRange() {
    const el = document.querySelector('.date-toggle__option[aria-pressed="true"]');
    return (el && el.dataset.range) || '30d';
  }

  window.addEventListener('dash:range-change', function (e) {
    render((e.detail && e.detail.range) || getActiveRange());
  });

  // Initial render — run after DOM ready regardless of script position.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { render(getActiveRange()); });
  } else {
    render(getActiveRange());
  }
})();
