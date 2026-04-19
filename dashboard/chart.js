/* ============================================================
   Horizon Dashboard — Commission Over Time chart
   ------------------------------------------------------------
   Mixed bar + line chart.

     Bars  — current-period commission, coral at 80% opacity.
     Line  — previous-period commission, dashed mid-gray. Time-
             aligned to the current bars (bucket N of the line =
             the same positional bucket N days earlier).

   Bucket granularity is driven by the active window size
   (daily for ≤ 35 days, weekly beyond). The five preset
   range chips — This Month, Last Month, Last 30 Days, YTD,
   Custom — all resolve through window.HorizonDashboard.range
   so the chart stays in lockstep with the KPIs, funnel, and
   context cards.
   ============================================================ */
(function () {
  'use strict';

  const data = window.HorizonData;
  if (!data || !window.Chart) return;

  const DAY_MS = 86400000;
  const TODAY_MS = new Date(data.meta.today + 'T00:00:00').getTime();
  const CORAL       = 'rgba(255, 107, 74, 0.8)';
  const CORAL_HOVER = 'rgba(255, 107, 74, 1)';
  const PRIOR_LINE  = 'rgba(107, 114, 128, 0.75)'; // --mid-gray

  // ---- Global Chart.js defaults (brand fonts) --------------
  Chart.defaults.font.family = "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.color = '#6B7280';

  // ---- Central range helper --------------------------------
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

  // ---- Date helpers ---------------------------------------
  function toIso(ms) {
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function shortDay(ms) {
    return new Date(ms).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }

  function longDay(ms) {
    return new Date(ms).toLocaleDateString('en-CA', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    });
  }

  function shortRange(startMs, endMs) {
    const start = new Date(startMs);
    const end = new Date(endMs);
    const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
    if (sameMonth) {
      return start.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) + '\u2013' + end.getDate();
    }
    return shortDay(startMs) + '\u2013' + shortDay(endMs);
  }

  function longRange(startMs, endMs) {
    return shortDay(startMs) + ' \u2013 ' + longDay(endMs);
  }

  // Pull from the shared, filter-aware pool.
  function pool() {
    const dash = window.HorizonDashboard;
    return (dash && typeof dash.getFilteredBookings === 'function')
      ? dash.getFilteredBookings()
      : data.bookings;
  }

  // ---- Aggregation -----------------------------------------
  // Parameterised on (startMs, endMs) so current + prior
  // windows share a single implementation.
  function dailyBuckets(startMs, endMs) {
    const src = pool();
    const buckets = [];
    for (let t = startMs; t <= endMs; t += DAY_MS) {
      const iso = toIso(t);
      const dayBookings = src.filter(b => b.date === iso);
      const amount = dayBookings.reduce((s, b) => s + b.commission, 0);
      buckets.push({
        label: shortDay(t),
        tooltipTitle: longDay(t),
        amount: Math.round(amount * 100) / 100,
        count: dayBookings.length
      });
    }
    return buckets;
  }

  function weeklyBuckets(startMs, endMs) {
    // Build day-level first, then roll into 7-day bins anchored
    // to endMs so the newest bin always closes on the window
    // end (works cleanly for YTD + Custom too).
    const src = pool();
    const daily = [];
    for (let t = startMs; t <= endMs; t += DAY_MS) {
      const iso = toIso(t);
      const dayBookings = src.filter(b => b.date === iso);
      daily.push({
        ms: t,
        amount: dayBookings.reduce((s, b) => s + b.commission, 0),
        count: dayBookings.length
      });
    }
    const out = [];
    for (let end = daily.length - 1; end >= 0; end -= 7) {
      const start = Math.max(0, end - 6);
      const slice = daily.slice(start, end + 1);
      const amount = slice.reduce((s, d) => s + d.amount, 0);
      const count = slice.reduce((s, d) => s + d.count, 0);
      const sMs = slice[0].ms;
      const eMs = slice[slice.length - 1].ms;
      out.unshift({
        label: shortRange(sMs, eMs),
        tooltipTitle: longRange(sMs, eMs),
        amount: Math.round(amount * 100) / 100,
        count
      });
    }
    return out;
  }

  function bucketsForWindow(startMs, endMs) {
    const span = Math.round((endMs - startMs) / DAY_MS) + 1;
    return span > 35
      ? weeklyBuckets(startMs, endMs)
      : dailyBuckets(startMs, endMs);
  }

  // ---- Chart init -----------------------------------------
  const canvas = document.getElementById('commission-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let win = getWindow(getActiveRange());
  let currentBuckets = bucketsForWindow(win.startMs, win.endMs);
  let priorBuckets   = bucketsForWindow(win.priorStartMs, win.priorEndMs);

  // When current + prior bucket counts mismatch (e.g. months
  // of different length under "This Month"), pad/trim the
  // prior series to the current length so indices align.
  function alignPrior(cur, prv) {
    if (prv.length === cur.length) return prv;
    const out = prv.slice(0, cur.length);
    while (out.length < cur.length) out.push({ amount: 0, count: 0, label: '', tooltipTitle: '' });
    return out;
  }
  priorBuckets = alignPrior(currentBuckets, priorBuckets);

  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: currentBuckets.map(b => b.label),
      datasets: [
        {
          type: 'bar',
          label: 'This period',
          data: currentBuckets.map(b => b.amount),
          backgroundColor: CORAL,
          hoverBackgroundColor: CORAL_HOVER,
          borderRadius: 4,
          borderSkipped: false,
          maxBarThickness: 40,
          order: 2
        },
        {
          type: 'line',
          label: 'Previous period',
          data: priorBuckets.map(b => b.amount),
          borderColor: PRIOR_LINE,
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          borderDash: [4, 4],
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: PRIOR_LINE,
          pointHoverBorderColor: '#FFFFFF',
          pointHoverBorderWidth: 2,
          fill: false,
          tension: 0.25,
          order: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      layout: { padding: { top: 4, right: 4, bottom: 0, left: 0 } },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#FFFFFF',
          titleColor: '#1A1A2E',
          bodyColor: '#1A1A2E',
          borderColor: '#EAEAE5',
          borderWidth: 1,
          padding: 12,
          cornerRadius: 8,
          displayColors: true,
          boxWidth: 8,
          boxHeight: 8,
          boxPadding: 6,
          titleFont: { family: "'DM Sans', sans-serif", weight: '600', size: 13 },
          bodyFont:  { family: "'DM Sans', sans-serif", weight: '400', size: 12 },
          callbacks: {
            title: items => currentBuckets[items[0].dataIndex].tooltipTitle,
            label: item => {
              const isBar = item.dataset.type === 'bar';
              const bucket = isBar
                ? currentBuckets[item.dataIndex]
                : priorBuckets[item.dataIndex];
              const prefix = isBar ? 'This period: ' : 'Previous: ';
              const amount = '$' + (bucket.amount || 0).toFixed(2) + ' ' + data.meta.currency;
              if (isBar) {
                const bookings = bucket.count === 1 ? '1 booking' : bucket.count + ' bookings';
                return [prefix + amount, '  ' + bookings];
              }
              return prefix + amount;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false, drawBorder: false },
          border: { display: false },
          ticks: {
            color: '#6B7280',
            font: { size: 11 },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 8
          }
        },
        y: {
          beginAtZero: true,
          grid: { color: '#F0F0EB', drawBorder: false },
          border: { display: false },
          ticks: {
            color: '#6B7280',
            font: { size: 11 },
            padding: 6,
            callback: v => '$' + v
          }
        }
      }
    }
  });

  // ---- Redraw on range / filter change --------------------
  function redraw(rangeKey) {
    win = getWindow(rangeKey);
    currentBuckets = bucketsForWindow(win.startMs, win.endMs);
    priorBuckets   = alignPrior(currentBuckets, bucketsForWindow(win.priorStartMs, win.priorEndMs));
    chart.data.labels = currentBuckets.map(b => b.label);
    chart.data.datasets[0].data = currentBuckets.map(b => b.amount);
    chart.data.datasets[1].data = priorBuckets.map(b => b.amount);
    chart.update();
  }

  function getActiveRange() {
    const el = document.querySelector('.date-toggle__option[aria-pressed="true"]');
    return (el && el.dataset.range) || 'thisMonth';
  }

  window.addEventListener('dash:range-change', function (e) {
    redraw((e.detail && e.detail.range) || getActiveRange());
  });
  window.addEventListener('dash:filters-change', function () {
    redraw(getActiveRange());
  });
})();
