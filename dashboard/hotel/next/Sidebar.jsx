/* Sidebar with nav, brand, signed-in user. */
function Sidebar({ active, onNavigate, hotel, user }) {
  const items = [
    { key: 'overview',  label: 'Overview',          icon: I.home,     count: null },
    { key: 'bookings',  label: 'Bookings',          icon: I.calendar, count: 347 },
    { key: 'payouts',   label: 'Payouts',           icon: I.dollar,   count: null },
    { key: 'links',     label: 'Referral links',    icon: I.qr,       count: 14 },
    { key: 'staff',     label: 'Staff & permissions', icon: I.users,  count: null },
    { key: 'settings',  label: 'Settings',          icon: I.settings, count: null },
  ];

  return (
    <aside className="sidebar">
      <a href="#" className="sb__brand">
        <span className="sb__brand-mark">
          <svg width="18" height="18" viewBox="0 0 36 36"><path d="M13 7v22M13 18c0-6 12-6 12 0v11" stroke="#FAFAFC" strokeWidth="4" strokeLinecap="round" fill="none"/></svg>
        </span>
        <span className="sb__brand-name">horizon</span>
        <span className="sb__brand-sub">connect</span>
      </a>

      <div className="sb__section">
        <div className="sb__head">{hotel}</div>
        {items.map(it => (
          <button
            key={it.key}
            className={'sb__item ' + (active === it.key ? 'sb__item--active' : '')}
            onClick={() => onNavigate(it.key)}
          >
            <it.icon size={16} />
            <span>{it.label}</span>
            {it.count != null && <span className="sb__count">{it.count}</span>}
          </button>
        ))}
      </div>

      <div className="sb__section">
        <div className="sb__head">Support</div>
        <a href="#" className="sb__item"><I.bell size={16} /><span>What's new</span></a>
        <a href="#" className="sb__item"><I.arrow size={16} /><span>Docs</span></a>
      </div>

      <div className="sb__user">
        <span className="sb__avatar">{(user.name || 'H').trim()[0]}</span>
        <div className="sb__user-meta">
          <div className="sb__user-name">{user.name}</div>
          <div className="sb__user-email">{user.email}</div>
        </div>
      </div>
    </aside>
  );
}

window.Sidebar = Sidebar;
