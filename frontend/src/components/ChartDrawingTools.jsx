import React, { useEffect, useRef, useState } from 'react';

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

export const ChartDrawingOverlay = ({ chart, series, drawings = [], symbol, lastUpdateSignal, onUpdate, onRequestContextMenu }) => {
  // This revision makes the projected SVG coordinates recalculate after a
  // pan, zoom, resize, or chart data update.
  const [, setLayoutRevision] = useState(0);
  const [dragging, setDragging] = useState(null);
  const latestPropsRef = useRef({ chart, series, onUpdate });
  latestPropsRef.current = { chart, series, onUpdate };

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

  useEffect(() => {
    if (!dragging) return undefined;

    const handleMouseMove = event => {
      const { chart: activeChart, series: activeSeries, onUpdate: updateDrawing } = latestPropsRef.current;
      const element = activeChart?.chartElement?.();
      if (!element || !activeSeries || !updateDrawing) return;

      const rect = element.getBoundingClientRect();
      const timeScale = activeChart.timeScale();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const rawLogical = timeScale.coordinateToLogical(pointerX);
      const price = activeSeries.coordinateToPrice(pointerY);
      if (rawLogical == null || price == null || !Number.isFinite(price)) return;

      const logical = Math.round(rawLogical);
      const makeAnchor = (anchor, nextLogical, nextPrice) => {
        const snappedX = timeScale.logicalToCoordinate(nextLogical);
        const rawTime = snappedX == null ? null : timeScale.coordinateToTime(snappedX);
        const time = typeof rawTime === 'number'
          ? Math.floor(rawTime)
          : rawTime && typeof rawTime === 'object'
            ? Math.floor(Date.UTC(rawTime.year, rawTime.month - 1, rawTime.day) / 1000)
            : null;
        if (!Number.isFinite(time)) return null;
        return { ...anchor, time, price: nextPrice, logical: nextLogical };
      };

      if (dragging.mode === 'move') {
        const deltaLogical = logical - dragging.initialLogical;
        const deltaPrice = price - dragging.initialPrice;
        const startLogical = Number.isFinite(dragging.start.logical)
          ? dragging.start.logical
          : timeScale.coordinateToLogical(timeScale.timeToCoordinate(dragging.start.time));
        const endLogical = Number.isFinite(dragging.end.logical)
          ? dragging.end.logical
          : timeScale.coordinateToLogical(timeScale.timeToCoordinate(dragging.end.time));
        if (!Number.isFinite(startLogical) || !Number.isFinite(endLogical)) return;
        const start = makeAnchor(dragging.start, Math.round(startLogical + deltaLogical), dragging.start.price + deltaPrice);
        const end = makeAnchor(dragging.end, Math.round(endLogical + deltaLogical), dragging.end.price + deltaPrice);
        if (start && end) updateDrawing(dragging.drawingId, { start, end });
        return;
      }

      const snappedX = timeScale.logicalToCoordinate(logical);
      const rawTime = snappedX == null ? null : timeScale.coordinateToTime(snappedX);
      const time = typeof rawTime === 'number'
        ? Math.floor(rawTime)
        : rawTime && typeof rawTime === 'object'
          ? Math.floor(Date.UTC(rawTime.year, rawTime.month - 1, rawTime.day) / 1000)
          : null;
      if (!Number.isFinite(time)) return;
      updateDrawing(dragging.drawingId, { [dragging.endpoint]: { time, price, logical } });
    };

    const handleMouseUp = () => setDragging(null);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging]);

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
  const handleDragStart = (event, drawingId, endpoint) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setDragging({ mode: 'endpoint', drawingId, endpoint });
  };
  const handleMoveStart = (event, drawing) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = element.getBoundingClientRect();
    const initialLogical = timeScale.coordinateToLogical(event.clientX - rect.left);
    const initialPrice = series.coordinateToPrice(event.clientY - rect.top);
    if (initialLogical == null || initialPrice == null) return;
    setDragging({
      mode: 'move',
      drawingId: drawing.id,
      initialLogical: Math.round(initialLogical),
      initialPrice,
      start: drawing.start,
      end: drawing.end,
    });
  };
  const handleOpenContextMenu = (event, drawing) => {
    event.preventDefault();
    event.stopPropagation();
    onRequestContextMenu?.(event, drawing);
  };
  const renderAnchorHandle = (drawing, endpoint, point, color) => (
    <g key={`${drawing.id}-${endpoint}`}>
      <circle
        cx={point.x}
        cy={point.y}
        r="10"
        fill="rgba(34,211,238,0.12)"
        stroke="rgba(34,211,238,0.85)"
        strokeWidth="1.5"
        style={{ pointerEvents: 'all', cursor: 'move' }}
        onMouseDown={event => handleDragStart(event, drawing.id, endpoint)}
        onContextMenu={event => handleOpenContextMenu(event, drawing)}
        aria-label={`Kéo đầu mút ${endpoint === 'start' ? 'bắt đầu' : 'kết thúc'}`}
      />
      <circle cx={point.x} cy={point.y} r="3" fill={color} pointerEvents="none" />
    </g>
  );

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
        if (drawing.type === 'fibonacci') {
          const priceRange = Number(drawing.end.price) - Number(drawing.start.price);
          return (
            <g key={drawing.id}>
              <rect
                x={left}
                y={Math.min(start.y, end.y)}
                width={Math.max(2, right - left)}
                height={Math.max(2, Math.abs(end.y - start.y))}
                fill="transparent"
                style={{ pointerEvents: 'all', cursor: 'move' }}
                onMouseDown={event => handleMoveStart(event, drawing)}
                onContextMenu={event => handleOpenContextMenu(event, drawing)}
              />
              {FIB_LEVELS.map(({ ratio, color }) => {
                const price = Number(drawing.end.price) - priceRange * ratio;
                const y = series.priceToCoordinate(price);
                if (!Number.isFinite(y)) return null;
                const labelWidth = 110;
                const labelX = Math.max(2, Math.min(width - labelWidth - 2, right + 5));
                return (
                  <g key={ratio}>
                    <line
                      x1={left} y1={y} x2={right} y2={y}
                      stroke={color}
                      strokeWidth={ratio === 0 || ratio === 1 ? 1.3 : 1}
                      strokeDasharray={ratio === 0 || ratio === 1 ? undefined : '4 3'}
                      opacity="0.9"
                      style={{ pointerEvents: 'stroke', cursor: 'move' }}
                      onMouseDown={event => handleMoveStart(event, drawing)}
                      onContextMenu={event => handleOpenContextMenu(event, drawing)}
                    />
                    <rect
                      x={labelX} y={y - 9} width={labelWidth} height="18" rx="4"
                      fill="rgba(2,6,23,0.86)" stroke={color} strokeOpacity="0.55"
                      style={{ pointerEvents: 'all', cursor: 'move' }}
                      onMouseDown={event => handleMoveStart(event, drawing)}
                      onContextMenu={event => handleOpenContextMenu(event, drawing)}
                    />
                    <text x={labelX + 5} y={y + 3.5} fill={color} fontSize="10" fontWeight="700" fontFamily="sans-serif" pointerEvents="none">
                      {`${(ratio * 100).toFixed(1)}%  ${formatPrice(price, symbol)}`}
                    </text>
                  </g>
                );
              })}
              {renderAnchorHandle(drawing, 'start', start, '#f8fafc')}
              {renderAnchorHandle(drawing, 'end', end, '#f8fafc')}
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
              <rect
                x={left} y={top} width={boxWidth} height={boxHeight}
                fill={color} fillOpacity="0.12" stroke={color} strokeWidth="1.2" strokeDasharray="5 3"
                style={{ pointerEvents: 'all', cursor: 'move' }}
                onMouseDown={event => handleMoveStart(event, drawing)}
                onContextMenu={event => handleOpenContextMenu(event, drawing)}
              />
              <line
                x1={start.x} y1={start.y} x2={end.x} y2={end.y}
                stroke={color} strokeWidth="1.2"
                style={{ pointerEvents: 'stroke', cursor: 'move' }}
                onMouseDown={event => handleMoveStart(event, drawing)}
                onContextMenu={event => handleOpenContextMenu(event, drawing)}
              />
              <rect
                x={labelX} y={labelY} width={labelWidth} height="34" rx="5"
                fill="rgba(2,6,23,0.93)" stroke={color}
                style={{ pointerEvents: 'all', cursor: 'move' }}
                onMouseDown={event => handleMoveStart(event, drawing)}
                onContextMenu={event => handleOpenContextMenu(event, drawing)}
              />
              <text x={labelX + 7} y={labelY + 14} fill={color} fontSize="11" fontWeight="700" fontFamily="sans-serif" pointerEvents="none">
                {`${signedPercent}  (Δ ${signedDelta})`}
              </text>
              <text x={labelX + 7} y={labelY + 27} fill="#cbd5e1" fontSize="9" fontFamily="sans-serif" pointerEvents="none">
                {`${bars.toFixed(0)} nến · ${formatPrice(drawing.start.price, symbol)} → ${formatPrice(drawing.end.price, symbol)}`}
              </text>
              {renderAnchorHandle(drawing, 'start', start, color)}
              {renderAnchorHandle(drawing, 'end', end, color)}
            </g>
          );
        }
        return null;
      })}
    </svg>
  );
};

export default ChartDrawingOverlay;
