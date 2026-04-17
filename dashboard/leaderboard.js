/* ============================================================
   Horizon Dashboard — Top Staff Leaderboard
   ------------------------------------------------------------
   Ranked list of staff by total commission for the active
   date range (caps at 5). #1 gets a subtle gold accent. Hides
   itself entirely if only a single staff member has bookings
   in the period, and expands the chart row to full width when
   that happens.

   Responsive behaviour (driven by CSS / native <details>):
     desktop : sits to the right of the chart, always open
     tablet  : stacks below the chart, always open
     mobile  : collapses into an accordion (tap to expand)
   ============================================================ */
(function () {
  'use strict';

  const data = window.HorizonData;
  if (!data) return;

  const DAY_MS = 86400000;
  const TODAY_MS = new Date(data.meta.today + 'T00:00:00').getTime();
  const MAX_ROWS = 5;

  const panel   = document.querySelector('[data-leaderboard]');
  const listEl  = document.querySelector('[data-leaderboard-list]');
  const metaEl  = document.querySelector('[data-leaderboard-meta]');
  const rowEl   = document.querySelector('[data-chart-row]');
  if (!panel || !listEl || !rowEl) return;

  // ---- Helpers --------------------------------------------
  const currencyFmt = new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: data.meta.currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
  const formatCurrency = n => currencyFmt.format(n) + ' ' + data.meta.currency;

  function daysForRange(rangeKey) {
    if (rangeKey === '7d') return 7;
    if (rangeKey === '90d') return 90;
    return 30;
  }

  function rangeLabel(rangeKey) {
    return 'Last ' + daysForRange(rangeKey) + ' days';
  }

  // ---- Aggregation ----------------------------------------
  function topStaff(rangeKey) {
    const days = daysForRange(rangeKey);
    const endMs = TODAY_MS;
    const startMs = endMs - (days - 1) * DAY_MS;
    const inWindow = data.bookings.filter(b => {
      const t = new Date(b.date + 'T00:00:00').getTime();
      return t >= startMs && t <= endMs;
    });
    const byStaff = new Map();
    for (const b of inWindow) {
      if (!byStaff.has(b.staffId)) {
        byStaff.set(b.staffId, { staffId: b.staffId, total: 0, count: 0 });
      }
      const agg = byStaff.get(b.staffId);
      agg.total += b.commission;
      agg.count += 1;
    }
    const staffById = Object.fromEntries(data.staff.map(s => [s.id, s]));
    return [...byStaff.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, MAX_ROWS)
      .map(e => Object.assign({}, e, { staff: staffById[e.staffId] }));
  }

  // ---- Rendering ------------------------------------------
  function render(rangeKey) {
    const ranked = topStaff(rangeKey);

    // Hide the entire card (and widen the chart) if only one
    // staff member has bookings in this period.
    if (ranked.length <= 1) {
      rowEl.classList.add('chart-row--solo');
      panel.hidden = true;
      return;
    }
    rowEl.classList.remove('chart-row--solo');
    panel.hidden = false;

    if (metaEl) metaEl.textContent = rangeLabel(rangeKey);

    listEl.innerHTML = ranked.map((entry, idx) => {
      const rank = idx + 1;
      const name = entry.staff ? entry.staff.name : 'Unknown';
      const role = entry.staff ? entry.staff.role : '';
      const amount = formatCurrency(entry.total);
      const bookings = entry.count === 1 ? '1 booking' : entry.count + ' bookings';
      const topClass = rank === 1 ? ' leaderboard__row--top' : '';
      return (
        '<li class="leaderboard__row' + topClass + '">' +
          '<span class="leaderboard__rank">' + rank + '</span>' +
          '<div class="leaderboard__info">' +
            '<span class="leaderboard__name">' + escapeHtml(name) + '</span>' +
            '<span class="leaderboard__role">' + escapeHtml(role) + '</span>' +
          '</div>' +
          '<div class="leaderboard__stats">' +
            '<span class="leaderboard__amount">' + amount + '</span>' +
            '<span class="leaderboard__count">' + bookings + '</span>' +
          '</div>' +
        '</li>'
      );
    }).join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ---- Desktop / tablet: force <details> open -------------
  function syncOpenState() {
    if (window.innerWidth >= 768) {
      panel.setAttribute('open', '');
    }
  }
  // Prevent the summary click from collapsing on desktop/tablet.
  panel.addEventListener('click', function (e) {
    if (e.target.closest('summary') && window.innerWidth >= 768) {
      e.preventDefault();
    }
  });
  window.addEventListener('resize', syncOpenState);

  // ---- Range wiring ---------------------------------------
  function getActiveRange() {
    const el = document.querySelector('.date-toggle__option[aria-pressed="true"]');
    return (el && el.dataset.range) || '30d';
  }
  window.addEventListener('dash:range-change', function (e) {
    render((e.detail && e.detail.range) || getActiveRange());
  });

  // ---- Initial render -------------------------------------
  syncOpenState();
  render(getActiveRange());
})();
