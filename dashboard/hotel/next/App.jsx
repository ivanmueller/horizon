/* Top-level app — wires the dashboard surfaces together with
   demo data lifted from /partners.json and /dashboard/hotel/index.html
   in the live Horizon repo. */

const DEMO_HOTEL = 'Banff Springs Hotel';
const DEMO_USER  = { name: 'Hannah Cole', email: 'hcole@banffsprings.example' };

const DEMO_KPIS = {
  bookings:   { v: '347', delta: 18, sub: 'vs. previous 30 days' },
  revenue:    { v: 'CA$ 226,684', delta: 11, sub: 'Gross before commission' },
  travelers:  { v: '912',   delta:  6, sub: '2.6 travellers / booking avg' },
  commission: { v: 'CA$ 28,420.50', delta: null, sub: '12.5% of revenue · paid net-30' },
};

const DEMO_CHART = (() => {
  // Deterministic faux-30-day series so the chart doesn't reshuffle on reload.
  const out = [];
  const base = 600;
  let v = base;
  for (let i = 0; i < 30; i++) {
    v = Math.max(180, v + (Math.sin(i*0.7)*180) + (Math.cos(i*0.31)*90) + (i<14 ? -8 : 22));
    const d = new Date(); d.setDate(d.getDate() - (29 - i));
    out.push({ l: d.toLocaleString('en-CA', { month: 'short', day: 'numeric' }), v: Math.round(v) });
  }
  return out;
})();

const DEMO_ROWS = [
  { id:1, bookedOn:'May 18', tour:'Lake Louise Canoe + Moraine',    guest:'Sarah Kim',     travelers:4, amount:996.00, commission:124.50, source:'Lobby kiosk',  status:'credited', confirmation:'HRZ-3DK29F' },
  { id:2, bookedOn:'May 18', tour:'Banff Highlights + Gondola',     guest:'Marcus Tran',   travelers:2, amount:498.00, commission: 62.25, source:'Concierge · Lina', status:'credited', confirmation:'HRZ-J47P11' },
  { id:3, bookedOn:'May 17', tour:'Hidden Gem Canoe Tour',          guest:'Jenny Liu',     travelers:3, amount:749.97, commission: 93.75, source:'Lobby kiosk',  status:'pending',  confirmation:'HRZ-WQ8A02' },
  { id:4, bookedOn:'May 17', tour:'Lake Louise Canoe + Moraine',    guest:'Amal Rashid',   travelers:2, amount:498.00, commission: 62.25, source:'Hotel card',   status:'credited', confirmation:'HRZ-2VX880' },
  { id:5, bookedOn:'May 16', tour:'Banff Highlights + Gondola',     guest:'Devon Carlsen', travelers:5, amount:1245.00, commission:155.63, source:'Placement · Spotify',  status:'review', confirmation:'HRZ-K88RZA' },
  { id:6, bookedOn:'May 16', tour:'Lake Agnes Tea House Hike',      guest:'Priya Singh',   travelers:2, amount:398.00, commission: 49.75, source:'Concierge · Marc',  status:'credited', confirmation:'HRZ-78L40Q' },
  { id:7, bookedOn:'May 15', tour:'Hidden Gem Canoe Tour',          guest:'Tom Wilson',    travelers:2, amount:499.98, commission: 62.50, source:'Hotel card',   status:'failed',   confirmation:'HRZ-6N2WCC' },
  { id:8, bookedOn:'May 15', tour:'Lake Louise Canoe + Moraine',    guest:'Mei Tanaka',    travelers:3, amount:747.00, commission: 93.38, source:'Lobby kiosk',  status:'credited', confirmation:'HRZ-FT09M1' },
];

const DEMO_LINKS = [
  { label:'Lobby kiosk',              url:'gowithhorizon.com/r/banff-lobby',     clicks:2412 },
  { label:'Concierge — Lina',         url:'gowithhorizon.com/r/banff-lina',      clicks: 384 },
  { label:'Concierge — Marc',         url:'gowithhorizon.com/r/banff-marc',      clicks: 211 },
  { label:'In-room QR card',          url:'gowithhorizon.com/r/banff-room',      clicks:1098 },
  { label:'Summer 2026 campaign',     url:'gowithhorizon.com/r/banff-s26',       clicks: 642 },
];

function App() {
  const [active,  setActive]  = React.useState('overview');
  const [range,   setRange]   = React.useState(30);
  const [modal,   setModal]   = React.useState(false);
  const [toast,   setToast]   = React.useState('');

  function flashToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 2200);
  }
  function copyUrl(u) {
    if (navigator.clipboard) navigator.clipboard.writeText(u).catch(()=>{});
    flashToast('Copied ' + u);
  }
  function downloadQr(label) { flashToast('Downloading QR · ' + label + '.png'); }

  return (
    <>
      <div className="app">
        <Sidebar active={active} onNavigate={setActive} hotel={DEMO_HOTEL} user={DEMO_USER} />

        <div style={{minWidth:0,display:'flex',flexDirection:'column'}}>
          <Topbar onNew={() => flashToast('Opening new referral link wizard')} setupDone={3} setupTotal={5} />

          <main className="page">
            <div className="page__head">
              <div>
                <div className="page__title">Overview</div>
                <div className="page__sub">Bookings, payouts, and referral links for {DEMO_HOTEL}</div>
              </div>
              <div style={{display:'flex',gap:8}}>
                <button className="btn"><I.refresh size={14} /> Refresh</button>
                <button className="btn" onClick={() => setModal(true)}><I.settings size={14} /> Account</button>
              </div>
            </div>

            <div className="controls">
              <RangePicker value={range} onChange={setRange} />
            </div>

            <section className="kpi-grid">
              <KPI label="Bookings"   value={DEMO_KPIS.bookings.v}   delta={DEMO_KPIS.bookings.delta}   sub={DEMO_KPIS.bookings.sub}   icon={I.calendar} />
              <KPI label="Revenue"    value={DEMO_KPIS.revenue.v}    delta={DEMO_KPIS.revenue.delta}    sub={DEMO_KPIS.revenue.sub}    icon={I.receipt} />
              <KPI label="Travellers" value={DEMO_KPIS.travelers.v}  delta={DEMO_KPIS.travelers.delta}  sub={DEMO_KPIS.travelers.sub}  icon={I.users} />
              <KPI label="Commission" value={DEMO_KPIS.commission.v} delta={DEMO_KPIS.commission.delta} sub={DEMO_KPIS.commission.sub} icon={I.dollar} />
            </section>

            <ChartPanel data={DEMO_CHART} />

            <BookingsTable rows={DEMO_ROWS} onRowClick={r => flashToast('Opening attribution funnel · ' + r.confirmation)} />

            <ReferralLinksSection links={DEMO_LINKS} onCopy={copyUrl} onDownload={downloadQr} />
          </main>
        </div>
      </div>

      <AccountModal open={modal} email={DEMO_USER.email} onClose={() => setModal(false)} onSave={() => { setModal(false); flashToast('Password saved.'); }} />

      {toast && (
        <div className="toast">
          <I.check size={14} />
          <span>{toast}</span>
        </div>
      )}
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
