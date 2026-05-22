/* Bookings table with status pills, source columns, hover state */
const STATUS = {
  credited: { cls: 'pill--ok',   label: 'Credited' },
  pending:  { cls: 'pill--warn', label: 'Pending'  },
  failed:   { cls: 'pill--bad',  label: 'Failed'   },
  review:   { cls: 'pill--info', label: 'In review'},
};

function StatusPill({ kind }) {
  const s = STATUS[kind] || STATUS.pending;
  return <span className={'pill ' + s.cls}>{s.label}</span>;
}

function Initials({ name }) {
  const parts = (name || '').split(' ').filter(Boolean);
  const init = parts.length >= 2
    ? (parts[0][0] + parts[parts.length-1][0]).toUpperCase()
    : (name || '?').slice(0,2).toUpperCase();
  return <span className="avatar">{init}</span>;
}

function BookingsTable({ rows, onRowClick }) {
  return (
    <div className="card">
      <div className="card__head">
        <div>
          <div className="card__title">Bookings</div>
          <div className="caption" style={{marginTop:2,fontSize:12,color:'var(--text-secondary)'}}>Sorted by most recent · click a row for the full attribution funnel</div>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button className="btn btn--sm"><I.filter size={12} /> Filter</button>
          <button className="btn btn--sm"><I.download size={12} /> Export CSV</button>
        </div>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Booked</th>
            <th>Tour</th>
            <th>Guest</th>
            <th className="num">Travelers</th>
            <th className="num">Amount</th>
            <th className="num">Commission</th>
            <th>Source</th>
            <th>Status</th>
            <th>Confirmation</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} onClick={() => onRowClick && onRowClick(r)}>
              <td>{r.bookedOn}</td>
              <td>{r.tour}</td>
              <td><span className="guest"><Initials name={r.guest} /><span>{r.guest}</span></span></td>
              <td className="num">{r.travelers}</td>
              <td className="num">CA$ {r.amount.toFixed(2)}</td>
              <td className="num">CA$ {r.commission.toFixed(2)}</td>
              <td>{r.source}</td>
              <td><StatusPill kind={r.status} /></td>
              <td><span className="mono">{r.confirmation}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

window.BookingsTable = BookingsTable;
window.StatusPill = StatusPill;
