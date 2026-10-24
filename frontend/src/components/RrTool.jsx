import React, { useEffect, useRef, useState, useCallback } from 'react';

const RrTool = ({ tool, chart, series, lastUpdateSignal, onUpdate, onRequestContextMenu }) => {
  const containerRef = useRef(null);
  const targetBoxRef = useRef(null);
  const targetDragRef = useRef(null);
  const entryLineRef = useRef(null);
  const stopBoxRef = useRef(null);
  const stopDragRef = useRef(null);
  const startHandleRef = useRef(null);
  const endHandleRef = useRef(null);
  const moveHandleRef = useRef(null);
  const deleteHintRef = useRef(null);
  const frameRef = useRef(null);
  const latestPropsRef = useRef({ tool, chart, series, onUpdate });
  latestPropsRef.current = { tool, chart, series, onUpdate };

  const [isDragging, setIsDragging] = useState(null);
  const [isHovered, setIsHovered] = useState(false);

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
      const boxTop = Math.min(targetTop, stopTop);
      const boxBottom = Math.max(targetBottom, stopBottom);
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
      // Give the SL/TP boundaries a generous hit area so users can drag the
      // price levels directly without accidentally moving the whole RR box.
      place(targetDragRef.current, left, yTarget - 7, width, 14);
      place(stopDragRef.current, left, yStop - 7, width, 14);
      // Keep the horizontal resize hit areas while leaving the edge grips invisible.
      place(startHandleRef.current, left - 6, boxTop, 12, boxBottom - boxTop);
      place(endHandleRef.current, left + width - 6, boxTop, 12, boxBottom - boxTop);
      // Keep the whole-box drag handle close to entry instead of centered
      // between SL and TP, where it can be far away on a tall RR drawing.
      place(moveHandleRef.current, left + width - 28, yEntry - 26, 20, 20);
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
      if (typeof isDragging === 'object' && isDragging.type === 'move') {
        const timeScale = chart.timeScale();
        const pointerLogical = timeScale.coordinateToLogical(event.clientX - rect.left);
        const pointerPrice = series.coordinateToPrice(event.clientY - rect.top);
        if (pointerLogical == null || pointerPrice == null) return;

        const original = isDragging.toolSnapshot;
        const originalStartLogical = Number.isFinite(original.logical)
          ? original.logical
          : timeScale.coordinateToLogical(timeScale.timeToCoordinate(original.time));
        const originalEndLogical = Number.isFinite(original.endLogical)
          ? original.endLogical
          : timeScale.coordinateToLogical(timeScale.timeToCoordinate(original.endTime));
        if (!Number.isFinite(originalStartLogical) || !Number.isFinite(originalEndLogical)) return;

        const deltaLogical = Math.round(pointerLogical) - isDragging.initialLogical;
        const startLogical = Math.round(originalStartLogical + deltaLogical);
        const endLogical = Math.round(originalEndLogical + deltaLogical);
        const getTime = logical => {
          const x = timeScale.logicalToCoordinate(logical);
          const rawTime = x == null ? null : timeScale.coordinateToTime(x);
          if (typeof rawTime === 'number') return Math.floor(rawTime);
          if (rawTime && typeof rawTime === 'object') return Math.floor(Date.UTC(rawTime.year, rawTime.month - 1, rawTime.day) / 1000);
          return null;
        };
        const time = getTime(startLogical);
        const endTime = getTime(endLogical);
        if (time == null || endTime == null) return;

        const deltaPrice = pointerPrice - isDragging.initialPrice;
        current.onUpdate(current.tool.id, {
          time,
          endTime,
          logical: startLogical,
          endLogical,
          barsCount: Math.max(1, endLogical - startLogical),
          entryPrice: original.entryPrice + deltaPrice,
          targetPrice: original.targetPrice + deltaPrice,
          stopPrice: original.stopPrice + deltaPrice,
        });
        return;
      }

      if (isDragging === 'start' || isDragging === 'end') {
        const timeScale = chart.timeScale();
        const pointerX = event.clientX - rect.left;
        const pointerLogical = timeScale.coordinateToLogical(pointerX);
        if (pointerLogical == null) return;

        let startX = current.tool.time ? timeScale.timeToCoordinate(current.tool.time) : null;
        if (startX == null && current.tool.logical != null) startX = timeScale.logicalToCoordinate(current.tool.logical);
        let endX = current.tool.endTime ? timeScale.timeToCoordinate(current.tool.endTime) : null;
        if (endX == null && current.tool.endLogical != null) endX = timeScale.logicalToCoordinate(current.tool.endLogical);
        if (endX == null && startX != null) {
          const startLogicalForFallback = timeScale.coordinateToLogical(startX);
          const barsCount = current.tool.barsCount || 20;
          if (startLogicalForFallback != null) endX = timeScale.logicalToCoordinate(startLogicalForFallback + barsCount);
        }
        if (startX == null || endX == null) return;

        const startPosition = timeScale.coordinateToLogical(startX);
        const endPosition = timeScale.coordinateToLogical(endX);
        if (startPosition == null || endPosition == null) return;
        const startLogical = Math.round(startPosition);
        const endLogical = Math.round(endPosition);
        const logical = isDragging === 'start'
          ? Math.min(Math.round(pointerLogical), endLogical - 1)
          : Math.max(Math.round(pointerLogical), startLogical + 1);
        const snappedX = timeScale.logicalToCoordinate(logical);
        const time = snappedX == null ? null : timeScale.coordinateToTime(snappedX);
        if (time == null) return;

        const unixTime = typeof time === 'number'
          ? time
          : Math.floor(Date.UTC(time.year, time.month - 1, time.day) / 1000);
        if (isDragging === 'start') {
          current.onUpdate(current.tool.id, {
            time: unixTime,
            logical,
            barsCount: Math.max(1, endLogical - logical)
          });
        } else {
          current.onUpdate(current.tool.id, {
            endTime: unixTime,
            endLogical: logical,
            barsCount: Math.max(1, logical - startLogical)
          });
        }
        return;
      }

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
  const startWholeMove = event => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (!chart || !series) return;
    const rect = chart.chartElement().getBoundingClientRect();
    const timeScale = chart.timeScale();
    const initialLogical = timeScale.coordinateToLogical(event.clientX - rect.left);
    const initialPrice = series.coordinateToPrice(event.clientY - rect.top);
    if (initialLogical == null || initialPrice == null) return;
    setIsDragging({ type: 'move', initialLogical: Math.round(initialLogical), initialPrice, toolSnapshot: tool });
  };
  const openContextMenu = event => {
    event.preventDefault();
    event.stopPropagation();
    onRequestContextMenu?.(event, tool);
  };

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
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
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
          cursor: 'ns-resize'
        }}
        title="Kéo bất kỳ đâu trong vùng xanh để chỉnh TP; giữ Shift để di chuyển toàn bộ RR"
        onMouseDown={event => {
          event.stopPropagation();
          if (event.button !== 0) return;
          if (event.shiftKey) startWholeMove(event);
          else setIsDragging('target');
        }}
        onContextMenu={openContextMenu}
      >
        <div style={{ position: 'absolute', top: '-34px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(8, 153, 129, 0.9)', color: 'white', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', whiteSpace: 'nowrap', opacity: isHovered ? 1 : 0, visibility: isHovered ? 'visible' : 'hidden', pointerEvents: 'none', transition: 'opacity 100ms ease' }}>
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
          cursor: 'move',
          zIndex: 51
        }}
        title="Kéo để di chuyển toàn bộ RR; giữ Shift để chỉnh riêng điểm vào"
        onMouseDown={event => {
          event.stopPropagation();
          if (event.button !== 0) return;
          if (event.shiftKey) setIsDragging('entry');
          else startWholeMove(event);
        }}
        onContextMenu={openContextMenu}
      >
        <div style={{ position: 'absolute', top: 2, left: 0, width: '100%', height: '1px', background: 'rgba(120, 123, 134, 1)' }} />
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'rgba(30, 34, 45, 0.9)', color: 'white', border: '1px solid #787b86', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', whiteSpace: 'nowrap', zIndex: 52, opacity: isHovered ? 1 : 0, visibility: isHovered ? 'visible' : 'hidden', pointerEvents: 'none', transition: 'opacity 100ms ease' }}>
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
          cursor: 'ns-resize'
        }}
        title="Kéo bất kỳ đâu trong vùng đỏ để chỉnh SL; giữ Shift để di chuyển toàn bộ RR"
        onMouseDown={event => {
          event.stopPropagation();
          if (event.button !== 0) return;
          if (event.shiftKey) startWholeMove(event);
          else setIsDragging('stop');
        }}
        onContextMenu={openContextMenu}
      >
        <div style={{ position: 'absolute', bottom: '-34px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(242, 54, 69, 0.9)', color: 'white', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', whiteSpace: 'nowrap', opacity: isHovered ? 1 : 0, visibility: isHovered ? 'visible' : 'hidden', pointerEvents: 'none', transition: 'opacity 100ms ease' }}>
          Stop: {tool.stopPrice.toFixed(5)}
        </div>
      </div>

      {/* Dedicated, wider hit areas for the price boundaries. */}
      <div
        ref={targetDragRef}
        title="Kéo để chỉnh mức chốt lời (TP); giữ Shift để di chuyển toàn bộ RR"
        style={{ position: 'absolute', zIndex: 52, pointerEvents: 'auto', cursor: 'ns-resize', background: 'transparent' }}
        onMouseDown={event => {
          event.preventDefault();
          event.stopPropagation();
          if (event.button === 0) {
            if (event.shiftKey) startWholeMove(event);
            else setIsDragging('target');
          }
        }}
        onContextMenu={openContextMenu}
      />
      <div
        ref={stopDragRef}
        title="Kéo để chỉnh mức dừng lỗ (SL); giữ Shift để di chuyển toàn bộ RR"
        style={{ position: 'absolute', zIndex: 52, pointerEvents: 'auto', cursor: 'ns-resize', background: 'transparent' }}
        onMouseDown={event => {
          event.preventDefault();
          event.stopPropagation();
          if (event.button === 0) {
            if (event.shiftKey) startWholeMove(event);
            else setIsDragging('stop');
          }
        }}
        onContextMenu={openContextMenu}
      />

      {/* Invisible edge hit areas retain horizontal/time resizing without visible grips. */}
      <div
        ref={startHandleRef}
        title="Kéo để đổi thời điểm bắt đầu"
        style={{ position: 'absolute', zIndex: 53, pointerEvents: 'auto', cursor: 'ew-resize', background: 'transparent' }}
        onMouseDown={event => { event.stopPropagation(); if (event.button === 0) setIsDragging('start'); }}
        onContextMenu={openContextMenu}
      />
      <div
        ref={endHandleRef}
        title="Kéo để đổi thời điểm kết thúc"
        style={{ position: 'absolute', zIndex: 53, pointerEvents: 'auto', cursor: 'ew-resize', background: 'transparent' }}
        onMouseDown={event => { event.stopPropagation(); if (event.button === 0) setIsDragging('end'); }}
        onContextMenu={openContextMenu}
      />

      <div
        ref={moveHandleRef}
        title="Nhấn giữ và kéo để di chuyển toàn bộ RR"
        style={{ position: 'absolute', zIndex: 54, pointerEvents: 'auto', cursor: 'move', borderRadius: '50%', border: '1px solid #67e8f9', background: 'rgba(8,47,73,0.92)', color: '#cffafe', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '12px', fontWeight: 700, boxShadow: '0 0 8px rgba(34,211,238,0.65)', opacity: isHovered ? 1 : 0, visibility: isHovered ? 'visible' : 'hidden', transition: 'opacity 100ms ease' }}
        onMouseDown={startWholeMove}
        onContextMenu={openContextMenu}
      >✥</div>

      <div ref={deleteHintRef} style={{ position: 'absolute', right: 0, background: 'rgba(0,0,0,0.5)', color: '#ccc', fontSize: '9px', padding: '1px 3px', pointerEvents: 'none', opacity: isHovered ? 1 : 0, visibility: isHovered ? 'visible' : 'hidden', transition: 'opacity 100ms ease' }}>
        Nhấp phải để sao chép hoặc xóa
      </div>
    </div>
  );
};

export default RrTool;
