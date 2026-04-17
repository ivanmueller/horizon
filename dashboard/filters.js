/* ============================================================
   Horizon Dashboard — Filter Bar
   ------------------------------------------------------------
   Three pill-shaped filters (Employee, Tour Type, Status) that
   open inline dropdowns. Selecting a value applies instantly
   and dispatches 'dash:filters-change'. Active filters show a
   small × to clear.

   Exposes a shared accessor so every downstream component pulls
   from one filtered pool:

       window.HorizonDashboard.getFilteredBookings()

   This function returns all bookings that pass the currently-
   active filters (date-range filtering is applied separately by
   each component).
   ============================================================ */
(function () {
  'use strict';

  const data = window.HorizonData;
  if (!data) return;

  // ---- Shared namespace + state ---------------------------
  window.HorizonDashboard = window.HorizonDashboard || {};
  const filters = { staffId: null, tourId: null, status: null };
  window.HorizonDashboard.filters = filters;

  window.HorizonDashboard.getFilteredBookings = function () {
    return data.bookings.filter(b => {
      if (filters.staffId && b.staffId !== filters.staffId) return false;
      if (filters.tourId  && b.tourId  !== filters.tourId)  return false;
      if (filters.status  && b.status  !== filters.status)  return false;
      return true;
    });
  };

  // ---- Filter definitions ---------------------------------
  const STATUS_OPTIONS = [
    { value: 'confirmed', label: 'Confirmed' },
    { value: 'pending',   label: 'Pending' },
    { value: 'paid_out',  label: 'Paid Out' }
  ];

  const configs = {
    staffId: {
      label: 'Employee',
      allLabel: 'All Staff',
      options: data.staff.map(s => ({ value: s.id, label: s.name }))
    },
    tourId: {
      label: 'Tour Type',
      allLabel: 'All Tours',
      options: data.tours.map(t => ({ value: t.id, label: t.shortName || t.name }))
    },
    status: {
      label: 'Status',
      allLabel: 'All Statuses',
      options: STATUS_OPTIONS
    }
  };

  // ---- DOM refs --------------------------------------------
  const bar = document.querySelector('[data-filter-bar]');
  if (!bar) return;
  const wraps = {};
  bar.querySelectorAll('[data-filter-wrap]').forEach(w => {
    wraps[w.dataset.filter] = w;
  });

  // ---- Helpers --------------------------------------------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function renderPill(key) {
    const cfg = configs[key];
    const wrap = wraps[key];
    const pill = wrap.querySelector('[data-filter-toggle]');
    const value = filters[key];
    const option = value ? cfg.options.find(o => o.value === value) : null;

    if (option) {
      pill.classList.add('filter-pill--active');
      pill.setAttribute('aria-pressed', 'true');
      pill.innerHTML =
        '<span class="filter-pill__label">' +
          escapeHtml(cfg.label) + ': <strong>' + escapeHtml(option.label) + '</strong>' +
        '</span>' +
        '<button type="button" class="filter-pill__clear" data-filter-clear="' + key + '" ' +
                'aria-label="Clear ' + escapeHtml(cfg.label) + ' filter">×</button>';
    } else {
      pill.classList.remove('filter-pill--active');
      pill.setAttribute('aria-pressed', 'false');
      pill.innerHTML =
        '<span class="filter-pill__label">' + escapeHtml(cfg.label) + '</span>' +
        '<span class="filter-pill__caret" aria-hidden="true"></span>';
    }
  }

  function renderDropdown(key) {
    const cfg = configs[key];
    const dd = wraps[key].querySelector('[data-filter-dropdown]');
    const current = filters[key];
    const items = [];

    items.push(
      '<button type="button" class="filter-dropdown__option filter-dropdown__option--all' +
      (current == null ? ' filter-dropdown__option--selected' : '') + '" ' +
      'data-filter-option="" role="menuitemradio" aria-checked="' + (current == null) + '">' +
        escapeHtml(cfg.allLabel) +
      '</button>'
    );
    cfg.options.forEach(opt => {
      const selected = current === opt.value;
      items.push(
        '<button type="button" class="filter-dropdown__option' +
        (selected ? ' filter-dropdown__option--selected' : '') + '" ' +
        'data-filter-option="' + escapeHtml(opt.value) + '" role="menuitemradio" ' +
        'aria-checked="' + selected + '">' +
          escapeHtml(opt.label) +
          (selected ? '<span class="filter-dropdown__check" aria-hidden="true">✓</span>' : '') +
        '</button>'
      );
    });

    dd.innerHTML = items.join('');
  }

  function openDropdown(key) {
    closeAllDropdowns();
    renderDropdown(key);
    const dd = wraps[key].querySelector('[data-filter-dropdown]');
    dd.hidden = false;
    wraps[key].querySelector('[data-filter-toggle]').setAttribute('aria-expanded', 'true');
  }

  function closeAllDropdowns() {
    Object.keys(wraps).forEach(k => {
      const dd = wraps[k].querySelector('[data-filter-dropdown]');
      if (dd) dd.hidden = true;
      const toggle = wraps[k].querySelector('[data-filter-toggle]');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
    });
  }

  function setFilter(key, value) {
    filters[key] = value || null;
    renderPill(key);
    window.dispatchEvent(new CustomEvent('dash:filters-change', {
      detail: { filters: Object.assign({}, filters) }
    }));
  }

  // ---- Event delegation -----------------------------------
  bar.addEventListener('click', function (e) {
    // Clear button (highest priority — don't bubble into toggle)
    const clearBtn = e.target.closest('[data-filter-clear]');
    if (clearBtn) {
      e.stopPropagation();
      setFilter(clearBtn.dataset.filterClear, null);
      closeAllDropdowns();
      return;
    }

    // Option inside dropdown
    const option = e.target.closest('[data-filter-option]');
    if (option) {
      const wrap = option.closest('[data-filter-wrap]');
      const key = wrap.dataset.filter;
      setFilter(key, option.dataset.filterOption || null);
      closeAllDropdowns();
      return;
    }

    // Pill toggle (open/close dropdown)
    const toggle = e.target.closest('[data-filter-toggle]');
    if (toggle) {
      const wrap = toggle.closest('[data-filter-wrap]');
      const key = wrap.dataset.filter;
      const dd = wrap.querySelector('[data-filter-dropdown]');
      if (dd.hidden) openDropdown(key);
      else closeAllDropdowns();
    }
  });

  // Close dropdowns on outside click
  document.addEventListener('click', function (e) {
    if (!e.target.closest('[data-filter-wrap]')) closeAllDropdowns();
  });
  // Close on Escape
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeAllDropdowns();
  });

  // ---- Initial render -------------------------------------
  Object.keys(configs).forEach(renderPill);
})();
