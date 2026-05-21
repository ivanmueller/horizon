/* Admin app — wires sidebar + topbar + pages + drawer. */

const HOTELS = [
  // Real-data hotels lifted from /partners/hotel-data.js with demo
  // status / volume / commission attached for visual recreation.
  { slug:'fairmont-banff-springs', name:'Fairmont Banff Springs',  location:'Banff',   rooms:764, status:'active',  bookings30d:412, commission30d:8240, commissionPct:15, lastActivity:'2m ago',  joined:'Feb 1, 2026',  conversion:9.4 },
  { slug:'fcll',                   name:'Fairmont Chateau Lake Louise', location:'Lake Louise', rooms:539, status:'active', bookings30d:298, commission30d:6112, commissionPct:15, lastActivity:'7m ago', joined:'Feb 8, 2026', conversion:8.8 },
  { slug:'rimrock',                name:'Rimrock Resort Hotel',     location:'Banff',   rooms:346, status:'active',  bookings30d:206, commission30d:4318, commissionPct:14, lastActivity:'12m ago', joined:'Feb 14, 2026', conversion:8.1 },
  { slug:'moose-hotel',            name:'Moose Hotel & Suites',     location:'Banff',   rooms:174, status:'active',  bookings30d:188, commission30d:3804, commissionPct:15, lastActivity:'18m ago', joined:'Mar 1, 2026',  conversion:7.9 },
  { slug:'banff-park-lodge',       name:'Banff Park Lodge',         location:'Banff',   rooms:211, status:'active',  bookings30d:152, commission30d:3024, commissionPct:14, lastActivity:'40m ago', joined:'Mar 7, 2026',  conversion:7.4 },
  { slug:'elk-avenue',             name:'Elk + Avenue Hotel',       location:'Banff',   rooms:162, status:'active',  bookings30d:141, commission30d:2810, commissionPct:14, lastActivity:'1h ago',  joined:'Mar 14, 2026', conversion:7.0 },
  { slug:'mount-royal',            name:'Mount Royal Hotel',        location:'Banff',   rooms:135, status:'active',  bookings30d:118, commission30d:2380, commissionPct:14, lastActivity:'2h ago',  joined:'Mar 21, 2026', conversion:6.8 },
  { slug:'buffalo-mountain-lodge', name:'Buffalo Mountain Lodge',   location:'Banff',   rooms:108, status:'active',  bookings30d: 96, commission30d:1955, commissionPct:13, lastActivity:'3h ago',  joined:'Apr 1, 2026' },
  { slug:'peaks-hotel',            name:'Peaks Hotel and Suites',   location:'Banff',   rooms: 96, status:'active',  bookings30d: 84, commission30d:1716, commissionPct:14, lastActivity:'4h ago',  joined:'Apr 5, 2026' },
  { slug:'banff-ptarmigan-inn',    name:'Banff Ptarmigan Inn',      location:'Banff',   rooms:134, status:'active',  bookings30d: 72, commission30d:1442, commissionPct:13, lastActivity:'5h ago',  joined:'Apr 12, 2026' },
  { slug:'royal-canadian-lodge',   name:'Royal Canadian Lodge',     location:'Banff',   rooms: 99, status:'paused',  bookings30d: 22, commission30d: 412, commissionPct:13, lastActivity:'2d ago',  joined:'Apr 18, 2026' },
  { slug:'rundlestone-lodge',      name:'The Rundlestone Lodge',    location:'Banff',   rooms: 96, status:'active',  bookings30d: 58, commission30d:1182, commissionPct:13, lastActivity:'1d ago',  joined:'Apr 24, 2026' },
  { slug:'juniper',                name:'The Juniper Hotel & Bistro',location:'Banff',  rooms: 52, status:'pending', bookings30d:  0, commission30d:   0, commissionPct:14, lastActivity:'—',       joined:'May 12, 2026' },
  { slug:'hidden-ridge',           name:'Hidden Ridge Resort',      location:'Banff',   rooms:118, status:'invited',  bookings30d:  0, commission30d:   0, commissionPct:14, lastActivity:'—',       joined:'May 17, 2026' },
  { slug:'bow-view-lodge',         name:'Bow View Lodge',           location:'Banff',   rooms: 46, status:'invited',  bookings30d:  0, commission30d:   0, commissionPct:13, lastActivity:'—',       joined:'May 19, 2026' },
  { slug:'malcolm-hotel',          name:'Malcolm Hotel',            location:'Canmore', rooms:122, status:'active',   bookings30d:148, commission30d:2942, commissionPct:14, lastActivity:'6h ago',  joined:'Mar 28, 2026' },
  { slug:'solara',                 name:'Solara Resort & Spa',      location:'Canmore', rooms:130, status:'active',   bookings30d:132, commission30d:2614, commissionPct:14, lastActivity:'8h ago',  joined:'Apr 3, 2026' },
  { slug:'coast-canmore',          name:'Coast Canmore Hotel',      location:'Canmore', rooms:166, status:'active',   bookings30d:128, commission30d:2547, commissionPct:14, lastActivity:'9h ago',  joined:'Apr 10, 2026' },
  { slug:'grande-rockies',         name:'Grande Rockies Resort',    location:'Canmore', rooms:150, status:'suspended',bookings30d: 14, commission30d: 282, commissionPct:14, lastActivity:'4d ago',  joined:'Apr 17, 2026' },
];

const ACTIVITY = [
  { kind:'booking', title:'New booking · <strong>Lake Louise Canoe + Moraine</strong>',  sub:'Fairmont Banff Springs · 4 travellers',           amt:'CA$ 996.00',  when:'2 min ago' },
  { kind:'booking', title:'New booking · <strong>Banff Highlights + Gondola</strong>',   sub:'Mount Royal Hotel · 2 travellers',                  amt:'CA$ 498.00',  when:'7 min ago' },
  { kind:'payout',  title:'Payout sent · <strong>Solara Resort & Spa</strong>',          sub:'Stripe transfer · acct ●●●● 4421',                  amt:'CA$ 3,820.50',when:'18 min ago' },
  { kind:'join',    title:'New partner accepted · <strong>The Juniper Hotel</strong>',   sub:'Onboarding queued · QR cards ship Thursday',                          when:'1 hr ago' },
  { kind:'booking', title:'New booking · <strong>Hidden Gem Canoe Tour</strong>',        sub:'Rimrock Resort · 3 travellers',                     amt:'CA$ 749.97',  when:'1 hr ago' },
  { kind:'failed',  title:'Booking sync failed · <strong>Bokun connector</strong>',      sub:'Grande Rockies Resort · 502, retried',                                when:'2 hr ago' },
  { kind:'payout',  title:'Payout sent · <strong>Mount Royal Hotel</strong>',            sub:'Stripe transfer · acct ●●●● 9921',                  amt:'CA$ 2,310.80',when:'3 hr ago' },
];

function App() {
  const [active,   setActive]   = React.useState('hotels');
  const [hotel,    setHotel]    = React.useState(null);

  function openHotel(h) {
    if (h) {
      // Full-page hotel detail — matches production /admin/hotels/<slug>/
      setHotel(h);
      setActive('hotel-detail');
    } else {
      setActive('hotels');
    }
  }
  function backToHotels() {
    setActive('hotels');
    setHotel(null);
  }

  const top5 = [...HOTELS].sort((a,b) => b.commission30d - a.commission30d).slice(0, 5);

  // Sidebar should still highlight "Hotels" while on the hotel-detail sub-route
  const navActive = active === 'hotel-detail' ? 'hotels' : active;

  return (
    <>
      <div className="app">
        <Sidebar active={navActive} onNavigate={(k) => { setActive(k); setHotel(null); }} pending={4} />

        <div className="main">
          <Topbar onAdd={() => {}} />

          {active === 'home' && (
            <OverviewPage onOpenHotel={openHotel} topHotels={top5} activity={ACTIVITY} />
          )}
          {active === 'hotels' && (
            <HotelsPage hotels={HOTELS} onOpenHotel={openHotel} openSlug={null} />
          )}
          {active === 'bookings' && <BookingsPage />}
          {active === 'hotel-detail' && hotel && (
            <HotelDetailPage hotel={hotel} onBack={backToHotels} />
          )}
          {!['home','hotels','hotel-detail','bookings'].includes(active) && (
            <div className="page">
              <div className="card" style={{padding:'48px 32px',textAlign:'center',color:'var(--text-secondary)'}}>
                <div style={{fontSize:15,fontWeight:500,color:'var(--text-primary)',marginBottom:6}}>
                  {active.charAt(0).toUpperCase() + active.slice(1).replace('-', ' ')} surface
                </div>
                Coming next phase. The Home, Hotels list, and Hotel detail surfaces are the canonical patterns
                — Bookings / Payouts / Short links follow the same chrome.
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
