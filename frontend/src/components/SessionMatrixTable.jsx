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

export const SessionMatrixTable = ({ data, compact = false, longPowerRanking = [], shortPowerRanking = [] }) => {
  const sessionRanking = data?.ranking || [];
  const sessions = data?.sessions || [];
  const longPower = Array.isArray(longPowerRanking) ? longPowerRanking : [];
  const shortPower = Array.isArray(shortPowerRanking) ? shortPowerRanking : [];
  const sessionByCurrency = new Map(sessionRanking.map(item => [item.currency, item]));
  const shortPowerByCurrency = new Map(shortPower.map(item => [item.currency, item]));
  const ranking = longPower.length
    ? longPower.map(power => ({
        ...(sessionByCurrency.get(power.currency) || {}),
        currency: power.currency,
        legacyLongPower: power,
        legacyShortPower: shortPowerByCurrency.get(power.currency)
      }))
    : sessionRanking;
  if (!ranking.length) {
    return <div style={{ padding: '14px', color: '#94a3b8', fontSize: compact ? '11px' : '13px' }}>Chưa có dữ liệu phiên cho nhóm tài sản này.</div>;
  }

  const fontSize = compact ? '11px' : '12px';
  const cellPadding = compact ? '7px 5px' : '11px 8px';
  const longLabel = `${data.long_hours || 89}h`;
  const shortLabel = `${data.short_hours || 24}h`;

  return (
    <div style={{ width: '100%', minWidth: 0, overflowX: 'auto', overscrollBehaviorX: 'contain' }}>
      <table style={{ width: '100%', minWidth: compact ? '1360px' : '1725px', tableLayout: 'fixed', borderCollapse: 'collapse', color: '#e2e8f0', fontSize }}>
        <colgroup>
          <col style={{ width: compact ? '34px' : '58px' }} />
          <col style={{ width: compact ? '58px' : '90px' }} />
          <col style={{ width: compact ? '132px' : '165px' }} />
          <col style={{ width: compact ? '100px' : '130px' }} />
          <col style={{ width: compact ? '100px' : '130px' }} />
          <col style={{ width: compact ? '85px' : '105px' }} />
          {sessions.map(session => <col key={session.key} style={{ width: compact ? '194px' : '235px' }} />)}
          <col style={{ width: compact ? '74px' : '105px' }} />
        </colgroup>
        <thead>
          <tr style={{ color: '#7dd3fc', borderBottom: '1px solid rgba(125,211,252,0.2)' }}>
            <th style={{ textAlign: 'left', padding: cellPadding }}>#</th>
            <th style={{ textAlign: 'left', padding: cellPadding }}>Tài sản</th>
            <th style={{ textAlign: 'left', padding: cellPadding }}>Power V-target {longLabel} / {shortLabel}</th>
            <th style={{ textAlign: 'left', padding: cellPadding }}>Price Trend V-target</th>
            <th style={{ textAlign: 'left', padding: cellPadding }}>Money Flow V-target</th>
            <th style={{ textAlign: 'left', padding: cellPadding }}>Vol % V-target</th>
            {sessions.map(session => <th key={session.key} style={{ textAlign: 'left', padding: cellPadding }}>{session.label}</th>)}
            <th style={{ textAlign: 'right', padding: cellPadding }}>Pha</th>
          </tr>
        </thead>
        <tbody>
          {ranking.map((item, index) => {
            const powerValue = item.legacyLongPower?.powerScore;
            const shortPowerValue = item.legacyShortPower?.powerScore;
            const powerColor = powerValue > 0 ? '#4ade80' : powerValue < 0 ? '#fb7185' : '#cbd5e1';
            const status = item.legacyLongPower?.status || item.status;
            const statusColor = item.legacyLongPower?.statusColor || item.status_color;
            const renderLegacyPercent = (field, colorByDirection = true) => {
              const longValue = item.legacyLongPower?.[field];
              const shortValue = item.legacyShortPower?.[field];
              const colorFor = value => colorByDirection ? metricColor(value)
                : value >= 75 ? '#4ade80' : value <= 20 ? '#f87171' : '#7dd3fc';
              const formatValue = value => `${colorByDirection && value > 0 ? '+' : ''}${value.toFixed(0)}%`;
              return (
                <td style={{ padding: cellPadding, whiteSpace: 'nowrap' }}>
                  <span style={{ color: longValue == null ? '#64748b' : colorFor(longValue) }}>{longValue == null ? '—' : formatValue(longValue)}</span>
                  <span style={{ color: shortValue == null ? '#64748b' : colorFor(shortValue), fontSize: compact ? '10px' : '11px' }}> ({shortValue == null ? '—' : formatValue(shortValue)})</span>
                </td>
              );
            };
            return (
              <tr key={item.currency} style={{ borderBottom: '1px solid rgba(148,163,184,0.09)' }}>
                <td style={{ padding: cellPadding, color: index < 3 ? '#fbbf24' : '#94a3b8', fontWeight: 700 }}>{index + 1}</td>
                <td style={{ padding: cellPadding, fontWeight: 700, color: '#f8fafc' }}>{item.currency}</td>
                <td style={{ padding: cellPadding, whiteSpace: 'nowrap' }}>
                  <span style={{ color: powerColor, fontWeight: 700 }}>{powerValue == null ? '—' : `${powerValue > 0 ? '+' : ''}${powerValue.toFixed(1)}`}</span>
                  <span style={{ color: '#94a3b8', fontSize: compact ? '10px' : '11px' }}> ({shortPowerValue == null ? '—' : `${shortPowerValue > 0 ? '+' : ''}${shortPowerValue.toFixed(1)}`})</span>
                </td>
                {renderLegacyPercent('momTrend')}
                {renderLegacyPercent('momFlow')}
                {renderLegacyPercent('vol_percentile', false)}
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
                  <span style={{ color: statusColor, fontSize: compact ? '10px' : '11px', fontWeight: 700, whiteSpace: 'nowrap' }}>{status || '—'}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
