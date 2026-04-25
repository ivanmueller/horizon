/* ============================================================
   Horizon Hotel Commission Dashboard — Mock Data Layer
   ------------------------------------------------------------
   Single source of truth for every dashboard component.
   No UI code should hardcode numbers that belong in here.

   Shape:
     HorizonData.property        — hotel identity
     HorizonData.meta            — currency, commission rate, dates
     HorizonData.tours           — tour catalogue (id, name, price)
     HorizonData.staff           — hotel concierges / front desk
     HorizonData.bookingSources  — where a booking originated
     HorizonData.bookings        — 28 sample bookings
     HorizonData.payouts         — monthly payout cycles

   Every booking is pre-computed with bookingValue and commission
   (derived from meta.commissionRate) so UI components can render
   without duplicating the math — but the rate itself lives in
   meta.commissionRate for display (e.g. "Hotel Commission (15%)").
   ============================================================ */
(function () {
  'use strict';

  // ---- Property & metadata ---------------------------------
  const property = {
    id: 'fairmont-banff-springs',
    name: 'Fairmont Banff Springs',
    initials: 'FM',
    // Per-property config overlays. `employeeKickbacksEnabled`
    // controls whether the staff leaderboard shows dollar
    // earnings per concierge (true) or booking counts only
    // (false, relabeled "Top Referring Staff"). Same data
    // pipeline, different rendering.
    config: {
      employeeKickbacksEnabled: true
    }
  };

  const meta = {
    currency: 'CAD',
    commissionRate: 0.15,        // 15%
    today: '2026-04-17',         // anchor date for all demo math
    payoutCycle: 'monthly',      // paid on the 1st of each month
    nextPayoutDate: '2026-05-01',
    payoutMethod: 'EFT'
  };

  // ---- Tour catalogue --------------------------------------
  // shortName is used in compact contexts (filter pills, table rows);
  // name is the full title for detail views.
  const tours = [
    { id: 'lake-louise-canoe',        name: 'Lake Louise Guided Canoe & Moraine Lake Tour', shortName: 'Lake Louise Canoe',      priceCad: 249 },
    { id: 'banff-highlights',         name: 'Banff: Town Highlights and Gondola Tour',      shortName: 'Banff Highlights',       priceCad: 249 },
    { id: 'banff-hidden-gem-canoe',   name: 'Banff: Canoe Tour, Moraine Lake & Lake Louise', shortName: 'Hidden Gem Canoe',      priceCad: 249.99 },
    { id: 'moraine-lake-sightseeing', name: 'Moraine Lake Sightseeing',                     shortName: 'Moraine Lake',           priceCad: 189 }
  ];

  // ---- Hotel staff -----------------------------------------
  const staff = [
    { id: 's1', name: 'Maria Gonzalez',  role: 'Lead Concierge' },
    { id: 's2', name: 'David Park',      role: 'Concierge' },
    { id: 's3', name: 'Fatima Al-Sayed', role: 'Concierge' },
    { id: 's4', name: "James O'Brien",   role: 'Guest Services' },
    { id: 's5', name: 'Yuki Tanaka',     role: 'Concierge' }
  ];

  // ---- Booking sources -------------------------------------
  const bookingSources = [
    'QR Code — Lobby Display',
    'QR Code — Room Key Card',
    'Concierge Referral',
    'Front Desk Recommendation',
    'In-Room Tablet'
  ];

  // ---- Raw bookings ----------------------------------------
  // Status values: 'pending' | 'confirmed' | 'paid_out'
  //   paid_out  : tour completed & payout cycle cleared
  //   confirmed : paid by guest, payout upcoming (current cycle)
  //   pending   : booked but payment not yet cleared
  // payoutId references HorizonData.payouts[].id, or null if not
  // yet attached to a payout cycle.
  const rawBookings = [
    // ---- Upcoming / current week (Apr 11–28) ----
    { id: 'bk_001', date: '2026-04-28', guest: { name: 'Sarah Chen',       contact: 'sarah.c@example.com' },       tourId: 'lake-louise-canoe',        partySize: 2, staffId: 's1', source: 'QR Code — Lobby Display',       status: 'pending',   payoutId: null },
    { id: 'bk_002', date: '2026-04-25', guest: { name: 'Markus Weber',     contact: '+49 30 555 1847' },           tourId: 'banff-highlights',         partySize: 4, staffId: 's2', source: 'Concierge Referral',            status: 'confirmed', payoutId: 'po_2026_05' },
    { id: 'bk_003', date: '2026-04-22', guest: { name: 'Priya Raman',      contact: 'priya.r@example.com' },       tourId: 'moraine-lake-sightseeing', partySize: 3, staffId: 's1', source: 'QR Code — Room Key Card',       status: 'pending',   payoutId: null },
    { id: 'bk_004', date: '2026-04-20', guest: { name: 'Emma Lindqvist',   contact: '+46 70 555 8820' },           tourId: 'banff-hidden-gem-canoe',          partySize: 2, staffId: 's3', source: 'Front Desk Recommendation',     status: 'confirmed', payoutId: 'po_2026_05' },
    { id: 'bk_005', date: '2026-04-18', guest: { name: 'Hiro Tanaka',      contact: 'hiro.t@example.com' },        tourId: 'lake-louise-canoe',        partySize: 2, staffId: 's5', source: 'In-Room Tablet',                status: 'confirmed', payoutId: 'po_2026_05' },

    // ---- April (this payout cycle, confirmed) ----
    { id: 'bk_006', date: '2026-04-17', guest: { name: 'Aisha Okonkwo',    contact: 'aisha.o@example.com' },       tourId: 'banff-highlights',         partySize: 3, staffId: 's1', source: 'Concierge Referral',            status: 'confirmed', payoutId: 'po_2026_05' },
    { id: 'bk_007', date: '2026-04-15', guest: { name: 'Liam McCarthy',    contact: '+353 1 555 6612' },           tourId: 'banff-hidden-gem-canoe',          partySize: 2, staffId: 's2', source: 'QR Code — Lobby Display',       status: 'confirmed', payoutId: 'po_2026_05' },
    { id: 'bk_008', date: '2026-04-13', guest: { name: 'Sophia Rossi',     contact: 'sophia.r@example.com' },      tourId: 'lake-louise-canoe',        partySize: 2, staffId: 's1', source: 'QR Code — Room Key Card',       status: 'confirmed', payoutId: 'po_2026_05' },
    { id: 'bk_009', date: '2026-04-11', guest: { name: 'Noah Wiremu',      contact: '+64 4 555 2130' },            tourId: 'moraine-lake-sightseeing', partySize: 4, staffId: 's3', source: 'Front Desk Recommendation',     status: 'confirmed', payoutId: 'po_2026_05' },
    { id: 'bk_010', date: '2026-04-08', guest: { name: 'Rafael Mendes',    contact: 'rafael.m@example.com' },      tourId: 'banff-highlights',         partySize: 2, staffId: 's2', source: 'Concierge Referral',            status: 'confirmed', payoutId: 'po_2026_05' },
    { id: 'bk_011', date: '2026-04-05', guest: { name: 'Zara Ahmed',       contact: '+971 4 555 0918' },           tourId: 'banff-hidden-gem-canoe',          partySize: 3, staffId: 's1', source: 'In-Room Tablet',                status: 'confirmed', payoutId: 'po_2026_05' },
    { id: 'bk_012', date: '2026-04-03', guest: { name: 'Connor Walsh',     contact: 'connor.w@example.com' },      tourId: 'lake-louise-canoe',        partySize: 2, staffId: 's4', source: 'QR Code — Lobby Display',       status: 'confirmed', payoutId: 'po_2026_05' },
    { id: 'bk_013', date: '2026-04-01', guest: { name: 'Mei-Lin Tseng',    contact: 'meilin.t@example.com' },      tourId: 'moraine-lake-sightseeing', partySize: 2, staffId: 's1', source: 'Concierge Referral',            status: 'confirmed', payoutId: 'po_2026_05' },

    // ---- March (paid out Apr 1) ----
    { id: 'bk_014', date: '2026-03-30', guest: { name: 'Oliver Becker',    contact: '+49 89 555 4427' },           tourId: 'banff-highlights',         partySize: 3, staffId: 's2', source: 'QR Code — Lobby Display',       status: 'paid_out',  payoutId: 'po_2026_04' },
    { id: 'bk_015', date: '2026-03-25', guest: { name: 'Isla MacLeod',     contact: 'isla.m@example.com' },        tourId: 'lake-louise-canoe',        partySize: 2, staffId: 's1', source: 'Front Desk Recommendation',     status: 'paid_out',  payoutId: 'po_2026_04' },
    { id: 'bk_016', date: '2026-03-20', guest: { name: 'Diego Herrera',    contact: 'diego.h@example.com' },       tourId: 'banff-hidden-gem-canoe',          partySize: 4, staffId: 's3', source: 'In-Room Tablet',                status: 'paid_out',  payoutId: 'po_2026_04' },
    { id: 'bk_017', date: '2026-03-15', guest: { name: 'Anika Gupta',      contact: '+91 11 555 7731' },           tourId: 'moraine-lake-sightseeing', partySize: 2, staffId: 's1', source: 'Concierge Referral',            status: 'paid_out',  payoutId: 'po_2026_04' },
    { id: 'bk_018', date: '2026-03-10', guest: { name: "Finn O'Sullivan",  contact: 'finn.o@example.com' },        tourId: 'lake-louise-canoe',        partySize: 2, staffId: 's5', source: 'QR Code — Room Key Card',       status: 'paid_out',  payoutId: 'po_2026_04' },
    { id: 'bk_019', date: '2026-03-05', guest: { name: 'Maya Patel',       contact: 'maya.p@example.com' },        tourId: 'banff-highlights',         partySize: 3, staffId: 's2', source: 'Front Desk Recommendation',     status: 'paid_out',  payoutId: 'po_2026_04' },
    { id: 'bk_020', date: '2026-03-02', guest: { name: 'Thomas Müller',    contact: '+49 40 555 1123' },           tourId: 'banff-hidden-gem-canoe',          partySize: 2, staffId: 's1', source: 'QR Code — Lobby Display',       status: 'paid_out',  payoutId: 'po_2026_04' },

    // ---- February (paid out Mar 1) ----
    { id: 'bk_021', date: '2026-02-28', guest: { name: 'Camille Laurent',  contact: 'camille.l@example.com' },     tourId: 'banff-highlights',         partySize: 2, staffId: 's3', source: 'Concierge Referral',            status: 'paid_out',  payoutId: 'po_2026_03' },
    { id: 'bk_022', date: '2026-02-20', guest: { name: 'Jin-Ho Park',      contact: '+82 2 555 0473' },            tourId: 'moraine-lake-sightseeing', partySize: 4, staffId: 's2', source: 'In-Room Tablet',                status: 'paid_out',  payoutId: 'po_2026_03' },
    { id: 'bk_023', date: '2026-02-14', guest: { name: 'Rebecca Stone',    contact: 'rebecca.s@example.com' },     tourId: 'lake-louise-canoe',        partySize: 2, staffId: 's1', source: 'QR Code — Lobby Display',       status: 'paid_out',  payoutId: 'po_2026_03' },
    { id: 'bk_024', date: '2026-02-08', guest: { name: 'Henrik Lindqvist', contact: '+46 8 555 9027' },            tourId: 'banff-highlights',         partySize: 3, staffId: 's4', source: 'Front Desk Recommendation',     status: 'paid_out',  payoutId: 'po_2026_03' },
    { id: 'bk_025', date: '2026-02-02', guest: { name: 'Chloe Bennett',    contact: 'chloe.b@example.com' },       tourId: 'banff-hidden-gem-canoe',          partySize: 2, staffId: 's1', source: 'QR Code — Room Key Card',       status: 'paid_out',  payoutId: 'po_2026_03' },

    // ---- January (paid out Feb 1) ----
    { id: 'bk_026', date: '2026-01-30', guest: { name: 'Adrian Costa',     contact: 'adrian.c@example.com' },      tourId: 'banff-highlights',         partySize: 2, staffId: 's2', source: 'Concierge Referral',            status: 'paid_out',  payoutId: 'po_2026_02' },
    { id: 'bk_027', date: '2026-01-25', guest: { name: 'Lucia Fernández',  contact: '+34 91 555 6284' },           tourId: 'lake-louise-canoe',        partySize: 3, staffId: 's1', source: 'QR Code — Lobby Display',       status: 'paid_out',  payoutId: 'po_2026_02' },
    { id: 'bk_028', date: '2026-01-20', guest: { name: 'Jonas Andersen',   contact: 'jonas.a@example.com' },       tourId: 'moraine-lake-sightseeing', partySize: 2, staffId: 's3', source: 'In-Room Tablet',                status: 'paid_out',  payoutId: 'po_2026_02' }
  ];

  // ---- Derive bookingValue + commission on each booking ----
  // Also attaches aggregate-only guest origin + booking lead
  // time (days between booking and tour date). Origin is used
  // by the Guest Profile card; names/emails/phones are never
  // aggregated or displayed there — only the country bucket.
  const ORIGIN_BY_ID = {
    bk_001: 'Canada',       bk_002: 'Germany',     bk_003: 'India',
    bk_004: 'Sweden',       bk_005: 'Japan',       bk_006: 'Nigeria',
    bk_007: 'Ireland',      bk_008: 'Italy',       bk_009: 'New Zealand',
    bk_010: 'Brazil',       bk_011: 'UAE',         bk_012: 'USA',
    bk_013: 'Taiwan',       bk_014: 'Germany',     bk_015: 'UK',
    bk_016: 'Mexico',       bk_017: 'India',       bk_018: 'Ireland',
    bk_019: 'India',        bk_020: 'Germany',     bk_021: 'France',
    bk_022: 'South Korea',  bk_023: 'USA',         bk_024: 'Sweden',
    bk_025: 'UK',           bk_026: 'Spain',       bk_027: 'Spain',
    bk_028: 'Denmark'
  };

  const tourById = Object.fromEntries(tours.map(t => [t.id, t]));
  const bookings = rawBookings.map(b => {
    const tour = tourById[b.tourId];
    const bookingValue = tour.priceCad * b.partySize;
    const commission = Math.round(bookingValue * meta.commissionRate * 100) / 100;
    // Deterministic 1–28 day lead time per booking — enough
    // spread for the Guest Profile aggregate to feel real
    // without adding explicit timestamps to every row.
    const leadTimeDays = ((parseInt(b.id.slice(-3), 10) * 7) % 28) + 1;
    const originCountry = ORIGIN_BY_ID[b.id] || 'Other';
    return Object.assign({}, b, {
      tourName: tour.name,
      unitPrice: tour.priceCad,
      bookingValue,
      commission,
      leadTimeDays,
      guest: Object.assign({}, b.guest, { originCountry })
    });
  });

  // ---- Daily QR scan counts --------------------------------
  // Aggregated across every QR placement the hotel has deployed
  // (lobby display, room key cards, in-room tablet, etc.). Used
  // to compute the Scan → Book conversion rate and its sparkline.
  // Pattern: weekday baseline 6–10, weekend lift ~+4, with a
  // small deterministic variance so the numbers don't look flat.
  const scans = (function () {
    const out = [];
    const start = new Date('2025-10-15T00:00:00'); // ~6 months back — covers 90d current + 90d prior
    const end = new Date(meta.today + 'T00:00:00');
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      const dow = d.getDay();
      const weekend = (dow === 0 || dow === 6) ? 4 : 0;
      const variance = ((d.getDate() * 7 + d.getMonth() * 3) % 5);
      out.push({ date: iso, count: 6 + weekend + variance });
    }
    return out;
  })();

  // ---- Funnel: tour-page views + checkout starts -----------
  // Derived from `scans` with realistic drop-off ratios so the
  // funnel tells a believable story. Typical hospitality
  // referral funnel:
  //   Scan  →  ~65% view a tour page
  //   View  →  ~18% of scans start checkout  (i.e. a big drop)
  //   Checkout starts → actual bookings come from the bookings
  //                     array (not derived), so the final stage
  //                     is authoritative.
  //
  // The view → checkout cliff is intentional — it's the most
  // common leak for QR-driven traffic and gives the "Biggest
  // leak" hint something real to point at.
  const tourViews = scans.map(s => {
    const variance = ((s.date.charCodeAt(8) + s.date.charCodeAt(9)) % 3) - 1; // -1..+1
    return { date: s.date, count: Math.max(0, Math.round(s.count * 0.65) + variance) };
  });
  const checkoutStarts = scans.map(s => {
    const variance = ((s.date.charCodeAt(9) * 3) % 2); // 0..1
    return { date: s.date, count: Math.max(0, Math.round(s.count * 0.18) + variance) };
  });

  // ---- Regional benchmark ---------------------------------
  // In production this object comes from the server (aggregate
  // of all partner hotels in the same cohort). Mocked here so
  // the ribbon has something to render. percentile = this
  // hotel's rank among peers; multipleOfAverage = how many
  // times the regional-average-per-room figure this hotel is
  // pacing at. periodLabel is the natural-language window.
  const benchmark = {
    cohortLabel: 'Banff partners',
    cohortSize: 14,
    percentile: 82,           // this hotel is at the 82nd percentile → "top 18%"
    multipleOfAverage: 2.3,   // 2.3× the regional average per room
    periodLabel: 'this month'
  };

  // ---- Payout cycles --------------------------------------
  // Each payout aggregates the bookings whose payoutId matches.
  const payoutMeta = [
    { id: 'po_2026_02', date: '2026-02-01', periodStart: '2026-01-01', periodEnd: '2026-01-31', method: 'EFT', status: 'completed' },
    { id: 'po_2026_03', date: '2026-03-01', periodStart: '2026-02-01', periodEnd: '2026-02-28', method: 'EFT', status: 'completed' },
    { id: 'po_2026_04', date: '2026-04-01', periodStart: '2026-03-01', periodEnd: '2026-03-31', method: 'EFT', status: 'completed' },
    { id: 'po_2026_05', date: '2026-05-01', periodStart: '2026-04-01', periodEnd: '2026-04-30', method: 'EFT', status: 'scheduled' }
  ];

  const payouts = payoutMeta.map(p => {
    const bookingsInCycle = bookings.filter(b => b.payoutId === p.id);
    const total = bookingsInCycle.reduce((sum, b) => sum + b.commission, 0);
    return Object.assign({}, p, {
      bookingIds: bookingsInCycle.map(b => b.id),
      bookingCount: bookingsInCycle.length,
      totalCommission: Math.round(total * 100) / 100
    });
  });

  // ---- Expose globally ------------------------------------
  window.HorizonData = {
    property,
    meta,
    tours,
    staff,
    bookingSources,
    bookings,
    payouts,
    scans,
    tourViews,
    checkoutStarts,
    benchmark
  };

  // Freeze so UI code can't mutate the source of truth.
  Object.freeze(window.HorizonData);
  Object.freeze(window.HorizonData.property);
  Object.freeze(window.HorizonData.property.config);
  Object.freeze(window.HorizonData.meta);
  Object.freeze(window.HorizonData.benchmark);
})();
