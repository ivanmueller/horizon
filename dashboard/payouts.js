/* ============================================================
   Horizon Dashboard — Payout History Lightbox
   ------------------------------------------------------------
   Second modal on the dashboard. The only place where the hotel
   can see historical payout records.

   - Triggered by the "View payout history" link in the Pending
     Payout KPI card.
   - Shows completed payouts only (the scheduled one is already
     surfaced as the Pending Payout KPI).
   - Each row is an inline accordion: clicking expands to reveal
     the individual bookings that made up that payout cycle.
   - Close on X, Escape, or backdrop click (no other actions).
   ============================================================ */
(function () {
  'use strict';

  const data = window.HorizonData;
  if (!data) return;

  const modal     = document.querySelector('[data-payout-modal]');
  const bodyEl    = document.querySelector('[data-payout-modal-body]');
  const subtitle  = document.querySelector('[data-payout-modal-subtitle]');
  const closeBtn  = document.querySelector('[data-payout-modal-close]');
  const openLink  = document.querySelector('[data-open-payout-history]');
  if (!modal || !bodyEl || !openLink) return;

  const bookingById = Object.fromEntries(data.bookings.map(b => [b.id, b]));
  const tourById    = Object.fromEntries(data.tours.map(t => [t.id, t]));

  // ---- Formatting helpers ----------------------------------
  const currencyFmt0 = new Intl.NumberFormat('en-CA', {
    style: 'currency', currency: data.meta.currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 0, maximumFractionDigits: 0
  });
  const currencyFmt2 = new Intl.NumberFormat('en-CA', {
    style: 'currency', currency: data.meta.currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
  const formatCurrency  = n => currencyFmt0.format(n) + ' ' + data.meta.currency;
  const formatCurrency2 = n => currencyFmt2.format(n) + ' ' + data.meta.currency;

  function parseIso(iso) { return new Date(iso + 'T00:00:00'); }

  function formatShortDate(iso) {
    return parseIso(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    });
  }
  function formatDayMonth(iso) {
    return parseIso(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function formatPeriod(startIso, endIso) {
    const start = parseIso(startIso);
    const end = parseIso(endIso);
    const sameMonth = start.getMonth() === end.getMonth()
                   && start.getFullYear() === end.getFullYear();
    const year = end.getFullYear();
    if (sameMonth) {
      return start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
           + '–' + end.getDate() + ', ' + year;
    }
    return formatDayMonth(startIso) + ' – ' + formatDayMonth(endIso) + ', ' + year;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ---- Rendering -------------------------------------------
  function renderDetail(payout) {
    const items = payout.bookingIds
      .map(id => bookingById[id])
      .filter(Boolean)
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(b => {
        const tour = tourById[b.tourId];
        const tourName = tour ? (tour.shortName || tour.name) : b.tourName;
        return (
          '<li class="payout-detail__item">' +
            '<span class="payout-detail__date">' + escapeHtml(formatDayMonth(b.date)) + '</span>' +
            '<span class="payout-detail__guest">' + escapeHtml(b.guest.name) + '</span>' +
            '<span class="payout-detail__tour">' + escapeHtml(tourName) + '</span>' +
            '<span class="payout-detail__amount">' + formatCurrency2(b.commission) + '</span>' +
          '</li>'
        );
      }).join('');

    return (
      '<div class="payout-detail">' +
        '<ul class="payout-detail__list">' + items + '</ul>' +
      '</div>'
    );
  }

  function renderRow(payout) {
    const bookingsLabel = payout.bookingCount === 1
      ? '1 booking'
      : payout.bookingCount + ' bookings';
    return (
      '<tr class="payout-table__summary-row" data-payout-id="' + escapeHtml(payout.id) + '" ' +
          'role="button" tabindex="0" aria-expanded="false" ' +
          'aria-controls="payout-detail-' + escapeHtml(payout.id) + '">' +
        '<td>' + escapeHtml(formatShortDate(payout.date)) + '</td>' +
        '<td class="payout-table__col-period">' + escapeHtml(formatPeriod(payout.periodStart, payout.periodEnd)) + '</td>' +
        '<td>' + escapeHtml(bookingsLabel) + '</td>' +
        '<td class="payout-table__amount">' + formatCurrency(payout.totalCommission) + '</td>' +
        '<td class="payout-table__col-method payout-table__method">' + escapeHtml(payout.method) + '</td>' +
        '<td><span class="payout-table__chevron" aria-hidden="true"></span></td>' +
      '</tr>' +
      '<tr class="payout-table__detail-row" id="payout-detail-' + escapeHtml(payout.id) + '" ' +
          'data-payout-detail="' + escapeHtml(payout.id) + '" hidden>' +
        '<td colspan="6">' + renderDetail(payout) + '</td>' +
      '</tr>'
    );
  }

  function render() {
    const completed = data.payouts
      .filter(p => p.status === 'completed')
      .sort((a, b) => b.date.localeCompare(a.date));

    if (subtitle) {
      const total = completed.reduce((s, p) => s + p.totalCommission, 0);
      const count = completed.length;
      subtitle.textContent = count === 0
        ? 'No completed payouts yet'
        : count + (count === 1 ? ' payout' : ' payouts') +
          ' · ' + formatCurrency(total) + ' paid to date';
    }

    if (completed.length === 0) {
      bodyEl.innerHTML = '<p class="payout-modal__empty">No payouts yet.</p>';
      return;
    }

    bodyEl.innerHTML =
      '<table class="payout-table">' +
        '<thead><tr>' +
          '<th scope="col">Payout Date</th>' +
          '<th scope="col" class="payout-table__col-period">Period Covered</th>' +
          '<th scope="col">Bookings</th>' +
          '<th scope="col">Amount</th>' +
          '<th scope="col" class="payout-table__col-method">Method</th>' +
          '<th scope="col" aria-hidden="true"></th>' +
        '</tr></thead>' +
        '<tbody>' + completed.map(renderRow).join('') + '</tbody>' +
      '</table>';
  }

  // ---- Accordion behaviour ---------------------------------
  function togglePayout(summaryRow) {
    const id = summaryRow.dataset.payoutId;
    const detail = bodyEl.querySelector('[data-payout-detail="' + id + '"]');
    if (!detail) return;
    const expanded = summaryRow.getAttribute('aria-expanded') === 'true';
    summaryRow.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    detail.hidden = expanded;
  }

  bodyEl.addEventListener('click', function (e) {
    const row = e.target.closest('.payout-table__summary-row');
    if (!row) return;
    togglePayout(row);
  });
  bodyEl.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('.payout-table__summary-row');
    if (!row) return;
    e.preventDefault();
    togglePayout(row);
  });

  // ---- Open / close ----------------------------------------
  let lastTrigger = null;

  function open(triggerEl) {
    render();
    lastTrigger = triggerEl || document.activeElement;
    if (typeof modal.showModal === 'function') modal.showModal();
    else modal.setAttribute('open', '');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    if (modal.open && typeof modal.close === 'function') modal.close();
    else modal.removeAttribute('open');
  }

  modal.addEventListener('close', function () {
    document.body.style.overflow = '';
    if (lastTrigger && typeof lastTrigger.focus === 'function') lastTrigger.focus();
    lastTrigger = null;
  });

  closeBtn.addEventListener('click', close);

  // Click on backdrop (dialog itself) closes the modal. Clicks
  // inside the card bubble from child nodes, so only e.target
  // === the dialog element counts as an outside click.
  modal.addEventListener('click', function (e) {
    if (e.target === modal) close();
  });

  // ---- Trigger ---------------------------------------------
  openLink.addEventListener('click', function (e) {
    e.preventDefault();
    open(openLink);
  });
})();
