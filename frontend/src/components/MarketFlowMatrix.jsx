import React from 'react';

const positiveColor = '#4ade80';
const negativeColor = '#fb7185';
const neutralColor = '#cbd5e1';

const directionColor = value => value > 0 ? positiveColor : value < 0 ? negativeColor : neutralColor;
const signed = (value, digits = 0) => {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const number = Number(value);
  return `${number > 0 ? '+' : ''}${number.toFixed(digits)}${digits === 0 ? '%' : ''}`;
};

const PeriodValue = ({ label, value, title }) => (
  <div title={title} style={{ display: 'flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap', lineHeight: 1.45 }}>
    <span style={{ width: '26px', color: '#94a3b8', fontSize: '10px' }}>{label}</span>
    <strong style={{ color: value == null ? '#64748b' : directionColor(value), fontSize: '11px' }}>{signed(value)}</strong>
  </div>
);

const PeriodVolume = ({ label, value }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap', lineHeight: 1.45 }}>
    <span style={{ width: '26px', color: '#94a3b8', fontSize: '10px' }}>{label}</span>
    <strong style={{ color: value == null ? '#64748b' : value >= 75 ? positiveColor : value <= 20 ? negativeColor : '#7dd3fc', fontSize: '11px' }}>
      {value == null ? '—' : `${Math.round(value)}%`}
    </strong>
  </div>
);

const PeriodPower = ({ label, period }) => {
  const value = period?.power_score;
  return (
    <div title={period ? `${label}: ${period.status || 'Chưa phân loại'}` : undefined} style={{ display: 'flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap', lineHeight: 1.45 }}>
      <span style={{ width: '26px', color: '#94a3b8', fontSize: '10px' }}>{label}</span>
      <strong style={{ color: value == null ? '#64748b' : directionColor(value), fontSize: '11px' }}>{value == null ? '—' : signed(value, 1)}</strong>
    </div>
  );
};

const correlationColor = value => {
  if (value == null) return 'transparent';
  if (value >= 0) return `rgba(74, 222, 128, ${0.10 + Math.abs(value) * 0.32})`;
  return `rgba(248, 113, 113, ${0.10 + Math.abs(value) * 0.32})`;
};

const LeaderCard = ({ title, item, periodKey }) => {
  const period = item?.[periodKey];
  const score = period?.power_score;
  return (
    <div style={{ flex: '1 1 210px', minWidth: 0, padding: '12px 14px', borderRadius: '10px', border: '1px solid rgba(125,211,252,0.16)', background: 'rgba(255,255,255,0.025)' }}>
      <div style={{ color: '#94a3b8', fontSize: '11px', marginBottom: '4px' }}>{title}</div>
      <strong style={{ color: score == null ? '#94a3b8' : directionColor(score), fontSize: '15px' }}>
        {item ? `${item.label} (${signed(score, 1)})` : 'Chưa có dữ liệu'}
      </strong>
      {period && <div style={{ color: '#94a3b8', fontSize: '10px', marginTop: '4px' }}>{period.status || '—'} · F {signed(period.flow?.momentum_pct)}</div>}
    </div>
  );
};

export default function MarketFlowMatrix({ data, loading, error, progress, onRefresh }) {
  const longRanking = data?.ranking_long || [];
  const shortRanking = data?.ranking_short || [];
  const shortLeaders = shortRanking.filter(item => item.short).sort((a, b) => b.short.power_score - a.short.power_score);
  const longLeaders = longRanking.filter(item => item.long).sort((a, b) => b.long.power_score - a.long.power_score);
  const longLabel = `${data?.long_hours || 89}h`;
  const shortLabel = `${data?.short_hours || 24}h`;

  return (
    <div style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-panel)', padding: '20px', borderRadius: '12px', border: '1px solid rgba(34,211,238,0.22)', boxShadow: '0 0 24px rgba(34,211,238,0.04)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <div>
          <h2 style={{ margin: 0, color: '#67e8f9', fontSize: '1.2rem' }}>Dòng tiền giữa các thị trường</h2>
          <div style={{ color: 'var(--text-secondary)', fontSize: '12px', marginTop: '5px', lineHeight: 1.5 }}>
            T/F là phân vị động lượng có dấu so với các cửa sổ cùng độ dài trong Vol days; V là phân vị tick volume; P = (0.368 × T + 0.632 × F) × hệ số V. F dùng tick volume làm proxy, không phải số vốn tuyệt đối chuyển giữa các thị trường.
          </div>
        </div>
        <button onClick={onRefresh} disabled={loading} style={{ padding: '7px 12px', borderRadius: '7px', background: loading ? '#334155' : '#0e7490', color: 'white', border: '1px solid rgba(103,232,249,0.35)', cursor: loading ? 'wait' : 'pointer', fontWeight: 700 }}>
          {loading ? `Đang tính ${progress || 0}%` : '↻ Làm mới'}
        </button>
      </div>

      {error && <div style={{ color: '#fca5a5', padding: '10px 12px', marginBottom: '12px', borderRadius: '8px', background: 'rgba(248,113,113,0.08)' }}>{error}</div>}

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <LeaderCard title={`Power dẫn đầu · ${shortLabel}`} item={shortLeaders[0]} periodKey="short" />
        <LeaderCard title={`Power dẫn đầu · ${longLabel}`} item={longLeaders[0]} periodKey="long" />
      </div>

      <div style={{ width: '100%', overflowX: 'auto', overscrollBehaviorX: 'contain' }}>
        <table style={{ width: '100%', minWidth: '700px', borderCollapse: 'collapse', tableLayout: 'fixed', color: '#e2e8f0', fontSize: '12px' }}>
          <colgroup>
            <col style={{ width: '38px' }} />
            <col style={{ width: '165px' }} />
            <col style={{ width: '125px' }} />
            <col style={{ width: '125px' }} />
            <col style={{ width: '100px' }} />
            <col style={{ width: '105px' }} />
            <col style={{ width: '95px' }} />
          </colgroup>
          <thead>
            <tr style={{ color: '#7dd3fc', borderBottom: '1px solid rgba(125,211,252,0.2)' }}>
              {['#', 'Thị trường / GI', 'T · Price Trend', 'F · Money Flow', 'V · Volume', 'P · Power', 'Trạng thái'].map((label, index) => (
                <th key={label} style={{ textAlign: index < 2 ? 'left' : 'center', padding: '9px 7px' }}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {longRanking.map((item, index) => {
              const long = item.long;
              const short = item.short;
              return (
                <tr key={item.key} style={{ borderBottom: '1px solid rgba(148,163,184,0.10)' }}>
                  <td style={{ padding: '9px 7px', color: index < 2 ? '#fbbf24' : '#94a3b8', fontWeight: 700 }}>{index + 1}</td>
                  <td style={{ padding: '9px 7px' }}>
                    <strong style={{ display: 'block', color: '#f8fafc' }}>{item.label}</strong>
                    <span style={{ color: '#64748b', fontSize: '10px' }}>{item.gi_symbol}</span>
                  </td>
                  <td style={{ padding: '7px', textAlign: 'center' }}>
                    <PeriodValue label={longLabel} value={long?.trend?.momentum_pct} title={`Raw T: ${long?.trend?.score ?? '—'}`} />
                    <PeriodValue label={shortLabel} value={short?.trend?.momentum_pct} title={`Raw T: ${short?.trend?.score ?? '—'}`} />
                  </td>
                  <td style={{ padding: '7px', textAlign: 'center' }}>
                    <PeriodValue label={longLabel} value={long?.flow?.momentum_pct} title={`Raw F: ${long?.flow?.score ?? '—'}`} />
                    <PeriodValue label={shortLabel} value={short?.flow?.momentum_pct} title={`Raw F: ${short?.flow?.score ?? '—'}`} />
                  </td>
                  <td style={{ padding: '7px', textAlign: 'center' }}>
                    <PeriodVolume label={longLabel} value={long?.volume_pct} />
                    <PeriodVolume label={shortLabel} value={short?.volume_pct} />
                  </td>
                  <td style={{ padding: '7px', textAlign: 'center' }}>
                    <PeriodPower label={longLabel} period={long} />
                    <PeriodPower label={shortLabel} period={short} />
                  </td>
                  <td style={{ padding: '7px', textAlign: 'center' }}>
                    <span style={{ color: long ? directionColor(long.power_score) : '#64748b', fontSize: '10px', fontWeight: 700 }}>{long?.status || '—'}</span>
                    <span style={{ display: 'block', marginTop: '3px', color: short ? directionColor(short.power_score) : '#64748b', fontSize: '10px' }}>{short?.status || '—'}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: '18px', padding: '14px', borderRadius: '10px', background: 'rgba(15,23,42,0.42)', overflowX: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '9px' }}>
          <h3 style={{ margin: 0, color: '#f0abfc', fontSize: '14px' }}>Tương quan giữa các GI · M30 log returns</h3>
          <span style={{ color: '#94a3b8', fontSize: '10px' }}>Xanh: cùng chiều · Đỏ: ngược chiều</span>
        </div>
        {data?.corr_matrix?.length ? (
          <table style={{ borderCollapse: 'collapse', textAlign: 'center', fontSize: '11px', minWidth: '460px' }}>
            <thead>
              <tr>
                <th style={{ padding: '7px 9px', color: '#94a3b8', textAlign: 'left' }}></th>
                {data.markets.map(market => <th key={market} style={{ padding: '7px 9px', color: '#94a3b8', whiteSpace: 'nowrap' }}>{market}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.corr_matrix.map(row => (
                <tr key={row.market}>
                  <th style={{ padding: '7px 9px', color: '#cbd5e1', textAlign: 'left', whiteSpace: 'nowrap' }}>{row.market}</th>
                  {data.markets.map(market => {
                    const value = row[market];
                    return <td key={market} style={{ padding: '7px 9px', color: value == null ? '#64748b' : directionColor(value), background: correlationColor(value), border: '2px solid var(--bg-panel)', borderRadius: '4px' }}>{value == null ? '—' : value.toFixed(2)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div style={{ color: '#94a3b8', fontSize: '12px' }}>Chưa đủ dữ liệu GI để tính ma trận tương quan.</div>}
      </div>

      {loading && !data && <div style={{ padding: '18px 0 0', color: '#7dd3fc', fontSize: '12px' }}>Đang lấy dữ liệu GI cho từng thị trường…</div>}
    </div>
  );
}
