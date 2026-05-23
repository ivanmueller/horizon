/* Simple area chart — pure SVG, no chart lib. Uses the violet ramp. */
function CommissionChart({ data, height = 220 }) {
  const W = 720, H = height, P = { l: 36, r: 16, t: 16, b: 28 };
  const xs = data.map((_, i) => P.l + (i * (W - P.l - P.r)) / (data.length - 1));
  const max = Math.max(...data.map(d => d.v)) * 1.15;
  const ys = data.map(d => H - P.b - (d.v / max) * (H - P.t - P.b));

  const linePath = xs.map((x, i) => (i === 0 ? `M${x},${ys[i]}` : `L${x},${ys[i]}`)).join(' ');
  const areaPath = linePath + ` L${xs[xs.length-1]},${H - P.b} L${xs[0]},${H - P.b} Z`;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => Math.round(max * t));
  const xLabels = data.map((d, i) => (i % Math.ceil(data.length / 6) === 0 ? d.l : null));

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="ccArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#4F5BFF" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#4F5BFF" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* grid + y labels */}
      {yTicks.map((t, i) => {
        const y = H - P.b - (t / max) * (H - P.t - P.b);
        return (
          <g key={i}>
            <line x1={P.l} x2={W - P.r} y1={y} y2={y} stroke="#ECEAF4" strokeWidth="1" />
            <text x={P.l - 8} y={y + 4} textAnchor="end" fontSize="11" fill="#807A92" fontFamily="JetBrains Mono, monospace">
              ${(t/1000).toFixed(t >= 1000 ? 1 : 0)}{t >= 1000 ? 'k' : ''}
            </text>
          </g>
        );
      })}
      {/* x labels */}
      {xLabels.map((l, i) => l && (
        <text key={i} x={xs[i]} y={H - 8} textAnchor="middle" fontSize="11" fill="#807A92" fontFamily="Inter, sans-serif">{l}</text>
      ))}
      <path d={areaPath} fill="url(#ccArea)" />
      <path d={linePath} fill="none" stroke="#4F5BFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* end dot */}
      <circle cx={xs[xs.length-1]} cy={ys[ys.length-1]} r="4" fill="#fff" stroke="#4F5BFF" strokeWidth="2" />
    </svg>
  );
}

function ChartPanel({ data }) {
  const total = data.reduce((s, d) => s + d.v, 0);
  return (
    <div className="card">
      <div className="card__head">
        <div>
          <div className="card__title">Commission earned</div>
          <div className="caption" style={{marginTop:2,fontSize:12,color:'var(--text-secondary)',fontVariantNumeric:'tabular-nums'}}>
            CA$ {total.toLocaleString()} · last 30 days
          </div>
        </div>
        <div style={{display:'flex',gap:6,alignItems:'center'}}>
          <span className="pill pill--ok" style={{fontSize:11}}>↑ 18% vs prev. period</span>
        </div>
      </div>
      <div style={{padding:'8px 12px 12px'}}>
        <CommissionChart data={data} />
      </div>
    </div>
  );
}

window.ChartPanel = ChartPanel;
window.CommissionChart = CommissionChart;
