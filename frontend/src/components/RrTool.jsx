import React, { useEffect, useRef, useState, useCallback } from 'react';

const RrTool = ({ tool, chart, series, lastUpdateSignal, onDelete, onUpdate }) => {
  const containerRef = useRef(null);
  const targetBoxRef = useRef(null);
  const entryLineRef = useRef(null);
  const stopBoxRef = useRef(null);
  const deleteHintRef = useRef(null);
  const frameRef = useRef(null);
  const latestPropsRef = useRef({ tool, chart, series, onUpdate });
  latestPropsRef.current = { tool, chart, series, onUpdate };

  const [isDragging, setIsDragging] = useState(null);

  const updateCoordinates = useCallback(() => {
    if (!chart || !series || !tool || !containerRef.current) return;

    const hide = () => {
      if (containerRef.current) containerRef.current.style.visibility = 'hidden';
    };

    try {
      const timeScale = chart.timeScale();
      let x1 = null;
      let x2 = null;

      // Anchor to timestamps so the drawing remains attached to its candles.
      if (tool.time) x1 = timeScale.timeToCoordinate(tool.time);

      // Migrate older saved drawings that only have a logical index.
      if (x1 === null && tool.logical != null) {
        x1 = timeScale.logicalToCoordinate(tool.logical);
        if (x1 !== null && !tool.time && onUpdate) {
          const time = timeScale.coordinateToTime(x1);
          if (time) onUpdate(tool.id, { time, endTime: tool.endTime || time + 20 * 300 });
        }
      }

      if (tool.endTime) x2 = timeScale.timeToCoordinate(tool.endTime);

      // Keep the default 20-bar width for drawings whose future end is not in the scale yet.
      if (x1 !== null && x2 === null) {
        const logical = timeScale.coordinateToLogical(x1);
        const barsCount = tool.barsCount || (tool.endLogical && tool.logical ? tool.endLogical - tool.logical : 20);
        if (logical !== null) x2 = timeScale.logicalToCoordinate(logical + barsCount);
        if (x2 === null) {
          const barSpacing = timeScale.options?.().barSpacing || 6;
          x2 = x1 + barsCount * barSpacing;
        }
      }

      if (x1 === null && tool.logical != null) x1 = timeScale.logicalToCoordinate(tool.logical);
      if (x2 === null && tool.endLogical != null) x2 = timeScale.logicalToCoordinate(tool.endLogical);

      const yTarget = series.priceToCoordinate(tool.targetPrice);
      const yEntry = series.priceToCoordinate(tool.entryPrice);
      const yStop = series.priceToCoordinate(tool.stopPrice);
      if (x1 === null || x2 === null || yTarget === null || yEntry === null || yStop === null) {
        hide();
        return;
      }

      const left = Math.min(x1, x2);
      const width = Math.abs(x2 - x1);
      const isLong = tool.type === 'long';
      const targetTop = isLong ? yTarget : yEntry;
      const targetBottom = isLong ? yEntry : yTarget;
      const stopTop = isLong ? yEntry : yStop;
      const stopBottom = isLong ? yStop : yEntry;

      const place = (element, x, y, w, h) => {
        if (!element) return;
        element.style.left = `${x}px`;
        element.style.top = `${y}px`;
        element.style.width = `${Math.max(0, w)}px`;
        element.style.height = `${Math.max(0, h)}px`;
      };

      place(targetBoxRef.current, left, targetTop, width, targetBottom - targetTop);
      place(entryLineRef.current, left, yEntry - 2, width, 4);
      place(stopBoxRef.current, left, stopTop, width, stopBottom - stopTop);
      if (deleteHintRef.current) deleteHintRef.current.style.top = `${Math.min(targetTop, stopTop) - 20}px`;
      containerRef.current.style.visibility = 'visible';
    } catch (e) {
      hide();
    }
  }, [chart, series, tool, onUpdate]);

  const scheduleCoordinateUpdate = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      updateCoordinates();
    });
  }, [updateCoordinates]);

  useEffect(() => {
    if (!chart) return undefined;

    const timeScale = chart.timeScale();
    scheduleCoordinateUpdate();
    timeScale.subscribeVisibleLogicalRangeChange(scheduleCoordinateUpdate);
    timeScale.subscribeVisibleTimeRangeChange(scheduleCoordinateUpdate);

    let resizeObserver;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(scheduleCoordinateUpdate);
      resizeObserver.observe(chart.chartElement());
    }

    return () => {
      timeScale.unsubscribeVisibleLogicalRangeChange(scheduleCoordinateUpdate);
      timeScale.unsubscribeVisibleTimeRangeChange(scheduleCoordinateUpdate);
      resizeObserver?.disconnect();
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [chart, lastUpdateSignal, scheduleCoordinateUpdate]);

  // Handle dragging without recreating document listeners on each price update.
  useEffect(() => {
    if (!isDragging || !chart || !series) return undefined;

    const handleMouseMove = event => {
      const current = latestPropsRef.current;
      const rect = chart.chartElement().getBoundingClientRect();
      const price = series.coordinateToPrice(event.clientY - rect.top);
      if (price == null) return;

      const field = isDragging === 'target' ? 'targetPrice'
        : isDragging === 'stop' ? 'stopPrice'
          : isDragging === 'entry' ? 'entryPrice' : null;
      if (field) current.onUpdate(current.tool.id, { [field]: price });
    };

    const handleMouseUp = () => setIsDragging(null);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, chart, series]);

  const isLong = tool.type === 'long';
  const risk = Math.abs(tool.entryPrice - tool.stopPrice);
  const reward = Math.abs(tool.targetPrice - tool.entryPrice);
  const rrRatio = risk > 0 ? (reward / risk).toFixed(2) : '∞';

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        visibility: 'hidden',
        zIndex: 50
      }}
    >
      {/* TARGET BOX (Green) */}
      <div
        ref={targetBoxRef}
        style={{
          position: 'absolute',
          background: 'rgba(8, 153, 129, 0.2)',
          borderTop: isLong ? '2px solid rgba(8, 153, 129, 0.8)' : 'none',
          borderBottom: !isLong ? '2px solid rgba(8, 153, 129, 0.8)' : 'none',
          borderLeft: '1px solid rgba(8, 153, 129, 0.3)',
          borderRight: '1px solid rgba(8, 153, 129, 0.3)',
          pointerEvents: 'auto',
          cursor: 'pointer'
        }}
        onMouseDown={event => { event.stopPropagation(); setIsDragging('target'); }}
        onContextMenu={event => { event.preventDefault(); onDelete(); }}
      >
        <div style={{ position: 'absolute', top: '-25px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(8, 153, 129, 0.9)', color: 'white', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', whiteSpace: 'nowrap' }}>
          Target: {tool.targetPrice.toFixed(5)}
        </div>
      </div>

      {/* ENTRY LINE */}
      <div
        ref={entryLineRef}
        style={{
          position: 'absolute',
          background: 'transparent',
          pointerEvents: 'auto',
          cursor: 'ns-resize',
          zIndex: 51
        }}
        onMouseDown={event => { event.stopPropagation(); setIsDragging('entry'); }}
        onContextMenu={event => { event.preventDefault(); onDelete(); }}
      >
        <div style={{ position: 'absolute', top: 2, left: 0, width: '100%', height: '1px', background: 'rgba(120, 123, 134, 1)' }} />
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'rgba(30, 34, 45, 0.9)', color: 'white', border: '1px solid #787b86', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', whiteSpace: 'nowrap', zIndex: 52 }}>
          RR: {rrRatio} | Risk: {risk.toFixed(5)}
        </div>
      </div>

      {/* STOP BOX (Red) */}
      <div
        ref={stopBoxRef}
        style={{
          position: 'absolute',
          background: 'rgba(242, 54, 69, 0.2)',
          borderTop: !isLong ? '2px solid rgba(242, 54, 69, 0.8)' : 'none',
          borderBottom: isLong ? '2px solid rgba(242, 54, 69, 0.8)' : 'none',
          borderLeft: '1px solid rgba(242, 54, 69, 0.3)',
          borderRight: '1px solid rgba(242, 54, 69, 0.3)',
          pointerEvents: 'auto',
          cursor: 'pointer'
        }}
        onMouseDown={event => { event.stopPropagation(); setIsDragging('stop'); }}
        onContextMenu={event => { event.preventDefault(); onDelete(); }}
      >
        <div style={{ position: 'absolute', bottom: '-25px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(242, 54, 69, 0.9)', color: 'white', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', whiteSpace: 'nowrap' }}>
          Stop: {tool.stopPrice.toFixed(5)}
        </div>
      </div>

      <div ref={deleteHintRef} style={{ position: 'absolute', right: 0, background: 'rgba(0,0,0,0.5)', color: '#ccc', fontSize: '9px', padding: '1px 3px', pointerEvents: 'none' }}>
        Right-click to delete
      </div>
    </div>
  );
};

export default RrTool;
