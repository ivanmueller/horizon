/* Bookings page — Stripe-style: tabs + statcards + filter chips + table with
   expandable attribution funnel detail rows. Data is fabricated to match
   the same shape Horizon Connect's bookings API returns (see admin source). */

const BOOKINGS = [
  { id:'bk_3DK29F', amount: 996.00, commission: 124.50, status:'confirmed', tour:'Lake Louise Canoe + Moraine', pax:4, customer:'Sarah Kim',     date:'May 18, 2026', tourDate:'May 22', hotel:'Fairmont Banff Springs',     ref:'lobby',     refLabel:'Lobby kiosk',          policy:'Last-touch · 30d', firstTouchAt:'May 14, 09:12', conversionMs:1000*60*60*92,
    touches:[
      { code:'HRZ-banff-lobby',  stream:'Lobby kiosk',            when:'May 14, 09:12', credited:false },
      { code:'HRZ-banff-room',   stream:'In-room QR · room 421',  when:'May 14, 21:48', credited:false },
      { code:'HRZ-banff-lobby',  stream:'Lobby kiosk',            when:'May 17, 11:02', credited:true  },
      { code:'',                 stream:'Bokun checkout',         when:'May 18, 14:36', credited:false },
    ] },
  { id:'bk_J47P11', amount: 498.00, commission:  62.25, status:'confirmed', tour:'Banff Highlights + Gondola',   pax:2, customer:'Marcus Tran',    date:'May 18, 2026', tourDate:'May 24', hotel:'Mount Royal Hotel',          ref:'staff',     refLabel:'Concierge · Lina',     policy:'Last-touch · 30d', firstTouchAt:'May 17, 16:40', conversionMs:1000*60*60*22,
    touches:[
      { code:'HRZ-LP',           stream:'Concierge · Lina Park',  when:'May 17, 16:40', credited:true },
      { code:'',                 stream:'Bokun checkout',         when:'May 18, 14:51', credited:false },
    ] },
  { id:'bk_WQ8A02', amount: 749.97, commission:  93.75, status:'upcoming',  tour:'Hidden Gem Canoe Tour',        pax:3, customer:'Jenny Liu',      date:'May 17, 2026', tourDate:'May 28', hotel:'Rimrock Resort Hotel',       ref:'placement',refLabel:'In-room QR card',      policy:'First-touch',        firstTouchAt:'May 12, 19:24', conversionMs:1000*60*60*120,
    touches:[
      { code:'HRZ-banff-room',   stream:'In-room QR · room 314',  when:'May 12, 19:24', credited:true },
      { code:'HRZ-banff-lobby',  stream:'Lobby kiosk',            when:'May 14, 11:08', credited:false },
      { code:'HRZ-banff-room',   stream:'In-room QR · room 314',  when:'May 17, 08:15', credited:false },
      { code:'',                 stream:'Bokun checkout',         when:'May 17, 21:11', credited:false },
    ] },
  { id:'bk_2VX880', amount: 498.00, commission:  62.25, status:'confirmed', tour:'Lake Louise Canoe + Moraine',  pax:2, customer:'Amal Rashid',    date:'May 17, 2026', tourDate:'May 21', hotel:'Fairmont Banff Springs',     ref:'hotel',     refLabel:'Hotel card',           policy:'Last-touch · 30d', firstTouchAt:'May 16, 14:02', conversionMs:1000*60*60*8,
    touches:[
      { code:'HRZ-fairmont',     stream:'Hotel card · master',    when:'May 16, 14:02', credited:true },
      { code:'',                 stream:'Bokun checkout',         when:'May 17, 09:48', credited:false },
    ] },
  { id:'bk_K88RZA', amount:1245.00, commission: 155.63, status:'pending_refund', tour:'Banff Highlights + Gondola', pax:5, customer:'Devon Carlsen', date:'May 16, 2026', tourDate:'May 25', hotel:'Mount Royal Hotel',      ref:'placement',refLabel:'Placement · Spotify',  policy:'Time-decay',         firstTouchAt:'May 10, 12:08', conversionMs:1000*60*60*144,
    touches:[
      { code:'HRZ-banff-s26',    stream:'Placement · Summer 2026',when:'May 10, 12:08', credited:false },
      { code:'HRZ-MR',           stream:'Hotel card · master',    when:'May 13, 18:21', credited:false },
      { code:'HRZ-MR',           stream:'Hotel card · master',    when:'May 16, 10:33', credited:true },
      { code:'',                 stream:'Bokun checkout',         when:'May 16, 15:48', credited:false },
    ] },
  { id:'bk_78L40Q', amount: 398.00, commission:  49.75, status:'confirmed', tour:'Lake Agnes Tea House Hike',    pax:2, customer:'Priya Singh',    date:'May 16, 2026', tourDate:'May 19', hotel:'Fairmont Banff Springs',     ref:'staff',     refLabel:'Concierge · Marc',     policy:'Last-touch · 30d', firstTouchAt:'May 15, 17:30', conversionMs:1000*60*60*16,
    touches:[
      { code:'HRZ-MB',           stream:'Concierge · Marc Boucher', when:'May 15, 17:30', credited:true },
      { code:'',                 stream:'Bokun checkout',         when:'May 16, 09:14', credited:false },
    ] },
  { id:'bk_6N2WCC', amount: 499.98, commission:   0.00, status:'refunded',  tour:'Hidden Gem Canoe Tour',        pax:2, customer:'Tom Wilson',     date:'May 15, 2026', tourDate:'May 18', hotel:'Rimrock Resort Hotel',       ref:'hotel',     refLabel:'Hotel card',           policy:'Last-touch · 30d', firstTouchAt:'May 14, 21:08', conversionMs:1000*60*60*4,
    touches:[
      { code:'HRZ-rimrock',      stream:'Hotel card · master',    when:'May 14, 21:08', credited:true },
      { code:'',                 stream:'Bokun checkout',         when:'May 15, 01:32', credited:false },
    ] },
  { id:'bk_FT09M1', amount: 747.00, commission:  93.38, status:'confirmed', tour:'Lake Louise Canoe + Moraine',  pax:3, customer:'Mei Tanaka',     date:'May 15, 2026', tourDate:'May 23', hotel:'Fairmont Banff Springs',     ref:'lobby',     refLabel:'Lobby kiosk',          policy:'Last-touch · 30d', firstTouchAt:'May 12, 08:42', conversionMs:1000*60*60*72,
    touches:[
      { code:'HRZ-banff-lobby',  stream:'Lobby kiosk',            when:'May 12, 08:42', credited:false },
      { code:'HRZ-banff-lobby',  stream:'Lobby kiosk',            when:'May 14, 12:18', credited:true  },
      { code:'',                 stream:'Bokun checkout',         when:'May 15, 11:30', credited:false },
    ] },
  { id:'bk_3RT440', amount: 996.00, commission: 124.50, status:'upcoming',  tour:'Lake Louise Canoe + Moraine',  pax:4, customer:'Hannah Cole',    date:'May 14, 2026', tourDate:'May 30', hotel:'Solara Resort & Spa',        ref:'staff',     refLabel:'Concierge · Anna',     policy:'Last-touch · 30d', firstTouchAt:'May 13, 11:00', conversionMs:1000*60*60*20,
    touches:[
      { code:'HRZ-AL',           stream:'Concierge · Anna Liang', when:'May 13, 11:00', credited:true },
      { code:'',                 stream:'Bokun checkout',         when:'May 14, 07:18', credited:false },
    ] },
  { id:'bk_PP8821', amount: 249.99, commission:  31.25, status:'cancelled', tour:'Lake Agnes Tea House Hike',    pax:1, customer:'Owen Wright',    date:'May 14, 2026', tourDate:'—',      hotel:'Coast Canmore Hotel',         ref:'lobby',     refLabel:'Lobby kiosk',          policy:'Last-touch · 30d', firstTouchAt:'May 13, 20:14', conversionMs:1000*60*60*12,
    touches:[
      { code:'HRZ-canmore',      stream:'Hotel card · master',    when:'May 13, 20:14', credited:true },
      { code:'',                 stream:'Bokun checkout',         when:'May 14, 08:02', credited:false },
    ] },
];

const STATUS_LABEL = {
  confirmed:      { label: 'Confirmed',      cls: 'bk-pill--ok' },
  upcoming:       { label: 'Upcoming',       cls: 'bk-pill--info' },
  refunded:       { label: 'Refunded',       cls: 'bk-pill--neutral' },
  cancelled:      { label: 'Cancelled',      cls: 'bk-pill--neutral' },
  pending_refund: { label: 'Pending refund', cls: 'bk-pill--warn' },
};

function BkPill({ status }) {
  const s = STATUS_LABEL[status] || STATUS_LABEL.confirmed;
  return <span className={'bk-pill ' + s.cls}>{s.label}</span>;
}

function fmtMoney(n) { return 'CA$ ' + n.toFixed(2); }

function fmtLag(ms) {
  if (ms == null) return '—';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return mins + ' min';
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return hrs + ' hr';
  return Math.round(hrs / 24) + ' days';
}

function FunnelDetail({ booking }) {
  return (
    <div className="bk-funnel">
      <div className="bk-funnel__col">
        <h4>Attribution funnel</h4>
        <ol className="bk-funnel__steps">
          {booking.touches.map((t, i) => (
            <li key={i} className={'bk-funnel__step ' + (t.credited ? 'bk-funnel__step--credited' : '')}>
              <span className="bk-funnel__n">{i + 1}</span>
              <span className="bk-funnel__label">{t.stream}</span>
              <span className="bk-funnel__code">{t.code || '—'}</span>
              <span className="bk-funnel__when">
                {t.when}
                {t.credited && <span className="bk-funnel__credited" style={{marginLeft:8}}>Credited</span>}
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div className="bk-funnel__col">
        <h4>Booking metadata</h4>
        <div className="bk-funnel__meta">
          <div className="bk-funnel__metarow"><span>Booking ID</span><span className="mono">{booking.id}</span></div>
          <div className="bk-funnel__metarow"><span>Hotel</span><span>{booking.hotel}</span></div>
          <div className="bk-funnel__metarow"><span>Tour date</span><span>{booking.tourDate}</span></div>
          <div className="bk-funnel__metarow"><span>First touch</span><span>{booking.firstTouchAt}</span></div>
          <div className="bk-funnel__metarow"><span>Time to book</span><span>{fmtLag(booking.conversionMs)}</span></div>
          <div className="bk-funnel__metarow"><span>Attribution policy</span><span>{booking.policy}</span></div>
          <div className="bk-funnel__metarow"><span>Touches</span><span>{booking.touches.length}</span></div>
        </div>
      </div>
    </div>
  );
}

function DatePopover({ value, onApply, onClose }) {
  const [op, setOp] = React.useState(value?.op || 'last');
  const [n,  setN]  = React.useState(value?.n  || 30);
  const [unit, setUnit] = React.useState(value?.unit || 'days');
  function apply() {
    onApply({ op, n, unit });
    onClose();
  }
  return (
    <div className="bk-datepop" style={{position:'absolute',top:'42px',left:'0'}}>
      <div className="bk-datepop__title">Filter by date and time</div>
      <select value={op} onChange={e => setOp(e.target.value)}>
        <option value="last">is in the last</option>
        <option value="eq">is equal to</option>
        <option value="between">is between</option>
        <option value="after">is on or after</option>
        <option value="before">is before or on</option>
      </select>
      {op === 'last' && (
        <div className="bk-datepop__row">
          <input type="number" min="1" value={n} onChange={e => setN(parseInt(e.target.value)||1)} />
          <select value={unit} onChange={e => setUnit(e.target.value)}>
            <option value="days">days</option>
            <option value="weeks">weeks</option>
            <option value="months">months</option>
            <option value="years">years</option>
          </select>
        </div>
      )}
      {(op === 'eq' || op === 'after' || op === 'before') && (
        <div className="bk-datepop__row">
          <input type="text" placeholder="MM / DD / YYYY" defaultValue="" style={{flex:1}}/>
        </div>
      )}
      {op === 'between' && (
        <div className="bk-datepop__row">
          <input type="text" placeholder="From" style={{flex:1}}/>
          <span style={{color:'var(--text-secondary)',fontSize:12}}>and</span>
          <input type="text" placeholder="To" style={{flex:1}}/>
        </div>
      )}
      <div style={{display:'flex',gap:8,marginTop:4}}>
        <button className="btn btn--sm" onClick={onClose} style={{flex:1}}>Cancel</button>
        <button className="bk-datepop__apply" onClick={apply}>Apply</button>
      </div>
    </div>
  );
}

function BookingsPage() {
  const [status, setStatus] = React.useState('all');
  const [dateFilter, setDateFilter] = React.useState(null);
  const [datePopOpen, setDatePopOpen] = React.useState(false);
  const [expanded, setExpanded] = React.useState(null);

  const counts = React.useMemo(() => {
    const c = { all: BOOKINGS.length, upcoming:0, confirmed:0, refunded:0, cancelled:0, pending_refund:0 };
    for (const b of BOOKINGS) c[b.status] = (c[b.status] || 0) + 1;
    return c;
  }, []);

  const filtered = BOOKINGS.filter(b => status === 'all' || b.status === status);

  const dateChipLabel = dateFilter
    ? (dateFilter.op === 'last' ? `Date · last ${dateFilter.n} ${dateFilter.unit}` :
       dateFilter.op === 'between' ? 'Date · between' :
       'Date · ' + dateFilter.op)
    : 'Date and time';

  const statTiles = [
    { key:'all',            label:'All',            count: counts.all },
    { key:'upcoming',       label:'Upcoming',       count: counts.upcoming       || 0 },
    { key:'confirmed',      label:'Confirmed',      count: counts.confirmed      || 0 },
    { key:'refunded',       label:'Refunded',       count: counts.refunded       || 0 },
    { key:'cancelled',      label:'Cancelled',      count: counts.cancelled      || 0 },
    { key:'pending_refund', label:'Pending refund', count: counts.pending_refund || 0 },
  ];

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <div className="page__title">Bookings</div>
          <div className="page__sub">All bookings routed through Horizon Connect across the partner network.</div>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button className="btn"><I.trend size={14} /> Analyze</button>
          <button className="btn btn--primary"><I.plus size={14} /> Create booking</button>
        </div>
      </div>

      <div className="bk-statcards" role="group" aria-label="Status filter">
        {statTiles.map(s => (
          <button key={s.key}
            className={'bk-statcard ' + (status === s.key ? 'bk-statcard--active' : '')}
            onClick={() => setStatus(s.key)}>
            <div className="bk-statcard__label">{s.label}</div>
            <div className="bk-statcard__value">{s.count}</div>
          </button>
        ))}
      </div>

      <div className="bk-toolbar">
        <div className="bk-filters">
          <div style={{position:'relative'}}>
            <button
              className={'bk-chip ' + (dateFilter ? 'bk-chip--active' : '')}
              onClick={() => setDatePopOpen(o => !o)}
            >
              <span className="bk-chip__plus">{dateFilter ? '×' : '+'}</span> {dateChipLabel}
            </button>
            {datePopOpen && (
              <DatePopover value={dateFilter} onApply={setDateFilter} onClose={() => setDatePopOpen(false)} />
            )}
          </div>
          <button className="bk-chip"><span className="bk-chip__plus">+</span> Amount</button>
          <button className="bk-chip"><span className="bk-chip__plus">+</span> Currency</button>
          <button className="bk-chip"><span className="bk-chip__plus">+</span> Hotel</button>
          <button className="bk-chip"><span className="bk-chip__plus">+</span> Source</button>
          <button className="bk-chip"><span className="bk-chip__plus">+</span> More filters</button>
        </div>
        <div className="bk-toolbar__actions">
          <button className="bk-iconbtn"><I.download size={14} /> Export</button>
          <button className="bk-iconbtn"><I.settings size={14} /> Edit columns</button>
        </div>
      </div>

      <div className="bk-table-wrap">
        <table className="bk-table">
          <thead>
            <tr>
              <th className="bk-table__check"><input type="checkbox" aria-label="Select all" /></th>
              <th>Amount</th>
              <th>Hotel</th>
              <th>Tour</th>
              <th className="num">Pax</th>
              <th>Booked</th>
              <th>Source</th>
              <th className="num">Commission</th>
              <th className="bk-table__kebab"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(b => {
              const refunded = b.status === 'refunded' || b.status === 'pending_refund';
              const isOpen = expanded === b.id;
              return (
                <React.Fragment key={b.id}>
                  <tr className={isOpen ? 'is-open' : ''} onClick={() => setExpanded(isOpen ? null : b.id)}>
                    <td className="bk-table__check" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" />
                    </td>
                    <td className={'bk-row__amount' + (refunded ? ' bk-row__amount--muted' : '')}>
                      <span className="mono">{fmtMoney(b.amount)}</span>
                      <BkPill status={b.status} />
                    </td>
                    <td>{b.hotel}</td>
                    <td>{b.tour}</td>
                    <td className="num">{b.pax}</td>
                    <td>{b.date}</td>
                    <td><span className="mono" style={{fontFamily:'var(--font-sans)',fontSize:12.5,color:'var(--text-body)'}}>{b.refLabel}</span></td>
                    <td className={'bk-row__commission ' + (refunded ? 'bk-row__commission--muted' : 'bk-row__commission--pos')}>
                      {refunded ? 'Refunded' : '+' + fmtMoney(b.commission)}
                    </td>
                    <td className="bk-table__kebab" onClick={e => e.stopPropagation()}>
                      <button className="bk-iconbtn bk-iconbtn--icon" aria-label="Row actions"><I.kebab size={14} /></button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bk-funnel-row">
                      <td colSpan={9}>
                        <FunnelDetail booking={b} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
        <div className="bk-table__footer">
          <span>{filtered.length} of {BOOKINGS.length} bookings</span>
          <div className="bk-table__pag">
            <button className="bk-iconbtn bk-iconbtn--icon" aria-label="Previous"><I.chevleft size={14} /></button>
            <button className="bk-iconbtn bk-iconbtn--icon" aria-label="Next"><I.chevright2 size={14} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

window.BookingsPage = BookingsPage;
