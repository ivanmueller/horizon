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
    lat:      51.164073,
    lng:      -115.561854,
  },
  {
    name:     'Rimrock Resort Hotel',
    location: 'Banff',
    rooms:    346,
    lat:      51.151571,
    lng:      -115.559666,
  },
  {
    name:     'Moose Hotel & Suites',
    location: 'Banff',
    rooms:    174,
    lat:      51.180759,
    lng:      -115.569869,
  },
  {
    name:     'Banff Park Lodge',
    location: 'Banff',
    rooms:    211,
    lat:      51.177376,
    lng:      -115.574195,
  },
  {
    name:     'The Juniper Hotel & Bistro',
    location: 'Banff',
    rooms:    52,
    lat:      51.187386,
    lng:      -115.588376,
  },
  {
    name:     'Buffalo Mountain Lodge',
    location: 'Banff',
    rooms:    108,
    lat:      51.183429,
    lng:      -115.551260,
  },
  {
    name:     'Elk + Avenue Hotel',
    location: 'Banff',
    rooms:    162,
    lat:      51.179920,
    lng:      -115.570630,
  },
  {
    name:     'Banff Ptarmigan Inn',
    location: 'Banff',
    rooms:    134,
    lat:      51.180315,
    lng:      -115.570239,
  },
  {
    name:     'Mount Royal Hotel',
    location: 'Banff',
    rooms:    135,
    lat:      51.176125,
    lng:      -115.570555,
  },
  {
    name:     'Royal Canadian Lodge',
    location: 'Banff',
    rooms:    99,
    lat:      51.183276,
    lng:      -115.563930,
  },
  {
    name:     'Peaks Hotel and Suites',
    location: 'Banff',
    rooms:    96,
    lat:      51.177715,
    lng:      -115.573380,
  },
  {
    name:     'Hidden Ridge Resort',
    location: 'Banff',
    rooms:    118,
    lat:      51.188133,
    lng:      -115.546139,
  },
  {
    name:     'The Rundlestone Lodge',
    location: 'Banff',
    rooms:    96,
    lat:      51.184942,
    lng:      -115.558882,
  },
  {
    name:     'Bow View Lodge',
    location: 'Banff',
    rooms:    46,
    lat:      51.177885,
    lng:      -115.575579,
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
