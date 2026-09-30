import React, { useEffect, useRef, useState, useCallback } from 'react';

const RrTool = ({ tool, chart, series, onDelete, onUpdate }) => {
  const containerRef = useRef(null);
  
  const [coords, setCoords] = useState({
    x1: 0,
    x2: 0,
    yTarget: 0,
    yEntry: 0,
    yStop: 0,
    visible: false
  });

  const [isDragging, setIsDragging] = useState(null); // 'target', 'entry', 'stop', 'body'

  // We need a helper to normalize time since Lightweight Charts uses numbers for timestamps
  const timeToPrimitive = (timeObj) => {
    if (typeof timeObj === 'number') return timeObj;
    if (timeObj && typeof timeObj === 'object') {
      return timeObj.timestamp || new Date(`${timeObj.year}-${timeObj.month}-${timeObj.day}`).getTime() / 1000;
    }
    return 0;
  };

  const updateCoordinates = useCallback(() => {
    if (!chart || !series || !tool) return;
    try {
      const timeScale = chart.timeScale();
      const x1 = timeScale.timeToCoordinate(tool.time);
      const x2 = timeScale.timeToCoordinate(tool.endTime);
      
      const yTarget = series.priceToCoordinate(tool.targetPrice);
      const yEntry = series.priceToCoordinate(tool.entryPrice);
      const yStop = series.priceToCoordinate(tool.stopPrice);

      if (x1 !== null && x2 !== null && yTarget !== null && yEntry !== null && yStop !== null) {
        setCoords({
          x1: Math.min(x1, x2),
          x2: Math.max(x1, x2),
          yTarget,
          yEntry,
          yStop,
          visible: true
        });
      } else {
        setCoords(prev => ({ ...prev, visible: false }));
      }
    } catch (e) {
      setCoords(prev => ({ ...prev, visible: false }));
    }
  }, [chart, series, tool]);

  useEffect(() => {
    if (!chart) return;
    
    updateCoordinates();
    
    const timeScale = chart.timeScale();
    timeScale.subscribeVisibleLogicalRangeChange(updateCoordinates);
    timeScale.subscribeVisibleTimeRangeChange(updateCoordinates);
    
    // There is no direct event for price scale change in v4, but usually logic range/crosshair handles most.
    // To be safe, we can add a rough resize observer or interval, but logical range handles pan/zoom.

    return () => {
      timeScale.unsubscribeVisibleLogicalRangeChange(updateCoordinates);
      timeScale.unsubscribeVisibleTimeRangeChange(updateCoordinates);
    };
  }, [chart, updateCoordinates]);

  // Handle Dragging
  useEffect(() => {
    if (!isDragging || !chart || !series) return;

    const handleMouseMove = (e) => {
      const rect = chart.chartElement().getBoundingClientRect();
      const y = e.clientY - rect.top;
      
      const price = series.coordinateToPrice(y);
      if (price === null) return;

      if (isDragging === 'target') {
        onUpdate(tool.id, { targetPrice: price });
      } else if (isDragging === 'stop') {
        onUpdate(tool.id, { stopPrice: price });
      } else if (isDragging === 'entry') {
        onUpdate(tool.id, { entryPrice: price });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, chart, series, onUpdate, tool.id]);


  if (!coords.visible) return null;

  const isLong = tool.type === 'long';
  
  // For Long: Target is above Entry, Stop is below Entry
  // Y coordinates increase downwards!
  const targetTop = isLong ? coords.yTarget : coords.yEntry;
  const targetBottom = isLong ? coords.yEntry : coords.yTarget;
  
  const stopTop = isLong ? coords.yEntry : coords.yStop;
  const stopBottom = isLong ? coords.yStop : coords.yEntry;
  
  const targetHeight = Math.max(0, targetBottom - targetTop);
  const stopHeight = Math.max(0, stopBottom - stopTop);

  const risk = Math.abs(tool.entryPrice - tool.stopPrice);
  const reward = Math.abs(tool.targetPrice - tool.entryPrice);
  const rrRatio = risk > 0 ? (reward / risk).toFixed(2) : '∞';

  const width = coords.x2 - coords.x1;
  const left = coords.x1;

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
        zIndex: 50
      }}
    >
      {/* TARGET BOX (Green) */}
      <div 
        style={{
          position: 'absolute',
          left: left,
          top: targetTop,
          width: width,
          height: targetHeight,
          background: 'rgba(8, 153, 129, 0.2)',
          borderTop: isLong ? '2px solid rgba(8, 153, 129, 0.8)' : 'none',
          borderBottom: !isLong ? '2px solid rgba(8, 153, 129, 0.8)' : 'none',
          borderLeft: '1px solid rgba(8, 153, 129, 0.3)',
          borderRight: '1px solid rgba(8, 153, 129, 0.3)',
          pointerEvents: 'auto',
          cursor: 'pointer'
        }}
        onMouseDown={(e) => { e.stopPropagation(); setIsDragging('target'); }}
        onContextMenu={(e) => { e.preventDefault(); onDelete(); }}
      >
        <div style={{ position: 'absolute', top: '-25px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(8, 153, 129, 0.9)', color: 'white', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', whiteSpace: 'nowrap' }}>
          Target: {tool.targetPrice.toFixed(5)}
        </div>
      </div>

      {/* ENTRY LINE */}
      <div 
        style={{
          position: 'absolute',
          left: left,
          top: coords.yEntry - 2,
          width: width,
          height: 4,
          background: 'transparent',
          pointerEvents: 'auto',
          cursor: 'ns-resize',
          zIndex: 51
        }}
        onMouseDown={(e) => { e.stopPropagation(); setIsDragging('entry'); }}
        onContextMenu={(e) => { e.preventDefault(); onDelete(); }}
      >
        <div style={{ position: 'absolute', top: 2, left: 0, width: '100%', height: '1px', background: 'rgba(120, 123, 134, 1)' }} />
        
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'rgba(30, 34, 45, 0.9)', color: 'white', border: '1px solid #787b86', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', whiteSpace: 'nowrap', zIndex: 52 }}>
          RR: {rrRatio} | Risk: {risk.toFixed(5)}
        </div>
      </div>

      {/* STOP BOX (Red) */}
      <div 
        style={{
          position: 'absolute',
          left: left,
          top: stopTop,
          width: width,
          height: stopHeight,
          background: 'rgba(242, 54, 69, 0.2)',
          borderTop: !isLong ? '2px solid rgba(242, 54, 69, 0.8)' : 'none',
          borderBottom: isLong ? '2px solid rgba(242, 54, 69, 0.8)' : 'none',
          borderLeft: '1px solid rgba(242, 54, 69, 0.3)',
          borderRight: '1px solid rgba(242, 54, 69, 0.3)',
          pointerEvents: 'auto',
          cursor: 'pointer'
        }}
        onMouseDown={(e) => { e.stopPropagation(); setIsDragging('stop'); }}
        onContextMenu={(e) => { e.preventDefault(); onDelete(); }}
      >
        <div style={{ position: 'absolute', bottom: '-25px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(242, 54, 69, 0.9)', color: 'white', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', whiteSpace: 'nowrap' }}>
          Stop: {tool.stopPrice.toFixed(5)}
        </div>
      </div>
      
      {/* Delete button indicator (right click to delete) */}
      <div style={{ position: 'absolute', top: Math.min(targetTop, stopTop) - 20, right: 0, background: 'rgba(0,0,0,0.5)', color: '#ccc', fontSize: '9px', padding: '1px 3px', pointerEvents: 'none' }}>
        Right-click to delete
      </div>
    </div>
  );
};

export default RrTool;
