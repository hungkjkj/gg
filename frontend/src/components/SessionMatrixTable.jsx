import React from 'react';

const metricColor = value => value > 0 ? '#22d3ee' : value < 0 ? '#fb7185' : '#cbd5e1';
const signed = value => `${value > 0 ? '+' : ''}${Number(value || 0).toFixed(2)}%`;
const compactVolume = value => value == null
  ? '—'
  : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);

const SessionPeriodCell = ({ period, label }) => {
  if (!period) return <div style={{ color: '#64748b', fontSize: '11px' }}>{label}: —</div>;
  const volumePercentile = period.volume_percentile;
  const volumeColor = volumePercentile == null ? '#94a3b8'
    : volumePercentile >= 75 ? '#4ade80'
      : volumePercentile <= 20 ? '#f87171' : '#7dd3fc';

  return (
    <div title={`${label}: trung bình ${period.samples} phiên, ${period.bars} nến mỗi phiên`} style={{ display: 'grid', gridTemplateColumns: '30px minmax(0, 1fr)', alignItems: 'baseline', columnGap: '5px', rowGap: '2px', margin: '2px 0' }}>
      <span style={{ color: '#94a3b8', fontSize: '10px', fontWeight: 700 }}>{label}</span>
      <span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '11px' }}>
        <span style={{ color: metricColor(period.trend_pct) }}>T {signed(period.trend_pct)}</span>
        <span style={{ color: '#475569' }}> · </span>
        <span style={{ color: metricColor(period.flow_pct) }}>F {signed(period.flow_pct)}</span>
        <span style={{ color: '#475569' }}> · </span>
        <span style={{ color: volumeColor }}>V {compactVolume(period.average_volume)} ({volumePercentile == null ? '—' : `${Math.round(volumePercentile)}%`})</span>
        <span style={{ color: '#64748b', fontSize: '9px' }}> n={period.samples}</span>
      </span>
    </div>
  );
};

export const SessionMatrixTable = ({ data, compact = false }) => {
  const ranking = data?.ranking || [];
  const sessions = data?.sessions || [];
  if (!ranking.length) {
    return <div style={{ padding: '14px', color: '#94a3b8', fontSize: compact ? '11px' : '13px' }}>Chưa có dữ liệu phiên cho nhóm tài sản này.</div>;
  }

  const fontSize = compact ? '11px' : '12px';
  const cellPadding = compact ? '7px 5px' : '11px 8px';
  const longLabel = `${data.long_hours || 89}h`;
  const shortLabel = `${data.short_hours || 24}h`;

  return (
    <div style={{ width: '100%', minWidth: 0, overflowX: 'auto', overscrollBehaviorX: 'contain' }}>
      <table style={{ width: '100%', minWidth: compact ? '1074px' : '1363px', tableLayout: 'fixed', borderCollapse: 'collapse', color: '#e2e8f0', fontSize }}>
        <colgroup>
          <col style={{ width: compact ? '34px' : '58px' }} />
          <col style={{ width: compact ? '58px' : '90px' }} />
          <col style={{ width: compact ? '132px' : '170px' }} />
          {sessions.map(session => <col key={session.key} style={{ width: compact ? '194px' : '235px' }} />)}
          <col style={{ width: compact ? '74px' : '105px' }} />
        </colgroup>
        <thead>
          <tr style={{ color: '#7dd3fc', borderBottom: '1px solid rgba(125,211,252,0.2)' }}>
            <th style={{ textAlign: 'left', padding: cellPadding }}>#</th>
            <th style={{ textAlign: 'left', padding: cellPadding }}>Tài sản</th>
            <th style={{ textAlign: 'left', padding: cellPadding }}>Power (%) {longLabel} / {shortLabel}</th>
            {sessions.map(session => <th key={session.key} style={{ textAlign: 'left', padding: cellPadding }}>{session.label}</th>)}
            <th style={{ textAlign: 'right', padding: cellPadding }}>Pha</th>
          </tr>
        </thead>
        <tbody>
          {ranking.map((item, index) => {
            const powerColor = item.power_score > 0 ? '#4ade80' : item.power_score < 0 ? '#fb7185' : '#cbd5e1';
            return (
              <tr key={item.currency} style={{ borderBottom: '1px solid rgba(148,163,184,0.09)' }}>
                <td style={{ padding: cellPadding, color: index < 3 ? '#fbbf24' : '#94a3b8', fontWeight: 700 }}>{index + 1}</td>
                <td style={{ padding: cellPadding, fontWeight: 700, color: '#f8fafc' }}>{item.currency}</td>
                <td style={{ padding: cellPadding, whiteSpace: 'nowrap' }}>
                  <span style={{ color: powerColor, fontWeight: 700 }}>{item.power_score > 0 ? '+' : ''}{Number(item.power_score || 0).toFixed(4)}%</span>
                  <span style={{ color: '#94a3b8', fontSize: compact ? '10px' : '11px' }}> ({item.short_power_score > 0 ? '+' : ''}{Number(item.short_power_score || 0).toFixed(4)}%)</span>
                </td>
                {sessions.map(session => {
                  const stats = item.sessions?.[session.key] || {};
                  return (
                    <td key={session.key} style={{ padding: cellPadding, overflow: 'hidden' }}>
                      <SessionPeriodCell period={stats.long} label={longLabel} />
                      <SessionPeriodCell period={stats.short} label={shortLabel} />
                    </td>
                  );
                })}
                <td style={{ padding: cellPadding, textAlign: 'right' }}>
                  <span style={{ color: item.status_color, fontSize: compact ? '10px' : '11px', fontWeight: 700, whiteSpace: 'nowrap' }}>{item.status}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
