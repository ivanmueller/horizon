/* Hotels list page — filter chips + full hotels table */

const STATUS_PILLS = {
  active:    { cls: 'pill pill--ok',     label: 'Active' },
  pending:   { cls: 'pill pill--warn',   label: 'Pending' },
  paused:    { cls: 'pill pill--neutral',label: 'Paused' },
  suspended: { cls: 'pill pill--bad',    label: 'Suspended' },
  invited:   { cls: 'pill pill--info',   label: 'Invited' },
};

function StatusPill({ status }) {
  const s = STATUS_PILLS[status] || STATUS_PILLS.pending;
  return <span className={s.cls}>{s.label}</span>;
}

function HotelsPage({ hotels, onOpenHotel, openSlug }) {
  const [filter,   setFilter]   = React.useState('all');
  const [location, setLocation] = React.useState('all');
  const filtered = hotels.filter(h =>
    (filter === 'all' || h.status === filter) &&
    (location === 'all' || h.location === location)
  );

  const banff = hotels.filter(h => h.location === 'Banff').length;
  const canm  = hotels.filter(h => h.location === 'Canmore').length;

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <div className="page__title">Partner hotels</div>
          <div className="page__sub">{hotels.length} hotels · {banff} in Banff · {canm} in Canmore</div>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button className="btn"><I.download size={14} /> Export CSV</button>
          <button className="btn btn--primary"><I.plus size={14} /> Add partner hotel</button>
        </div>
      </div>

      <div className="filters">
        <button className={'chip ' + (filter==='all' ? 'chip--active' : '')} onClick={() => setFilter('all')}>
          <span className="chip__k">Status</span><span className="chip__v">All</span>
        </button>
        <button className={'chip ' + (filter==='active' ? 'chip--active' : '')} onClick={() => setFilter('active')}>
          <span className="chip__v">Active</span>
        </button>
        <button className={'chip ' + (filter==='pending' ? 'chip--active' : '')} onClick={() => setFilter('pending')}>
          <span className="chip__v">Pending</span>
        </button>
        <button className={'chip ' + (filter==='paused' ? 'chip--active' : '')} onClick={() => setFilter('paused')}>
          <span className="chip__v">Paused</span>
        </button>
        <span style={{width:1,height:24,background:'var(--border-default)',margin:'0 4px'}} />
        <button className={'chip ' + (location==='all' ? 'chip--active' : '')} onClick={() => setLocation('all')}>
          <span className="chip__k">Location</span><span className="chip__v">All</span>
        </button>
        <button className={'chip ' + (location==='Banff' ? 'chip--active' : '')} onClick={() => setLocation('Banff')}>
          <span className="chip__v">Banff</span>
        </button>
        <button className={'chip ' + (location==='Canmore' ? 'chip--active' : '')} onClick={() => setLocation('Canmore')}>
          <span className="chip__v">Canmore</span>
        </button>
        <button className="chip" style={{marginLeft:'auto'}}>
          <I.filter size={12} /><span>More filters</span>
        </button>
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th>Hotel</th>
              <th>Status</th>
              <th>Location</th>
              <th className="num">Rooms</th>
              <th className="num">Bookings 30d</th>
              <th className="num">Commission 30d</th>
              <th>Commission %</th>
              <th>Last activity</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(h => (
              <tr key={h.slug} onClick={() => onOpenHotel(h)} className={openSlug === h.slug ? 'is-active' : ''}>
                <td>
                  <div className="hotel">
                    <HotelInitials name={h.name} />
                    <div className="hotel__meta">
                      <span className="hotel__name">{h.name}</span>
                      <span className="hotel__slug">{h.slug}</span>
                    </div>
                  </div>
                </td>
                <td><StatusPill status={h.status} /></td>
                <td>{h.location}</td>
                <td className="num">{h.rooms}</td>
                <td className="num">{h.bookings30d}</td>
                <td className="num">CA$ {h.commission30d.toLocaleString()}</td>
                <td>{h.commissionPct}%</td>
                <td>{h.lastActivity}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr style={{cursor:'default'}}><td colSpan="8" style={{textAlign:'center',padding:'48px 0',color:'var(--text-secondary)'}}>
                No hotels match these filters.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

window.HotelsPage = HotelsPage;
window.StatusPill = StatusPill;
