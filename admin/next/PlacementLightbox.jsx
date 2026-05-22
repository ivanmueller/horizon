/* Placement detail lightbox — opens from a Placements row on the hotel
   detail page. Ported from the Claude Design prototype "Placement
   Lightbox". Header reflects the clicked placement; the body is the
   designed demo (scans/charts/materials/activity) until wired to the
   admin API. */

/* Inline SVG helper — design used a bare .ico class on raw <svg>. */
function Ico({ d, lg, sw = 1.75 }) {
  return (
    <svg className={lg ? 'ico ico--lg' : 'ico'} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
         dangerouslySetInnerHTML={{ __html: d }} />
  );
}

/* Decorative fake-QR glyph (aria-hidden) reused by the materials cards. */
function QrGlyph() {
  return (
    <svg className="mat__qr" viewBox="0 0 96 96" aria-hidden="true">
      <rect width="96" height="96" fill="#fff" />
      <rect x="6"  y="6"  width="22" height="22" fill="#0E0E14" /><rect x="10" y="10" width="14" height="14" fill="#fff" /><rect x="13" y="13" width="8" height="8" fill="#0E0E14" />
      <rect x="68" y="6"  width="22" height="22" fill="#0E0E14" /><rect x="72" y="10" width="14" height="14" fill="#fff" /><rect x="75" y="13" width="8" height="8" fill="#0E0E14" />
      <rect x="6"  y="68" width="22" height="22" fill="#0E0E14" /><rect x="10" y="72" width="14" height="14" fill="#fff" /><rect x="13" y="75" width="8" height="8" fill="#0E0E14" />
      <g fill="#0E0E14">
        <rect x="32" y="6"  width="4" height="4" /><rect x="40" y="6"  width="4" height="4" /><rect x="48" y="6"  width="4" height="4" /><rect x="56" y="6"  width="4" height="4" />
        <rect x="32" y="14" width="4" height="4" /><rect x="44" y="14" width="4" height="4" /><rect x="52" y="14" width="4" height="4" />
        <rect x="36" y="22" width="4" height="4" /><rect x="40" y="22" width="4" height="4" /><rect x="48" y="22" width="4" height="4" /><rect x="56" y="22" width="4" height="4" />
        <rect x="6"  y="32" width="4" height="4" /><rect x="14" y="32" width="4" height="4" /><rect x="22" y="32" width="4" height="4" /><rect x="30" y="32" width="4" height="4" /><rect x="38" y="32" width="4" height="4" /><rect x="50" y="32" width="4" height="4" /><rect x="58" y="32" width="4" height="4" /><rect x="68" y="32" width="4" height="4" /><rect x="78" y="32" width="4" height="4" /><rect x="86" y="32" width="4" height="4" />
        <rect x="10" y="40" width="4" height="4" /><rect x="20" y="40" width="4" height="4" /><rect x="34" y="40" width="4" height="4" /><rect x="42" y="40" width="4" height="4" /><rect x="50" y="40" width="4" height="4" /><rect x="64" y="40" width="4" height="4" /><rect x="74" y="40" width="4" height="4" /><rect x="82" y="40" width="4" height="4" />
        <rect x="6"  y="48" width="4" height="4" /><rect x="18" y="48" width="4" height="4" /><rect x="26" y="48" width="4" height="4" /><rect x="38" y="48" width="4" height="4" /><rect x="46" y="48" width="4" height="4" /><rect x="56" y="48" width="4" height="4" /><rect x="66" y="48" width="4" height="4" /><rect x="78" y="48" width="4" height="4" />
        <rect x="14" y="56" width="4" height="4" /><rect x="22" y="56" width="4" height="4" /><rect x="34" y="56" width="4" height="4" /><rect x="42" y="56" width="4" height="4" /><rect x="50" y="56" width="4" height="4" /><rect x="62" y="56" width="4" height="4" /><rect x="70" y="56" width="4" height="4" /><rect x="86" y="56" width="4" height="4" />
        <rect x="32" y="68" width="4" height="4" /><rect x="40" y="68" width="4" height="4" /><rect x="48" y="68" width="4" height="4" /><rect x="60" y="68" width="4" height="4" /><rect x="72" y="68" width="4" height="4" /><rect x="80" y="68" width="4" height="4" />
        <rect x="36" y="76" width="4" height="4" /><rect x="44" y="76" width="4" height="4" /><rect x="56" y="76" width="4" height="4" /><rect x="64" y="76" width="4" height="4" /><rect x="76" y="76" width="4" height="4" />
        <rect x="32" y="84" width="4" height="4" /><rect x="40" y="84" width="4" height="4" /><rect x="50" y="84" width="4" height="4" /><rect x="58" y="84" width="4" height="4" /><rect x="70" y="84" width="4" height="4" /><rect x="82" y="84" width="4" height="4" />
      </g>
    </svg>
  );
}

function Spark({ points }) {
  return (
    <svg className="kpi__spark" viewBox="0 0 200 32" preserveAspectRatio="none" aria-hidden="true">
      <polyline fill="none" stroke="var(--color-blue-500)" strokeWidth="1.5" points={points} />
    </svg>
  );
}

function Bar({ icon, name, count, pct, alt }) {
  return (
    <div className="bar-row">
      <div className="bar">
        <span className="bar__ico">{icon}</span>
        <span className="bar__name">{name}</span>
        <span className="bar__count">{count}</span>
        <span className="bar__pct">{pct}%</span>
      </div>
      <div className="bar"><span></span><div className="bar__track"><i style={{ width: pct + '%' }} /></div><span></span><span></span></div>
    </div>
  );
}

function PlacementLightbox({ placement, hotel, onClose }) {
  const [range, setRange] = React.useState('30d');
  const [tab, setTab]     = React.useState('overview');
  const bodyRef = React.useRef(null);
  const secRefs = {
    overview:  React.useRef(null),
    materials: React.useRef(null),
    cfg:       React.useRef(null),
    act:       React.useRef(null),
  };

  React.useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!placement) return null;
  const p = placement;
  const hotelName = (hotel && hotel.name) || 'Banff Springs Hotel';
  const code      = p.code || 'HRZ-banff-lobby';
  const statusOk  = p.status !== 'warn';
  const statusCls = statusOk ? 'pill--ok' : 'pill--warn';
  const statusLbl = statusOk ? 'Active' : 'Expiring';
  const scans     = p.scans || '2,412';

  function go(key) {
    setTab(key);
    const el = secRefs[key].current;
    const body = bodyRef.current;
    if (el && body) {
      const top = el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 12;
      body.scrollTo({ top, behavior: 'smooth' });
    }
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="pl-title"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <article className="pl">

        {/* Header */}
        <header className="pl-head">
          <div className="pl-head__left">
            <span className="pl-glyph" aria-hidden="true">
              <Ico lg d='<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="3" height="3"/><rect x="18" y="14" width="3" height="3"/><rect x="14" y="18" width="3" height="3"/><rect x="18" y="18" width="3" height="3"/>' />
            </span>
            <div>
              <div className="pl-eyebrow">Placement · <b>{hotelName}</b></div>
              <div className="pl-titlerow">
                <h2 className="pl-title" id="pl-title">{p.name}</h2>
                <span className={'pill ' + statusCls}>{statusLbl}</span>
              </div>
              <div className="pl-meta">
                <span className="pl-meta__url">
                  {code}
                  <button type="button" title="Copy code" aria-label="Copy code"
                          onClick={() => navigator.clipboard && navigator.clipboard.writeText(code)}>
                    <Ico d='<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' />
                  </button>
                </span>
                <span>Printed Apr 12, 2026</span>
                <span className="pl-meta__sep"></span>
                <span>Created by Isla Cole</span>
                <span className="pl-meta__sep"></span>
                <span>No expiry</span>
              </div>
            </div>
          </div>
          <div className="pl-head__actions">
            <button className="btn btn--ghost btn--icon" title="Open destination" aria-label="Open destination">
              <Ico d='<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>' />
            </button>
            <button className="btn btn--ghost btn--icon" title="More actions" aria-label="More actions">
              <Ico d='<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>' />
            </button>
            <button className="btn btn--ghost btn--icon" title="Close" aria-label="Close" onClick={onClose}>
              <Ico d='<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>' />
            </button>
          </div>
        </header>

        {/* Tabs */}
        <nav className="pl-tabs" aria-label="Placement sections">
          <button className="pl-tab" aria-current={tab === 'overview'} onClick={() => go('overview')}>Overview</button>
          <button className="pl-tab" aria-current={tab === 'materials'} onClick={() => go('materials')}>Materials <span className="pl-tab__count">2</span></button>
          <button className="pl-tab" aria-current={tab === 'cfg'} onClick={() => go('cfg')}>Configuration</button>
          <button className="pl-tab" aria-current={tab === 'act'} onClick={() => go('act')}>Activity <span className="pl-tab__count">14</span></button>
        </nav>

        {/* Body */}
        <div className="pl-body" ref={bodyRef}>

          {/* 1. Performance */}
          <section className="sec" ref={secRefs.overview} aria-labelledby="sec-perf">
            <div className="sec__head">
              <h3 className="sec__title" id="sec-perf">Performance</h3>
              <div className="seg" role="group" aria-label="Time range">
                {['7d', '30d', '90d', 'All'].map(r => (
                  <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>{r}</button>
                ))}
              </div>
            </div>

            <div className="kpis">
              <div className="pl-kpi">
                <div className="kpi__label">Scans</div>
                <div className="kpi__valuerow"><span className="kpi__value">{scans}</span><span className="kpi__delta kpi__delta--up">▲ 12.4%</span></div>
                <div className="kpi__sub">vs. prior 30 days · 80/day avg</div>
                <Spark points="0,22 12,20 24,21 36,18 48,15 60,17 72,14 84,12 96,14 108,11 120,9 132,12 144,8 156,10 168,6 180,7 192,4 200,5" />
              </div>
              <div className="pl-kpi">
                <div className="kpi__label">Unique sessions</div>
                <div className="kpi__valuerow"><span className="kpi__value">1,894</span><span className="kpi__delta kpi__delta--up">▲ 9.1%</span></div>
                <div className="kpi__sub">78.5% of scans · device-fingerprinted</div>
                <Spark points="0,24 12,22 24,23 36,20 48,18 60,19 72,16 84,15 96,17 108,13 120,11 132,14 144,10 156,12 168,8 180,9 192,6 200,7" />
              </div>
              <div className="pl-kpi">
                <div className="kpi__label">Bookings</div>
                <div className="kpi__valuerow"><span className="kpi__value">198</span><span className="kpi__delta kpi__delta--up">▲ 18.3%</span></div>
                <div className="kpi__sub">8.2% conversion · scan → confirmed</div>
                <Spark points="0,26 12,24 24,22 36,23 48,20 60,18 72,19 84,15 96,17 108,12 120,14 132,10 144,11 156,8 168,9 180,5 192,6 200,4" />
              </div>
              <div className="pl-kpi">
                <div className="kpi__label">Commission</div>
                <div className="kpi__valuerow"><span className="kpi__value">CA$ 18,940</span></div>
                <div className="kpi__sub"><span className="kpi__delta kpi__delta--up" style={{ padding: 0, background: 'transparent' }}>▲ 21.0%</span>&nbsp;·&nbsp; CA$ 95.66 / booking</div>
                <Spark points="0,28 12,25 24,26 36,22 48,23 60,19 72,20 84,16 96,14 108,15 120,11 132,9 144,12 156,7 168,8 180,4 192,5 200,3" />
              </div>
            </div>

            <div className="pl-card">
              <header className="pl-card__head">
                <h4 className="pl-card__title">Daily scans &amp; bookings</h4>
                <div className="pl-card__legend">
                  <span><i className="lg-scans"></i>Scans</span>
                  <span><i className="lg-bookings"></i>Bookings</span>
                </div>
              </header>
              <div className="pl-card__chart">
                <svg viewBox="0 0 880 240" width="100%" height="240" preserveAspectRatio="none" role="img" aria-label="Daily scans and bookings over the last 30 days">
                  <g stroke="var(--border-subtle)" strokeWidth="1">
                    <line x1="40" y1="40"  x2="860" y2="40" /><line x1="40" y1="90"  x2="860" y2="90" />
                    <line x1="40" y1="140" x2="860" y2="140" /><line x1="40" y1="190" x2="860" y2="190" />
                  </g>
                  <g fontFamily="Inter, system-ui, sans-serif" fontSize="10" fill="var(--text-tertiary)" textAnchor="end">
                    <text x="34" y="44">160</text><text x="34" y="94">120</text><text x="34" y="144">80</text><text x="34" y="194">40</text><text x="34" y="224">0</text>
                  </g>
                  <g fontFamily="Inter, system-ui, sans-serif" fontSize="10" fill="var(--text-tertiary)" textAnchor="middle">
                    <text x="60"  y="232">Apr 22</text><text x="200" y="232">Apr 27</text><text x="340" y="232">May 02</text>
                    <text x="480" y="232">May 07</text><text x="620" y="232">May 12</text><text x="760" y="232">May 17</text>
                  </g>
                  <path d="M40,180 L68,172 L96,168 L124,160 L152,165 L180,150 L208,142 L236,148 L264,135 L292,128 L320,140 L348,118 L376,122 L404,108 L432,114 L460,98 L488,105 L516,90 L544,95 L572,82 L600,88 L628,72 L656,80 L684,65 L712,70 L740,55 L768,62 L796,48 L824,52 L860,42 L860,210 L40,210 Z" fill="var(--color-blue-500)" fillOpacity="0.08" />
                  <path d="M40,180 L68,172 L96,168 L124,160 L152,165 L180,150 L208,142 L236,148 L264,135 L292,128 L320,140 L348,118 L376,122 L404,108 L432,114 L460,98 L488,105 L516,90 L544,95 L572,82 L600,88 L628,72 L656,80 L684,65 L712,70 L740,55 L768,62 L796,48 L824,52 L860,42" fill="none" stroke="var(--color-blue-500)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M40,205 L68,202 L96,200 L124,198 L152,200 L180,196 L208,193 L236,195 L264,190 L292,188 L320,191 L348,184 L376,186 L404,180 L432,183 L460,176 L488,179 L516,172 L544,175 L572,168 L600,171 L628,163 L656,167 L684,158 L712,162 L740,152 L768,156 L796,148 L824,150 L860,144" fill="none" stroke="var(--color-neutral-700)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <line x1="760" y1="40" x2="760" y2="210" stroke="var(--color-blue-500)" strokeWidth="1" strokeDasharray="3 3" opacity="0.45" />
                  <circle cx="760" cy="55"  r="4"   fill="var(--color-blue-500)" stroke="#fff" strokeWidth="2" />
                  <circle cx="760" cy="156" r="3.5" fill="var(--color-neutral-700)" stroke="#fff" strokeWidth="2" />
                  <g transform="translate(660 -2)">
                    <rect x="0" y="10" width="180" height="48" rx="6" fill="var(--color-neutral-900)" />
                    <text x="12" y="28" fontFamily="Inter, system-ui, sans-serif" fontSize="11" fill="#A8AABA">May 17, 2026</text>
                    <text x="12" y="46" fontFamily="Inter, system-ui, sans-serif" fontSize="12" fontWeight="500" fill="#fff">112 scans · 9 bookings</text>
                  </g>
                </svg>
              </div>
            </div>
          </section>

          {/* 2. Visitor environment */}
          <section className="sec" aria-labelledby="sec-tech">
            <div className="sec__head">
              <h3 className="sec__title" id="sec-tech">Visitor environment</h3>
              <div className="sec__hint">Inferred from user-agent · 1,894 sessions</div>
            </div>
            <div className="grid-2">
              <div className="pl-card">
                <header className="pl-card__head"><h4 className="pl-card__title">Browsers</h4></header>
                <div className="bars">
                  <Bar name="Safari (iOS)"      count="1,082" pct={57.1} icon={<Ico d='<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M21 12H12L7.5 4.5"/><path d="M12 21l4.5-7.8M3 7l4.5 7.8"/>' />} />
                  <Bar name="Chrome (Android)"  count="468"   pct={24.7} icon={<Ico d='<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M21.5 12h-9.4"/><path d="M7.3 7.3l4.7 4.7M7.3 16.7l4.7-4.7"/>' />} />
                  <Bar name="Chrome (desktop)"  count="182"   pct={9.6}  icon={<Ico d='<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>' />} />
                  <Bar name="Edge"              count="88"    pct={4.6}  icon={<Ico d='<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z"/><path d="M12 7v10M7 12h10"/>' />} />
                  <Bar name="Samsung Internet"  count="52"    pct={2.7}  icon={<Ico d='<circle cx="12" cy="12" r="9"/><path d="M5 8h14M5 16h14"/>' />} />
                  <Bar name="Firefox &amp; other" count="22"  pct={1.2}  icon={<Ico d='<circle cx="12" cy="12" r="9"/>' />} />
                </div>
              </div>
              <div className="pl-card">
                <header className="pl-card__head"><h4 className="pl-card__title">Operating systems</h4></header>
                <div className="bars bars--alt">
                  <Bar alt name="iOS 17 / 18"      count="1,140" pct={60.2} icon={<Ico d='<rect x="5" y="2" width="14" height="20" rx="2.5"/><line x1="11" y1="18" x2="13" y2="18"/>' />} />
                  <Bar alt name="Android 13 / 14"  count="530"   pct={28.0} icon={<Ico d='<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="9" y1="18" x2="15" y2="18"/>' />} />
                  <Bar alt name="macOS"            count="132"   pct={7.0}  icon={<Ico d='<rect x="2" y="4" width="20" height="14" rx="2"/><line x1="8" y1="22" x2="16" y2="22"/><line x1="12" y1="18" x2="12" y2="22"/>' />} />
                  <Bar alt name="Windows 10 / 11"  count="72"    pct={3.8}  icon={<Ico d='<rect x="3" y="4" width="18" height="13" rx="1"/><line x1="3" y1="20" x2="21" y2="20"/>' />} />
                  <Bar alt name="Other"            count="20"    pct={1.0}  icon={<Ico d='<circle cx="12" cy="12" r="9"/>' />} />
                </div>
              </div>
            </div>
          </section>

          {/* 3. Marketing materials */}
          <section className="sec" ref={secRefs.materials} aria-labelledby="sec-mats">
            <div className="sec__head">
              <h3 className="sec__title" id="sec-mats">Marketing materials</h3>
              <button className="btn btn--sm"><Ico d='<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>' /> Generate variant</button>
            </div>
            <div className="mats">
              <article className="mat">
                <div className="mat__preview"><QrGlyph /></div>
                <div className="mat__body">
                  <h4 className="mat__title">Lobby rack card — 4 × 9 in</h4>
                  <div className="mat__sub">Variant <span style={{ fontFamily: 'var(--font-mono)' }}>v3</span> · 1,820 scans of {scans} total</div>
                  <dl className="mat__specs">
                    <dt>Code type</dt><dd>QR · M (15%)</dd>
                    <dt>Code size</dt><dd>32 × 32 mm</dd>
                    <dt>Format</dt><dd>PDF / vector</dd>
                    <dt>Bleed</dt><dd>3 mm</dd>
                  </dl>
                  <div className="mat__actions">
                    <button className="btn btn--sm"><Ico d='<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>' /> Download PDF</button>
                    <button className="btn btn--sm btn--ghost">Print preview</button>
                  </div>
                </div>
              </article>
              <article className="mat">
                <div className="mat__preview"><QrGlyph /></div>
                <div className="mat__body">
                  <h4 className="mat__title">Tabletop tent — 3.5 × 5 in</h4>
                  <div className="mat__sub">Variant <span style={{ fontFamily: 'var(--font-mono)' }}>v1</span> · 592 scans of {scans} total</div>
                  <dl className="mat__specs">
                    <dt>Code type</dt><dd>QR · Q (25%)</dd>
                    <dt>Code size</dt><dd>28 × 28 mm</dd>
                    <dt>Format</dt><dd>PDF / vector</dd>
                    <dt>Bleed</dt><dd>3 mm</dd>
                  </dl>
                  <div className="mat__actions">
                    <button className="btn btn--sm"><Ico d='<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>' /> Download PDF</button>
                    <button className="btn btn--sm btn--ghost">Print preview</button>
                  </div>
                </div>
              </article>
            </div>
          </section>

          {/* 4. Configuration */}
          <section className="sec" ref={secRefs.cfg} aria-labelledby="sec-cfg">
            <div className="sec__head">
              <h3 className="sec__title" id="sec-cfg">Configuration</h3>
              <button className="btn btn--sm btn--ghost">Edit</button>
            </div>
            <div className="cfg">
              <div className="cfg__grid">
                <div className="cfg__cell cfg__cell--label">Code type</div>
                <div className="cfg__cell cfg__cell--val">QR code <span className="pill pill--neutral" style={{ marginLeft: 8 }}>Static</span></div>
                <div className="cfg__cell cfg__cell--label">Short code</div>
                <div className="cfg__cell cfg__cell--val mono">{code}</div>

                <div className="cfg__cell cfg__cell--label">Destination</div>
                <div className="cfg__cell cfg__cell--val mono" style={{ wordBreak: 'break-all' }}>gowithhorizon.com/r/banff-springs?p=lobby</div>
                <div className="cfg__cell cfg__cell--label">Resolved to</div>
                <div className="cfg__cell cfg__cell--val">{hotelName} · Tours catalog</div>

                <div className="cfg__cell cfg__cell--label">UTM tags</div>
                <div className="cfg__cell cfg__cell--val">
                  <div className="cfg__chips">
                    <span className="chip-utm"><b>source</b>hotel</span>
                    <span className="chip-utm"><b>medium</b>print</span>
                    <span className="chip-utm"><b>campaign</b>lobby_kiosk</span>
                    <span className="chip-utm"><b>content</b>rack_card_v3</span>
                  </div>
                </div>
                <div className="cfg__cell cfg__cell--label">Attribution window</div>
                <div className="cfg__cell cfg__cell--val">7 days · first-touch</div>

                <div className="cfg__cell cfg__cell--label">Created</div>
                <div className="cfg__cell cfg__cell--val">Apr 12, 2026 · by Isla Cole</div>
                <div className="cfg__cell cfg__cell--label">Expires</div>
                <div className="cfg__cell cfg__cell--val">Never</div>
              </div>
            </div>
          </section>

          {/* 5. Activity log */}
          <section className="sec" ref={secRefs.act} aria-labelledby="sec-act">
            <div className="sec__head">
              <h3 className="sec__title" id="sec-act">Activity log</h3>
              <a href="#" style={{ font: '500 12px/1 var(--font-sans)', color: 'var(--text-brand)', textDecoration: 'none' }}>View all 14 events →</a>
            </div>
            <div className="pl-card">
              <div className="tl">
                <div className="tl__item">
                  <span className="tl__dot tl__dot--ok"><Ico sw={2} d='<polyline points="20 6 9 17 4 12"/>' /></span>
                  <div className="tl__main">
                    <div className="tl__title">Booking <b>bk_K88RZA</b> credited · <b>CA$ 155.63</b> commission</div>
                    <div className="tl__sub">touch=first · scan_id=sc_88412 · session=ssn_baf2</div>
                  </div>
                  <div className="tl__when">2 h ago</div>
                </div>
                <div className="tl__item">
                  <span className="tl__dot tl__dot--brand"><Ico d='<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>' /></span>
                  <div className="tl__main">
                    <div className="tl__title">Scan burst · <b>32 scans</b> in 18 minutes</div>
                    <div className="tl__sub">user_agents=iOS 18 (74%) · Android 14 (22%) · other (4%)</div>
                  </div>
                  <div className="tl__when">May 19, 19:08</div>
                </div>
                <div className="tl__item">
                  <span className="tl__dot"><Ico d='<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>' /></span>
                  <div className="tl__main">
                    <div className="tl__title">Material <b>Lobby rack card v3</b> downloaded by <b>Hannah Cole</b></div>
                    <div className="tl__sub">format=pdf · 4.2 MB · ip=204.12.…</div>
                  </div>
                  <div className="tl__when">May 17, 11:42</div>
                </div>
                <div className="tl__item">
                  <span className="tl__dot tl__dot--warn"><Ico d='<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>' /></span>
                  <div className="tl__main">
                    <div className="tl__title">Destination URL returned <b>HTTP 502</b> · auto-resolved</div>
                    <div className="tl__sub">upstream=tours-router · retried 1× · 0 scans affected</div>
                  </div>
                  <div className="tl__when">May 14, 04:13</div>
                </div>
                <div className="tl__item">
                  <span className="tl__dot"><Ico d='<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' /></span>
                  <div className="tl__main">
                    <div className="tl__title">UTM <b>content</b> updated to <b>rack_card_v3</b></div>
                    <div className="tl__sub">previous=rack_card_v2 · by isla@horizon</div>
                  </div>
                  <div className="tl__when">Apr 28, 09:44</div>
                </div>
                <div className="tl__item">
                  <span className="tl__dot"><Ico d='<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>' /></span>
                  <div className="tl__main">
                    <div className="tl__title">Placement created · short code <b>{code}</b></div>
                    <div className="tl__sub">type=qr · static · by isla@horizon</div>
                  </div>
                  <div className="tl__when">Apr 12, 16:02</div>
                </div>
              </div>
            </div>
          </section>

        </div>

        {/* Footer */}
        <footer className="pl-foot">
          <div className="pl-foot__left">
            <button className="btn btn--danger-ghost btn--sm">Deactivate placement</button>
            <span className="pl-foot__hint">Stops new scans · history preserved</span>
          </div>
          <div className="pl-foot__right">
            <button className="btn">Edit placement</button>
            <button className="btn btn--primary" onClick={onClose}>Done</button>
          </div>
        </footer>

      </article>
    </div>
  );
}

window.PlacementLightbox = PlacementLightbox;
