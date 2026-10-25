import React from 'react';

const metricColor = value => value > 0 ? '#22d3ee' : value < 0 ? '#fb7185' : '#cbd5e1';
const signedPercentile = value => `${value > 0 ? '+' : ''}${Math.round(Number(value || 0))}%`;
const signedPower = value => `${value > 0 ? '+' : ''}${Number(value || 0).toFixed(2)}`;
const volumePercentileColor = value => value == null ? '#94a3b8'
  : value >= 75 ? '#4ade80'
    : value <= 20 ? '#f87171' : '#7dd3fc';

const SessionPeriodCell = ({ period, label }) => {
  if (!period) return <div style={{ color: '#64748b', fontSize: '11px' }}>{label}: —</div>;
  const volumePercentile = period.volume_percentile;
  const volumeColor = volumePercentileColor(volumePercentile);
  const powerScore = period.power_score;
  const trendPercentile = period.trend_percentile;
  const flowPercentile = period.flow_percentile;

  return (
    <div title={`${label}: trung bình ${period.samples} phiên, ${period.bars} nến mỗi phiên. T/F là phân vị có dấu so với các cửa sổ cùng độ dài trong Vol days. P = (0.368 × T + 0.632 × F) × hệ số V.`} style={{ display: 'grid', gridTemplateColumns: '24px minmax(0, 1fr)', alignItems: 'start', columnGap: '4px', rowGap: '1px', margin: '2px 0', minWidth: 0 }}>
      <span style={{ color: '#94a3b8', fontSize: '9px', fontWeight: 700, paddingTop: '1px' }}>{label}</span>
      <span style={{ minWidth: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', rowGap: '1px', fontSize: '9px', lineHeight: 1.25 }}>
        <span style={{ display: 'flex', flexWrap: 'wrap', columnGap: '5px', minWidth: 0 }}>
          <span style={{ color: trendPercentile == null ? '#94a3b8' : metricColor(trendPercentile), whiteSpace: 'nowrap' }}>T{trendPercentile == null ? '—' : signedPercentile(trendPercentile)}</span>
          <span style={{ color: flowPercentile == null ? '#94a3b8' : metricColor(flowPercentile), whiteSpace: 'nowrap' }}>F{flowPercentile == null ? '—' : signedPercentile(flowPercentile)}</span>
        </span>
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: '3px', whiteSpace: 'nowrap', fontSize: '9px' }}>
          <span style={{ color: volumeColor, fontWeight: 700 }}>
            V{volumePercentile == null ? '—' : `${Math.round(volumePercentile)}%`}
          </span>
          <span style={{ color: powerScore == null ? '#94a3b8' : metricColor(powerScore), fontWeight: 700 }}>
            P{powerScore == null ? '—' : signedPower(powerScore)}
          </span>
        </span>
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
  const cellPadding = compact ? '4px 3px' : '7px 5px';
  const maxAssetLength = ranking.reduce((max, item) => Math.max(max, String(item.currency || '').length), 0);
  const assetColumnWidth = compact ? 44 : Math.min(150, Math.max(58, maxAssetLength * 8 + 12));
  const fixedColumnWidth = 455 + assetColumnWidth;
  const longLabel = `${data.long_hours || 89}h`;
  const shortLabel = `${data.short_hours || 24}h`;
  const frameCellStyle = (first = false, last = false) => ({
    background: compact ? 'rgba(8, 20, 40, 0.62)' : 'rgba(8, 20, 40, 0.28)',
    borderTop: '1px solid rgba(34,211,238,0.28)',
    borderBottom: '1px solid rgba(34,211,238,0.28)',
    ...(first ? { borderLeft: '1px solid rgba(34,211,238,0.28)', borderTopLeftRadius: '6px', borderBottomLeftRadius: '6px' } : {}),
    ...(last ? { borderRight: '1px solid rgba(34,211,238,0.28)', borderTopRightRadius: '6px', borderBottomRightRadius: '6px' } : {}),
  });

  return (
    <div style={{ width: '100%', minWidth: 0, overflowX: 'auto', overscrollBehaviorX: 'contain' }}>
      <table style={{ width: '100%', minWidth: compact ? '900px' : '1120px', tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: '0 4px', color: '#e2e8f0', fontSize }}>
        <colgroup>
          <col style={{ width: compact ? '28px' : '34px' }} />
          <col style={{ width: `${assetColumnWidth}px` }} />
          <col style={{ width: compact ? '110px' : '112px' }} />
          {!compact && <col style={{ width: '85px' }} />}
          {!compact && <col style={{ width: '85px' }} />}
          {!compact && <col style={{ width: '75px' }} />}
          {sessions.map(session => <col key={session.key} style={{ width: compact ? '165px' : `calc((100% - ${fixedColumnWidth}px) / ${Math.max(sessions.length, 1)})` }} />)}
          <col style={{ width: compact ? '54px' : '64px' }} />
        </colgroup>
        <thead>
          <tr style={{ color: '#7dd3fc', borderBottom: '1px solid rgba(125,211,252,0.2)' }}>
            <th style={{ textAlign: 'left', padding: cellPadding }}>#</th>
            <th style={{ textAlign: 'left', padding: cellPadding }}>Tài sản</th>
            <th style={{ textAlign: 'left', padding: cellPadding }}>{compact ? `Power / Vol % ${longLabel}/${shortLabel}` : `Power V-target ${longLabel} / ${shortLabel}`}</th>
            {!compact && <th style={{ textAlign: 'left', padding: cellPadding }}>Price Trend V-target</th>}
            {!compact && <th style={{ textAlign: 'left', padding: cellPadding }}>Money Flow V-target</th>}
            {!compact && <th style={{ textAlign: 'left', padding: cellPadding }}>Vol % {longLabel} / {shortLabel}</th>}
            {sessions.map(session => <th key={session.key} style={{ textAlign: 'left', padding: cellPadding }}>{session.label}</th>)}
            <th style={{ textAlign: 'right', padding: cellPadding }}>Pha</th>
          </tr>
        </thead>
        <tbody>
          {ranking.map((item, index) => {
            const powerValue = item.legacyLongPower?.powerScore;
            const shortPowerValue = item.legacyShortPower?.powerScore;
            const longVolumePercentile = item.legacyLongPower?.vol_percentile;
            const shortVolumePercentile = item.legacyShortPower?.vol_percentile;
            const powerColor = powerValue > 0 ? '#4ade80' : powerValue < 0 ? '#fb7185' : '#cbd5e1';
            const shortPowerColor = shortPowerValue > 0 ? '#4ade80' : shortPowerValue < 0 ? '#fb7185' : '#cbd5e1';
            const status = item.legacyLongPower?.status || item.status;
            const statusColor = item.legacyLongPower?.statusColor || item.status_color;
            const renderLegacyPercent = (field, colorByDirection = true) => {
              const longValue = item.legacyLongPower?.[field];
              const shortValue = item.legacyShortPower?.[field];
              const colorFor = value => colorByDirection ? metricColor(value)
                : value >= 75 ? '#4ade80' : value <= 20 ? '#f87171' : '#7dd3fc';
              const formatValue = value => `${colorByDirection && value > 0 ? '+' : ''}${value.toFixed(0)}%`;
              return (
                <td style={{ ...frameCellStyle(), padding: cellPadding, whiteSpace: 'nowrap' }}>
                  <span style={{ color: longValue == null ? '#64748b' : colorFor(longValue) }}>{longValue == null ? '—' : formatValue(longValue)}</span>
                  <span style={{ color: shortValue == null ? '#64748b' : colorFor(shortValue), fontSize: compact ? '10px' : '11px' }}> ({shortValue == null ? '—' : formatValue(shortValue)})</span>
                </td>
              );
            };
            return (
              <tr key={item.currency}>
                <td style={{ ...frameCellStyle(true), padding: cellPadding, color: index < 3 ? '#fbbf24' : '#94a3b8', fontWeight: 700 }}>{index + 1}</td>
                <td title={item.currency} style={{ ...frameCellStyle(), padding: cellPadding, fontWeight: 700, color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.currency}</td>
                <td
                  title={compact ? `Power V-target: ${longLabel} / ${shortLabel}. Phân vị volume của toàn cửa sổ so với các cửa sổ lịch sử trong ${data?.vol_days || 'Vol days'} ngày.` : undefined}
                  style={{ ...frameCellStyle(), padding: cellPadding, whiteSpace: compact ? 'normal' : 'nowrap' }}
                >
                  <div style={{ whiteSpace: 'nowrap' }}>
                    <span style={{ color: powerColor, fontWeight: 700 }}>{powerValue == null ? '—' : `${powerValue > 0 ? '+' : ''}${powerValue.toFixed(1)}`}</span>
                    <span style={{ color: shortPowerColor, fontSize: compact ? '9px' : '10px', fontWeight: 700 }}> ({shortPowerValue == null ? '—' : `${shortPowerValue > 0 ? '+' : ''}${shortPowerValue.toFixed(1)}`})</span>
                  </div>
                  {compact && (
                    <div style={{ fontSize: '9px', lineHeight: 1.25, whiteSpace: 'nowrap' }}>
                      <span style={{ color: '#94a3b8' }}>Vol </span>
                      <span style={{ color: volumePercentileColor(longVolumePercentile), fontWeight: 700 }}>{longVolumePercentile == null ? '—' : `${Math.round(longVolumePercentile)}%`}</span>
                      <span style={{ color: '#94a3b8' }}> / </span>
                      <span style={{ color: volumePercentileColor(shortVolumePercentile), fontWeight: 700 }}>{shortVolumePercentile == null ? '—' : `${Math.round(shortVolumePercentile)}%`}</span>
                    </div>
                  )}
                </td>
                {!compact && renderLegacyPercent('momTrend')}
                {!compact && renderLegacyPercent('momFlow')}
                {!compact && renderLegacyPercent('vol_percentile', false)}
                {sessions.map(session => {
                  const stats = item.sessions?.[session.key] || {};
                  return (
                    <td key={session.key} style={{ ...frameCellStyle(), padding: cellPadding, overflow: 'hidden' }}>
                      <SessionPeriodCell period={stats.long} label={longLabel} />
                      <SessionPeriodCell period={stats.short} label={shortLabel} />
                    </td>
                  );
                })}
                <td style={{ ...frameCellStyle(false, true), padding: cellPadding, textAlign: 'right' }}>
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
