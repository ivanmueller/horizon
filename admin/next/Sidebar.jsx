/* Sidebar with brand-switcher dropdown, search, two-section nav. */

function Sidebar({ active, onNavigate, pending }) {
  const [menuOpen, setMenuOpen] = React.useState(false);

  const main = [
    { key: 'home',            label: 'Home',            icon: I.home },
    { key: 'bookings',        label: 'Bookings',        icon: I.calendar, count: '347' },
    { key: 'hotels',          label: 'Hotels',          icon: I.hotel,    count: '19' },
    { key: 'links',           label: 'Short links',     icon: I.link },
    { key: 'access-requests', label: 'Access requests', icon: I.inbox,    badge: pending },
    { key: 'tours',           label: 'Tour catalog',    icon: I.compass },
  ];
  const finance = [
    { key: 'payments', label: 'Payments', icon: I.card },
    { key: 'billing',  label: 'Billing',  icon: I.receipt },
    { key: 'invoices', label: 'Invoices', icon: I.file },
  ];

  function NavItem({ it }) {
    const isActive = active === it.key;
    return (
      <button className={'nav__item ' + (isActive ? 'nav__item--active' : '')}
              onClick={() => onNavigate(it.key)}>
        <it.icon size={16} />
        <span>{it.label}</span>
        {it.badge != null && it.badge > 0 && <span className="nav__badge">{it.badge}</span>}
        {it.count != null && <span className="nav__count">{it.count}</span>}
      </button>
    );
  }

  return (
    <aside className="sidebar" style={{position:'sticky'}}>
      <div style={{position:'relative'}}>
        <button className="wsbtn" aria-expanded={menuOpen} onClick={() => setMenuOpen(o => !o)}>
          <span className="wsbtn__icon">H</span>
          <span className="wsbtn__meta">
            <span className="wsbtn__name">Horizon Tours</span>
            <span className="wsbtn__role">Admin · main workspace</span>
          </span>
          <span className="wsbtn__chev"><I.chevdown size={14} /></span>
        </button>
        {menuOpen && (
          <div className="wsmenu" role="menu">
            <div className="wsmenu__head">
              <span className="wsmenu__avatar">H</span>
              <div>
                <div className="wsmenu__title">Horizon Tours</div>
                <div className="wsmenu__sub">admin.gowithhorizon.com</div>
              </div>
            </div>
            <button className="wsmenu__item"><I.settings size={14} /> Workspace settings</button>
            <button className="wsmenu__item"><I.plus size={14} /> Create workspace</button>
            <hr />
            <button className="wsmenu__item"><I.user size={14} /> Ivan Mueller<span style={{marginLeft:'auto',fontSize:11,color:'var(--text-tertiary)'}}>ivan@</span></button>
            <button className="wsmenu__item"><I.signout size={14} /> Sign out</button>
          </div>
        )}
      </div>

      <nav className="nav" aria-label="Admin navigation">
        <div>
          <div className="nav__list">{main.map(it => <NavItem key={it.key} it={it} />)}</div>
        </div>
        <div>
          <div className="nav__head">Finance</div>
          <div className="nav__list">{finance.map(it => <NavItem key={it.key} it={it} />)}</div>
        </div>
      </nav>

      <div className="sb-foot">
        <button className="nav__item"><I.bell size={16} /><span>What's new</span></button>
        <button className="nav__item"><I.ext size={16} /><span>Docs</span></button>
      </div>
    </aside>
  );
}

window.Sidebar = Sidebar;
