import React, { useState, useRef, useEffect } from 'react';
import { createChart } from 'lightweight-charts';
import { computeCompositeRanking } from '../utils/matrixUtils';

const MATRIX_BAR_THRESHOLDS = [50, 75, 85];

const MatrixBubbleBar = ({ value, color, label }) => {
  const normalizedValue = Math.min(Math.max(Math.abs(value ?? 0), 0), 100);

  return (
    <div
      role="img"
      aria-label={`${label}: ${normalizedValue.toFixed(1)} trên 100`}
      style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', marginTop: '5px', position: 'relative' }}
    >
      <div style={{ width: `${normalizedValue}%`, height: '100%', background: color, borderRadius: '3px' }} />
      {MATRIX_BAR_THRESHOLDS.map(threshold => (
        <span
          key={threshold}
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: `${threshold}%`,
            top: '-2px',
            width: '2px',
            height: '8px',
            transform: 'translateX(-1px)',
            borderRadius: '2px',
            background: '#4ade80',
            boxShadow: '0 0 4px rgba(74, 222, 128, 0.9)',
            zIndex: 1
          }}
        />
      ))}
    </div>
  );
};

export const AssistiveTouch = ({ 
  showSdBands, setShowSdBands, 
  showMomFlip, setShowMomFlip, 
  showVolChart, setShowVolChart, 
  showMomChart, setShowMomChart, 
  showMatrixBubble, setShowMatrixBubble, 
  bubbleMatrixData, bubbleMatrixDataLong,
  bubbleMatrixDataTrend, bubbleMatrixDataTrendLong,
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

  const hasLongMatrixPair = Array.isArray(bubbleMatrixDataLong) && Array.isArray(bubbleMatrixDataTrendLong);
  const hasShortMatrixPair = Array.isArray(bubbleMatrixData) && Array.isArray(bubbleMatrixDataTrend);
  const hasMatrixRankingData = showMatrixBubble && hasLongMatrixPair;
  const controlOptions = [
    {
      id: 'sd-bands', label: 'Dải SD', description: 'Dải lệch chuẩn', checked: showSdBands,
      onChange: checked => { setShowSdBands(checked); localStorage.setItem('showSdBands', checked); }
    },
    {
      id: 'momentum-flip', label: 'Bùng nổ động lượng', description: 'Phân vị theo hướng mua/bán', checked: showMomFlip,
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
          background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(12px)', padding: '16px', borderRadius: '16px', boxShadow: '0 10px 40px rgba(0,0,0,0.6), inset 0 1px 1px rgba(255,255,255,0.1)', width: hasMatrixRankingData ? 'min(780px, calc(100vw - 20px))' : 'min(320px, calc(100vw - 20px))', maxWidth: panelMaxWidth, maxHeight: 'calc(100vh - 20px)', boxSizing: 'border-box', overflowY: 'auto', border: '1px solid rgba(255, 255, 255, 0.1)', display: 'flex', flexDirection: 'column', gap: '12px', animation: 'fadeInBub 0.2s ease-out'
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
          
          {showMatrixBubble && (() => {
            const renderCompositeTable = () => {
              const primaryFlow = hasLongMatrixPair ? bubbleMatrixDataLong : null;
              const primaryTrend = hasLongMatrixPair ? bubbleMatrixDataTrendLong : null;
              if (!primaryFlow || !primaryTrend) {
                return <div style={{ padding: '10px 2px', color: '#94a3b8', fontSize: '12px' }}>Đang chờ dữ liệu xếp hạng Matrix…</div>;
              }

              const longComposite = computeCompositeRanking(primaryFlow, primaryTrend);
              const shortComposite = hasShortMatrixPair
                ? computeCompositeRanking(bubbleMatrixData, bubbleMatrixDataTrend)
                : [];

              if (!longComposite || longComposite.length === 0) {
                return <div style={{ padding: '10px 2px', color: '#94a3b8', fontSize: '12px' }}>Chưa có dữ liệu xếp hạng cho nhóm tài sản này.</div>;
              }

              return (
                <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.1)', minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '5px', marginBottom: '8px' }}>
                    <div style={{ fontSize: '13px', color: '#fbbf24', fontWeight: 'bold' }}>⚡ Sức Mạnh Hợp Nhất (Dài / Ngắn)</div>
                    <span title="w₁=1/e · Price Trend | w₂=(1−1/e) · Money Flow" style={{ fontSize: '10px', color: '#94a3b8', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>w₁=1/e · Trend | w₂=1−1/e · Flow</span>
                  </div>
                  <div style={{ width: '100%', minWidth: 0, overflowX: 'auto', overscrollBehaviorX: 'contain' }}>
                    <table style={{ width: '100%', minWidth: '570px', tableLayout: 'fixed', fontSize: '12px', color: '#e2e8f0', borderCollapse: 'collapse', marginBottom: '12px' }}>
                      <colgroup>
                        <col style={{ width: '7%' }} />
                        <col style={{ width: '9%' }} />
                        <col style={{ width: '17%' }} />
                        <col style={{ width: '18%' }} />
                        <col style={{ width: '18%' }} />
                        <col style={{ width: '11%' }} />
                        <col style={{ width: '20%' }} />
                      </colgroup>
                      <thead>
                        <tr style={{ color: '#94a3b8', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                          <th style={{ textAlign: 'left', padding: '0 4px 5px' }}>#</th>
                          <th style={{ textAlign: 'left', padding: '0 4px 5px' }}>Cur</th>
                          <th title="Điểm Power" style={{ textAlign: 'left', padding: '0 4px 5px' }}>Power</th>
                          <th title="Price Trend (C-VWMA)" style={{ textAlign: 'left', padding: '0 4px 5px' }}>Trend</th>
                          <th title="Money Flow (Động lượng)" style={{ textAlign: 'left', padding: '0 4px 5px' }}>Flow</th>
                          <th title="Thanh khoản" style={{ textAlign: 'left', padding: '0 4px 5px' }}>Vol %</th>
                          <th style={{ textAlign: 'right', padding: '0 4px 5px' }}>Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody>
                      {longComposite.map((item, idx) => {
                        const shortItem = shortComposite.find(x => x.currency === item.currency);

                        const powerColor = item.powerScore > 0 ? '#4ade80' : (item.powerScore < 0 ? '#f87171' : '#e2e8f0');
                        const valueColor = value => value > 0 ? '#00e5ff' : (value < 0 ? '#ff4d5e' : '#e2e8f0');
                        const formatValue = (value, suffix = '') => `${value > 0 ? '+' : ''}${value.toFixed(0)}${suffix}`;
                        const formatPower = value => `${value > 0 ? '+' : ''}${value.toFixed(1)}`;

                        let volColor = '#e2e8f0';
                        if (item.vol_percentile >= 75) volColor = '#4ade80';
                        else if (item.vol_percentile <= 20) volColor = '#f87171';

                        return (
                          <tr key={item.currency} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                            <td style={{ padding: '6px 4px', overflow: 'hidden', whiteSpace: 'nowrap' }}>{idx + 1}</td>
                            <td style={{ padding: '6px 4px', overflow: 'hidden', whiteSpace: 'nowrap', fontWeight: 'bold' }}>{item.currency}</td>
                            <td style={{ padding: '6px 4px', overflow: 'hidden' }}>
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: '3px', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                <span style={{ color: powerColor, fontWeight: 'bold' }}>{formatPower(item.powerScore)}</span>
                                {shortItem && <span style={{ fontSize: '10px', color: valueColor(shortItem.powerScore) }}>({formatPower(shortItem.powerScore)})</span>}
                              </div>
                              <MatrixBubbleBar value={item.powerScore} color={powerColor} label="Điểm Power" />
                            </td>
                            <td style={{ padding: '6px 4px', overflow: 'hidden' }}>
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: '3px', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                <span style={{ color: valueColor(item.momTrend), fontWeight: 'bold' }}>{formatValue(item.momTrend, '%')}</span>
                                {shortItem && <span style={{ fontSize: '10px', color: valueColor(shortItem.momTrend) }}>({formatValue(shortItem.momTrend, '%')})</span>}
                              </div>
                              <MatrixBubbleBar value={item.momTrend} color={valueColor(item.momTrend)} label="Price Trend" />
                            </td>
                            <td style={{ padding: '6px 4px', overflow: 'hidden' }}>
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: '3px', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                <span style={{ color: valueColor(item.momFlow), fontWeight: 'bold' }}>{formatValue(item.momFlow, '%')}</span>
                                {shortItem && <span style={{ fontSize: '10px', color: valueColor(shortItem.momFlow) }}>({formatValue(shortItem.momFlow, '%')})</span>}
                              </div>
                              <MatrixBubbleBar value={item.momFlow} color={valueColor(item.momFlow)} label="Money Flow" />
                            </td>
                            <td style={{ padding: '6px 4px', overflow: 'hidden' }}>
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: '3px', overflow: 'hidden', whiteSpace: 'nowrap', color: volColor }}>
                                {item.vol_percentile.toFixed(0)}%
                                {shortItem && <span style={{ fontSize: '10px', color: '#94a3b8' }}>({shortItem.vol_percentile.toFixed(0)}%)</span>}
                              </div>
                              <MatrixBubbleBar value={item.vol_percentile} color={volColor} label="Thanh khoản" />
                            </td>
                            <td style={{ padding: '6px 4px', textAlign: 'right', overflow: 'hidden' }}>
                              <span style={{
                                display: 'inline-block',
                                maxWidth: '100%',
                                boxSizing: 'border-box',
                                fontSize: '10px',
                                padding: '2px 5px',
                                borderRadius: '4px',
                                color: item.statusColor,
                                backgroundColor: `${item.statusColor}22`,
                                border: `1px solid ${item.statusColor}44`,
                                fontWeight: '600',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                verticalAlign: 'middle'
                              }} title={item.status}>
                                {item.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            };

            return (
              <div style={{ maxHeight: '420px', overflowY: 'auto', overflowX: 'hidden', minWidth: 0, paddingRight: '5px' }}>
                {renderCompositeTable()}
              </div>
            );
          })()}
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


    
    series.createPriceLine({ price: 0, color: 'rgba(226,232,240,0.65)', lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: '0 · TRUNG TÍNH' });
    [75, 85].forEach(level => {
      const color = level === 85 ? 'rgba(248,113,113,0.7)' : 'rgba(251,191,36,0.65)';
      series.createPriceLine({ price: level, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: `BUY ${level}%` });
      series.createPriceLine({ price: -level, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: `SELL ${level}%` });
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
      [
        { price: level, title: `BUY alert ${level}%` },
        { price: -level, title: `SELL alert ${level}%` }
      ].forEach(({ price, title }) => {
        const line = seriesRef.current.createPriceLine({
          price,
          color,
          lineWidth: 1,
          lineStyle: 1,
          axisLabelVisible: true,
          title,
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
          <span>⚡ Bùng Nổ Động Lượng (%)</span>
          <span style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 'normal' }}>Kéo giãn ở góc phải dưới</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 14px', fontSize: '10px', fontWeight: '600' }}>
          <span title="Chiều tăng của mom_raw; biểu thị áp lực giá đi lên, không xác định bên chủ động khớp lệnh" style={{ color: '#22d3ee' }}>▲ BUY PRESSURE · cột phía trên 0</span>
          <span title="Chiều giảm của mom_raw; biểu thị áp lực giá đi xuống, không xác định bên chủ động khớp lệnh" style={{ color: '#fb923c' }}>▼ SELL PRESSURE · cột phía dưới 0</span>
          <span style={{ color: '#94a3b8', fontWeight: 'normal' }}>Độ cao = phân vị động lượng</span>
        </div>
      </div>
      <div ref={chartContainerRef} style={{ flex: 1, width: '100%', minHeight: 0 }} />
    </div>
  );
};




