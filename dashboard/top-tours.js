/* ============================================================
   Horizon Dashboard — Top Tours card
   ------------------------------------------------------------
   Lists every tour ranked by commission inside the active
   window. Each row shows the tour name, total commission, and
   booking count, plus a thin relative bar.

   The #1 row is marked with the coral accent — coral == value,
   so the eye lands on the tour to stock more brochures for.
   Every other row renders in a neutral mid-gray fill so there
   is exactly one coral signal per card.
   ============================================================ */
(function () {
  'use strict';

  const data = window.HorizonData;
  if (!data) return;

  const DAY_MS = (window.HorizonDashboard && window.HorizonDashboard.DAY_MS) || 86400000;
  const TODAY_MS = new Date(data.meta.today + 'T00:00:00').getTime();

  const listEl  = document.querySelector('[data-top-tours-list]');
  const metaEl  = document.querySelector('[data-top-tours-meta]');
  const emptyEl = document.querySelector('[data-top-tours-empty]');
  if (!listEl) return;

  const currencyFmt = new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: data.meta.currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
  const formatCurrency = n => currencyFmt.format(n) + ' ' + data.meta.currency;

  const tourById = Object.fromEntries(data.tours.map(t => [t.id, t]));

  function getWindow(key) {
    const fn = window.HorizonDashboard && window.HorizonDashboard.range;
    if (fn) return fn(key);
    const endMs = TODAY_MS;
    return { key, startMs: endMs - 29 * DAY_MS, endMs, days: 30, label: 'Last 30 days' };
  }

  function pool() {
    const dash = window.HorizonDashboard;
    return (dash && typeof dash.getFilteredBookings === 'function')
      ? dash.getFilteredBookings()
      : data.bookings;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function aggregate(win) {
    const agg = new Map();
    pool().forEach(b => {
      const t = new Date(b.date + 'T00:00:00').getTime();
      if (t < win.startMs || t > win.endMs) return;
      if (!agg.has(b.tourId)) {
        agg.set(b.tourId, { tourId: b.tourId, total: 0, count: 0 });
      }
      const row = agg.get(b.tourId);
      row.total += b.commission;
      row.count += 1;
    });
    return [...agg.values()].sort((a, b) => b.total - a.total);
  }

  function render(rangeKey) {
    const win = getWindow(rangeKey);
    const rows = aggregate(win);
    if (metaEl) metaEl.textContent = win.label;

    if (!rows.length) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.hidden = false;
      return;
    }
    if (emptyEl) emptyEl.hidden = true;

    const max = rows[0].total || 1;
    listEl.innerHTML = rows.map((r, i) => {
      const tour = tourById[r.tourId];
      const name = tour ? (tour.shortName || tour.name) : r.tourId;
      const pct = Math.max(4, Math.round((r.total / max) * 100));
      const countLabel = r.count === 1 ? '1 booking' : r.count + ' bookings';
      const topCls = i === 0 ? ' top-tours__row--top' : '';
      return (
        '<li class="top-tours__row' + topCls + '">' +
          '<span class="top-tours__name">' + escapeHtml(name) + '</span>' +
          '<span class="top-tours__amount">' + formatCurrency(r.total) + '</span>' +
          '<span class="top-tours__bar">' +
            '<span class="top-tours__bar-fill" style="width:' + pct + '%"></span>' +
          '</span>' +
          '<span class="top-tours__count">' + countLabel + '</span>' +
        '</li>'
      );
    }).join('');
  }

  function getActiveRange() {
    const el = document.querySelector('.date-toggle__option[aria-pressed="true"]');
    return (el && el.dataset.range) || 'thisMonth';
  }

  window.addEventListener('dash:range-change', function (e) {
    render((e.detail && e.detail.range) || getActiveRange());
  });
  window.addEventListener('dash:filters-change', function () {
    render(getActiveRange());
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { render(getActiveRange()); });
  } else {
    render(getActiveRange());
  }
})();
