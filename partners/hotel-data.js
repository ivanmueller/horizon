/* ==========================================================
   hotel-data.js — Horizon Tours Partner Program
   ==========================================================

   HOW TO FIND ACCURATE PIN COORDINATES
   ─────────────────────────────────────
   1. Go to https://www.google.com/maps
   2. Search the hotel name
   3. Right-click directly on the hotel building on the map
   4. The first item in the context menu shows the coordinates,
      e.g. "51.1677, -115.5711" — click it to copy
   5. The FIRST number is lat, the SECOND is lng
   6. Paste them into the hotel entry below

   Tip: zoom in to street level before right-clicking so you
   land on the building footprint, not the parking lot.

   ========================================================== */


/* ----------------------------------------------------------
   COMMISSION MODEL
   Monthly estimate = rooms × occupancy × guestsPerRoom
                      ÷ avgStayNights × 30
                      × activityRate
                      × avgBookingValue × commissionRate
   ---------------------------------------------------------- */
const COMMISSION_CONFIG = {
  occupancyRate:    0.72,   // 72% — avg Banff hotel occupancy (peak season blended)
  guestsPerRoom:    2.0,    // avg guests per occupied room
  avgStayNights:    3,      // avg guest length of stay in nights
  activityRate:     0.05,   // 5% of guests book a Horizon tour (conservative cold-start)
  avgBookingValue:  209,    // CAD — blended avg across all Horizon tour prices
  commissionRate:   0.15,   // 15% — Horizon standard partner commission
};


/* ----------------------------------------------------------
   HOTEL DATABASE
   Fields:
     name     — Full hotel name (must be unique)
     location — City/area label shown in popup and result chip
     rooms    — Total bookable rooms (check hotel website or
                booking.com listing for accurate count)
     lat/lng  — Coordinates (see instructions above)
   ---------------------------------------------------------- */
const HOTELS = [

  // ── BANFF ──────────────────────────────────────────────
  {
    name:     'Fairmont Banff Springs',
    location: 'Banff',
    rooms:    764,
    lat:      51.164511,
    lng:      -115.561884,
  },
  {
    name:     'Rimrock Resort Hotel',
    location: 'Banff',
    rooms:    346,
    lat:      51.1508842,
    lng:      -115.5601391,
  },
  {
    name:     'Moose Hotel & Suites',
    location: 'Banff',
    rooms:    174,
    lat:      51.1805445,
    lng:      -115.5702869,
  },
  {
    name:     'Banff Park Lodge',
    location: 'Banff',
    rooms:    211,
    lat:      51.1774827,
    lng:      -115.5687,
  },
  {
    name:     'The Juniper Hotel & Bistro',
    location: 'Banff',
    rooms:    52,
    lat:      51.1840,
    lng:      -115.5761469,
  },
  {
    name:     'Buffalo Mountain Lodge',
    location: 'Banff',
    rooms:    108,
    lat:      51.1838296,
    lng:      -115.552784,
  },
  {
    name:     'Elk + Avenue Hotel',
    location: 'Banff',
    rooms:    162,
    lat:      51.1796604,
    lng:      -115.5714634,
  },
  {
    name:     'Banff Ptarmigan Inn',
    location: 'Banff',
    rooms:    134,
    lat:      51.1801693,
    lng:      -115.5712166,
  },
  {
    name:     'Mount Royal Hotel',
    location: 'Banff',
    rooms:    135,
    lat:      51.1778772,
    lng:      -115.5715237,
  },
  {
    name:     'Royal Canadian Lodge',
    location: 'Banff',
    rooms:    99,
    lat:      51.1829899,
    lng:      -115.5647446,
  },
  {
    name:     'Peaks Hotel and Suites',
    location: 'Banff',
    rooms:    96,
    lat:      51.1775114,
    lng:      -115.5759281,
  },
  {
    name:     'Hidden Ridge Resort',
    location: 'Banff',
    rooms:    118,
    lat:      51.1880943,
    lng:      -115.5468693,
  },
  {
    name:     'The Rundlestone Lodge',
    location: 'Banff',
    rooms:    96,
    lat:      51.1848778,
    lng:      -115.5611623,
  },
  {
    name:     'Bow View Lodge',
    location: 'Banff',
    rooms:    46,
    lat:      51.1778907,
    lng:      -115.5781364,
  },

  // ── CANMORE ────────────────────────────────────────────
  {
    name:     'Malcolm Hotel',
    location: 'Canmore',
    rooms:    122,
    lat:      51.0878,
    lng:      -115.3595,
  },
  {
    name:     'Solara Resort & Spa',
    location: 'Canmore',
    rooms:    130,
    lat:      51.0921,
    lng:      -115.3601,
  },
  {
    name:     'Coast Canmore Hotel',
    location: 'Canmore',
    rooms:    166,
    lat:      51.0938,
    lng:      -115.3588,
  },
  {
    name:     'Basecamp Resorts Canmore',
    location: 'Canmore',
    rooms:    81,
    lat:      51.0892,
    lng:      -115.3587,
  },
  {
    name:     'Grande Rockies Resort',
    location: 'Canmore',
    rooms:    150,
    lat:      51.0905,
    lng:      -115.3578,
  },

  // ── ADD NEW HOTELS BELOW ───────────────────────────────
  // Copy the block below, fill in the fields, save the file.
  //
  // {
  //   name:     'Hotel Name Here',
  //   location: 'Banff',          // or 'Canmore', 'Lake Louise', etc.
  //   rooms:    100,
  //   lat:      51.0000,          // right-click on Google Maps to get this
  //   lng:      -115.0000,
  // },

];
