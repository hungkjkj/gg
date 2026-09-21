import React, { useState, useEffect, useRef } from 'react';
import { createChart, ColorType } from 'lightweight-charts';
import axios from 'axios';
import { AssistiveTouch, MomFlipChartComponent } from './components/MomFlip';
import './index.css';

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

const ChartComponent = ({ symbol, timeframe, configs, viewMode = 'chart', alerts = [], setAlerts, handleAddAlert, chartType, showSdBands, showMomFlipChart, showVolChart = true, showMomChart = true }) => {
  const [momFlipData, setMomFlipData] = useState([]);
  const chartContainerRef = useRef(null);
  const momentumChartContainerRef = useRef(null);
  const volumeChartContainerRef = useRef();
  const momentumChartRef = useRef(null);
  const volumeChartRef = useRef(null);
  const chartRef = useRef(null);
  const candlestickSeriesRef = useRef(null);
  const lineCloseSeriesRef = useRef(null);
  const [chartReady, setChartReady] = useState(false);
  const lineHighSeriesRef = useRef(null);
  const lineLowSeriesRef = useRef(null);
  const sessionDataRef = useRef([]);
  const vwapSeriesRef = useRef(null);
  const fairValueSeriesRef = useRef(null);
  const upperBandSeriesRef = useRef(null);
  const lowerBandSeriesRef = useRef(null);
  const momentumSeriesRef = useRef(null);
  
  // Các đường xác suất Momentum
  const mom85UpRef = useRef(null);
  const mom85DnRef = useRef(null);
  const mom75UpRef = useRef(null);
  const mom75DnRef = useRef(null);
  const mom50UpRef = useRef(null);
  const mom50DnRef = useRef(null);
  const momMaSeriesRef = useRef(null);
  
  // Các đường xác suất Volume
  const normVolSeriesRef = useRef(null);
  const maVolSeriesRef = useRef(null);
  
  const [contextMenu, setContextMenu] = useState(null);
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
  const lastUpdateTimeRef = useRef(0);

  // Backtest State
  const [backtestDate, setBacktestDate] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const simulatedTimeRef = useRef(0);
  const isPlayingRef = useRef(false);
  const lastVwapColorRef = useRef(null);
  const lastMaVolColorRef = useRef(null);
  const lastMomMaColorRef = useRef(null);
  const lastHl2ColorRef = useRef(null);
  const lastBandwidthRef = useRef(null);
  const lastSdColorRef = useRef(null);
  const bandwidthHistoryRef = useRef([]);
  const backtestWeekRef = useRef(0);
  
  const bidPriceLineRef = useRef(null);
  const askPriceLineRef = useRef(null);
  
  const savedTimeRangeRef = useRef(null);
  const [isScrolled, setIsScrolled] = useState(false);
  const isScrolledRef = useRef(false);
  
  const [newsData, setNewsData] = useState([]);
  const newsSeriesRef = useRef(null);
  const volumeDummySeriesRef = useRef(null);
  const momentumDummySeriesRef = useRef(null);
  const newsDataRef = useRef([]);
  const [selectedNewsGroup, setSelectedNewsGroup] = useState(null);
  
  // Keep track of playback speed for the interval
  
  // Keep track of playback speed for the interval
  const playbackSpeedRef = useRef(1);
  useEffect(() => { playbackSpeedRef.current = playbackSpeed; }, [playbackSpeed]);
// Fetch News Data
  const fetchNews = async () => {
    try {
      const response = await axios.get(`http://localhost:8000/api/v1/news`, {
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

  // Apply News Markers
  useEffect(() => {
    if (newsSeriesRef.current && (newsData.length > 0 || (volStatsRef.current && volStatsRef.current.v_lines))) {
      const tfSec = timeframe === 'M1' ? 60 : timeframe === 'M5' ? 300 : timeframe === 'M15' ? 900 : timeframe === 'M30' ? 1800 : timeframe === 'H1' ? 3600 : timeframe === 'H2' ? 7200 : timeframe === 'H4' ? 14400 : timeframe === 'H8' ? 28800 : timeframe === 'D1' ? 86400 : 3600;

      // Align news to timeframe grid to prevent blank gaps in chart
      const alignedNewsData = newsData.map(ev => {
         let alignedTime = ev.time - (ev.time % tfSec);
         let date = new Date(alignedTime * 1000);
         let day = date.getUTCDay();
         if (day === 6) alignedTime += 86400 * 2; // Shift Sat to Mon
         else if (day === 0) alignedTime += 86400; // Shift Sun to Mon
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
      
      if (maxFutureTime === 0) maxFutureTime = Math.floor(Date.now()/1000) + 86400;
      
      let currentTime = lastUpdateTimeRef.current || Math.floor(Date.now() / 1000);
      currentTime = currentTime - (currentTime % tfSec);
      
      const futureTimes = [];
      let t = currentTime + tfSec;
      while (t <= maxFutureTime) {
         const date = new Date(t * 1000);
         const day = date.getUTCDay();
         // Bỏ qua Thứ 7 (6) và Chủ Nhật (0)
         if (day !== 0 && day !== 6) {
             futureTimes.push({ time: t, value: 0 });
         }
         t += tfSec;
      }
      
      const allTimesMap = new Map();
      newsTimes.forEach(nt => allTimesMap.set(nt, { time: nt, value: 0 }));
      futureTimes.forEach(ft => {
          if (!allTimesMap.has(ft.time)) {
              allTimesMap.set(ft.time, ft);
          }
      });
      
      const newsSeriesData = Array.from(allTimesMap.values()).sort((a,b) => a.time - b.time);
      
      try {
          if (newsSeriesRef.current) newsSeriesRef.current.setData(newsSeriesData.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
          if (volumeDummySeriesRef.current) volumeDummySeriesRef.current.setData(newsSeriesData.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
          if (momentumDummySeriesRef.current) momentumDummySeriesRef.current.setData(newsSeriesData.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
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
  }, [newsData, chartRef.current, timeframe]);

  
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
    
    // Đóng modal cũ nếu đang mở
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
    
    // Ngăn chặn menu mặc định của trình duyệt/WebView TOÀN CỤC
    const preventGlobalContext = (e) => { 
      e.preventDefault(); 
      
      // Nếu click vào trong khu vực MAIN chart
      if (chartContainerRef.current && chartContainerRef.current.contains(e.target)) {
        if (!candlestickSeriesRef.current) return;
        
        // Đóng modal cũ nếu đang mở
        setCustomAlertModal(null);
        setAlertNoteInput('');

        const rect = chartContainerRef.current.getBoundingClientRect();
        const y = e.clientY - rect.top;
        
        const price = candlestickSeriesRef.current.coordinateToPrice(y);
        
        if (price !== null) {
          // IMPORTANT: Need to use functional state update or just directly set it.
          // Because setContextMenu is from useState, it is always available.
          setContextMenu({
            x: e.clientX,
            y: e.clientY,
            price: price,
            symbol: symbolRef.current
          });
          
          if (setAlerts) { // Tận dụng setAlerts hoặc toast để debug
            console.log("Context menu opened at price", price);
          }
        }
      } else {
        closeContextMenu();
      }
    };
    
    document.addEventListener('contextmenu', preventGlobalContext, { capture: true });

    const handleDocumentClick = (e) => {
        // Chỉ close nếu không click vào context menu
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
             candlestickSeriesRef.current.removePriceLine(alertLinesRef.current[id]);
             delete alertLinesRef.current[id];
         }
     });
     
     // Add new lines
     currentAlerts.forEach(a => {
         if (!alertLinesRef.current[a.id]) {
             const line = candlestickSeriesRef.current.createPriceLine({
                 price: a.price,
                 color: '#eab308',
                 lineWidth: 2,
                 lineStyle: 2,
                 axisLabelVisible: true,
                 title: a.note ? `🔔 ${a.note}` : '🔔 Alert',
             });
             alertLinesRef.current[a.id] = line;
         }
     });
  }, [alerts, symbol, chartReady]);

useEffect(() => {
    // Khởi tạo biểu đồ
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#94a3b8',
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

    const upperBandSeries = chart.addAreaSeries({
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
    
    const lowerBandSeries = chart.addAreaSeries({
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
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: '#94a3b8',
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
      
      const momentumDummySeries = momentumChart.addLineSeries({ color: 'transparent', crosshairMarkerVisible: false, priceLineVisible: false });
      
      const volumeChart = createChart(volumeChartContainerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: '#94a3b8',
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
          tickMarkFormatter: customTickMarkFormatter,
        },
      });
      
      const normVolSeries = volumeChart.addHistogramSeries({
        priceFormat: { type: 'volume' },
      });
      const maVolSeries = volumeChart.addLineSeries({ color: 'rgba(57, 255, 20, 0.8)', lineWidth: 2 });
      
      const volumeDummySeries = volumeChart.addLineSeries({ color: 'transparent', crosshairMarkerVisible: false, priceLineVisible: false });
      
      const vol85Line = volumeChart.addLineSeries({ color: 'rgba(255, 165, 0, 0.5)', lineWidth: 1, crosshairMarkerVisible: false });
      const vol75Line = volumeChart.addLineSeries({ color: 'rgba(225, 230, 38, 0.5)', lineWidth: 1, crosshairMarkerVisible: false });
      const vol50Line = volumeChart.addLineSeries({ color: 'rgba(128, 128, 128, 0.5)', lineWidth: 1, crosshairMarkerVisible: false });
      const vol15Line = volumeChart.addLineSeries({ color: 'rgba(0, 191, 255, 0.5)', lineWidth: 1, crosshairMarkerVisible: false });

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
          isSyncingMid = false;
          isSyncingRight = false;
        }
      });

      momentumChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range && !isSyncingMid) {
          isSyncingLeft = true;
          isSyncingRight = true;
          if (chart) chart.timeScale().setVisibleLogicalRange(range);
          if (volumeChart) volumeChart.timeScale().setVisibleLogicalRange(range);
          isSyncingLeft = false;
          isSyncingRight = false;
        }
      });
      
      volumeChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range && !isSyncingRight) {
          isSyncingLeft = true;
          isSyncingMid = true;
          if (chart) chart.timeScale().setVisibleLogicalRange(range);
          if (momentumChart) momentumChart.timeScale().setVisibleLogicalRange(range);
          isSyncingLeft = false;
          isSyncingMid = false;
        }
      });
      
      // Sync crosshairs
      const handleCrosshairMove = (param, targetCharts, targetSeries) => {
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
        // Xử lý click cho quả bóng tin tức
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
        // Đã xóa double click, thay bằng context menu
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
    
    // Theo dõi hành động cuộn của người dùng
    chart.timeScale().subscribeVisibleLogicalRangeChange((logicalRange) => {
      if (logicalRange && candlestickSeriesRef.current) {
        const data = candlestickSeriesRef.current.data();
        if (data && data.length > 0) {
          const totalCandles = data.length;
          // Nếu mép phải của màn hình cách hiện tại quá 5 nến, coi như là đã kéo về quá khứ
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
    volumeDummySeriesRef.current = volumeDummySeries;
    momentumDummySeriesRef.current = momentumDummySeries;
    vwapSeriesRef.current = vwapSeries;
    fairValueSeriesRef.current = fairValueSeries;
    upperBandSeriesRef.current = upperBandSeries;
    lowerBandSeriesRef.current = lowerBandSeries;
    momentumSeriesRef.current = momentumSeries;
    momentumChartRef.current = momentumChart;
    volumeChartRef.current = volumeChart;
    
    mom85UpRef.current = mom85Up;
    mom85DnRef.current = mom85Dn;
    mom75UpRef.current = mom75Up;
    mom75DnRef.current = mom75Dn;
    mom50UpRef.current = mom50Up;
    mom50DnRef.current = mom50Dn;
    
    const momMaSeries = momentumChart.addLineSeries({ color: 'rgba(255, 255, 255, 0.8)', lineWidth: 1, crosshairMarkerVisible: false, autoscaleInfoProvider: () => null });
    momMaSeriesRef.current = momMaSeries;
    
    normVolSeriesRef.current = normVolSeries;
    maVolSeriesRef.current = maVolSeries;
    vol85Ref.current = vol85Line;
    vol75Ref.current = vol75Line;
    vol50Ref.current = vol50Line;
    vol15Ref.current = vol15Line;
    
    // Lưu ref cho Session BG

    // Resize handler
    const handleResize = () => {
        if (chartContainerRef.current && chart) {
          chart.applyOptions({
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight,
          });
        }
        if (momentumChartContainerRef.current && momentumChart) {
          momentumChart.applyOptions({
            width: momentumChartContainerRef.current.clientWidth,
            height: momentumChartContainerRef.current.clientHeight,
          });
        }
        if (volumeChartContainerRef.current && volumeChart) {
          volumeChart.applyOptions({
            width: volumeChartContainerRef.current.clientWidth,
            height: volumeChartContainerRef.current.clientHeight,
          });
        }
      };

    const resizeObserver = new ResizeObserver(() => {
        handleResize();
    });

    if (chartContainerRef.current) resizeObserver.observe(chartContainerRef.current);
    if (momentumChartContainerRef.current) resizeObserver.observe(momentumChartContainerRef.current);
    if (volumeChartContainerRef.current) resizeObserver.observe(volumeChartContainerRef.current);

    window.addEventListener('resize', handleResize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      try { chart.remove(); } catch (e) {}
      try { momentumChart.remove(); } catch (e) {}
      try { volumeChart.remove(); } catch (e) {}
      chartRef.current = null;
      momentumChartRef.current = null;
      volumeChartRef.current = null;
      candlestickSeriesRef.current = null;
      newsSeriesRef.current = null;
      volumeDummySeriesRef.current = null;
      momentumDummySeriesRef.current = null;
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
  }, [chartType, showSdBands]);
  
  // Hàm cập nhật toạ độ HTML Overlay liên tục
  const updateOverlays = () => {
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
           // Fix: Đảm bảo chiều cao tối thiểu là 1 pixel để không bị biến mất khi thu nhỏ thanh giá (sub-pixel rendering)
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
                  const x = timeScale.timeToCoordinate(line.time);
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
    animationFrameRef.current = requestAnimationFrame(updateOverlays);
  };

  useEffect(() => {
    if (vpBoxes.length > 0) {
      animationFrameRef.current = requestAnimationFrame(updateOverlays);
    }
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [vpBoxes]);

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

  // Fetch data từ FastAPI backend
  const fetchData = async (isPolling = false, targetEndTime = 0) => {
    // Không cho phép gửi Polling request nếu hệ thống đang bận tải Full Load
    if (isPolling && loadingRef.current) return;
    
    const currentSymbol = symbol;
    if (!isPolling && candlestickSeriesRef.current) {
        candlestickSeriesRef.current.setData([]);
        if (vwapSeriesRef.current) vwapSeriesRef.current.setData([]);
        if (momentumSeriesRef.current) momentumSeriesRef.current.setData([]);
        if (normVolSeriesRef.current) normVolSeriesRef.current.setData([]);
        if (momMaSeriesRef.current) momMaSeriesRef.current.setData([]);
        if (maVolSeriesRef.current) maVolSeriesRef.current.setData([]);
        lastVwapColorRef.current = null;
        lastMaVolColorRef.current = null;
        lastMomMaColorRef.current = null;
        lastHl2ColorRef.current = null;
        lastBandwidthRef.current = null;
        lastSdColorRef.current = null;
        bandwidthHistoryRef.current = [];
        setVpBoxes([]);
        setVolStats(null);
    }
    
    if (!isPolling) {
        // Lưu lại Viewport hiện tại trước khi fetch dữ liệu mới
        if (chartRef.current) {
            try {
                const currentRange = chartRef.current.timeScale().getVisibleRange();
                if (currentRange) {
                    savedTimeRangeRef.current = currentRange;
                }
            } catch (e) {
                console.error("Không thể lấy Viewport hiện tại:", e);
            }
        }
        setLoading(true);
        loadingRef.current = true;
    }
    setError(null);
      
      try {
        const browserOffsetHours = -new Date().getTimezoneOffset() / 60;
        
        // Lọc bỏ các params không thuộc OHLCV API (email config, volMode...)
        const { emailSender, emailPassword, emailReceiver, volMode, ...ohlcvConfigs } = configs;
        
        const response = await axios.get(`http://localhost:8000/api/v1/ohlcv`, {
          params: { symbol, timeframe, count: 10000, end_time: targetEndTime, browserOffsetHours, latest_only: isPolling, _t: Date.now(), ...ohlcvConfigs }
        });
        
        // Bỏ qua nếu response trả về dữ liệu của symbol/timeframe cũ (Race condition)
        if (response.data.symbol && (response.data.symbol !== symbolRef.current || response.data.timeframe !== timeframeRef.current)) {
        setLoading(false);
            return;
        }

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


        const newMomFlip = rawData.filter(d => d.mom_flip != null && !isNaN(d.mom_flip)).map(d => ({
          time: d.time,
          value: d.mom_flip
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
        
        // Format nến (Loại bỏ các nến bị lỗi null)
        let formattedData = rawData
          .filter(item => item.open != null && item.high != null && item.low != null && item.close != null && !isNaN(item.open) && !isNaN(item.high) && !isNaN(item.low) && !isNaN(item.close))
          .map(item => ({
            time: item.time, 
            open: item.open,
            high: item.high,
            low: item.low,
            close: item.close,
            spread: item.spread || 0
          }))
          .filter(item => Number.isFinite(item.time) && Number.isFinite(item.open) && Number.isFinite(item.high) && Number.isFinite(item.low) && Number.isFinite(item.close))
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
            let col = '#39ff14'; // Mặc định xanh
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
          
          const momentumData = rawData.filter(d => d.mom_raw != null && !isNaN(d.mom_raw)).map(item => {
            return {
              time: item.time,
              value: item.mom_raw,
              color: item.mom_raw >= 0 ? '#00e676' : '#ff1744'
            };
          }).sort((a,b)=>a.time-b.time);
          
        const m85Up = rawData.filter(d => d.mom_lvl1 != null && !isNaN(d.mom_lvl1)).map(i => ({time: i.time, value: i.mom_lvl1})).sort((a,b)=>a.time-b.time);
        const m85Dn = rawData.filter(d => d.mom_lvl1 != null && !isNaN(d.mom_lvl1)).map(i => ({time: i.time, value: -i.mom_lvl1})).sort((a,b)=>a.time-b.time);
        const m75Up = rawData.filter(d => d.mom_lvl2 != null && !isNaN(d.mom_lvl2)).map(i => ({time: i.time, value: i.mom_lvl2})).sort((a,b)=>a.time-b.time);
        const m75Dn = rawData.filter(d => d.mom_lvl2 != null && !isNaN(d.mom_lvl2)).map(i => ({time: i.time, value: -i.mom_lvl2})).sort((a,b)=>a.time-b.time);
        const m50Up = rawData.filter(d => d.mom_lvl3 != null && !isNaN(d.mom_lvl3)).map(i => ({time: i.time, value: i.mom_lvl3})).sort((a,b)=>a.time-b.time);
        const m50Dn = rawData.filter(d => d.mom_lvl3 != null && !isNaN(d.mom_lvl3)).map(i => ({time: i.time, value: -i.mom_lvl3})).sort((a,b)=>a.time-b.time);

        const normVolData = rawData.filter(d => (configs.volMode === 'rvol' ? (d.rvol != null && !isNaN(d.rvol)) : (d.norm_vol != null && !isNaN(d.norm_vol)))).map(i => {
          let color = '#9c27b0';
          let value = configs.volMode === 'rvol' ? i.rvol : i.norm_vol;
          
          if (configs.volMode === 'rvol') {
            if (i.rvol < 0.5) color = '#0033ff'; 
            else if (i.rvol < 1.0) color = '#ff8c00'; 
            else if (i.rvol < 2.0) color = '#ffff00'; 
            else color = '#ff1744'; 
          } else {
            if (i.norm_vol <= i.vol_lvl4) color = '#0033ff'; // Blue
            else if (i.norm_vol <= i.vol_lvl3) color = '#ff8c00'; // Orange
            else if (i.norm_vol <= i.vol_lvl2) color = '#ffff00'; // Yellow
            else if (i.norm_vol <= i.vol_lvl1) color = '#ff1744'; // Red
          }
          return { time: i.time, value: value, color };
        }).sort((a,b)=>a.time-b.time);

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
          if (index > 0) {
            if (i.ma_vol >= arr[index - 1].ma_vol) col = "rgba(0, 255, 0, 1)"; // Lên màu xanh lá
            else col = "rgba(255, 0, 0, 1)"; // Xuống màu đỏ
          } else if (lastMaVolColorRef.current !== null) {
            col = lastMaVolColorRef.current;
          }
          return {time: i.time, value: i.ma_vol, color: col};
        });
        if (maVolData.length > 0) lastMaVolColorRef.current = maVolData[maVolData.length - 1].color;
        
        const sortedRawForMomMa = rawData.filter(d => d.mom_ma != null && !isNaN(d.mom_ma)).sort((a,b)=>a.time-b.time);
        const momMaData = sortedRawForMomMa.map((i, index, arr) => {
          let col = "rgba(128, 128, 128, 0.8)";
          if (index > 0) {
            if (i.mom_ma >= arr[index - 1].mom_ma) col = "rgba(0, 255, 0, 1)"; // Lên màu xanh lá
            else col = "rgba(255, 0, 0, 1)"; // Xuống màu đỏ
          } else if (lastMomMaColorRef.current !== null) {
            col = lastMomMaColorRef.current;
          }
          return {time: i.time, value: i.mom_ma, color: col};
        });
        if (momMaData.length > 0) lastMomMaColorRef.current = momMaData[momMaData.length - 1].color;
        
        const v85 = rawData.filter(d => d.vol_lvl1 != null && !isNaN(d.vol_lvl1)).map(i => ({time: i.time, value: i.vol_lvl1})).sort((a,b)=>a.time-b.time);
        const v75 = rawData.filter(d => d.vol_lvl2 != null && !isNaN(d.vol_lvl2)).map(i => ({time: i.time, value: i.vol_lvl2})).sort((a,b)=>a.time-b.time);
        const v50 = rawData.filter(d => d.vol_lvl3 != null && !isNaN(d.vol_lvl3)).map(i => ({time: i.time, value: i.vol_lvl3})).sort((a,b)=>a.time-b.time);
        const v15 = rawData.filter(d => d.vol_lvl4 != null && !isNaN(d.vol_lvl4)).map(i => ({time: i.time, value: i.vol_lvl4})).sort((a,b)=>a.time-b.time);
        
        const sortedHl2Raw = rawData.filter(d => d.hl2 != null && !isNaN(d.hl2)).sort((a,b)=>a.time-b.time);
        const fairValueData = sortedHl2Raw.map((item, index, arr) => {
          let col = "rgba(128, 128, 128, 0.8)";
          if (index > 0 || lastHl2ColorRef.current === null) {
            if (index > 0) {
              if (item.hl2 >= arr[index - 1].hl2) col = "rgba(0, 255, 0, 1)";
              else col = "rgba(255, 0, 0, 1)";
            }
          } else {
            col = lastHl2ColorRef.current;
          }
          return { time: item.time, value: item.hl2, color: col };
        });
        if (fairValueData.length > 0) lastHl2ColorRef.current = fairValueData[fairValueData.length - 1].color;

        const upperBandData = [];
        const lowerBandData = [];
        const bandwidthHistory = [...bandwidthHistoryRef.current];
        
        const sortedRawForSD = rawData.filter(d => d.upper_band != null && d.lower_band != null && !isNaN(d.upper_band)).sort((a,b)=>a.time-b.time);
        sortedRawForSD.forEach((item, index, arr) => {
            const rawBandwidth = item.upper_band - item.lower_band;
            bandwidthHistory.push(rawBandwidth);
            
            let col = "rgba(128, 128, 128, 0.9)"; 
            if (index > 0) {
                const prevRawBandwidth = arr[index - 1].upper_band - arr[index - 1].lower_band;
                if (rawBandwidth >= prevRawBandwidth) col = "rgba(0, 230, 118, 0.9)";
                else col = "rgba(255, 23, 68, 0.9)";
            } else if (lastSdColorRef.current !== null) {
                col = lastSdColorRef.current;
            }
            
            let fillColor = "rgba(128, 128, 128, 0.15)";
            if (col === "rgba(0, 230, 118, 0.9)") fillColor = "rgba(0, 230, 118, 0.25)";
            else if (col === "rgba(255, 23, 68, 0.9)") fillColor = "rgba(255, 23, 68, 0.15)";
            
            upperBandData.push({ 
                time: item.time, 
                value: item.upper_band, 
                lineColor: col,
                topColor: fillColor,
                bottomColor: fillColor
            });
            lowerBandData.push({ 
                time: item.time, 
                value: item.lower_band, 
                lineColor: col,
                topColor: '#090e19',
                bottomColor: '#090e19'
            });
        });
        if (upperBandData.length > 0) {
          lastSdColorRef.current = upperBandData[upperBandData.length - 1].lineColor;
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
            });
            vwapData.forEach(d => safeUpdate(vwapSeriesRef.current, d));
            if (fairValueSeriesRef.current) fairValueData.forEach(d => safeUpdate(fairValueSeriesRef.current, d));
            upperBandData.forEach(d => safeUpdate(upperBandSeriesRef.current, d));
            lowerBandData.forEach(d => safeUpdate(lowerBandSeriesRef.current, d));
            momentumData.forEach(d => safeUpdate(momentumSeriesRef.current, d));
            
            if (mom85UpRef.current) {
              m85Up.forEach(d => safeUpdate(mom85UpRef.current, d));
              m85Dn.forEach(d => safeUpdate(mom85DnRef.current, d));
              m75Up.forEach(d => safeUpdate(mom75UpRef.current, d));
              m75Dn.forEach(d => safeUpdate(mom75DnRef.current, d));
              m50Up.forEach(d => safeUpdate(mom50UpRef.current, d));
            }
            if (mom50DnRef.current) m50Dn.forEach(d => safeUpdate(mom50DnRef.current, d));
            if (momMaSeriesRef.current) momMaData.forEach(d => safeUpdate(momMaSeriesRef.current, d));
            
            if (normVolSeriesRef.current) {
              normVolData.forEach(d => safeUpdate(normVolSeriesRef.current, d));
              maVolData.forEach(d => safeUpdate(maVolSeriesRef.current, d));
              v85.forEach(d => safeUpdate(vol85Ref.current, d));
              v75.forEach(d => safeUpdate(vol75Ref.current, d));
              v50.forEach(d => safeUpdate(vol50Ref.current, d));
              v15.forEach(d => safeUpdate(vol15Ref.current, d));
            }
            if (formattedData.length > 0) {
              lastUpdateTimeRef.current = Math.max(lastUpdateTimeRef.current, formattedData[formattedData.length - 1].time);
            }
          } else {
            if (formattedData.length > 0) {
              lastUpdateTimeRef.current = formattedData[formattedData.length - 1].time;
            }
            candlestickSeriesRef.current.setData(formattedData);
            lineCloseSeriesRef.current.setData(formattedData.map(d => ({ time: d.time, value: d.close })).filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
            lineHighSeriesRef.current.setData(formattedData.map(d => ({ time: d.time, value: d.high })).filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
            lineLowSeriesRef.current.setData(formattedData.map(d => ({ time: d.time, value: d.low })).filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
            vwapSeriesRef.current.setData(vwapData.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
            if (fairValueSeriesRef.current) fairValueSeriesRef.current.setData(fairValueData.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
            upperBandSeriesRef.current.setData(upperBandData.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
            lowerBandSeriesRef.current.setData(lowerBandData.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
            momentumSeriesRef.current.setData(momentumData.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
            
            // Cập nhật đường Spread (Bid / Ask)
            if (formattedData.length > 0 && candlestickSeriesRef.current) {
                const lastItem = formattedData[formattedData.length - 1];
                const bid = lastItem.close;
                let minMove = 0.00001;
                if (symbol.includes("JPY")) minMove = 0.001;
                else if (symbol.includes("XAU") || symbol.includes("GOLD") || symbol.includes("BTC") || symbol.includes("ETH") || symbol.includes("SOL")) minMove = 0.01;
                const ask = bid + ((lastItem.spread || 0) * minMove);
                if (!Number.isFinite(ask) || !Number.isFinite(bid)) return;
                
                if (!bidPriceLineRef.current) {
                    bidPriceLineRef.current = candlestickSeriesRef.current.createPriceLine({
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
                
                if (!askPriceLineRef.current) {
                    askPriceLineRef.current = candlestickSeriesRef.current.createPriceLine({
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
            
            if (mom85UpRef.current) {
              mom85UpRef.current.setData(m85Up.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
              mom85DnRef.current.setData(m85Dn.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
              mom75UpRef.current.setData(m75Up.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
              mom75DnRef.current.setData(m75Dn.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
              mom50UpRef.current.setData(m50Up.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
            }
            if (mom50DnRef.current) mom50DnRef.current.setData(m50Dn.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
            if (momMaSeriesRef.current) momMaSeriesRef.current.setData(momMaData.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
            
            if (normVolSeriesRef.current) {
              normVolSeriesRef.current.setData(normVolData.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
              maVolSeriesRef.current.setData(maVolData.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
              vol85Ref.current.setData(v85.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
              vol75Ref.current.setData(v75.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
              vol50Ref.current.setData(v50.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
              vol15Ref.current.setData(v15.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
            }
            
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
                    // Log dạng thông báo bình thường vì đây là cơ chế bảo vệ hợp lệ
                    console.log("Đã kích hoạt cơ chế Hủy Neo Trục Y (Do vùng thời gian cũ không có dữ liệu ở tài sản mới). Trở về Viewport mặc định.");
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
            
            // Đưa vào setTimeout để tránh race condition với hàm setData() của Lightweight Charts
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
            
            // Xóa bộ nhớ tạm viewport sau khi đã áp dụng xong
            savedTimeRangeRef.current = null;
          }
        }
        
        // Lưu Volume Profile boxes
        if (response.data.indicators && response.data.indicators.vp_boxes) {
            setVpBoxes(response.data.indicators.vp_boxes);
        }
        
        if (response.data.indicators && response.data.indicators.vol_stats) {
            setVolStats(response.data.indicators.vol_stats);
            volStatsRef.current = response.data.indicators.vol_stats;
        }
        
        setLastUpdateSignal(Date.now());
      } catch (err) {
        console.error("Error fetching data:", err);
        if (!isPolling) {
            setError(`Không thể tải dữ liệu ${symbol}. Hãy kiểm tra MT5 và Backend (Có thể mã không tồn tại trên sàn).`);
        }
        
        // Xóa dữ liệu cũ trên biểu đồ để tránh nhầm lẫn
        if (!isPolling && candlestickSeriesRef.current) {
            candlestickSeriesRef.current.setData([]);
            if (vwapSeriesRef.current) vwapSeriesRef.current.setData([]);
            if (momentumSeriesRef.current) momentumSeriesRef.current.setData([]);
            if (normVolSeriesRef.current) normVolSeriesRef.current.setData([]);
            if (momMaSeriesRef.current) momMaSeriesRef.current.setData([]);
            if (maVolSeriesRef.current) maVolSeriesRef.current.setData([]);
            setVpBoxes([]);
            setVolStats(null);
        }
      } finally {
        if (!isPolling) {
            // Trì hoãn việc tắt Loading một chút để Lightweight Charts (Canvas) kịp vẽ xong 10,000 nến
            setTimeout(() => {
            setLoading(false);
                loadingRef.current = false;
            }, 300);
        }
        // Polling request âm thầm chạy ngầm, không được phép điều khiển biến loading
      }
    };

  useEffect(() => {
    if (viewMode === 'chart') {
      fetchData();
      const intervalId = setInterval(() => {
        fetchData(true);
      }, 3000); // 3 giây cập nhật giá 1 lần
      return () => clearInterval(intervalId);
    } else if (viewMode === 'backtest' && simulatedTimeRef.current) {
      // Khi đổi symbol hoặc timeframe trong lúc backtest
      fetchData(false, simulatedTimeRef.current);
      // Tải lại tin tức cho cặp tiền mới
      axios.get(`http://localhost:8000/api/v1/news/backtest`, {
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
  }, [symbol, timeframe, configs, viewMode]);

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
      
      const tfSec = timeframe === 'M1' ? 60 : timeframe === 'M5' ? 300 : timeframe === 'M15' ? 900 : timeframe === 'M30' ? 1800 : timeframe === 'H1' ? 3600 : timeframe === 'H4' ? 14400 : timeframe === 'D1' ? 86400 : 3600;
      simulatedTimeRef.current += tfSec;
      window.currentSimulatedTime = simulatedTimeRef.current;
      
      // Bỏ qua Thứ 7, Chủ Nhật để Backtest không bị "treo" (trừ Crypto)
      const isCrypto = symbol.includes("BTC") || symbol.includes("ETH") || symbol.includes("SOL") || symbol.includes("XRP") || symbol.includes("CRYPTO");
      if (!isCrypto) {
          const d = new Date(simulatedTimeRef.current * 1000);
          const day = d.getUTCDay();
          const h = d.getUTCHours();
          const m = d.getUTCMinutes();
          const s = d.getUTCSeconds();
          
          let skip = false;
          let jumpHours = 0;
          
          if (day === 5 && h >= 22) { // Thứ 6 sau 22:00 UTC (05:00 sáng T7 giờ VN)
              skip = true;
              jumpHours = 24 - h + 24 + 21; // Nhảy thẳng tới Chủ Nhật 21:00 UTC (04:00 sáng T2 VN)
          } else if (day === 6) { // Nếu lỡ bước sang Thứ 7
              skip = true;
              jumpHours = 24 - h + 21;
          } else if (day === 0 && h < 21) { // Chủ Nhật trước 21:00 UTC
              skip = true;
              jumpHours = 21 - h;
          }
          
          if (skip) {
              simulatedTimeRef.current += (jumpHours * 3600) - (m * 60) - s;
      window.currentSimulatedTime = simulatedTimeRef.current;
          }
      }
      
      // Phát hiện qua tuần mới -> tải tin tức tuần mới
      const currentMonday = getWeekMonday(simulatedTimeRef.current);
      if (currentMonday !== backtestWeekRef.current) {
        backtestWeekRef.current = currentMonday;
        try {
          const response = await axios.get(`http://localhost:8000/api/v1/news/backtest`, {
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
            // Gộp tin mới vào (không trùng lặp dựa trên time+title)
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
      
      await fetchData(true, simulatedTimeRef.current);
      
      if (isPlayingRef.current && viewMode === 'backtest') {
        timeoutId = setTimeout(playNext, 1000 / playbackSpeedRef.current);
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
      alert("Vui lòng chọn ngày giờ Backtest!");
      return;
    }
    const targetTimestamp = Math.floor(new Date(backtestDate).getTime() / 1000);
    simulatedTimeRef.current = targetTimestamp;
    window.currentSimulatedTime = simulatedTimeRef.current;
    backtestWeekRef.current = getWeekMonday(targetTimestamp);
    setIsPlaying(false);
    isPlayingRef.current = false;
    fetchData(false, targetTimestamp);
    
    // Tải tin tức lịch sử cho backtest
    try {
      const response = await axios.get(`http://localhost:8000/api/v1/news/backtest`, {
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
              <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Chọn Điểm Bắt Đầu:</label>
              <input 
                type="datetime-local" 
                value={backtestDate}
                onChange={(e) => setBacktestDate(e.target.value)}
                style={{ padding: '6px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: '4px' }}
              />
              <button onClick={handleLoadBacktest} className="primary" style={{ padding: '6px 12px' }}>Tải Dữ Liệu</button>
            </div>
            
            <div style={{ width: '1px', height: '24px', background: 'var(--border-color)' }}></div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button onClick={togglePlay} style={{ padding: '6px 16px', background: isPlaying ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)', color: isPlaying ? '#ef4444' : '#10b981', border: 'none', fontWeight: 'bold' }}>
                {isPlaying ? '⏸ Dừng' : '▶ Phát'}
              </button>
              
              <select 
                value={playbackSpeed} 
                onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
                style={{ padding: '6px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: '4px' }}
              >
                <option value={0.25}>0.25x</option>
                <option value={0.5}>0.5x</option>
                <option value={1}>1x (1 nến/s)</option>
                <option value={2}>2x</option>
                <option value={5}>5x</option>
                <option value={10}>10x</option>
              </select>
            </div>
            
            <div style={{ marginLeft: 'auto', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Thời gian giả lập: {simulatedTimeRef.current ? new Date(simulatedTimeRef.current * 1000).toLocaleString() : 'Chưa tải'}
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
            <div style={{ color: '#60a5fa', fontSize: '1.2rem', fontWeight: 'bold' }}>Đang tải dữ liệu {symbol}...</div>
            <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginTop: '5px' }}>Vui lòng đợi trong giây lát</div>
          </div>
        )}
        {error && (
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 10, color: '#ef4444' }}>
            {error}
          </div>
        )}
        
        {/* Main Chart */}
        <div style={{ flex: 3, position: 'relative', width: '100%' }}>
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
                width: '36px',
                height: '36px',
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
                fontSize: '18px',
                fontWeight: 'bold'
              }}
              title="Go to latest"
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(59, 130, 246, 1)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.8)'}
            >
              &#8250;|
            </button>
          )}
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
                Tin tức lúc {new Date((selectedNewsGroup[0].originalTime || selectedNewsGroup[0].time) * 1000).toLocaleTimeString([], {timeZone: 'UTC', hour: '2-digit', minute:'2-digit'})} ngày {new Date((selectedNewsGroup[0].originalTime || selectedNewsGroup[0].time) * 1000).toLocaleDateString('vi-VN', {timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric'})}
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '60vh', overflowY: 'auto' }}>
                {selectedNewsGroup.map((ev, idx) => (
                  <div key={idx} style={{ background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '4px', borderLeft: `4px solid ${ev.impact === 'High' ? '#f23645' : ev.impact === 'Medium' ? '#ff9800' : '#787b86'}` }}>
                    <div style={{ fontWeight: 'bold', fontSize: '1.1rem', marginBottom: '5px' }}>{ev.country} - {ev.title}</div>
                    <div style={{ display: 'flex', gap: '15px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                      <div><strong>Tầm quan trọng:</strong> {ev.impact}</div>
                    </div>
                    <div style={{ display: 'flex', gap: '15px', fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '5px' }}>
                      <div><strong>Dự báo:</strong> {ev.forecast || '-'}</div>
                      <div><strong>Thực tế:</strong> {ev.actual || '-'}</div>
                      <div><strong>Kỳ trước:</strong> {ev.previous || '-'}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
                <button onClick={() => setSelectedNewsGroup(null)} style={{ padding: '8px 16px', background: 'var(--accent-color)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Đóng</button>
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
              📋 Sao chép giá ({contextMenu.price.toFixed(5)})
            </div>
            <div 
              className="context-menu-item"
              onClick={() => {
                setCustomAlertModal({
                  price: contextMenu.price.toFixed(5),
                  symbol: contextMenu.symbol
                });
                closeContextMenu();
              }}
            >
              ⏰ Thêm cảnh báo giá...
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
              <h3 style={{ margin: 0, color: 'white' }}>Thêm cảnh báo giá</h3>
              
              <div>
                <label style={{ display: 'block', marginBottom: '5px', color: '#94a3b8', fontSize: '0.9rem' }}>Cặp giao dịch</label>
                <div style={{ color: '#eab308', fontWeight: 'bold', fontSize: '1.1rem' }}>{customAlertModal.symbol}</div>
              </div>
              
              <div>
                <label style={{ display: 'block', marginBottom: '5px', color: '#94a3b8', fontSize: '0.9rem' }}>Mức giá</label>
                <input 
                  type="text" 
                  value={customAlertModal.price} 
                  readOnly 
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-color)', color: 'white', fontWeight: 'bold' }} 
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '5px', color: '#94a3b8', fontSize: '0.9rem' }}>Ghi chú (Tùy chọn)</label>
                <input 
                  type="text" 
                  placeholder="Nhập ghi chú..."
                  value={alertNoteInput}
                  onChange={(e) => setAlertNoteInput(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (handleAddAlert) {
                        handleAddAlert({
                            symbol: customAlertModal.symbol,
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
                <button onClick={() => { setCustomAlertModal(null); setAlertNoteInput(''); }}>Hủy</button>
                <button className="primary" onClick={() => {
                  if (handleAddAlert) {
                    handleAddAlert({
                        symbol: customAlertModal.symbol,
                        price: parseFloat(customAlertModal.price),
                        note: alertNoteInput
                    });
                  }
                  setCustomAlertModal(null);
                  setAlertNoteInput('');
                }}>Lưu Cảnh Báo</button>
              </div>
            </div>
          </div>
        )}
        {showMomFlipChart && <MomFlipChartComponent data={momFlipData} mainChart={chartRef.current} mainSeries={candlestickSeriesRef.current} />}
      </div>
  );
};

const MatrixComponent = ({ simulatedTime, brokerTimezone }) => {
  const [matrixData, setMatrixData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [matrixHours, setMatrixHours] = useState(Number(localStorage.getItem('currencyMatrixHours')) || 24);
  const [matrixVolDays, setMatrixVolDays] = useState(Number(localStorage.getItem('currencyMatrixVolDays')) || 30);
  const [matrixType, setMatrixType] = useState(localStorage.getItem('matrixType') || 'currency');

  useEffect(() => {
    let interval;
    if (loading) {
      interval = setInterval(async () => {
        try {
          const res = await axios.get(`http://localhost:8000/api/v1/matrix/progress?matrix_type=${matrixType}`);
          setProgress(res.data.progress || 0);
        } catch (e) {}
      }, 500);
    } else {
      setProgress(0);
    }
    return () => clearInterval(interval);
  }, [loading, matrixType]);


  const fetchMatrix = async (force = false) => {
    // Không dùng cache nếu đang ở chế độ backtest
    if (!force && !simulatedTime) {
      const cached = localStorage.getItem(`matrixCache_${matrixType}`);
      const cachedTime = localStorage.getItem(`matrixCacheTime_${matrixType}`);
      const cachedHours = localStorage.getItem(`matrixCacheHours_${matrixType}`);
      const cachedVolDays = localStorage.getItem(`matrixCacheVolDays_${matrixType}`);
      if (cached && cachedTime && cachedHours == matrixHours && cachedVolDays == matrixVolDays) {
        const age = Date.now() - parseInt(cachedTime);
        if (age < 60 * 1000) {
          setMatrixData(JSON.parse(cached));
          return;
        }
      }
    }
    
    setLoading(true);
    try {
      const response = await axios.get(`http://localhost:8000/api/v1/matrix`, {
        params: { n_hours: matrixHours, vol_days: matrixVolDays, matrix_type: matrixType, end_time: simulatedTime || 0, brokerTimezone }
      });
      setMatrixData(response.data);
      if (!simulatedTime) {
          localStorage.setItem(`matrixCache_${matrixType}`, JSON.stringify(response.data));
          localStorage.setItem(`matrixCacheTime_${matrixType}`, Date.now().toString());
          localStorage.setItem(`matrixCacheHours_${matrixType}`, matrixHours.toString());
          localStorage.setItem(`matrixCacheVolDays_${matrixType}`, matrixVolDays.toString());
      }
      localStorage.setItem('currencyMatrixHours', matrixHours.toString());
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
    
    // Tự động làm mới Ma trận mỗi 15 phút
    const intervalId = setInterval(() => {
      fetchMatrix(true);
    }, 15 * 60 * 1000);
    
    return () => clearInterval(intervalId);
  }, [matrixType]);

  if (!matrixData) {
    if (loading) {
      return (
        <div style={{ padding: '50px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'white' }}>
          <div style={{ fontSize: '1.2rem', marginBottom: '15px', color: '#60a5fa', fontWeight: 'bold' }}>
            Đang tính toán ma trận... {progress}%
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
            Đang tính toán lại ma trận... {progress}%
          </div>
          <div style={{ width: '300px', height: '10px', background: '#374151', borderRadius: '5px', overflow: 'hidden' }}>
            <div style={{ width: `${progress}%`, height: '100%', background: '#3b82f6', transition: 'width 0.3s ease' }}></div>
          </div>
        </div>
      )}

      {/* Header điều khiển */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '15px', background: 'var(--bg-panel)', padding: '15px 20px', borderRadius: '12px', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, color: '#60a5fa' }}>Cấu hình Ma trận:</h3>
        
        <label>Chu kỳ (Giờ):</label>
        <input 
          type="number" 
          value={matrixHours} 
          onChange={e => setMatrixHours(Number(e.target.value))} 
          style={{ padding: '5px 10px', borderRadius: '5px', border: '1px solid #4b5563', background: '#374151', color: 'white', width: '80px' }}
        />
        
        <label style={{ marginLeft: '10px' }}>So sánh Khối lượng (Ngày):</label>
        <input 
          type="number" 
          value={matrixVolDays} 
          onChange={e => setMatrixVolDays(Number(e.target.value))} 
          style={{ padding: '5px 10px', borderRadius: '5px', border: '1px solid #4b5563', background: '#374151', color: 'white', width: '80px' }}
        />
        <button 
          onClick={() => fetchMatrix(true)}
          style={{ padding: '5px 15px', borderRadius: '5px', background: '#3b82f6', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
        >
          🔄 Tính lại / Làm mới
        </button>
        <span style={{ fontSize: '12px', color: '#9ca3af', marginLeft: 'auto' }}>
          *Dữ liệu tự động lưu đệm (cache) trong 1 phút để tránh kẹt API.
        </span>
      </div>

      <div style={{ display: 'flex', gap: '40px' }}>
      {/* Bảng xếp hạng đồng tiền */}
      <div style={{ flex: 1, background: 'var(--bg-panel)', padding: '20px', borderRadius: '12px' }}>
        <h2 style={{ marginBottom: '20px', color: '#60a5fa' }}>Xếp hạng Sức mạnh Tiền tệ ({matrixHours}H)</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
              <th style={{ padding: '10px 0', color: 'var(--text-secondary)' }}>Hạng</th>
              <th style={{ padding: '10px 0', color: 'var(--text-secondary)' }}>Đồng tiền</th>
              <th style={{ padding: '10px 0', color: 'var(--text-secondary)' }}>Điểm sức mạnh (Score)</th>
              <th style={{ padding: '10px 0', color: 'var(--text-secondary)' }}>Khối lượng (Top %)</th>
            </tr>
          </thead>
          <tbody>
            {matrixData.ranking.map((item, index) => {
              // Color logic cho Volume Percentile
              let volColor = 'var(--text-primary)';
              if (item.vol_percentile >= 75) volColor = '#4ade80'; // Xanh lá sáng
              else if (item.vol_percentile <= 20) volColor = '#f87171'; // Đỏ nhạt
              
              return (
              <tr key={item.currency} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <td style={{ padding: '12px 0', fontWeight: 'bold' }}>#{index + 1}</td>
                <td style={{ padding: '12px 0' }}>{item.currency}</td>
                <td style={{ padding: '12px 0', color: item.score > 0 ? 'var(--up-color)' : (item.score < 0 ? 'var(--down-color)' : 'var(--text-primary)') }}>
                  {item.score > 0 ? '+' : ''}{item.score.toFixed(2)}
                </td>
                <td style={{ padding: '12px 0', color: volColor, fontWeight: item.vol_percentile >= 75 ? 'bold' : 'normal' }}>
                  {item.vol_percentile}%
                </td>
              </tr>
            )})}
          </tbody>
        </table>
      </div>

      {/* Dữ liệu chi tiết các cặp */}
      <div style={{ flex: 1, background: 'var(--bg-panel)', padding: '20px', borderRadius: '12px', maxHeight: '400px', overflowY: 'auto' }}>
        <h2 style={{ marginBottom: '20px', color: '#a78bfa' }}>Chi tiết Thay đổi VWMA (15 Cặp)</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
              <th style={{ padding: '10px 0', color: 'var(--text-secondary)' }}>Cặp tiền</th>
              <th style={{ padding: '10px 0', color: 'var(--text-secondary)' }}>Δ VWMA (%)</th>
            </tr>
          </thead>
          <tbody>
            {matrixData.pairs_data.map(item => (
              <tr key={item.pair} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <td style={{ padding: '12px 0' }}>{item.pair}</td>
                <td style={{ padding: '12px 0', color: item.change_pct > 0 ? 'var(--up-color)' : (item.change_pct < 0 ? 'var(--down-color)' : 'var(--text-primary)') }}>
                  {item.change_pct > 0 ? '+' : ''}{item.change_pct.toFixed(2)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>
    </div>
  );
};



const SettingsModal = ({ configs, setConfigs, onClose }) => {
  const [local, setLocal] = useState({ ...configs });

  const handleChange = (key, val) => setLocal({ ...local, [key]: val });

  const handleSave = () => {
    setConfigs(local);
    onClose();
    axios.post('http://localhost:8000/api/v1/configs', local)
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
        <h2 style={{ marginBottom: '20px', color: 'var(--accent-color)' }}>⚙️ Indicator Settings</h2>

        <details style={styleGroup} open>
          <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#60a5fa' }}>D-VP (Volume Profile Động)</summary>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Chế độ chia lưới</label>
            <select value={local.gridMode} onChange={e => handleChange('gridMode', e.target.value)} style={styleInput}>
              <option value="auto">Tự động (Chia theo số ô)</option>
              <option value="fixed">Cố định (Theo số Pip)</option>
            </select>
          </div>
          {local.gridMode === 'auto' ? (
            <div style={{ marginTop: '10px' }}>
              <label style={styleLabel}>Số lượng ô (Auto Mode)</label>
              <input type="number" value={local.rowCount} onChange={e => handleChange('rowCount', Number(e.target.value))} style={styleInput} />
            </div>
          ) : (
            <div style={{ marginTop: '10px' }}>
              <label style={styleLabel}>Số Pip mỗi ô (Fixed Mode)</label>
              <input type="number" step="0.25" value={local.fixedPips} onChange={e => handleChange('fixedPips', Number(e.target.value))} style={styleInput} />
            </div>
          )}
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Số giờ Timeout để Reset</label>
            <input type="number" value={local.timeoutHours} onChange={(e) => handleChange('timeoutHours', parseFloat(e.target.value))} style={styleInput} step="0.1" />
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Chu kỳ tính D-VP (Số giờ giới hạn vẽ DVP)</label>
            <input type="number" value={local.dvpLookbackHours} onChange={(e) => handleChange('dvpLookbackHours', parseInt(e.target.value))} style={styleInput} step="24" />
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Top Level 1 (Màu Đỏ) %</label>
            <input type="number" value={local.pct1} onChange={e => handleChange('pct1', Number(e.target.value))} style={styleInput} />
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Top Level 2 (Màu Tím) %</label>
            <input type="number" value={local.pct2} onChange={e => handleChange('pct2', Number(e.target.value))} style={styleInput} />
          </div>
        </details>

        <details style={styleGroup}>
          <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#34d399' }}>Chỉ báo VWAP & SD</summary>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Chu kỳ VWAP (vwapLength)</label>
            <input type="number" value={local.vwapLength} onChange={e => handleChange('vwapLength', Number(e.target.value))} style={styleInput} />
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Hệ số Band (vwapMult)</label>
            <input type="number" step="0.1" value={local.vwapMult} onChange={e => handleChange('vwapMult', Number(e.target.value))} style={styleInput} />
          </div>
        </details>

        <details style={styleGroup}>
          <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#f59e0b' }}>Chỉ báo Động lượng Lõi (Momentum)</summary>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Chu kỳ Động lượng (momLength)</label>
            <input type="number" value={local.momLength} onChange={e => handleChange('momLength', Number(e.target.value))} style={styleInput} />
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel} title="Chu kỳ của đường MA (màu trắng) chạy đè trên biểu đồ Momentum">Chu kỳ MA Động lượng (momMaLength)</label>
            <input type="number" value={local.momMaLength} onChange={e => handleChange('momMaLength', Number(e.target.value))} style={styleInput} />
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Chu kỳ Ma trận chung (Giờ)</label>
            <input type="number" value={local.matrixLookbackHours} onChange={e => handleChange('matrixLookbackHours', Number(e.target.value))} style={styleInput} title="Nhập số giờ để tính toán phân phối cho cả Động Lượng và Khối Lượng" />
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Xác suất Cao (momPct1)</label>
            <input type="number" value={local.momPct1} onChange={e => handleChange('momPct1', Number(e.target.value))} style={styleInput} />
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Xác suất Vừa (momPct2)</label>
            <input type="number" value={local.momPct2} onChange={e => handleChange('momPct2', Number(e.target.value))} style={styleInput} />
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Xác suất Trung vị (momPct3)</label>
            <input type="number" value={local.momPct3} onChange={e => handleChange('momPct3', Number(e.target.value))} style={styleInput} />
          </div>
          <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #334155' }}>
            <label style={styleLabel}>Mức lọc động lượng cho Flip (%)</label>
            <input type="number" value={local.momFlipFilterPct} onChange={e => handleChange('momFlipFilterPct', Number(e.target.value))} style={styleInput} title="Chỉ lấy những nến có Momentum lớn hơn mức này để phân phối Flip" />
          </div>
        </details>


        <details style={styleGroup}>
          <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#a78bfa' }}>Chỉ báo Khối lượng (Volume)</summary>
            <div style={{ marginTop: '10px' }}>
              <label style={styleLabel}>Chế độ hiển thị</label>
              <select value={local.volMode} onChange={e => handleChange('volMode', e.target.value)} style={styleInput}>
                <option value="normal">Normal (Phân phối Ma trận)</option>
                <option value="rvol">RVol (So sánh cùng giờ)</option>
              </select>
            </div>
            
            {local.volMode === 'rvol' && (
              <div style={{ marginTop: '10px' }}>
                <label style={styleLabel}>Chu kỳ RVol (Số Ngày)</label>
                <input type="number" value={local.rvolLookbackDays} onChange={e => handleChange('rvolLookbackDays', parseInt(e.target.value))} style={styleInput} title="Số ngày dùng để tính trung bình khối lượng của chính giờ này" />
              </div>
            )}

            <div style={{ marginTop: '10px' }}>
              <label style={styleLabel}>Cửa sổ tính Đỉnh/Đáy (Ngày)</label>
              <input type="number" value={local.peakVolLookbackDays} onChange={e => handleChange('peakVolLookbackDays', Number(e.target.value))} style={styleInput} title="Số ngày nhìn lại để thống kê giờ bùng nổ Volume" />
            </div>

            <div style={{ marginTop: '10px' }}>
              <label style={styleLabel}>Chu kỳ MA Volume</label>
              <input type="number" value={local.maVolLength} onChange={e => handleChange('maVolLength', parseInt(e.target.value))} style={styleInput} />
            </div>
            <div style={{ display: 'flex', gap: '15px', marginTop: '10px' }}>
              <div style={{ flex: 1 }}>
                <label style={styleLabel}>Xác suất Tím (volPct1)</label>
                <input type="number" value={local.volPct1} onChange={e => handleChange('volPct1', Number(e.target.value))} style={styleInput} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={styleLabel}>Xác suất Đỏ (volPct2)</label>
                <input type="number" value={local.volPct2} onChange={e => handleChange('volPct2', Number(e.target.value))} style={styleInput} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '15px', marginTop: '10px' }}>
              <div style={{ flex: 1 }}>
                <label style={styleLabel}>Xác suất Cam (volPct3)</label>
                <input type="number" value={local.volPct3} onChange={e => handleChange('volPct3', Number(e.target.value))} style={styleInput} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={styleLabel}>Xác suất Xanh (volPct4)</label>
                <input type="number" value={local.volPct4} onChange={e => handleChange('volPct4', Number(e.target.value))} style={styleInput} />
              </div>
            </div>
        </details>

        <details style={styleGroup}>
          <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#60a5fa' }}>🕒 Khung Giờ & Hiển Thị Thời Gian</summary>
          <div style={{ marginTop: '10px', paddingBottom: '10px', borderBottom: '1px solid #334155', marginBottom: '10px' }}>
            <label style={styleLabel}>Độ lệch thời gian (Giờ)</label>
            <input type="number" step="0.5" value={local.timeShiftHours} onChange={e => handleChange('timeShiftHours', Number(e.target.value))} style={styleInput} title="Nhập số giờ bị lệch (vd: 3 hoặc -3) để tinh chỉnh thủ công khớp với giờ của bạn" />
            <span style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px', display: 'block' }}>* Nếu trục thời gian đi trước 3 tiếng so với thực tế, nhập -3 để lùi lại.</span>
          </div>
          <div style={{ marginTop: '10px', paddingBottom: '10px', borderBottom: '1px solid #334155', marginBottom: '10px' }}>
            <label style={styleLabel}>Múi giờ của Sàn (Broker Timezone)</label>
            <select value={local.brokerTimezone || 'Europe/Athens'} onChange={e => handleChange('brokerTimezone', e.target.value)} style={styleInput}>
              <option value="Europe/Athens">Đông Âu (EET/EEST - Chuẩn Forex)</option>
              <option value="UTC">Giờ Quốc Tế (UTC - Thường dùng Crypto)</option>
              <option value="America/New_York">Giờ New York (EST/EDT)</option>
              <option value="Europe/London">Giờ London (GMT/BST)</option>
              <option value="Asia/Tokyo">Giờ Tokyo (JST)</option>
              <option value="Asia/Ho_Chi_Minh">Giờ Việt Nam (ICT)</option>
            </select>
            <span style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px', display: 'block' }}>* Dùng để tính toán chính xác dữ liệu lịch sử MT5 khi Backtest</span>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
            <label style={{ ...styleLabel, display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={local.autoDst} onChange={e => handleChange('autoDst', e.target.checked)} style={{ marginRight: '8px', cursor: 'pointer' }} />
              Tự động điều chỉnh DST (Mùa Hè/Đông)
            </label>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
            <div style={{ flex: 1 }}>
              <label style={styleLabel}>Phiên Á (Mở - Tokyo)</label>
              <input type="time" value={local.asiaStart} onChange={e => handleChange('asiaStart', e.target.value)} style={styleInput} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={styleLabel}>Phiên Á (Đóng - Tokyo)</label>
              <input type="time" value={local.asiaEnd} onChange={e => handleChange('asiaEnd', e.target.value)} style={styleInput} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
            <div style={{ flex: 1 }}>
              <label style={styleLabel}>Phiên Âu (Mở - London)</label>
              <input type="time" value={local.euroStart} onChange={e => handleChange('euroStart', e.target.value)} style={styleInput} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={styleLabel}>Phiên Âu (Đóng - London)</label>
              <input type="time" value={local.euroEnd} onChange={e => handleChange('euroEnd', e.target.value)} style={styleInput} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
            <div style={{ flex: 1 }}>
              <label style={styleLabel}>Phiên Mỹ (Mở - NY)</label>
              <input type="time" value={local.usStart} onChange={e => handleChange('usStart', e.target.value)} style={styleInput} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={styleLabel}>Phiên Mỹ (Đóng - NY)</label>
              <input type="time" value={local.usEnd} onChange={e => handleChange('usEnd', e.target.value)} style={styleInput} />
            </div>
          </div>
        </details>

        <details style={styleGroup}>
          <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#ef4444' }}>📧 Cấu hình Gửi Email Cảnh Báo</summary>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Email Gửi Đi (Tài khoản Gmail)</label>
            <input type="email" value={local.emailSender || ''} onChange={e => handleChange('emailSender', e.target.value)} style={styleInput} placeholder="ví dụ: abc@gmail.com" />
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Mật Khẩu Ứng Dụng (App Password)</label>
            <input type="password" value={local.emailPassword || ''} onChange={e => handleChange('emailPassword', e.target.value)} style={styleInput} placeholder="16 chữ cái do Google cấp" />
            <span style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px', display: 'block' }}>Vào Cài đặt tài khoản Google của bạn &gt; Bảo mật &gt; Bật Xác minh 2 bước &gt; Tạo Mật khẩu ứng dụng. Mã này chỉ lưu trữ tại máy của bạn.</span>
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Email Nhận Thông Báo</label>
            <input type="email" value={local.emailReceiver || ''} onChange={e => handleChange('emailReceiver', e.target.value)} style={styleInput} placeholder="Tên email để nhận thông báo (có thể giống bên trên)" />
          </div>
        </details>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer', color: 'white' }}>Hủy</button>
          <button onClick={handleSave} style={{ padding: '8px 16px', background: 'var(--accent-color)', border: 'none', color: 'white', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Lưu thay đổi</button>
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
    axios.get('http://localhost:8000/api/v1/catalyst')
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
      await axios.post('http://localhost:8000/api/v1/catalyst/refresh');
      loadCatalyst();
    } catch (err) {
      console.error('Refresh failed:', err);
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) return <div style={{ padding: '20px', color: 'white' }}>Đang tải dữ liệu Catalyst...</div>;

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
        <h2 style={{ color: 'var(--accent-color)', margin: 0 }}>📅 Bảng Tin Tức & Catalyst Tuần</h2>
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
          <span style={{ display: 'inline-block', animation: refreshing ? 'spin 1s linear infinite' : 'none' }}>🔄</span>
          {refreshing ? 'Đang cập nhật...' : 'Cập nhật tin tức'}
        </button>
      </div>
      {Object.keys(grouped).map(day => (
        <div key={day} style={{ marginBottom: '30px', background: 'var(--bg-panel)', borderRadius: '12px', padding: '15px' }}>
          <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '10px', marginBottom: '15px', color: '#60a5fa' }}>{day}</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <th style={{ padding: '10px 5px', color: 'var(--text-secondary)' }}>Giờ</th>
                <th style={{ padding: '10px 5px', color: 'var(--text-secondary)' }}>Quốc gia</th>
                <th style={{ padding: '10px 5px', color: 'var(--text-secondary)' }}>Tác động</th>
                <th style={{ padding: '10px 5px', color: 'var(--text-secondary)' }}>Tin tức</th>
                <th style={{ padding: '10px 5px', color: 'var(--text-secondary)' }}>Trước đó</th>
                <th style={{ padding: '10px 5px', color: 'var(--text-secondary)' }}>Dự báo</th>
                <th style={{ padding: '10px 5px', color: 'var(--text-secondary)' }}>Thực tế</th>
                <th style={{ padding: '10px 5px', color: 'var(--text-secondary)' }}>Đánh giá</th>
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
                    {item.evaluation === 'Positive' ? 'Tích cực' : (item.evaluation === 'Negative' ? 'Tiêu cực' : (item.evaluation === 'Neutral' ? 'Trung tính' : '-'))}
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

const DEFAULT_SYMBOLS = {
  "15 Cặp tiền tệ chính": [
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
  "Hàng hoá & Kim loại": [
    {name: "GOLD", description: "Gold (XM)"}
  ],
  "Tiền điện tử": [
    {name: "BTCUSD", description: "Bitcoin vs US Dollar"},
    {name: "ETHUSD", description: "Ethereum vs US Dollar"},
    {name: "SOLUSD", description: "Solana vs US Dollar"}
  ],
  "Chỉ số chứng khoán": [
    {name: "US100-DEC26", description: "Nasdaq 100 (Future)"},
    {name: "US100", description: "Nasdaq 100"},
    {name: "US500", description: "S&P 500"},
    {name: "US30", description: "Dow Jones 30"},
    {name: "GER40", description: "DAX 40"},
    {name: "UK100", description: "FTSE 100"}
  ]
};

function App() {
  const [symbol, setSymbol] = useState('EURUSD');

  const [alerts, setAlerts] = useState([]);
  const [toasts, setToasts] = useState([]);
  
  const knownTriggeredRef = useRef(new Set());

  const fetchAlerts = async () => {
    try {
      const res = await axios.get(`http://localhost:8000/api/v1/alerts?_t=${Date.now()}`);
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
                direction: "Kích hoạt!",
                note: a.note
             });
         }
      });
      
      if (newToasts.length > 0) {
         setToasts(prev => [...prev, ...newToasts]);
      }
    } catch (e) {
      console.error("Lỗi fetch alerts:", e);
    }
  };

  const handleAddAlert = async (alertData) => {
    try {
      const newAlert = { ...alertData, id: Date.now(), status: 'active' };
      await axios.post('http://localhost:8000/api/v1/alerts', newAlert);
      fetchAlerts(); 
    } catch (e) { console.error(e); }
  };

  const handleDeleteAlert = async (id) => {
    try {
      // Remove optimistic update to prevent race conditions with in-flight polling
      await axios.delete(`http://localhost:8000/api/v1/alerts/${id}`);
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
              osc.type = 'sine';
              osc.frequency.setValueAtTime(880, startTime);
              osc.frequency.exponentialRampToValueAtTime(440, startTime + 0.15);
              gainNode.gain.setValueAtTime(0.5, startTime);
              gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + 0.15);
              osc.connect(gainNode);
              gainNode.connect(ctx.destination);
              osc.start(startTime);
              osc.stop(startTime + 0.15);
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
  const [alertSymbol, setAlertSymbol] = useState(symbol);
  
  useEffect(() => {
    setAlertSymbol(symbol);
  }, [symbol]);

  const [timeframe, setTimeframe] = useState('H1');
  const [viewMode, setViewMode] = useState('chart'); // 'chart' hoặc 'matrix'
  const [chartType, setChartType] = useState(localStorage.getItem('chartType') || 'candles');
  const [showSdBands, setShowSdBands] = useState(localStorage.getItem('showSdBands') !== 'false');
  const [showMomFlipChart, setShowMomFlipChart] = useState(false);
  const [showVolChart, setShowVolChart] = useState(localStorage.getItem('showVolChart') !== 'false');
  const [showMomChart, setShowMomChart] = useState(localStorage.getItem('showMomChart') !== 'false');
  const [showMatrixBubble, setShowMatrixBubble] = useState(localStorage.getItem('showMatrixBubble') === 'true');
  const [bubbleMatrixData, setBubbleMatrixData] = useState(null);
  

  
  const [configs, setConfigs] = useState(() => ({
    pct1: 70,
    pct2: 85,
    gridMode: 'auto',
    fixedPips: 10.0,
    rowCount: 50,
    timeoutHours: 1.0,
    dvpLookbackHours: 120,
    vwapLength: 89,
    vwapMult: 2.0,
    momLength: 20,
    matrixLookbackHours: 24,
    momFlipFilterPct: 75.0,
    volMode: 'normal',
    rvolLookbackDays: 10,
    peakVolLookbackDays: 60,
    momPct1: 85,
    momPct2: 75,
    momPct3: 50,
    maVolLength: 2,
    momMaLength: 3,
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
      const mVolDays = Number(localStorage.getItem('currencyMatrixVolDays')) || 30;
      let url = `http://localhost:8000/api/v1/matrix?brokerTimezone=${encodeURIComponent(bTime)}&n_hours=${mHours}&vol_days=${mVolDays}`;
      if (viewMode === 'backtest' && window.currentSimulatedTime) {
        url += `&end_time=${window.currentSimulatedTime}`;
      }
      axios.get(url).then(res => {
        if (res.data && res.data.ranking) {
          setBubbleMatrixData(res.data.ranking);
        }
      }).catch(err => console.error(err));
    };
    fetchBubbleMatrix();
    const interval = setInterval(fetchBubbleMatrix, 2000);
    return () => clearInterval(interval);
  }, [showMatrixBubble, viewMode, configs.brokerTimezone]);

  useEffect(() => {
    axios.get('http://localhost:8000/api/v1/symbols')
      .then(res => {
         if (res.data.status === 'success') {
             setAvailableSymbols(res.data.data);
         }
      })
      .catch(err => console.error("Could not load symbols from backend", err));
  }, []);

  useEffect(() => {
    axios.get('http://localhost:8000/api/v1/configs')
      .then(res => {
         const data = res.data;
         if (Object.keys(data).length > 0) {
             setConfigs(prev => ({ ...prev, ...data }));
         }
      })
      .catch(err => console.error("Could not load configs from backend", err));
  }, []);

  // Kích hoạt lại resize khi ẩn/hiện thanh công cụ để chart tự giãn cách
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
              <span>🔔 {t.symbol}</span>
              <button className="toast-close" onClick={() => setToasts(toasts.filter(x => x.id !== t.id))}>✕</button>
            </div>
            <div className="toast-body">
              <div>Giá: <strong>{t.price}</strong></div>
              <div style={{ color: t.direction.includes('Lên') ? '#22c55e' : '#ef4444' }}>{t.direction}</div>
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
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Cặp tiền tệ (Symbol)</label>
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)} style={{ width: '100%' }}>
              <optgroup label="Chỉ số Tổng hợp">
                <option value="GLOBAL_INDEX">Thị trường chung (GLOBAL INDEX)</option>
              </optgroup>
              {availableSymbols ? (
                Object.keys(availableSymbols).map(group => (
                  <optgroup key={group} label={group}>
                    {availableSymbols[group].map(s => (
                      <option key={s.name} value={s.name}>{s.description} ({s.name})</option>
                    ))}
                  </optgroup>
                ))
              ) : (
                <optgroup label="Đang tải danh sách...">
                  <option value="EURUSD">EURUSD</option>
                </optgroup>
              )}
            </select>
          </div>
          
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Khung thời gian (Timeframe)</label>
            <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)} style={{ width: '100%' }}>
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
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Loại biểu đồ (Chart Type)</label>
            <select value={chartType} onChange={(e) => {
              setChartType(e.target.value);
              localStorage.setItem('chartType', e.target.value);
            }} style={{ width: '100%' }}>
              <option value="candles">Nến (Candlestick)</option>
              <option value="line">Đường (Line - Close)</option>
              <option value="hlc">HLC (High - Low - Close)</option>
              <option value="money_flow">Money Flow</option>
            </select>
          </div>
          

          
          <div style={{ marginTop: '20px', borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
            <h3 style={{ fontSize: '0.9rem', marginBottom: '10px', color: 'var(--text-secondary)' }}>Tính năng</h3>
            <button 
              onClick={() => setViewMode('chart')}
              style={{ width: '100%', marginBottom: '10px', textAlign: 'left', background: viewMode === 'chart' ? 'rgba(59, 130, 246, 0.2)' : '' }}
            >
              📈 Biểu đồ Chart
            </button>
            <button 
              onClick={() => setViewMode('matrix')}
              style={{ width: '100%', marginBottom: '10px', textAlign: 'left', background: viewMode === 'matrix' ? 'rgba(59, 130, 246, 0.2)' : '' }}
            >
              ⚡ Currency Matrix
            </button>
            <button 
              onClick={() => setViewMode('backtest')}
              style={{ width: '100%', marginBottom: '10px', textAlign: 'left', background: viewMode === 'backtest' ? 'rgba(59, 130, 246, 0.2)' : '' }}
            >
              ⏪ Backtest Mode
            </button>
            <button 
              onClick={() => setViewMode('catalyst')}
              style={{ width: '100%', marginBottom: '10px', textAlign: 'left', background: viewMode === 'catalyst' ? 'rgba(59, 130, 246, 0.2)' : '' }}
            >
              📅 Lịch Catalyst
            </button>
            <button onClick={() => setShowSettings(true)} style={{ width: '100%', textAlign: 'left' }}>⚙️ Indicator Settings</button>
          </div>
          <div style={{ marginTop: '20px', borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
            <h3 style={{ fontSize: '0.9rem', marginBottom: '10px', color: 'var(--text-secondary)' }}>⏰ Cảnh báo Giá (Alerts)</h3>
            
            <div style={{ display: 'flex', gap: '5px', marginBottom: '5px' }}>
              <select 
                value={alertSymbol} 
                onChange={e => setAlertSymbol(e.target.value)}
                style={{ padding: '6px', borderRadius: '4px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', color: 'white', maxWidth: '85px', fontSize: '0.8rem' }}
              >
                <option value="GLOBAL_INDEX">GI</option>
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
              <input 
                type="number" 
                placeholder="Giá" 
                value={newAlertPrice}
                onChange={e => setNewAlertPrice(e.target.value)}
                style={{ flex: 1, padding: '6px', borderRadius: '4px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', color: 'white', minWidth: 0 }}
              />
            </div>
            <div style={{ display: 'flex', gap: '5px', marginBottom: '15px' }}>
              <input 
                type="text" 
                placeholder="Ghi chú (Tùy chọn)" 
                value={newAlertNote}
                onChange={e => setNewAlertNote(e.target.value)}
                style={{ flex: 1, padding: '6px', borderRadius: '4px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', color: 'white' }}
              />
              <button 
                className="primary" 
                style={{ padding: '6px 12px' }}
                onClick={() => {
                  if(!newAlertPrice) return;
                  handleAddAlert({ symbol: alertSymbol, price: parseFloat(newAlertPrice), note: newAlertNote });
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
                      <span style={{ marginLeft: '5px' }}>{a.price}</span>
                      {a.status === 'triggered' && <span style={{ marginLeft: '5px', color: '#ef4444' }}>(Triggered)</span>}
                    </div>
                    {a.note && <span style={{ color: '#94a3b8', fontSize: '0.75rem', marginTop: '2px', fontStyle: 'italic' }}>{a.note}</span>}
                  </div>
                  <button onClick={() => handleDeleteAlert(a.id)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0 5px' }}>✕</button>
                </div>
              ))}
              {alerts.length === 0 && <div style={{ fontSize: '0.8rem', color: '#94a3b8', fontStyle: 'italic' }}>Chưa có cảnh báo nào</div>}
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
              ☰
            </button>
            {viewMode === 'chart' ? `${symbol} • ${timeframe}` : viewMode === 'backtest' ? `${symbol} • ${timeframe} (Backtest Mode)` : viewMode === 'catalyst' ? 'Lịch Tin tức Catalyst' : 'Currency Strength Matrix'}
          </div>
          <div className="toolbar">
            
          </div>
        </header>
        
        <div className="chart-container">
          <div className="chart-wrapper" style={{ overflow: (viewMode === 'matrix' || viewMode === 'catalyst') ? 'auto' : 'hidden' }}>
            {viewMode === 'chart' || viewMode === 'backtest' ? (
              <ChartComponent symbol={symbol} timeframe={timeframe} configs={configs} viewMode={viewMode} alerts={alerts} setAlerts={setAlerts} handleAddAlert={handleAddAlert} chartType={chartType} showSdBands={showSdBands} showMomFlipChart={showMomFlipChart} showVolChart={showVolChart} showMomChart={showMomChart} />
            ) : viewMode === 'matrix' ? (
              <MatrixComponent simulatedTime={null} brokerTimezone={configs.brokerTimezone || 'Europe/Athens'} matrixHours={configs.matrixHours || 24} matrixVolDays={configs.matrixVolDays || 30} />
            ) : (
              <CatalystTab configs={configs} />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;










