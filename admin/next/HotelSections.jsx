/* The main-column sections on the hotel detail page. All static
   demo data — wire to real endpoints when the admin API is in scope. */

function Section({ title, addLabel, children }) {
  return (
    <section className="hd-section">
      <header className="hd-section__head">
        <h2 className="hd-section__title">{title}</h2>
        {addLabel && (
          <button className="hd-section__add" aria-label={addLabel} title={addLabel}>+</button>
        )}
      </header>
      <div className="hd-section__body">{children}</div>
    </section>
  );
}

function Row({ avatar, name, meta, right, onClick }) {
  return (
    <div className={'hd-row' + (onClick ? ' hd-row--clickable' : '')}
         onClick={onClick}
         role={onClick ? 'button' : undefined}
         tabIndex={onClick ? 0 : undefined}
         onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}>
      <div className="hd-row__main">
        {avatar && <span className="hd-row__avatar">{avatar}</span>}
        <div>
          <div className="hd-row__name">{name}</div>
          {meta && <div className="hd-row__meta">{meta}</div>}
        </div>
      </div>
      <div className="hd-row__right">{right}</div>
    </div>
  );
}

/* ── Placements ───────────────────────────────────────────── */
const PLACEMENTS = [
  { name:'Lobby kiosk',          status:'ok',   code:'HRZ-banff-lobby', scans:'2,412', meta:'Active · printed Apr 12 · HRZ-banff-lobby' },
  { name:'In-room QR card',      status:'ok',   code:'HRZ-banff-room',  scans:'1,098', meta:'Active · 412 rooms · HRZ-banff-room' },
  { name:'Concierge link cards', status:'ok',   code:'HRZ-banff-conc',  scans:'595',   meta:'Active · 6 staff cards' },
  { name:'Summer 2026 campaign', status:'warn', code:'HRZ-banff-s26',   scans:'642',   meta:'Expires May 24 · HRZ-banff-s26' },
];

function PlacementsSection({ hotel }) {
  const [open, setOpen] = React.useState(null);
  return (
    <Section title="Placements" addLabel="Add placement">
      {PLACEMENTS.map(p => (
        <Row key={p.code}
             avatar={<I.qr size={14} />}
             name={p.name}
             meta={p.meta}
             onClick={() => setOpen(p)}
             right={<>
               <span className={'pill pill--' + (p.status === 'warn' ? 'warn' : 'ok')}>{p.status === 'warn' ? 'Expiring' : 'Active'}</span>
               <span className="hd-row__amt">{p.scans} scans</span>
             </>} />
      ))}
      {open && <PlacementLightbox placement={open} hotel={hotel} onClose={() => setOpen(null)} />}
    </Section>
  );
}

/* Helper — render a person's name as first+last initials. Falls back
   to first two characters when there's only one word. */
function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0] || '?').slice(0, 2).toUpperCase();
}

/* ── Managers ─────────────────────────────────────────────── */
function ManagersSection() {
  const rows = [
    { name:'Hannah Cole', role:'Owner',     email:'hcole@banffsprings.example',  status:'active',  meta:'Last sign-in 2 h ago' },
    { name:'Daniel Chu',  role:'Manager',   email:'dchu@banffsprings.example',   status:'active',  meta:'Last sign-in May 14' },
    { name:'Anna Liang',  role:'Read-only', email:'aliang@banffsprings.example', status:'invited', meta:'Not yet claimed' },
  ];
  return (
    <Section title="Managers" addLabel="Add manager">
      {rows.map(r => (
        <Row key={r.email}
             avatar={initialsOf(r.name)}
             name={r.name}
             meta={r.role + ' · ' + r.email}
             right={<><StatusPill status={r.status} /><span className="hd-row__meta">{r.meta}</span></>} />
      ))}
    </Section>
  );
}

/* ── Employees ────────────────────────────────────────────── */
function EmployeesSection() {
  const rows = [
    { name:'Lina Park',    code:'HRZ-LP', role:'Concierge',  kickback:'5.0%', bookings:88, commission:'CA$ 1,840' },
    { name:'Marc Boucher', code:'HRZ-MB', role:'Concierge',  kickback:'5.0%', bookings:46, commission:'CA$ 962'   },
    { name:'Sasha Yen',    code:'HRZ-SY', role:'Front desk', kickback:'5.0%', bookings:21, commission:'CA$ 442'   },
    { name:'Tom Weaver',   code:'HRZ-TW', role:'Front desk', kickback:'5.0%', bookings:14, commission:'CA$ 295'   },
    { name:'Mei Kawasaki', code:'HRZ-MK', role:'Bell desk',  kickback:'4.0%', bookings: 8, commission:'CA$ 168'   },
  ];
  return (
    <Section title="Employees" addLabel="Add employee">
      <table className="tbl">
        <thead>
          <tr><th>Employee</th><th>Code</th><th>Role</th><th>Kickback</th><th className="num">Bookings 30d</th><th className="num">Commission</th></tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.code}>
              <td>
                <div className="hd-row__main" style={{padding:0}}>
                  <span className="hd-row__avatar">{initialsOf(r.name)}</span>
                  <div className="hd-row__name">{r.name}</div>
                </div>
              </td>
              <td><span className="mono">{r.code}</span></td>
              <td>{r.role}</td>
              <td>{r.kickback}</td>
              <td className="num">{r.bookings}</td>
              <td className="num">{r.commission}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

/* ── Bookings ─────────────────────────────────────────────── */
function BookingsSection() {
  const rows = [
    { id:1, when:'May 18', tour:'Lake Louise Canoe + Moraine',  guest:'Sarah Kim',     amt:'CA$ 996.00',  comm:'CA$ 124.50', src:'Lobby kiosk',           status:'credited' },
    { id:2, when:'May 18', tour:'Banff Highlights + Gondola',   guest:'Marcus Tran',   amt:'CA$ 498.00',  comm:'CA$  62.25', src:'Concierge · Lina',      status:'credited' },
    { id:3, when:'May 17', tour:'Hidden Gem Canoe Tour',        guest:'Jenny Liu',     amt:'CA$ 749.97',  comm:'CA$  93.75', src:'In-room QR',            status:'pending'  },
    { id:4, when:'May 17', tour:'Lake Louise Canoe + Moraine',  guest:'Amal Rashid',   amt:'CA$ 498.00',  comm:'CA$  62.25', src:'Lobby kiosk',           status:'credited' },
    { id:5, when:'May 16', tour:'Lake Agnes Tea House Hike',    guest:'Priya Singh',   amt:'CA$ 398.00',  comm:'CA$  49.75', src:'Concierge · Marc',      status:'credited' },
  ];
  return (
    <Section title="Bookings">
      <table className="tbl">
        <thead>
          <tr><th>Booked</th><th>Tour</th><th>Guest</th><th>Source</th><th className="num">Amount</th><th className="num">Commission</th><th>Status</th></tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td>{r.when}</td>
              <td>{r.tour}</td>
              <td>{r.guest}</td>
              <td>{r.src}</td>
              <td className="num">{r.amt}</td>
              <td className="num">{r.comm}</td>
              <td><StatusPill status={r.status === 'credited' ? 'active' : 'pending'} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

/* ── Invoices ─────────────────────────────────────────────── */
function InvoicesSection() {
  const rows = [
    { n:'INV-2026-0518', issued:'May 18', period:'May 1–15',  amt:'CA$ 1,820.50', status:'pending' },
    { n:'INV-2026-0503', issued:'May 3',  period:'Apr 16–30', amt:'CA$ 4,820.50', status:'paid'    },
    { n:'INV-2026-0419', issued:'Apr 19', period:'Apr 1–15',  amt:'CA$ 6,114.20', status:'paid'    },
    { n:'INV-2026-0405', issued:'Apr 5',  period:'Mar 16–31', amt:'CA$ 5,330.10', status:'paid'    },
  ];
  return (
    <Section title="Invoices" addLabel="Record invoice">
      <table className="tbl">
        <thead>
          <tr><th>Invoice</th><th>Issued</th><th>Period</th><th className="num">Amount</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.n}>
              <td><span className="mono">{r.n}</span></td>
              <td>{r.issued}</td>
              <td>{r.period}</td>
              <td className="num">{r.amt}</td>
              <td><StatusPill status={r.status === 'paid' ? 'active' : 'pending'} /></td>
              <td className="num"><button className="btn btn--sm"><I.download size={12} /> PDF</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

/* ── Payments ─────────────────────────────────────────────── */
function PaymentsSection() {
  const rows = [
    { id:'pay_8a21', when:'May 3',  method:'Stripe · acct ●●●● 8821', invoice:'INV-2026-0419', amt:'CA$ 6,114.20', status:'received' },
    { id:'pay_77c9', when:'Apr 19', method:'Stripe · acct ●●●● 8821', invoice:'INV-2026-0405', amt:'CA$ 5,330.10', status:'received' },
    { id:'pay_5b40', when:'Apr 5',  method:'Stripe · acct ●●●● 8821', invoice:'INV-2026-0322', amt:'CA$ 4,212.80', status:'received' },
  ];
  return (
    <Section title="Payments" addLabel="Record payment">
      <table className="tbl">
        <thead>
          <tr><th>Payment</th><th>Received</th><th>Method</th><th>Invoice</th><th className="num">Amount</th><th>Status</th></tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td><span className="mono">{r.id}</span></td>
              <td>{r.when}</td>
              <td>{r.method}</td>
              <td><span className="mono">{r.invoice}</span></td>
              <td className="num">{r.amt}</td>
              <td><span className="pill pill--ok">Received</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

/* ── Activity (notes + system events combined) ───────────── */
function ActivitySection() {
  const items = [
    { icon:I.user,     cls:'hd-tl__icon--note',  title:'<strong>Hannah Cole</strong> added a note',                       sub:'"Concierge cards delivered — Lina trained today. Front-desk team gets them Friday."', when:'2 h ago' },
    { icon:I.calendar, cls:'hd-tl__icon--brand', title:'New booking · <strong>Lake Louise Canoe + Moraine</strong>',     sub:'Sarah Kim · 4 travellers · lobby kiosk',                                              when:'2 h ago' },
    { icon:I.dollar,   cls:'hd-tl__icon--ok',    title:'Payout sent · <strong>CA$ 6,114.20</strong>',                    sub:'Stripe transfer · invoice INV-2026-0419',                                             when:'May 3' },
    { icon:I.user,     cls:'hd-tl__icon--info',  title:'Manager invited · <strong>Anna Liang</strong>',                  sub:'Read-only role · aliang@banffsprings.example',                                         when:'May 2' },
    { icon:I.qr,       cls:'hd-tl__icon--brand', title:'Placement created · <strong>Summer 2026 campaign</strong>',      sub:'Expires May 24 · HRZ-banff-s26',                                                       when:'Apr 28' },
    { icon:I.bell,     cls:'hd-tl__icon--warn',  title:'Bokun connector failed (auto-retried)',                          sub:'502 from vendor_8421ban · resolved within 3 min',                                       when:'Apr 26' },
  ];
  return (
    <Section title="Recent activity" addLabel="Add note">
      <div className="hd-timeline">
        {items.map((a, i) => (
          <div key={i} className="hd-tl__row">
            <span className={'hd-tl__icon ' + (a.cls || '')}><a.icon size={14} /></span>
            <div>
              <div className="hd-tl__title" dangerouslySetInnerHTML={{__html: a.title}} />
              {a.sub && <div className="hd-tl__sub">{a.sub}</div>}
            </div>
            <div className="hd-tl__when">{a.when}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ── Sent emails ──────────────────────────────────────────── */
function SentEmailsSection() {
  const rows = [
    { subj:'Your Horizon Connect payout · INV-2026-0419',     to:'hcole@banffsprings.example', sent:'May 3',  status:'delivered' },
    { subj:'New booking notification · HRZ-3DK29F',           to:'hcole@banffsprings.example', sent:'May 2',  status:'delivered' },
    { subj:'Welcome to Horizon Connect',                       to:'aliang@banffsprings.example',sent:'May 2',  status:'opened'    },
    { subj:'Setup guide reminder — 2 steps left',              to:'hcole@banffsprings.example', sent:'Apr 28', status:'delivered' },
  ];
  return (
    <Section title="Sent emails">
      <table className="tbl">
        <thead><tr><th>Subject</th><th>To</th><th>Sent</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.subj}</td>
              <td><span className="mono">{r.to}</span></td>
              <td>{r.sent}</td>
              <td><span className={'pill ' + (r.status==='opened' ? 'pill--info' : 'pill--ok')}>{r.status === 'opened' ? 'Opened' : 'Delivered'}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

/* ── Events (audit log) ──────────────────────────────────── */
function EventsSection() {
  const rows = [
    { ev:'hotel.payout.sent',       who:'system',           when:'May 3, 14:02', payload:'invoice=INV-2026-0419' },
    { ev:'hotel.manager.invited',   who:'icole@horizon',    when:'May 2, 11:18', payload:'manager=anna@…' },
    { ev:'hotel.placement.created', who:'icole@horizon',    when:'Apr 28, 09:44', payload:'code=HRZ-banff-s26' },
    { ev:'booking.sync.retry',      who:'bokun-worker',     when:'Apr 26, 16:12', payload:'attempt=2' },
    { ev:'hotel.commission.updated',who:'icole@horizon',    when:'Apr 18, 10:30', payload:'12.0% → 12.5%' },
    { ev:'hotel.signed_up',         who:'hcole@banff…',     when:'Feb 1, 13:05',  payload:'utm_source=referral' },
  ];
  return (
    <Section title="Events">
      <table className="tbl">
        <thead><tr><th>Event</th><th>Actor</th><th>When</th><th>Payload</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td><span className="mono">{r.ev}</span></td>
              <td><span className="mono">{r.who}</span></td>
              <td>{r.when}</td>
              <td><span className="mono">{r.payload}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

window.PlacementsSection = PlacementsSection;
window.ManagersSection   = ManagersSection;
window.EmployeesSection  = EmployeesSection;
window.BookingsSection   = BookingsSection;
window.InvoicesSection   = InvoicesSection;
window.PaymentsSection   = PaymentsSection;
window.ActivitySection   = ActivitySection;
window.SentEmailsSection = SentEmailsSection;
window.EventsSection     = EventsSection;
