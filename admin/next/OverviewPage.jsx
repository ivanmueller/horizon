/* Home / Overview page — cross-portfolio KPIs + leaderboard + activity feed */

function HotelInitials({ name }) {
  const parts = name.split(/\s+/).filter(Boolean);
  let init;
  if (parts.length >= 2) {
    init = (parts[0][0] + parts[1][0]).toUpperCase();
  } else {
    init = name.slice(0, 2).toUpperCase();
  }
  return <span className="hotel__avatar">{init}</span>;
}

function ActivityRow({ kind, title, sub, amt, when }) {
  const ICONS = {
    booking:  { icon: <I.calendar size={14} />, cls: 'feed__icon--brand' },
    payout:   { icon: <I.dollar   size={14} />, cls: 'feed__icon--ok' },
    failed:   { icon: <I.bell     size={14} />, cls: 'feed__icon--warn' },
    join:     { icon: <I.hotel    size={14} />, cls: 'feed__icon--info' },
  };
  const k = ICONS[kind] || ICONS.booking;
  return (
    <div className="feed__row">
      <span className={'feed__icon ' + k.cls}>{k.icon}</span>
      <div>
        <div className="feed__title" dangerouslySetInnerHTML={{__html: title}} />
        {sub && <div className="feed__sub">{sub}</div>}
      </div>
      <div style={{textAlign:'right'}}>
        {amt && <div className="feed__amt">{amt}</div>}
        <div className="feed__when">{when}</div>
      </div>
    </div>
  );
}

function OverviewPage({ onOpenHotel, topHotels, activity }) {
  return (
    <div className="page">
      <div className="page__head">
        <div>
          <div className="page__title">Today across all partners</div>
          <div className="page__sub">19 active hotels · 2,890 rooms in the partner network · last sync 2 min ago</div>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button className="btn"><I.download size={14} /> Export</button>
          <button className="btn btn--primary"><I.plus size={14} /> Add partner hotel</button>
        </div>
      </div>

      <section className="kpi-grid">
        <KPI label="Bookings (30d)"      value="2,184" delta={14} sub="Across all partner hotels"  icon={I.calendar} />
        <KPI label="Gross volume (30d)"  value="CA$ 487,210" delta={11} sub="Pre-commission"   icon={I.receipt} />
        <KPI label="Commission routed"   value="CA$ 73,082"  delta={11} sub="15% blended rate" icon={I.dollar} />
        <KPI label="Pending payouts"     value="CA$ 18,440"  sub="Next batch · Friday May 24"   icon={I.card} />
      </section>

      <div className="split">
        <div className="card">
          <div className="card__head">
            <div>
              <div className="card__title">Top hotels by commission</div>
              <div className="card__sub">Last 30 days · sorted by gross volume</div>
            </div>
            <button className="btn btn--sm" onClick={() => onOpenHotel(null)}>View all hotels →</button>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Hotel</th>
                <th>Location</th>
                <th className="num">Bookings</th>
                <th className="num">Commission</th>
              </tr>
            </thead>
            <tbody>
              {topHotels.map(h => (
                <tr key={h.slug} onClick={() => onOpenHotel(h)}>
                  <td>
                    <div className="hotel">
                      <HotelInitials name={h.name} />
                      <div className="hotel__meta">
                        <span className="hotel__name">{h.name}</span>
                        <span className="hotel__slug">{h.slug}</span>
                      </div>
                    </div>
                  </td>
                  <td>{h.location}</td>
                  <td className="num">{h.bookings30d}</td>
                  <td className="num">CA$ {h.commission30d.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card__head">
            <div>
              <div className="card__title">Recent activity</div>
              <div className="card__sub">Live · last 24 hours</div>
            </div>
            <button className="btn btn--sm">All activity</button>
          </div>
          <div className="feed">
            {activity.map((a, i) => <ActivityRow key={i} {...a} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

window.OverviewPage = OverviewPage;
window.HotelInitials = HotelInitials;
