import React, { useState, useEffect, useRef } from 'react';
import { createChart, ColorType } from 'lightweight-charts';
import axios from 'axios';
import { AssistiveTouch, MomFlipChartComponent } from './components/MomFlip';
import StrategyBuilderTab from './components/StrategyBuilderTab';
import RrTool from './components/RrTool';
import './index.css';

const API_BASE = window.location.port === '5173' ? `${API_BASE}` : window.location.origin;

const customTimeFormatter = (time) => {
    const date = new Date(time * 1000);
    const days = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    const dayStr = days[date.getUTCDay()];
    const d = date.getUTCDate().toString().padStart(2, '0');
    const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const y = date.getUTCFullYear();
    const hh = date.getUTCHours().toString().padStart(2, '0');
    const mm = date.getUTCMinutes().toString().padStart(2, '0');
    return `${dayStr}, ${d}/${m}/${y} ${hh}:${mm}`;
};

const customTickMarkFormatter = (time, tickMarkType) => {
    const date = new Date(time * 1000);
    const days = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    const dayStr = days[date.getUTCDay()];
    const d = date.getUTCDate().toString().padStart(2, '0');
    const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const y = date.getUTCFullYear();
    const hh = date.getUTCHours().toString().padStart(2, '0');
    const mm = date.getUTCMinutes().toString().padStart(2, '0');
    
    if (tickMarkType === 0) return y.toString();
    if (tickMarkType === 1) return `${m}/${y}`;
    if (tickMarkType === 2) return `${dayStr} ${d}/${m}`;
    return `${dayStr} ${hh}:${mm}`;
};

const generateFutureTimeline = (cTime, tfSec, count) => {
    const futureTimes = [];
    let t = cTime + tfSec;
    for (let i = 0; i < count; i++) {
        const date = new Date(t * 1000);
        const day = date.getUTCDay();
        if (day !== 0 && day !== 6) {
            futureTimes.push({ time: t, value: 0 });
        } else {
            i--; // Skip weekends
        }
        t += tfSec;
    }
    return futureTimes;
};

const ChartComponent = ({ symbol, timeframe, configs, viewMode = 'chart', alerts = [], setAlerts, handleAddAlert, chartType, chartTheme, showSdBands, showMomFlipChart, showVolChart = true, showMomChart = true }) => {
  const [momFlipData, setMomFlipData] = useState([]);
  const chartContainerRef = useRef(null);
  const momentumChartContainerRef = useRef(null);
  const volumeChartContainerRef = useRef();
  const momentumChartRef = useRef(null);
  const volumeChartRef = useRef(null);
  const chartRef = useRef(null);
  const abortControllerRef = useRef(null);
  const candlestickSeriesRef = useRef(null);
  const alertsSeriesRef = useRef(null);
  const lineCloseSeriesRef = useRef(null);
  const [chartReady, setChartReady] = useState(false);
  const lineHighSeriesRef = useRef(null);
  const lineLowSeriesRef = useRef(null);
  const sessionDataRef = useRef([]);
  const vwapSeriesRef = useRef(null);
  const fairValueSeriesRef = useRef(null);
  const upperBandSeriesRef = useRef(null);
  const lowerBandSeriesRef = useRef(null);
  const sdFillSeriesRef = useRef(null);
  const momentumSeriesRef = useRef(null);
  
  // CÃ¡c Ä‘Æ°á»ng xÃ¡c suáº¥t Momentum
  const mom85UpRef = useRef(null);
  const mom85DnRef = useRef(null);
  const mom75UpRef = useRef(null);
  const mom75DnRef = useRef(null);
  const mom50UpRef = useRef(null);
  const mom50DnRef = useRef(null);
  
  // CÃ¡c Ä‘Æ°á»ng xÃ¡c suáº¥t Volume
  const normVolSeriesRef = useRef(null);
  const maVolSeriesRef = useRef(null);
  
  const [contextMenu, setContextMenu] = useState(null);
  
  const [drawnLines, setDrawnLines] = useState(() => {
     try { return JSON.parse(localStorage.getItem('userDrawnLines')) || []; }
     catch(e) { return []; }
  });
  const drawnLinePrimitivesRef = useRef({});
  
  const handleAddDrawnLine = (price) => {
      const newLine = { id: Date.now(), symbol: symbolRef.current, price };
      const updated = [...drawnLines, newLine];
      setDrawnLines(updated);
      localStorage.setItem('userDrawnLines', JSON.stringify(updated));
      closeContextMenu();
  };
  
  const handleRemoveNearestDrawnLine = (price) => {
      const currentLines = drawnLines.filter(l => l.symbol === symbolRef.current);
      if (currentLines.length === 0) {
          closeContextMenu();
          return;
      }
      
      let nearest = currentLines[0];
      let minDiff = Math.abs(currentLines[0].price - price);
      for (const l of currentLines) {
          const diff = Math.abs(l.price - price);
          if (diff < minDiff) {
              minDiff = diff;
              nearest = l;
          }
      }
      
      const updated = drawnLines.filter(l => l.id !== nearest.id);
      setDrawnLines(updated);
      localStorage.setItem('userDrawnLines', JSON.stringify(updated));
      closeContextMenu();
  };
  
  const [rrTools, setRrTools] = useState([]);

  const addRrTool = (type, price, logical) => {
    const offset = price * 0.002;
    
    const newTool = {
      id: Date.now().toString(),
      type,
      entryPrice: price,
      targetPrice: type === 'long' ? price + offset*2 : price - offset*2,
      stopPrice: type === 'long' ? price - offset : price + offset,
      logical: logical || 0,
      endLogical: (logical || 0) + 20
    };
    setRrTools(prev => [...prev, newTool]);
  };

  const updateRrTool = (id, updates) => {
    setRrTools(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const deleteRrTool = (id) => {
    setRrTools(prev => prev.filter(t => t.id !== id));
  };

  const [customAlertModal, setCustomAlertModal] = useState(null);
  const [alertNoteInput, setAlertNoteInput] = useState('');
  const vol85Ref = useRef(null);
  const vol75Ref = useRef(null);
  const vol50Ref = useRef(null);
  const vol15Ref = useRef(null);
  
  const [loading, setLoading] = useState(true);
  const loadingRef = useRef(true);
  const [error, setError] = useState(null);
  const [lastUpdateSignal, setLastUpdateSignal] = useState(0);
  
  const [vpBoxes, setVpBoxes] = useState([]);
  const [volStats, setVolStats] = useState(null);
  const volStatsRef = useRef(null);
  const canvasRef = useRef(null);
  const volumeCanvasRef = useRef(null);
  const animationFrameRef = useRef(null);
  const updateOverlaysRef = useRef(null);
  const lastUpdateTimeRef = useRef(0);

  // Backtest State
  const [backtestDate, setBacktestDate] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const simulatedTimeRef = useRef(0);
  const isPlayingRef = useRef(false);
  const lastVwapColorRef = useRef(null);
  const lastMaVolColorRef = useRef(null);
  const lastHl2ColorRef = useRef(null);
  const lastBandwidthRef = useRef(null);
  const lastSdColorRef = useRef(null);
  
  // Dá»«ng backtest khi Ä‘á»•i cáº·p tiá»n hoáº·c khung thá»i gian
  useEffect(() => {
    if (isPlayingRef.current) {
      setIsPlaying(false);
      isPlayingRef.current = false;
    }
  }, [symbol, timeframe]);
  const bandwidthHistoryRef = useRef([]);
  const backtestWeekRef = useRef(0);
  
  const bidPriceLineRef = useRef(null);
  const askPriceLineRef = useRef(null);
  
  const savedTimeRangeRef = useRef(null);
  const [isScrolled, setIsScrolled] = useState(false);
  const isScrolledRef = useRef(false);
  
  const [newsData, setNewsData] = useState([]);
  const newsSeriesRef = useRef(null);
  const momentumDummySeriesRef = useRef(null);
  const volumeDummySeriesRef = useRef(null);
  const newsDataRef = useRef([]);
  const [selectedNewsGroup, setSelectedNewsGroup] = useState(null);
  
  // Keep track of playback speed for the interval
  
  // Keep track of playback speed for the interval
  const playbackSpeedRef = useRef(1);
  useEffect(() => { playbackSpeedRef.current = playbackSpeed; }, [playbackSpeed]);
// Fetch News Data
  const fetchNews = async () => {
    try {
      const response = await axios.get(`${API_BASE}/api/v1/news`, {
        params: { symbol }
      });
      if (response.data.status === 'success') {
        let finalData = response.data.data;
        if (configs.timeShiftHours) {
           finalData = finalData.map(item => ({
              ...item,
              time: item.time + (configs.timeShiftHours * 3600)
           }));
        }
        setNewsData(finalData);
      }
    } catch (e) {
      console.error("Failed to fetch news", e);
    }
  };

  useEffect(() => {
    fetchNews();
  }, [symbol, configs.timeShiftHours]);

  // Apply News Markers and Future Timeline (for v_lines and news)
  const applyTimelineAndMarkers = () => {
    if (newsSeriesRef.current) {
      const tfSec = timeframe === 'M1' ? 60 : timeframe === 'M3' ? 180 : timeframe === 'M5' ? 300 : timeframe === 'M15' ? 900 : timeframe === 'M30' ? 1800 : timeframe === 'H1' ? 3600 : timeframe === 'H2' ? 7200 : timeframe === 'H4' ? 14400 : timeframe === 'H8' ? 28800 : timeframe === 'D1' ? 86400 : 3600;

      // Align news to timeframe grid to prevent blank gaps in chart
      const alignedNewsData = newsData.map(ev => {
         let alignedTime = ev.time - (ev.time % tfSec);
         return { ...ev, originalTime: ev.time, time: alignedTime };
      });
      newsDataRef.current = alignedNewsData;
      
      // Setup timeline for news series to allow markers in the future
      const newsTimes = [...new Set(alignedNewsData.map(ev => ev.time))].sort((a,b)=>a-b);
      let maxFutureTime = newsTimes.length > 0 ? newsTimes[newsTimes.length - 1] : 0;
      
      if (volStatsRef.current && volStatsRef.current.v_lines) {
         volStatsRef.current.v_lines.forEach(v => {
            if (v.time > maxFutureTime) maxFutureTime = v.time;
         });
      }
      
      let baseTime = (viewMode === 'backtest' && window.currentSimulatedTime) ? window.currentSimulatedTime : Math.floor(Date.now() / 1000);
      if (maxFutureTime === 0) maxFutureTime = baseTime + 86400;
      
      let currentTime = lastUpdateTimeRef.current;
      if (!currentTime || currentTime === 0) currentTime = baseTime;
      currentTime = currentTime - (currentTime % tfSec);
      
      // Calculate how many bars we need to reach maxFutureTime, minimum 150
      let requiredBars = Math.ceil((maxFutureTime - currentTime) / tfSec);
      if (requiredBars < 150) requiredBars = 150;
      
      const futureTimes = generateFutureTimeline(currentTime, tfSec, requiredBars);

      
      const allTimesMap = new Map();
      let historicalData = [];
      if (candlestickSeriesRef.current) historicalData = candlestickSeriesRef.current.data() || [];
      historicalData.forEach(d => allTimesMap.set(d.time, { time: d.time, value: 0 }));
      newsTimes.forEach(nt => allTimesMap.set(nt, { time: nt, value: 0 }));
      futureTimes.forEach(ft => allTimesMap.set(ft.time, ft));
      
      const fullTimelineData = Array.from(allTimesMap.values()).sort((a,b) => a.time - b.time);
      const finalFullData = fullTimelineData.filter(d => d && Number.isFinite(d.time));
      
      try {
          if (newsSeriesRef.current) newsSeriesRef.current.setData(finalFullData);
          if (momentumDummySeriesRef.current) momentumDummySeriesRef.current.setData(finalFullData);
          if (volumeDummySeriesRef.current) volumeDummySeriesRef.current.setData(finalFullData);

          // Group events by time
          const eventsByTime = {};
          alignedNewsData.forEach(ev => {
            if (!eventsByTime[ev.time]) eventsByTime[ev.time] = [];
            eventsByTime[ev.time].push(ev);
          });
          
          const markers = [];
          for (const [timeStr, events] of Object.entries(eventsByTime)) {
            const time = parseInt(timeStr);
            let hasHigh = false;
            let hasMedium = false;
            for (const ev of events) {
              if (ev.impact === 'High') hasHigh = true;
              if (ev.impact === 'Medium') hasMedium = true;
            }
            
            let color = '#787b86'; // Gray/Holiday
            if (hasHigh) color = '#f23645'; // Red
            else if (hasMedium) color = '#ff9800'; // Orange
            
            markers.push({
              time: time,
              position: 'aboveBar',
              color: color,
              shape: 'circle',
              size: 0.4,
              text: '' // Keep text empty
            });
          }
          
          markers.sort((a,b)=>a.time-b.time);
          newsSeriesRef.current.setMarkers(markers);
      } catch (e) {
          console.error("Error setting news markers", e);
      }
    }
  };

  useEffect(() => {
    applyTimelineAndMarkers();
  }, [newsData, chartReady, timeframe]);

  // Expose applyTimelineAndMarkers for manual calls when volStats changes
  useEffect(() => {
    window.updateTimelineForVLines = applyTimelineAndMarkers;
    return () => { window.updateTimelineForVLines = null; };
  }, [newsData, chartReady, timeframe]);

  
  const lastClickTimeRef = useRef(0);
  const alertLinesRef = useRef({});
  const symbolRef = useRef(symbol);
  const timeframeRef = useRef(timeframe);
  
  useEffect(() => {
    symbolRef.current = symbol;
  }, [symbol]);

  useEffect(() => {
    timeframeRef.current = timeframe;
  }, [timeframe]);

  const handleContextMenu = (e) => {
    e.preventDefault();
    if (!chartContainerRef.current || !candlestickSeriesRef.current) return;
    
    // ÄÃ³ng modal cÅ© náº¿u Ä‘ang má»Ÿ
    setCustomAlertModal(null);
    setAlertNoteInput('');

    const rect = chartContainerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const price = candlestickSeriesRef.current.coordinateToPrice(y);
    if (price !== null) {
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        price: price,
        symbol: symbolRef.current
      });
    }
  };
  
  const closeContextMenu = () => setContextMenu(null);

  useEffect(() => {
    document.addEventListener('click', closeContextMenu);
    
    // NgÄƒn cháº·n menu máº·c Ä‘á»‹nh cá»§a trÃ¬nh duyá»‡t/WebView TOÃ€N Cá»¤C
    const preventGlobalContext = (e) => { 
      e.preventDefault(); 
      
      // Náº¿u click vÃ o trong khu vá»±c MAIN chart
      if (chartContainerRef.current && chartContainerRef.current.contains(e.target)) {
        if (!candlestickSeriesRef.current) return;
        
        // ÄÃ³ng modal cÅ© náº¿u Ä‘ang má»Ÿ
        setCustomAlertModal(null);
        setAlertNoteInput('');

        const rect = chartContainerRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const price = candlestickSeriesRef.current.coordinateToPrice(y);
        
        if (price !== null) {
          const timeScale = chartRef.current.timeScale();
          const logical = timeScale.coordinateToLogical(x);
          // IMPORTANT: Need to use functional state update or just directly set it.
          // Because setContextMenu is from useState, it is always available.
          setContextMenu({
            x: e.clientX,
            y: e.clientY,
            price: price,
            symbol: symbolRef.current,
            logical: logical
          });
          
          if (setAlerts) { // Táº­n dá»¥ng setAlerts hoáº·c toast Ä‘á»ƒ debug
            console.log("Context menu opened at price", price);
          }
        }
      } else {
        closeContextMenu();
      }
    };
    
    document.addEventListener('contextmenu', preventGlobalContext, { capture: true });

    const handleDocumentClick = (e) => {
        // Chá»‰ close náº¿u khÃ´ng click vÃ o context menu
        if (!e.target.closest('.custom-context-menu-wrapper')) {
            closeContextMenu();
        }
    };

    document.addEventListener('mousedown', handleDocumentClick);

    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
      document.removeEventListener('contextmenu', preventGlobalContext, { capture: true });
    };
  }, []);



  useEffect(() => {
     if (!chartReady || !candlestickSeriesRef.current) return;
     const currentAlerts = alerts.filter(a => a.symbol === symbol && a.status === 'active');
     
     // Remove old lines
     Object.keys(alertLinesRef.current).forEach(id => {
         if (!currentAlerts.find(a => a.id.toString() === id)) {
             if (alertsSeriesRef.current) alertsSeriesRef.current.removePriceLine(alertLinesRef.current[id]);
             delete alertLinesRef.current[id];
         }
     });
     
     // Add new lines
     currentAlerts.forEach(a => {
         if (!alertLinesRef.current[a.id] && alertsSeriesRef.current) {
             const line = alertsSeriesRef.current.createPriceLine({
                 price: a.price,
                 color: '#eab308',
                 lineWidth: 2,
                 lineStyle: 2,
                 axisLabelVisible: true,
                 title: a.note ? `ðŸ”” ${a.note}` : 'ðŸ”” Alert',
             });
             alertLinesRef.current[a.id] = line;
         }
     });
  }, [alerts, symbol, chartReady]);

  // Sync drawn observation lines
  useEffect(() => {
     if (!chartReady || !alertsSeriesRef.current) return;
     const currentLines = drawnLines.filter(l => l.symbol === symbol);
     
     Object.keys(drawnLinePrimitivesRef.current).forEach(id => {
         if (!currentLines.find(l => l.id.toString() === id)) {
             alertsSeriesRef.current.removePriceLine(drawnLinePrimitivesRef.current[id]);
             delete drawnLinePrimitivesRef.current[id];
         }
     });
     
     currentLines.forEach(l => {
         if (!drawnLinePrimitivesRef.current[l.id]) {
             const line = alertsSeriesRef.current.createPriceLine({
                 price: l.price,
                 color: '#38bdf8', // Light blue
                 lineWidth: 1,
                 lineStyle: 0, // Solid
                 axisLabelVisible: true,
                 title: 'Quan sÃ¡t',
             });
             drawnLinePrimitivesRef.current[l.id] = line;
         }
     });
  }, [drawnLines, symbol, chartReady]);

useEffect(() => {
    // Khá»Ÿi táº¡o biá»ƒu Ä‘á»“
    const chart = createChart(chartContainerRef.current, {
      autoSize: false,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#f8fafc',
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
      },
      crosshair: {
        mode: 0,
      },
      localization: {
        timeFormatter: customTimeFormatter,
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 20,
        tickMarkFormatter: customTickMarkFormatter,
      },
    });



    let precision = 5;
    let minMove = 0.00001;
    if (symbol.includes("JPY")) {
      precision = 3;
      minMove = 0.001;
    } else if (symbol.includes("XAU") || symbol.includes("GOLD") || symbol.includes("BTC") || symbol.includes("ETH") || symbol.includes("SOL")) {
      precision = 2;
      minMove = 0.01;
    }

    const upperBandSeries = chart.addLineSeries({
      color: 'rgba(239, 68, 68, 0.8)',
      lineWidth: 2,
      lineStyle: 2, // 2 = Dashed
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: {
        type: 'price',
        precision: precision,
        minMove: minMove,
      },
    });
    
    const lowerBandSeries = chart.addLineSeries({
      color: 'rgba(16, 185, 129, 0.8)',
      lineWidth: 2,
      lineStyle: 2, // 2 = Dashed
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: {
        type: 'price',
        precision: precision,
        minMove: minMove,
      },
    });

    const sdFillSeries = chart.addCandlestickSeries({
      upColor: 'rgba(128, 128, 128, 0.15)',
      downColor: 'rgba(128, 128, 128, 0.15)',
      borderVisible: false,
      wickVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: {
        type: 'price',
        precision: precision,
        minMove: minMove,
      },
    });

    const alertsSeries = chart.addLineSeries({
      color: 'rgba(0,0,0,0)',
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    alertsSeriesRef.current = alertsSeries;

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#00e676',
      downColor: '#ff1744',
      borderVisible: false,
      wickUpColor: '#00e676',
      wickDownColor: '#ff1744',
      priceLineVisible: false,
      priceFormat: {
        type: 'price',
        precision: precision,
        minMove: minMove,
      },
    });

    const lineCloseSeries = chart.addLineSeries({
        color: '#2962FF',
        lineWidth: 2,
        visible: false,
        priceFormat: { type: 'price', precision, minMove },
    });
    const lineHighSeries = chart.addLineSeries({
        color: '#00e676',
        lineWidth: 2,
        visible: false,
        priceFormat: { type: 'price', precision, minMove },
    });
    const lineLowSeries = chart.addLineSeries({
        color: '#ff1744',
        lineWidth: 2,
        visible: false,
        priceFormat: { type: 'price', precision, minMove },
    });
    
    const vwapSeries = chart.addLineSeries({
        lineWidth: 2,
      });
      
    const fairValueSeries = chart.addLineSeries({
        lineWidth: 2,
        visible: chartType === 'money_flow',
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
        priceFormat: {
          type: 'price',
          precision: precision,
          minMove: minMove,
        },
    });
      
      const momentumChart = createChart(momentumChartContainerRef.current, {
        autoSize: false,
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: '#f8fafc',
        },
        grid: {
          vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
          horzLines: { color: 'rgba(255, 255, 255, 0.03)' },
        },
        crosshair: { mode: 0 },
        localization: {
          timeFormatter: customTimeFormatter,
        },
        timeScale: {
          timeVisible: true,
          secondsVisible: false,
          rightOffset: 20,
          tickMarkFormatter: customTickMarkFormatter,
        },
      });

      const momentumSeries = momentumChart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        autoscaleInfoProvider: () => null,
      });
      
      const mom85Up = momentumChart.addLineSeries({ color: 'rgba(255, 165, 0, 0.5)', lineWidth: 1, crosshairMarkerVisible: false });
      const mom85Dn = momentumChart.addLineSeries({ color: 'rgba(255, 165, 0, 0.5)', lineWidth: 1, crosshairMarkerVisible: false });
      const mom75Up = momentumChart.addLineSeries({ color: 'rgba(225, 230, 38, 0.5)', lineWidth: 1, crosshairMarkerVisible: false });
      const mom75Dn = momentumChart.addLineSeries({ color: 'rgba(225, 230, 38, 0.5)', lineWidth: 1, crosshairMarkerVisible: false });
      const mom50Up = momentumChart.addLineSeries({ color: 'rgba(128, 128, 128, 0.5)', lineWidth: 1, crosshairMarkerVisible: false });
      const mom50Dn = momentumChart.addLineSeries({ color: 'rgba(128, 128, 128, 0.5)', lineWidth: 1, crosshairMarkerVisible: false });
      
      const momentumDummySeries = momentumChart.addLineSeries({ color: 'rgba(0,0,0,0)', priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      momentumDummySeriesRef.current = momentumDummySeries;
      
      const volumeChart = createChart(volumeChartContainerRef.current, {
        autoSize: false,
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: '#f8fafc',
        },
        grid: {
          vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
          horzLines: { color: 'rgba(255, 255, 255, 0.03)' },
        },
        crosshair: { mode: 0 },
        localization: {
          timeFormatter: customTimeFormatter,
        },
        timeScale: {
          timeVisible: true,
          secondsVisible: false,
          rightOffset: 20,
          tickMarkFormatter: customTickMarkFormatter,
        },
      });
      
      const normVolSeries = volumeChart.addHistogramSeries({
        priceFormat: { type: 'volume' },
      });
      const maVolSeries = volumeChart.addLineSeries({ color: 'rgba(57, 255, 20, 0.8)', lineWidth: 2 });
      
      const vol85Line = volumeChart.addLineSeries({ color: 'rgba(255, 165, 0, 0.5)', lineWidth: 1, crosshairMarkerVisible: false });
      const vol75Line = volumeChart.addLineSeries({ color: 'rgba(225, 230, 38, 0.5)', lineWidth: 1, crosshairMarkerVisible: false });
      const vol50Line = volumeChart.addLineSeries({ color: 'rgba(128, 128, 128, 0.5)', lineWidth: 1, crosshairMarkerVisible: false });
      const vol15Line = volumeChart.addLineSeries({ color: 'rgba(0, 191, 255, 0.5)', lineWidth: 1, crosshairMarkerVisible: false });
      
      const volumeDummySeries = volumeChart.addLineSeries({ color: 'rgba(0,0,0,0)', priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      volumeDummySeriesRef.current = volumeDummySeries;

      // Sync time scales (LogicalRange is safer and prevents infinite loops with guards)
      let isSyncingLeft = false;
      let isSyncingMid = false;
      let isSyncingRight = false;

      chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range && !isSyncingLeft) {
          isSyncingMid = true;
          isSyncingRight = true;
          if (momentumChart) momentumChart.timeScale().setVisibleLogicalRange(range);
          if (volumeChart) volumeChart.timeScale().setVisibleLogicalRange(range);
        }
        isSyncingLeft = false;
      });

      momentumChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (updateOverlaysRef.current) updateOverlaysRef.current();
        if (range && !isSyncingMid) {
          isSyncingLeft = true;
          isSyncingRight = true;
          if (chart) chart.timeScale().setVisibleLogicalRange(range);
          if (volumeChart) volumeChart.timeScale().setVisibleLogicalRange(range);
        }
        isSyncingMid = false;
      });
      
      volumeChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (updateOverlaysRef.current) updateOverlaysRef.current();
        if (range && !isSyncingRight) {
          isSyncingLeft = true;
          isSyncingMid = true;
          if (chart) chart.timeScale().setVisibleLogicalRange(range);
          if (momentumChart) momentumChart.timeScale().setVisibleLogicalRange(range);
        }
        isSyncingRight = false;
      });
      
      // Sync crosshairs
      const handleCrosshairMove = (param, targetCharts, targetSeries) => {
        if (updateOverlaysRef.current) updateOverlaysRef.current();
        if (!param.point || !param.time) {
          targetCharts.forEach(c => c.clearCrosshairPosition());
          return;
        }
        
        targetCharts.forEach((c, index) => {
           const series = targetSeries[index];
           if (series) {
              const dataPoint = param.seriesData.get(series);
              const price = dataPoint ? (dataPoint.value !== undefined ? dataPoint.value : (dataPoint.close !== undefined ? dataPoint.close : 0)) : 0;
              try {
                c.setCrosshairPosition(price, param.time, series);
              } catch (err) {
                // Ignore errors when param.time does not exist in target series
              }
           }
        });
      };

      chart.subscribeClick((param) => {
        // Xá»­ lÃ½ click cho quáº£ bÃ³ng tin tá»©c
        if (param.time && newsDataRef.current) {
          const events = newsDataRef.current.filter(ev => ev.time === param.time);
          if (events.length > 0) {
            setSelectedNewsGroup(events);
          } else {
            setSelectedNewsGroup(null);
          }
        } else {
          setSelectedNewsGroup(null);
        }
      });

      chart.subscribeDblClick((param) => {
        // ÄÃ£ xÃ³a double click, thay báº±ng context menu
      });

      chart.subscribeCrosshairMove(param => handleCrosshairMove(param, [momentumChart, volumeChart], [momentumSeries, normVolSeries]));
      momentumChart.subscribeCrosshairMove(param => handleCrosshairMove(param, [chart, volumeChart], [candlestickSeries, normVolSeries]));
      volumeChart.subscribeCrosshairMove(param => handleCrosshairMove(param, [chart, momentumChart], [candlestickSeries, momentumSeries]));
    

    
    const newsSeries = chart.addLineSeries({
      color: 'rgba(0, 0, 0, 0)', // Transparent line, so only markers show
      priceScaleId: 'news', // Separate hidden scale
      crosshairMarkerVisible: false,
    });
    
    chart.priceScale('news').applyOptions({
      visible: false,
      scaleMargins: {
        top: 0.95, // Push the zero line to the very bottom
        bottom: 0,
      }
    });

    chartRef.current = chart;
    
    // Theo dÃµi hÃ nh Ä‘á»™ng cuá»™n cá»§a ngÆ°á»i dÃ¹ng
    chart.timeScale().subscribeVisibleLogicalRangeChange((logicalRange) => {
      if (updateOverlaysRef.current) updateOverlaysRef.current();
      if (logicalRange && candlestickSeriesRef.current) {
        const data = candlestickSeriesRef.current.data();
        if (data && data.length > 0) {
          const totalCandles = data.length;
          // Náº¿u mÃ©p pháº£i cá»§a mÃ n hÃ¬nh cÃ¡ch hiá»‡n táº¡i quÃ¡ 5 náº¿n, coi nhÆ° lÃ  Ä‘Ã£ kÃ©o vá» quÃ¡ khá»©
          if (logicalRange.to < totalCandles - 5) {
            if (!isScrolledRef.current) {
              isScrolledRef.current = true;
              setIsScrolled(true);
            }
          } else {
            if (isScrolledRef.current) {
              isScrolledRef.current = false;
              setIsScrolled(false);
            }
          }
        }
      }
    });
    
    setChartReady(true);
    candlestickSeriesRef.current = candlestickSeries;
    lineCloseSeriesRef.current = lineCloseSeries;
    lineHighSeriesRef.current = lineHighSeries;
    lineLowSeriesRef.current = lineLowSeries;
    newsSeriesRef.current = newsSeries;
    vwapSeriesRef.current = vwapSeries;
    fairValueSeriesRef.current = fairValueSeries;
    upperBandSeriesRef.current = upperBandSeries;
    lowerBandSeriesRef.current = lowerBandSeries;
    sdFillSeriesRef.current = sdFillSeries;
    momentumSeriesRef.current = momentumSeries;
    momentumChartRef.current = momentumChart;
    volumeChartRef.current = volumeChart;
    
    mom85UpRef.current = mom85Up;
    mom85DnRef.current = mom85Dn;
    mom75UpRef.current = mom75Up;
    mom75DnRef.current = mom75Dn;
    mom50UpRef.current = mom50Up;
    mom50DnRef.current = mom50Dn;
    
    normVolSeriesRef.current = normVolSeries;
    maVolSeriesRef.current = maVolSeries;
    vol85Ref.current = vol85Line;
    vol75Ref.current = vol75Line;
    vol50Ref.current = vol50Line;
    vol15Ref.current = vol15Line;
    
    // LÆ°u ref cho Session BG

    let isDisposed = false;

    // Resize handler
    const handleResize = () => {
        if (isDisposed) return;
        try {
          if (chartContainerRef.current && chart) {
            chart.applyOptions({
              width: chartContainerRef.current.clientWidth,
              height: chartContainerRef.current.clientHeight,
            });
          }
        } catch(e) {}
        try {
          if (momentumChartContainerRef.current && momentumChart) {
            momentumChart.applyOptions({
              width: momentumChartContainerRef.current.clientWidth,
              height: momentumChartContainerRef.current.clientHeight,
            });
          }
        } catch(e) {}
        try {
          if (volumeChartContainerRef.current && volumeChart) {
            volumeChart.applyOptions({
              width: volumeChartContainerRef.current.clientWidth,
              height: volumeChartContainerRef.current.clientHeight,
            });
          }
        } catch(e) {}
      };

    const resizeObserver = new ResizeObserver(() => {
        handleResize();
    });

    if (chartContainerRef.current) resizeObserver.observe(chartContainerRef.current);
    if (momentumChartContainerRef.current) resizeObserver.observe(momentumChartContainerRef.current);
    if (volumeChartContainerRef.current) resizeObserver.observe(volumeChartContainerRef.current);

    window.addEventListener('resize', handleResize);

      return () => {
      isDisposed = true;
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      
      try { if (chart) chart.remove(); } catch (e) {}
      try { if (momentumChart) momentumChart.remove(); } catch (e) {}
      try { if (volumeChart) volumeChart.remove(); } catch (e) {}
      
      chartRef.current = null;
      momentumChartRef.current = null;
      volumeChartRef.current = null;
      candlestickSeriesRef.current = null;
      newsSeriesRef.current = null;

      bidPriceLineRef.current = null;
      askPriceLineRef.current = null;
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, []);

  useEffect(() => {
    if (candlestickSeriesRef.current) candlestickSeriesRef.current.applyOptions({ 
        visible: chartType === 'candles' || chartType === 'volume_profile' || chartType === 'footprint' 
    });
    if (lineCloseSeriesRef.current) {
        lineCloseSeriesRef.current.applyOptions({ 
            visible: chartType === 'line' || chartType === 'hlc',
            color: chartType === 'hlc' ? '#ffffff' : '#2962FF'
        });
    }
    if (lineHighSeriesRef.current) lineHighSeriesRef.current.applyOptions({ visible: chartType === 'hlc' });
    if (lineLowSeriesRef.current) lineLowSeriesRef.current.applyOptions({ visible: chartType === 'hlc' });
    if (fairValueSeriesRef.current) fairValueSeriesRef.current.applyOptions({ visible: chartType === 'money_flow' });
    if (upperBandSeriesRef.current) upperBandSeriesRef.current.applyOptions({ visible: showSdBands });
    if (lowerBandSeriesRef.current) lowerBandSeriesRef.current.applyOptions({ visible: showSdBands });
    if (sdFillSeriesRef.current) sdFillSeriesRef.current.applyOptions({ visible: showSdBands });
  }, [chartType, showSdBands]);

  useEffect(() => {
    if (candlestickSeriesRef.current) {
      const isSunset = chartTheme === 'sunset';
      candlestickSeriesRef.current.applyOptions({
        upColor: isSunset ? '#ffffff' : '#00e676',
        downColor: isSunset ? '#1f2937' : '#ff1744',
        wickUpColor: isSunset ? '#ffffff' : '#00e676',
        wickDownColor: isSunset ? '#1f2937' : '#ff1744',
      });
    }
  }, [chartTheme]);
  
  // HÃ m cáº­p nháº­t toáº¡ Ä‘á»™ HTML Overlay liÃªn tá»¥c
  const updateOverlays = () => {
    updateOverlaysRef.current = updateOverlays;
    try {
      if (chartRef.current && candlestickSeriesRef.current && canvasRef.current && chartContainerRef.current) {
        const timeScale = chartRef.current.timeScale();
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        
        let minTime = timeScale.coordinateToTime(0);
        let maxTime = timeScale.coordinateToTime(canvas.width);
        
        if (minTime !== null && typeof minTime === 'object') {
            minTime = new Date(Date.UTC(minTime.year, minTime.month - 1, minTime.day)).getTime() / 1000;
        }
        if (maxTime !== null && typeof maxTime === 'object') {
            maxTime = new Date(Date.UTC(maxTime.year, maxTime.month - 1, maxTime.day)).getTime() / 1000;
        }
        
        if (minTime === null) minTime = 0;
        if (maxTime === null) maxTime = Infinity;
        
        // Ensure canvas dimensions match its container
        const rect = chartContainerRef.current.getBoundingClientRect();
        if (canvas.width !== rect.width || canvas.height !== rect.height) {
          canvas.width = rect.width;
          canvas.height = rect.height;
        }
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // --- DRAW SESSION BACKGROUNDS FIRST ---
        if (sessionDataRef.current && sessionDataRef.current.length > 0) {
          const barSpacing = timeScale.options().barSpacing || 6;
          for (let i = 0; i < sessionDataRef.current.length; i++) {
             const session = sessionDataRef.current[i];
             if (session.time < minTime || session.time > maxTime) continue; // CULLING OFF-SCREEN SESSIONS
             const x = timeScale.timeToCoordinate(session.time);
             if (x !== null) {
               ctx.fillStyle = session.color;
               ctx.fillRect(x - barSpacing/2, 0, barSpacing, canvas.height);
             }
          }
        }
        
        // --- DRAW VP BOXES ---
        if (vpBoxes && vpBoxes.length > 0) {
          for (let i = 0; i < vpBoxes.length; i++) {
           const box = vpBoxes[i];
           if (box.end < minTime || box.start > maxTime) continue; // CULLING OFF-SCREEN BOXES
           const startX = timeScale.timeToCoordinate(box.start);
           let endX = timeScale.timeToCoordinate(box.end);
           
           if (startX === null && endX === null) continue;
           
           const topY = candlestickSeriesRef.current.priceToCoordinate(box.price + box.height/2);
           const bottomY = candlestickSeriesRef.current.priceToCoordinate(box.price - box.height/2);
           
           if (topY === null || bottomY === null) continue;
           
           let finalStartX = startX;
           if (startX === null) {
               finalStartX = (box.start < minTime) ? -1000 : canvas.width + 1000;
           }
           
           let finalEndX = endX;
           if (endX === null) {
               finalEndX = (box.end < minTime) ? -1000 : canvas.width + 1000;
           }
           
           const width = Math.max(1, finalEndX - finalStartX);
           // Fix: Äáº£m báº£o chiá»u cao tá»‘i thiá»ƒu lÃ  1 pixel Ä‘á»ƒ khÃ´ng bá»‹ biáº¿n máº¥t khi thu nhá» thanh giÃ¡ (sub-pixel rendering)
           const height = Math.max(1, Math.abs(bottomY - topY));
           
           ctx.fillStyle = box.color;
           ctx.fillRect(finalStartX, topY, width, height);
           
           // Removed strokeRect to make it look like solid background blocks like Orderflow TPOs
        }
        }
      } else if (canvasRef.current && vpBoxes.length === 0) {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      
      // --- DRAW VERTICAL LINES FOR PEAKS/BOTTOMS ON VOLUME CHART AND MOMENTUM CHART ---
      const drawVerticalLines = (targetChartRef, targetCanvasRef, targetContainerRef) => {
          if (targetChartRef.current && targetCanvasRef.current && targetContainerRef.current) {
             const timeScale = targetChartRef.current.timeScale(); 
             const canvas = targetCanvasRef.current;
             const ctx = canvas.getContext('2d');
             const rect = targetContainerRef.current.getBoundingClientRect();
             if (canvas.width !== rect.width || canvas.height !== rect.height) {
               canvas.width = rect.width;
               canvas.height = rect.height;
             }
             ctx.clearRect(0, 0, canvas.width, canvas.height);
             
             if (volStatsRef.current && volStatsRef.current.v_lines) {
               ctx.setLineDash([5, 5]);
               ctx.lineWidth = 1.5;
               for (let i = 0; i < volStatsRef.current.v_lines.length; i++) {
                  const line = volStatsRef.current.v_lines[i];
                  const tfSec = timeframe === 'M1' ? 60 : timeframe === 'M3' ? 180 : timeframe === 'M5' ? 300 : timeframe === 'M15' ? 900 : timeframe === 'M30' ? 1800 : timeframe === 'H1' ? 3600 : timeframe === 'H2' ? 7200 : timeframe === 'H4' ? 14400 : timeframe === 'H8' ? 28800 : timeframe === 'D1' ? 86400 : 3600;
                  const alignedTime = line.time - (line.time % tfSec);
                  const x = timeScale.timeToCoordinate(alignedTime);
                  if (x !== null) {
                    ctx.beginPath();
                    ctx.moveTo(x, 0);
                    ctx.lineTo(x, canvas.height);
                    ctx.strokeStyle = line.type === 'peak' ? 'rgba(0, 255, 0, 0.7)' : 'rgba(255, 0, 0, 0.7)';
                    ctx.stroke();
                  }
               }
               ctx.setLineDash([]);
             }
          }
      };

      drawVerticalLines(volumeChartRef, volumeCanvasRef, volumeChartContainerRef);
    } catch (e) {
    }
  };

  useEffect(() => {
    updateOverlaysRef.current = updateOverlays;
  }, [vpBoxes, chartType, showSdBands, volStats]);

  const handleGoToLatest = () => {
    if (chartRef.current && candlestickSeriesRef.current) {
        const data = candlestickSeriesRef.current.data();
        if (data && data.length > 0) {
            const totalCandles = data.length;
            const visibleBars = 50; // Zoom in to 50 candles
            const halfBars = Math.floor(visibleBars / 2);
            const startLogical = Math.max(0, totalCandles - 1 - halfBars);
            const endLogical = totalCandles - 1 + halfBars;
            const range = { from: startLogical, to: endLogical };

            chartRef.current.timeScale().setVisibleLogicalRange(range);
            if (momentumChartRef.current) momentumChartRef.current.timeScale().setVisibleLogicalRange(range);
            if (volumeChartRef.current) volumeChartRef.current.timeScale().setVisibleLogicalRange(range);
        }
    }
  };

  const isPollingRef = useRef(false);

  // Fetch data tá»« FastAPI backend
  const fetchData = async (isPolling = false, targetEndTime = 0, skipLoadingUI = false) => {
    // KhÃ´ng cho phÃ©p gá»­i Polling request náº¿u há»‡ thá»‘ng Ä‘ang báº­n táº£i Full Load
    if (isPolling && (loadingRef.current || isPollingRef.current)) return;
    if (isPolling) isPollingRef.current = true;
    
    const currentSymbol = symbol;
    if (!isPolling && !skipLoadingUI && candlestickSeriesRef.current) {
        candlestickSeriesRef.current.setData([]);
        if (vwapSeriesRef.current) vwapSeriesRef.current.setData([]);
        if (momentumSeriesRef.current) momentumSeriesRef.current.setData([]);
        if (normVolSeriesRef.current) normVolSeriesRef.current.setData([]);
        if (maVolSeriesRef.current) maVolSeriesRef.current.setData([]);
        lastVwapColorRef.current = null;
        lastMaVolColorRef.current = null;
        lastHl2ColorRef.current = null;
        lastBandwidthRef.current = null;
        lastSdColorRef.current = null;
        bandwidthHistoryRef.current = [];
        setVpBoxes([]);
        setVolStats(null);
        volStatsRef.current = null;
        sessionDataRef.current = [];
        if (newsSeriesRef.current) {
            try {
                newsSeriesRef.current.setMarkers([]);
            } catch (e) {}
        }
    }
    
    if (!isPolling && !skipLoadingUI) {
        // LÆ°u láº¡i Viewport hiá»‡n táº¡i trÆ°á»›c khi fetch dá»¯ liá»‡u má»›i
        if (chartRef.current) {
            try {
                const currentRange = chartRef.current.timeScale().getVisibleRange();
                if (currentRange) {
                    savedTimeRangeRef.current = currentRange;
                }
            } catch (e) {
                console.error("KhÃ´ng thá»ƒ láº¥y Viewport hiá»‡n táº¡i:", e);
            }
        }
        setLoading(true);
        loadingRef.current = true;
    }
    setError(null);
      
      try {
        if (!isPolling) {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            abortControllerRef.current = new AbortController();
        }
        
        const browserOffsetHours = -new Date().getTimezoneOffset() / 60;
        
        // Lá»c bá» cÃ¡c params khÃ´ng thuá»™c OHLCV API (email config, volMode...)
        const { emailSender, emailPassword, emailReceiver, volMode, ...ohlcvConfigs } = configs;
        
        const response = await axios.get(`${API_BASE}/api/v1/ohlcv`, {
          signal: !isPolling ? abortControllerRef.current.signal : undefined,
          params: { symbol, timeframe, count: 10000, end_time: targetEndTime, browserOffsetHours, latest_only: isPolling, _t: Date.now(), ...ohlcvConfigs }
        });
        
        // Bá» qua náº¿u response tráº£ vá» dá»¯ liá»‡u cá»§a symbol/timeframe cÅ© (Race condition)
        if (response.data.symbol && (response.data.symbol !== symbolRef.current || response.data.timeframe !== timeframeRef.current)) {
            return;
        }
        if (!chartRef.current || !candlestickSeriesRef.current) return;

                let rawData = response.data.data;
        // Deduplicate rawData by time to prevent Lightweight Charts "Value is not ascending" errors
        rawData.sort((a, b) => a.time - b.time);
        const uniqueRaw = [];
        let lastRawTime = -Infinity;
        for (const item of rawData) {
            if (item.time > lastRawTime) {
                uniqueRaw.push(item);
                lastRawTime = item.time;
            }
        }
        rawData = uniqueRaw;


        const newMomFlip = rawData.map(d => ({
          time: d.time,
          value: (d.mom_flip != null && !isNaN(d.mom_flip)) ? d.mom_flip : 0, 
          close: d.close,
          mom_raw: d.mom_raw
        })).sort((a,b)=>a.time - b.time);

        if (!isPolling) {
            setMomFlipData(newMomFlip);
        } else {
            setMomFlipData(prev => {
                const m = new Map(prev.map(i => [i.time, i]));
                newMomFlip.forEach(i => m.set(i.time, i));
                return Array.from(m.values()).sort((a,b)=>a.time - b.time);
            });
        }

        // Update price format for new symbol
        let precision = 5;
        let minMove = 0.00001;
        if (symbol.includes("JPY") || symbol.includes("XAG")) {
          precision = 3;
          minMove = 0.001;
        } else if (symbol.includes("XAU") || symbol.includes("GOLD") || symbol.includes("BTC") || symbol.includes("ETH") || symbol.includes("SOL")) {
          precision = 2;
          minMove = 0.01;
        } else if (symbol === "GLOBAL_INDEX" || symbol === "USDX") {
          precision = 3;
          minMove = 0.001;
        }
        const priceFormat = { type: 'price', precision, minMove };
        if (candlestickSeriesRef.current) candlestickSeriesRef.current.applyOptions({ priceFormat });
        if (upperBandSeriesRef.current) upperBandSeriesRef.current.applyOptions({ priceFormat });
        if (lowerBandSeriesRef.current) lowerBandSeriesRef.current.applyOptions({ priceFormat });
        if (vwapSeriesRef.current) vwapSeriesRef.current.applyOptions({ priceFormat });
        if (fairValueSeriesRef.current) fairValueSeriesRef.current.applyOptions({ priceFormat });
        if (lineCloseSeriesRef.current) lineCloseSeriesRef.current.applyOptions({ priceFormat });
        if (lineHighSeriesRef.current) lineHighSeriesRef.current.applyOptions({ priceFormat });
        if (lineLowSeriesRef.current) lineLowSeriesRef.current.applyOptions({ priceFormat });
        
        // Format náº¿n (há»— trá»£ khoáº£ng trá»‘ng thá»i gian - whitespace data)
        let formattedData = rawData
          .map(item => {
            if (item.open == null || item.high == null || item.low == null || item.close == null || isNaN(item.open) || isNaN(item.high) || isNaN(item.low) || isNaN(item.close)) {
              return { time: item.time };
            }
            return {
              time: item.time, 
              open: item.open,
              high: item.high,
              low: item.low,
              close: item.close,
              spread: item.spread || 0
            };
          })
          .filter(item => Number.isFinite(item.time))
          .sort((a, b) => a.time - b.time);
          
        // Deduplicate strictly ascending
        const uniqueData = [];
        let lastTime = -Infinity;
        for (const item of formattedData) {
            if (item.time > lastTime) {
                uniqueData.push(item);
                lastTime = item.time;
            }
        }
        formattedData = uniqueData;
        
        // Format VWAP & Bands
        const sortedRawForVwap = rawData.filter(d => d.vwap != null && !isNaN(d.vwap)).sort((a,b)=>a.time-b.time);
        const vwapData = sortedRawForVwap.map((item, index, arr) => {
            let col = '#39ff14'; // Máº·c Ä‘á»‹nh xanh
            if (index > 0) {
              if (item.vwap >= arr[index - 1].vwap) col = '#39ff14';
              else col = '#ff073a';
            } else if (lastVwapColorRef.current !== null) {
              col = lastVwapColorRef.current;
            }
            return { time: item.time, value: item.vwap, color: col };
          });
        if (vwapData.length > 0) {
          lastVwapColorRef.current = vwapData[vwapData.length - 1].color;
        }
          
          const isSunsetMom = chartTheme === 'sunset';
          const momentumData = rawData.filter(d => d.mom_raw != null && !isNaN(d.mom_raw)).map(item => {
            return {
              time: item.time,
              value: item.mom_raw,
              color: item.mom_raw >= 0 ? (isSunsetMom ? '#ffffff' : '#00e676') : (isSunsetMom ? '#1f2937' : '#ff1744')
            };
          }).sort((a,b)=>a.time-b.time);
          
        const m85Up = rawData.filter(d => d.mom_lvl1 != null && !isNaN(d.mom_lvl1)).map(i => ({time: i.time, value: i.mom_lvl1})).sort((a,b)=>a.time-b.time);
        const m85Dn = rawData.filter(d => d.mom_lvl1 != null && !isNaN(d.mom_lvl1)).map(i => ({time: i.time, value: -i.mom_lvl1})).sort((a,b)=>a.time-b.time);
        const m75Up = rawData.filter(d => d.mom_lvl2 != null && !isNaN(d.mom_lvl2)).map(i => ({time: i.time, value: i.mom_lvl2})).sort((a,b)=>a.time-b.time);
        const m75Dn = rawData.filter(d => d.mom_lvl2 != null && !isNaN(d.mom_lvl2)).map(i => ({time: i.time, value: -i.mom_lvl2})).sort((a,b)=>a.time-b.time);
        const m50Up = rawData.filter(d => d.mom_lvl3 != null && !isNaN(d.mom_lvl3)).map(i => ({time: i.time, value: i.mom_lvl3})).sort((a,b)=>a.time-b.time);
        const m50Dn = rawData.filter(d => d.mom_lvl3 != null && !isNaN(d.mom_lvl3)).map(i => ({time: i.time, value: -i.mom_lvl3})).sort((a,b)=>a.time-b.time);

        let projectedNormVol = [];
        if (configs.volMode === 'mean_vol') {
            const tfSec = timeframe === 'M1' ? 60 : timeframe === 'M3' ? 180 : timeframe === 'M5' ? 300 : timeframe === 'M15' ? 900 : timeframe === 'M30' ? 1800 : timeframe === 'H1' ? 3600 : timeframe === 'H2' ? 7200 : timeframe === 'H4' ? 14400 : timeframe === 'H8' ? 28800 : timeframe === 'D1' ? 86400 : 3600;
            let cTime = formattedData.length > 0 ? formattedData[formattedData.length - 1].time : Math.floor(Date.now() / 1000);
            cTime = cTime - (cTime % tfSec);
            
            const rawMap = new Map();
            rawData.forEach(d => rawMap.set(d.time, d));
            
            const futureTimes = generateFutureTimeline(cTime, tfSec, 1500);
            
            futureTimes.forEach(ft => {
                const pastTime = ft.time - (7 * 86400); // 1 week ago
                const pastRaw = rawMap.get(pastTime);
                if (pastRaw && pastRaw.mean_ma_vol != null && !isNaN(pastRaw.mean_ma_vol)) {
                    let color = 'rgba(156, 39, 176, 0.4)'; // Purple semi-transparent
                    const value = pastRaw.mean_ma_vol;
                    const lvl1 = pastRaw.mean_vol_lvl1;
                    const lvl2 = pastRaw.mean_vol_lvl2;
                    const lvl3 = pastRaw.mean_vol_lvl3;
                    const lvl4 = pastRaw.mean_vol_lvl4;
                    if (value <= lvl4) color = 'rgba(0, 51, 255, 0.4)';
                    else if (value <= lvl3) color = 'rgba(255, 140, 0, 0.4)';
                    else if (value <= lvl2) color = 'rgba(255, 255, 0, 0.4)';
                    else if (value <= lvl1) color = 'rgba(255, 23, 68, 0.4)';
                    
                    projectedNormVol.push({ time: ft.time, value: value, color });
                }
            });
        }

        let normVolData = rawData.filter(d => {
          if (configs.volMode === 'rvol') return d.rvol != null && !isNaN(d.rvol);
          if (configs.volMode === 'mean_vol') return d.mean_ma_vol != null && !isNaN(d.mean_ma_vol);
          return d.norm_vol != null && !isNaN(d.norm_vol);
        }).map(i => {
          let color = '#9c27b0';
          let value = i.norm_vol;
          if (configs.volMode === 'rvol') value = i.rvol;
          if (configs.volMode === 'mean_vol') value = i.mean_ma_vol;
          
          if (configs.volMode === 'rvol') {
            if (value < 0.5) color = '#0033ff'; 
            else if (value < 1.0) color = '#ff8c00'; 
            else if (value < 2.0) color = '#ffff00'; 
            else color = '#ff1744'; 
          } else {
            const lvl1 = configs.volMode === 'mean_vol' ? i.mean_vol_lvl1 : i.vol_lvl1;
            const lvl2 = configs.volMode === 'mean_vol' ? i.mean_vol_lvl2 : i.vol_lvl2;
            const lvl3 = configs.volMode === 'mean_vol' ? i.mean_vol_lvl3 : i.vol_lvl3;
            const lvl4 = configs.volMode === 'mean_vol' ? i.mean_vol_lvl4 : i.vol_lvl4;
            
            if (value <= lvl4) color = '#0033ff'; // Blue
            else if (value <= lvl3) color = '#ff8c00'; // Orange
            else if (value <= lvl2) color = '#ffff00'; // Yellow
            else if (value <= lvl1) color = '#ff1744'; // Red
          }
          return { time: i.time, value: value, color };
        }).sort((a,b)=>a.time-b.time);
        
        if (projectedNormVol.length > 0) {
            normVolData = [...normVolData, ...projectedNormVol].sort((a,b) => a.time - b.time);
        }

        const newSessionData = rawData.filter(i => i.session_color).map(i => ({
          time: i.time,
          color: i.session_color
        }));
        
        if (isPolling) {
          const existing = sessionDataRef.current || [];
          const tempMap = new Map();
          existing.forEach(s => tempMap.set(s.time, s));
          newSessionData.forEach(s => tempMap.set(s.time, s));
          sessionDataRef.current = Array.from(tempMap.values()).sort((a,b)=>a.time-b.time);
        } else {
          sessionDataRef.current = newSessionData.sort((a,b)=>a.time-b.time);
        }

        const sortedRawForMaVol = rawData.filter(d => d.ma_vol != null && !isNaN(d.ma_vol)).sort((a,b)=>a.time-b.time);
        const maVolData = sortedRawForMaVol.map((i, index, arr) => {
          let col = "rgba(128, 128, 128, 0.8)";
          if (index < arr.length - 1) {
            if (arr[index + 1].ma_vol >= i.ma_vol) col = "rgba(0, 255, 0, 1)";
            else col = "rgba(255, 0, 0, 1)";
          } else {
            if (index > 0) {
              if (i.ma_vol >= arr[index - 1].ma_vol) col = "rgba(0, 255, 0, 1)";
              else col = "rgba(255, 0, 0, 1)";
            } else if (lastMaVolColorRef.current !== null) {
              col = lastMaVolColorRef.current;
            }
          }
          return {time: i.time, value: i.ma_vol, color: col};
        });
        if (maVolData.length > 0) lastMaVolColorRef.current = maVolData[maVolData.length - 1].color;
        
        const lvl1Field = configs.volMode === 'mean_vol' ? 'mean_vol_lvl1' : 'vol_lvl1';
        const lvl2Field = configs.volMode === 'mean_vol' ? 'mean_vol_lvl2' : 'vol_lvl2';
        const lvl3Field = configs.volMode === 'mean_vol' ? 'mean_vol_lvl3' : 'vol_lvl3';
        const lvl4Field = configs.volMode === 'mean_vol' ? 'mean_vol_lvl4' : 'vol_lvl4';

        const v85 = configs.volMode === 'rvol' ? [] : rawData.filter(d => d[lvl1Field] != null && !isNaN(d[lvl1Field])).map(i => ({time: i.time, value: i[lvl1Field]})).sort((a,b)=>a.time-b.time);
        const v75 = configs.volMode === 'rvol' ? [] : rawData.filter(d => d[lvl2Field] != null && !isNaN(d[lvl2Field])).map(i => ({time: i.time, value: i[lvl2Field]})).sort((a,b)=>a.time-b.time);
        const v50 = configs.volMode === 'rvol' ? [] : rawData.filter(d => d[lvl3Field] != null && !isNaN(d[lvl3Field])).map(i => ({time: i.time, value: i[lvl3Field]})).sort((a,b)=>a.time-b.time);
        const v15 = configs.volMode === 'rvol' ? [] : rawData.filter(d => d[lvl4Field] != null && !isNaN(d[lvl4Field])).map(i => ({time: i.time, value: i[lvl4Field]})).sort((a,b)=>a.time-b.time);
        
        const sortedHl2Raw = rawData.filter(d => d.hl2 != null && !isNaN(d.hl2)).sort((a,b)=>a.time-b.time);
        const fairValueData = sortedHl2Raw.map((item, index, arr) => {
          let col = "rgba(128, 128, 128, 0.8)";
          if (index < arr.length - 1) {
            // Look ahead: color this segment based on direction from current to next
            if (arr[index + 1].hl2 >= item.hl2) col = "rgba(0, 255, 0, 1)";
            else col = "rgba(255, 0, 0, 1)";
          } else {
            // Last point: determine color by comparing with previous point
            if (index > 0) {
              if (item.hl2 >= arr[index - 1].hl2) col = "rgba(0, 255, 0, 1)";
              else col = "rgba(255, 0, 0, 1)";
            } else if (lastHl2ColorRef.current !== null) {
              col = lastHl2ColorRef.current;
            }
          }
          return { time: item.time, value: item.hl2, color: col };
        });
        if (fairValueData.length > 0) lastHl2ColorRef.current = fairValueData[fairValueData.length - 1].color;

        const upperBandData = [];
        const lowerBandData = [];
        const sdFillData = [];
        const bandwidthHistory = [...bandwidthHistoryRef.current];
        
        const isSunset = chartTheme === 'sunset';
        const colUp = isSunset ? "rgba(255, 255, 255, 0.9)" : "rgba(0, 230, 118, 0.9)";
        const colDn = isSunset ? "rgba(31, 41, 55, 0.9)" : "rgba(255, 23, 68, 0.9)";
        const fillUp = isSunset ? "rgba(255, 255, 255, 0.25)" : "rgba(0, 230, 118, 0.25)";
        const fillDn = isSunset ? "rgba(31, 41, 55, 0.25)" : "rgba(255, 23, 68, 0.15)";
        
        const sortedRawForSD = rawData.filter(d => d.upper_band != null && d.lower_band != null && !isNaN(d.upper_band)).sort((a,b)=>a.time-b.time);
        sortedRawForSD.forEach((item, index, arr) => {
            const rawBandwidth = item.upper_band - item.lower_band;
            bandwidthHistory.push(rawBandwidth);
            
            let col = "rgba(128, 128, 128, 0.9)"; 
            if (index < arr.length - 1) {
                // Look ahead: color based on next bandwidth vs current
                const nextRawBandwidth = arr[index + 1].upper_band - arr[index + 1].lower_band;
                if (nextRawBandwidth >= rawBandwidth) col = colUp;
                else col = colDn;
            } else {
                // Last point: fallback to comparing with previous
                if (index > 0) {
                    const prevRawBandwidth = arr[index - 1].upper_band - arr[index - 1].lower_band;
                    if (rawBandwidth >= prevRawBandwidth) col = colUp;
                    else col = colDn;
                } else if (lastSdColorRef.current !== null) {
                    col = lastSdColorRef.current;
                }
            }
            
            let fillColor = "rgba(128, 128, 128, 0.15)";
            if (col === colUp) fillColor = fillUp;
            else if (col === colDn) fillColor = fillDn;
            
            upperBandData.push({ 
                time: item.time, 
                value: item.upper_band, 
                color: col
            });
            lowerBandData.push({ 
                time: item.time, 
                value: item.lower_band, 
                color: col
            });
            sdFillData.push({
                time: item.time,
                open: item.upper_band,
                high: Math.max(item.upper_band, item.lower_band),
                low: Math.min(item.upper_band, item.lower_band),
                close: item.lower_band,
                color: fillColor
            });
        });
        if (upperBandData.length > 0) {
          lastSdColorRef.current = upperBandData[upperBandData.length - 1].color;
        }
        bandwidthHistoryRef.current = bandwidthHistory.slice(-10); // Keep last 10
        
        if (candlestickSeriesRef.current && chartRef.current) {
          if (isPolling) {
            const safeUpdate = (series, d) => {
              if (d.time >= lastUpdateTimeRef.current) {
                try { series.update(d); } catch (e) {}
              }
            };
            formattedData.forEach(d => {
                safeUpdate(candlestickSeriesRef.current, d);
                safeUpdate(lineCloseSeriesRef.current, { time: d.time, value: d.close });
                safeUpdate(lineHighSeriesRef.current, { time: d.time, value: d.high });
                safeUpdate(lineLowSeriesRef.current, { time: d.time, value: d.low });
                if (alertsSeriesRef.current) safeUpdate(alertsSeriesRef.current, { time: d.time, value: d.close });
            });
            vwapData.forEach(d => safeUpdate(vwapSeriesRef.current, d));
            if (fairValueSeriesRef.current) fairValueData.forEach(d => safeUpdate(fairValueSeriesRef.current, d));
            upperBandData.forEach(d => safeUpdate(upperBandSeriesRef.current, d));
            lowerBandData.forEach(d => safeUpdate(lowerBandSeriesRef.current, d));
            sdFillData.forEach(d => safeUpdate(sdFillSeriesRef.current, d));
            momentumData.forEach(d => safeUpdate(momentumSeriesRef.current, d));
            
            if (mom85UpRef.current) {
              m85Up.forEach(d => safeUpdate(mom85UpRef.current, d));
              m85Dn.forEach(d => safeUpdate(mom85DnRef.current, d));
              m75Up.forEach(d => safeUpdate(mom75UpRef.current, d));
              m75Dn.forEach(d => safeUpdate(mom75DnRef.current, d));
              m50Up.forEach(d => safeUpdate(mom50UpRef.current, d));
            }
            if (mom50DnRef.current) m50Dn.forEach(d => safeUpdate(mom50DnRef.current, d));
            
            if (formattedData.length > 0) {
              lastUpdateTimeRef.current = Math.max(lastUpdateTimeRef.current, formattedData[formattedData.length - 1].time);
            }
            
            if (updateOverlaysRef.current) setTimeout(() => updateOverlaysRef.current(), 200);
          } else {
            if (formattedData.length > 0) {
              lastUpdateTimeRef.current = formattedData[formattedData.length - 1].time;
            }
            candlestickSeriesRef.current.setData(formattedData);
            if (alertsSeriesRef.current) alertsSeriesRef.current.setData(formattedData.map(d => ({ time: d.time, value: d.close })));
            
            // Re-generate future timeline to ensure news markers don't compress when jumping in backtest
            if (newsSeriesRef.current && newsDataRef.current) {
                const tfSec = timeframe === 'M1' ? 60 : timeframe === 'M3' ? 180 : timeframe === 'M5' ? 300 : timeframe === 'M15' ? 900 : timeframe === 'M30' ? 1800 : timeframe === 'H1' ? 3600 : timeframe === 'H2' ? 7200 : timeframe === 'H4' ? 14400 : timeframe === 'H8' ? 28800 : timeframe === 'D1' ? 86400 : 3600;
                let cTime = formattedData.length > 0 ? formattedData[formattedData.length - 1].time : Math.floor(Date.now() / 1000);
                cTime = cTime - (cTime % tfSec);
                
                const futureTimes = generateFutureTimeline(cTime, tfSec, 1500);
                
                const allTimesMap = new Map();
                formattedData.forEach(d => allTimesMap.set(d.time, { time: d.time, value: 0 }));
                newsDataRef.current.forEach(ev => allTimesMap.set(ev.time, { time: ev.time, value: 0 }));
                futureTimes.forEach(ft => allTimesMap.set(ft.time, ft));
                
                const fullTimelineData = Array.from(allTimesMap.values()).sort((a,b) => a.time - b.time);
                const finalFullData = fullTimelineData.filter(d => d && Number.isFinite(d.time));
                
                if (newsSeriesRef.current) newsSeriesRef.current.setData(finalFullData);
                if (momentumDummySeriesRef.current) momentumDummySeriesRef.current.setData(finalFullData);
                if (volumeDummySeriesRef.current) volumeDummySeriesRef.current.setData(finalFullData);
            }
            lineCloseSeriesRef.current.setData(formattedData.map(d => ({ time: d.time, value: d.close })).filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
            lineHighSeriesRef.current.setData(formattedData.map(d => ({ time: d.time, value: d.high })).filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
            lineLowSeriesRef.current.setData(formattedData.map(d => ({ time: d.time, value: d.low })).filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
            vwapSeriesRef.current.setData(vwapData.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
            if (fairValueSeriesRef.current) fairValueSeriesRef.current.setData(fairValueData.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
            upperBandSeriesRef.current.setData(upperBandData.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
            lowerBandSeriesRef.current.setData(lowerBandData.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
            sdFillSeriesRef.current.setData(sdFillData.filter(d => d && Number.isFinite(d.high) && Number.isFinite(d.time)));
            momentumSeriesRef.current.setData(momentumData.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
            
            // Cáº­p nháº­t Ä‘Æ°á»ng Spread (Bid / Ask)
            if (formattedData.length > 0 && candlestickSeriesRef.current) {
                // Find the last item that actually has a close price (ignore future timeline records)
                let validLastItem = null;
                for (let i = formattedData.length - 1; i >= 0; i--) {
                    if (formattedData[i] && formattedData[i].close != null && Number.isFinite(formattedData[i].close)) {
                        validLastItem = formattedData[i];
                        break;
                    }
                }
                
                if (validLastItem) {
                    const bid = validLastItem.close;
                    let minMove = 0.00001;
                    if (symbol.includes("JPY")) minMove = 0.001;
                    else if (symbol.includes("XAU") || symbol.includes("GOLD") || symbol.includes("BTC") || symbol.includes("ETH") || symbol.includes("SOL")) minMove = 0.01;
                    const ask = bid + ((validLastItem.spread || 0) * minMove);
                    
                    if (Number.isFinite(ask) && Number.isFinite(bid)) {
                        if (!bidPriceLineRef.current && alertsSeriesRef.current) {
                            bidPriceLineRef.current = alertsSeriesRef.current.createPriceLine({
                                price: bid,
                                color: 'rgba(128, 128, 128, 0.7)',
                                lineWidth: 1,
                                lineStyle: 2,
                                axisLabelVisible: true,
                                title: 'Bid',
                            });
                        } else {
                            bidPriceLineRef.current.applyOptions({ price: bid });
                        }
                        
                        if (!askPriceLineRef.current && alertsSeriesRef.current) {
                            askPriceLineRef.current = alertsSeriesRef.current.createPriceLine({
                                price: ask,
                                color: 'rgba(255, 7, 58, 0.7)',
                                lineWidth: 1,
                                lineStyle: 2,
                                axisLabelVisible: true,
                                title: 'Ask',
                            });
                        } else {
                            askPriceLineRef.current.applyOptions({ price: ask });
                        }
                    }
                }
            }
            
            if (mom85UpRef.current) {
              mom85UpRef.current.setData(m85Up.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
              mom85DnRef.current.setData(m85Dn.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
              mom75UpRef.current.setData(m75Up.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
              mom75DnRef.current.setData(m75Dn.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
              mom50UpRef.current.setData(m50Up.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
            }
            if (mom50DnRef.current) mom50DnRef.current.setData(m50Dn.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
            
            if (normVolSeriesRef.current) {
              if (isPolling) {
                  normVolData.forEach(d => safeUpdate(normVolSeriesRef.current, d));
                  maVolData.forEach(d => safeUpdate(maVolSeriesRef.current, d));
                  v85.forEach(d => safeUpdate(vol85Ref.current, d));
                  v75.forEach(d => safeUpdate(vol75Ref.current, d));
                  v50.forEach(d => safeUpdate(vol50Ref.current, d));
                  v15.forEach(d => safeUpdate(vol15Ref.current, d));
              } else {
                  normVolSeriesRef.current.setData(normVolData.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
                  maVolSeriesRef.current.setData(maVolData.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
                  vol85Ref.current.setData(v85.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
                  vol75Ref.current.setData(v75.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
                  vol50Ref.current.setData(v50.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
                  vol15Ref.current.setData(v15.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
              }
            }
            
            if (updateOverlaysRef.current) setTimeout(() => updateOverlaysRef.current(), 200);
            
            const totalCandles = formattedData.length;
            
            if (savedTimeRangeRef.current) {
                try {
                    chartRef.current.timeScale().setVisibleRange(savedTimeRangeRef.current);
                    if (momentumChartRef.current) momentumChartRef.current.timeScale().setVisibleRange(savedTimeRangeRef.current);
                    if (volumeChartRef.current) volumeChartRef.current.timeScale().setVisibleRange(savedTimeRangeRef.current);
                    
                    const logical = chartRef.current.timeScale().getVisibleLogicalRange();
                    if (!logical || logical.from >= totalCandles || logical.to < 0 || Math.floor(logical.to) < Math.ceil(logical.from)) {
                        throw new Error("Out of bounds or empty view");
                    }
                } catch (e) {
                    // Log dáº¡ng thÃ´ng bÃ¡o bÃ¬nh thÆ°á»ng vÃ¬ Ä‘Ã¢y lÃ  cÆ¡ cháº¿ báº£o vá»‡ há»£p lá»‡
                    console.log("ÄÃ£ kÃ­ch hoáº¡t cÆ¡ cháº¿ Há»§y Neo Trá»¥c Y (Do vÃ¹ng thá»i gian cÅ© khÃ´ng cÃ³ dá»¯ liá»‡u á»Ÿ tÃ i sáº£n má»›i). Trá»Ÿ vá» Viewport máº·c Ä‘á»‹nh.");
                    const visibleBars = 50; // Zoom in to 50 candles
                    const halfBars = Math.floor(visibleBars / 2);
                    const startLogical = Math.max(0, totalCandles - 1 - halfBars);
                    const endLogical = totalCandles - 1 + halfBars; // Adds blank space to the right
                    const range = { from: startLogical, to: endLogical };

                    chartRef.current.timeScale().setVisibleLogicalRange(range);
                    if (momentumChartRef.current) momentumChartRef.current.timeScale().setVisibleLogicalRange(range);
                    if (volumeChartRef.current) volumeChartRef.current.timeScale().setVisibleLogicalRange(range);
                }
            } else {
                const visibleBars = 50; // Zoom in to 50 candles
                const halfBars = Math.floor(visibleBars / 2);
                const startLogical = Math.max(0, totalCandles - 1 - halfBars);
                const endLogical = totalCandles - 1 + halfBars; // Adds blank space to the right
                const range = { from: startLogical, to: endLogical };

                chartRef.current.timeScale().setVisibleLogicalRange(range);
                if (momentumChartRef.current) momentumChartRef.current.timeScale().setVisibleLogicalRange(range);
                if (volumeChartRef.current) volumeChartRef.current.timeScale().setVisibleLogicalRange(range);
            }
            
            // ÄÆ°a vÃ o setTimeout Ä‘á»ƒ trÃ¡nh race condition vá»›i hÃ m setData() cá»§a Lightweight Charts
            setTimeout(() => {
                const currentLogicalRange = chartRef.current ? chartRef.current.timeScale().getVisibleLogicalRange() : null;
                if (chartRef.current) {
                    chartRef.current.priceScale('right').applyOptions({ autoScale: false });
                    chartRef.current.priceScale('right').applyOptions({ autoScale: true });
                }
                if (momentumChartRef.current) {
                    if (currentLogicalRange) momentumChartRef.current.timeScale().setVisibleLogicalRange(currentLogicalRange);
                    momentumChartRef.current.priceScale('right').applyOptions({ autoScale: false });
                    momentumChartRef.current.priceScale('right').applyOptions({ autoScale: true });
                }
                if (volumeChartRef.current) {
                    if (currentLogicalRange) volumeChartRef.current.timeScale().setVisibleLogicalRange(currentLogicalRange);
                    volumeChartRef.current.priceScale('right').applyOptions({ autoScale: false });
                    volumeChartRef.current.priceScale('right').applyOptions({ autoScale: true });
                }
            }, 50);
            
            // XÃ³a bá»™ nhá»› táº¡m viewport sau khi Ä‘Ã£ Ã¡p dá»¥ng xong
            savedTimeRangeRef.current = null;
          }
        }
        
        // LÆ°u Volume Profile boxes
        if (response.data.indicators && response.data.indicators.vp_boxes) {
            setVpBoxes(response.data.indicators.vp_boxes);
        }
        
        if (response.data.indicators && response.data.indicators.vol_stats) {
            setVolStats(response.data.indicators.vol_stats);
            volStatsRef.current = response.data.indicators.vol_stats;
            if (window.updateTimelineForVLines) window.updateTimelineForVLines();
        }
        
        setLastUpdateSignal(Date.now());
      } catch (err) {
        if (axios.isCancel(err)) {
            // Silently ignore aborts
            return;
        }
        console.error("Error fetching data:", err);
        if (!isPolling) {
            setError(`KhÃ´ng thá»ƒ táº£i dá»¯ liá»‡u ${symbol}. HÃ£y kiá»ƒm tra MT5 vÃ  Backend (CÃ³ thá»ƒ mÃ£ khÃ´ng tá»“n táº¡i trÃªn sÃ n).`);
        }
        
        // XÃ³a dá»¯ liá»‡u cÅ© trÃªn biá»ƒu Ä‘á»“ Ä‘á»ƒ trÃ¡nh nháº§m láº«n
        if (!isPolling && candlestickSeriesRef.current) {
            candlestickSeriesRef.current.setData([]);
            if (vwapSeriesRef.current) vwapSeriesRef.current.setData([]);
            if (momentumSeriesRef.current) momentumSeriesRef.current.setData([]);
            if (normVolSeriesRef.current) normVolSeriesRef.current.setData([]);
            if (maVolSeriesRef.current) maVolSeriesRef.current.setData([]);
            setVpBoxes([]);
            setVolStats(null);
            volStatsRef.current = null;
            sessionDataRef.current = [];
            if (newsSeriesRef.current) {
                try {
                    newsSeriesRef.current.setMarkers([]);
                } catch (e) {}
            }
        }
      } finally {
        if (isPolling) {
            // Polling request Ã¢m tháº§m cháº¡y ngáº§m, khÃ´ng Ä‘Æ°á»£c phÃ©p Ä‘iá»u khiá»ƒn biáº¿n loading
            isPollingRef.current = false;
        } else if (!skipLoadingUI) {
            // TrÃ¬ hoÃ£n viá»‡c táº¯t Loading má»™t chÃºt Ä‘á»ƒ Lightweight Charts (Canvas) ká»‹p váº½ xong 10,000 náº¿n
            setTimeout(() => {
                setLoading(false);
                loadingRef.current = false;
            }, 300);
        }
      }
    };

  useEffect(() => {
    if (viewMode === 'chart') {
      fetchData();
      const intervalId = setInterval(() => {
        fetchData(true);
      }, 3000); // 3 giÃ¢y cáº­p nháº­t giÃ¡ 1 láº§n
      return () => clearInterval(intervalId);
    } else if (viewMode === 'backtest' && simulatedTimeRef.current) {
      // Khi Ä‘á»•i symbol hoáº·c timeframe trong lÃºc backtest
      fetchData(false, simulatedTimeRef.current);
      // Táº£i láº¡i tin tá»©c cho cáº·p tiá»n má»›i
      axios.get(`${API_BASE}/api/v1/news/backtest`, {
        params: { symbol, timestamp: simulatedTimeRef.current }
      }).then(response => {
        if (response.data.status === 'success') {
          let finalData = response.data.data;
          if (configs.timeShiftHours) {
            finalData = finalData.map(item => ({
               ...item,
               time: item.time + (configs.timeShiftHours * 3600)
            }));
          }
          setNewsData(finalData);
        }
      }).catch(e => console.error(e));
    }
  }, [symbol, timeframe, configs, viewMode, chartTheme]);

  // Backtest Playback Loop
  const getWeekMonday = (timestamp) => {
    const d = new Date(timestamp * 1000);
    const day = d.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day; // Monday = 1
    d.setUTCDate(d.getUTCDate() + diff);
    d.setUTCHours(0, 0, 0, 0);
    return Math.floor(d.getTime() / 1000);
  };

  useEffect(() => {
    let timeoutId;
    
    const playNext = async () => {
      if (viewMode !== 'backtest' || !isPlayingRef.current) return;
      
      const tfSec = timeframe === 'M1' ? 60 : timeframe === 'M3' ? 180 : timeframe === 'M5' ? 300 : timeframe === 'M15' ? 900 : timeframe === 'M30' ? 1800 : timeframe === 'H1' ? 3600 : timeframe === 'H2' ? 7200 : timeframe === 'H4' ? 14400 : timeframe === 'H8' ? 28800 : timeframe === 'D1' ? 86400 : 3600;
      const speed = playbackSpeedRef.current;
      // Äá»ƒ trÃ¡nh quÃ¡ táº£i API khi speed cao, ta tá»± Ä‘á»™ng gá»™p nhiá»u náº¿n vÃ o 1 nhá»‹p (tick)
      let candlesPerTick = 1;
      let targetDelay = 1000 / speed;
      
      if (speed >= 50) {
          candlesPerTick = Math.floor(speed / 10);
          targetDelay = 1000 / 10; // Giá»›i háº¡n max 10 tick/giÃ¢y Ä‘á»ƒ mÆ°á»£t
      } else if (speed >= 10) {
          candlesPerTick = 2;
          targetDelay = 1000 / (speed / 2);
      }
      
      const isCrypto = symbol.includes("BTC") || symbol.includes("ETH") || symbol.includes("SOL") || symbol.includes("XRP") || symbol.includes("CRYPTO");
      
      // Tiáº¿n nhiá»u náº¿n cÃ¹ng lÃºc, chá»‰ gá»i API 1 láº§n á»Ÿ cuá»‘i
      for (let step = 0; step < candlesPerTick; step++) {
        simulatedTimeRef.current += tfSec;
        
        // Bá» qua Thá»© 7, Chá»§ Nháº­t Ä‘á»ƒ Backtest khÃ´ng bá»‹ "treo" (trá»« Crypto)
        if (!isCrypto) {
            const d = new Date(simulatedTimeRef.current * 1000);
            const day = d.getUTCDay();
            const h = d.getUTCHours();
            const m = d.getUTCMinutes();
            const s = d.getUTCSeconds();
            
            let skip = false;
            let jumpHours = 0;
            
            if (day === 5 && h >= 22) {
                skip = true;
                jumpHours = 24 - h + 24 + 21;
            } else if (day === 6) {
                skip = true;
                jumpHours = 24 - h + 21;
            } else if (day === 0 && h < 21) {
                skip = true;
                jumpHours = 21 - h;
            }
            
            if (skip) {
                simulatedTimeRef.current += (jumpHours * 3600) - (m * 60) - s;
            }
        }
      }
      
      // Cáº­p nháº­t thá»i gian giáº£ láº­p 1 láº§n duy nháº¥t sau khi tiáº¿n xong
      window.currentSimulatedTime = simulatedTimeRef.current;
      window.dispatchEvent(new Event('simulatedTimeChanged'));
      
      // PhÃ¡t hiá»‡n qua tuáº§n má»›i -> táº£i tin tá»©c tuáº§n má»›i
      const currentMonday = getWeekMonday(simulatedTimeRef.current);
      if (currentMonday !== backtestWeekRef.current) {
        backtestWeekRef.current = currentMonday;
        try {
          const response = await axios.get(`${API_BASE}/api/v1/news/backtest`, {
            params: { symbol, timestamp: simulatedTimeRef.current }
          });
          if (response.data.status === 'success') {
            let newEvents = response.data.data;
            if (configs.timeShiftHours) {
              newEvents = newEvents.map(item => ({
                 ...item,
                 time: item.time + (configs.timeShiftHours * 3600)
              }));
            }
            setNewsData(prev => {
              const existingKeys = new Set(prev.map(e => `${e.time}_${e.title}`));
              const merged = [...prev];
              newEvents.forEach(ev => {
                const key = `${ev.time}_${ev.title}`;
                if (!existingKeys.has(key)) {
                  merged.push(ev);
                }
              });
              return merged;
            });
          }
        } catch (e) {
          console.error("Failed to fetch next week news", e);
        }
      }
      
      // LuÃ´n dÃ¹ng polling (safeUpdate) cho mÆ°á»£t vÃ¬ candlesPerTick = 1
      await fetchData(true, simulatedTimeRef.current);
      
      if (isPlayingRef.current && viewMode === 'backtest') {
        timeoutId = setTimeout(playNext, targetDelay);
      }
    };

    if (viewMode === 'backtest' && isPlaying) {
      playNext();
    }
    
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [viewMode, isPlaying, timeframe]);

  const handleLoadBacktest = async () => {
    if (!backtestDate) {
      alert("Vui lÃ²ng chá»n ngÃ y giá» Backtest!");
      return;
    }
    const targetTimestamp = Math.floor(new Date(backtestDate).getTime() / 1000);
    simulatedTimeRef.current = targetTimestamp;
    window.currentSimulatedTime = simulatedTimeRef.current;
    window.dispatchEvent(new Event('simulatedTimeChanged'));
    backtestWeekRef.current = getWeekMonday(targetTimestamp);
    setIsPlaying(false);
    isPlayingRef.current = false;
    newsDataRef.current = []; // Clear stale news data so futureTimes aligns properly before new news arrives
    fetchData(false, targetTimestamp);
    
    // Táº£i tin tá»©c lá»‹ch sá»­ cho backtest
    try {
      const response = await axios.get(`${API_BASE}/api/v1/news/backtest`, {
        params: { symbol, timestamp: targetTimestamp }
      });
      if (response.data.status === 'success') {
        let finalData = response.data.data;
        if (configs.timeShiftHours) {
          finalData = finalData.map(item => ({
             ...item,
             time: item.time + (configs.timeShiftHours * 3600)
          }));
        }
        setNewsData(finalData);
      }
    } catch (e) {
      console.error("Failed to fetch backtest news", e);
    }
  };
  
  const togglePlay = () => {
    const newPlayState = !isPlaying;
    setIsPlaying(newPlayState);
    isPlayingRef.current = newPlayState;
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
        {viewMode === 'backtest' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px', padding: '10px 15px', background: 'rgba(0, 0, 0, 0.2)', borderBottom: '1px solid var(--border-color)', zIndex: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Chá»n Äiá»ƒm Báº¯t Äáº§u:</label>
              <input 
                type="datetime-local" 
                value={backtestDate}
                onChange={(e) => setBacktestDate(e.target.value)}
                style={{ padding: '6px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: '4px' }}
              />
              <button onClick={handleLoadBacktest} className="primary" style={{ padding: '6px 12px' }}>Táº£i Dá»¯ Liá»‡u</button>
            </div>
            
            <div style={{ width: '1px', height: '24px', background: 'var(--border-color)' }}></div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button onClick={togglePlay} style={{ padding: '6px 16px', background: isPlaying ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)', color: isPlaying ? '#ef4444' : '#10b981', border: 'none', fontWeight: 'bold' }}>
                {isPlaying ? 'â¸ Dá»«ng' : 'â–¶ PhÃ¡t'}
              </button>
              
              <select 
                value={playbackSpeed} 
                onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
                style={{ padding: '6px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: '4px' }}
              >
                <option value={0.25}>0.25x</option>
                <option value={0.5}>0.5x</option>
                <option value={1}>1x (1 náº¿n/s)</option>
                <option value={2}>2x</option>
                <option value={5}>5x</option>
                <option value={10}>10x</option>
                <option value={20}>20x</option>
                <option value={50}>50x</option>
                <option value={100}>100x (Siêu nhanh)</option>
              </select>
            </div>
            
            <div style={{ marginLeft: 'auto', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Thá»i gian giáº£ láº­p: {simulatedTimeRef.current ? new Date(simulatedTimeRef.current * 1000).toLocaleString() : 'ChÆ°a táº£i'}
            </div>
          </div>
        )}
        {loading && (
          <div style={{ 
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', 
            zIndex: 100, background: 'rgba(0, 0, 0, 0.85)', padding: '25px 50px', borderRadius: '12px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.8)',
            border: '1px solid rgba(255,255,255,0.1)'
          }}>
            <div className="spinner" style={{ marginBottom: '15px' }}></div>
            <div style={{ color: '#60a5fa', fontSize: '1.2rem', fontWeight: 'bold' }}>Äang táº£i dá»¯ liá»‡u {symbol}...</div>
            <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginTop: '5px', marginBottom: '15px' }}>Vui lÃ²ng Ä‘á»£i trong giÃ¢y lÃ¡t</div>
            <button 
              onClick={() => {
                if (abortControllerRef.current) {
                    abortControllerRef.current.abort();
                }
                setLoading(false);
                loadingRef.current = false;
                setError("NgÆ°á»i dÃ¹ng Ä‘Ã£ há»§y táº£i dá»¯ liá»‡u. (Báº¥m chá»n mÃ£ hoáº·c khung thá»i gian khÃ¡c Ä‘á»ƒ táº£i láº¡i)");
              }}
              style={{
                background: '#ef4444', color: 'white', border: 'none', padding: '8px 16px',
                borderRadius: '6px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 'bold'
              }}
            >
              Há»§y TÃ¡c Vá»¥
            </button>
          </div>
        )}
        {error && (
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 10, color: '#ef4444' }}>
            {error}
          </div>
        )}
        
        {/* Main Chart */}
        <div style={{ flex: 3, position: 'relative', width: '100%', overflow: 'hidden' }}>
          <div ref={chartContainerRef} style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }} />
          <canvas 
            ref={canvasRef} 
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 5 }} 
          />
          {isScrolled && (
            <button
              onClick={handleGoToLatest}
              style={{
                position: 'absolute',
                bottom: '30px',
                right: '70px',
                width: '42px',
                height: '42px',
                borderRadius: '50%',
                background: 'rgba(59, 130, 246, 0.8)',
                color: 'white',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 10,
                boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
                transition: 'all 0.2s',
              }}
              title="Go to latest"
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(59, 130, 246, 1)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.8)'}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14"></path>
                <path d="M12 5l7 7-7 7"></path>
              </svg>
            </button>
          )}

          {rrTools.map(tool => (
            <RrTool 
              key={tool.id} 
              tool={tool} 
              chart={chartRef.current} 
              series={candlestickSeriesRef.current} 
              onDelete={() => deleteRrTool(tool.id)} 
              onUpdate={updateRrTool} 
            />
          ))}
        </div>
        
        {/* Momentum Chart */}
        <div style={{ flex: showMomChart ? 1 : 0, display: showMomChart ? 'block' : 'none', position: 'relative', width: '100%', borderTop: '2px solid var(--border-color)' }}>
          <div ref={momentumChartContainerRef} style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }} />
        </div>
        
        {/* Normalized Volume Chart */}
        <div style={{ flex: showVolChart ? 1 : 0, display: showVolChart ? 'block' : 'none', position: 'relative', width: '100%', borderTop: '2px solid var(--border-color)' }}>
          <div ref={volumeChartContainerRef} style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }} />
          <canvas 
            ref={volumeCanvasRef} 
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 5 }} 
          />
        </div>
        
        {/* Modal News Details */}
        {selectedNewsGroup && (
          <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '8px', minWidth: '400px', maxWidth: '600px', border: '1px solid var(--border-color)', color: 'white', boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>
              <h2 style={{ margin: '0 0 15px 0', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
                Tin tá»©c lÃºc {new Date((selectedNewsGroup[0].originalTime || selectedNewsGroup[0].time) * 1000).toLocaleTimeString([], {timeZone: 'UTC', hour: '2-digit', minute:'2-digit'})} ngÃ y {new Date((selectedNewsGroup[0].originalTime || selectedNewsGroup[0].time) * 1000).toLocaleDateString('vi-VN', {timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric'})}
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '60vh', overflowY: 'auto' }}>
                {selectedNewsGroup.map((ev, idx) => (
                  <div key={idx} style={{ background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '4px', borderLeft: `4px solid ${ev.impact === 'High' ? '#f23645' : ev.impact === 'Medium' ? '#ff9800' : '#787b86'}` }}>
                    <div style={{ fontWeight: 'bold', fontSize: '1.1rem', marginBottom: '5px' }}>{ev.country} - {ev.title}</div>
                    <div style={{ display: 'flex', gap: '15px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                      <div><strong>Táº§m quan trá»ng:</strong> {ev.impact}</div>
                    </div>
                    <div style={{ display: 'flex', gap: '15px', fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '5px' }}>
                      <div><strong>Dá»± bÃ¡o:</strong> {ev.forecast || '-'}</div>
                      <div><strong>Thá»±c táº¿:</strong> {ev.actual || '-'}</div>
                      <div><strong>Ká»³ trÆ°á»›c:</strong> {ev.previous || '-'}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
                <button onClick={() => setSelectedNewsGroup(null)} style={{ padding: '8px 16px', background: 'var(--accent-color)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>ÄÃ³ng</button>
              </div>
            </div>
          </div>
        )}

        {/* Custom Context Menu */}
        {contextMenu && (
          <div className="custom-context-menu-wrapper" style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            boxShadow: '0 4px 15px rgba(0,0,0,0.5)',
            padding: '5px 0',
            zIndex: 1000,
            minWidth: '180px'
          }}>
            <div 
              className="context-menu-item"
              onClick={() => {
                navigator.clipboard.writeText(contextMenu.price.toFixed(5));
                closeContextMenu();
              }}
            >
              ðŸ“‹ Sao chÃ©p giÃ¡ ({contextMenu.price.toFixed(5)})
            </div>
            <div 
              className="context-menu-item"
              onClick={() => {
                setCustomAlertModal({
                  type: 'price',
                  price: contextMenu.price.toFixed(5),
                  symbol: contextMenu.symbol
                });
                closeContextMenu();
              }}
            >
              â° ThÃªm cáº£nh bÃ¡o giÃ¡...
            </div>
            <div 
              className="context-menu-item"
              onClick={() => {
                setCustomAlertModal({
                  type: 'mom',
                  price: '75',
                  symbol: contextMenu.symbol
                });
                closeContextMenu();
              }}
            >
              ðŸŒŠ ThÃªm cáº£nh bÃ¡o % Mom Flip...
            </div>
            
            <div 
              className="context-menu-item"
              onClick={() => handleAddDrawnLine(contextMenu.price)}
            >
              âž– Káº» Ä‘Æ°á»ng ngang...
            </div>
            {drawnLines.filter(l => l.symbol === symbol).length > 0 && (
                <div 
                  className="context-menu-item"
                  style={{ color: '#ef4444' }}
                  onClick={() => handleRemoveNearestDrawnLine(contextMenu.price)}
                >
                  âŒ XÃ³a Ä‘Æ°á»ng ngang gáº§n nháº¥t
                </div>
            )}
            
            <div 
              className="context-menu-item"
              onClick={() => {
                addRrTool('long', contextMenu.price, contextMenu.logical);
                closeContextMenu();
              }}
            >
              ðŸ“ˆ ThÃªm RR Mua (Long)
            </div>
            <div 
              className="context-menu-item"
              onClick={() => {
                addRrTool('short', contextMenu.price, contextMenu.logical);
                closeContextMenu();
              }}
            >
              ðŸ“‰ ThÃªm RR BÃ¡n (Short)
            </div>
          </div>
        )}

        {/* Custom Alert Modal */}
        {customAlertModal && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1001
          }}>
            <div style={{
              background: '#1e293b', padding: '24px', borderRadius: '12px',
              border: '1px solid var(--border-color)', width: '350px',
              boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
              display: 'flex', flexDirection: 'column', gap: '15px'
            }}>
              <h3 style={{ margin: 0, color: 'white' }}>
                {customAlertModal.type === 'mom' ? 'ThÃªm cáº£nh bÃ¡o % Mom Flip' : 'ThÃªm cáº£nh bÃ¡o giÃ¡'}
              </h3>
              
              <div>
                <label style={{ display: 'block', marginBottom: '5px', color: '#94a3b8', fontSize: '0.9rem' }}>Cáº·p giao dá»‹ch</label>
                <div style={{ color: '#eab308', fontWeight: 'bold', fontSize: '1.1rem' }}>{customAlertModal.symbol}</div>
              </div>
              
              <div>
                <label style={{ display: 'block', marginBottom: '5px', color: '#94a3b8', fontSize: '0.9rem' }}>
                  {customAlertModal.type === 'mom' ? 'Má»©c % Mom Flip' : 'Má»©c giÃ¡'}
                </label>
                <input 
                  type="number" 
                  value={customAlertModal.price} 
                  onChange={(e) => setCustomAlertModal({...customAlertModal, price: e.target.value})}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-color)', color: 'white', fontWeight: 'bold' }} 
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '5px', color: '#94a3b8', fontSize: '0.9rem' }}>Ghi chÃº (TÃ¹y chá»n)</label>
                <input 
                  type="text" 
                  placeholder="Nháº­p ghi chÃº..."
                  value={alertNoteInput}
                  onChange={(e) => setAlertNoteInput(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (handleAddAlert) {
                        handleAddAlert({
                            symbol: customAlertModal.symbol,
                            type: customAlertModal.type || 'price',
                            timeframe: timeframe,
                            price: parseFloat(customAlertModal.price),
                            note: alertNoteInput
                        });
                      }
                      setCustomAlertModal(null);
                      setAlertNoteInput('');
                    }
                  }}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', background: 'rgba(0,0,0,0.3)', border: '1px solid #3b82f6', color: 'white', outline: 'none' }} 
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button onClick={() => { setCustomAlertModal(null); setAlertNoteInput(''); }}>Há»§y</button>
                <button className="primary" onClick={() => {
                  if (handleAddAlert) {
                    handleAddAlert({
                        symbol: customAlertModal.symbol,
                        type: customAlertModal.type || 'price',
                        timeframe: timeframe,
                        price: parseFloat(customAlertModal.price),
                        note: alertNoteInput
                    });
                  }
                  setCustomAlertModal(null);
                  setAlertNoteInput('');
                }}>LÆ°u Cáº£nh BÃ¡o</button>
              </div>
            </div>
          </div>
        )}
        {showMomFlipChart && <MomFlipChartComponent data={momFlipData} mainChart={chartRef.current} mainSeries={candlestickSeriesRef.current} alerts={alerts} symbol={symbol} chartTheme={chartTheme} />}
      </div>
  );
};

const MatrixComponent = ({ simulatedTime, brokerTimezone, initialMatrixHours, initialMatrixVolDays, onSaveMatrixSettings, symbol }) => {
  const [matrixData, setMatrixData] = useState(null);
  const [matrixDataLong, setMatrixDataLong] = useState(null);
  const [matrixDataTrend, setMatrixDataTrend] = useState(null);
  const [matrixDataTrendLong, setMatrixDataTrendLong] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [matrixHours, setMatrixHours] = useState(initialMatrixHours || Number(localStorage.getItem('currencyMatrixHours')) || 24);
  const [matrixHoursLong, setMatrixHoursLong] = useState(Number(localStorage.getItem('currencyMatrixHoursLong')) || 89);
  const [matrixVolDays, setMatrixVolDays] = useState(initialMatrixVolDays || Number(localStorage.getItem('currencyMatrixVolDays')) || 30);
  const [matrixType, setMatrixType] = useState((localStorage.getItem('matrixType') === 'currency' ? 'fx' : localStorage.getItem('matrixType')) || 'fx');

  // Tá»± Ä‘á»™ng Ä‘á»•i nhÃ³m tÃ i sáº£n theo symbol Ä‘ang xem
  useEffect(() => {
    if (symbol) {
      const autoType = getMatrixTypeForSymbol(symbol);
      setMatrixType(autoType);
      localStorage.setItem('matrixType', autoType);
    }
  }, [symbol]);

  useEffect(() => {
    if (initialMatrixHours) setMatrixHours(initialMatrixHours);
    if (initialMatrixVolDays) setMatrixVolDays(initialMatrixVolDays);
  }, [initialMatrixHours, initialMatrixVolDays]);

  useEffect(() => {
    let interval;
    if (loading) {
      interval = setInterval(async () => {
        try {
          const res = await axios.get(`${API_BASE}/api/v1/matrix/progress?matrix_type=${matrixType}`);
          setProgress(res.data.progress || 0);
        } catch (e) {}
      }, 500);
    } else {
      setProgress(0);
    }
    return () => clearInterval(interval);
  }, [loading, matrixType]);


  const fetchMatrix = async (force = false) => {
    if (force && onSaveMatrixSettings) {
      onSaveMatrixSettings(matrixHours, matrixVolDays);
    }
    // KhÃ´ng dÃ¹ng cache náº¿u Ä‘ang á»Ÿ cháº¿ Ä‘á»™ backtest
    if (!force && !simulatedTime) {
      const cached = localStorage.getItem(`matrixCache_${matrixType}`);
      const cachedTime = localStorage.getItem(`matrixCacheTime_${matrixType}`);
      const cachedHours = localStorage.getItem(`matrixCacheHours_${matrixType}`);
      const cachedHoursLong = localStorage.getItem(`matrixCacheHoursLong_${matrixType}`);
      const cachedVolDays = localStorage.getItem(`matrixCacheVolDays_${matrixType}`);
      if (cached && cachedTime && cachedHours == matrixHours && cachedHoursLong == matrixHoursLong && cachedVolDays == matrixVolDays) {
        const age = Date.now() - parseInt(cachedTime);
        if (age < 60 * 1000) {
          const parsed = JSON.parse(cached);
          setMatrixData(parsed.short);
          setMatrixDataLong(parsed.long);
          setMatrixDataTrend(parsed.trendShort);
          setMatrixDataTrendLong(parsed.trendLong);
          return;
        }
      }
    }
    
    setLoading(true);
    try {
      const [resFlowShort, resFlowLong, resTrendShort, resTrendLong] = await Promise.all([
        axios.get(`${API_BASE}/api/v1/matrix`, { params: { n_hours: matrixHours, vol_days: matrixVolDays, matrix_type: matrixType, end_time: simulatedTime || 0, brokerTimezone, matrix_mode: 'money_flow' } }),
        axios.get(`${API_BASE}/api/v1/matrix`, { params: { n_hours: matrixHoursLong, vol_days: matrixVolDays, matrix_type: matrixType, end_time: simulatedTime || 0, brokerTimezone, matrix_mode: 'money_flow' } }),
        axios.get(`${API_BASE}/api/v1/matrix`, { params: { n_hours: matrixHours, vol_days: matrixVolDays, matrix_type: matrixType, end_time: simulatedTime || 0, brokerTimezone, matrix_mode: 'trend' } }),
        axios.get(`${API_BASE}/api/v1/matrix`, { params: { n_hours: matrixHoursLong, vol_days: matrixVolDays, matrix_type: matrixType, end_time: simulatedTime || 0, brokerTimezone, matrix_mode: 'trend' } })
      ]);
      setMatrixData(resFlowShort.data);
      setMatrixDataLong(resFlowLong.data);
      setMatrixDataTrend(resTrendShort.data);
      setMatrixDataTrendLong(resTrendLong.data);
      
      if (!simulatedTime) {
          const combo = { 
            short: resFlowShort.data, long: resFlowLong.data,
            trendShort: resTrendShort.data, trendLong: resTrendLong.data 
          };
          localStorage.setItem(`matrixCache_${matrixType}`, JSON.stringify(combo));
          localStorage.setItem(`matrixCacheTime_${matrixType}`, Date.now().toString());
          localStorage.setItem(`matrixCacheHours_${matrixType}`, matrixHours.toString());
          localStorage.setItem(`matrixCacheHoursLong_${matrixType}`, matrixHoursLong.toString());
          localStorage.setItem(`matrixCacheVolDays_${matrixType}`, matrixVolDays.toString());
      }
      localStorage.setItem('currencyMatrixHours', matrixHours.toString());
      localStorage.setItem('currencyMatrixHoursLong', matrixHoursLong.toString());
      localStorage.setItem('currencyMatrixVolDays', matrixVolDays.toString());
      localStorage.setItem('matrixType', matrixType);
    } catch (err) {
      console.error("Error fetching matrix:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMatrix(false);
    
    // Tá»± Ä‘á»™ng lÃ m má»›i Ma tráº­n má»—i 15 phÃºt
    const intervalId = setInterval(() => {
      fetchMatrix(true);
    }, 5 * 60 * 1000);
    
    return () => clearInterval(intervalId);
  }, [matrixType]);

  if (!matrixData) {
    if (loading) {
      return (
        <div style={{ padding: '50px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'white' }}>
          <div style={{ fontSize: '1.2rem', marginBottom: '15px', color: '#60a5fa', fontWeight: 'bold' }}>
            Äang tÃ­nh toÃ¡n ma tráº­n... {progress}%
          </div>
          <div style={{ width: '300px', height: '10px', background: '#374151', borderRadius: '5px', overflow: 'hidden' }}>
            <div style={{ width: `${progress}%`, height: '100%', background: '#3b82f6', transition: 'width 0.3s ease' }}></div>
          </div>
        </div>
      );
    }
    return null;
  }

  return (
    <div style={{ padding: '20px', display: 'flex', gap: '40px', color: 'var(--text-primary)', flexDirection: 'column', position: 'relative' }}>
      
      {loading && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.7)', zIndex: 10,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(4px)', borderRadius: '12px'
        }}>
          <div style={{ fontSize: '1.2rem', marginBottom: '15px', color: '#60a5fa', fontWeight: 'bold' }}>
            Äang tÃ­nh toÃ¡n láº¡i ma tráº­n... {progress}%
          </div>
          <div style={{ width: '300px', height: '10px', background: '#374151', borderRadius: '5px', overflow: 'hidden' }}>
            <div style={{ width: `${progress}%`, height: '100%', background: '#3b82f6', transition: 'width 0.3s ease' }}></div>
          </div>
        </div>
      )}

      {/* Header Ä‘iá»u khiá»ƒn */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '15px', background: 'var(--bg-panel)', padding: '15px 20px', borderRadius: '12px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '10px', marginRight: '15px', borderRight: '1px solid #4b5563', paddingRight: '15px' }}>
          {['fx', 'us_stocks', 'commodities', 'crypto', 'usd_assets'].map(type => (
            <button
              key={type}
              onClick={() => setMatrixType(type)}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                border: 'none',
                background: matrixType === type ? '#3b82f6' : '#374151',
                color: 'white',
                cursor: 'pointer',
                fontWeight: matrixType === type ? 'bold' : 'normal',
                fontSize: '0.9rem'
              }}
            >
              {type === 'fx' ? 'Forex' : type === 'us_stocks' ? 'Cá»• phiáº¿u Má»¹' : type === 'commodities' ? 'HÃ ng hÃ³a' : type === 'crypto' ? 'Crypto' : 'USD vs Assets'}
            </button>
          ))}
        </div>
        
        <div style={{ display: 'flex', gap: '10px', marginRight: '15px', borderRight: '1px solid #4b5563', paddingRight: '15px' }}>
          {/* matrix mode toggle removed as both are shown */}
        </div>
        
        <label>Ngáº¯n háº¡n (Giá»):</label>
        <input 
          type="number" 
          value={matrixHours} 
          onChange={e => { const val = Number(e.target.value); setMatrixHours(val); localStorage.setItem('currencyMatrixHours', val.toString()); }}
          style={{ padding: '5px 10px', borderRadius: '5px', border: '1px solid #4b5563', background: '#374151', color: 'white', width: '70px' }}
        />
        
        <label style={{ marginLeft: '10px' }}>DÃ i háº¡n (Giá»):</label>
        <input 
          type="number" 
          value={matrixHoursLong} 
          onChange={e => { const val = Number(e.target.value); setMatrixHoursLong(val); localStorage.setItem('currencyMatrixHoursLong', val.toString()); }}
          style={{ padding: '5px 10px', borderRadius: '5px', border: '1px solid #4b5563', background: '#374151', color: 'white', width: '70px' }}
        />
        
        <label style={{ marginLeft: '10px' }}>Volume (NgÃ y):</label>
        <input 
          type="number" 
          value={matrixVolDays} 
          onChange={e => { const val = Number(e.target.value); setMatrixVolDays(val); localStorage.setItem('currencyMatrixVolDays', val.toString()); }}
          style={{ padding: '5px 10px', borderRadius: '5px', border: '1px solid #4b5563', background: '#374151', color: 'white', width: '70px' }}
        />
        <button 
          onClick={() => fetchMatrix(true)}
          style={{ padding: '5px 15px', borderRadius: '5px', background: '#3b82f6', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
        >
          ðŸ”„ TÃ­nh láº¡i / LÃ m má»›i
        </button>
        <span style={{ fontSize: '12px', color: '#9ca3af', marginLeft: 'auto' }}>
          *Dá»¯ liá»‡u tá»± Ä‘á»™ng lÆ°u Ä‘á»‡m (cache) trong 1 phÃºt Ä‘á»ƒ trÃ¡nh káº¹t API.
        </span>
      </div>

      {(matrixData && matrixDataLong && matrixDataTrend && matrixDataTrendLong) && (() => {
        const renderRankingTable = (title, shortData, longData) => (
          <div style={{ flex: 1, background: 'var(--bg-panel)', padding: '20px', borderRadius: '12px', minWidth: '400px' }}>
            <h2 style={{ marginBottom: '20px', color: '#60a5fa' }}>{title} ({matrixHoursLong}H / {matrixHours}H)</h2>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '16px 0', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <th style={{ padding: '10px 0', color: 'var(--text-secondary)' }}>Háº¡ng</th>
                  <th style={{ padding: '10px 0', color: 'var(--text-secondary)' }}>Cur</th>
                  <th style={{ padding: '10px 0', color: 'var(--text-secondary)' }}>Score</th>
                  <th style={{ padding: '10px 0', color: 'var(--text-secondary)' }}>% Mom</th>
                  <th style={{ padding: '10px 0', color: 'var(--text-secondary)' }}>Vol %</th>
                </tr>
              </thead>
              <tbody>
                {longData.ranking.map((item, index) => {
                  const shortItem = shortData.ranking ? shortData.ranking.find(x => x.currency === item.currency) : null;
                  let volColor = 'var(--text-primary)';
                  if (item.vol_percentile >= 75) volColor = '#4ade80';
                  else if (item.vol_percentile <= 20) volColor = '#f87171';
                  
                  let momColor = 'var(--text-primary)';
                  if (item.mom_percentile >= 50) momColor = '#4ade80';
                  else if (item.mom_percentile <= -50) momColor = '#f87171';

                  const renderVal = (val, shortVal, suffix = '', precision = 2, valType = '') => {
                     const mainStr = (val > 0 && suffix !== '%' ? '+' : '') + (val != null ? val.toFixed(precision) : '0') + suffix;
                     const shortStr = shortVal ? ` (${shortVal > 0 && suffix !== '%' ? '+' : ''}${shortVal != null ? shortVal.toFixed(precision) : '0'}${suffix})` : '';
                     
                     let shortColor = '#9ca3af';
                     if (shortVal != null) {
                       if (valType === 'mom') {
                         if (shortVal >= 50) shortColor = '#4ade80';
                         else if (shortVal <= -50) shortColor = '#f87171';
                       } else if (valType === 'vol') {
                         if (shortVal >= 75) shortColor = '#4ade80';
                         else if (shortVal <= 20) shortColor = '#f87171';
                       } else if (valType === 'score') {
                         if (shortVal > 0) shortColor = 'var(--up-color)';
                         else if (shortVal < 0) shortColor = 'var(--down-color)';
                       }
                     }
                     return <>{mainStr} <span style={{fontSize:'12px', color:shortColor, marginLeft: '4px'}}>{shortStr}</span></>;
                  };
                  
                  return (
                  <tr key={item.currency} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '12px 0', fontWeight: 'bold' }}>#{index + 1}</td>
                    <td style={{ padding: '12px 0' }}>{item.currency}</td>
                    <td style={{ padding: '12px 0', color: item.score > 0 ? 'var(--up-color)' : (item.score < 0 ? 'var(--down-color)' : 'var(--text-primary)') }}>
                      {renderVal(item.score, shortItem?.score, '', 2, 'score')}
                    </td>
                    <td style={{ padding: '12px 0', color: momColor, fontWeight: Math.abs(item.mom_percentile || 0) >= 50 ? 'bold' : 'normal' }}>
                      {renderVal(item.mom_percentile, shortItem?.mom_percentile, '%', 2, 'mom')}
                    </td>
                    <td style={{ padding: '12px 0', color: volColor, fontWeight: item.vol_percentile >= 75 ? 'bold' : 'normal' }}>
                      {renderVal(item.vol_percentile, shortItem?.vol_percentile, '%', 0, 'vol')}
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
          </div>
        );

        return (
          <div style={{ display: 'flex', gap: '40px', marginBottom: '40px', flexWrap: 'wrap' }}>
            {/* Báº£ng xáº¿p háº¡ng Ä‘á»“ng tiá»n Flow vs Trend */}
            {renderRankingTable("ðŸŒŠ Money Flow (Momentum)", matrixData, matrixDataLong)}
            {renderRankingTable("ðŸ“ˆ Price Trend (C-VWMA)", matrixDataTrend, matrixDataTrendLong)}

            {/* Dá»¯ liá»‡u chi tiáº¿t cÃ¡c cáº·p */}
            <div style={{ flex: 1, background: 'var(--bg-panel)', padding: '20px', borderRadius: '12px', maxHeight: '550px', overflowY: 'auto' }}>
              <h2 style={{ marginBottom: '20px', color: '#a78bfa' }}>Chi tiáº¿t Thay Ä‘á»•i VWMA (15 Cáº·p)</h2>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <th style={{ padding: '10px 0', color: 'var(--text-secondary)' }}>Cáº·p tiá»n</th>
                    <th style={{ padding: '10px 0', color: 'var(--text-secondary)' }}>Î” VWMA (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {matrixDataLong.pairs_data.map(item => {
                    const shortItem = matrixData.pairs_data ? matrixData.pairs_data.find(x => x.pair === item.pair) : null;
                    return (
                    <tr key={item.pair} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '12px 0' }}>{item.pair}</td>
                      <td style={{ padding: '12px 0', color: item.change_pct > 0 ? 'var(--up-color)' : (item.change_pct < 0 ? 'var(--down-color)' : 'var(--text-primary)') }}>
                        {item.change_pct > 0 ? '+' : ''}{item.change_pct.toFixed(2)}%
                        {shortItem && (() => {
                          let shortColor = '#9ca3af';
                          if (shortItem.change_pct > 0) shortColor = 'var(--up-color)';
                          else if (shortItem.change_pct < 0) shortColor = 'var(--down-color)';
                          return <span style={{fontSize:'12px', color:shortColor, marginLeft: '6px'}}>({shortItem.change_pct > 0 ? '+' : ''}{shortItem.change_pct.toFixed(2)}%)</span>;
                        })()}
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}
      
      {/* Ma tráº­n TÆ°Æ¡ng quan */}
      {matrixData.corr_matrix && matrixData.corr_matrix.length > 0 && (
        <div style={{ marginTop: '40px', background: 'var(--bg-panel)', padding: '20px', borderRadius: '12px', overflowX: 'auto' }}>
          <h2 style={{ marginBottom: '20px', color: '#f472b6' }}>Ma tráº­n TÆ°Æ¡ng quan (Correlation Matrix)</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontSize: '0.9rem' }}>
            <thead>
              <tr>
                <th style={{ padding: '10px', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}></th>
                {matrixData.currencies.map(c => (
                  <th key={c} style={{ padding: '10px', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrixData.corr_matrix.map(row => (
                <tr key={row.currency}>
                  <td style={{ padding: '10px', borderBottom: '1px solid rgba(255,255,255,0.05)', fontWeight: 'bold', textAlign: 'left', color: 'var(--text-secondary)' }}>{row.currency}</td>
                  {matrixData.currencies.map(c => {
                    const val = row[c];
                    let bgColor = 'transparent';
                    if (val === 1 || row.currency === c) {
                      bgColor = 'rgba(255, 255, 255, 0.1)';
                    } else if (val >= 0.8) {
                      bgColor = 'rgba(74, 222, 128, 0.4)'; // strong positive
                    } else if (val >= 0.5) {
                      bgColor = 'rgba(74, 222, 128, 0.2)'; // positive
                    } else if (val <= -0.8) {
                      bgColor = 'rgba(248, 113, 113, 0.4)'; // strong negative
                    } else if (val <= -0.5) {
                      bgColor = 'rgba(248, 113, 113, 0.2)'; // negative
                    }
                    
                    return (
                      <td key={c} style={{ padding: '10px', borderBottom: '1px solid rgba(255,255,255,0.05)', background: bgColor, color: val > 0 ? '#4ade80' : (val < 0 ? '#f87171' : 'white') }}>
                        {val != null ? val.toFixed(2) : '-'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
};



const SettingsModal = ({ configs, setConfigs, onClose }) => {
  const [local, setLocal] = useState({ ...configs });

  const handleChange = (key, val) => setLocal({ ...local, [key]: val });

  const handleSave = () => {
    setConfigs(local);
    onClose();
    axios.post(`${API_BASE}/api/v1/configs`, local)
      .catch(err => console.error("Error saving configs to backend", err));
  };

  const styleGroup = { marginBottom: '15px', background: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: '8px' };
  const styleLabel = { display: 'block', marginBottom: '8px', fontSize: '0.9rem', color: '#94a3b8' };
  const styleInput = { width: '100%', padding: '8px', borderRadius: '4px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', color: 'white' };

  return (
    <div 
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--bg-panel)', padding: '20px', borderRadius: '12px', width: '400px', color: 'var(--text-primary)', boxShadow: '0 4px 20px rgba(0,0,0,0.5)', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <h2 style={{ marginBottom: '20px', color: 'var(--accent-color)' }}>âš™ï¸ Indicator Settings</h2>

        <details style={styleGroup} open>
          <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#60a5fa' }}>D-VP (Volume Profile Äá»™ng)</summary>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Cháº¿ Ä‘á»™ chia lÆ°á»›i</label>
            <select value={local.gridMode} onChange={e => handleChange('gridMode', e.target.value)} style={styleInput}>
              <option value="auto">Tá»± Ä‘á»™ng (Chia theo sá»‘ Ã´)</option>
              <option value="fixed">Cá»‘ Ä‘á»‹nh (Theo sá»‘ Pip)</option>
            </select>
          </div>
          {local.gridMode === 'auto' ? (
            <div style={{ marginTop: '10px' }}>
              <label style={styleLabel}>Sá»‘ lÆ°á»£ng Ã´ (Auto Mode)</label>
              <input type="number" value={local.rowCount} onChange={e => handleChange('rowCount', Number(e.target.value))} style={styleInput} />
            </div>
          ) : (
            <div style={{ marginTop: '10px' }}>
              <label style={styleLabel}>Sá»‘ Pip má»—i Ã´ (Fixed Mode)</label>
              <input type="number" step="0.25" value={local.fixedPips} onChange={e => handleChange('fixedPips', Number(e.target.value))} style={styleInput} />
            </div>
          )}
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Sá»‘ giá» Timeout Ä‘á»ƒ Reset</label>
            <input type="number" value={local.timeoutHours} onChange={(e) => handleChange('timeoutHours', parseFloat(e.target.value))} style={styleInput} step="0.1" />
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Chu ká»³ tÃ­nh D-VP (Sá»‘ ngÃ y giá»›i háº¡n váº½ DVP)</label>
            <input type="number" value={local.dvpLookbackDays !== undefined ? local.dvpLookbackDays : 5} onChange={(e) => handleChange('dvpLookbackDays', e.target.value === '' ? '' : parseInt(e.target.value))} style={styleInput} step="1" />
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Target Volume %</label>
            <input type="number" value={local.mfTargetPct !== undefined ? local.mfTargetPct : 50} onChange={e => handleChange('mfTargetPct', Number(e.target.value))} style={styleInput} />
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Chu ká»³ tÃ­nh Target Volume (Náº¿n)</label>
            <input type="number" value={local.mfTimeoutCandles !== undefined ? local.mfTimeoutCandles : 120} onChange={e => handleChange('mfTimeoutCandles', e.target.value === '' ? '' : parseInt(e.target.value))} style={styleInput} />
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Top Level 1 (MÃ u Äá») %</label>
            <input type="number" value={local.pct1} onChange={e => handleChange('pct1', Number(e.target.value))} style={styleInput} />
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Top Level 2 (MÃ u TÃ­m) %</label>
            <input type="number" value={local.pct2} onChange={e => handleChange('pct2', Number(e.target.value))} style={styleInput} />
          </div>
        </details>

        <details style={styleGroup}>
          <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#34d399' }}>Chá»‰ bÃ¡o VWAP & SD</summary>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Chu ká»³ VWAP (vwapLength)</label>
            <input type="number" value={local.vwapLength} onChange={e => handleChange('vwapLength', Number(e.target.value))} style={styleInput} />
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Há»‡ sá»‘ Band (vwapMult)</label>
            <input type="number" step="0.1" value={local.vwapMult} onChange={e => handleChange('vwapMult', Number(e.target.value))} style={styleInput} />
          </div>
        </details>

        <details style={styleGroup}>
          <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#f59e0b' }}>Chá»‰ bÃ¡o Äá»™ng lÆ°á»£ng LÃµi (Momentum)</summary>
          <div style={{ marginTop: '10px' }}>
</div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Chu ká»³ Ma tráº­n chung (Giá»)</label>
            <input type="number" value={local.matrixLookbackHours} onChange={e => handleChange('matrixLookbackHours', Number(e.target.value))} style={styleInput} title="Nháº­p sá»‘ giá» Ä‘á»ƒ tÃ­nh toÃ¡n phÃ¢n phá»‘i cho cáº£ Äá»™ng LÆ°á»£ng vÃ  Khá»‘i LÆ°á»£ng" />
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>XÃ¡c suáº¥t Cao (momPct1)</label>
            <input type="number" value={local.momPct1} onChange={e => handleChange('momPct1', Number(e.target.value))} style={styleInput} />
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>XÃ¡c suáº¥t Vá»«a (momPct2)</label>
            <input type="number" value={local.momPct2} onChange={e => handleChange('momPct2', Number(e.target.value))} style={styleInput} />
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>XÃ¡c suáº¥t Trung vá»‹ (momPct3)</label>
            <input type="number" value={local.momPct3} onChange={e => handleChange('momPct3', Number(e.target.value))} style={styleInput} />
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel} title="Sá»‘ náº¿n dÃ¹ng Ä‘á»ƒ tÃ­nh trung bÃ¬nh Äá»™ lá»›n Momentum. So sÃ¡nh momentum hiá»‡n táº¡i vá»›i trung bÃ¬nh N náº¿n trÆ°á»›c Ä‘á»ƒ Ä‘o má»©c tÄƒng/giáº£m tÆ°Æ¡ng Ä‘á»‘i.">Chu ká»³ SMA Moment cho Flip (Náº¿n)</label>
            <input type="number" value={local.smaMomLength} onChange={e => handleChange('smaMomLength', Number(e.target.value))} style={styleInput} />
          </div>
          <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #334155' }}>
            <label style={styleLabel}>Má»©c lá»c Ä‘á»™ng lÆ°á»£ng cho Flip (%)</label>
            <input type="number" value={local.momFlipFilterPct} onChange={e => handleChange('momFlipFilterPct', Number(e.target.value))} style={styleInput} title="Chá»‰ láº¥y nhá»¯ng náº¿n cÃ³ Momentum lá»›n hÆ¡n má»©c nÃ y Ä‘á»ƒ phÃ¢n phá»‘i Flip" />
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Má»©c lá»c khá»‘i lÆ°á»£ng cho Flip (%)</label>
            <input type="number" value={local.momFlipVolFilterPct !== undefined ? local.momFlipVolFilterPct : 50.0} onChange={e => handleChange('momFlipVolFilterPct', Number(e.target.value))} style={styleInput} title="Chá»‰ láº¥y nhá»¯ng náº¿n cÃ³ Volume lá»›n hÆ¡n má»©c nÃ y trong nhÃ³m Ä‘Ã£ lá»c Mom" />
          </div>
        </details>


        <details style={styleGroup}>
          <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#a78bfa' }}>Chá»‰ bÃ¡o Khá»‘i lÆ°á»£ng (Volume)</summary>
            <div style={{ marginTop: '10px' }}>
              <label style={styleLabel}>Cháº¿ Ä‘á»™ hiá»ƒn thá»‹</label>
              <select value={local.volMode} onChange={e => handleChange('volMode', e.target.value)} style={styleInput}>
                <option value="normal">Normal (PhÃ¢n phá»‘i Ma tráº­n)</option>
                <option value="rvol">RVol (So sÃ¡nh cÃ¹ng giá»)</option>
                <option value="mean_vol">Trung bÃ¬nh Vol (Matrix 500H)</option>
              </select>
            </div>
            
            {local.volMode === 'rvol' && (
              <div style={{ marginTop: '10px' }}>
                <label style={styleLabel}>Chu ká»³ RVol (Sá»‘ NgÃ y)</label>
                <input type="number" value={local.rvolLookbackDays !== undefined ? local.rvolLookbackDays : 10} onChange={e => handleChange('rvolLookbackDays', e.target.value === '' ? '' : parseInt(e.target.value))} style={styleInput} title="Sá»‘ ngÃ y dÃ¹ng Ä‘á»ƒ tÃ­nh trung bÃ¬nh khá»‘i lÆ°á»£ng cá»§a chÃ­nh giá» nÃ y" />
              </div>
            )}

            <div style={{ marginTop: '10px' }}>
              <label style={styleLabel}>Cá»­a sá»• tÃ­nh Äá»‰nh/ÄÃ¡y (NgÃ y)</label>
              <input type="number" value={local.peakVolLookbackDays} onChange={e => handleChange('peakVolLookbackDays', Number(e.target.value))} style={styleInput} title="Sá»‘ ngÃ y nhÃ¬n láº¡i Ä‘á»ƒ thá»‘ng kÃª giá» bÃ¹ng ná»• Volume" />
            </div>

            <div style={{ marginTop: '10px' }}>
              <label style={styleLabel}>Chu ká»³ MA Volume (PhÃºt)</label>
              <input type="number" value={local.maVolLength !== undefined ? local.maVolLength : 120} onChange={e => handleChange('maVolLength', e.target.value === '' ? '' : parseInt(e.target.value))} style={styleInput} />
            </div>
            <div style={{ display: 'flex', gap: '15px', marginTop: '10px' }}>
              <div style={{ flex: 1 }}>
                <label style={styleLabel}>XÃ¡c suáº¥t TÃ­m (volPct1)</label>
                <input type="number" value={local.volPct1} onChange={e => handleChange('volPct1', Number(e.target.value))} style={styleInput} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={styleLabel}>XÃ¡c suáº¥t Äá» (volPct2)</label>
                <input type="number" value={local.volPct2} onChange={e => handleChange('volPct2', Number(e.target.value))} style={styleInput} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '15px', marginTop: '10px' }}>
              <div style={{ flex: 1 }}>
                <label style={styleLabel}>XÃ¡c suáº¥t Cam (volPct3)</label>
                <input type="number" value={local.volPct3} onChange={e => handleChange('volPct3', Number(e.target.value))} style={styleInput} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={styleLabel}>XÃ¡c suáº¥t Xanh (volPct4)</label>
                <input type="number" value={local.volPct4} onChange={e => handleChange('volPct4', Number(e.target.value))} style={styleInput} />
              </div>
            </div>
        </details>

        <details style={styleGroup}>
          <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#60a5fa' }}>ðŸ•’ Khung Giá» & Hiá»ƒn Thá»‹ Thá»i Gian</summary>
          <div style={{ marginTop: '10px', paddingBottom: '10px', borderBottom: '1px solid #334155', marginBottom: '10px' }}>
            <label style={styleLabel}>Äá»™ lá»‡ch thá»i gian (Giá»)</label>
            <input type="number" step="0.5" value={local.timeShiftHours} onChange={e => handleChange('timeShiftHours', Number(e.target.value))} style={styleInput} title="Nháº­p sá»‘ giá» bá»‹ lá»‡ch (vd: 3 hoáº·c -3) Ä‘á»ƒ tinh chá»‰nh thá»§ cÃ´ng khá»›p vá»›i giá» cá»§a báº¡n" />
            <span style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px', display: 'block' }}>* Náº¿u trá»¥c thá»i gian Ä‘i trÆ°á»›c 3 tiáº¿ng so vá»›i thá»±c táº¿, nháº­p -3 Ä‘á»ƒ lÃ¹i láº¡i.</span>
          </div>
          <div style={{ marginTop: '10px', paddingBottom: '10px', borderBottom: '1px solid #334155', marginBottom: '10px' }}>
            <label style={styleLabel}>MÃºi giá» cá»§a SÃ n (Broker Timezone)</label>
            <select value={local.brokerTimezone || 'Europe/Athens'} onChange={e => handleChange('brokerTimezone', e.target.value)} style={styleInput}>
              <option value="Europe/Athens">ÄÃ´ng Ã‚u (EET/EEST - Chuáº©n Forex)</option>
              <option value="UTC">Giá» Quá»‘c Táº¿ (UTC - ThÆ°á»ng dÃ¹ng Crypto)</option>
              <option value="America/New_York">Giá» New York (EST/EDT)</option>
              <option value="Europe/London">Giá» London (GMT/BST)</option>
              <option value="Asia/Tokyo">Giá» Tokyo (JST)</option>
              <option value="Asia/Ho_Chi_Minh">Giá» Viá»‡t Nam (ICT)</option>
            </select>
            <span style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px', display: 'block' }}>* DÃ¹ng Ä‘á»ƒ tÃ­nh toÃ¡n chÃ­nh xÃ¡c dá»¯ liá»‡u lá»‹ch sá»­ MT5 khi Backtest</span>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
            <label style={{ ...styleLabel, display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={local.autoDst} onChange={e => handleChange('autoDst', e.target.checked)} style={{ marginRight: '8px', cursor: 'pointer' }} />
              Tá»± Ä‘á»™ng Ä‘iá»u chá»‰nh DST (MÃ¹a HÃ¨/ÄÃ´ng)
            </label>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
            <div style={{ flex: 1 }}>
              <label style={styleLabel}>PhiÃªn Ã (Má»Ÿ - Tokyo)</label>
              <input type="time" value={local.asiaStart} onChange={e => handleChange('asiaStart', e.target.value)} style={styleInput} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={styleLabel}>PhiÃªn Ã (ÄÃ³ng - Tokyo)</label>
              <input type="time" value={local.asiaEnd} onChange={e => handleChange('asiaEnd', e.target.value)} style={styleInput} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
            <div style={{ flex: 1 }}>
              <label style={styleLabel}>PhiÃªn Ã‚u (Má»Ÿ - London)</label>
              <input type="time" value={local.euroStart} onChange={e => handleChange('euroStart', e.target.value)} style={styleInput} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={styleLabel}>PhiÃªn Ã‚u (ÄÃ³ng - London)</label>
              <input type="time" value={local.euroEnd} onChange={e => handleChange('euroEnd', e.target.value)} style={styleInput} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
            <div style={{ flex: 1 }}>
              <label style={styleLabel}>PhiÃªn Má»¹ (Má»Ÿ - NY)</label>
              <input type="time" value={local.usStart} onChange={e => handleChange('usStart', e.target.value)} style={styleInput} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={styleLabel}>PhiÃªn Má»¹ (ÄÃ³ng - NY)</label>
              <input type="time" value={local.usEnd} onChange={e => handleChange('usEnd', e.target.value)} style={styleInput} />
            </div>
          </div>
        </details>

        <details style={styleGroup}>
          <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#ef4444' }}>ðŸ“§ Cáº¥u hÃ¬nh Gá»­i Email Cáº£nh BÃ¡o</summary>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Email Gá»­i Äi (TÃ i khoáº£n Gmail)</label>
            <input type="email" value={local.emailSender || ''} onChange={e => handleChange('emailSender', e.target.value)} style={styleInput} placeholder="vÃ­ dá»¥: abc@gmail.com" />
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Máº­t Kháº©u á»¨ng Dá»¥ng (App Password)</label>
            <input type="password" value={local.emailPassword || ''} onChange={e => handleChange('emailPassword', e.target.value)} style={styleInput} placeholder="16 chá»¯ cÃ¡i do Google cáº¥p" />
            <span style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px', display: 'block' }}>VÃ o CÃ i Ä‘áº·t tÃ i khoáº£n Google cá»§a báº¡n &gt; Báº£o máº­t &gt; Báº­t XÃ¡c minh 2 bÆ°á»›c &gt; Táº¡o Máº­t kháº©u á»©ng dá»¥ng. MÃ£ nÃ y chá»‰ lÆ°u trá»¯ táº¡i mÃ¡y cá»§a báº¡n.</span>
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Email Nháº­n ThÃ´ng BÃ¡o</label>
            <input type="email" value={local.emailReceiver || ''} onChange={e => handleChange('emailReceiver', e.target.value)} style={styleInput} placeholder="TÃªn email Ä‘á»ƒ nháº­n thÃ´ng bÃ¡o (cÃ³ thá»ƒ giá»‘ng bÃªn trÃªn)" />
          </div>
        </details>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer', color: 'white' }}>Há»§y</button>
          <button onClick={handleSave} style={{ padding: '8px 16px', background: 'var(--accent-color)', border: 'none', color: 'white', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>LÆ°u thay Ä‘á»•i</button>
        </div>
      </div>
    </div>
  );
};

const CatalystTab = ({ configs }) => {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadCatalyst = () => {
    setLoading(true);
    axios.get(`${API_BASE}/api/v1/catalyst`)
      .then(res => {
        let finalData = res.data || [];
        if (configs && configs.timeShiftHours) {
          finalData = finalData.map(item => ({
            ...item,
            time: item.time + (configs.timeShiftHours * 3600)
          }));
        }
        setNews(finalData);
      })
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadCatalyst();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await axios.post(`${API_BASE}/api/v1/catalyst/refresh`);
      loadCatalyst();
    } catch (err) {
      console.error('Refresh failed:', err);
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) return <div style={{ padding: '20px', color: 'white' }}>Äang táº£i dá»¯ liá»‡u Catalyst...</div>;

  const grouped = news.reduce((acc, curr) => {
    const d = new Date(curr.time * 1000);
    const dayStr = d.toLocaleDateString('vi-VN', { timeZone: 'UTC', weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' });
    if (!acc[dayStr]) acc[dayStr] = [];
    acc[dayStr].push(curr);
    return acc;
  }, {});

  const getImpactColor = (impact) => {
    if (impact === 'High') return 'var(--down-color)';
    if (impact === 'Medium') return 'var(--warning-color, #f59e0b)';
    return 'var(--text-secondary)';
  };

  const getEvalColor = (evalStr) => {
    if (evalStr === 'Positive') return 'var(--up-color)';
    if (evalStr === 'Negative') return 'var(--down-color)';
    return 'var(--text-primary)';
  };

  return (
    <div style={{ padding: '20px', color: 'white', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <h2 style={{ color: 'var(--accent-color)', margin: 0 }}>ðŸ“… Báº£ng Tin Tá»©c & Catalyst Tuáº§n</h2>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          style={{
            padding: '8px 16px',
            borderRadius: '8px',
            border: '1px solid rgba(59, 130, 246, 0.4)',
            background: refreshing ? 'rgba(59, 130, 246, 0.1)' : 'rgba(59, 130, 246, 0.2)',
            color: '#60a5fa',
            cursor: refreshing ? 'not-allowed' : 'pointer',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'all 0.2s ease'
          }}
        >
          <span style={{ display: 'inline-block', animation: refreshing ? 'spin 1s linear infinite' : 'none' }}>ðŸ”„</span>
          {refreshing ? 'Äang cáº­p nháº­t...' : 'Cáº­p nháº­t tin tá»©c'}
        </button>
      </div>
      {Object.keys(grouped).map(day => (
        <div key={day} style={{ marginBottom: '30px', background: 'var(--bg-panel)', borderRadius: '12px', padding: '15px' }}>
          <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '10px', marginBottom: '15px', color: '#60a5fa' }}>{day}</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <th style={{ padding: '10px 5px', color: 'var(--text-secondary)' }}>Giá»</th>
                <th style={{ padding: '10px 5px', color: 'var(--text-secondary)' }}>Quá»‘c gia</th>
                <th style={{ padding: '10px 5px', color: 'var(--text-secondary)' }}>TÃ¡c Ä‘á»™ng</th>
                <th style={{ padding: '10px 5px', color: 'var(--text-secondary)' }}>Tin tá»©c</th>
                <th style={{ padding: '10px 5px', color: 'var(--text-secondary)' }}>TrÆ°á»›c Ä‘Ã³</th>
                <th style={{ padding: '10px 5px', color: 'var(--text-secondary)' }}>Dá»± bÃ¡o</th>
                <th style={{ padding: '10px 5px', color: 'var(--text-secondary)' }}>Thá»±c táº¿</th>
                <th style={{ padding: '10px 5px', color: 'var(--text-secondary)' }}>ÄÃ¡nh giÃ¡</th>
              </tr>
            </thead>
            <tbody>
              {grouped[day].map((item, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '12px 5px' }}>{new Date(item.time * 1000).toLocaleTimeString('vi-VN', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' })}</td>
                  <td style={{ padding: '12px 5px', fontWeight: 'bold' }}>{item.country}</td>
                  <td style={{ padding: '12px 5px', color: getImpactColor(item.impact), fontWeight: 'bold' }}>{item.impact}</td>
                  <td style={{ padding: '12px 5px' }}>{item.title}</td>
                  <td style={{ padding: '12px 5px', color: '#94a3b8' }}>{item.previous || '-'}</td>
                  <td style={{ padding: '12px 5px', color: '#94a3b8' }}>{item.forecast || '-'}</td>
                  <td style={{ padding: '12px 5px', fontWeight: 'bold' }}>{item.actual || '-'}</td>
                  <td style={{ padding: '12px 5px', fontWeight: 'bold', color: getEvalColor(item.evaluation) }}>
                    {item.evaluation === 'Positive' ? 'TÃ­ch cá»±c' : (item.evaluation === 'Negative' ? 'TiÃªu cá»±c' : (item.evaluation === 'Neutral' ? 'Trung tÃ­nh' : '-'))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
};

// Helper: tá»± Ä‘á»™ng xÃ¡c Ä‘á»‹nh loáº¡i matrix dá»±a trÃªn symbol Ä‘ang xem
const getMatrixTypeForSymbol = (sym) => {
  if (!sym) return 'fx';
  const s = sym.toUpperCase();
  // Crypto
  if (s.includes('BTC') || s.includes('ETH') || s.includes('SOL') || s.includes('XRP') || s.includes('DOGE') || s.includes('ADA') || s.includes('DOT') || s.includes('LINK') || s.includes('BNB') || s.includes('AVAX')) return 'crypto';
  // Commodities
  if (s.includes('GOLD') || s.includes('XAU') || s.includes('SILVER') || s.includes('XAG') || s.includes('OIL') || s.includes('BRENT') || s.includes('WTI') || s.includes('NATGAS') || s.includes('COPPER') || s.includes('PLATINUM') || s.includes('PALLADIUM')) return 'commodities';
  // US Stocks / Indices  
  if (s.includes('NASDAQ') || s.includes('US500') || s.includes('US30') || s.includes('US100') || s.includes('SPX') || s.includes('DJI') || s.includes('NDX') || s === 'NAS100' || s.includes('AAPL') || s.includes('TSLA') || s.includes('MSFT') || s.includes('AMZN') || s.includes('GOOG') || s.includes('META') || s.includes('NVDA') || s.includes('DAX') || s.includes('FTSE') || s.includes('JP225') || s.includes('NIKKEI')) return 'us_stocks';
  // Forex (default) - cÃ¡c cáº·p tiá»n tá»‡
  return 'fx';
};

const DEFAULT_SYMBOLS = {
  "15 Cáº·p tiá»n tá»‡ chÃ­nh": [
    {name: "EURUSD", description: "Euro vs US Dollar"},
    {name: "GBPUSD", description: "Great Britain Pound vs US Dollar"},
    {name: "AUDUSD", description: "Australian Dollar vs US Dollar"},
    {name: "NZDUSD", description: "New Zealand Dollar vs US Dollar"},
    {name: "USDJPY", description: "US Dollar vs Japanese Yen"},
    {name: "EURGBP", description: "Euro vs Great Britain Pound"},
    {name: "EURAUD", description: "Euro vs Australian Dollar"},
    {name: "EURNZD", description: "Euro vs New Zealand Dollar"},
    {name: "EURJPY", description: "Euro vs Japanese Yen"},
    {name: "GBPAUD", description: "Great Britain Pound vs Australian Dollar"},
    {name: "GBPNZD", description: "Great Britain Pound vs New Zealand Dollar"},
    {name: "GBPJPY", description: "Great Britain Pound vs Japanese Yen"},
    {name: "AUDNZD", description: "Australian Dollar vs New Zealand Dollar"},
    {name: "AUDJPY", description: "Australian Dollar vs Japanese Yen"},
    {name: "NZDJPY", description: "New Zealand Dollar vs Japanese Yen"}
  ],
  "HÃ ng hoÃ¡ & Kim loáº¡i": [
    {name: "GOLD.i#", description: "VÃ ng (Gold)"},
    {name: "SILVER.i#", description: "Báº¡c (Silver)"},
    {name: "OILCash#", description: "Dáº§u thÃ´ (WTI Oil)"}
  ],
  "Tiá»n Ä‘iá»‡n tá»­": [
    {name: "BTCUSD", description: "Bitcoin vs US Dollar"},
    {name: "ETHUSD", description: "Ethereum vs US Dollar"},
    {name: "SOLUSD", description: "Solana vs US Dollar"}
  ],
  "Chá»‰ sá»‘ chá»©ng khoÃ¡n": [
    {name: "Nasdaq", description: "Nasdaq 100"},
    {name: "US500Cash#", description: "S&P 500"},
    {name: "US30Cash#", description: "Dow Jones 30"},
    {name: "US100", description: "Nasdaq 100 (Alternative)"}
  ]
};

function App() {
  const [symbol, setSymbol] = useState('EURUSD');
  const [searchSymbol, setSearchSymbol] = useState('');
  const [alerts, setAlerts] = useState([]);
  const [toasts, setToasts] = useState([]);
  
  const knownTriggeredRef = useRef(new Set());

  const handleSaveMatrixSettings = (hours, volDays) => {
    const newConfigs = { ...configs, matrixHours: hours, matrixVolDays: volDays };
    setConfigs(newConfigs);
    axios.post(`${API_BASE}/api/v1/configs`, newConfigs)
      .catch(err => console.error("Error saving configs to backend", err));
  };

  const fetchAlerts = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/v1/alerts?_t=${Date.now()}`);
      const data = res.data;
      setAlerts(data);
      
      let newToasts = [];
      data.forEach(a => {
         if (a.status === 'triggered' && !knownTriggeredRef.current.has(a.id)) {
             knownTriggeredRef.current.add(a.id);
             newToasts.push({
                id: Date.now() + Math.random(),
                symbol: a.symbol,
                price: a.price,
                direction: "KÃ­ch hoáº¡t!",
                note: a.note
             });
         }
      });
      
      if (newToasts.length > 0) {
         setToasts(prev => [...prev, ...newToasts]);
      }
    } catch (e) {
      console.error("Lá»—i fetch alerts:", e);
    }
  };

  const handleAddAlert = async (alertData) => {
    try {
      const newAlert = { ...alertData, id: Date.now(), status: 'active' };
      await axios.post(`${API_BASE}/api/v1/alerts`, newAlert);
      fetchAlerts(); 
    } catch (e) { console.error(e); }
  };

  const handleDeleteAlert = async (id) => {
    try {
      // Remove optimistic update to prevent race conditions with in-flight polling
      await axios.delete(`${API_BASE}/api/v1/alerts/${id}`);
      fetchAlerts(); 
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    let interval;
    if (toasts.length > 0) {
      interval = setInterval(() => {
        try {
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          const ctx = new AudioContext();
          for (let i = 0; i < 3; i++) {
              const startTime = ctx.currentTime + i * 0.25;
              const osc = ctx.createOscillator();
              const gainNode = ctx.createGain();
              osc.type = 'triangle';
              osc.frequency.setValueAtTime(880, startTime);
              osc.frequency.exponentialRampToValueAtTime(440, startTime + 0.20);
              gainNode.gain.setValueAtTime(1.5, startTime);
              gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + 0.20);
              osc.connect(gainNode);
              gainNode.connect(ctx.destination);
              osc.start(startTime);
              osc.stop(startTime + 0.20);
          }
        } catch (e) { console.error("Audio error", e); }
      }, 5000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [toasts]);

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 3000);
    return () => clearInterval(interval);
  }, []);

  const [newAlertPrice, setNewAlertPrice] = useState('');
  const [newAlertNote, setNewAlertNote] = useState('');
  const [newAlertBarCloseOnly, setNewAlertBarCloseOnly] = useState(true);
  const [newAlertType, setNewAlertType] = useState('price');
  const [alertSymbol, setAlertSymbol] = useState(symbol);
  
  useEffect(() => {
    setAlertSymbol(symbol);
  }, [symbol]);

  const [timeframe, setTimeframe] = useState('H1');
  const [viewMode, setViewMode] = useState('chart'); // 'chart' hoáº·c 'matrix'
  const [chartType, setChartType] = useState(localStorage.getItem('chartType') || 'candles');
  const [chartTheme, setChartTheme] = useState(localStorage.getItem('chartTheme') || 'dark');
  const [showSdBands, setShowSdBands] = useState(localStorage.getItem('showSdBands') !== 'false');
  const [showMomFlipChart, setShowMomFlipChart] = useState(false);
  const [showVolChart, setShowVolChart] = useState(localStorage.getItem('showVolChart') !== 'false');
  const [showMomChart, setShowMomChart] = useState(localStorage.getItem('showMomChart') !== 'false');
  const [showMatrixBubble, setShowMatrixBubble] = useState(localStorage.getItem('showMatrixBubble') === 'true');
  const [bubbleMatrixData, setBubbleMatrixData] = useState(null);
  const [bubbleMatrixDataLong, setBubbleMatrixDataLong] = useState(null);
  const [bubbleMatrixDataTrend, setBubbleMatrixDataTrend] = useState(null);
  const [bubbleMatrixDataTrendLong, setBubbleMatrixDataTrendLong] = useState(null);

  
  const [configs, setConfigs] = useState(() => ({
    chartTheme: 'dark',
    pct1: 70,
    pct2: 85,
    gridMode: 'auto',
    fixedPips: 10.0,
    rowCount: 50,
    timeoutHours: 1.0,
    dvpLookbackDays: 5,
    mfTargetPct: 75.0,
    mfTimeoutCandles: 120.0,
    vwapLength: 89,
    vwapMult: 2.0,
    matrixLookbackHours: 24,
    momFlipFilterPct: 75.0,
    momFlipVolFilterPct: 50.0,
    volMode: 'normal',
    rvolLookbackDays: 10,
    peakVolLookbackDays: 60,
    momPct1: 85,
    momPct2: 75,
    momPct3: 50,
    maVolLength: 120,
    smaMomLength: 10,
    matrixHours: 24,
    matrixVolDays: 30,
    volPct1: 85.0,
    volPct2: 75.0,
    volPct3: 50.0,
    volPct4: 15.0,
    timeShiftHours: 0.0,
    brokerTimezone: 'Europe/Athens',
    asiaStart: "07:00",
    asiaEnd: "11:00",
    euroStart: "07:00",
    euroEnd: "09:00",
    usStart: "07:30",
    usEnd: "11:00",
    autoDst: true,
    emailSender: '',
    emailPassword: '',
    emailReceiver: '',
  }));
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [availableSymbols, setAvailableSymbols] = useState(DEFAULT_SYMBOLS);

  useEffect(() => {
    if (!showMatrixBubble) return;
    const fetchBubbleMatrix = () => {
      const bTime = configs.brokerTimezone || 'Europe/Athens';
      const mHours = Number(localStorage.getItem('currencyMatrixHours')) || 24;
      const mHoursLong = Number(localStorage.getItem('currencyMatrixHoursLong')) || 89;
      const mVolDays = configs.matrixVolDays || 30;
      const mType = getMatrixTypeForSymbol(symbol);
      let urlShortFlow = `${API_BASE}/api/v1/matrix?brokerTimezone=${encodeURIComponent(bTime)}&n_hours=${mHours}&vol_days=${mVolDays}&matrix_type=${mType}&matrix_mode=money_flow`;
      let urlLongFlow = `${API_BASE}/api/v1/matrix?brokerTimezone=${encodeURIComponent(bTime)}&n_hours=${mHoursLong}&vol_days=${mVolDays}&matrix_type=${mType}&matrix_mode=money_flow`;
      let urlShortTrend = `${API_BASE}/api/v1/matrix?brokerTimezone=${encodeURIComponent(bTime)}&n_hours=${mHours}&vol_days=${mVolDays}&matrix_type=${mType}&matrix_mode=trend`;
      let urlLongTrend = `${API_BASE}/api/v1/matrix?brokerTimezone=${encodeURIComponent(bTime)}&n_hours=${mHoursLong}&vol_days=${mVolDays}&matrix_type=${mType}&matrix_mode=trend`;
      
      if (viewMode === 'backtest' && window.currentSimulatedTime) {
        urlShortFlow += `&end_time=${window.currentSimulatedTime}`;
        urlLongFlow += `&end_time=${window.currentSimulatedTime}`;
        urlShortTrend += `&end_time=${window.currentSimulatedTime}`;
        urlLongTrend += `&end_time=${window.currentSimulatedTime}`;
      }
      Promise.all([
          axios.get(urlShortFlow), axios.get(urlLongFlow),
          axios.get(urlShortTrend), axios.get(urlLongTrend)
      ]).then(res => {
          setBubbleMatrixData(res[0].data?.ranking);
          setBubbleMatrixDataLong(res[1].data?.ranking);
          setBubbleMatrixDataTrend(res[2].data?.ranking);
          setBubbleMatrixDataTrendLong(res[3].data?.ranking);
      }).catch(err => console.error(err));
    };
    
    fetchBubbleMatrix();
    const interval = setInterval(fetchBubbleMatrix, 60000);
    
    window.addEventListener('simulatedTimeChanged', fetchBubbleMatrix);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('simulatedTimeChanged', fetchBubbleMatrix);
    };
  }, [showMatrixBubble, viewMode, configs.brokerTimezone, configs.matrixHours, configs.matrixVolDays, symbol]);

  useEffect(() => {
    axios.get(`${API_BASE}/api/v1/symbols`)
      .then(res => {
         if (res.data.status === 'success') {
             setAvailableSymbols(res.data.data);
         }
      })
      .catch(err => console.error("Could not load symbols from backend", err));
  }, []);

  useEffect(() => {
    axios.get(`${API_BASE}/api/v1/configs`)
      .then(res => {
         const data = res.data;
         if (Object.keys(data).length > 0) {
             setConfigs(prev => ({ ...prev, ...data }));
         }
      })
      .catch(err => console.error("Could not load configs from backend", err));
  }, []);

  // KÃ­ch hoáº¡t láº¡i resize khi áº©n/hiá»‡n thanh cÃ´ng cá»¥ Ä‘á»ƒ chart tá»± giÃ£n cÃ¡ch
  useEffect(() => {
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 150);
    return () => clearTimeout(timer);
  }, [sidebarOpen]);



  return (
    <div className="dashboard-container">
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className="toast">
            <div className="toast-header">
              <span>ðŸ”” {t.symbol}</span>
              <button className="toast-close" onClick={() => setToasts(toasts.filter(x => x.id !== t.id))}>âœ•</button>
            </div>
            <div className="toast-body">
              <div>GiÃ¡: <strong>{t.price}</strong></div>
              <div style={{ color: t.direction.includes('LÃªn') ? '#22c55e' : '#ef4444' }}>{t.direction}</div>
              {t.note && <div style={{ fontStyle: 'italic', marginTop: '4px', color: '#94a3b8' }}>"{t.note}"</div>}
            </div>
          </div>
        ))}
      </div>

      
      <AssistiveTouch 
        showSdBands={showSdBands} 
        setShowSdBands={setShowSdBands} 
        showMomFlip={showMomFlipChart} 
        setShowMomFlip={setShowMomFlipChart} 
        showVolChart={showVolChart}
        setShowVolChart={setShowVolChart}
        showMomChart={showMomChart}
        setShowMomChart={setShowMomChart}
        showMatrixBubble={showMatrixBubble}
        setShowMatrixBubble={setShowMatrixBubble}
        bubbleMatrixData={bubbleMatrixData}
        bubbleMatrixDataLong={bubbleMatrixDataLong}
        bubbleMatrixDataTrend={bubbleMatrixDataTrend}
        bubbleMatrixDataTrendLong={bubbleMatrixDataTrendLong}
        volMode={configs.volMode}
        handleVolModeToggle={(checked) => setConfigs(prev => ({ ...prev, volMode: checked ? 'mean_vol' : 'normal' }))}
      />

      {showSettings && (
        
        <SettingsModal 
          configs={configs} 
          setConfigs={setConfigs} 
          onClose={() => setShowSettings(false)} 
        />

      )}
      

      {/* Sidebar */}
      {sidebarOpen && (
      <aside className="sidebar">
        <div className="logo-area">
          <img src="/tkh_logo.png" alt="$TKH Logo" style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover' }} />
          <div className="logo-text">$TKH</div>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Cáº·p tiá»n tá»‡ (Symbol)</label>
            <input
              type="text"
              placeholder="TÃ¬m kiáº¿m mÃ£ hoáº·c tÃªn tÃ i sáº£n..."
              value={searchSymbol}
              onChange={(e) => setSearchSymbol(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const searchStr = searchSymbol.trim().toLowerCase();
                  if (!searchStr) return;
                  
                  let matchedSymbol = null;
                  
                  if ("thá»‹ trÆ°á»ng chung fx gi global_index".includes(searchStr)) matchedSymbol = "GLOBAL_INDEX";
                  else if ("us stocks us_stocks_gi".includes(searchStr)) matchedSymbol = "US_STOCKS_GI";
                  else if ("hÃ ng hÃ³a commodities commodities_gi".includes(searchStr)) matchedSymbol = "COMMODITIES_GI";
                  else if ("tiá»n Ä‘iá»‡n tá»­ crypto crypto_gi".includes(searchStr)) matchedSymbol = "CRYPTO_GI";
                  
                  if (!matchedSymbol && availableSymbols) {
                    for (const group of Object.keys(availableSymbols)) {
                      const match = availableSymbols[group].find(s => 
                        s.name.toLowerCase().includes(searchStr) || 
                        s.description.toLowerCase().includes(searchStr)
                      );
                      if (match) {
                        matchedSymbol = match.name;
                        break;
                      }
                    }
                  }
                  
                  if (matchedSymbol) {
                    setSymbol(matchedSymbol);
                    setSearchSymbol(''); 
                    e.target.blur();
                  }
                }
              }}
              style={{ width: '100%', marginBottom: '8px', padding: '8px', borderRadius: '4px', border: '1px solid #374151', background: '#1f2937', color: '#fff', fontSize: '0.85rem' }}
            />
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)} style={{ width: '100%' }}>
              <optgroup label="Chá»‰ sá»‘ Tá»•ng há»£p">
                <option value="GLOBAL_INDEX">Thá»‹ trÆ°á»ng chung (FX GI)</option>
                <option value="US_STOCKS_GI">Chá»‰ sá»‘ Cá»• phiáº¿u Má»¹ (US Stocks GI)</option>
                <option value="COMMODITIES_GI">Chá»‰ sá»‘ HÃ ng hÃ³a (Commodities GI)</option>
                <option value="CRYPTO_GI">Chá»‰ sá»‘ Tiá»n Ä‘iá»‡n tá»­ (Crypto GI)</option>
              </optgroup>
              {availableSymbols ? (
                Object.keys(availableSymbols).map(group => {
                  const filtered = availableSymbols[group].filter(s => {
                    const searchStr = searchSymbol.trim().toLowerCase();
                    return s.name.toLowerCase().includes(searchStr) || 
                           s.description.toLowerCase().includes(searchStr);
                  });
                  if (filtered.length === 0) return null;
                  return (
                    <optgroup key={group} label={group}>
                      {filtered.map(s => (
                        <option key={s.name} value={s.name}>{s.description} ({s.name})</option>
                      ))}
                    </optgroup>
                  );
                })
              ) : (
                <optgroup label="Äang táº£i danh sÃ¡ch...">
                  <option value="EURUSD">EURUSD</option>
                </optgroup>
              )}
            </select>
          </div>
          
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Khung thá»i gian (Timeframe)</label>
            <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)} style={{ width: '100%' }}>
              <option value="M1">1 Minute</option>
              <option value="M3">3 Minutes</option>
              <option value="M5">5 Minutes</option>
              <option value="M15">15 Minutes</option>
              <option value="H1">1 Hour</option>
              <option value="H4">4 Hours</option>
              <option value="D1">Daily</option>
              <option value="W1">Weekly</option>
              <option value="MN1">Monthly</option>
            </select>
          </div>
          
          <div style={{ marginTop: '15px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Loáº¡i biá»ƒu Ä‘á»“ (Chart Type)</label>
            <select value={chartType} onChange={(e) => {
              setChartType(e.target.value);
              localStorage.setItem('chartType', e.target.value);
            }} style={{ width: '100%' }}>
              <option value="candles">Náº¿n (Candlestick)</option>
              <option value="line">ÄÆ°á»ng (Line - Close)</option>
              <option value="hlc">HLC (High - Low - Close)</option>
              <option value="money_flow">Money Flow</option>
            </select>
          </div>
          
          <div style={{ marginTop: '15px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>MÃ u ná»n biá»ƒu Ä‘á»“ (Theme)</label>
            <select value={chartTheme} onChange={(e) => {
              setChartTheme(e.target.value);
              localStorage.setItem('chartTheme', e.target.value);
            }} style={{ width: '100%' }}>
              <option value="dark">Tá»‘i (Máº·c Ä‘á»‹nh)</option>
              <option value="sunset">HoÃ ng HÃ´n (Sunset)</option>
              <option value="night">ThÃ nh phá»‘ (Night)</option>
            </select>
          </div>
          

          
          <div style={{ marginTop: '20px', borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
            <h3 style={{ fontSize: '0.9rem', marginBottom: '10px', color: 'var(--text-secondary)' }}>TÃ­nh nÄƒng</h3>
            <button 
              onClick={() => setViewMode('chart')}
              style={{ width: '100%', marginBottom: '10px', textAlign: 'left', background: viewMode === 'chart' ? 'rgba(59, 130, 246, 0.2)' : '' }}
            >
              ðŸ“ˆ Biá»ƒu Ä‘á»“ Chart
            </button>
            <button 
              onClick={() => setViewMode('matrix')}
              style={{ width: '100%', marginBottom: '10px', textAlign: 'left', background: viewMode === 'matrix' ? 'rgba(59, 130, 246, 0.2)' : '' }}
            >
              âš¡ Currency Matrix
            </button>
            <button 
              onClick={() => setViewMode('backtest')}
              style={{ width: '100%', marginBottom: '10px', textAlign: 'left', background: viewMode === 'backtest' ? 'rgba(59, 130, 246, 0.2)' : '' }}
            >
              âª Backtest Mode
            </button>
            <button 
              onClick={() => setViewMode('catalyst')}
              style={{ width: '100%', marginBottom: '10px', textAlign: 'left', background: viewMode === 'catalyst' ? 'rgba(59, 130, 246, 0.2)' : '' }}
            >
              ðŸ“… Lá»‹ch Catalyst
            </button>
            <button 
              onClick={() => setViewMode('strategy')}
              style={{ width: '100%', marginBottom: '10px', textAlign: 'left', background: viewMode === 'strategy' ? 'rgba(59, 130, 246, 0.2)' : '' }}
            >
              ðŸ›  Strategy Builder
            </button>
            <button onClick={() => setShowSettings(true)} style={{ width: '100%', textAlign: 'left' }}>âš™ï¸ Indicator Settings</button>
          </div>
          <div style={{ marginTop: '20px', borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
            <h3 style={{ fontSize: '0.9rem', marginBottom: '10px', color: 'var(--text-secondary)' }}>â° Cáº£nh bÃ¡o GiÃ¡ (Alerts)</h3>
            
            <div style={{ display: 'flex', gap: '5px', marginBottom: '5px' }}>
              <select 
                value={alertSymbol} 
                onChange={e => setAlertSymbol(e.target.value)}
                style={{ padding: '6px', borderRadius: '4px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', color: 'white', maxWidth: '85px', fontSize: '0.8rem' }}
              >
                <option value="GLOBAL_INDEX">FX GI</option>
                <option value="US_STOCKS_GI">US Stocks GI</option>
                <option value="COMMODITIES_GI">Commodities GI</option>
                <option value="CRYPTO_GI">Crypto GI</option>
                {availableSymbols ? (
                  Object.keys(availableSymbols).map(group => (
                    <optgroup key={group} label={group}>
                      {availableSymbols[group].map(s => (
                        <option key={s.name} value={s.name}>{s.name}</option>
                      ))}
                    </optgroup>
                  ))
                ) : (
                  <option value="EURUSD">EURUSD</option>
                )}
              </select>
              <select
                value={newAlertType}
                onChange={e => setNewAlertType(e.target.value)}
                style={{ padding: '6px', borderRadius: '4px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', color: 'white', maxWidth: '75px', fontSize: '0.8rem' }}
              >
                <option value="price">GiÃ¡</option>
                <option value="mom">% Mom Flip</option>
              </select>
              <input 
                type="number" 
                placeholder={newAlertType === 'price' ? "GiÃ¡" : "% Mom Flip"} 
                value={newAlertPrice}
                onChange={e => setNewAlertPrice(e.target.value)}
                style={{ flex: 1, padding: '6px', borderRadius: '4px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', color: 'white', minWidth: 0 }}
              />
            </div>
            <div style={{ display: 'flex', gap: '5px', marginBottom: '15px' }}>
              <input 
                type="text" 
                placeholder="Ghi chÃº (TÃ¹y chá»n)" 
                value={newAlertNote}
                onChange={e => setNewAlertNote(e.target.value)}
                style={{ flex: 1, padding: '6px', borderRadius: '4px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', color: 'white' }}
              />
              <label style={{ display: 'flex', alignItems: 'center', fontSize: '0.8rem', color: '#94a3b8', gap: '4px' }}>
                <input type="checkbox" checked={newAlertBarCloseOnly} onChange={e => setNewAlertBarCloseOnly(e.target.checked)} /> ÄÃ³ng náº¿n
              </label>
              <button 
                className="primary" 
                style={{ padding: '6px 12px' }}
                onClick={() => {
                  if(!newAlertPrice) return;
                  handleAddAlert({ symbol: alertSymbol, type: newAlertType, timeframe: timeframe, price: parseFloat(newAlertPrice), note: newAlertNote, bar_close_only: newAlertBarCloseOnly });
                  setNewAlertPrice('');
                  setNewAlertNote('');
                }}
              >+</button>
            </div>
            
            <div style={{ maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {alerts.map(a => (
                <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(255,255,255,0.05)', padding: '6px 8px', borderRadius: '4px', fontSize: '0.8rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div>
                      <span style={{ color: a.status==='active' ? '#eab308' : '#94a3b8', fontWeight: 'bold' }}>{a.symbol}</span>
                      <span style={{ margin: '0 5px', fontSize: '0.75rem', color: '#94a3b8' }}>{a.type === 'mom' ? 'Mom Flip' : '@'}</span>
                      <span style={{ marginLeft: '2px', color: '#4ade80' }}>{a.type === 'mom' ? a.price + '%' : a.price}</span>
                      {a.status === 'triggered' && <span style={{ marginLeft: '5px', color: '#ef4444' }}>(Triggered)</span>}
                    </div>
                    {a.note && <span style={{ color: '#94a3b8', fontSize: '0.75rem', marginTop: '2px', fontStyle: 'italic' }}>{a.note}</span>}
                  </div>
                  <button onClick={() => handleDeleteAlert(a.id)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0 5px' }}>âœ•</button>
                </div>
              ))}
              {alerts.length === 0 && <div style={{ fontSize: '0.8rem', color: '#94a3b8', fontStyle: 'italic' }}>ChÆ°a cÃ³ cáº£nh bÃ¡o nÃ o</div>}
            </div>
          </div>

        </div>
      </aside>
      )}

      {/* Main Area */}
      <main className="main-workspace">
        <header className="header">
          <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: '15px' }}>
            <button 
              onClick={() => setSidebarOpen(!sidebarOpen)}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '1.4rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              title="Toggle Sidebar"
            >
              â˜°
            </button>
            {viewMode === 'chart' ? `${symbol} â€¢ ${timeframe}` : viewMode === 'backtest' ? `${symbol} â€¢ ${timeframe} (Backtest Mode)` : viewMode === 'catalyst' ? 'Lá»‹ch Tin tá»©c Catalyst' : viewMode === 'strategy' ? 'Strategy Builder' : 'Currency Strength Matrix'}
          </div>
          <div className="toolbar">
            
          </div>
        </header>
        
        <div className="chart-container">
          <div className={`chart-wrapper theme-${chartTheme}`} style={{ overflow: (viewMode === 'matrix' || viewMode === 'catalyst' || viewMode === 'strategy') ? 'auto' : 'hidden' }}>
            {viewMode === 'chart' || viewMode === 'backtest' ? (
              <ChartComponent symbol={symbol} timeframe={timeframe} configs={configs} viewMode={viewMode} alerts={alerts} setAlerts={setAlerts} handleAddAlert={handleAddAlert} chartType={chartType} chartTheme={chartTheme} showSdBands={showSdBands} showMomFlipChart={showMomFlipChart} showVolChart={showVolChart} showMomChart={showMomChart} />
            ) : viewMode === 'matrix' ? (
              <MatrixComponent 
                simulatedTime={null} 
                brokerTimezone={configs.brokerTimezone || 'Europe/Athens'} 
                initialMatrixHours={configs.matrixHours} 
                initialMatrixVolDays={configs.matrixVolDays} 
                onSaveMatrixSettings={handleSaveMatrixSettings}
                symbol={symbol}
              />
            ) : viewMode === 'catalyst' ? (
              <CatalystTab configs={configs} />
            ) : (
              <StrategyBuilderTab symbol={symbol} timeframe={timeframe} configs={configs} />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;











