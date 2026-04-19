/* ============================================================
   Horizon Dashboard — Guest Profile card
   ------------------------------------------------------------
   Three aggregate-only dimensions:

     • Origin          — top 3 countries + "Other" bucket
     • Party split     — Solo / Couple / Small group / Family
     • Booking lead    — average days + min–max spread

   NO age, gender, or individual identifiers. Aggregate buckets
   only. That's the line between useful and creepy; hotels will
   raise it immediately if it's crossed.
   ============================================================ */
(function () {
  'use strict';

  const data = window.HorizonData;
  if (!data) return;

  const DAY_MS = 86400000;
  const TODAY_MS = new Date(data.meta.today + 'T00:00:00').getTime();

  // ---- DOM refs --------------------------------------------
  const card       = document.querySelector('[data-guest-profile]');
  const metaEl     = document.querySelector('[data-guest-profile-meta]');
  const countryEl  = document.querySelector('[data-guest-profile-countries]');
  const barEl      = document.querySelector('[data-guest-profile-bar]');
  const legendEl   = document.querySelector('[data-guest-profile-legend]');
  const leadAvgEl  = document.querySelector('[data-guest-profile-lead-avg]');
  const leadRngEl  = document.querySelector('[data-guest-profile-lead-range]');
  const emptyEl    = document.querySelector('[data-guest-profile-empty]');
  if (!card || !countryEl || !barEl) return;

  // ---- Party buckets --------------------------------------
  const PARTY_BUCKETS = [
    { key: 'solo',   label: 'Solo',        test: n => n === 1, cls: 'guest-profile__bar-seg--solo' },
    { key: 'couple', label: 'Couple',      test: n => n === 2, cls: 'guest-profile__bar-seg--couple' },
    { key: 'small',  label: 'Small group', test: n => n === 3, cls: 'guest-profile__bar-seg--small' },
    { key: 'family', label: 'Family',      test: n => n >= 4,  cls: 'guest-profile__bar-seg--family' }
  ];

  // ---- Helpers --------------------------------------------
  function daysForRange(rangeKey) {
    if (rangeKey === '7d') return 7;
    if (rangeKey === '90d') return 90;
    return 30;
  }

  function rangeLabel(rangeKey) {
    return 'Last ' + daysForRange(rangeKey) + ' days';
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

  function inWindow(rangeKey) {
    const days = daysForRange(rangeKey);
    const endMs = TODAY_MS;
    const startMs = endMs - (days - 1) * DAY_MS;
    return pool().filter(b => {
      const t = new Date(b.date + 'T00:00:00').getTime();
      return t >= startMs && t <= endMs;
    });
  }

  // ---- Aggregations ---------------------------------------
  function topCountries(bookings) {
    const counts = new Map();
    bookings.forEach(b => {
      const c = (b.guest && b.guest.originCountry) || 'Other';
      counts.set(c, (counts.get(c) || 0) + 1);
    });
    const total = bookings.length || 1;
    const sorted = [...counts.entries()]
      .sort((a, b) => b[1] - a[1]);

    const top = sorted.slice(0, 3).map(([country, count]) => ({
      country,
      count,
      pct: Math.round((count / total) * 100)
    }));
    const otherCount = sorted.slice(3).reduce((s, [, n]) => s + n, 0);
    if (otherCount > 0) {
      top.push({ country: 'Other', count: otherCount, pct: Math.round((otherCount / total) * 100) });
    }
    return top;
  }

  function partyBuckets(bookings) {
    const counts = { solo: 0, couple: 0, small: 0, family: 0 };
    bookings.forEach(b => {
      for (const bucket of PARTY_BUCKETS) {
        if (bucket.test(b.partySize)) { counts[bucket.key]++; break; }
      }
    });
    const total = bookings.length || 1;
    return PARTY_BUCKETS.map(bucket => ({
      key: bucket.key,
      label: bucket.label,
      cls: bucket.cls,
      count: counts[bucket.key],
      pct: (counts[bucket.key] / total) * 100
    }));
  }

  function leadStats(bookings) {
    const lead = bookings
      .map(b => b.leadTimeDays)
      .filter(n => typeof n === 'number' && isFinite(n));
    if (!lead.length) return null;
    const sum = lead.reduce((s, n) => s + n, 0);
    return {
      avg: Math.round(sum / lead.length),
      min: Math.min.apply(null, lead),
      max: Math.max.apply(null, lead)
    };
  }

  // ---- Rendering ------------------------------------------
  function renderCountries(rows) {
    if (!rows.length) {
      countryEl.innerHTML = '';
      return;
    }
    countryEl.innerHTML = rows.map(r =>
      '<li class="guest-profile__country">' +
        '<span>' + escapeHtml(r.country) + '</span>' +
        '<span class="guest-profile__country-pct">' + r.pct + '%</span>' +
      '</li>'
    ).join('');
  }

  function renderParty(buckets) {
    // Only draw segments that have a non-zero share, so the bar
    // doesn't end up with invisible 0-width children pushing
    // neighbours by a pixel of rounding error.
    const active = buckets.filter(b => b.count > 0);
    barEl.innerHTML = active.map(b =>
      '<span class="guest-profile__bar-seg ' + b.cls + '" style="width:' + b.pct.toFixed(2) + '%"></span>'
    ).join('');
    legendEl.innerHTML = active.map(b =>
      '<li class="guest-profile__legend-item">' +
        '<span class="guest-profile__legend-swatch ' + b.cls + '"></span>' +
        escapeHtml(b.label) + ' ' + Math.round(b.pct) + '%' +
      '</li>'
    ).join('');
  }

  function renderLead(stats) {
    if (!stats) {
      leadAvgEl.textContent = '—';
      if (leadRngEl) leadRngEl.textContent = '';
      return;
    }
    leadAvgEl.textContent = stats.avg;
    if (leadRngEl) leadRngEl.textContent = stats.min + '–' + stats.max + ' day range';
  }

  function render(rangeKey) {
    const bookings = inWindow(rangeKey);
    if (metaEl) metaEl.textContent = rangeLabel(rangeKey);

    if (!bookings.length) {
      if (emptyEl) emptyEl.hidden = false;
      countryEl.innerHTML = '';
      barEl.innerHTML = '';
      legendEl.innerHTML = '';
      leadAvgEl.textContent = '—';
      if (leadRngEl) leadRngEl.textContent = '';
      return;
    }
    if (emptyEl) emptyEl.hidden = true;

    renderCountries(topCountries(bookings));
    renderParty(partyBuckets(bookings));
    renderLead(leadStats(bookings));
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { render(getActiveRange()); });
  } else {
    render(getActiveRange());
  }
})();
