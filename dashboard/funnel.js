/* ============================================================
   Horizon Dashboard — Conversion Funnel
   ------------------------------------------------------------
   Four stages, top to bottom:

     1. Scans            (data.scans in window)
     2. Tour Views       (data.tourViews in window)
     3. Checkout Started (data.checkoutStarts in window)
     4. Bookings         (pool() in window — filter-aware)

   Each stage renders: stage label, absolute count, and the
   stage-to-previous-stage conversion percentage (both numbers
   always shown together — one without the other is half the
   story).

   Below the funnel, a single plain-language line identifies
   the biggest stage-to-stage drop-off so interpretation
   doesn't require analytical skill:

     "Biggest leak: Tour view → Checkout (−72%)"

   Bar widths are proportional to the top stage; the final
   Bookings row is tinted --positive-tint so the color change
   marks success — the GM's eye lands on a green finish line.
   ============================================================ */
(function () {
  'use strict';

  const data = window.HorizonData;
  if (!data) return;

  const DAY_MS = 86400000;
  const TODAY_MS = new Date(data.meta.today + 'T00:00:00').getTime();

  const stagesEl = document.querySelector('[data-funnel-stages]');
  const metaEl   = document.querySelector('[data-funnel-meta]');
  const leakEl   = document.querySelector('[data-funnel-leak]');
  const leakBody = document.querySelector('[data-funnel-leak-body]');
  if (!stagesEl) return;

  // ---- Helpers --------------------------------------------
  const numberFmt = new Intl.NumberFormat('en-CA');

  function getWindow(key) {
    const fn = window.HorizonDashboard && window.HorizonDashboard.range;
    if (fn) return fn(key);
    const endMs = TODAY_MS;
    const startMs = endMs - 29 * DAY_MS;
    return { key, startMs, endMs, days: 30, label: 'Last 30 days' };
  }

  function bookingDateMs(b) {
    return new Date(b.date + 'T00:00:00').getTime();
  }

  function pool() {
    const dash = window.HorizonDashboard;
    return (dash && typeof dash.getFilteredBookings === 'function')
      ? dash.getFilteredBookings()
      : data.bookings;
  }

  function sumInWindow(rows, startMs, endMs) {
    return rows.reduce((s, row) => {
      const t = new Date(row.date + 'T00:00:00').getTime();
      return (t >= startMs && t <= endMs) ? s + row.count : s;
    }, 0);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ---- Stage computation ----------------------------------
  function computeStages(win) {
    const scans    = sumInWindow(data.scans,          win.startMs, win.endMs);
    const views    = sumInWindow(data.tourViews,      win.startMs, win.endMs);
    const checkout = sumInWindow(data.checkoutStarts, win.startMs, win.endMs);
    const bookings = pool().filter(b => {
      const t = bookingDateMs(b);
      return t >= win.startMs && t <= win.endMs;
    }).length;

    return [
      { key: 'scans',    label: 'Scans',            count: scans },
      { key: 'views',    label: 'Tour Views',       count: views },
      { key: 'checkout', label: 'Checkout Started', count: checkout },
      { key: 'bookings', label: 'Bookings',         count: bookings, final: true }
    ];
  }

  // ---- Rendering ------------------------------------------
  function pctOf(current, prior) {
    if (!prior) return null;
    return (current / prior) * 100;
  }

  function renderStage(stage, topCount, prevStage) {
    const widthPct = topCount ? Math.max(0.08, stage.count / topCount) : 0.08;
    const pct = prevStage ? pctOf(stage.count, prevStage.count) : null;
    // Top stage: show share of total (always 100%). Downstream
    // stages: show "x% of previous · y% of scans" so the reader
    // can parse the stage-to-stage drop AND overall yield.
    let pctLine;
    if (prevStage == null) {
      pctLine = '100% of scans';
    } else if (pct == null) {
      pctLine = '—';
    } else {
      const ofPrev = pct.toFixed(1) + '% of ' + prevStage.label.toLowerCase();
      const ofTop  = topCount
        ? ' · ' + (stage.count / topCount * 100).toFixed(1) + '% of scans'
        : '';
      pctLine = ofPrev + ofTop;
    }
    const finalCls = stage.final ? ' funnel__stage--final' : '';
    return (
      '<li class="funnel__stage' + finalCls + '" style="--width:' + widthPct.toFixed(3) + '">' +
        '<span class="funnel__stage-label">' + escapeHtml(stage.label) + '</span>' +
        '<span class="funnel__stage-count">' + numberFmt.format(stage.count) + '</span>' +
        '<span class="funnel__stage-pct">' + escapeHtml(pctLine) + '</span>' +
      '</li>'
    );
  }

  function findBiggestLeak(stages) {
    let worst = null;
    for (let i = 1; i < stages.length; i++) {
      const prev = stages[i - 1];
      const cur  = stages[i];
      if (!prev.count) continue;
      const retained = cur.count / prev.count;
      const drop = 1 - retained;
      if (drop <= 0) continue;
      if (!worst || drop > worst.drop) {
        worst = { from: prev, to: cur, drop, retained };
      }
    }
    return worst;
  }

  function renderLeak(stages) {
    if (!leakEl || !leakBody) return;
    const leak = findBiggestLeak(stages);
    if (!leak) {
      leakEl.hidden = true;
      return;
    }
    leakEl.hidden = false;
    const dropPct = Math.round(leak.drop * 100);
    leakBody.innerHTML =
      '<span class="funnel__leak-stage">' +
        escapeHtml(leak.from.label) + ' \u2192 ' + escapeHtml(leak.to.label) +
      '</span> ' +
      '<span class="funnel__leak-drop">\u2212' + dropPct + '%</span> ' +
      'of guests drop off here.';
  }

  function render(rangeKey) {
    const win = getWindow(rangeKey);
    const stages = computeStages(win);
    const top = stages[0].count;

    if (metaEl) metaEl.textContent = win.label;

    if (top === 0) {
      stagesEl.innerHTML = '<li class="funnel__empty">No scan activity in this window yet.</li>';
      if (leakEl) leakEl.hidden = true;
      return;
    }

    stagesEl.innerHTML = stages
      .map((s, i) => renderStage(s, top, i === 0 ? null : stages[i - 1]))
      .join('');
    renderLeak(stages);
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { render(getActiveRange()); });
  } else {
    render(getActiveRange());
  }
})();
