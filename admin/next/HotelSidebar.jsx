/* Sidebar cards on the hotel detail page. */

/* ── Notes (sticky-note panel) ────────────────────────────── */
function NotesPanel() {
  const notes = [
    { body:'Concierge cards delivered — Lina trained today. Front-desk team gets them Friday.', who:'Hannah Cole · 2h ago' },
    { body:'Bokun vendor switched from vendor_8421ban → vendor_8421NEW. Confirmed by Bokun support, ticket #44210.', who:'Ivan Mueller · May 14' },
  ];
  return (
    <div className="hd-card">
      <div className="hd-card__head">
        <div className="hd-card__title">Notes</div>
      </div>
      <div className="hd-card__body hd-notes">
        {notes.map((n, i) => (
          <div key={i} className="hd-note">
            {n.body}
            <div className="hd-note__meta">{n.who}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Setup guide ──────────────────────────────────────────── */
function SetupGuide() {
  const items = [
    { label: 'Verify hotel identity',    done: true  },
    { label: 'Connect Stripe payouts',   done: true  },
    { label: 'Set commission rate',      done: true  },
    { label: 'Ship lobby QR cards',      done: false },
    { label: 'Invite first manager',     done: false },
  ];
  const done = items.filter(i => i.done).length;
  const pct = Math.round((done / items.length) * 100);
  return (
    <div className="hd-card">
      <div className="hd-setup__head">
        <span className="hd-setup__title">Setup guide</span>
        <span className="hd-setup__count">{done} / {items.length}</span>
      </div>
      <div className="hd-setup__bar"><span className="hd-setup__fill" style={{width: pct + '%'}} /></div>
      <ul className="hd-setup__list">
        {items.map((it, i) => (
          <li key={i} className={'hd-setup__item ' + (it.done ? 'hd-setup__item--done' : '')}>
            <span className="hd-setup__check">{it.done && <I.check size={11} />}</span>
            <span>{it.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Details (key-value list) ─────────────────────────────── */
function DetailsCard({ hotel }) {
  const [more, setMore] = React.useState(false);
  return (
    <div className="hd-card">
      <div className="hd-card__head">
        <div className="hd-card__title">Details</div>
        <button className="hd-card__edit" aria-label="Edit details">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11.5 2.5l2 2-7 7H4.5v-2l7-7z" />
            <path d="M10.5 3.5l2 2" />
          </svg>
        </button>
      </div>
      <div className="hd-card__body">
        <dl className="hd-kvs">
          <div className="hd-kvs__row"><dt className="hd-kvs__k">Hotel ID</dt><dd className="hd-kvs__v"><span className="mono">{hotel.id || ('htl_' + hotel.slug.slice(0, 12))}</span></dd></div>
          <div className="hd-kvs__row"><dt className="hd-kvs__k">Address</dt><dd className="hd-kvs__v">{hotel.address || '405 Spray Ave, Banff AB'}</dd></div>
          <div className="hd-kvs__row"><dt className="hd-kvs__k">Phone</dt><dd className="hd-kvs__v">+1 (403) 762-2211</dd></div>
          <div className="hd-kvs__row"><dt className="hd-kvs__k">Primary contact</dt><dd className="hd-kvs__v">Hannah Cole · GM</dd></div>
          <div className="hd-kvs__row"><dt className="hd-kvs__k">Website</dt><dd className="hd-kvs__v">fairmont.com/banff-springs</dd></div>
          <div className="hd-kvs__row"><dt className="hd-kvs__k">Onboarded</dt><dd className="hd-kvs__v">{hotel.joined || 'Feb 1, 2026'}</dd></div>
          {more && (
            <>
              <div className="hd-kvs__row"><dt className="hd-kvs__k">URL slug</dt><dd className="hd-kvs__v"><span className="mono">{hotel.slug}</span></dd></div>
              <div className="hd-kvs__row"><dt className="hd-kvs__k">Property type</dt><dd className="hd-kvs__v">Resort hotel</dd></div>
              <div className="hd-kvs__row"><dt className="hd-kvs__k">Star rating</dt><dd className="hd-kvs__v">★★★★★</dd></div>
              <div className="hd-kvs__row"><dt className="hd-kvs__k">Rooms</dt><dd className="hd-kvs__v" style={{fontVariantNumeric:'tabular-nums'}}>{hotel.rooms}</dd></div>
              <div className="hd-kvs__row"><dt className="hd-kvs__k">Country</dt><dd className="hd-kvs__v">Canada</dd></div>
            </>
          )}
        </dl>
        <button className="hd-kvs__more" onClick={() => setMore(m => !m)}>
          {more ? 'Show less' : 'Show more'}
        </button>
      </div>
    </div>
  );
}

/* ── Banking accordion ────────────────────────────────────── */
function BankingCard() {
  const [open, setOpen] = React.useState(true);
  return (
    <div className={'hd-card hd-bank ' + (open ? 'hd-bank--open' : '')}>
      <button className="hd-bank__head" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span className="hd-bank__title">Banking information</span>
        <span className="hd-bank__tag hd-bank__tag--ok">Stripe</span>
        <svg className="hd-bank__chev" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6l4 4 4-4"/></svg>
      </button>
      {open && (
        <div className="hd-bank__body">
          <dl className="hd-kvs">
            <div className="hd-kvs__row"><dt className="hd-kvs__k">Method</dt><dd className="hd-kvs__v">Stripe Connect</dd></div>
            <div className="hd-kvs__row"><dt className="hd-kvs__k">Account</dt><dd className="hd-kvs__v"><span className="mono">acct_1Q5l●●●●●●●J</span></dd></div>
            <div className="hd-kvs__row"><dt className="hd-kvs__k">Bank</dt><dd className="hd-kvs__v">RBC · ●●●● 8821</dd></div>
            <div className="hd-kvs__row"><dt className="hd-kvs__k">Currency</dt><dd className="hd-kvs__v">CAD</dd></div>
            <div className="hd-kvs__row"><dt className="hd-kvs__k">Verified</dt><dd className="hd-kvs__v">Feb 14, 2026</dd></div>
          </dl>
        </div>
      )}
    </div>
  );
}

/* ── Commission structure ─────────────────────────────────── */
function CommissionCard({ hotel }) {
  const operator = 70;
  const hotelPct = hotel.commissionPct || 15;
  const platform = 100 - operator - hotelPct;
  return (
    <div className="hd-card">
      <div className="hd-card__head">
        <div className="hd-card__title">Commission structure</div>
        <button className="hd-card__edit" aria-label="Edit commission">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11.5 2.5l2 2-7 7H4.5v-2l7-7z" />
            <path d="M10.5 3.5l2 2" />
          </svg>
        </button>
      </div>
      <div className="hd-card__body">
        <div style={{font:'500 14px/1.3 var(--font-sans)', color:'var(--text-primary)', marginBottom:2}}>Tier 2 · 15% hotel</div>
        <div style={{font:'400 12px/1.4 var(--font-sans)', color:'var(--text-secondary)'}}>How each booking's revenue is split.</div>
        <div className="hd-comm__bar">
          <span className="hd-comm__seg hd-comm__seg--op"       style={{width: operator + '%'}} />
          <span className="hd-comm__seg hd-comm__seg--hotel"    style={{width: hotelPct + '%'}} />
          <span className="hd-comm__seg hd-comm__seg--platform" style={{width: platform + '%'}} />
        </div>
        <dl className="hd-comm__legend">
          <div className="hd-comm__row"><span className="hd-comm__sw hd-comm__sw--op" /><span>Tour operator</span><span className="hd-comm__pct">{operator}%</span></div>
          <div className="hd-comm__row"><span className="hd-comm__sw hd-comm__sw--hotel" /><span>Hotel</span><span className="hd-comm__pct">{hotelPct}%</span></div>
          <div className="hd-comm__row"><span className="hd-comm__sw hd-comm__sw--platform" /><span>Horizon platform</span><span className="hd-comm__pct">{platform}%</span></div>
        </dl>
      </div>
    </div>
  );
}

window.NotesPanel      = NotesPanel;
window.SetupGuide      = SetupGuide;
window.DetailsCard     = DetailsCard;
window.BankingCard     = BankingCard;
window.CommissionCard  = CommissionCard;
