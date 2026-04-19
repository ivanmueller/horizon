/* ============================================================
   Horizon Dashboard — Prescriptive insight card
   ------------------------------------------------------------
   Evaluates a small bank of rule templates against the mock
   data. One rule surfaces at a time. If none meet their
   threshold, the whole row hides — silence beats a generic
   filler insight.

   Rule templates (three at launch):

     1. view-checkout-leak  — big drop between tour views and
                              checkout starts. Highest-leverage
                              signal for most hotels.
     2. scan-volume-drop    — period-over-period QR scan volume
                              decline; usually a physical
                              placement issue.
     3. top-tour-standout   — one tour captures an outsized
                              share of bookings; lean in.

   Rules fire based on thresholds and compete on a single
   "score" so the most urgent/meaningful one wins.

   Clicking the CTA opens a short written playbook in a side
   drawer — never an analytics dump.
   ============================================================ */
(function () {
  'use strict';

  const data = window.HorizonData;
  if (!data) return;

  const DAY_MS = 86400000;
  const TODAY_MS = new Date(data.meta.today + 'T00:00:00').getTime();

  // ---- DOM refs --------------------------------------------
  const row       = document.querySelector('[data-insight-row]');
  const headline  = document.querySelector('[data-insight-headline]');
  const explain   = document.querySelector('[data-insight-explanation]');
  const cta       = document.querySelector('[data-insight-cta]');
  const drawer    = document.querySelector('[data-playbook-drawer]');
  const drawerTtl = document.querySelector('[data-playbook-title]');
  const drawerBd  = document.querySelector('[data-playbook-body]');
  const drawerX   = document.querySelector('[data-playbook-close]');
  if (!row || !headline || !explain || !cta) return;

  // ---- Helpers --------------------------------------------
  function daysForRange(rangeKey) {
    if (rangeKey === '7d') return 7;
    if (rangeKey === '90d') return 90;
    return 30;
  }

  function pool() {
    const dash = window.HorizonDashboard;
    return (dash && typeof dash.getFilteredBookings === 'function')
      ? dash.getFilteredBookings()
      : data.bookings;
  }

  function bookingMs(b) {
    return new Date(b.date + 'T00:00:00').getTime();
  }

  function sumInWindow(rows, startMs, endMs) {
    return rows.reduce((s, row) => {
      const t = new Date(row.date + 'T00:00:00').getTime();
      return (t >= startMs && t <= endMs) ? s + row.count : s;
    }, 0);
  }

  function bookingsInWindow(startMs, endMs) {
    return pool().filter(b => {
      const t = bookingMs(b);
      return t >= startMs && t <= endMs;
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ---- Context built once per render ----------------------
  function buildContext(rangeKey) {
    const days = daysForRange(rangeKey);
    const endMs = TODAY_MS;
    const startMs = endMs - (days - 1) * DAY_MS;
    const priorEnd = startMs - DAY_MS;
    const priorStart = priorEnd - (days - 1) * DAY_MS;

    const bkCur = bookingsInWindow(startMs, endMs);

    const ctx = {
      rangeKey, days,
      scansCur:    sumInWindow(data.scans,          startMs, endMs),
      viewsCur:    sumInWindow(data.tourViews,      startMs, endMs),
      checkoutCur: sumInWindow(data.checkoutStarts, startMs, endMs),
      bookingsCur: bkCur.length,
      scansPrv:    sumInWindow(data.scans,          priorStart, priorEnd),
      viewsPrv:    sumInWindow(data.tourViews,      priorStart, priorEnd),
      checkoutPrv: sumInWindow(data.checkoutStarts, priorStart, priorEnd),
      bookingsPrv: bookingsInWindow(priorStart, priorEnd).length,
      byTour: {}
    };
    bkCur.forEach(b => { ctx.byTour[b.tourId] = (ctx.byTour[b.tourId] || 0) + 1; });
    return ctx;
  }

  // ---- Rule templates -------------------------------------
  const RULES = [
    {
      id: 'view-checkout-leak',
      evaluate(ctx) {
        if (ctx.viewsCur < 20) return null;            // insufficient signal
        const retention = ctx.checkoutCur / ctx.viewsCur;
        const drop = 1 - retention;
        if (drop < 0.6) return null;                   // threshold
        return {
          score: 80 + drop * 50,
          vars: { dropPct: Math.round(drop * 100) }
        };
      },
      render(v) {
        return {
          headline: v.dropPct + '% of tour viewers never reach checkout.',
          explanation: 'Guests are browsing your tours but bouncing before the booking form. Usually the checkout is too long, breaks on mobile, or surprises them on price.',
          playbookId: 'checkout-leak'
        };
      }
    },

    {
      id: 'scan-volume-drop',
      evaluate(ctx) {
        if (ctx.scansPrv < 30) return null;            // insufficient prior
        const drop = (ctx.scansPrv - ctx.scansCur) / ctx.scansPrv;
        if (drop < 0.15) return null;
        return {
          score: 60 + drop * 60,
          vars: { dropPct: Math.round(drop * 100) }
        };
      },
      render(v) {
        return {
          headline: 'QR scans fell ' + v.dropPct + '% versus your previous period.',
          explanation: 'Guests are reaching your QR codes less than before. Almost always a placement problem — a sign moved, a reprint missed, or an in-room tablet gone dark.',
          playbookId: 'restore-scan-volume'
        };
      }
    },

    {
      id: 'top-tour-standout',
      evaluate(ctx) {
        const entries = Object.entries(ctx.byTour);
        const total = entries.reduce((s, [, n]) => s + n, 0);
        if (total < 4) return null;
        entries.sort((a, b) => b[1] - a[1]);
        const [topId, topCount] = entries[0];
        const share = topCount / total;
        if (share < 0.4) return null;
        const tour = data.tours.find(t => t.id === topId);
        return {
          score: 40 + share * 40,
          vars: {
            tourName: tour ? (tour.shortName || tour.name) : topId,
            sharePct: Math.round(share * 100)
          }
        };
      },
      render(v) {
        return {
          headline: escapeHtml(v.tourName) + ' drives ' + v.sharePct + '% of your bookings.',
          explanation: 'Your top-performing tour keeps out-converting the others. Lean in — feature it first on lobby displays, in concierge scripting, and on tent cards.',
          playbookId: 'promote-top-tour'
        };
      }
    }
  ];

  // ---- Playbook content -----------------------------------
  // Intentionally short. Long playbooks get skimmed. The goal
  // is "do this first, stop when the number moves."
  const PLAYBOOKS = {
    'checkout-leak': {
      title: 'Plugging your checkout leak',
      summary: 'When tour views are healthy but checkouts aren\u2019t, the friction is almost always in the booking form itself. Start at the top of this list and stop at the first fix that moves the number.',
      steps: [
        { body: '<strong>Open the checkout on your phone.</strong> If it takes more than three screens or you have to zoom, that\u2019s the fix.' },
        { body: '<strong>Show the tax-inclusive total before payment details.</strong> Surprise totals are the #1 abandonment trigger in hospitality bookings.' },
        { body: '<strong>Move party size to the first field.</strong> If price changes late in the flow, guests distrust it.' },
        { body: '<strong>Remove account creation.</strong> Guests should be able to book with just a name and email. Account prompts belong after payment, not before.' },
        { body: '<strong>Watch one checkout live.</strong> Have a concierge silently guide a guest from scan to confirmation, without coaching. Note every pause — that\u2019s your list.' }
      ]
    },
    'restore-scan-volume': {
      title: 'Getting your QR scans back up',
      summary: 'Scan-volume drops almost always trace to a physical placement issue, not to guest behaviour. Audit the placements first, messaging second.',
      steps: [
        { body: '<strong>Walk the lobby with fresh eyes.</strong> Is the display where it was a month ago? Has another promo been posted over it? Is the QR reachable from a standing position?' },
        { body: '<strong>Check the key-card print run.</strong> New batches occasionally arrive without the QR printed. Compare a current card to one from last month.' },
        { body: '<strong>Test every in-room tablet.</strong> If the Horizon link moved during a content refresh, housekeeping won\u2019t know — and guests won\u2019t find it.' },
        { body: '<strong>Refresh the signage copy.</strong> "Scan for tours" is easy to ignore. "Scan for tours the concierge recommends" lifts scans ~15% in comparable properties.' }
      ]
    },
    'promote-top-tour': {
      title: 'Turning your top tour into your anchor tour',
      summary: 'A single tour carrying most of your bookings is a strength, not a weakness. Leaning into it usually lifts total volume more than spreading promotion thin across every option.',
      steps: [
        { body: '<strong>Move it to the top of every display.</strong> Lobby QR, tent cards, in-room tablet — your top converter goes first, not last.' },
        { body: '<strong>Brief your front-desk team.</strong> Give them one sentence of language to recommend it when guests ask for "something to do."' },
        { body: '<strong>Print a tent card.</strong> Restaurant, bar, and concierge desk. One tour, one QR, one sentence.' },
        { body: '<strong>Watch the other tours.</strong> If volume drops too hard elsewhere, rebalance — you\u2019re aiming for a 70/30 mix, not 95/5.' }
      ]
    }
  };

  // ---- Rule selection -------------------------------------
  function pickInsight(ctx) {
    let best = null;
    for (const rule of RULES) {
      const result = rule.evaluate(ctx);
      if (!result) continue;
      if (!best || result.score > best.score) {
        best = { rule, score: result.score, vars: result.vars };
      }
    }
    return best;
  }

  // ---- Playbook drawer ------------------------------------
  let lastTrigger = null;
  let activePlaybookId = null;

  function openDrawer(playbookId, triggerEl) {
    const pb = PLAYBOOKS[playbookId];
    if (!pb || !drawer || !drawerTtl || !drawerBd) return;
    activePlaybookId = playbookId;
    drawerTtl.textContent = pb.title;
    drawerBd.innerHTML =
      '<p class="playbook-drawer__summary">' + escapeHtml(pb.summary) + '</p>' +
      '<p class="playbook-drawer__section-title">Do these in order</p>' +
      '<ol class="playbook-drawer__steps">' +
        pb.steps.map((step, i) =>
          '<li class="playbook-drawer__step">' +
            '<span class="playbook-drawer__step-number">' + (i + 1) + '</span>' +
            '<span class="playbook-drawer__step-body">' + step.body + '</span>' +
          '</li>'
        ).join('') +
      '</ol>';
    lastTrigger = triggerEl || document.activeElement;
    if (typeof drawer.showModal === 'function') drawer.showModal();
    else drawer.setAttribute('open', '');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    if (!drawer) return;
    if (drawer.open && typeof drawer.close === 'function') drawer.close();
    else drawer.removeAttribute('open');
  }

  if (drawer) {
    drawer.addEventListener('close', function () {
      document.body.style.overflow = '';
      if (lastTrigger && typeof lastTrigger.focus === 'function') {
        lastTrigger.focus();
      }
      lastTrigger = null;
      activePlaybookId = null;
    });
    drawer.addEventListener('click', function (e) {
      // Click on backdrop (the dialog itself) closes the drawer.
      if (e.target === drawer) closeDrawer();
    });
  }
  if (drawerX) drawerX.addEventListener('click', closeDrawer);

  cta.addEventListener('click', function () {
    const id = cta.dataset.playbookId;
    if (id) openDrawer(id, cta);
  });

  // ---- Render ---------------------------------------------
  function render(rangeKey) {
    const ctx = buildContext(rangeKey);
    const pick = pickInsight(ctx);

    if (!pick) {
      row.hidden = true;
      cta.dataset.playbookId = '';
      return;
    }

    const content = pick.rule.render(pick.vars);
    // Headline may contain escaped HTML from the renderer (tour
    // names can include special characters) — use innerHTML so
    // renderers that pre-escape their vars are respected.
    headline.innerHTML = content.headline;
    explain.textContent = content.explanation;
    cta.dataset.playbookId = content.playbookId;
    row.hidden = false;
  }

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
