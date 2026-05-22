/* Stripe-style hero topbar — search left, icon row right.
   No breadcrumb, no page title (those live on each page). */

function Topbar({ onAdd }) {
  return (
    <header className="topbar">
      <label className="topbar__search">
        <I.search size={14} />
        <input placeholder="Search hotels, bookings, codes…" />
        <span className="kbd">⌘K</span>
      </label>

      <div className="topbar__actions">
        <button className="topbar__iconbtn" title="Quick add">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><line x1="17.5" y1="14" x2="17.5" y2="21"/><line x1="14" y1="17.5" x2="21" y2="17.5"/></svg>
        </button>
        <button className="topbar__iconbtn" title="Help">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </button>
        <button className="topbar__iconbtn" title="Notifications"><I.bell size={18} /></button>
        <button className="topbar__iconbtn" title="Settings"><I.settings size={18} /></button>

        <button className="topbar__primary" title="Add" onClick={onAdd}>
          <I.plus size={16} />
        </button>
      </div>
    </header>
  );
}

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
window.KPI = KPI;
