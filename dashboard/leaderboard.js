/* ============================================================
   Horizon Dashboard — Staff Leaderboard
   ------------------------------------------------------------
   Ranks concierges by commission inside the active window.
   Adapts to two pricing models via
   property.config.employeeKickbacksEnabled:

     ON  — title "Top Staff", Kickback ON pill (green tint),
           dollar earnings + booking count per row.
     OFF — title "Top Referring Staff", Kickback OFF pill
           (neutral gray), booking count only (no dollars) —
           the card becomes pure staff recognition.

   Rank-1 avatar fills with --coral; every other row falls to
   neutral gray. Coral signals value → the GM's eye lands on
   the top performer without needing a gold star.
   ============================================================ */
(function () {
  'use strict';

  const data = window.HorizonData;
  if (!data) return;

  const DAY_MS = 86400000;
  const TODAY_MS = new Date(data.meta.today + 'T00:00:00').getTime();
  const MAX_ROWS = 5;

  const card       = document.querySelector('[data-leaderboard]');
  const listEl     = document.querySelector('[data-leaderboard-list]');
  const metaEl     = document.querySelector('[data-leaderboard-meta]');
  const titleEl    = document.querySelector('[data-leaderboard-title]');
  const pillEl     = document.querySelector('[data-leaderboard-kickback]');
  const pillLabel  = document.querySelector('[data-leaderboard-kickback-label]');
  const emptyEl    = document.querySelector('[data-leaderboard-empty]');
  if (!card || !listEl) return;

  const kickbacksOn = !!(data.property.config && data.property.config.employeeKickbacksEnabled);

  // ---- Helpers --------------------------------------------
  const currencyFmt = new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: data.meta.currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
  const formatCurrency = n => currencyFmt.format(n) + ' ' + data.meta.currency;

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

  function initialsFor(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    const first = parts[0] ? parts[0][0] : '';
    const last  = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + last).toUpperCase() || '?';
  }

  // ---- Aggregation ----------------------------------------
  function topStaff(win) {
    const byStaff = new Map();
    pool().forEach(b => {
      const t = new Date(b.date + 'T00:00:00').getTime();
      if (t < win.startMs || t > win.endMs) return;
      if (!byStaff.has(b.staffId)) {
        byStaff.set(b.staffId, { staffId: b.staffId, total: 0, count: 0 });
      }
      const agg = byStaff.get(b.staffId);
      agg.total += b.commission;
      agg.count += 1;
    });
    const staffById = Object.fromEntries(data.staff.map(s => [s.id, s]));
    return [...byStaff.values()]
      // When kickbacks are OFF, ranking by count is more honest
      // — dollars-per-staff don't exist, so sort by what's shown.
      .sort((a, b) => kickbacksOn
        ? (b.total - a.total)
        : (b.count - a.count))
      .slice(0, MAX_ROWS)
      .map(e => Object.assign({}, e, { staff: staffById[e.staffId] }));
  }

  // ---- Rendering ------------------------------------------
  function applyMode() {
    if (titleEl) {
      titleEl.textContent = kickbacksOn ? 'Top Staff' : 'Top Referring Staff';
    }
    if (pillEl && pillLabel) {
      pillEl.classList.toggle('leaderboard__kickback--on', kickbacksOn);
      pillEl.classList.toggle('leaderboard__kickback--off', !kickbacksOn);
      pillLabel.textContent = kickbacksOn ? 'Kickback ON' : 'Kickback OFF';
      pillEl.title = kickbacksOn
        ? 'Individual commission kickbacks are enabled for this property'
        : 'Kickbacks disabled — staff shown for recognition only';
    }
    card.classList.toggle('leaderboard--count-only', !kickbacksOn);
  }

  function renderRow(entry, idx) {
    const rank = idx + 1;
    const name = entry.staff ? entry.staff.name : 'Unknown';
    const role = entry.staff ? entry.staff.role : '';
    const topCls = rank === 1 ? ' leaderboard__row--top' : '';
    const countLabel = entry.count === 1 ? '1 booking' : entry.count + ' bookings';

    let stats = '';
    if (kickbacksOn) {
      stats =
        '<div class="leaderboard__stats">' +
          '<span class="leaderboard__amount">' + formatCurrency(entry.total) + '</span>' +
          '<span class="leaderboard__count">' + countLabel + '</span>' +
        '</div>';
    } else {
      // Kickbacks OFF: show count only. The amount element is
      // intentionally absent so there's no dollar figure next to
      // a staff name — this is a recognition card, not a payroll
      // view.
      stats =
        '<div class="leaderboard__stats">' +
          '<span class="leaderboard__count">' + countLabel + '</span>' +
        '</div>';
    }

    return (
      '<li class="leaderboard__row' + topCls + '">' +
        '<span class="leaderboard__avatar" aria-hidden="true">' +
          escapeHtml(initialsFor(name)) +
        '</span>' +
        '<div class="leaderboard__info">' +
          '<span class="leaderboard__name">' + escapeHtml(name) + '</span>' +
          '<span class="leaderboard__role">' + escapeHtml(role) + '</span>' +
        '</div>' +
        stats +
      '</li>'
    );
  }

  function render(rangeKey) {
    applyMode();
    const win = getWindow(rangeKey);
    const ranked = topStaff(win);
    if (metaEl) metaEl.textContent = win.label;

    // A leaderboard of one isn't useful — hide the list and
    // show a gentle empty state instead of the whole card.
    if (ranked.length <= 1) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.hidden = false;
      return;
    }
    if (emptyEl) emptyEl.hidden = true;

    listEl.innerHTML = ranked.map(renderRow).join('');
  }

  // ---- Wire up --------------------------------------------
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

  render(getActiveRange());
})();
