/* ============================================================
   Horizon Dashboard — Transaction Table
   ------------------------------------------------------------
   Renders the filtered bookings into the transaction table
   below the filter bar.

   - Pulls from window.HorizonDashboard.getFilteredBookings()
     so filter pills flow through automatically.
   - Default sort: most recent first.
   - Shows 15 rows; "Load more" reveals another 15 per click.
   - Status column uses colored pills (confirmed/pending/paid_out).
   - On mobile the table structure collapses to stacked cards
     via CSS; the data-label attribute on each cell drives the
     mobile key-value layout.
   ============================================================ */
(function () {
  'use strict';

  const data = window.HorizonData;
  if (!data) return;

  // 10 rows per page reads faster than 15+ and matches the
  // Airbnb host pattern GMs are already used to. "Load more"
  // below the table reveals the next 10 on click — no
  // pagination controls.
  const PAGE_SIZE = 10;
  let visibleCount = PAGE_SIZE;

  // ---- DOM refs --------------------------------------------
  const tbody        = document.querySelector('[data-txn-body]');
  const emptyEl      = document.querySelector('[data-txn-empty]');
  const loadMoreBtn  = document.querySelector('[data-txn-loadmore]');
  const loadMoreLbl  = document.querySelector('[data-txn-loadmore-label]');
  if (!tbody || !loadMoreBtn) return;

  // ---- Lookups ---------------------------------------------
  const staffById = Object.fromEntries(data.staff.map(s => [s.id, s]));
  const tourById  = Object.fromEntries(data.tours.map(t => [t.id, t]));

  const STATUS_META = {
    confirmed: { label: 'Confirmed', cls: 'txn-status--confirmed' },
    pending:   { label: 'Pending',   cls: 'txn-status--pending' },
    paid_out:  { label: 'Paid Out',  cls: 'txn-status--paid-out' }
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

  function formatDate(iso) {
    // "Jun 4, 2026" — en-US avoids the stray period some locales add.
    const dt = new Date(iso + 'T00:00:00');
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function referrerLabel(staffId) {
    const s = staffById[staffId];
    if (!s) return '—';
    const firstName = s.name.split(' ')[0];
    return firstName + ' (' + s.role + ')';
  }

  // ---- Data access -----------------------------------------
  function rows() {
    const dash = window.HorizonDashboard;
    const base = (dash && typeof dash.getFilteredBookings === 'function')
      ? dash.getFilteredBookings()
      : data.bookings;
    // Default sort: most recent first.
    return base.slice().sort((a, b) => b.date.localeCompare(a.date));
  }

  // ---- Rendering -------------------------------------------
  function renderRow(b) {
    const tour = tourById[b.tourId];
    const tourName = tour ? tour.name : b.tourName;
    const status = STATUS_META[b.status] || { label: b.status, cls: '' };

    return (
      '<tr class="txn-table__row" data-booking-id="' + escapeHtml(b.id) + '" tabindex="0" aria-label="View booking details">' +
        '<td class="txn-table__cell txn-col-date"       data-label="Date">' + escapeHtml(formatDate(b.date)) + '</td>' +
        '<td class="txn-table__cell txn-col-guest"      data-label="Guest">' + escapeHtml(b.guest.name) + '</td>' +
        '<td class="txn-table__cell txn-col-tour"       data-label="Tour">' + escapeHtml(tourName) + '</td>' +
        '<td class="txn-table__cell txn-col-referrer"   data-label="Referred by">' + escapeHtml(referrerLabel(b.staffId)) + '</td>' +
        '<td class="txn-table__cell txn-col-value"      data-label="Booking value">' + formatCurrency(b.bookingValue) + '</td>' +
        '<td class="txn-table__cell txn-col-commission" data-label="Commission">' + formatCurrency(b.commission) + '</td>' +
        '<td class="txn-table__cell txn-col-status"     data-label="Status">' +
          '<span class="txn-status ' + status.cls + '">' + escapeHtml(status.label) + '</span>' +
        '</td>' +
      '</tr>'
    );
  }

  function render() {
    const all = rows();
    const total = all.length;

    if (total === 0) {
      tbody.innerHTML = '';
      if (emptyEl) emptyEl.hidden = false;
      loadMoreBtn.hidden = true;
      return;
    }
    if (emptyEl) emptyEl.hidden = true;

    const visible = all.slice(0, visibleCount);
    tbody.innerHTML = visible.map(renderRow).join('');

    const remaining = total - visible.length;
    if (remaining > 0) {
      loadMoreBtn.hidden = false;
      const next = Math.min(PAGE_SIZE, remaining);
      if (loadMoreLbl) loadMoreLbl.textContent = 'Load ' + next + ' more';
    } else {
      loadMoreBtn.hidden = true;
    }
  }

  // ---- Events ----------------------------------------------
  loadMoreBtn.addEventListener('click', function () {
    visibleCount += PAGE_SIZE;
    render();
  });

  // Reset pagination whenever filters change so users aren't
  // stranded on a deep page after narrowing the list.
  window.addEventListener('dash:filters-change', function () {
    visibleCount = PAGE_SIZE;
    render();
  });

  // ---- Initial render --------------------------------------
  render();
})();
