import React, { useState, useRef, useEffect } from 'react';
import { createChart } from 'lightweight-charts';

export const AssistiveTouch = ({ showSdBands, setShowSdBands, showMomFlip, setShowMomFlip, showVolChart, setShowVolChart, showMomChart, setShowMomChart, showMatrixBubble, setShowMatrixBubble, bubbleMatrixData }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: window.innerWidth - 80, y: window.innerHeight - 150 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startY: 0, initialX: 0, initialY: 0 });
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handlePointerDown = (e) => {
    e.preventDefault();
    setIsDragging(false);
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      initialX: position.x, initialY: position.y
    };
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  };

  const handlePointerMove = (e) => {
    e.preventDefault();
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) setIsDragging(true);
    
    let newX = dragRef.current.initialX + dx;
    let newY = dragRef.current.initialY + dy;
    
    const bubbleSize = 60;
    const margin = 10;
    newX = Math.max(margin, Math.min(newX, window.innerWidth - bubbleSize - margin));
    newY = Math.max(margin, Math.min(newY, window.innerHeight - bubbleSize - margin));
    
    setPosition({ x: newX, y: newY });
  };

  const handlePointerUp = (e) => {
    document.removeEventListener('pointermove', handlePointerMove);
    document.removeEventListener('pointerup', handlePointerUp);
  };

  const toggleOpen = () => {
    if (!isDragging) setIsOpen(!isOpen);
  };

  return (
    <div ref={containerRef} style={{ position: 'fixed', left: position.x, top: position.y, zIndex: 9999 }}>
      {isOpen && (
        <div style={{ 
          position: 'absolute', 
          ...(position.y < window.innerHeight / 2 ? { top: '70px' } : { bottom: '70px' }),
          ...(position.x > window.innerWidth / 2 ? { right: '0px' } : { left: '0px' }),
          background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(12px)', padding: '16px', borderRadius: '16px', boxShadow: '0 10px 40px rgba(0,0,0,0.6), inset 0 1px 1px rgba(255,255,255,0.1)', width: '240px', border: '1px solid rgba(255, 255, 255, 0.1)', display: 'flex', flexDirection: 'column', gap: '12px', animation: 'fadeInBub 0.2s ease-out' 
        }}>
          <label style={{ display: 'flex', alignItems: 'center', color: '#e2e8f0', cursor: 'pointer', fontSize: '15px', fontWeight: '500', transition: 'color 0.2s' }} onMouseEnter={e => e.currentTarget.style.color = 'white'} onMouseLeave={e => e.currentTarget.style.color = '#e2e8f0'}>
            <input type="checkbox" checked={showSdBands} onChange={e => { setShowSdBands(e.target.checked); localStorage.setItem('showSdBands', e.target.checked); }} style={{ marginRight: '12px', width: '18px', height: '18px', accentColor: '#a855f7' }} />
            Dải SD
          </label>
          <label style={{ display: 'flex', alignItems: 'center', color: '#e2e8f0', cursor: 'pointer', fontSize: '15px', fontWeight: '500', transition: 'color 0.2s' }} onMouseEnter={e => e.currentTarget.style.color = 'white'} onMouseLeave={e => e.currentTarget.style.color = '#e2e8f0'}>
            <input type="checkbox" checked={showMomFlip} onChange={e => setShowMomFlip(e.target.checked)} style={{ marginRight: '12px', width: '18px', height: '18px', accentColor: '#a855f7' }} />
            Biểu đồ Momentum Flip
          </label>
          <label style={{ display: 'flex', alignItems: 'center', color: '#e2e8f0', cursor: 'pointer', fontSize: '15px', fontWeight: '500', transition: 'color 0.2s' }} onMouseEnter={e => e.currentTarget.style.color = 'white'} onMouseLeave={e => e.currentTarget.style.color = '#e2e8f0'}>
            <input type="checkbox" checked={showVolChart} onChange={e => { setShowVolChart(e.target.checked); localStorage.setItem('showVolChart', e.target.checked); }} style={{ marginRight: '12px', width: '18px', height: '18px', accentColor: '#a855f7' }} />
            Biểu đồ Volume
          </label>
          <label style={{ display: 'flex', alignItems: 'center', color: '#e2e8f0', cursor: 'pointer', fontSize: '15px', fontWeight: '500', transition: 'color 0.2s' }} onMouseEnter={e => e.currentTarget.style.color = 'white'} onMouseLeave={e => e.currentTarget.style.color = '#e2e8f0'}>
            <input type="checkbox" checked={showMomChart} onChange={e => { setShowMomChart(e.target.checked); localStorage.setItem('showMomChart', e.target.checked); }} style={{ marginRight: '12px', width: '18px', height: '18px', accentColor: '#a855f7' }} />
            Biểu đồ Momentum
          </label>
          <label style={{ display: 'flex', alignItems: 'center', color: '#e2e8f0', cursor: 'pointer', fontSize: '15px', fontWeight: '500', transition: 'color 0.2s' }} onMouseEnter={e => e.currentTarget.style.color = 'white'} onMouseLeave={e => e.currentTarget.style.color = '#e2e8f0'}>
            <input type="checkbox" checked={showMatrixBubble} onChange={e => { setShowMatrixBubble(e.target.checked); localStorage.setItem('showMatrixBubble', e.target.checked); }} style={{ marginRight: '12px', width: '18px', height: '18px', accentColor: '#a855f7' }} />
            Xếp hạng Matrix
          </label>
          
          {showMatrixBubble && bubbleMatrixData && (
            <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.1)', maxHeight: '300px', overflowY: 'auto' }}>
              <table style={{ width: '100%', fontSize: '13px', color: '#e2e8f0', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: '#94a3b8', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    <th style={{ textAlign: 'left', paddingBottom: '4px' }}>#</th>
                    <th style={{ textAlign: 'left', paddingBottom: '4px' }}>Cur</th>
                    <th style={{ textAlign: 'right', paddingBottom: '4px' }}>Mom %</th>
                  </tr>
                </thead>
                <tbody>
                  {bubbleMatrixData.map((item, idx) => {
                      let momColor = '#e2e8f0';
                      if (item.mom_percentile >= 50) momColor = '#4ade80';
                      else if (item.mom_percentile <= -50) momColor = '#f87171';
                      
                      return (
                    <tr key={item.currency} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '6px 0' }}>{idx + 1}</td>
                      <td style={{ padding: '6px 0', fontWeight: 'bold' }}>{item.currency}</td>
                      <td style={{ padding: '6px 0', textAlign: 'right', color: momColor }}>{item.mom_percentile > 0 ? '+' : ''}{item.mom_percentile != null ? item.mom_percentile.toFixed(2) : 0}%</td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <div 
        onPointerDown={handlePointerDown}
        onClick={toggleOpen}
        onMouseEnter={(e) => { if (!isDragging) e.currentTarget.style.transform = 'scale(1.1)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
        style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%)', boxShadow: '0 8px 32px rgba(168, 85, 247, 0.4), inset 0 2px 4px rgba(255,255,255,0.4)', display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: isDragging ? 'grabbing' : 'pointer', userSelect: 'none', touchAction: 'none', border: 'none', transition: 'transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
        title="Tính năng mở rộng"
      >
        <span style={{ color: 'white', fontSize: '28px', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }}>✨</span>
      </div>
      <style>
        {`
          @keyframes fadeInBub {
            from { opacity: 0; transform: translateY(10px) scale(0.95); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
        `}
      </style>
    </div>
  );
};

export const MomFlipChartComponent = ({ data, mainChart, mainSeries }) => {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const [position, setPosition] = useState({ x: window.innerWidth / 2 - 200, y: window.innerHeight / 2 - 125 });
  const dragRef = useRef(null);
  
  useEffect(() => {
    if (!chartContainerRef.current) return;
    
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      layout: { background: { color: 'transparent' }, textColor: '#d1d5db' },
      grid: { vertLines: { color: 'rgba(255,255,255,0.05)' }, horzLines: { color: 'rgba(255,255,255,0.05)' } },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)' },
      timeScale: { borderColor: 'rgba(255,255,255,0.1)' }
    });
    
    const series = chart.addAreaSeries({
      topColor: 'rgba(192, 132, 252, 0.5)',
      bottomColor: 'rgba(192, 132, 252, 0.05)',
      lineColor: '#c084fc',
      lineWidth: 2,
    });
    
    series.createPriceLine({
        price: 75,
        color: '#f59e0b',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: '75%',
    });
    
    series.createPriceLine({
        price: 85,
        color: '#ef4444',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: '85%',
    });
    
    chartRef.current = chart;
    seriesRef.current = series;
    
    const ro = new ResizeObserver(entries => {
      if (entries.length === 0 || entries[0].target !== chartContainerRef.current) return;
      const { width, height } = entries[0].contentRect;
      chart.resize(width, height);
    });
    ro.observe(chartContainerRef.current);
    
    return () => { ro.disconnect(); chart.remove(); };
  }, []);
  
  useEffect(() => {
    if (!mainChart || !chartRef.current || !mainSeries || !seriesRef.current) return;
    const mainTimeScale = mainChart.timeScale();
    const flipTimeScale = chartRef.current.timeScale();

    let isSyncingRange = false;
    const handleMainRange = () => {
      if (isSyncingRange) return;
      isSyncingRange = true;
      flipTimeScale.setVisibleLogicalRange(mainTimeScale.getVisibleLogicalRange());
      isSyncingRange = false;
    };
    const handleFlipRange = () => {
      if (isSyncingRange) return;
      isSyncingRange = true;
      mainTimeScale.setVisibleLogicalRange(flipTimeScale.getVisibleLogicalRange());
      isSyncingRange = false;
    };

    let isSyncingCrosshair = false;
    const handleMainCrosshairMove = (param) => {
        if (isSyncingCrosshair) return;
        if (!param.point || !param.time || param.point.x < 0 || param.point.y < 0) {
            chartRef.current.clearCrosshairPosition();
            return;
        }
        isSyncingCrosshair = true;
        try {
            chartRef.current.setCrosshairPosition(0, param.time, seriesRef.current);
        } catch(e) {}
        isSyncingCrosshair = false;
    };

    const handleFlipCrosshairMove = (param) => {
        if (isSyncingCrosshair) return;
        if (!param.point || !param.time || param.point.x < 0 || param.point.y < 0) {
            mainChart.clearCrosshairPosition();
            return;
        }
        isSyncingCrosshair = true;
        try {
            mainChart.setCrosshairPosition(0, param.time, mainSeries);
        } catch(e) {}
        isSyncingCrosshair = false;
    };

    mainTimeScale.subscribeVisibleLogicalRangeChange(handleMainRange);
    flipTimeScale.subscribeVisibleLogicalRangeChange(handleFlipRange);
    mainChart.subscribeCrosshairMove(handleMainCrosshairMove);
    chartRef.current.subscribeCrosshairMove(handleFlipCrosshairMove);

    return () => {
      mainTimeScale.unsubscribeVisibleLogicalRangeChange(handleMainRange);
      flipTimeScale.unsubscribeVisibleLogicalRangeChange(handleFlipRange);
      mainChart.unsubscribeCrosshairMove(handleMainCrosshairMove);
      chartRef.current.unsubscribeCrosshairMove(handleFlipCrosshairMove);
    };
  }, [mainChart, mainSeries]);

  useEffect(() => {
    if (seriesRef.current && data && data.length > 0) {
      seriesRef.current.setData(data);
    }
  }, [data]);

  const handlePointerDown = (e) => {
    if (e.target.id !== 'mom-flip-header') return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, initialX: position.x, initialY: position.y };
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  };

  const handlePointerMove = (e) => {
    let newX = dragRef.current.initialX + (e.clientX - dragRef.current.startX);
    let newY = dragRef.current.initialY + (e.clientY - dragRef.current.startY);
    const margin = 10;
    newX = Math.max(margin - 300, Math.min(newX, window.innerWidth - 100));
    newY = Math.max(margin, Math.min(newY, window.innerHeight - 50));
    setPosition({ x: newX, y: newY });
  };

  const handlePointerUp = () => {
    document.removeEventListener('pointermove', handlePointerMove);
    document.removeEventListener('pointerup', handlePointerUp);
  };

  return (
    <div style={{
      position: 'fixed', left: position.x, top: position.y, width: '400px', height: '250px', minWidth: '200px', minHeight: '150px',
      background: 'var(--bg-panel, #0f172a)', border: '1px solid var(--border-color, #334155)', borderRadius: '8px',
      boxShadow: '0 8px 30px rgba(0,0,0,0.8)', zIndex: 9998, display: 'flex', flexDirection: 'column',
      resize: 'both', overflow: 'hidden'
    }}>
      <div 
        id="mom-flip-header"
        onPointerDown={handlePointerDown}
        style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.05)', cursor: 'grab', userSelect: 'none', fontSize: '13px', fontWeight: 'bold', borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#c084fc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <span>📉 Momentum Flip (%)</span>
        <span style={{ fontSize: '10px', color: '#94a3b8' }}>(Kéo giãn ở góc phải dưới)</span>
      </div>
      <div ref={chartContainerRef} style={{ flex: 1, width: '100%', minHeight: 0 }} />
    </div>
  );
};



