/* ============================================================
   Horizon Dashboard — Commission Over Time chart
   ------------------------------------------------------------
   Mixed bar + line chart.

     Bars  — current-period commission, coral at 80% opacity.
     Line  — previous-period commission, dashed mid-gray. Time-
             aligned to the current bars (bucket N of the line =
             the same positional bucket N days earlier).

   The prior-period line is deliberately recessive: thin, dashed,
   gray. The current period must dominate visually per the brand
   rule "coral == revenue"; the line is pure comparison context.
   Redraws on 'dash:range-change' and 'dash:filters-change'.
   ============================================================ */
(function () {
  'use strict';

  const data = window.HorizonData;
  if (!data || !window.Chart) return;

  const DAY_MS = 86400000;
  const TODAY_MS = new Date(data.meta.today + 'T00:00:00').getTime();
  const CORAL        = 'rgba(255, 107, 74, 0.8)';
  const CORAL_HOVER  = 'rgba(255, 107, 74, 1)';
  const PRIOR_LINE   = 'rgba(107, 114, 128, 0.75)'; // --mid-gray

  // ---- Global Chart.js defaults (brand fonts) --------------
  Chart.defaults.font.family = "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.color = '#6B7280';

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
      return start.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) + '–' + end.getDate();
    }
    return shortDay(startMs) + '–' + shortDay(endMs);
  }

  function longRange(startMs, endMs) {
    return shortDay(startMs) + ' – ' + longDay(endMs);
  }

  function daysForRange(rangeKey) {
    if (rangeKey === '7d') return 7;
    if (rangeKey === '90d') return 90;
    return 30;
  }

  // Pull from the shared, filter-aware pool.
  function pool() {
    const dash = window.HorizonDashboard;
    return (dash && typeof dash.getFilteredBookings === 'function')
      ? dash.getFilteredBookings()
      : data.bookings;
  }

  // ---- Aggregation -----------------------------------------
  // Parameterised on endMs so we can reuse the same functions
  // for both the current period (endMs = today) and the prior
  // period (endMs = currentStart - 1 day).
  function dailyBuckets(days, endMs) {
    const src = pool();
    const buckets = [];
    for (let i = days - 1; i >= 0; i--) {
      const dayMs = endMs - i * DAY_MS;
      const iso = toIso(dayMs);
      const dayBookings = src.filter(b => b.date === iso);
      const amount = dayBookings.reduce((s, b) => s + b.commission, 0);
      buckets.push({
        label: shortDay(dayMs),
        tooltipTitle: longDay(dayMs),
        amount: Math.round(amount * 100) / 100,
        count: dayBookings.length
      });
    }
    return buckets;
  }

  function weeklyBuckets(days, endMs) {
    // Build day-level data then roll into 7-day bins anchored
    // to endMs (newest bin always ends on endMs).
    const src = pool();
    const daily = [];
    for (let i = days - 1; i >= 0; i--) {
      const dayMs = endMs - i * DAY_MS;
      const iso = toIso(dayMs);
      const dayBookings = src.filter(b => b.date === iso);
      daily.push({
        ms: dayMs,
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
      const startMs = slice[0].ms;
      const endMsBin = slice[slice.length - 1].ms;
      out.unshift({
        label: shortRange(startMs, endMsBin),
        tooltipTitle: longRange(startMs, endMsBin),
        amount: Math.round(amount * 100) / 100,
        count
      });
    }
    return out;
  }

  function bucketsForRange(rangeKey, endMs) {
    if (rangeKey === '7d')  return dailyBuckets(7, endMs);
    if (rangeKey === '90d') return weeklyBuckets(90, endMs);
    return dailyBuckets(30, endMs); // 30d + custom
  }

  function priorEndMs(rangeKey) {
    const days = daysForRange(rangeKey);
    // Current period covers (today - (days-1)) … today, so the
    // prior period ends the day before current starts.
    return TODAY_MS - days * DAY_MS;
  }

  // ---- Chart init -----------------------------------------
  const canvas = document.getElementById('commission-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let currentBuckets = bucketsForRange(getActiveRange(), TODAY_MS);
  let priorBuckets   = bucketsForRange(getActiveRange(), priorEndMs(getActiveRange()));

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
          order: 2    // drawn first → ends up behind the line
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
          order: 1    // drawn last → sits on top of the bars
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
              const amount = '$' + bucket.amount.toFixed(2) + ' ' + data.meta.currency;
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
    currentBuckets = bucketsForRange(rangeKey, TODAY_MS);
    priorBuckets   = bucketsForRange(rangeKey, priorEndMs(rangeKey));
    chart.data.labels = currentBuckets.map(b => b.label);
    chart.data.datasets[0].data = currentBuckets.map(b => b.amount);
    chart.data.datasets[1].data = priorBuckets.map(b => b.amount);
    chart.update();
  }

  function getActiveRange() {
    const el = document.querySelector('.date-toggle__option[aria-pressed="true"]');
    return (el && el.dataset.range) || '30d';
  }

  window.addEventListener('dash:range-change', function (e) {
    redraw((e.detail && e.detail.range) || getActiveRange());
  });
  window.addEventListener('dash:filters-change', function () {
    redraw(getActiveRange());
  });
})();
