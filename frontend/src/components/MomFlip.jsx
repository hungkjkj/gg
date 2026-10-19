import React, { useState, useRef, useEffect } from 'react';
import { createChart } from 'lightweight-charts';
import { SessionMatrixTable } from './SessionMatrixTable';

export const AssistiveTouch = ({ 
  showSdBands, setShowSdBands, 
  showMomFlip, setShowMomFlip, 
  showVolChart, setShowVolChart, 
  showMomChart, setShowMomChart, 
  showMatrixBubble, setShowMatrixBubble, 
  bubbleSessionMatrix,
  bubblePowerLong,
  bubblePowerShort,
  bubbleMatrixLoading,
  bubbleMatrixError,
  bubbleDvpTrend,
  bubbleDvpTrendLoading,
  bubbleDvpTrendError,
  volMode, handleVolModeToggle 
}) => {
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

  const hasMatrixRankingData = showMatrixBubble && (
    (Array.isArray(bubbleSessionMatrix?.ranking) && bubbleSessionMatrix.ranking.length > 0)
    || (Array.isArray(bubbleDvpTrend?.rows) && bubbleDvpTrend.rows.length > 0)
  );
  const controlOptions = [
    {
      id: 'sd-bands', label: 'Dải SD', description: 'Dải lệch chuẩn', checked: showSdBands,
      onChange: checked => { setShowSdBands(checked); localStorage.setItem('showSdBands', checked); }
    },
    {
      id: 'momentum-flip', label: 'TKH', description: 'Phân vị theo hướng mua/bán', checked: showMomFlip,
      onChange: setShowMomFlip
    },
    {
      id: 'volume-chart', label: 'Biểu đồ Volume', description: 'Tick volume', checked: showVolChart,
      onChange: checked => { setShowVolChart(checked); localStorage.setItem('showVolChart', checked); }
    },
    {
      id: 'average-volume', label: 'Trung bình Vol', description: 'Làm mượt volume', checked: volMode === 'mean_vol',
      onChange: checked => handleVolModeToggle && handleVolModeToggle(checked)
    },
    {
      id: 'momentum-chart', label: 'Biểu đồ Momentum', description: 'Động lượng giá', checked: showMomChart,
      onChange: checked => { setShowMomChart(checked); localStorage.setItem('showMomChart', checked); }
    },
    {
      id: 'matrix-ranking', label: 'Xếp hạng Matrix', description: 'Price Trend + Money Flow', checked: showMatrixBubble,
      onChange: checked => { setShowMatrixBubble(checked); localStorage.setItem('showMatrixBubble', checked); }
    }
  ];
  const enabledControlCount = controlOptions.filter(option => option.checked).length;
  const panelMaxWidth = position.x > window.innerWidth / 2
    ? `${position.x + 50}px`
    : `calc(100vw - ${position.x + 10}px)`;

  return (
    <div ref={containerRef} style={{ position: 'fixed', left: position.x, top: position.y, zIndex: 9999 }}>
      {isOpen && (
        <div style={{ 
          position: 'absolute', 
          ...(position.y < window.innerHeight / 2 ? { top: '70px' } : { bottom: '70px' }),
          ...(position.x > window.innerWidth / 2 ? { right: '0px' } : { left: '0px' }),
          background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(12px)', padding: '12px', borderRadius: '16px', boxShadow: '0 10px 40px rgba(0,0,0,0.6), inset 0 1px 1px rgba(255,255,255,0.1)', width: hasMatrixRankingData ? 'min(940px, calc(100vw - 20px))' : 'min(320px, calc(100vw - 20px))', maxWidth: panelMaxWidth, maxHeight: 'calc(100vh - 20px)', boxSizing: 'border-box', overflowY: 'auto', border: '1px solid rgba(255, 255, 255, 0.1)', display: 'flex', flexDirection: 'column', gap: '10px', animation: 'fadeInBub 0.2s ease-out'
        }}>
          <section style={{ paddingBottom: showMatrixBubble ? '12px' : '0', borderBottom: showMatrixBubble ? '1px solid rgba(255,255,255,0.1)' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '10px' }}>
              <div>
                <div style={{ color: '#38bdf8', fontSize: '10px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase' }}>Điều khiển biểu đồ</div>
                <div style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: '700', marginTop: '2px' }}>Lớp hiển thị</div>
              </div>
              <span style={{ color: '#4ade80', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: '999px', padding: '4px 9px', fontSize: '11px', fontWeight: '700', whiteSpace: 'nowrap' }}>
                {enabledControlCount}/{controlOptions.length} đang bật
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))', gap: '8px' }}>
              {controlOptions.map(option => (
                <label
                  key={option.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, minHeight: '50px', boxSizing: 'border-box',
                    padding: '8px 10px', borderRadius: '10px', cursor: 'pointer', color: '#e2e8f0',
                    background: option.checked ? 'rgba(88,28,135,0.18)' : 'rgba(255,255,255,0.025)',
                    border: `1px solid ${option.checked ? 'rgba(168,85,247,0.4)' : 'rgba(148,163,184,0.12)'}`,
                    transition: 'background 0.18s ease, border-color 0.18s ease'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={option.checked}
                    onChange={e => option.onChange(e.target.checked)}
                    style={{ margin: 0, width: '17px', height: '17px', flex: '0 0 auto', accentColor: '#a855f7' }}
                  />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                    <span style={{ fontSize: '12px', fontWeight: '600', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{option.label}</span>
                    <span style={{ color: '#94a3b8', fontSize: '10px', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{option.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>
          
          {showMatrixBubble && (
            <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.1)', minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap', marginBottom: '5px' }}>
                <strong style={{ color: '#fbbf24', fontSize: '13px' }}>⚡ Power V-target + Động Lượng Theo Phiên</strong>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
                  {bubbleSessionMatrix && <span style={{ color: '#94a3b8', fontSize: '10px' }}>{bubbleSessionMatrix.long_hours}h / {bubbleSessionMatrix.short_hours}h · Vol {bubbleSessionMatrix.vol_days} ngày</span>}
                  {bubbleMatrixLoading && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: '#fde68a', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: '999px', padding: '3px 7px', fontSize: '10px', fontWeight: 700 }}><span className="matrix-bubble-spinner" />Đang cập nhật</span>}
                </div>
              </div>
              <div style={{ color: '#94a3b8', fontSize: '10px', marginBottom: '7px' }}>T/F: phân vị động lượng có dấu · Vol: phân vị volume · P = (0.368 × T + 0.632 × F) × hệ số V</div>
              {bubbleMatrixError && <div style={{ marginBottom: '6px', color: '#fca5a5', fontSize: '10px' }}>{bubbleMatrixError}</div>}
              <div aria-busy={bubbleMatrixLoading} style={{ maxHeight: '420px', overflowY: 'auto', overflowX: 'hidden', minWidth: 0, paddingRight: '3px', borderRadius: '8px' }}>
                {bubbleSessionMatrix
                  ? <SessionMatrixTable data={bubbleSessionMatrix} compact longPowerRanking={bubblePowerLong} shortPowerRanking={bubblePowerShort} />
                  : <div style={{ padding: '10px 2px', color: '#94a3b8', fontSize: '12px' }}>Đang chờ dữ liệu Matrix theo phiên…</div>}
              </div>

              <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(148,163,184,0.16)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap', marginBottom: '7px' }}>
                  <strong style={{ color: '#67e8f9', fontSize: '12px' }}>📊 Xếp hạng xu hướng D-VP</strong>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
                    <span style={{ color: '#94a3b8', fontSize: '10px' }}>
                      Gap trung bình trong VWAP ± SD · Vol {bubbleDvpTrend?.vol_days || bubbleSessionMatrix?.vol_days || '—'} ngày
                    </span>
                    {bubbleDvpTrendLoading && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: '#a5f3fc', fontSize: '10px', fontWeight: 700 }}><span className="matrix-bubble-spinner" />Đang cập nhật</span>}
                  </div>
                </div>
                <div aria-busy={bubbleDvpTrendLoading} style={{ maxHeight: '230px', overflowY: 'auto', overflowX: 'auto', minWidth: 0, borderRadius: '8px' }}>
                  {bubbleDvpTrendLoading && !bubbleDvpTrend?.rows?.length ? (
                    <div style={{ padding: '8px 2px', color: '#7dd3fc', fontSize: '11px' }}>Đang tính BXH D-VP…</div>
                  ) : bubbleDvpTrendError && !bubbleDvpTrend?.rows?.length ? (
                    <div style={{ padding: '8px 2px', color: '#fca5a5', fontSize: '11px' }}>{bubbleDvpTrendError}</div>
                  ) : bubbleDvpTrend?.rows?.length ? (
                    <table style={{ width: '100%', minWidth: '470px', borderCollapse: 'collapse', fontSize: '10px', textAlign: 'left' }}>
                      <thead>
                        <tr>
                          {['#', 'Cặp / tài sản', 'Chiều', 'Gap TB', 'Phân vị', 'Vùng'].map(label => (
                            <th key={label} style={{ padding: '5px 6px', color: '#94a3b8', borderBottom: '1px solid rgba(148,163,184,0.16)', whiteSpace: 'nowrap' }}>{label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {bubbleDvpTrend.rows.map(row => {
                          const up = row.direction === 'up';
                          const down = row.direction === 'down';
                          const color = up ? '#4ade80' : down ? '#fb7185' : '#94a3b8';
                          return (
                            <tr key={row.symbol}>
                              <td style={{ padding: '5px 6px', color: '#fbbf24', borderBottom: '1px solid rgba(148,163,184,0.08)' }}>{row.rank}</td>
                              <td style={{ padding: '5px 6px', color: '#e2e8f0', fontWeight: 600, borderBottom: '1px solid rgba(148,163,184,0.08)', whiteSpace: 'nowrap' }}>{row.symbol}</td>
                              <td style={{ padding: '5px 6px', color, borderBottom: '1px solid rgba(148,163,184,0.08)', whiteSpace: 'nowrap' }}>{up ? '▲ Tăng' : down ? '▼ Giảm' : '● Cân bằng'}</td>
                              <td style={{ padding: '5px 6px', color: '#cbd5e1', borderBottom: '1px solid rgba(148,163,184,0.08)', whiteSpace: 'nowrap' }}>{row.gap_sd == null ? '—' : `${row.gap_sd.toFixed(3)} SD`}</td>
                              <td title={`${row.samples} mẫu lịch sử hợp lệ`} style={{ padding: '5px 6px', color: row.percentile == null ? '#64748b' : row.percentile >= 70 ? '#4ade80' : row.percentile <= 30 ? '#fb7185' : '#fbbf24', fontWeight: 700, borderBottom: '1px solid rgba(148,163,184,0.08)' }}>{row.percentile == null ? '—' : `P${row.percentile.toFixed(0)}`}</td>
                              <td style={{ padding: '5px 6px', color: '#cbd5e1', borderBottom: '1px solid rgba(148,163,184,0.08)' }}>{row.zones}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ padding: '8px 2px', color: '#94a3b8', fontSize: '11px' }}>Chưa có dữ liệu BXH D-VP.</div>
                  )}
                </div>
                <div style={{ marginTop: '5px', color: '#64748b', fontSize: '9px', lineHeight: 1.4 }}>
                  P cao = khoảng cách D-VP rộng hơn lịch sử của chính tài sản đó; hướng tăng/giảm dựa trên giá so với VWAP.
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      <div 
        onPointerDown={handlePointerDown}
        onClick={toggleOpen}
        onMouseEnter={(e) => { if (!isDragging) e.currentTarget.style.transform = 'scale(1.1)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
        style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'radial-gradient(circle, #ffffff 0%, #00f0ff 40%, #020612 90%)', boxShadow: '0 0 25px rgba(0, 240, 255, 0.8), inset 0 0 15px rgba(0, 240, 255, 0.8)', border: '2px solid rgba(0, 240, 255, 0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: isDragging ? 'grabbing' : 'pointer', userSelect: 'none', touchAction: 'none', border: 'none', transition: 'transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
        title="Tính năng mở rộng"
      >
        <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#ffffff', boxShadow: '0 0 15px #fff, 0 0 25px #00f0ff, inset 0 0 10px #00f0ff', border: '2px solid #00f0ff' }}></div>
      </div>
      <style>
        {`
          @keyframes fadeInBub {
            from { opacity: 0; transform: translateY(10px) scale(0.95); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
          @keyframes matrixBubbleSpin { to { transform: rotate(360deg); } }
          .matrix-bubble-spinner {
            width: 11px; height: 11px; flex: 0 0 auto; box-sizing: border-box;
            border: 2px solid rgba(125, 211, 252, 0.25); border-top-color: #67e8f9;
            border-radius: 50%; animation: matrixBubbleSpin 0.75s linear infinite;
          }
        `}
      </style>
    </div>
  );
};

export const MomFlipChartComponent = ({ data, mainChart, mainSeries, alerts, symbol, chartTheme }) => {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const priceLinesRef = useRef([]);
  const [position, setPosition] = useState({ x: window.innerWidth / 2 - 200, y: window.innerHeight / 2 - 125 });
  const dragRef = useRef(null);
  
  useEffect(() => {
    if (!chartContainerRef.current) return;
    
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      layout: { background: { color: 'transparent' }, textColor: '#f8fafc' },
      grid: { vertLines: { color: 'rgba(255,255,255,0.05)' }, horzLines: { color: 'rgba(255,255,255,0.05)' } },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)' },
      timeScale: { borderColor: 'rgba(255,255,255,0.1)' },
      crosshair: { mode: 0 }
    });
    
    const series = chart.addHistogramSeries({
      priceFormat: {
        type: 'custom',
        minMove: 1,
        formatter: price => `${price > 0 ? '+' : ''}${price.toFixed(0)}%`
      },
      autoscaleInfoProvider: () => ({
        priceRange: {
          minValue: -100,
          maxValue: 100,
        },
      }),
    });
    
    chartRef.current = chart;
    
    seriesRef.current = series;


    
    series.createPriceLine({ price: 0, color: 'rgba(226,232,240,0.65)', lineWidth: 1, lineStyle: 0, axisLabelVisible: true });
    [75, 85].forEach(level => {
      const color = level === 85 ? 'rgba(248,113,113,0.7)' : 'rgba(251,191,36,0.65)';
      series.createPriceLine({ price: level, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true });
      series.createPriceLine({ price: -level, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true });
    });
    
    chartRef.current = chart;
    seriesRef.current = series;
    
    const ro = new ResizeObserver(entries => {
      if (entries.length === 0 || entries[0].target !== chartContainerRef.current) return;
      const { width, height } = entries[0].contentRect;
      chart.resize(width, height);
    });
    ro.observe(chartContainerRef.current);
    
    return () => { 
        ro.disconnect(); 
        const c = chart;
        setTimeout(() => { try { if (c) c.remove(); } catch(e) {} }, 0);
    };
  }, []);
  
  useEffect(() => {
    if (!seriesRef.current || !alerts || !symbol) return;
    
    // Clear old lines
    priceLinesRef.current.forEach(line => {
      try {
        seriesRef.current.removePriceLine(line);
      } catch (e) {}
    });
    priceLinesRef.current = [];
    
    // Show each magnitude alert on both directional sides of the zero line.
    const momAlerts = alerts.filter(a => a.symbol === symbol && a.type === 'mom');
    momAlerts.forEach(alert => {
      const level = Math.abs(Number(alert.price));
      const color = alert.status === 'active' ? '#eab308' : '#94a3b8';
      [level, -level].forEach(price => {
        const line = seriesRef.current.createPriceLine({
          price,
          color,
          lineWidth: 1,
          lineStyle: 1,
          axisLabelVisible: true,
        });
        priceLinesRef.current.push(line);
      });
    });
  }, [alerts, symbol]);
  
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

    const timeToPrimitive = (t) => {
        if (typeof t === 'object' && t !== null) return t.year * 10000 + t.month * 100 + t.day;
        return t;
    };

    const findDataByTime = (time) => {
        if (!data || data.length === 0) return null;
        const target = timeToPrimitive(time);
        let l = 0, r = data.length - 1;
        while (l <= r) {
            let m = Math.floor((l + r) / 2);
            let current = timeToPrimitive(data[m].time);
            if (current === target) return data[m];
            if (current < target) l = m + 1;
            else r = m - 1;
        }
        return null;
    };

    let isSyncingCrosshair = false;
    const handleMainCrosshairMove = (param) => {
        if (isSyncingCrosshair) return;
        if (!param.point || !param.time || param.point.x < 0 || param.point.y < 0) {
            chartRef.current.clearCrosshairPosition();
            return;
        }
        isSyncingCrosshair = true;
        const item = findDataByTime(param.time);
        if (item) {
            try {
                const signedValue = Math.sign(item.mom_raw || 0) * Math.abs(item.value || 0);
                chartRef.current.setCrosshairPosition(signedValue, param.time, seriesRef.current);
            } catch(e) {}
        } else {
            chartRef.current.clearCrosshairPosition();
        }
        isSyncingCrosshair = false;
    };

    const handleFlipCrosshairMove = (param) => {
        if (isSyncingCrosshair) return;
        if (!param.point || !param.time || param.point.x < 0 || param.point.y < 0) {
            mainChart.clearCrosshairPosition();
            return;
        }
        isSyncingCrosshair = true;
        const item = findDataByTime(param.time);
        if (item && item.close) {
            try {
                mainChart.setCrosshairPosition(item.close, param.time, mainSeries);
            } catch(e) {}
        } else {
            mainChart.clearCrosshairPosition();
        }
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
  }, [mainChart, mainSeries, data]);

  useEffect(() => {
    if (seriesRef.current && data && data.length > 0) {
      const isSunsetMom = chartTheme === 'sunset';
      seriesRef.current.setData(data.map(d => {
        const score = Math.min(100, Math.max(0, Math.abs(d.value || 0)));
        const direction = d.mom_raw > 0 ? 1 : (d.mom_raw < 0 ? -1 : 0);
        const signedScore = direction * score;
        const alpha = Math.min(1.0, Math.max(0, score / 100));
        
        let r, g, b;
        if (direction >= 0) {
           r = 34; g = 211; b = 238;
           if (isSunsetMom) { r = 14; g = 165; b = 233; }
        } else {
           r = 251; g = 146; b = 60;
           if (isSunsetMom) { r = 249; g = 115; b = 22; }
        }

        return {
          time: d.time,
          value: signedScore,
          color: `rgba(${r}, ${g}, ${b}, ${alpha})`
        };
      }));
    }
  }, [data, chartTheme]);

  const handlePointerDown = (e) => {
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
        style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.05)', cursor: 'grab', userSelect: 'none', fontSize: '12px', fontWeight: 'bold', borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#c084fc', display: 'flex', flexDirection: 'column', gap: '6px' }}
      >
        <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
          <span>⚡ TKH (%)</span>
          <span style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 'normal' }}>Kéo giãn ở góc phải dưới</span>
        </div>
      </div>
      <div ref={chartContainerRef} style={{ flex: 1, width: '100%', minHeight: 0 }} />
    </div>
  );
};




