import React, { useEffect, useState } from 'react';

const FIB_LEVELS = [
  { ratio: 0, color: '#f8fafc' },
  { ratio: 0.236, color: '#f59e0b' },
  { ratio: 0.382, color: '#f97316' },
  { ratio: 0.5, color: '#a78bfa' },
  { ratio: 0.618, color: '#38bdf8' },
  { ratio: 0.786, color: '#34d399' },
  { ratio: 1, color: '#f8fafc' },
];

const getPricePrecision = symbol => {
  if (symbol?.includes('JPY') || symbol?.includes('XAG')) return 3;
  if (/XAU|GOLD|BTC|ETH|SOL/.test(symbol || '')) return 2;
  return 5;
};

const formatPrice = (price, symbol) => Number(price).toFixed(getPricePrecision(symbol));

export const ChartDrawingOverlay = ({ chart, series, drawings = [], symbol, lastUpdateSignal, onDelete }) => {
  // This revision makes the projected SVG coordinates recalculate after a
  // pan, zoom, resize, or chart data update.
  const [, setLayoutRevision] = useState(0);

  useEffect(() => {
    if (!chart) return undefined;
    const timeScale = chart.timeScale();
    const update = () => setLayoutRevision(value => value + 1);
    timeScale.subscribeVisibleLogicalRangeChange(update);
    timeScale.subscribeVisibleTimeRangeChange(update);
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(update)
      : null;
    const element = chart.chartElement?.();
    if (element) observer?.observe(element);
    update();
    return () => {
      timeScale.unsubscribeVisibleLogicalRangeChange(update);
      timeScale.unsubscribeVisibleTimeRangeChange(update);
      observer?.disconnect();
    };
  }, [chart, lastUpdateSignal]);

  if (!chart || !series || !drawings.length) return null;
  const element = chart.chartElement?.();
  if (!element) return null;
  const width = element.clientWidth;
  const height = element.clientHeight;
  if (!width || !height) return null;

  const timeScale = chart.timeScale();
  const project = point => {
    if (!point || !Number.isFinite(Number(point.time)) || !Number.isFinite(Number(point.price))) return null;
    const x = timeScale.timeToCoordinate(Number(point.time));
    const y = series.priceToCoordinate(Number(point.price));
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  };

  return (
    <svg
      aria-label="Bản vẽ trên biểu đồ"
      width={width}
      height={height}
      style={{ position: 'absolute', top: 0, left: 0, zIndex: 7, overflow: 'hidden', pointerEvents: 'none' }}
    >
      {drawings.map(drawing => {
        const start = project(drawing.start);
        const end = project(drawing.end);
        if (!start || !end) return null;
        const left = Math.min(start.x, end.x);
        const right = Math.max(start.x, end.x);
        const deleteX = Math.max(10, Math.min(width - 10, right));
        const deleteY = Math.max(10, Math.min(height - 10, Math.min(start.y, end.y) - 10));

        if (drawing.type === 'fibonacci') {
          const priceRange = Number(drawing.end.price) - Number(drawing.start.price);
          return (
            <g key={drawing.id}>
              {FIB_LEVELS.map(({ ratio, color }) => {
                const price = Number(drawing.end.price) - priceRange * ratio;
                const y = series.priceToCoordinate(price);
                if (!Number.isFinite(y)) return null;
                const labelWidth = 110;
                const labelX = Math.max(2, Math.min(width - labelWidth - 2, right + 5));
                return (
                  <g key={ratio}>
                    <line x1={left} y1={y} x2={right} y2={y} stroke={color} strokeWidth={ratio === 0 || ratio === 1 ? 1.3 : 1} strokeDasharray={ratio === 0 || ratio === 1 ? undefined : '4 3'} opacity="0.9" />
                    <rect x={labelX} y={y - 9} width={labelWidth} height="18" rx="4" fill="rgba(2,6,23,0.86)" stroke={color} strokeOpacity="0.55" />
                    <text x={labelX + 5} y={y + 3.5} fill={color} fontSize="10" fontWeight="700" fontFamily="sans-serif">
                      {`${(ratio * 100).toFixed(1)}%  ${formatPrice(price, symbol)}`}
                    </text>
                  </g>
                );
              })}
              <g
                role="button"
                aria-label="Xóa Fibonacci"
                tabIndex="0"
                style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                onClick={event => { event.stopPropagation(); onDelete?.(drawing.id); }}
                onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') onDelete?.(drawing.id); }}
              >
                <circle cx={deleteX} cy={deleteY} r="8" fill="#7f1d1d" stroke="#fecaca" />
                <text x={deleteX} y={deleteY + 3.5} textAnchor="middle" fill="white" fontSize="11" fontWeight="700">×</text>
              </g>
            </g>
          );
        }

        if (drawing.type === 'percent') {
          const delta = Number(drawing.end.price) - Number(drawing.start.price);
          const percent = Number(drawing.start.price) !== 0 ? delta / Number(drawing.start.price) * 100 : 0;
          const color = delta >= 0 ? '#34d399' : '#fb7185';
          const top = Math.min(start.y, end.y);
          const boxWidth = Math.max(2, Math.abs(end.x - start.x));
          const boxHeight = Math.max(2, Math.abs(end.y - start.y));
          const labelWidth = 168;
          const labelX = Math.max(2, Math.min(width - labelWidth - 2, right + 8));
          const labelY = Math.max(4, Math.min(height - 38, end.y - 18));
          const bars = Math.abs(Number(drawing.end.logical || 0) - Number(drawing.start.logical || 0));
          const signedPercent = `${percent > 0 ? '+' : ''}${percent.toFixed(2)}%`;
          const signedDelta = `${delta > 0 ? '+' : ''}${formatPrice(delta, symbol)}`;
          return (
            <g key={drawing.id}>
              <rect x={left} y={top} width={boxWidth} height={boxHeight} fill={color} fillOpacity="0.12" stroke={color} strokeWidth="1.2" strokeDasharray="5 3" />
              <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={color} strokeWidth="1.2" />
              <circle cx={start.x} cy={start.y} r="3" fill={color} />
              <circle cx={end.x} cy={end.y} r="3" fill={color} />
              <rect x={labelX} y={labelY} width={labelWidth} height="34" rx="5" fill="rgba(2,6,23,0.93)" stroke={color} />
              <text x={labelX + 7} y={labelY + 14} fill={color} fontSize="11" fontWeight="700" fontFamily="sans-serif">
                {`${signedPercent}  (Δ ${signedDelta})`}
              </text>
              <text x={labelX + 7} y={labelY + 27} fill="#cbd5e1" fontSize="9" fontFamily="sans-serif">
                {`${bars.toFixed(0)} nến · ${formatPrice(drawing.start.price, symbol)} → ${formatPrice(drawing.end.price, symbol)}`}
              </text>
              <g
                role="button"
                aria-label="Xóa hộp đo phần trăm"
                tabIndex="0"
                style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                onClick={event => { event.stopPropagation(); onDelete?.(drawing.id); }}
                onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') onDelete?.(drawing.id); }}
              >
                <circle cx={deleteX} cy={deleteY} r="8" fill="#7f1d1d" stroke="#fecaca" />
                <text x={deleteX} y={deleteY + 3.5} textAnchor="middle" fill="white" fontSize="11" fontWeight="700">×</text>
              </g>
            </g>
          );
        }
        return null;
      })}
    </svg>
  );
};

export default ChartDrawingOverlay;
