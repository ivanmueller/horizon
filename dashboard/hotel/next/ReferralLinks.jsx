/* Referral link cards — placeholder QR squares + URL + clicks */

function FakeQR({ size = 140, seed = 'horizon' }) {
  // Deterministic 13x13 pixel pattern derived from the seed string.
  // Replaces the runtime QRCodeStyling lib from the live dashboard
  // with a static visual analogue suitable for kit mockups.
  const grid = 13;
  const px = size / grid;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const cells = [];
  for (let r = 0; r < grid; r++) {
    for (let c = 0; c < grid; c++) {
      h = Math.imul(h ^ (r*31 + c), 2654435761);
      // Skip the three finder eye zones (top-left, top-right, bottom-left)
      const inEye =
        (r < 3 && c < 3) ||
        (r < 3 && c > grid - 4) ||
        (r > grid - 4 && c < 3);
      if (inEye) continue;
      if ((h >>> 28) & 1) cells.push(<rect key={r+'-'+c} x={c*px} y={r*px} width={px} height={px} rx={px*0.35} fill="#4F5BFF" />);
    }
  }
  const Eye = ({ x, y }) => (
    <g transform={`translate(${x} ${y})`}>
      <rect width={3*px} height={3*px} rx={px*0.5} fill="#4F5BFF" />
      <rect x={px*0.5} y={px*0.5} width={2*px} height={2*px} rx={px*0.4} fill="#fff" />
      <rect x={px*0.9} y={px*0.9} width={1.2*px} height={1.2*px} rx={px*0.3} fill="#4F5BFF" />
    </g>
  );
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <rect width={size} height={size} rx={px} fill="#fff" />
      {cells}
      <Eye x={0} y={0} />
      <Eye x={(grid-3)*px} y={0} />
      <Eye x={0} y={(grid-3)*px} />
      <rect x={size/2 - px*1.5} y={size/2 - px*1.5} width={px*3} height={px*3} rx={px*0.6} fill="#4F5BFF" />
      <path d={`M${size/2 - px*0.5},${size/2 - px} v${px*2} M${size/2 - px*0.5},${size/2} c0,-${px*0.4} ${px*1.5},-${px*0.4} ${px*1.5},0 v${px}`} stroke="#fff" strokeWidth={px*0.45} fill="none" strokeLinecap="round" />
    </svg>
  );
}

function LinkCard({ label, url, clicks, onCopy, onDownload }) {
  return (
    <div className="link-card">
      <div className="link-card__qr">
        <FakeQR seed={url} size={140} />
      </div>
      <div className="link-card__label">{label}</div>
      <button className="link-card__url" onClick={() => onCopy && onCopy(url)}>
        <span>{url}</span>
        <I.copy size={12} />
      </button>
      <div className="link-card__meta">
        <span>{clicks.toLocaleString()} scan{clicks === 1 ? '' : 's'}</span>
        <button className="btn btn--sm" onClick={() => onDownload && onDownload(label)}>Download QR</button>
      </div>
    </div>
  );
}

function ReferralLinksSection({ links, onCopy, onDownload }) {
  return (
    <section>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',marginBottom:14}}>
        <div>
          <div className="card__title" style={{fontSize:18}}>Referral links</div>
          <div className="caption" style={{marginTop:2,fontSize:12,color:'var(--text-secondary)'}}>Share these short URLs or QR codes with guests. Scans and bookings track automatically.</div>
        </div>
        <button className="btn"><I.qr size={14} /> New link</button>
      </div>
      <div className="links-grid">
        {links.map(l => (
          <LinkCard key={l.url}
            label={l.label}
            url={l.url}
            clicks={l.clicks}
            onCopy={onCopy}
            onDownload={onDownload}
          />
        ))}
      </div>
    </section>
  );
}

window.ReferralLinksSection = ReferralLinksSection;
window.FakeQR = FakeQR;
window.LinkCard = LinkCard;
