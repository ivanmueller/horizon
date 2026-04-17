/* ============================================================
   Horizon Dashboard — Booking Detail Lightbox
   ------------------------------------------------------------
   Opens when any transaction table row is clicked (or focused
   and Enter/Space pressed). Renders a single-card view with
   guest info, a divider, and the financial breakdown.

   - Uses the native <dialog> element for backdrop, focus trap,
     and Escape-to-close.
   - Extra behaviour: click on the backdrop (outside the card)
     also closes the modal.
   - View-only — no secondary actions inside the card.
   ============================================================ */
(function () {
  'use strict';

  const data = window.HorizonData;
  if (!data) return;

  const modal    = document.querySelector('[data-booking-modal]');
  const bodyEl   = document.querySelector('[data-booking-modal-body]');
  const closeBtn = document.querySelector('[data-booking-modal-close]');
  if (!modal || !bodyEl) return;

  // ---- Lookups ---------------------------------------------
  const tourById   = Object.fromEntries(data.tours.map(t => [t.id, t]));
  const payoutById = Object.fromEntries(data.payouts.map(p => [p.id, p]));

  const STATUS_LABELS = {
    confirmed: 'Confirmed',
    pending:   'Pending',
    paid_out:  'Paid Out'
  };

  // ---- Formatting helpers ----------------------------------
  const currencyFmt = new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: data.meta.currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const formatCurrency = n => currencyFmt.format(n) + ' ' + data.meta.currency;

  function formatLongDate(iso) {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric'
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function partyLabel(n) {
    return n === 1 ? '1 guest' : n + ' guests';
  }

  function payoutLine(booking) {
    if (booking.status === 'pending') {
      return 'Pending confirmation';
    }
    const payout = payoutById[booking.payoutId];
    if (!payout) return '—';
    const dateStr = formatLongDate(payout.date);
    if (booking.status === 'paid_out') {
      return 'Paid ' + dateStr;
    }
    // confirmed → upcoming payout
    return dateStr + ' (next monthly cycle)';
  }

  // ---- Template --------------------------------------------
  function row(label, value, modifier) {
    const cls = 'booking-modal__row' + (modifier ? ' ' + modifier : '');
    return (
      '<div class="' + cls + '">' +
        '<dt>' + escapeHtml(label) + '</dt>' +
        '<dd>' + value + '</dd>' +
      '</div>'
    );
  }

  function template(booking) {
    const tour = tourById[booking.tourId];
    const tourName = tour ? tour.name : booking.tourName;
    const party = partyLabel(booking.partySize);
    const pricePerGuest = formatCurrency(booking.unitPrice) + ' × ' + party;
    const commissionPct = Math.round(data.meta.commissionRate * 100);

    return (
      '<dl class="booking-modal__section">' +
        row('Guest',          escapeHtml(booking.guest.name)) +
        row('Tour',           escapeHtml(tourName)) +
        row('Date',           formatLongDate(booking.date)) +
        row('Party Size',     party) +
        row('Booking Source', escapeHtml(booking.source)) +
      '</dl>' +
      '<hr class="booking-modal__divider">' +
      '<dl class="booking-modal__section">' +
        row('Tour Price',     pricePerGuest) +
        row('Booking Total',  formatCurrency(booking.bookingValue)) +
        row('Hotel Commission (' + commissionPct + '%)',
            formatCurrency(booking.commission),
            'booking-modal__row--commission') +
        row('Status',         STATUS_LABELS[booking.status] || booking.status) +
        row('Payout Date',    escapeHtml(payoutLine(booking))) +
      '</dl>'
    );
  }

  // ---- Open / close ----------------------------------------
  let lastTrigger = null;

  function open(bookingId, triggerEl) {
    const booking = data.bookings.find(b => b.id === bookingId);
    if (!booking) return;
    bodyEl.innerHTML = template(booking);
    lastTrigger = triggerEl || document.activeElement;
    if (typeof modal.showModal === 'function') {
      modal.showModal();
    } else {
      modal.setAttribute('open', '');
    }
    document.body.style.overflow = 'hidden';
  }

  function close() {
    if (modal.open && typeof modal.close === 'function') {
      modal.close();
    } else {
      modal.removeAttribute('open');
    }
  }

  // Native 'close' event fires for Escape, dialog.close(), and
  // form method="dialog" submits — so restoring focus and body
  // scroll here covers every close path.
  modal.addEventListener('close', function () {
    document.body.style.overflow = '';
    if (lastTrigger && typeof lastTrigger.focus === 'function') {
      lastTrigger.focus();
    }
    lastTrigger = null;
  });

  // Close button
  closeBtn.addEventListener('click', close);

  // Click on backdrop (the dialog element itself outside the card)
  modal.addEventListener('click', function (e) {
    if (e.target === modal) close();
  });

  // ---- Row trigger wiring ----------------------------------
  const tbody = document.querySelector('[data-txn-body]');
  if (tbody) {
    tbody.addEventListener('click', function (e) {
      const row = e.target.closest('[data-booking-id]');
      if (!row) return;
      open(row.dataset.bookingId, row);
    });
    tbody.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const row = e.target.closest('[data-booking-id]');
      if (!row) return;
      e.preventDefault();
      open(row.dataset.bookingId, row);
    });
  }
})();
