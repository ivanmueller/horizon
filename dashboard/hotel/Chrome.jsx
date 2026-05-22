/* Topbar (Stripe-style) — search left, icon row + setup pill + primary CTA.
   The Setup guide pill sits in the toolbar so the hotel always has a
   visible nudge to finish their profile until everything is filled in. */
function Topbar({ onNew, setupDone, setupTotal }) {
  const total = setupTotal || 5;
  const done  = setupDone != null ? setupDone : 0;
  const pct = Math.max(0, Math.min(1, done / total));
  const C = 2 * Math.PI * 7;
  const complete = done >= total;

  return (
    <header className="topbar">
      <label className="topbar__search">
        <I.search size={14} />
        <input placeholder="Search bookings, links, guests…" />
        <span className="kbd">⌘K</span>
      </label>
      <div className="topbar__actions">
        <button className="topbar__iconbtn" title="Help">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </button>
        <button className="topbar__iconbtn" title="Notifications"><I.bell size={18} /></button>
        <button className="topbar__iconbtn" title="Account settings"><I.settings size={18} /></button>

        {!complete && (
          <button className="topbar__setup" title="Open setup guide">
            <span className="topbar__setup-ring" aria-hidden="true">
              <svg viewBox="0 0 18 18">
                <circle cx="9" cy="9" r="7" className="t" strokeWidth="2" fill="none" />
                <circle cx="9" cy="9" r="7" className="f" strokeWidth="2" fill="none"
                        strokeDasharray={C}
                        strokeDashoffset={C * (1 - pct)}
                        strokeLinecap="round" />
              </svg>
            </span>
            Complete profile · {done}/{total}
          </button>
        )}

        <button className="topbar__primary" onClick={onNew}>
          <I.qr size={14} /> New referral link
        </button>
      </div>
    </header>
  );
}

/* Range pills (7 / 30 / 90 / All) */
function RangePicker({ value, onChange }) {
  const opts = [
    { v: 7,   l: '7 days' },
    { v: 30,  l: '30 days' },
    { v: 90,  l: '90 days' },
    { v: 'all', l: 'All time' },
  ];
  return (
    <div className="range" role="group" aria-label="Date range">
      {opts.map(o => (
        <button key={o.v}
          className={'range__btn ' + (value === o.v ? 'range__btn--active' : '')}
          onClick={() => onChange(o.v)}>{o.l}</button>
      ))}
    </div>
  );
}

/* KPI tile */
function KPI({ label, value, delta, sub, icon: IconC }) {
  const deltaCls = delta > 0 ? 'kpi__delta--up' : delta < 0 ? 'kpi__delta--down' : '';
  return (
    <div className="kpi">
      <div className="kpi__head">
        <span className="kpi__label">{label}</span>
        {IconC && <span className="kpi__icon"><IconC size={14} /></span>}
      </div>
      <div className="kpi__value">
        {value}
        {delta != null && (
          <span className={'kpi__delta ' + deltaCls}>
            {delta > 0 ? '↑' : delta < 0 ? '↓' : '·'} {Math.abs(delta)}%
          </span>
        )}
      </div>
      <div className="kpi__sub">{sub}</div>
    </div>
  );
}

window.Topbar = Topbar;
window.RangePicker = RangePicker;
window.KPI = KPI;
