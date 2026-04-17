/* ============================================================
   Horizon Dashboard — Commission Over Time chart
   ------------------------------------------------------------
   One bar chart, coral at 80% opacity. Bars = commission earned
   per day (for 7d / 30d) or per week (for 90d). Hover tooltip
   shows the date or date range, commission amount, and booking
   count. Redraws on 'dash:range-change'.
   ============================================================ */
(function () {
  'use strict';

  const data = window.HorizonData;
  if (!data || !window.Chart) return;

  const DAY_MS = 86400000;
  const TODAY_MS = new Date(data.meta.today + 'T00:00:00').getTime();
  const CORAL = 'rgba(255, 107, 74, 0.8)';
  const CORAL_HOVER = 'rgba(255, 107, 74, 1)';

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

  // ---- Aggregation -----------------------------------------
  function dailyBuckets(days) {
    const buckets = [];
    for (let i = days - 1; i >= 0; i--) {
      const dayMs = TODAY_MS - i * DAY_MS;
      const iso = toIso(dayMs);
      const dayBookings = data.bookings.filter(b => b.date === iso);
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

  function weeklyBuckets(days) {
    // Build day-level data first, then roll into 7-day bins
    // anchored to today (newest bin always ends on TODAY).
    const daily = [];
    for (let i = days - 1; i >= 0; i--) {
      const dayMs = TODAY_MS - i * DAY_MS;
      const iso = toIso(dayMs);
      const dayBookings = data.bookings.filter(b => b.date === iso);
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
      const endMs = slice[slice.length - 1].ms;
      out.unshift({
        label: shortRange(startMs, endMs),
        tooltipTitle: longRange(startMs, endMs),
        amount: Math.round(amount * 100) / 100,
        count
      });
    }
    return out;
  }

  function bucketsForRange(rangeKey) {
    if (rangeKey === '7d')  return dailyBuckets(7);
    if (rangeKey === '90d') return weeklyBuckets(90);
    return dailyBuckets(30); // 30d + custom (until picker ships)
  }

  // ---- Chart init -----------------------------------------
  const canvas = document.getElementById('commission-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let buckets = bucketsForRange(getActiveRange());

  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: buckets.map(b => b.label),
      datasets: [{
        data: buckets.map(b => b.amount),
        backgroundColor: CORAL,
        hoverBackgroundColor: CORAL_HOVER,
        borderRadius: 4,
        borderSkipped: false,
        maxBarThickness: 40
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      layout: { padding: { top: 4, right: 4, bottom: 0, left: 0 } },
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
          displayColors: false,
          titleFont: { family: "'DM Sans', sans-serif", weight: '600', size: 13 },
          bodyFont:  { family: "'DM Sans', sans-serif", weight: '400', size: 12 },
          callbacks: {
            title: items => buckets[items[0].dataIndex].tooltipTitle,
            label: item => {
              const b = buckets[item.dataIndex];
              const amount = '$' + b.amount.toFixed(2) + ' ' + data.meta.currency;
              const bookings = b.count === 1 ? '1 booking' : b.count + ' bookings';
              return [amount, bookings];
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

  // ---- Redraw on range change -----------------------------
  function redraw(rangeKey) {
    buckets = bucketsForRange(rangeKey);
    chart.data.labels = buckets.map(b => b.label);
    chart.data.datasets[0].data = buckets.map(b => b.amount);
    chart.update();
  }

  function getActiveRange() {
    const el = document.querySelector('.date-toggle__option[aria-pressed="true"]');
    return (el && el.dataset.range) || '30d';
  }

  window.addEventListener('dash:range-change', function (e) {
    redraw((e.detail && e.detail.range) || getActiveRange());
  });
})();
