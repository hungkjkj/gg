import React, { useState, useEffect, useRef } from 'react';
import { createChart, ColorType } from 'lightweight-charts';
import axios from 'axios';
import { AssistiveTouch, MomFlipChartComponent } from './components/MomFlip';
import { SessionMatrixTable } from './components/SessionMatrixTable';
import MarketFlowMatrix from './components/MarketFlowMatrix';
import { computeCompositeRanking } from './utils/matrixUtils';
import StrategyBuilderTab from './components/StrategyBuilderTab';
import RrTool from './components/RrTool';
import TradingLogPanel from './components/TradingLogPanel';
import './index.css';

const API_BASE = window.location.port === '5173' ? 'http://127.0.0.1:8000' : window.location.origin;
const assetSpreadRequests = new Map();

const fetchAssetSpread = (symbol, matrixType, brokerTimezone) => {
  const key = `${symbol}|${matrixType}|${brokerTimezone}`;
  if (assetSpreadRequests.has(key)) return assetSpreadRequests.get(key);
  const request = axios.get(`${API_BASE}/api/v1/symbol-info/spread`, {
    params: { symbol, matrix_type: matrixType, brokerTimezone },
  }).then(response => response.data).finally(() => assetSpreadRequests.delete(key));
  assetSpreadRequests.set(key, request);
  return request;
};

const ASSET_INFO_REFRESH_MS = 5 * 60 * 1000;
const assetInfoCache = new Map();

const buildAssetInfoRequestSet = (symbol, configs = {}) => {
  const matrixType = getMatrixTypeForSymbol(symbol);
  const matrixHours = Number(localStorage.getItem('currencyMatrixHours')) || Number(configs.matrixHours) || 24;
  const matrixHoursLong = Number(localStorage.getItem('currencyMatrixHoursLong')) || 89;
  const commonMatrixParams = {
    matrix_type: matrixType,
    vol_days: Number(configs.matrixVolDays) || 30,
    brokerTimezone: configs.brokerTimezone || 'Europe/Athens',
  };
  const sessionParams = {
    ...commonMatrixParams,
    short_hours: matrixHours,
    long_hours: matrixHoursLong,
    end_time: 0,
    browserOffsetHours: -new Date().getTimezoneOffset() / 60,
    autoDst: configs.autoDst ?? true,
    asiaStart: configs.asiaStart || '07:00',
    asiaEnd: configs.asiaEnd || '11:00',
    euroStart: configs.euroStart || '07:00',
    euroEnd: configs.euroEnd || '09:00',
    preUsStart: configs.preUsStart || '16:00',
    preUsEnd: configs.preUsEnd || '19:00',
    usStart: configs.usStart || '07:30',
    usEnd: configs.usEnd || '11:00',
  };
  const dvpParams = {
    ...commonMatrixParams,
    dvp_lookback_days: configs.dvpLookbackDays,
    vwap_length: configs.vwapLength,
    vwap_mult: configs.vwapMult,
    pct1: configs.pct1,
    grid_mode: configs.gridMode,
    fixed_pips: configs.fixedPips,
    row_count: configs.rowCount,
    timeout_hours: configs.timeoutHours,
    force: false,
  };
  const requests = [
    { name: 'trendShort', section: 'matrix', url: `${API_BASE}/api/v1/matrix`, params: { ...commonMatrixParams, n_hours: matrixHours, matrix_mode: 'trend' } },
    { name: 'flowShort', section: 'matrix', url: `${API_BASE}/api/v1/matrix`, params: { ...commonMatrixParams, n_hours: matrixHours, matrix_mode: 'money_flow' } },
    { name: 'trendLong', section: 'matrix', url: `${API_BASE}/api/v1/matrix`, params: { ...commonMatrixParams, n_hours: matrixHoursLong, matrix_mode: 'trend' } },
    { name: 'flowLong', section: 'matrix', url: `${API_BASE}/api/v1/matrix`, params: { ...commonMatrixParams, n_hours: matrixHoursLong, matrix_mode: 'money_flow' } },
    { name: 'dvp', url: `${API_BASE}/api/v1/matrix/dvp-trend`, params: dvpParams },
    { name: 'spread', url: `${API_BASE}/api/v1/symbol-info/spread`, params: { symbol, matrix_type: matrixType, brokerTimezone: commonMatrixParams.brokerTimezone } },
    { name: 'sessionStats', url: `${API_BASE}/api/v1/matrix/session-stats`, params: sessionParams },
  ];
  const cacheKey = `${normalizeInfoSymbol(symbol)}|${JSON.stringify(requests.map(({ name, url, params }) => ({ name, url, params })))}`;
  return { cacheKey, matrixHours, matrixHoursLong, requests };
};

const assetInfoStorageKey = cacheKey => {
  let hash = 2166136261;
  for (let index = 0; index < cacheKey.length; index += 1) {
    hash ^= cacheKey.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `assetInfoCache:v2:${(hash >>> 0).toString(16)}`;
};

const assetInfoSnapshot = entry => ({
  data: { ...entry.data, matrix: { ...entry.data.matrix } },
  loading: entry.refreshing,
  updatedAt: entry.updatedAt,
  error: entry.failures > 0
    ? (entry.hasData ? 'Một vài mục chưa cập nhật được; đang giữ dữ liệu gần nhất.' : 'Không tải được dữ liệu thông tin cho cặp này.')
    : '',
});

const subscribeAssetInfo = (symbol, configs, listener) => {
  const requestSet = buildAssetInfoRequestSet(symbol, configs);
  const matrixType = getMatrixTypeForSymbol(symbol);
  const storageKey = assetInfoStorageKey(requestSet.cacheKey);
  let entry = assetInfoCache.get(requestSet.cacheKey);
  if (!entry) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { /* Ignore a damaged local cache. */ }
    const data = saved?.data || {};
    entry = {
      data: { matrix: data.matrix || {}, dvp: data.dvp || null, spread: data.spread || null, sessionStats: data.sessionStats || null },
      updatedAt: Number(saved?.updatedAt) || 0,
      failures: 0,
      hasData: Boolean(saved?.hasData || data.dvp || data.spread || data.sessionStats || Object.keys(data.matrix || {}).length),
      refreshing: false,
      pending: 0,
      listeners: new Set(),
    };
    assetInfoCache.set(requestSet.cacheKey, entry);
  }
  entry.listeners.add(listener);
  listener(assetInfoSnapshot(entry));

  const notify = () => entry.listeners.forEach(callback => callback(assetInfoSnapshot(entry)));
  const persist = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ data: entry.data, updatedAt: entry.updatedAt, hasData: entry.hasData }));
    } catch (error) {
      console.warn('Could not persist asset info cache on this device:', error);
    }
  };
  const refresh = () => {
    if (entry.refreshing) return;
    entry.refreshing = true;
    entry.failures = 0;
    entry.pending = requestSet.requests.length;
    notify();
    requestSet.requests.forEach(request => {
      const requestPromise = request.name === 'spread'
        ? fetchAssetSpread(symbol, matrixType, request.params.brokerTimezone)
        : axios.get(request.url, { params: request.params }).then(response => response.data);
      requestPromise.then(value => {
        if (request.section === 'matrix') entry.data.matrix = { ...entry.data.matrix, [request.name]: value };
        else entry.data[request.name] = value;
        entry.hasData = true;
        persist();
      }).catch(error => {
        entry.failures += 1;
        console.warn(`Could not load ${request.name} info for ${symbol}:`, error);
      }).finally(() => {
        entry.pending -= 1;
        if (entry.pending <= 0) {
          entry.refreshing = false;
          entry.updatedAt = Date.now();
          persist();
        }
        notify();
      });
    });
  };

  if (!entry.refreshing && (!entry.updatedAt || Date.now() - entry.updatedAt >= ASSET_INFO_REFRESH_MS)) refresh();
  return () => entry.listeners.delete(listener);
};

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

const generateFutureTimeline = (cTime, tfSec, count, isCrypto = false, timeShiftHours = 0) => {
    const futureTimes = [];
    let t = cTime + tfSec;
    for (let i = 0; i < count; i++) {
        const brokerT = t - (timeShiftHours * 3600);
        const date = new Date(brokerT * 1000);
        const day = date.getUTCDay();
        const h = date.getUTCHours();
        
        let skip = false;
        if (!isCrypto) {
            // MT5 returns timestamps in UTC (Unix timestamp).
            // Forex market usually closes around Friday 21:00 or 22:00 UTC
            // and opens around Sunday 21:00 or 22:00 UTC.
            if (day === 5 && h >= 22) {
                skip = true;
            } else if (day === 6) {
                skip = true;
            } else if (day === 0 && h < 21) {
                skip = true;
            }
        }
        
        if (!skip) {
            futureTimes.push({ time: t, value: 0 });
        } else {
            i--; // Skip weekends
        }
        t += tfSec;
    }
    return futureTimes;
};

const getTimeZoneOffsetMinutes = (timestamp, timeZone) => {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hourCycle: 'h23'
        }).formatToParts(new Date(timestamp * 1000));
        const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
        const localAsUtc = Date.UTC(
            Number(values.year), Number(values.month) - 1, Number(values.day),
            Number(values.hour), Number(values.minute), Number(values.second)
        );
        return (localAsUtc - Math.floor(timestamp) * 1000) / 60000;
    } catch (e) {
        return 0;
    }
};

const ChartComponent = ({ symbol, timeframe, configs, viewMode = 'chart', alerts = [], setAlerts, handleAddAlert, chartType, chartTheme, showSdBands, showMomFlipChart, showVolChart = true, showMomChart = true }) => {
  const momFlipDataRef = useRef([]);
  const [momFlipDataVersion, setMomFlipDataVersion] = useState(0);
  const [momFlipDataRevision, setMomFlipDataRevision] = useState(0);
  const [currentSdPosition, setCurrentSdPosition] = useState(null);
  const [currentSessionSdPosition, setCurrentSessionSdPosition] = useState(null);
  const [sessionSdPositions, setSessionSdPositions] = useState([]);
  const [selectedSessionSdKey, setSelectedSessionSdKey] = useState('');
  const selectedSessionSdPosition = sessionSdPositions.find(position => position.key === selectedSessionSdKey);
  const chartContainerRef = useRef(null);
  const sessionSdTooltipRef = useRef(null);
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
  const sessionVwapBandSeriesRef = useRef({});
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
  
  // Các đường xác suất Volume
  const normVolSeriesRef = useRef(null);
  const projectedVolSeriesRef = useRef(null);
  const maVolSeriesRef = useRef(null);
  const rawCandlesRef = useRef([]);
  const configsRef = useRef(configs);
  configsRef.current = configs;
  const prevVolModeRef = useRef(configs.volMode);
  const prevBackendConfigsRef = useRef(null);

  useEffect(() => {
    setCurrentSdPosition(null);
    setCurrentSessionSdPosition(null);
    setSessionSdPositions([]);
  }, [symbol, timeframe]);
  
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

  const addRrTool = (type, price, logical, time) => {
    const offset = price * 0.002;
    const tfSec = timeframe === 'M1' ? 60 : timeframe === 'M3' ? 180 : timeframe === 'M5' ? 300 : timeframe === 'M15' ? 900 : timeframe === 'M30' ? 1800 : timeframe === 'H1' ? 3600 : timeframe === 'H2' ? 7200 : timeframe === 'H4' ? 14400 : timeframe === 'H8' ? 28800 : timeframe === 'D1' ? 86400 : 3600;
    
    const newTool = {
      id: Date.now().toString(),
      type,
      entryPrice: price,
      targetPrice: type === 'long' ? price + offset*2 : price - offset*2,
      stopPrice: type === 'long' ? price - offset : price + offset,
      time: time || null,
      endTime: time ? time + (20 * tfSec) : null,
      barsCount: 20,
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
  const vpBoxesRef = useRef([]);
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
  const [backtestNewsStatus, setBacktestNewsStatus] = useState('Chưa tải');
  const simulatedTimeRef = useRef(0);
  const isPlayingRef = useRef(false);
  const lastMaVolColorRef = useRef(null);
  const lastHl2ColorRef = useRef(null);
  const lastBandwidthRef = useRef(null);
  const lastSdColorRef = useRef(null);
  
  // Dừng backtest khi đổi cặp tiền hoặc khung thời gian
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

  const updateVolumeSeries = (targetMode) => {
    if (!normVolSeriesRef.current || !rawCandlesRef.current || rawCandlesRef.current.length === 0) return;
    const rawData = rawCandlesRef.current;
    const mode = targetMode || configsRef.current?.volMode || 'normal';

    let projectedNormVol = [];
    if (mode === 'mean_vol') {
      const tfSec = timeframe === 'M1' ? 60 : timeframe === 'M3' ? 180 : timeframe === 'M5' ? 300 : timeframe === 'M15' ? 900 : timeframe === 'M30' ? 1800 : timeframe === 'H1' ? 3600 : timeframe === 'H2' ? 7200 : timeframe === 'H4' ? 14400 : timeframe === 'H8' ? 28800 : timeframe === 'D1' ? 86400 : 3600;
      let cTime = rawData.length > 0 ? rawData[rawData.length - 1].time : Math.floor(Date.now() / 1000);
      cTime = cTime - (cTime % tfSec);

      const rawMap = new Map();
      rawData.forEach(d => rawMap.set(d.time, d));

      const isCrypto = symbol.includes("BTC") || symbol.includes("ETH") || symbol.includes("SOL") || symbol.includes("XRP") || symbol.includes("CRYPTO");
      const futureTimes = generateFutureTimeline(cTime, tfSec, 1500, isCrypto, configsRef.current?.timeShiftHours || 0);

      futureTimes.forEach(ft => {
        const pastTime = ft.time - (7 * 86400); // 1 week ago
        const pastRaw = rawMap.get(pastTime);
        if (pastRaw && pastRaw.mean_ma_vol != null && !isNaN(pastRaw.mean_ma_vol)) {
          let color = 'rgba(0, 240, 255, 0.1)';
          const value = pastRaw.mean_ma_vol;
          const lvl1 = pastRaw.mean_vol_lvl1;
          const lvl2 = pastRaw.mean_vol_lvl2;
          const lvl3 = pastRaw.mean_vol_lvl3;
          const lvl4 = pastRaw.mean_vol_lvl4;
          if (value <= lvl4) color = 'rgba(0, 240, 255, 0.5)';
          else if (value <= lvl3) color = 'rgba(255, 165, 0, 0.5)';
          else if (value <= lvl2) color = 'rgba(255, 69, 0, 0.5)';
          else if (value <= lvl1) color = 'rgba(255, 0, 0, 0.6)';

          projectedNormVol.push({ time: ft.time, value: value, color });
        }
      });
    }

    const normVolData = rawData.filter(d => {
      if (mode === 'rvol') return d.rvol != null && !isNaN(d.rvol);
      if (mode === 'mean_vol') return d.mean_ma_vol != null && !isNaN(d.mean_ma_vol);
      return d.norm_vol != null && !isNaN(d.norm_vol);
    }).map(i => {
      let color = '#9c27b0';
      let value = i.norm_vol;
      if (mode === 'rvol') value = i.rvol;
      if (mode === 'mean_vol') value = i.mean_ma_vol;

      if (mode === 'rvol') {
        if (value < 0.5) color = '#0033ff';
        else if (value < 1.0) color = '#ff8c00';
        else if (value < 2.0) color = '#ffff00';
        else color = '#ff3333';
      } else {
        const lvl1 = mode === 'mean_vol' ? i.mean_vol_lvl1 : i.vol_lvl1;
        const lvl2 = mode === 'mean_vol' ? i.mean_vol_lvl2 : i.vol_lvl2;
        const lvl3 = mode === 'mean_vol' ? i.mean_vol_lvl3 : i.vol_lvl3;
        const lvl4 = mode === 'mean_vol' ? i.mean_vol_lvl4 : i.vol_lvl4;

        if (value <= lvl4) color = '#0033ff';
        else if (value <= lvl3) color = '#ff8c00';
        else if (value <= lvl2) color = '#ffff00';
        else if (value <= lvl1) color = '#ff3333';
      }
      return { time: i.time, value: value, color };
    }).sort((a,b)=>a.time-b.time);

    const lvl1Field = mode === 'mean_vol' ? 'mean_vol_lvl1' : 'vol_lvl1';
    const lvl2Field = mode === 'mean_vol' ? 'mean_vol_lvl2' : 'vol_lvl2';
    const lvl3Field = mode === 'mean_vol' ? 'mean_vol_lvl3' : 'vol_lvl3';
    const lvl4Field = mode === 'mean_vol' ? 'mean_vol_lvl4' : 'vol_lvl4';

    const v85 = mode === 'rvol' ? [] : rawData.filter(d => d[lvl1Field] != null && !isNaN(d[lvl1Field])).map(i => ({time: i.time, value: i[lvl1Field]})).sort((a,b)=>a.time-b.time);
    const v75 = mode === 'rvol' ? [] : rawData.filter(d => d[lvl2Field] != null && !isNaN(d[lvl2Field])).map(i => ({time: i.time, value: i[lvl2Field]})).sort((a,b)=>a.time-b.time);
    const v50 = mode === 'rvol' ? [] : rawData.filter(d => d[lvl3Field] != null && !isNaN(d[lvl3Field])).map(i => ({time: i.time, value: i[lvl3Field]})).sort((a,b)=>a.time-b.time);
    const v15 = mode === 'rvol' ? [] : rawData.filter(d => d[lvl4Field] != null && !isNaN(d[lvl4Field])).map(i => ({time: i.time, value: i[lvl4Field]})).sort((a,b)=>a.time-b.time);

    normVolSeriesRef.current.setData(normVolData.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
    if (vol85Ref.current) vol85Ref.current.setData(v85.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
    if (vol75Ref.current) vol75Ref.current.setData(v75.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
    if (vol50Ref.current) vol50Ref.current.setData(v50.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
    if (vol15Ref.current) vol15Ref.current.setData(v15.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));

    if (projectedVolSeriesRef.current) {
      projectedVolSeriesRef.current.setData(mode === 'mean_vol' ? projectedNormVol.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)) : []);
    }

    if (updateOverlaysRef.current) {
      setTimeout(() => updateOverlaysRef.current && updateOverlaysRef.current(), 100);
    }
  };

  useEffect(() => {
    if (prevVolModeRef.current !== configs.volMode) {
      prevVolModeRef.current = configs.volMode;
      if (rawCandlesRef.current && rawCandlesRef.current.length > 0) {
        updateVolumeSeries(configs.volMode);
      }
    }
  }, [configs.volMode]);

// Fetch News Data
  const fetchNews = async (isCurrentRequest = () => true) => {
    try {
      const response = await axios.get(`${API_BASE}/api/v1/news`, {
        params: { symbol }
      });
      if (isCurrentRequest() && response.data.status === 'success') {
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
    let isCurrentRequest = true;
    if (viewMode === 'chart') {
      fetchNews(() => isCurrentRequest);
    } else {
      setNewsData([]);
      newsDataRef.current = [];
    }
    return () => { isCurrentRequest = false; };
  }, [symbol, configs.timeShiftHours, viewMode]);

  // Apply News Markers and Future Timeline (for v_lines and news)
  const applyTimelineAndMarkers = () => {
    if (newsSeriesRef.current) {
      let visibleTimeRange = null;
      try {
        visibleTimeRange = chartRef.current?.timeScale().getVisibleRange() || null;
      } catch (e) {}

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
      
      const isCrypto = symbol.includes("BTC") || symbol.includes("ETH") || symbol.includes("SOL") || symbol.includes("XRP") || symbol.includes("CRYPTO");
      const futureTimes = generateFutureTimeline(currentTime, tfSec, requiredBars, isCrypto, configs.timeShiftHours || 0);

      
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
          // Updating the dummy timeline can shift the chart by logical bar index.
          // Restore the actual time range so a backtest stays anchored to its loaded date.
          if (visibleTimeRange && chartRef.current) {
            chartRef.current.timeScale().setVisibleRange(visibleTimeRange);
          }

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
    
    // Đóng modal cũ nếu đang mở
    setCustomAlertModal(null);
    setAlertNoteInput('');

    const rect = chartContainerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const price = candlestickSeriesRef.current.coordinateToPrice(y);
    if (price !== null) {
      const timeScale = chartRef.current ? chartRef.current.timeScale() : null;
      const logical = timeScale ? timeScale.coordinateToLogical(x) : null;
      const time = timeScale ? timeScale.coordinateToTime(x) : null;
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        price: price,
        symbol: symbolRef.current,
        logical: logical,
        time: time
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
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const price = candlestickSeriesRef.current.coordinateToPrice(y);
        
        if (price !== null) {
          const timeScale = chartRef.current.timeScale();
          const logical = timeScale.coordinateToLogical(x);
          const time = timeScale.coordinateToTime(x);
          // IMPORTANT: Need to use functional state update or just directly set it.
          // Because setContextMenu is from useState, it is always available.
          setContextMenu({
            x: e.clientX,
            y: e.clientY,
            price: price,
            symbol: symbolRef.current,
            logical: logical,
            time: time
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
                 title: a.note ? `🔔 ${a.note}` : '🔔 Alert',
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
                 title: 'Quan sát',
             });
             drawnLinePrimitivesRef.current[l.id] = line;
         }
     });
  }, [drawnLines, symbol, chartReady]);

useEffect(() => {
    // Khởi tạo biểu đồ
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
        rightOffset: 5,
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

    const alertsSeries = chart.addLineSeries({
      color: 'rgba(0,0,0,0)',
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    alertsSeriesRef.current = alertsSeries;

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#00f0ff',
      downColor: '#ff3333',
      borderVisible: false,
      wickUpColor: '#00f0ff',
      wickDownColor: '#ff3333',
      priceLineVisible: false,
      priceFormat: {
        type: 'price',
        precision: precision,
        minMove: minMove,
      },
      // D-VP rectangles are drawn on a canvas layer, so the chart's price
      // autoscale would otherwise ignore them. This is especially noticeable
      // on M1, whose candle history is much shorter than the D-VP lookback.
      autoscaleInfoProvider: original => {
        const info = original();
        if (!info?.priceRange) return info;

        const visibleRange = chart.timeScale().getVisibleRange();
        if (!visibleRange) return info;
        const toTimestamp = value => {
          if (typeof value === 'number') return value;
          if (value && typeof value === 'object' && value.year && value.month && value.day) {
            return Date.UTC(value.year, value.month - 1, value.day) / 1000;
          }
          return NaN;
        };
        const visibleFrom = toTimestamp(visibleRange.from);
        const visibleTo = toTimestamp(visibleRange.to);
        if (!Number.isFinite(visibleFrom) || !Number.isFinite(visibleTo)) return info;

        let minValue = info.priceRange.minValue;
        let maxValue = info.priceRange.maxValue;
        for (const box of vpBoxesRef.current || []) {
          const start = Number(box.start);
          const end = Number(box.end);
          const price = Number(box.price);
          const halfHeight = Math.abs(Number(box.height)) / 2;
          if (![start, end, price, halfHeight].every(Number.isFinite)) continue;
          if (end < visibleFrom || start > visibleTo) continue;
          minValue = Math.min(minValue, price - halfHeight);
          maxValue = Math.max(maxValue, price + halfHeight);
        }

        if (minValue === info.priceRange.minValue && maxValue === info.priceRange.maxValue) return info;
        return { ...info, priceRange: { ...info.priceRange, minValue, maxValue } };
      },
    });

    const lineCloseSeries = chart.addLineSeries({
        color: '#2962FF',
        lineWidth: 2,
        visible: false,
        priceFormat: { type: 'price', precision, minMove },
    });
    const lineHighSeries = chart.addLineSeries({
        color: '#00f0ff',
        lineWidth: 2,
        visible: false,
        priceFormat: { type: 'price', precision, minMove },
    });
    const lineLowSeries = chart.addLineSeries({
        color: '#ff3333',
        lineWidth: 2,
        visible: false,
        priceFormat: { type: 'price', precision, minMove },
    });
    
    const vwapSeries = chart.addLineSeries({
        color: '#f8fafc',
        lineWidth: 2,
        priceFormat: {
          type: 'price',
          precision: precision,
          minMove: minMove,
        },
      });

    const sessionVwapBandSeries = {
      asia: {
        upper: chart.addLineSeries({ color: 'rgba(249, 115, 22, 0.72)', lineWidth: 1, lineStyle: 2, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false, priceFormat: { type: 'price', precision, minMove } }),
        lower: chart.addLineSeries({ color: 'rgba(249, 115, 22, 0.72)', lineWidth: 1, lineStyle: 2, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false, priceFormat: { type: 'price', precision, minMove } }),
      },
      europe: {
        upper: chart.addLineSeries({ color: 'rgba(217, 70, 239, 0.72)', lineWidth: 1, lineStyle: 2, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false, priceFormat: { type: 'price', precision, minMove } }),
        lower: chart.addLineSeries({ color: 'rgba(217, 70, 239, 0.72)', lineWidth: 1, lineStyle: 2, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false, priceFormat: { type: 'price', precision, minMove } }),
      },
      preUs: {
        upper: chart.addLineSeries({ color: 'rgba(250, 204, 21, 0.78)', lineWidth: 1, lineStyle: 2, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false, priceFormat: { type: 'price', precision, minMove } }),
        lower: chart.addLineSeries({ color: 'rgba(250, 204, 21, 0.78)', lineWidth: 1, lineStyle: 2, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false, priceFormat: { type: 'price', precision, minMove } }),
      },
      us: {
        upper: chart.addLineSeries({ color: 'rgba(59, 130, 246, 0.78)', lineWidth: 1, lineStyle: 2, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false, priceFormat: { type: 'price', precision, minMove } }),
        lower: chart.addLineSeries({ color: 'rgba(59, 130, 246, 0.78)', lineWidth: 1, lineStyle: 2, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false, priceFormat: { type: 'price', precision, minMove } }),
      },
    };
    const sessionSdHoverTargets = [
      { key: 'asia', name: 'Phiên Á', color: '#f97316' },
      { key: 'europe', name: 'Phiên Âu', color: '#d946ef' },
      { key: 'preUs', name: 'Phiên Pre-US', color: '#facc15' },
      { key: 'us', name: 'Phiên Mỹ', color: '#3b82f6' },
    ].flatMap(target => ([
      { ...target, side: 'upper', sideLabel: 'dải trên', series: sessionVwapBandSeries[target.key].upper },
      { ...target, side: 'lower', sideLabel: 'dải dưới', series: sessionVwapBandSeries[target.key].lower },
    ]));
      
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
        rightOffset: 5,
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
        rightOffset: 5,
          tickMarkFormatter: customTickMarkFormatter,
        },
      });
      
      const normVolSeries = volumeChart.addHistogramSeries({
        priceFormat: { type: 'volume' },
      });
      const projectedVolSeries = volumeChart.addHistogramSeries({
        priceFormat: { type: 'volume' },
      });
      const maVolSeries = volumeChart.addLineSeries({ color: 'rgba(57, 255, 20, 0.8)', lineWidth: 2 });
      
      const vol85Line = volumeChart.addLineSeries({ color: 'rgba(255, 177, 0, 0.98)', lineWidth: 2, crosshairMarkerVisible: false });
      const vol75Line = volumeChart.addLineSeries({ color: 'rgba(255, 242, 0, 0.98)', lineWidth: 2, crosshairMarkerVisible: false });
      const vol50Line = volumeChart.addLineSeries({ color: 'rgba(203, 213, 225, 0.88)', lineWidth: 1, crosshairMarkerVisible: false });
      const vol15Line = volumeChart.addLineSeries({ color: 'rgba(56, 189, 248, 0.9)', lineWidth: 1, crosshairMarkerVisible: false });
      
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

      const handleSessionSdHover = (param) => {
        const tooltip = sessionSdTooltipRef.current;
        const bounds = chartContainerRef.current;
        if (!tooltip || !bounds || !param?.point || !param.time || !param.seriesData) {
          if (tooltip) tooltip.style.display = 'none';
          return;
        }

        let nearest = null;
        sessionSdHoverTargets.forEach(target => {
          const dataPoint = param.seriesData.get(target.series);
          const value = dataPoint?.value;
          if (!Number.isFinite(value)) return;
          const y = target.series.priceToCoordinate(value);
          if (!Number.isFinite(y)) return;
          const distance = Math.abs(param.point.y - y);
          if (distance <= 9 && (!nearest || distance < nearest.distance)) {
            nearest = { ...target, value, distance };
          }
        });

        if (!nearest) {
          tooltip.style.display = 'none';
          return;
        }

        const multiplier = Number(configsRef.current?.vwapMult ?? 2);
        const sdText = Number.isFinite(multiplier) ? multiplier.toFixed(2).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1') : 'SD';
        tooltip.textContent = `${nearest.name} · ${nearest.sideLabel} (${nearest.side === 'upper' ? '+' : '−'}${sdText} SD) · ${nearest.value.toFixed(precision)}`;
        tooltip.style.color = nearest.color;
        tooltip.style.borderColor = nearest.color;
        tooltip.style.boxShadow = `0 3px 14px ${nearest.color}35`;
        tooltip.style.display = 'block';
        const padding = 8;
        const left = Math.max(padding, Math.min(param.point.x + 12, bounds.clientWidth - tooltip.offsetWidth - padding));
        const top = Math.max(padding, Math.min(param.point.y + 12, bounds.clientHeight - tooltip.offsetHeight - padding));
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
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
      chart.subscribeCrosshairMove(handleSessionSdHover);
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
      if (updateOverlaysRef.current) updateOverlaysRef.current();
      if (logicalRange && candlestickSeriesRef.current) {
        const data = candlestickSeriesRef.current.data();
        if (data && data.length > 0) {
          const totalCandles = data.length;
          // Hiện nút khi nến mới nhất đã ra khỏi viewport về cả hai phía:
          // mép phải ở quá khứ hoặc mép trái đã vượt qua nến mới nhất.
          const scrolledBeforeLatest = logicalRange.to < totalCandles - 5;
          const scrolledPastLatest = logicalRange.from > totalCandles - 1;
          if (scrolledBeforeLatest || scrolledPastLatest) {
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
    sessionVwapBandSeriesRef.current = sessionVwapBandSeries;
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
    
    normVolSeriesRef.current = normVolSeries;
    projectedVolSeriesRef.current = projectedVolSeries;
    maVolSeriesRef.current = maVolSeries;
    vol85Ref.current = vol85Line;
    vol75Ref.current = vol75Line;
    vol50Ref.current = vol50Line;
    vol15Ref.current = vol15Line;
    
    // Lưu ref cho Session BG

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
      vwapSeriesRef.current = null;
      sessionVwapBandSeriesRef.current = {};

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
    Object.values(sessionVwapBandSeriesRef.current).forEach(bands => {
      bands?.upper?.applyOptions({ visible: showSdBands });
      bands?.lower?.applyOptions({ visible: showSdBands });
    });
  }, [chartType, showSdBands]);

  useEffect(() => {
    if (candlestickSeriesRef.current) {
      const isSunset = chartTheme === 'sunset';
      candlestickSeriesRef.current.applyOptions({
        upColor: isSunset ? '#ffffff' : '#00f0ff',
        downColor: isSunset ? '#1f2937' : '#ff3333',
        wickUpColor: isSunset ? '#ffffff' : '#00f0ff',
        wickDownColor: isSunset ? '#1f2937' : '#ff3333',
      });
    }
  }, [chartTheme]);
  
  // Hàm cập nhật toạ độ HTML Overlay liên tục
  const updateOverlays = () => {
    updateOverlaysRef.current = updateOverlays;
    try {
      if (chartRef.current && candlestickSeriesRef.current && canvasRef.current && chartContainerRef.current) {
        const timeScale = chartRef.current.timeScale();
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');

        const visibleRange = timeScale.getVisibleRange();
        const toUnixTime = value => value && typeof value === 'object'
          ? new Date(Date.UTC(value.year, value.month - 1, value.day)).getTime() / 1000
          : Number(value);
        let minTime = visibleRange ? toUnixTime(visibleRange.from) : 0;
        let maxTime = visibleRange ? toUnixTime(visibleRange.to) : Infinity;
        if (!Number.isFinite(minTime)) minTime = 0;
        if (!Number.isFinite(maxTime)) maxTime = Infinity;
        
        // Ensure canvas dimensions match its container
        const rect = chartContainerRef.current.getBoundingClientRect();
        if (canvas.width !== rect.width || canvas.height !== rect.height) {
          canvas.width = rect.width;
          canvas.height = rect.height;
        }
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // --- DRAW SESSION BACKGROUNDS FIRST ---
        if ((sessionDataRef.current && sessionDataRef.current.length > 0) || (rawCandlesRef.current && rawCandlesRef.current.length > 0)) {
          const barSpacing = timeScale.options().barSpacing || 6;
          const sessionBarSeconds = ({ M1: 60, M2: 120, M3: 180, M4: 240, M5: 300, M15: 900, M30: 1800, H1: 3600, H2: 7200, H4: 14400, H8: 28800, D1: 86400 })[timeframe] || 3600;
          const maxSessionGap = sessionBarSeconds * 1.5;
          const sessionConfig = configsRef.current || {};
          const sessionSchedules = {
            'Á': [sessionConfig.asiaStart || '07:00', sessionConfig.asiaEnd || '11:00'],
            'Âu': [sessionConfig.euroStart || '07:00', sessionConfig.euroEnd || '09:00'],
            'Pre-US': [sessionConfig.preUsStart || '16:00', sessionConfig.preUsEnd || '19:00'],
            'Mỹ': [sessionConfig.usStart || '07:30', sessionConfig.usEnd || '11:00']
          };
          const sessionScheduleByColor = {
            '139, 69, 19': sessionSchedules['Á'],
            '139, 0, 139': sessionSchedules['Âu'],
            '255, 193, 7': sessionSchedules['Pre-US'],
            '0, 0, 139': sessionSchedules['Mỹ']
          };
          const getSessionDurationSeconds = session => {
            const schedule = sessionSchedules[session.name] || sessionScheduleByColor[session.color.match(/\d+\s*,\s*\d+\s*,\s*\d+/)?.[0]];
            if (!schedule) return 0;
            const toMinutes = value => {
              const [hours, minutes] = String(value).split(':').map(Number);
              return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : NaN;
            };
            const start = toMinutes(schedule[0]);
            const end = toMinutes(schedule[1]);
            if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
            const durationMinutes = (end - start + 1440) % 1440;
            return durationMinutes * 60;
          };
          const sessions = [...(sessionDataRef.current || [])];
          // The invisible news timeline includes historical candles and future
          // bars, so session boundaries between candle timestamps can be placed
          // by interpolating between their neighboring chart times.
          const axisTimeline = newsSeriesRef.current?.data?.() || candlestickSeriesRef.current.data() || [];
          const coordinateForSessionTime = timestamp => {
            const exact = timeScale.timeToCoordinate(timestamp);
            if (Number.isFinite(exact)) return exact;

            let low = 0;
            let high = axisTimeline.length;
            while (low < high) {
              const middle = (low + high) >>> 1;
              if (Number(axisTimeline[middle]?.time) < timestamp) low = middle + 1;
              else high = middle;
            }

            const before = axisTimeline[low - 1];
            const after = axisTimeline[low];
            if (!before || !after) return null;
            const beforeTime = Number(before.time);
            const afterTime = Number(after.time);
            const beforeX = timeScale.timeToCoordinate(before.time);
            const afterX = timeScale.timeToCoordinate(after.time);
            if (!Number.isFinite(beforeX) || !Number.isFinite(afterX) || afterTime <= beforeTime) return null;
            const fraction = Math.max(0, Math.min(1, (timestamp - beforeTime) / (afterTime - beforeTime)));
            return beforeX + (afterX - beforeX) * fraction;
          };
          const latestCandle = rawCandlesRef.current && rawCandlesRef.current.length > 0
            ? rawCandlesRef.current[rawCandlesRef.current.length - 1]
            : null;
          if (latestCandle && Number.isFinite(Number(latestCandle.time))) {
            const timeShiftSeconds = (Number(sessionConfig.timeShiftHours) || 0) * 3600;
            const browserOffsetHours = -new Date().getTimezoneOffset() / 60;
            const latestUtc = Number(latestCandle.time) - timeShiftSeconds;
            const latestLocal = new Date((latestUtc + browserOffsetHours * 3600) * 1000);
            const localDayStart = Date.UTC(
              latestLocal.getUTCFullYear(), latestLocal.getUTCMonth(), latestLocal.getUTCDate()
            ) / 1000;
            const minuteOfDay = value => {
              const [hours, minutes] = String(value).split(':').map(Number);
              return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : NaN;
            };
            const configuredSessions = [
              { name: 'Á', startKey: 'asiaStart', endKey: 'asiaEnd', fallback: ['07:00', '11:00'], color: 'rgba(139, 69, 19, 0.18)', timezone: 'Asia/Tokyo', summerOffset: 540 },
              { name: 'Âu', startKey: 'euroStart', endKey: 'euroEnd', fallback: ['07:00', '09:00'], color: 'rgba(139, 0, 139, 0.18)', timezone: 'Europe/London', summerOffset: 60 },
              { name: 'Pre-US', startKey: 'preUsStart', endKey: 'preUsEnd', fallback: ['16:00', '19:00'], color: 'rgba(255, 193, 7, 0.20)', timezone: 'America/New_York', summerOffset: -240 },
              { name: 'Mỹ', startKey: 'usStart', endKey: 'usEnd', fallback: ['07:30', '11:00'], color: 'rgba(0, 0, 139, 0.18)', timezone: 'America/New_York', summerOffset: -240 }
            ];
            for (const definition of configuredSessions) {
              const startText = sessionConfig[definition.startKey] || definition.fallback[0];
              const endText = sessionConfig[definition.endKey] || definition.fallback[1];
              const startMinutes = minuteOfDay(startText);
              const endMinutes = minuteOfDay(endText);
              if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) continue;

              const approximateStartUtc = localDayStart + startMinutes * 60 - browserOffsetHours * 3600;
              const dstShiftMinutes = sessionConfig.autoDst === false
                ? 0
                : getTimeZoneOffsetMinutes(approximateStartUtc, definition.timezone) - definition.summerOffset;
              const adjustedStartMinutes = (startMinutes - dstShiftMinutes + 1440) % 1440;
              const adjustedEndMinutes = (endMinutes - dstShiftMinutes + 1440) % 1440;
              const durationMinutes = (endMinutes - startMinutes + 1440) % 1440;
              if (durationMinutes <= 0) continue;

              const startUtc = localDayStart + adjustedStartMinutes * 60 - browserOffsetHours * 3600;
              let endUtc = localDayStart + adjustedEndMinutes * 60 - browserOffsetHours * 3600;
              if (endUtc <= startUtc) endUtc += 24 * 3600;
              if (endUtc <= latestUtc) continue;

              const chartStart = startUtc + timeShiftSeconds;
              const chartEnd = endUtc + timeShiftSeconds;
              const hasExistingSession = sessions.some(session =>
                session.name === definition.name && session.time >= chartStart && session.time < chartEnd
              );
              if (startUtc <= latestUtc && hasExistingSession) continue;

              // A synthetic start lets the same renderer draw the whole configured
              // session before its first candle arrives, for live and backtest.
              sessions.push({ time: chartStart, color: definition.color, name: definition.name });
            }
          }
          sessions.sort((a, b) => a.time - b.time);
          for (let i = 0; i < sessions.length;) {
             const first = sessions[i];
             let last = first;
             let next = i + 1;
             while (next < sessions.length &&
                    sessions[next].color === first.color &&
                    sessions[next].name === first.name &&
                    sessions[next].time - last.time <= maxSessionGap) {
               last = sessions[next];
               next++;
             }

             const configuredDuration = getSessionDurationSeconds(first);
             const sessionEndTime = Math.max(
               last.time + sessionBarSeconds,
               first.time + configuredDuration
             );
             if (sessionEndTime >= minTime && first.time <= maxTime) {
               const startX = coordinateForSessionTime(first.time);
               const endX = coordinateForSessionTime(sessionEndTime);
               if (Number.isFinite(startX) && Number.isFinite(endX)) {
                 const left = Math.max(0, startX - barSpacing / 2);
                 const right = Math.min(canvas.width, endX - barSpacing / 2);
                 const width = Math.max(barSpacing, right - left);
                 ctx.fillStyle = first.color;
                 ctx.fillRect(left, 0, width, canvas.height);

                 // Keep the session tint subtle, but make its time boundaries
                 // visible over SD shading and other colored chart overlays.
                 const rgb = first.color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
                 let edgeColor = first.color;
                 let frameColor = first.color;
                 if (rgb) {
                   const channels = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
                   const brightnessScale = 255 / Math.max(...channels, 1);
                   const brightChannels = channels.map(channel => Math.min(255, Math.round(channel * brightnessScale)));
                   edgeColor = `rgba(${brightChannels.join(', ')}, 0.98)`;
                   frameColor = `rgba(${brightChannels.join(', ')}, 0.62)`;
                 }

                 const leftEdge = Math.round(left) + 0.5;
                 const rightEdge = Math.round(right) - 0.5;
                 ctx.save();
                 ctx.setLineDash([]);
                 ctx.lineWidth = 1;
                 ctx.strokeStyle = frameColor;
                 ctx.strokeRect(left + 0.5, 0.5, Math.max(0, width - 1), Math.max(0, canvas.height - 1));
                 ctx.beginPath();
                 ctx.setLineDash([7, 5]);
                 ctx.lineWidth = 2;
                 ctx.strokeStyle = edgeColor;
                 ctx.shadowColor = edgeColor;
                 ctx.shadowBlur = 8;
                 ctx.moveTo(leftEdge, 0);
                 ctx.lineTo(leftEdge, canvas.height);
                 if (width > 2) {
                   ctx.moveTo(rightEdge, 0);
                   ctx.lineTo(rightEdge, canvas.height);
                 }
                 ctx.stroke();

                 if (first.name) {
                   const centerX = (left + right) / 2;
                   const labelY = 10;
                   ctx.setLineDash([]);
                   ctx.shadowBlur = 0;
                   ctx.font = '700 11px Arial, sans-serif';
                   ctx.textAlign = 'center';
                   ctx.textBaseline = 'middle';
                   const labelWidth = Math.ceil(ctx.measureText(first.name).width) + 14;
                   const labelHeight = 19;
                   const labelLeft = Math.max(4, Math.min(canvas.width - labelWidth - 4, centerX - labelWidth / 2));
                   ctx.fillStyle = 'rgba(7, 12, 24, 0.9)';
                   ctx.strokeStyle = edgeColor;
                   ctx.lineWidth = 1;
                   ctx.fillRect(labelLeft, labelY, labelWidth, labelHeight);
                   ctx.strokeRect(labelLeft + 0.5, labelY + 0.5, labelWidth - 1, labelHeight - 1);
                   ctx.fillStyle = '#f8fafc';
                   ctx.fillText(first.name, labelLeft + labelWidth / 2, labelY + labelHeight / 2);
                 }
                 ctx.restore();
               }
             }
             i = next;
          }
        }
        
        // --- DRAW VP BOXES ---
        if (vpBoxes && vpBoxes.length > 0) {
          const plotWidth = timeScale.width() || canvas.width;
          const latestRawTime = Number(rawCandlesRef.current?.[rawCandlesRef.current.length - 1]?.time);
          for (let i = 0; i < vpBoxes.length; i++) {
           const box = vpBoxes[i];
           // Active D-VP zones remain open as new candles arrive. Extend their
           // right edge locally so they do not vanish between backend refreshes.
           const boxEnd = box.is_active && Number.isFinite(latestRawTime)
             ? Math.max(Number(box.end), latestRawTime)
             : box.end;
           if (boxEnd < minTime || box.start > maxTime) continue; // CULLING OFF-SCREEN BOXES
           const startX = timeScale.timeToCoordinate(box.start);
           const endX = timeScale.timeToCoordinate(boxEnd);
           
           const topY = candlestickSeriesRef.current.priceToCoordinate(box.price + box.height/2);
           const bottomY = candlestickSeriesRef.current.priceToCoordinate(box.price - box.height/2);
           
           if (topY === null || bottomY === null) continue;
           
           // A long-lived DVP can have both endpoints outside the viewport
           // while still spanning it. Clip those endpoints to the plot edges.
           const finalStartX = Math.max(0, Math.min(plotWidth,
             startX ?? (box.start <= minTime ? 0 : plotWidth)));
           const finalEndX = Math.max(0, Math.min(plotWidth,
             endX ?? (boxEnd >= maxTime ? plotWidth : 0)));
           const width = finalEndX - finalStartX;
           if (width <= 0) continue;
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
    vpBoxesRef.current = vpBoxes;
    updateOverlaysRef.current = updateOverlays;
    try {
      const rightPriceScale = chartRef.current?.priceScale('right');
      if (rightPriceScale?.options().autoScale) {
        rightPriceScale.applyOptions({ autoScale: false });
        rightPriceScale.applyOptions({ autoScale: true });
      }
    } catch (error) {
      console.warn('Could not refresh price scale for D-VP boxes:', error);
    }
    updateOverlaysRef.current?.();
  }, [vpBoxes]);

  useEffect(() => {
    updateOverlaysRef.current = updateOverlays;
  }, [vpBoxes, chartType, showSdBands, volStats, configs, timeframe]);

  const handleGoToLatest = () => {
    if (chartRef.current && candlestickSeriesRef.current) {
        const data = (candlestickSeriesRef.current.data() || []).filter(item => Number.isFinite(item.close));
        if (data.length > 0) {
            const visibleBars = 50;
            const futureBars = 5;
            const timeframeSeconds = timeframe === 'M1' ? 60 : timeframe === 'M3' ? 180 : timeframe === 'M5' ? 300 : timeframe === 'M15' ? 900 : timeframe === 'M30' ? 1800 : timeframe === 'H1' ? 3600 : timeframe === 'H2' ? 7200 : timeframe === 'H4' ? 14400 : timeframe === 'H8' ? 28800 : timeframe === 'D1' ? 86400 : 3600;
            const startIndex = Math.max(0, data.length - visibleBars + futureBars);
            const latestTime = data[data.length - 1].time;
            const range = {
                from: data[startIndex].time,
                to: latestTime + timeframeSeconds * futureBars,
            };

            chartRef.current.timeScale().setVisibleRange(range);
            if (momentumChartRef.current) momentumChartRef.current.timeScale().setVisibleRange(range);
            if (volumeChartRef.current) volumeChartRef.current.timeScale().setVisibleRange(range);
        }
    }
  };

  const isPollingRef = useRef(false);
  const isLatestCandlePollingRef = useRef(false);

  const fetchLatestCandle = async () => {
    // Keep live price polling independent from the slower indicator refresh.
    // A delayed 10k-candle calculation must not stop the current candle moving.
    if (viewMode !== 'chart' || loadingRef.current || isLatestCandlePollingRef.current) return;
    isLatestCandlePollingRef.current = true;
    const currentSymbol = symbol;
    const currentTimeframe = timeframe;

    try {
      const response = await axios.get(`${API_BASE}/api/v1/ohlcv/latest`, {
        params: {
          symbol: currentSymbol,
          timeframe: currentTimeframe,
          timeShiftHours: configsRef.current?.timeShiftHours || 0,
          brokerTimezone: configsRef.current?.brokerTimezone || 'Europe/Athens',
          _t: Date.now(),
        },
        timeout: 8000,
      });

      if (response.data.symbol !== symbolRef.current || response.data.timeframe !== timeframeRef.current) return;
      if (!chartRef.current || !candlestickSeriesRef.current) return;

      const latestRows = (response.data.data || [])
        .filter(item => item && Number.isFinite(Number(item.time)))
        .sort((a, b) => Number(a.time) - Number(b.time));
      if (latestRows.length === 0) return;

      const existingRaw = rawCandlesRef.current || [];
      const rawMap = new Map(existingRaw.map(item => [Number(item.time), item]));
      const priorLatestTime = lastUpdateTimeRef.current || 0;
      let latestTimeAdvanced = false;
      const minMove = currentSymbol.includes('JPY')
        ? 0.001
        : /XAU|GOLD|BTC|ETH|SOL/.test(currentSymbol)
          ? 0.01
          : 0.00001;

      for (const item of latestRows) {
        const candle = {
          time: Math.floor(Number(item.time)),
          open: Number(item.open),
          high: Number(item.high),
          low: Number(item.low),
          close: Number(item.close),
          spread: Number(item.spread) || 0,
        };
        if (![candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)) continue;
        if (candle.time < (lastUpdateTimeRef.current || 0)) continue;
        if (candle.time > priorLatestTime) latestTimeAdvanced = true;

        const update = (series, point) => {
          if (!series) return;
          try { series.update(point); } catch (e) {}
        };
        update(candlestickSeriesRef.current, candle);
        update(lineCloseSeriesRef.current, { time: candle.time, value: candle.close });
        update(lineHighSeriesRef.current, { time: candle.time, value: candle.high });
        update(lineLowSeriesRef.current, { time: candle.time, value: candle.low });
        update(alertsSeriesRef.current, { time: candle.time, value: candle.close });
        bidPriceLineRef.current?.applyOptions({ price: candle.close });
        askPriceLineRef.current?.applyOptions({ price: candle.close + candle.spread * minMove });
        rawMap.set(candle.time, { ...(rawMap.get(candle.time) || {}), ...candle });
        lastUpdateTimeRef.current = Math.max(lastUpdateTimeRef.current || 0, candle.time);
      }

      rawCandlesRef.current = Array.from(rawMap.values()).sort((a, b) => a.time - b.time);
      if (latestTimeAdvanced) {
        if (updateOverlaysRef.current) updateOverlaysRef.current();
        setLastUpdateSignal(Date.now());
      }
    } catch (error) {
      // Preserve the last valid chart, log the failure, and let the next short
      // poll retry instead of leaving this path silently stale.
      console.warn('Live candle refresh failed; retrying on next poll:', error);
    } finally {
      isLatestCandlePollingRef.current = false;
    }
  };

  // Fetch data từ FastAPI backend
  const fetchData = async (isPolling = false, targetEndTime = 0, skipLoadingUI = false, resetViewport = false) => {
    // Không cho phép gửi Polling request nếu hệ thống đang bận tải Full Load
    if (isPolling && (loadingRef.current || isPollingRef.current)) return;
    if (isPolling) isPollingRef.current = true;
    
    const currentSymbol = symbol;
    if (!isPolling && !skipLoadingUI) {
        const previousCandles = candlestickSeriesRef.current?.data?.() || [];
        const hasPreviousCandles = previousCandles.some(item => Number.isFinite(item.close));
        if (resetViewport) {
            savedTimeRangeRef.current = null;
        } else if (hasPreviousCandles && chartRef.current) {
            try {
                savedTimeRangeRef.current = chartRef.current.timeScale().getVisibleRange();
            } catch (e) {
                console.error("Không thể lấy Viewport hiện tại:", e);
                savedTimeRangeRef.current = null;
            }
        } else {
            // Không khôi phục viewport rỗng của chart khi app vừa mở.
            savedTimeRangeRef.current = null;
        }
    }

    if (!isPolling && !skipLoadingUI && candlestickSeriesRef.current) {
        candlestickSeriesRef.current.setData([]);
        if (vwapSeriesRef.current) vwapSeriesRef.current.setData([]);
        if (momentumSeriesRef.current) momentumSeriesRef.current.setData([]);
        if (normVolSeriesRef.current) normVolSeriesRef.current.setData([]);
        if (projectedVolSeriesRef.current) projectedVolSeriesRef.current.setData([]);
        if (maVolSeriesRef.current) maVolSeriesRef.current.setData([]);
        rawCandlesRef.current = [];
        Object.values(sessionVwapBandSeriesRef.current).forEach(bands => {
          bands?.upper?.setData([]);
          bands?.lower?.setData([]);
        });
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
        
        // Lọc bỏ các params không thuộc OHLCV API (email config, volMode...)
        const { emailSender, emailPassword, emailReceiver, volMode, ...ohlcvConfigs } = configs;
        
        const response = await axios.get(`${API_BASE}/api/v1/ohlcv`, {
          signal: !isPolling ? abortControllerRef.current.signal : undefined,
          // Session classification in the backend must use the same current
          // browser offset as the session boxes rendered by the frontend.
          // Keep this after the saved config spread so an old persisted offset
          // cannot move VWAP session bands into a different session.
          params: { symbol, timeframe, count: 10000, end_time: targetEndTime, latest_only: isPolling, _t: Date.now(), ...ohlcvConfigs, browserOffsetHours }
        });
        
        // Bỏ qua nếu response trả về dữ liệu của symbol/timeframe cũ (Race condition)
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
        if (!isPolling) {
          rawCandlesRef.current = rawData;
        } else {
          const existingRaw = rawCandlesRef.current || [];
          const rawMap = new Map(existingRaw.map(d => [d.time, d]));
          rawData.forEach(d => rawMap.set(d.time, d));
          rawCandlesRef.current = Array.from(rawMap.values()).sort((a,b) => a.time - b.time);
        }

        // In backtest, anchor the SD readout to the simulated time so the chart
        // never displays a value calculated from a candle after the replay point.
        const timeShiftSeconds = (Number(configsRef.current?.timeShiftHours) || 0) * 3600;
        const backtestChartEndTime = targetEndTime + timeShiftSeconds;
        const sdSourceData = viewMode === 'backtest' && targetEndTime > 0
          ? rawCandlesRef.current.filter(item => item.time <= backtestChartEndTime)
          : rawCandlesRef.current;
        const configuredBandMultiplier = Number(configsRef.current?.vwapMult ?? 2);
        const sessionSdConfigs = [
          { key: 'asia', label: 'Á', sessionName: 'Á', color: '#f97316', vwap: 'vwap_asia', upper: 'upper_band_asia', lower: 'lower_band_asia', startKey: 'asiaStart', endKey: 'asiaEnd', fallback: ['07:00', '11:00'], timezone: 'Asia/Tokyo', summerOffset: 540 },
          { key: 'europe', label: 'Âu', sessionName: 'Âu', color: '#d946ef', vwap: 'vwap_europe', upper: 'upper_band_europe', lower: 'lower_band_europe', startKey: 'euroStart', endKey: 'euroEnd', fallback: ['07:00', '09:00'], timezone: 'Europe/London', summerOffset: 60 },
          { key: 'preUs', label: 'Pre-US', sessionName: 'Pre-US', color: '#facc15', vwap: 'vwap_pre_us', upper: 'upper_band_pre_us', lower: 'lower_band_pre_us', startKey: 'preUsStart', endKey: 'preUsEnd', fallback: ['16:00', '19:00'], timezone: 'America/New_York', summerOffset: -240 },
          { key: 'us', label: 'Mỹ', sessionName: 'Mỹ', color: '#3b82f6', vwap: 'vwap_us', upper: 'upper_band_us', lower: 'lower_band_us', startKey: 'usStart', endKey: 'usEnd', fallback: ['07:30', '11:00'], timezone: 'America/New_York', summerOffset: -240 },
        ];
        let latestSdPosition = null;
        for (let i = sdSourceData.length - 1; i >= 0; i--) {
          const bar = sdSourceData[i];
          const toFiniteNumber = value => value == null || value === '' ? NaN : Number(value);
          const close = toFiniteNumber(bar.close);
          const vwap = toFiniteNumber(bar.vwap);
          const reportedStdev = toFiniteNumber(bar.stdev);
          const upperBand = toFiniteNumber(bar.upper_band);
          const lowerBand = toFiniteNumber(bar.lower_band);
          const bandWidth = upperBand - lowerBand;
          const stdev = Number.isFinite(reportedStdev) && reportedStdev > 0
            ? reportedStdev
            : Number.isFinite(bandWidth) && bandWidth > 0 && configuredBandMultiplier > 0
              ? bandWidth / (2 * configuredBandMultiplier)
              : NaN;

          if (Number.isFinite(close) && Number.isFinite(vwap) && Number.isFinite(stdev) && stdev > 0) {
            latestSdPosition = (close - vwap) / stdev;
            break;
          }
        }
        if (latestSdPosition !== null) {
          setCurrentSdPosition(latestSdPosition);
        } else if (!isPolling) {
          // A bad/incomplete live candle should not hide the last valid readout
          // during polling; a fresh full load can still clear stale data.
          setCurrentSdPosition(null);
        }

        // When a candle is outside all configured sessions, preview the nearest
        // upcoming session using its current rolling VWAP and deviation.
        let latestSessionSdPosition = null;
        let latestSessionSdPositions = [];
        const latestSessionBar = sdSourceData[sdSourceData.length - 1];
        if (latestSessionBar && configuredBandMultiplier > 0) {
          const toFiniteNumber = value => value == null || value === '' ? NaN : Number(value);
          const close = toFiniteNumber(latestSessionBar.close);
          const browserOffsetHours = -new Date().getTimezoneOffset() / 60;
          // Backtest time can be exactly at a session boundary while the most
          // recent candle is still the previous session's final candle (e.g.
          // 13:59 immediately before the 14:00 Europe open). Select by the
          // replay timestamp so the badge changes with the session box.
          const chartAsOfTime = viewMode === 'backtest' && targetEndTime > 0
            ? targetEndTime + timeShiftSeconds
            : Number(latestSessionBar.time);
          const currentUtc = chartAsOfTime - timeShiftSeconds;
          const localNow = new Date((currentUtc + browserOffsetHours * 3600) * 1000);
          const localDayStart = Date.UTC(
            localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate()
          ) / 1000;
          const localMinute = localNow.getUTCHours() * 60 + localNow.getUTCMinutes();
          const minuteOfDay = value => {
            const [hours, minutes] = String(value).split(':').map(Number);
            return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : NaN;
          };
          let selectedSession = null;
          for (const session of sessionSdConfigs) {
            const startText = configsRef.current?.[session.startKey] || session.fallback[0];
            const endText = configsRef.current?.[session.endKey] || session.fallback[1];
            const startMinutes = minuteOfDay(startText);
            const endMinutes = minuteOfDay(endText);
            if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || startMinutes === endMinutes) continue;

            const approximateStartUtc = localDayStart + startMinutes * 60 - browserOffsetHours * 3600;
            const dstShiftMinutes = configsRef.current?.autoDst === false
              ? 0
              : getTimeZoneOffsetMinutes(approximateStartUtc, session.timezone) - session.summerOffset;
            const adjustedStartMinutes = (startMinutes - dstShiftMinutes + 1440) % 1440;
            const adjustedEndMinutes = (endMinutes - dstShiftMinutes + 1440) % 1440;
            const isWithinSession = adjustedStartMinutes < adjustedEndMinutes
              ? localMinute >= adjustedStartMinutes && localMinute < adjustedEndMinutes
              : localMinute >= adjustedStartMinutes || localMinute < adjustedEndMinutes;
            // Backend assignment order is Á, Âu, Pre-US, Mỹ; a later
            // overlapping session takes precedence there too.
            if (isWithinSession) selectedSession = session;
          }
          let isUpcomingSession = false;

          if (!selectedSession) {
            const firstLocalDay = localDayStart;
            const isCrypto = /BTC|ETH|SOL|XRP|CRYPTO/i.test(symbol);
            let nextStart = Infinity;

            for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
              const localDayStart = firstLocalDay + dayOffset * 86400;
              for (const session of sessionSdConfigs) {
                const startText = configsRef.current?.[session.startKey] || session.fallback[0];
                const endText = configsRef.current?.[session.endKey] || session.fallback[1];
                const startMinutes = minuteOfDay(startText);
                const endMinutes = minuteOfDay(endText);
                if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || startMinutes === endMinutes) continue;

                const approximateStartUtc = localDayStart + startMinutes * 60 - browserOffsetHours * 3600;
                const dstShiftMinutes = configsRef.current?.autoDst === false
                  ? 0
                  : getTimeZoneOffsetMinutes(approximateStartUtc, session.timezone) - session.summerOffset;
                const adjustedStartMinutes = (startMinutes - dstShiftMinutes + 1440) % 1440;
                const sessionStartUtc = localDayStart + adjustedStartMinutes * 60 - browserOffsetHours * 3600;
                if (sessionStartUtc <= currentUtc) continue;

                const date = new Date(sessionStartUtc * 1000);
                const day = date.getUTCDay();
                const hour = date.getUTCHours();
                const marketClosed = !isCrypto && ((day === 5 && hour >= 22) || day === 6 || (day === 0 && hour < 21));
                if (marketClosed) continue;

                if (sessionStartUtc < nextStart) {
                  nextStart = sessionStartUtc;
                  selectedSession = session;
                }
              }
              if (selectedSession && nextStart < Infinity) break;
            }
            isUpcomingSession = Boolean(selectedSession);
          }

          if (Number.isFinite(close)) {
            const getSessionStats = session => {
              const sessionValue = bar => {
                const vwap = toFiniteNumber(bar?.[session.vwap]);
                const upper = toFiniteNumber(bar?.[session.upper]);
                const lower = toFiniteNumber(bar?.[session.lower]);
                const stdev = (upper - lower) / (2 * configuredBandMultiplier);
                return Number.isFinite(vwap) && Number.isFinite(stdev) && stdev > 0
                  ? { vwap, stdev }
                  : null;
              };
              let stats = sessionValue(latestSessionBar);
              if (!stats) {
                for (let i = sdSourceData.length - 1; i >= 0 && !stats; i--) {
                  stats = sessionValue(sdSourceData[i]);
                }
              }
              return stats;
            };

            latestSessionSdPositions = sessionSdConfigs.map(session => {
              const stats = getSessionStats(session);
              return stats ? {
                key: session.key,
                label: session.label,
                color: session.color,
                position: (close - stats.vwap) / stats.stdev,
              } : null;
            }).filter(Boolean);

            const selectedPosition = latestSessionSdPositions.find(position => position.key === selectedSession?.key);
            if (selectedPosition) {
              latestSessionSdPosition = { ...selectedPosition, isUpcoming: isUpcomingSession };
            }
          }
        }
        setSessionSdPositions(latestSessionSdPositions);
        if (latestSessionSdPosition) {
          setCurrentSessionSdPosition(latestSessionSdPosition);
        } else {
          setCurrentSessionSdPosition(null);
        }

        const newMomFlip = rawData.map(d => ({
          time: d.time,
          value: (d.mom_flip != null && !isNaN(d.mom_flip)) ? d.mom_flip : 0, 
          close: d.close,
          mom_raw: d.mom_raw
        })).sort((a,b)=>a.time - b.time);

        if (!isPolling) {
            momFlipDataRef.current = newMomFlip;
            setMomFlipDataRevision(revision => revision + 1);
        } else {
            const currentData = momFlipDataRef.current;
            newMomFlip.forEach(item => {
                let low = 0;
                let high = currentData.length;
                while (low < high) {
                    const middle = (low + high) >>> 1;
                    if (currentData[middle].time < item.time) low = middle + 1;
                    else high = middle;
                }
                if (currentData[low]?.time === item.time) currentData[low] = item;
                else currentData.splice(low, 0, item);
            });
            setMomFlipDataVersion(version => version + 1);
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
        Object.values(sessionVwapBandSeriesRef.current).forEach(bands => {
          bands?.upper?.applyOptions({ priceFormat });
          bands?.lower?.applyOptions({ priceFormat });
        });
        if (fairValueSeriesRef.current) fairValueSeriesRef.current.applyOptions({ priceFormat });
        if (lineCloseSeriesRef.current) lineCloseSeriesRef.current.applyOptions({ priceFormat });
        if (lineHighSeriesRef.current) lineHighSeriesRef.current.applyOptions({ priceFormat });
        if (lineLowSeriesRef.current) lineLowSeriesRef.current.applyOptions({ priceFormat });
        
        // Format nến (hỗ trợ khoảng trống thời gian - whitespace data)
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
        const vwapData = sortedRawForVwap.map(item => ({ time: item.time, value: item.vwap, color: '#f8fafc' }));
        const sessionVwapBandFields = {
          asia: { name: 'Á', upper: 'upper_band_asia', lower: 'lower_band_asia' },
          europe: { name: 'Âu', upper: 'upper_band_europe', lower: 'lower_band_europe' },
          preUs: { name: 'Pre-US', upper: 'upper_band_pre_us', lower: 'lower_band_pre_us' },
          us: { name: 'Mỹ', upper: 'upper_band_us', lower: 'lower_band_us' },
        };
        const sortedRawForSessionBands = rawData
          .filter(item => Number.isFinite(Number(item.time)))
          .sort((a, b) => a.time - b.time);
        const sessionVwapBandData = Object.fromEntries(Object.entries(sessionVwapBandFields).map(([session, fields]) => [
          session,
          Object.fromEntries(Object.entries(fields).filter(([key]) => key !== 'name').map(([side, field]) => [
            side,
            sortedRawForSessionBands.map(item => {
              const value = item[field];
              // Whitespace points break the line outside its matching session.
              return item.session_name === fields.name && value != null && Number.isFinite(Number(value))
                ? { time: item.time, value: Number(value) }
                : { time: item.time };
            })
          ]))
        ]));
          
          const isSunsetMom = chartTheme === 'sunset';
          const momentumData = rawData.filter(d => d.mom_raw != null && !isNaN(d.mom_raw)).map(item => {
            return {
              time: item.time,
              value: item.mom_raw,
              color: item.mom_raw >= 0 ? (isSunsetMom ? '#ffffff' : '#00f0ff') : (isSunsetMom ? '#1f2937' : '#ff3333')
            };
          }).sort((a,b)=>a.time-b.time);
          
        const m85Up = rawData.filter(d => d.mom_lvl1 != null && !isNaN(d.mom_lvl1)).map(i => ({time: i.time, value: i.mom_lvl1})).sort((a,b)=>a.time-b.time);
        const m85Dn = rawData.filter(d => d.mom_lvl1 != null && !isNaN(d.mom_lvl1)).map(i => ({time: i.time, value: -i.mom_lvl1})).sort((a,b)=>a.time-b.time);
        const m75Up = rawData.filter(d => d.mom_lvl2 != null && !isNaN(d.mom_lvl2)).map(i => ({time: i.time, value: i.mom_lvl2})).sort((a,b)=>a.time-b.time);
        const m75Dn = rawData.filter(d => d.mom_lvl2 != null && !isNaN(d.mom_lvl2)).map(i => ({time: i.time, value: -i.mom_lvl2})).sort((a,b)=>a.time-b.time);
        const m50Up = rawData.filter(d => d.mom_lvl3 != null && !isNaN(d.mom_lvl3)).map(i => ({time: i.time, value: i.mom_lvl3})).sort((a,b)=>a.time-b.time);
        const m50Dn = rawData.filter(d => d.mom_lvl3 != null && !isNaN(d.mom_lvl3)).map(i => ({time: i.time, value: -i.mom_lvl3})).sort((a,b)=>a.time-b.time);

        const activeVolMode = configsRef.current?.volMode || 'normal';
        let projectedNormVol = [];
        if (activeVolMode === 'mean_vol') {
            const tfSec = timeframe === 'M1' ? 60 : timeframe === 'M3' ? 180 : timeframe === 'M5' ? 300 : timeframe === 'M15' ? 900 : timeframe === 'M30' ? 1800 : timeframe === 'H1' ? 3600 : timeframe === 'H2' ? 7200 : timeframe === 'H4' ? 14400 : timeframe === 'H8' ? 28800 : timeframe === 'D1' ? 86400 : 3600;
            let cTime = formattedData.length > 0 ? formattedData[formattedData.length - 1].time : Math.floor(Date.now() / 1000);
            cTime = cTime - (cTime % tfSec);
            
            const rawMap = new Map();
            rawData.forEach(d => rawMap.set(d.time, d));
            
            const isCrypto = symbol.includes("BTC") || symbol.includes("ETH") || symbol.includes("SOL") || symbol.includes("XRP") || symbol.includes("CRYPTO");
            const futureTimes = generateFutureTimeline(cTime, tfSec, 1500, isCrypto, configsRef.current?.timeShiftHours || 0);
            
            futureTimes.forEach(ft => {
                const pastTime = ft.time - (7 * 86400); // 1 week ago
                const pastRaw = rawMap.get(pastTime);
                if (pastRaw && pastRaw.mean_ma_vol != null && !isNaN(pastRaw.mean_ma_vol)) {
                    let color = 'rgba(0, 240, 255, 0.1)'; // Purple semi-transparent
                    const value = pastRaw.mean_ma_vol;
                    const lvl1 = pastRaw.mean_vol_lvl1;
                    const lvl2 = pastRaw.mean_vol_lvl2;
                    const lvl3 = pastRaw.mean_vol_lvl3;
                    const lvl4 = pastRaw.mean_vol_lvl4;
                    if (value <= lvl4) color = 'rgba(0, 240, 255, 0.5)';
                    else if (value <= lvl3) color = 'rgba(255, 165, 0, 0.5)';
                    else if (value <= lvl2) color = 'rgba(255, 69, 0, 0.5)';
                    else if (value <= lvl1) color = 'rgba(255, 0, 0, 0.6)';
                    
                    projectedNormVol.push({ time: ft.time, value: value, color });
                }
            });
        }

        let normVolData = rawData.filter(d => {
          if (activeVolMode === 'rvol') return d.rvol != null && !isNaN(d.rvol);
          if (activeVolMode === 'mean_vol') return d.mean_ma_vol != null && !isNaN(d.mean_ma_vol);
          return d.norm_vol != null && !isNaN(d.norm_vol);
        }).map(i => {
          let color = '#9c27b0';
          let value = i.norm_vol;
          if (activeVolMode === 'rvol') value = i.rvol;
          if (activeVolMode === 'mean_vol') value = i.mean_ma_vol;
          
          if (activeVolMode === 'rvol') {
            if (value < 0.5) color = '#0033ff'; 
            else if (value < 1.0) color = '#ff8c00'; 
            else if (value < 2.0) color = '#ffff00'; 
            else color = '#ff3333'; 
          } else {
            const lvl1 = activeVolMode === 'mean_vol' ? i.mean_vol_lvl1 : i.vol_lvl1;
            const lvl2 = activeVolMode === 'mean_vol' ? i.mean_vol_lvl2 : i.vol_lvl2;
            const lvl3 = activeVolMode === 'mean_vol' ? i.mean_vol_lvl3 : i.vol_lvl3;
            const lvl4 = activeVolMode === 'mean_vol' ? i.mean_vol_lvl4 : i.vol_lvl4;
            
            if (value <= lvl4) color = '#0033ff'; // Blue
            else if (value <= lvl3) color = '#ff8c00'; // Orange
            else if (value <= lvl2) color = '#ffff00'; // Yellow
            else if (value <= lvl1) color = '#ff3333'; // Red
          }
          return { time: i.time, value: value, color };
        }).sort((a,b)=>a.time-b.time);
        
        // projectedNormVol is now handled by projectedVolSeriesRef

        const newSessionData = rawData.filter(i => i.session_color).map(i => ({
          time: i.time,
          color: i.session_color,
          name: i.session_name
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
        
        const lvl1Field = activeVolMode === 'mean_vol' ? 'mean_vol_lvl1' : 'vol_lvl1';
        const lvl2Field = activeVolMode === 'mean_vol' ? 'mean_vol_lvl2' : 'vol_lvl2';
        const lvl3Field = activeVolMode === 'mean_vol' ? 'mean_vol_lvl3' : 'vol_lvl3';
        const lvl4Field = activeVolMode === 'mean_vol' ? 'mean_vol_lvl4' : 'vol_lvl4';

        const v85 = activeVolMode === 'rvol' ? [] : rawData.filter(d => d[lvl1Field] != null && !isNaN(d[lvl1Field])).map(i => ({time: i.time, value: i[lvl1Field]})).sort((a,b)=>a.time-b.time);
        const v75 = activeVolMode === 'rvol' ? [] : rawData.filter(d => d[lvl2Field] != null && !isNaN(d[lvl2Field])).map(i => ({time: i.time, value: i[lvl2Field]})).sort((a,b)=>a.time-b.time);
        const v50 = activeVolMode === 'rvol' ? [] : rawData.filter(d => d[lvl3Field] != null && !isNaN(d[lvl3Field])).map(i => ({time: i.time, value: i[lvl3Field]})).sort((a,b)=>a.time-b.time);
        const v15 = activeVolMode === 'rvol' ? [] : rawData.filter(d => d[lvl4Field] != null && !isNaN(d[lvl4Field])).map(i => ({time: i.time, value: i[lvl4Field]})).sort((a,b)=>a.time-b.time);
        
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
        const bandwidthHistory = [...bandwidthHistoryRef.current];
        
        const isSunset = chartTheme === 'sunset';
        const colUp = isSunset ? "rgba(255, 255, 255, 0.9)" : "rgba(0, 230, 118, 0.9)";
        const colDn = isSunset ? "rgba(31, 41, 55, 0.9)" : "rgba(255, 23, 68, 0.9)";
        
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
        });
        if (upperBandData.length > 0) {
          lastSdColorRef.current = upperBandData[upperBandData.length - 1].color;
        }
        bandwidthHistoryRef.current = bandwidthHistory.slice(-10); // Keep last 10
        
                            if (candlestickSeriesRef.current && chartRef.current) {
            let viewportFutureTimes = [];
            const oldLastTime = lastUpdateTimeRef.current || 0;
            const safeUpdate = (series, d) => {
              if (d.time >= oldLastTime) {
                try { series.update(d); } catch (e) {}
              }
            };
            if (isPolling) {formattedData.forEach(d => {
                safeUpdate(candlestickSeriesRef.current, d);
                safeUpdate(lineCloseSeriesRef.current, { time: d.time, value: d.close });
                safeUpdate(lineHighSeriesRef.current, { time: d.time, value: d.high });
                safeUpdate(lineLowSeriesRef.current, { time: d.time, value: d.low });
                if (alertsSeriesRef.current) safeUpdate(alertsSeriesRef.current, { time: d.time, value: d.close });
            });
            vwapData.forEach(d => safeUpdate(vwapSeriesRef.current, d));
            Object.entries(sessionVwapBandData).forEach(([session, bands]) => {
              const series = sessionVwapBandSeriesRef.current[session];
              if (!series) return;
              bands.upper.forEach(d => safeUpdate(series.upper, d));
              bands.lower.forEach(d => safeUpdate(series.lower, d));
            });
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
            
            if (normVolSeriesRef.current) {
              normVolData.forEach(d => safeUpdate(normVolSeriesRef.current, d));
              maVolData.forEach(d => safeUpdate(maVolSeriesRef.current, d));
              v85.forEach(d => safeUpdate(vol85Ref.current, d));
              v75.forEach(d => safeUpdate(vol75Ref.current, d));
              v50.forEach(d => safeUpdate(vol50Ref.current, d));
              v15.forEach(d => safeUpdate(vol15Ref.current, d));
            }
            if (projectedVolSeriesRef.current) {
              if (activeVolMode === 'mean_vol') {
                if (projectedNormVol.length > 0) {
                  projectedVolSeriesRef.current.setData(projectedNormVol.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
                }
              } else {
                projectedVolSeriesRef.current.setData([]);
              }
            }
            
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
                
                const isCrypto = symbol.includes("BTC") || symbol.includes("ETH") || symbol.includes("SOL") || symbol.includes("XRP") || symbol.includes("CRYPTO");
                const futureTimes = generateFutureTimeline(cTime, tfSec, 1500, isCrypto, configs.timeShiftHours || 0);
                viewportFutureTimes = futureTimes;
                
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
            Object.entries(sessionVwapBandData).forEach(([session, bands]) => {
              const series = sessionVwapBandSeriesRef.current[session];
              if (!series) return;
              const validPoints = points => points.filter(d => d && Number.isFinite(d.time) && (d.value == null || Number.isFinite(d.value)));
              series.upper.setData(validPoints(bands.upper));
              series.lower.setData(validPoints(bands.lower));
            });
            if (fairValueSeriesRef.current) fairValueSeriesRef.current.setData(fairValueData.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
            upperBandSeriesRef.current.setData(upperBandData.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
            lowerBandSeriesRef.current.setData(lowerBandData.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
            momentumSeriesRef.current.setData(momentumData.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
            
            // Cập nhật đường Spread (Bid / Ask)
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
                normVolSeriesRef.current.setData(normVolData.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
                maVolSeriesRef.current.setData(maVolData.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
                vol85Ref.current.setData(v85.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
                vol75Ref.current.setData(v75.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
                vol50Ref.current.setData(v50.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
                vol15Ref.current.setData(v15.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
            }
            if (projectedVolSeriesRef.current) {
                projectedVolSeriesRef.current.setData(activeVolMode === 'mean_vol' ? projectedNormVol.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)) : []);
            }
            
            if (updateOverlaysRef.current) setTimeout(() => updateOverlaysRef.current(), 200);
            
            const candlePoints = formattedData.filter(item => Number.isFinite(item.close));
            const totalCandles = candlePoints.length;
            const visibleBars = 50;
            const futureBars = 5;
            const tfSec = timeframe === 'M1' ? 60 : timeframe === 'M3' ? 180 : timeframe === 'M5' ? 300 : timeframe === 'M15' ? 900 : timeframe === 'M30' ? 1800 : timeframe === 'H1' ? 3600 : timeframe === 'H2' ? 7200 : timeframe === 'H4' ? 14400 : timeframe === 'H8' ? 28800 : timeframe === 'D1' ? 86400 : 3600;
            const getLatestViewportRange = (futureCount = futureBars) => {
                if (totalCandles === 0) return null;
                const startIndex = Math.max(0, totalCandles - visibleBars + futureCount);
                const latestCandleTime = candlePoints[totalCandles - 1].time;
                const futureTime = viewportFutureTimes[futureCount - 1]?.time || latestCandleTime + tfSec * futureCount;
                return {
                    from: candlePoints[startIndex].time,
                    to: Math.max(futureTime, latestCandleTime + 1),
                };
            };

            if (resetViewport && totalCandles > 0) {
                // Backtest mới mở quanh thời điểm replay để vẫn còn chỗ quan sát phía sau nến.
                const halfBars = Math.floor(visibleBars / 2);
                const startIndex = Math.max(0, totalCandles - 1 - halfBars);
                const from = candlePoints[startIndex].time;
                const lastCandleTime = candlePoints[totalCandles - 1].time;
                const to = viewportFutureTimes[halfBars - 1]?.time || lastCandleTime + tfSec * halfBars;
                const range = { from, to: Math.max(to, lastCandleTime + 1) };
                chartRef.current.timeScale().setVisibleRange(range);
                if (momentumChartRef.current) momentumChartRef.current.timeScale().setVisibleRange(range);
                if (volumeChartRef.current) volumeChartRef.current.timeScale().setVisibleRange(range);
            } else if (savedTimeRangeRef.current) {
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
                    const range = getLatestViewportRange();
                    if (range) {
                        chartRef.current.timeScale().setVisibleRange(range);
                        if (momentumChartRef.current) momentumChartRef.current.timeScale().setVisibleRange(range);
                        if (volumeChartRef.current) volumeChartRef.current.timeScale().setVisibleRange(range);
                    }
                }
            } else if (totalCandles > 0) {
                const range = getLatestViewportRange();
                chartRef.current.timeScale().setVisibleRange(range);
                if (momentumChartRef.current) momentumChartRef.current.timeScale().setVisibleRange(range);
                if (volumeChartRef.current) volumeChartRef.current.timeScale().setVisibleRange(range);
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
        
        // Keep the last valid D-VP during lightweight backtest polls. Those
        // requests intentionally omit a full profile recalculation; an empty
        // array means "not refreshed", not "remove every existing zone".
        const updatedVpBoxes = response.data.indicators?.vp_boxes;
        if (Array.isArray(updatedVpBoxes) && updatedVpBoxes.length > 0) {
          setVpBoxes(updatedVpBoxes);
        } else if (!isPolling) {
          setVpBoxes([]);
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
            setError(`Không thể tải dữ liệu ${symbol}. Hãy kiểm tra MT5 và Backend (Có thể mã không tồn tại trên sàn).`);
        }
        
        // Xóa dữ liệu cũ trên biểu đồ để tránh nhầm lẫn
        if (!isPolling && candlestickSeriesRef.current) {
            candlestickSeriesRef.current.setData([]);
            if (vwapSeriesRef.current) vwapSeriesRef.current.setData([]);
            Object.values(sessionVwapBandSeriesRef.current).forEach(bands => {
              bands?.upper?.setData([]);
              bands?.lower?.setData([]);
            });
            if (momentumSeriesRef.current) momentumSeriesRef.current.setData([]);
            if (normVolSeriesRef.current) normVolSeriesRef.current.setData([]);
            if (projectedVolSeriesRef.current) projectedVolSeriesRef.current.setData([]);
            if (maVolSeriesRef.current) maVolSeriesRef.current.setData([]);
            rawCandlesRef.current = [];
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
            // Polling request âm thầm chạy ngầm, không được phép điều khiển biến loading
            isPollingRef.current = false;
        } else if (!skipLoadingUI) {
            // Trì hoãn việc tắt Loading một chút để Lightweight Charts (Canvas) kịp vẽ xong 10,000 nến
            setTimeout(() => {
                setLoading(false);
                loadingRef.current = false;
            }, 300);
        }
      }
    };

  useEffect(() => {
    // Lọc các configs thực sự cần gọi lại Backend MT5 (bỏ qua volMode vì được updateVolumeSeries xử lý trực tiếp)
    const { emailSender, emailPassword, emailReceiver, volMode, ...backendConfigs } = configs;
    const backendKey = JSON.stringify({ symbol, timeframe, viewMode, chartTheme, backendConfigs });
    
    // Nếu chỉ có volMode thay đổi thì updateVolumeSeries đã cập nhật trực tiếp trên client
    if (prevBackendConfigsRef.current === backendKey) {
      return;
    }
    prevBackendConfigsRef.current = backendKey;

    if (viewMode === 'chart') {
      fetchData();
      const intervalId = setInterval(() => {
        fetchData(true);
      }, 15000); // Refresh indicator calculations less often; live candles use the lightweight poll below.
      const candleIntervalId = setInterval(() => {
        fetchLatestCandle();
      }, 2000);
      return () => {
        clearInterval(intervalId);
        clearInterval(candleIntervalId);
      };
    } else if (viewMode === 'backtest' && simulatedTimeRef.current) {
      // Khi đổi symbol hoặc timeframe trong lúc backtest
      fetchData(false, simulatedTimeRef.current);
      // Tải lại tin tức cho cặp tiền mới
      setBacktestNewsStatus('Đang tải tin...');
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
          setBacktestNewsStatus(finalData.length ? `${finalData.length} tin` : '0 tin — kiểm tra Forex Factory/VPN');
        } else {
          setBacktestNewsStatus('Không tải được tin');
        }
      }).catch(e => {
        console.error(e);
        setBacktestNewsStatus('Lỗi kết nối nguồn tin');
      });
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
      // Để tránh quá tải API khi speed cao, ta tự động gộp nhiều nến vào 1 nhịp (tick)
      let candlesPerTick = 1;
      let targetDelay = 1000 / speed;
      
      if (speed >= 50) {
          candlesPerTick = Math.floor(speed / 10);
          targetDelay = 1000 / 10; // Giới hạn max 10 tick/giây để mượt
      } else if (speed >= 10) {
          candlesPerTick = 2;
          targetDelay = 1000 / (speed / 2);
      }
      
      const isCrypto = symbol.includes("BTC") || symbol.includes("ETH") || symbol.includes("SOL") || symbol.includes("XRP") || symbol.includes("CRYPTO");
      
      // Tiến nhiều nến cùng lúc, chỉ gọi API 1 lần ở cuối
      for (let step = 0; step < candlesPerTick; step++) {
        simulatedTimeRef.current += tfSec;
        
        // Bỏ qua Thứ 7, Chủ Nhật để Backtest không bị "treo" (trừ Crypto)
        if (!isCrypto) {
            const brokerT = simulatedTimeRef.current - ((configs.timeShiftHours || 0) * 3600);
            const d = new Date(brokerT * 1000);
            const day = d.getUTCDay();
            const h = d.getUTCHours();
            const m = d.getUTCMinutes();
            const s = d.getUTCSeconds();
            
            let skip = false;
            let jumpHours = 0;
            
            // MT5 timestamps are UTC. Market closes Friday ~22:00 UTC, opens Sunday ~21:00 UTC.
            if (day === 5 && h >= 22) {
                skip = true;
                jumpHours = 24 - h + 24 + 21; // Jump rest of Friday + Saturday + Sunday until 21:00
            } else if (day === 6) { // Saturday
                skip = true;
                jumpHours = 24 - h + 21; // Jump rest of Saturday + Sunday until 21:00
            } else if (day === 0 && h < 21) { // Sunday before 21:00
                skip = true;
                jumpHours = 21 - h; // Jump rest of Sunday until 21:00
            }
            
            if (skip) {
                simulatedTimeRef.current += (jumpHours * 3600) - (m * 60) - s;
            }
        }
      }
      
      // Cập nhật thời gian giả lập 1 lần duy nhất sau khi tiến xong
      window.currentSimulatedTime = simulatedTimeRef.current;
      window.dispatchEvent(new Event('simulatedTimeChanged'));
      
      // Phát hiện qua tuần mới -> tải tin tức tuần mới
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
            setBacktestNewsStatus(newEvents.length ? 'Đã cập nhật lịch tin' : '0 tin — kiểm tra Forex Factory/VPN');
          } else {
            setBacktestNewsStatus('Không tải được tin');
          }
        } catch (e) {
          console.error("Failed to fetch next week news", e);
          setBacktestNewsStatus('Lỗi kết nối nguồn tin');
        }
      }
      
      // Luôn dùng polling (safeUpdate) cho mượt vì candlesPerTick = 1
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
      alert("Vui lòng chọn ngày giờ Backtest!");
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
    setNewsData([]);
    setBacktestNewsStatus('Đang tải tin...');
    fetchData(false, targetTimestamp, false, true);
    
    // Tải tin tức lịch sử cho backtest
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
        setBacktestNewsStatus(finalData.length ? `${finalData.length} tin` : '0 tin — kiểm tra Forex Factory/VPN');
      } else {
        setBacktestNewsStatus('Không tải được tin');
      }
    } catch (e) {
      console.error("Failed to fetch backtest news", e);
      setBacktestNewsStatus('Lỗi kết nối nguồn tin');
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
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleLoadBacktest();
                  }
                }}
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
                <option value={20}>20x</option>
                <option value={50}>50x</option>
                <option value={100}>100x (Siêu nhanh)</option>
              </select>
            </div>
            
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '14px', fontSize: '0.85rem' }}>
              <span style={{ color: backtestNewsStatus.startsWith('0 tin') || backtestNewsStatus.startsWith('Lỗi') ? '#fbbf24' : 'var(--text-secondary)' }}>
                Tin lịch sử: {backtestNewsStatus}
              </span>
              <span style={{ color: 'var(--text-secondary)' }}>
                Thời gian giả lập: {simulatedTimeRef.current ? new Date(simulatedTimeRef.current * 1000).toLocaleString() : 'Chưa tải'}
              </span>
            </div>
          </div>
        )}
        {loading && (
          <div style={{ 
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', 
            zIndex: 100, background: 'rgba(0, 0, 0, 0.85)', padding: '25px 50px', borderRadius: '12px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', boxShadow: '0 0 30px rgba(0,240,255,0.3)',
            border: '1px solid rgba(0,240,255,0.5)'
          }}>
            <div className="spinner" style={{ marginBottom: '15px' }}></div>
            <div style={{ color: '#60a5fa', fontSize: '1.2rem', fontWeight: 'bold' }}>Đang tải dữ liệu {symbol}...</div>
            <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginTop: '5px', marginBottom: '15px' }}>Vui lòng đợi trong giây lát</div>
            <button 
              onClick={() => {
                if (abortControllerRef.current) {
                    abortControllerRef.current.abort();
                }
                setLoading(false);
                loadingRef.current = false;
                setError("Người dùng đã hủy tải dữ liệu. (Bấm chọn mã hoặc khung thời gian khác để tải lại)");
              }}
              style={{
                background: '#ef4444', color: 'white', border: 'none', padding: '8px 16px',
                borderRadius: '6px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 'bold'
              }}
            >
              Hủy Tác Vụ
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
          <div ref={sessionSdTooltipRef} style={{ display: 'none', position: 'absolute', zIndex: 12, pointerEvents: 'none', padding: '5px 8px', border: '1px solid', borderRadius: '6px', background: 'rgba(2, 6, 23, 0.94)', fontSize: '11px', fontWeight: 700, lineHeight: 1.2, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }} />
          {(currentSdPosition !== null || currentSessionSdPosition !== null || sessionSdPositions.length > 0) && (viewMode !== 'backtest' || simulatedTimeRef.current > 0) && (
            <div style={{ position: 'absolute', top: '10px', left: '10px', zIndex: 8, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '5px', pointerEvents: 'auto' }}>
              {currentSdPosition !== null && (
                <div style={{
                  padding: '5px 9px', borderRadius: '6px',
                  background: 'rgba(15, 23, 42, 0.9)',
                  border: `1px solid ${currentSdPosition >= 0 ? 'rgba(34, 211, 238, 0.55)' : 'rgba(251, 146, 60, 0.55)'}`,
                  color: currentSdPosition >= 0 ? '#67e8f9' : '#fdba74',
                  boxShadow: '0 2px 10px rgba(0, 0, 0, 0.3)',
                  fontSize: '12px', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                }}>
                  VWAP {currentSdPosition > 0 ? '+' : ''}{currentSdPosition.toFixed(2)} SD
                </div>
              )}
              {currentSessionSdPosition && (
                <div style={{
                  padding: '5px 9px', borderRadius: '6px',
                  background: 'rgba(15, 23, 42, 0.94)',
                  border: `1px solid ${currentSessionSdPosition.color}`,
                  color: currentSessionSdPosition.color,
                  boxShadow: `0 2px 10px ${currentSessionSdPosition.color}35`,
                  fontSize: '12px', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                }}>
                  VWAP {currentSessionSdPosition.label}{currentSessionSdPosition.isUpcoming ? ' sắp tới' : ''} {currentSessionSdPosition.position > 0 ? '+' : ''}{currentSessionSdPosition.position.toFixed(2)} SD
                </div>
              )}
              {sessionSdPositions.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                  <label title="Chọn phiên để xem giá đang ở dải SD nào" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 5px', borderRadius: '5px', background: 'rgba(15,23,42,0.94)', border: '1px solid rgba(148,163,184,0.35)', color: '#cbd5e1', fontSize: '10px', fontWeight: 600 }}>
                    SD
                    <select
                      value={selectedSessionSdKey}
                      onChange={event => setSelectedSessionSdKey(event.target.value)}
                      aria-label="Chọn phiên để xem vị trí giá theo SD"
                      style={{ maxWidth: '80px', padding: '2px 4px', background: '#020612', border: '1px solid rgba(0,240,255,0.35)', borderRadius: '4px', color: '#e0f2fe', fontSize: '10px', cursor: 'pointer' }}
                    >
                      <option value="">Phiên…</option>
                      {sessionSdPositions.map(position => <option key={position.key} value={position.key}>{position.label}</option>)}
                    </select>
                  </label>
                  {selectedSessionSdKey && (
                    selectedSessionSdPosition ? (
                      <div style={{
                        padding: '4px 7px', borderRadius: '5px',
                        background: 'rgba(15, 23, 42, 0.94)',
                        border: `1px solid ${selectedSessionSdPosition.color}`,
                        color: selectedSessionSdPosition.color,
                        boxShadow: `0 2px 10px ${selectedSessionSdPosition.color}35`,
                        fontSize: '10px', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                      }}>
                        <span title={`VWAP phiên ${selectedSessionSdPosition.label}`}>
                          {selectedSessionSdPosition.label} {selectedSessionSdPosition.position > 0 ? '+' : ''}{selectedSessionSdPosition.position.toFixed(2)} SD
                        </span>
                      </div>
                    ) : (
                      <div style={{ padding: '4px 7px', borderRadius: '5px', background: 'rgba(15,23,42,0.94)', color: '#94a3b8', fontSize: '10px' }}>Thiếu dữ liệu</div>
                    )
                  )}
                </div>
              )}
            </div>
          )}
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
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6l6 6-6 6"></path>
                <path d="M10 6l6 6-6 6"></path>
                <path d="M21 5v14"></path>
              </svg>
            </button>
          )}

          {rrTools.map(tool => (
            <RrTool 
              key={tool.id} 
              tool={tool} 
              chart={chartRef.current} 
              series={candlestickSeriesRef.current} 
              lastUpdateSignal={lastUpdateSignal}
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
                  type: 'price',
                  price: contextMenu.price.toFixed(5),
                  symbol: contextMenu.symbol
                });
                closeContextMenu();
              }}
            >
              ⏰ Thêm cảnh báo giá...
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
              ⚡ Thêm cảnh báo TKH...
            </div>
            
            <div 
              className="context-menu-item"
              onClick={() => handleAddDrawnLine(contextMenu.price)}
            >
              ➖ Kẻ đường ngang...
            </div>
            {drawnLines.filter(l => l.symbol === symbol).length > 0 && (
                <div 
                  className="context-menu-item"
                  style={{ color: '#ef4444' }}
                  onClick={() => handleRemoveNearestDrawnLine(contextMenu.price)}
                >
                  ❌ Xóa đường ngang gần nhất
                </div>
            )}
            
            <div 
              className="context-menu-item"
              onClick={() => {
                addRrTool('long', contextMenu.price, contextMenu.logical, contextMenu.time);
                closeContextMenu();
              }}
            >
              📈 Thêm RR Mua (Long)
            </div>
            <div 
              className="context-menu-item"
              onClick={() => {
                addRrTool('short', contextMenu.price, contextMenu.logical, contextMenu.time);
                closeContextMenu();
              }}
            >
              📉 Thêm RR Bán (Short)
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
                {customAlertModal.type === 'mom' ? 'Thêm cảnh báo TKH' : 'Thêm cảnh báo giá'}
              </h3>
              
              <div>
                <label style={{ display: 'block', marginBottom: '5px', color: '#94a3b8', fontSize: '0.9rem' }}>Cặp giao dịch</label>
                <div style={{ color: '#eab308', fontWeight: 'bold', fontSize: '1.1rem' }}>{customAlertModal.symbol}</div>
              </div>
              
              <div>
                <label style={{ display: 'block', marginBottom: '5px', color: '#94a3b8', fontSize: '0.9rem' }}>
                  {customAlertModal.type === 'mom' ? 'Ngưỡng TKH có dấu (%)' : 'Mức giá'}
                </label>
                <input 
                  type="number" 
                  value={customAlertModal.price} 
                  onChange={(e) => setCustomAlertModal({...customAlertModal, price: e.target.value})}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-color)', color: 'white', fontWeight: 'bold' }} 
                />
                {customAlertModal.type === 'mom' && <div style={{ marginTop: '5px', color: '#94a3b8', fontSize: '0.78rem' }}>Số dương báo động lượng tăng; số âm báo động lượng giảm. Ví dụ: 75 chỉ báo tại +75%.</div>}
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
                <button onClick={() => { setCustomAlertModal(null); setAlertNoteInput(''); }}>Hủy</button>
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
                }}>Lưu Cảnh Báo</button>
              </div>
            </div>
          </div>
        )}
        {showMomFlipChart && <MomFlipChartComponent data={momFlipDataRef.current} dataVersion={momFlipDataVersion} dataRevision={momFlipDataRevision} mainChart={chartRef.current} mainSeries={candlestickSeriesRef.current} alerts={alerts} symbol={symbol} chartTheme={chartTheme} />}
      </div>
  );
};

const DvpTrendMatrix = ({ data, loading, error, progress, volDays, sessionSettings }) => (
  <div style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-panel)', padding: '22px', borderRadius: '12px', border: '1px solid rgba(34, 211, 238, 0.24)', boxShadow: '0 0 25px rgba(34, 211, 238, 0.05)', overflowX: 'auto' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' }}>
      <div>
        <h2 style={{ margin: 0, color: '#67e8f9', fontSize: '1.2rem' }}>Xếp hạng mức độ xu hướng theo D-VP</h2>
        <div style={{ color: 'var(--text-secondary)', fontSize: '12px', marginTop: '6px', maxWidth: '900px', lineHeight: 1.55 }}>
          Lấy trung bình cộng các khoảng trống giữa những vùng D-VP được giữ lại và từ vùng ngoài cùng đến hai mép VWAP ± {data?.vwap_mult ?? sessionSettings?.vwapMult ?? 2} SD, rồi chuẩn hóa theo 1 SD. Nếu không có vùng D-VP, toàn bộ dải được tính là một khoảng trống; nếu vùng phủ kín dải thì khoảng cách là 0 SD. Phân vị so với các mẫu cùng thời điểm trong {data?.vol_days ?? volDays} ngày; chiều tăng/giảm lấy từ vị trí giá so với VWAP.
        </div>
      </div>
      <div style={{ color: '#94a3b8', fontSize: '11px', whiteSpace: 'nowrap' }}>
        Cửa sổ D-VP: {data?.dvp_lookback_days ?? sessionSettings?.dvpLookbackDays ?? 5} ngày · VWAP: {data?.vwap_length ?? sessionSettings?.vwapLength ?? 89} giờ
      </div>
    </div>

    {loading && <div style={{ padding: '10px 12px', marginBottom: '12px', borderRadius: '7px', background: 'rgba(8,145,178,0.1)', color: '#7dd3fc' }}>Đang tính khoảng cách D-VP cho từng tài sản… {progress}%</div>}
    {error && <div style={{ padding: '12px', marginBottom: '12px', borderRadius: '7px', background: 'rgba(248,113,113,0.1)', color: '#fca5a5' }}>{error}</div>}
    {!loading && !error && (!data?.rows?.length) && <div style={{ padding: '14px', color: '#94a3b8' }}>Chưa có đủ dữ liệu. Thử chọn ít ngày hơn hoặc kiểm tra kết nối MT5.</div>}

    {!!data?.rows?.length && (
      <table style={{ width: '100%', minWidth: '720px', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
        <thead>
          <tr>
            {['#', 'Cặp / tài sản', 'Chiều giá', 'Giá cách VWAP', 'Khoảng cách D-VP TB', 'Phân vị Vol days', 'Vùng trong dải', 'Mẫu lịch sử'].map(title => (
              <th key={title} style={{ padding: '11px 10px', borderBottom: '1px solid rgba(148,163,184,0.2)', color: '#94a3b8', fontWeight: 600, whiteSpace: 'nowrap' }}>{title}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map(row => {
            const directionColor = row.direction === 'up' ? '#4ade80' : row.direction === 'down' ? '#fb7185' : '#94a3b8';
            const directionLabel = row.direction === 'up' ? '▲ Tăng' : row.direction === 'down' ? '▼ Giảm' : '● Cân bằng';
            return (
              <tr key={row.symbol}>
                <td style={{ padding: '11px 10px', borderBottom: '1px solid rgba(148,163,184,0.09)', color: '#fbbf24', fontWeight: 700 }}>{row.rank}</td>
                <td style={{ padding: '11px 10px', borderBottom: '1px solid rgba(148,163,184,0.09)', color: '#e2e8f0', fontWeight: 700 }}>{row.symbol}</td>
                <td style={{ padding: '11px 10px', borderBottom: '1px solid rgba(148,163,184,0.09)', color: directionColor, fontWeight: 700, whiteSpace: 'nowrap' }}>{directionLabel}</td>
                <td style={{ padding: '11px 10px', borderBottom: '1px solid rgba(148,163,184,0.09)', color: row.close_vwap_sd == null ? '#64748b' : row.close_vwap_sd > 0 ? '#4ade80' : row.close_vwap_sd < 0 ? '#fb7185' : '#94a3b8', whiteSpace: 'nowrap' }}>
                  {row.close_vwap_sd == null ? '—' : `${row.close_vwap_sd > 0 ? '+' : ''}${row.close_vwap_sd.toFixed(2)} SD`}
                </td>
                <td style={{ padding: '11px 10px', borderBottom: '1px solid rgba(148,163,184,0.09)', color: '#e2e8f0', whiteSpace: 'nowrap' }}>{row.gap_sd == null ? '—' : `${row.gap_sd.toFixed(3)} SD`}</td>
                <td style={{ padding: '11px 10px', borderBottom: '1px solid rgba(148,163,184,0.09)', color: row.percentile == null ? '#64748b' : row.percentile >= 70 ? '#4ade80' : row.percentile <= 30 ? '#fb7185' : '#fbbf24', fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {row.percentile == null ? '—' : `P${row.percentile.toFixed(0)}`}
                </td>
                <td style={{ padding: '11px 10px', borderBottom: '1px solid rgba(148,163,184,0.09)', color: '#cbd5e1' }}>{row.zones}</td>
                <td style={{ padding: '11px 10px', borderBottom: '1px solid rgba(148,163,184,0.09)', color: '#94a3b8' }}>{row.samples}/{data.sample_days}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    )}
    <div style={{ marginTop: '12px', color: '#64748b', fontSize: '11px', lineHeight: 1.5 }}>
      P cao nghĩa là khoảng cách D-VP hiện tại rộng hơn phần lớn mẫu lịch sử của chính tài sản đó; khoảng cách tính cả khoảng trống giữa các vùng và giữa vùng ngoài cùng với mép dải SD. Đây là thước đo cấu trúc/độ giãn vùng, không tự khẳng định xu hướng tăng hay giảm. Dữ liệu lấy trên nến M5 để các tài sản trong Matrix có cùng cơ sở đo.
    </div>
  </div>
);

const MatrixComponent = ({ simulatedTime, brokerTimezone, initialMatrixHours, initialMatrixVolDays, onSaveMatrixSettings, symbol, sessionSettings }) => {
  const [sessionMatrixData, setSessionMatrixData] = useState(null);
  const [legacyPowerLong, setLegacyPowerLong] = useState(null);
  const [legacyPowerShort, setLegacyPowerShort] = useState(null);
  const [matrixView, setMatrixView] = useState('groups');
  const [marketFlowData, setMarketFlowData] = useState(null);
  const [marketFlowLoading, setMarketFlowLoading] = useState(false);
  const [marketFlowProgress, setMarketFlowProgress] = useState(0);
  const [marketFlowError, setMarketFlowError] = useState('');
  const [dvpTrendData, setDvpTrendData] = useState(null);
  const [dvpTrendLoading, setDvpTrendLoading] = useState(false);
  const [dvpTrendError, setDvpTrendError] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [matrixHours, setMatrixHours] = useState(initialMatrixHours || Number(localStorage.getItem('currencyMatrixHours')) || 24);
  const [matrixHoursLong, setMatrixHoursLong] = useState(Number(localStorage.getItem('currencyMatrixHoursLong')) || 89);
  const [matrixVolDays, setMatrixVolDays] = useState(initialMatrixVolDays || Number(localStorage.getItem('currencyMatrixVolDays')) || 30);
  const [matrixType, setMatrixType] = useState((localStorage.getItem('matrixType') === 'currency' ? 'fx' : localStorage.getItem('matrixType')) || 'fx');
  const simulatedTimeRef = useRef(simulatedTime);
  simulatedTimeRef.current = simulatedTime;

  // Tự động đổi nhóm tài sản theo symbol đang xem
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
    if (loading && matrixView === 'groups') {
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
  }, [loading, matrixType, matrixView]);

  useEffect(() => {
    let interval;
    if (marketFlowLoading) {
      interval = setInterval(async () => {
        try {
          const res = await axios.get(`${API_BASE}/api/v1/matrix/progress?matrix_type=market_flows`);
          setMarketFlowProgress(res.data.progress || 0);
        } catch (e) {}
      }, 500);
    } else {
      setMarketFlowProgress(0);
    }
    return () => clearInterval(interval);
  }, [marketFlowLoading]);

  useEffect(() => {
    let interval;
    if (dvpTrendLoading) {
      interval = setInterval(async () => {
        try {
          const res = await axios.get(`${API_BASE}/api/v1/matrix/progress?matrix_type=dvp_trend`);
          setProgress(res.data.progress || 0);
        } catch (e) {}
      }, 500);
    } else if (matrixView === 'trend_ranking') {
      setProgress(0);
    }
    return () => clearInterval(interval);
  }, [dvpTrendLoading, matrixView]);


  const fetchMatrix = async (force = false) => {
    if (force && onSaveMatrixSettings) {
      onSaveMatrixSettings(matrixHours, matrixVolDays);
    }
    const browserOffsetHours = -new Date().getTimezoneOffset() / 60;
    const sessionParams = {
      asiaStart: sessionSettings?.asiaStart || '07:00',
      asiaEnd: sessionSettings?.asiaEnd || '11:00',
      euroStart: sessionSettings?.euroStart || '07:00',
      euroEnd: sessionSettings?.euroEnd || '09:00',
      preUsStart: sessionSettings?.preUsStart || '16:00',
      preUsEnd: sessionSettings?.preUsEnd || '19:00',
      usStart: sessionSettings?.usStart || '07:30',
      usEnd: sessionSettings?.usEnd || '11:00',
      autoDst: sessionSettings?.autoDst ?? true,
      browserOffsetHours
    };
    const cacheSignature = JSON.stringify({ matrixMetricVersion: 3, matrixHours, matrixHoursLong, matrixVolDays, brokerTimezone, ...sessionParams });

    // Không dùng cache nếu đang ở chế độ backtest
    if (!force && !simulatedTime) {
      const cached = localStorage.getItem(`matrixCache_${matrixType}`);
      const cachedTime = localStorage.getItem(`matrixCacheTime_${matrixType}`);
      const cachedSignature = localStorage.getItem(`matrixCacheSignature_${matrixType}`);
      if (cached && cachedTime && cachedSignature === cacheSignature) {
        const age = Date.now() - parseInt(cachedTime);
        if (age < 60 * 1000) {
            const parsed = JSON.parse(cached);
            if (parsed.session && parsed.powerLong && parsed.powerShort) {
              setSessionMatrixData(parsed.session);
              setLegacyPowerLong(parsed.powerLong);
              setLegacyPowerShort(parsed.powerShort);
              return;
            }
        }
      }
    }
    
    setLoading(true);
    try {
      const commonParams = { vol_days: matrixVolDays, matrix_type: matrixType, end_time: simulatedTime || 0, brokerTimezone };
      const [flowShort, flowLong, trendShort, trendLong, sessionStats] = await Promise.all([
        axios.get(`${API_BASE}/api/v1/matrix`, { params: { ...commonParams, n_hours: matrixHours, matrix_mode: 'money_flow' } }),
        axios.get(`${API_BASE}/api/v1/matrix`, { params: { ...commonParams, n_hours: matrixHoursLong, matrix_mode: 'money_flow' } }),
        axios.get(`${API_BASE}/api/v1/matrix`, { params: { ...commonParams, n_hours: matrixHours, matrix_mode: 'trend' } }),
        axios.get(`${API_BASE}/api/v1/matrix`, { params: { ...commonParams, n_hours: matrixHoursLong, matrix_mode: 'trend' } }),
        axios.get(`${API_BASE}/api/v1/matrix/session-stats`, {
          params: {
            short_hours: matrixHours,
            long_hours: matrixHoursLong,
            vol_days: matrixVolDays,
            matrix_type: matrixType,
            end_time: simulatedTime || 0,
            brokerTimezone,
            ...sessionParams
          }
        })
      ]);
      const powerLong = computeCompositeRanking(flowLong.data?.ranking, trendLong.data?.ranking);
      const powerShort = computeCompositeRanking(flowShort.data?.ranking, trendShort.data?.ranking);
      setSessionMatrixData(sessionStats.data);
      setLegacyPowerLong(powerLong);
      setLegacyPowerShort(powerShort);
      
      if (!simulatedTime) {
          localStorage.setItem(`matrixCache_${matrixType}`, JSON.stringify({ session: sessionStats.data, powerLong, powerShort }));
          localStorage.setItem(`matrixCacheTime_${matrixType}`, Date.now().toString());
          localStorage.setItem(`matrixCacheSignature_${matrixType}`, cacheSignature);
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

  const fetchMarketFlow = async (force = false) => {
    if (force && onSaveMatrixSettings) onSaveMatrixSettings(matrixHours, matrixVolDays);
    setMarketFlowLoading(true);
    setMarketFlowError('');
    try {
      const res = await axios.get(`${API_BASE}/api/v1/matrix/market-flows`, {
        params: {
          short_hours: matrixHours,
          long_hours: matrixHoursLong,
          vol_days: matrixVolDays,
          end_time: simulatedTime || 0,
          brokerTimezone,
          force
        }
      });
      setMarketFlowData(res.data);
    } catch (err) {
      console.error('Error fetching market flow matrix:', err);
      setMarketFlowError('Không tải được dữ liệu GI. Hãy thử làm mới hoặc kiểm tra kết nối MT5.');
    } finally {
      setMarketFlowLoading(false);
    }
  };

  const fetchDvpTrend = async (force = false) => {
    if (force && onSaveMatrixSettings) onSaveMatrixSettings(matrixHours, matrixVolDays);
    setDvpTrendLoading(true);
    setDvpTrendError('');
    try {
      const res = await axios.get(`${API_BASE}/api/v1/matrix/dvp-trend`, {
        params: {
          matrix_type: matrixType,
          vol_days: matrixVolDays,
          end_time: simulatedTimeRef.current || 0,
          brokerTimezone,
          dvp_lookback_days: sessionSettings?.dvpLookbackDays,
          vwap_length: sessionSettings?.vwapLength,
          vwap_mult: sessionSettings?.vwapMult,
          pct1: sessionSettings?.pct1,
          grid_mode: sessionSettings?.gridMode,
          fixed_pips: sessionSettings?.fixedPips,
          row_count: sessionSettings?.rowCount,
          timeout_hours: sessionSettings?.timeoutHours,
          force
        }
      });
      setDvpTrendData(res.data);
    } catch (err) {
      console.error('Error fetching D-VP trend ranking:', err);
      setDvpTrendError('Không tải được bảng xếp hạng xu hướng D-VP. Hãy thử làm mới hoặc kiểm tra kết nối MT5.');
    } finally {
      setDvpTrendLoading(false);
    }
  };

  useEffect(() => {
    if (matrixView !== 'groups') return undefined;
    fetchMatrix(false);
    
    // Tự động làm mới Ma trận mỗi 5 phút
    const intervalId = setInterval(() => {
      fetchMatrix(true);
    }, 5 * 60 * 1000);
    
    return () => clearInterval(intervalId);
  }, [matrixType, matrixView, sessionSettings?.asiaStart, sessionSettings?.asiaEnd, sessionSettings?.euroStart, sessionSettings?.euroEnd, sessionSettings?.preUsStart, sessionSettings?.preUsEnd, sessionSettings?.usStart, sessionSettings?.usEnd, sessionSettings?.autoDst]);

  useEffect(() => {
    if (matrixView !== 'market_flows') return undefined;
    const initialFetchTimer = setTimeout(() => fetchMarketFlow(false), 350);
    const intervalId = setInterval(() => fetchMarketFlow(false), 5 * 60 * 1000);
    return () => {
      clearTimeout(initialFetchTimer);
      clearInterval(intervalId);
    };
  }, [matrixView, matrixHours, matrixHoursLong, matrixVolDays, brokerTimezone]);

  useEffect(() => {
    if (matrixView !== 'trend_ranking') return undefined;
    const initialFetchTimer = setTimeout(() => fetchDvpTrend(false), 350);
    const intervalId = setInterval(() => fetchDvpTrend(false), 5 * 60 * 1000);
    return () => {
      clearTimeout(initialFetchTimer);
      clearInterval(intervalId);
    };
  }, [matrixView, matrixType, matrixVolDays, brokerTimezone, sessionSettings?.dvpLookbackDays, sessionSettings?.vwapLength, sessionSettings?.vwapMult, sessionSettings?.pct1, sessionSettings?.gridMode, sessionSettings?.fixedPips, sessionSettings?.rowCount, sessionSettings?.timeoutHours]);

  return (
    <div style={{ padding: '20px', display: 'flex', gap: '40px', color: 'var(--text-primary)', flexDirection: 'column', position: 'relative' }}>
      
      {loading && matrixView === 'groups' && (
        <div style={{
          position: 'absolute', top: '60px', left: 0, right: 0, bottom: 0,
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

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {[
          { key: 'groups', label: 'Currency Matrix' },
          { key: 'market_flows', label: 'Dòng tiền thị trường' },
          { key: 'trend_ranking', label: 'Xếp hạng xu hướng' }
        ].map(tab => (
          <button key={tab.key} onClick={() => setMatrixView(tab.key)} style={{
            padding: '8px 14px', borderRadius: '8px', border: `1px solid ${matrixView === tab.key ? 'rgba(34,211,238,0.55)' : 'rgba(148,163,184,0.2)'}`,
            background: matrixView === tab.key ? 'rgba(8,145,178,0.28)' : 'var(--bg-panel)', color: matrixView === tab.key ? '#67e8f9' : 'var(--text-secondary)',
            cursor: 'pointer', fontWeight: matrixView === tab.key ? 700 : 500
          }}>{tab.label}</button>
        ))}
      </div>

      {/* Header điều khiển */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '15px', background: 'var(--bg-panel)', padding: '15px 20px', borderRadius: '12px', flexWrap: 'wrap' }}>
        {matrixView === 'groups' && <div style={{ display: 'flex', gap: '10px', marginRight: '15px', borderRight: '1px solid #4b5563', paddingRight: '15px', flexWrap: 'wrap' }}>
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
              {type === 'fx' ? 'Forex' : type === 'us_stocks' ? 'Cổ phiếu Mỹ' : type === 'commodities' ? 'Hàng hóa' : type === 'crypto' ? 'Crypto' : 'USD vs Assets'}
            </button>
          ))}
        </div>}
        
        <div style={{ display: 'flex', gap: '10px', marginRight: '15px', borderRight: '1px solid #4b5563', paddingRight: '15px' }}>
          {/* matrix mode toggle removed as both are shown */}
        </div>
        
        <label>Ngắn hạn (Giờ):</label>
        <input 
          type="number" 
          value={matrixHours} 
          onChange={e => { const val = Number(e.target.value); setMatrixHours(val); localStorage.setItem('currencyMatrixHours', val.toString()); }}
          style={{ padding: '5px 10px', borderRadius: '5px', border: '1px solid #4b5563', background: '#374151', color: 'white', width: '70px' }}
        />
        
        <label style={{ marginLeft: '10px' }}>Dài hạn (Giờ):</label>
        <input 
          type="number" 
          value={matrixHoursLong} 
          onChange={e => { const val = Number(e.target.value); setMatrixHoursLong(val); localStorage.setItem('currencyMatrixHoursLong', val.toString()); }}
          style={{ padding: '5px 10px', borderRadius: '5px', border: '1px solid #4b5563', background: '#374151', color: 'white', width: '70px' }}
        />
        
        <label style={{ marginLeft: '10px' }}>Volume (Ngày):</label>
        <input 
          type="number" 
          value={matrixVolDays} 
          onChange={e => { const val = Number(e.target.value); setMatrixVolDays(val); localStorage.setItem('currencyMatrixVolDays', val.toString()); }}
          style={{ padding: '5px 10px', borderRadius: '5px', border: '1px solid #4b5563', background: '#374151', color: 'white', width: '70px' }}
        />
        <button 
          onClick={() => matrixView === 'groups' ? fetchMatrix(true) : matrixView === 'market_flows' ? fetchMarketFlow(true) : fetchDvpTrend(true)}
          style={{ padding: '5px 15px', borderRadius: '5px', background: '#3b82f6', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
        >
          🔄 Tính lại / Làm mới
        </button>
        <span style={{ fontSize: '12px', color: '#9ca3af', marginLeft: 'auto' }}>
          {matrixView === 'groups' ? '*Dữ liệu tự động lưu đệm (cache) trong 1 phút để tránh kẹt API.' : matrixView === 'market_flows' ? '*So sánh GI theo cùng cửa sổ và Vol days; dữ liệu tự làm mới mỗi 5 phút.' : '*Xếp hạng khoảng cách D-VP trong dải VWAP/SD; tự làm mới mỗi 5 phút.'}
        </span>
      </div>

      {matrixView === 'market_flows' ? (
        <MarketFlowMatrix data={marketFlowData} loading={marketFlowLoading} error={marketFlowError} progress={marketFlowProgress} onRefresh={() => fetchMarketFlow(true)} />
      ) : matrixView === 'trend_ranking' ? (
        <DvpTrendMatrix data={dvpTrendData} loading={dvpTrendLoading} error={dvpTrendError} progress={progress} volDays={matrixVolDays} sessionSettings={sessionSettings} />
      ) : sessionMatrixData ? (() => {
        const ranking = legacyPowerLong || [];
        const topLeader = ranking[0] || null;
        const topLaggard = ranking[ranking.length - 1] || null;
        const counts = ranking.reduce((result, item) => {
          result[item.status] = (result[item.status] || 0) + 1;
          return result;
        }, {});
        return (
          <div style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-panel)', padding: '24px', borderRadius: '12px', border: '1px solid rgba(34, 211, 238, 0.24)', boxShadow: '0 0 25px rgba(34, 211, 238, 0.05)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h2 style={{ margin: 0, color: '#fbbf24', fontSize: '1.25rem' }}>⚡ Sức Mạnh Hợp Nhất V-target ({matrixHoursLong}H / {matrixHours}H) + Động Lượng Theo Phiên</h2>
                <div style={{ color: 'var(--text-secondary)', fontSize: '12px', marginTop: '5px' }}>T/F là phân vị động lượng có dấu so với cửa sổ cùng độ dài trong Vol days · V phiên là phân vị volume · P = (0.368 × T + 0.632 × F) × hệ số V.</div>
              </div>
              <span style={{ color: '#7dd3fc', background: 'rgba(14,165,233,0.08)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: '7px', padding: '6px 9px', fontSize: '11px', whiteSpace: 'nowrap' }}>T/F: phân vị động lượng có dấu · Vol: phân vị volume · P = (0.368 × T + 0.632 × F) × hệ số V</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '10px', marginBottom: '14px' }}>
              <div style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid rgba(74,222,128,0.18)', background: 'rgba(255,255,255,0.02)' }}>
                <div style={{ color: '#94a3b8', fontSize: '10px' }}>Dẫn đầu · {sessionMatrixData.long_hours}h</div>
                <strong style={{ color: '#4ade80', fontSize: '14px' }}>{topLeader ? topLeader.currency + ' (' + (topLeader.powerScore > 0 ? '+' : '') + topLeader.powerScore.toFixed(1) + ')' : '—'}</strong>
              </div>
              <div style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid rgba(248,113,113,0.18)', background: 'rgba(255,255,255,0.02)' }}>
                <div style={{ color: '#94a3b8', fontSize: '10px' }}>Yếu nhất · {sessionMatrixData.long_hours}h</div>
                <strong style={{ color: '#fb7185', fontSize: '14px' }}>{topLaggard ? topLaggard.currency + ' (' + (topLaggard.powerScore > 0 ? '+' : '') + topLaggard.powerScore.toFixed(1) + ')' : '—'}</strong>
              </div>
              <div style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid rgba(251,191,36,0.18)', background: 'rgba(255,255,255,0.02)', color: '#cbd5e1', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '9px', flexWrap: 'wrap' }}>
                <span style={{ color: '#4ade80' }}>● {counts['Dẫn dắt'] || 0} Dẫn dắt</span>
                <span style={{ color: '#38bdf8' }}>● {counts['Tích lũy'] || 0} Tích lũy</span>
                <span style={{ color: '#fbbf24' }}>● {counts['Suy yếu'] || 0} Suy yếu</span>
                <span style={{ color: '#f87171' }}>● {counts['Tụt hậu'] || 0} Tụt hậu</span>
              </div>
            </div>
            <SessionMatrixTable data={sessionMatrixData} longPowerRanking={legacyPowerLong} shortPowerRanking={legacyPowerShort} />
          </div>
        );
      })() : loading ? (
        <div style={{ padding: '24px', color: '#7dd3fc', background: 'var(--bg-panel)', borderRadius: '10px' }}>Đang tải Currency Matrix… {progress}%</div>
      ) : (
        <div style={{ padding: '24px', color: '#94a3b8', background: 'var(--bg-panel)', borderRadius: '10px' }}>Chưa có dữ liệu Currency Matrix.</div>
      )}
      
      {/* Ma trận Tương quan */}
      {matrixView === 'groups' && sessionMatrixData?.corr_matrix && sessionMatrixData.corr_matrix.length > 0 && (
        <div style={{ marginTop: '40px', background: 'var(--bg-panel)', padding: '20px', borderRadius: '12px', overflowX: 'auto' }}>
          <h2 style={{ marginBottom: '20px', color: '#f472b6' }}>Ma trận Tương quan (M30 Log Returns)</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontSize: '0.9rem' }}>
            <thead>
              <tr>
                <th style={{ padding: '10px', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}></th>
                {sessionMatrixData.currencies.map(c => (
                  <th key={c} style={{ padding: '10px', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sessionMatrixData.corr_matrix.map(row => (
                <tr key={row.currency}>
                  <td style={{ padding: '10px', borderBottom: '1px solid rgba(255,255,255,0.05)', fontWeight: 'bold', textAlign: 'left', color: 'var(--text-secondary)' }}>{row.currency}</td>
                  {sessionMatrixData.currencies.map(c => {
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
        <h2 style={{ marginBottom: '20px', color: 'var(--accent-color)' }}>⚙️ Indicator Settings</h2>

        <details style={styleGroup}>
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
            <label style={styleLabel}>Chu kỳ tính D-VP (Số ngày giới hạn vẽ DVP)</label>
            <input type="number" value={local.dvpLookbackDays !== undefined ? local.dvpLookbackDays : 5} onChange={(e) => handleChange('dvpLookbackDays', e.target.value === '' ? '' : parseInt(e.target.value))} style={styleInput} step="1" />
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Target Volume %</label>
            <input type="number" value={local.mfTargetPct !== undefined ? local.mfTargetPct : 50} onChange={e => handleChange('mfTargetPct', Number(e.target.value))} style={styleInput} />
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Chu kỳ tính Target Volume (Nến)</label>
            <input type="number" value={local.mfTimeoutCandles !== undefined ? local.mfTimeoutCandles : 120} onChange={e => handleChange('mfTimeoutCandles', e.target.value === '' ? '' : parseInt(e.target.value))} style={styleInput} />
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
            <label style={styleLabel}>Cửa sổ VWAP chung & theo phiên (Giờ)</label>
            <input type="number" min="1" value={local.vwapLength} onChange={e => handleChange('vwapLength', Number(e.target.value))} style={styleInput} title="VWAP chung dùng mọi nến; VWAP từng phiên chỉ dùng nến thuộc phiên đó trong cửa sổ giờ này. Công thức dải SD được giữ nguyên." />
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Hệ số Band (vwapMult)</label>
            <input type="number" step="0.1" value={local.vwapMult} onChange={e => handleChange('vwapMult', Number(e.target.value))} style={styleInput} />
          </div>
        </details>

        <details style={styleGroup}>
          <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#f59e0b' }}>Chỉ báo Động lượng Lõi (Momentum)</summary>
          <div style={{ marginTop: '10px' }}>
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
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel} title="Số nến dùng để tính trung bình Độ lớn Momentum. So sánh momentum hiện tại với trung bình N nến trước để đo mức tăng/giảm tương đối.">Chu kỳ SMA Moment cho Flip (Nến)</label>
            <input type="number" value={local.smaMomLength} onChange={e => handleChange('smaMomLength', Number(e.target.value))} style={styleInput} />
          </div>
          <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #334155' }}>
            <label style={styleLabel}>Ngưỡng động lượng bùng nổ (%)</label>
            <input type="number" value={local.momFlipFilterPct} onChange={e => handleChange('momFlipFilterPct', Number(e.target.value))} style={styleInput} title="Chỉ xét các nến có độ lớn động lượng đạt phân vị này trong cửa sổ nhìn lại" />
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Ngưỡng tick volume xác nhận (%)</label>
            <input type="number" value={local.momFlipVolFilterPct !== undefined ? local.momFlipVolFilterPct : 50.0} onChange={e => handleChange('momFlipVolFilterPct', Number(e.target.value))} style={styleInput} title="Lọc theo phân vị tick volume của các nến đã đạt ngưỡng động lượng; đây không phải khối lượng giao dịch thực" />
          </div>
        </details>


        <details style={styleGroup}>
          <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#a78bfa' }}>Chỉ báo Khối lượng (Volume)</summary>
            <div style={{ marginTop: '10px' }}>
              <label style={styleLabel}>Chế độ hiển thị</label>
              <select value={local.volMode} onChange={e => handleChange('volMode', e.target.value)} style={styleInput}>
                <option value="normal">Normal (Phân phối Ma trận)</option>
                <option value="rvol">RVol (So sánh cùng giờ)</option>
                <option value="mean_vol">Trung bình Vol (Matrix 500H)</option>
              </select>
            </div>
            
            {local.volMode === 'rvol' && (
              <div style={{ marginTop: '10px' }}>
                <label style={styleLabel}>Chu kỳ RVol (Số Ngày)</label>
                <input type="number" value={local.rvolLookbackDays !== undefined ? local.rvolLookbackDays : 10} onChange={e => handleChange('rvolLookbackDays', e.target.value === '' ? '' : parseInt(e.target.value))} style={styleInput} title="Số ngày dùng để tính trung bình khối lượng của chính giờ này" />
              </div>
            )}

            <div style={{ marginTop: '10px' }}>
              <label style={styleLabel}>Cửa sổ tính Đỉnh/Đáy (Ngày)</label>
              <input type="number" value={local.peakVolLookbackDays} onChange={e => handleChange('peakVolLookbackDays', Number(e.target.value))} style={styleInput} title="Số ngày nhìn lại để thống kê giờ bùng nổ Volume" />
            </div>

            <div style={{ marginTop: '10px' }}>
              <label style={styleLabel}>Chu kỳ MA Volume (Phút)</label>
              <input type="number" value={local.maVolLength !== undefined ? local.maVolLength : 120} onChange={e => handleChange('maVolLength', e.target.value === '' ? '' : parseInt(e.target.value))} style={styleInput} />
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
              <label style={styleLabel}>Phiên Pre-US (Mở - NY)</label>
              <input type="time" value={local.preUsStart || '16:00'} onChange={e => handleChange('preUsStart', e.target.value)} style={styleInput} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={styleLabel}>Phiên Pre-US (Đóng - NY)</label>
              <input type="time" value={local.preUsEnd || '19:00'} onChange={e => handleChange('preUsEnd', e.target.value)} style={styleInput} />
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
  const todayCardRef = useRef(null);
  const didAutoScrollRef = useRef(false);

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

  useEffect(() => {
    if (loading || didAutoScrollRef.current) return;

    const frame = requestAnimationFrame(() => {
      if (!todayCardRef.current) return;
      todayCardRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      didAutoScrollRef.current = true;
    });

    return () => cancelAnimationFrame(frame);
  }, [loading]);

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

  if (loading) return <div style={{ padding: '20px', color: 'white' }}>Đang tải dữ liệu Catalyst...</div>;

  const grouped = news.reduce((acc, curr) => {
    const d = new Date(curr.time * 1000);
    const dayStr = d.toLocaleDateString('vi-VN', { timeZone: 'UTC', weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' });
    if (!acc[dayStr]) acc[dayStr] = [];
    acc[dayStr].push(curr);
    return acc;
  }, {});
  const today = new Date(Date.now() + (Number(configs?.timeShiftHours) || 0) * 3600000)
    .toLocaleDateString('vi-VN', { timeZone: 'UTC', weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' });

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
      {Object.keys(grouped).map(day => {
        const isToday = day === today;
        return (
          <div
            key={day}
            ref={isToday ? todayCardRef : null}
            style={{
              marginBottom: '30px',
              background: 'var(--bg-panel)',
              borderRadius: '12px',
              padding: '15px',
              scrollMarginTop: '16px',
              ...(isToday ? {
                border: '1px solid #39ff14',
                boxShadow: '0 0 10px rgba(57, 255, 20, 0.55), 0 0 26px rgba(57, 255, 20, 0.2), inset 0 0 12px rgba(57, 255, 20, 0.07)'
              } : {})
            }}
          >
            <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '10px', marginBottom: '15px', color: '#60a5fa', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <span>{day}</span>
              {isToday && (
                <span style={{
                  color: '#8cff80',
                  background: 'rgba(57, 255, 20, 0.12)',
                  border: '1px solid rgba(57, 255, 20, 0.8)',
                  borderRadius: '999px',
                  padding: '4px 10px',
                  fontSize: '12px',
                  fontWeight: '700',
                  lineHeight: 1,
                  whiteSpace: 'nowrap',
                  boxShadow: '0 0 10px rgba(57, 255, 20, 0.35)'
                }}>
                  Hôm nay
                </span>
              )}
            </h3>
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
        );
      })}
    </div>
  );
};

// Helper: tự động xác định loại matrix dựa trên symbol đang xem
const getMatrixTypeForSymbol = (sym) => {
  if (!sym) return 'fx';
  const s = sym.toUpperCase();
  // Crypto
  if (s.includes('BTC') || s.includes('ETH') || s.includes('SOL') || s.includes('XRP') || s.includes('DOGE') || s.includes('ADA') || s.includes('DOT') || s.includes('LINK') || s.includes('BNB') || s.includes('AVAX')) return 'crypto';
  // Commodities
  if (s.includes('GOLD') || s.includes('XAU') || s.includes('SILVER') || s.includes('XAG') || s.includes('OIL') || s.includes('BRENT') || s.includes('WTI') || s.includes('NATGAS') || s.includes('COPPER') || s.includes('PLATINUM') || s.includes('PALLADIUM')) return 'commodities';
  // US Stocks / Indices  
  if (s.includes('NASDAQ') || s.includes('US500') || s.includes('US30') || s.includes('US100') || s.includes('SPX') || s.includes('DJI') || s.includes('NDX') || s === 'NAS100' || s.includes('AAPL') || s.includes('TSLA') || s.includes('MSFT') || s.includes('AMZN') || s.includes('GOOG') || s.includes('META') || s.includes('NVDA') || s.includes('DAX') || s.includes('FTSE') || s.includes('JP225') || s.includes('NIKKEI')) return 'us_stocks';
  // Forex (default) - các cặp tiền tệ
  return 'fx';
};

const normalizeInfoSymbol = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function AssetInfoModal({ symbol, timeframe, configs, viewMode, onClose }) {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState(0);
  const matrixType = getMatrixTypeForSymbol(symbol);
  const canonicalSymbol = normalizeInfoSymbol(symbol);
  const matrixHours = Number(localStorage.getItem('currencyMatrixHours')) || Number(configs.matrixHours) || 24;
  const matrixHoursLong = Number(localStorage.getItem('currencyMatrixHoursLong')) || 89;

  useEffect(() => {
    setInfo(null);
    setError('');
    const handleUpdate = snapshot => {
      setInfo(snapshot.data);
      setLoading(snapshot.loading);
      setError(snapshot.error);
      setLastUpdatedAt(snapshot.updatedAt);
    };
    return subscribeAssetInfo(symbol, configs, handleUpdate);
  }, [symbol, matrixType, matrixHours, matrixHoursLong, configs]);

  useEffect(() => {
    const handleKeyDown = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const fxPair = matrixType === 'fx' && canonicalSymbol.length >= 6
    ? canonicalSymbol.slice(0, 6)
    : '';
  const components = fxPair
    ? [fxPair.slice(0, 3), fxPair.slice(3, 6)]
    : [symbol];
  const findRanking = (response, component) => (response?.ranking || []).find(item =>
    normalizeInfoSymbol(item.currency) === normalizeInfoSymbol(component)
  );
  const findSessionRanking = component => (info?.sessionStats?.ranking || []).find(item =>
    normalizeInfoSymbol(item.currency) === normalizeInfoSymbol(component)
    || (component === 'GLOBAL_INDEX' && normalizeInfoSymbol(item.currency) === 'GI')
  );
  const pairSpreadSessions = Object.entries(info?.sessionStats?.pair_spreads || {})
    .find(([sessionSymbol]) => normalizeInfoSymbol(sessionSymbol) === canonicalSymbol)?.[1] || {};
  const getSessionSpread = sessionKey => pairSpreadSessions[sessionKey];
  const getSessionSpreadComparison = sessionKey => {
    const current = getSessionSpread(sessionKey);
    if (current?.spread_to_range_pct == null) return null;
    const peerRatios = Object.entries(info?.sessionStats?.pair_spreads || {})
      .filter(([peerSymbol]) => {
        const peer = normalizeInfoSymbol(peerSymbol);
        if (matrixType !== 'fx' || !fxPair) return true;
        return peer === fxPair
          || peer.slice(0, 3) === fxPair.slice(0, 3)
          || peer.slice(3, 6) === fxPair.slice(0, 3)
          || peer.slice(0, 3) === fxPair.slice(3, 6)
          || peer.slice(3, 6) === fxPair.slice(3, 6);
      })
      .map(([, values]) => values?.[sessionKey]?.spread_to_range_pct)
      .filter(value => value != null && Number.isFinite(Number(value)))
      .map(Number);
    if (!peerRatios.length) return null;
    const percentile = Math.round(peerRatios.filter(value => value <= current.spread_to_range_pct).length / peerRatios.length * 100);
    return {
      percentile,
      peerCount: peerRatios.length,
      assessment: percentile >= 75 ? 'cao' : percentile <= 25 ? 'thấp' : 'trung bình',
    };
  };
  const findDvp = () => (info?.dvp?.rows || []).find(row =>
    normalizeInfoSymbol(row.symbol) === canonicalSymbol
  );
  const dvpRow = findDvp();
  const spread = info?.spread?.current;
  const percentColor = value => value == null ? '#64748b' : value > 0 ? '#4ade80' : value < 0 ? '#fb7185' : '#cbd5e1';
  const formatPercentile = value => value == null ? '—' : `${value > 0 ? '+' : ''}${Number(value).toFixed(1)}%`;
  const formatPriceValue = value => value == null ? '—' : Number(value).toPrecision(5).replace(/\.?0+$/, '');
  const cardStyle = { padding: '14px', borderRadius: '10px', background: 'rgba(15,23,42,0.62)', border: '1px solid rgba(34,211,238,0.15)' };

  return (
    <div onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 12000, background: 'rgba(1,6,18,0.76)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '18px' }}>
      <section role="dialog" aria-modal="true" aria-label={`Thông tin ${symbol}`} style={{ width: 'min(760px, 96vw)', maxHeight: 'min(86vh, 900px)', overflowY: 'auto', color: '#e2e8f0', background: '#071121', border: '1px solid rgba(34,211,238,0.45)', borderRadius: '14px', boxShadow: '0 18px 70px rgba(0,0,0,0.6), 0 0 28px rgba(34,211,238,0.12)', padding: '20px' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', marginBottom: '16px' }}>
          <div>
            <h2 style={{ margin: 0, color: '#67e8f9', fontSize: '19px' }}>Thông tin {symbol}</h2>
            <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '4px' }}>{timeframe}{viewMode === 'backtest' ? ' · Backtest đang mở · chỉ số Matrix/spread theo thời gian thực' : ''} · Currency Matrix: {matrixHours}h / {matrixHoursLong}h</div>
          </div>
          <button onClick={onClose} aria-label="Đóng" style={{ border: '1px solid rgba(34,211,238,0.3)', borderRadius: '8px', background: 'rgba(8,47,73,0.55)', color: '#67e8f9', fontSize: '20px', width: '36px', height: '36px', cursor: 'pointer' }}>×</button>
        </header>

        {loading && <div style={{ padding: '9px 12px', marginBottom: '14px', borderRadius: '8px', color: '#7dd3fc', background: 'rgba(8,145,178,0.12)' }}>
          {info && (info.dvp || info.spread || info.sessionStats || Object.keys(info.matrix || {}).length)
            ? <>Đang cập nhật nền; vẫn hiển thị dữ liệu đã lưu{lastUpdatedAt ? ` lúc ${new Date(lastUpdatedAt).toLocaleTimeString()}` : ''}.</>
            : 'Đang tải Matrix, D‑VP và dữ liệu spread…'}
        </div>}
        {!loading && lastUpdatedAt > 0 && <div style={{ color: '#64748b', fontSize: '11px', marginBottom: '12px' }}>Cập nhật gần nhất: {new Date(lastUpdatedAt).toLocaleString()}</div>}
        {error && <div style={{ padding: '9px 12px', marginBottom: '14px', borderRadius: '8px', color: '#fbbf24', background: 'rgba(180,83,9,0.12)' }}>{error}</div>}

        <div style={{ display: 'grid', gap: '12px' }}>
          <section style={cardStyle}>
            <h3 style={{ margin: '0 0 10px', color: '#a5f3fc', fontSize: '14px' }}>Động lượng Currency Matrix</h3>
            {components.map(component => {
              const trendShort = findRanking(info?.matrix?.trendShort, component);
              const flowShort = findRanking(info?.matrix?.flowShort, component);
              const trendLong = findRanking(info?.matrix?.trendLong, component);
              const flowLong = findRanking(info?.matrix?.flowLong, component);
              return (
                <div key={component} style={{ display: 'grid', gridTemplateColumns: 'minmax(70px, 1fr) repeat(2, minmax(150px, 1.2fr))', gap: '8px', alignItems: 'center', padding: '8px 0', borderTop: '1px solid rgba(148,163,184,0.1)' }}>
                  <strong style={{ color: '#f8fafc' }}>{component}</strong>
                  {[{ label: `${matrixHours}h`, trend: trendShort, flow: flowShort }, { label: `${matrixHoursLong}h`, trend: trendLong, flow: flowLong }].map(period => (
                    <div key={period.label} style={{ color: '#94a3b8', fontSize: '12px', lineHeight: 1.7 }}>
                      <span>{period.label} · </span><span style={{ color: percentColor(period.trend?.mom_percentile) }}>T {formatPercentile(period.trend?.mom_percentile)}</span>
                      <span style={{ marginLeft: '8px', color: percentColor(period.flow?.mom_percentile) }}>F {formatPercentile(period.flow?.mom_percentile)}</span>
                    </div>
                  ))}
                </div>
              );
            })}
            <div style={{ color: '#64748b', fontSize: '10px', marginTop: '5px' }}>T = Price Trend, F = Money Flow; số liệu là phân vị động lượng có dấu như trong Matrix.</div>
            <div style={{ borderTop: '1px solid rgba(148,163,184,0.12)', marginTop: '12px', paddingTop: '10px' }}>
              <h4 style={{ margin: '0 0 8px', color: '#a5f3fc', fontSize: '12px' }}>Động lượng theo phiên</h4>
              {components.map(component => {
                const componentSessions = findSessionRanking(component)?.sessions || {};
                return (
                  <div key={`session-momentum-${component}`} style={{ marginBottom: '12px' }}>
                    <strong style={{ display: 'block', color: '#f8fafc', fontSize: '12px', marginBottom: '5px' }}>{component}</strong>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', minWidth: '440px' }}>
                        <thead><tr style={{ color: '#94a3b8', textAlign: 'left' }}>
                          <th style={{ padding: '5px 7px', borderBottom: '1px solid rgba(148,163,184,0.12)' }}>Phiên</th>
                          <th style={{ padding: '5px 7px', borderBottom: '1px solid rgba(148,163,184,0.12)' }}>{matrixHours}h · T / F</th>
                          <th style={{ padding: '5px 7px', borderBottom: '1px solid rgba(148,163,184,0.12)' }}>{matrixHoursLong}h · T / F</th>
                        </tr></thead>
                        <tbody>{(info?.sessionStats?.sessions || []).map(session => {
                          const short = componentSessions[session.key]?.short;
                          const long = componentSessions[session.key]?.long;
                          const cell = value => value ? <><span style={{ color: percentColor(value.trend_percentile) }}>T {formatPercentile(value.trend_percentile)}</span><span style={{ color: percentColor(value.flow_percentile), marginLeft: '8px' }}>F {formatPercentile(value.flow_percentile)}</span></> : <span style={{ color: '#64748b' }}>—</span>;
                          return <tr key={session.key}>
                            <td style={{ padding: '6px 7px', color: '#cbd5e1', borderBottom: '1px solid rgba(148,163,184,0.08)' }}>{session.label}</td>
                            <td style={{ padding: '6px 7px', borderBottom: '1px solid rgba(148,163,184,0.08)', whiteSpace: 'nowrap' }}>{cell(short)}</td>
                            <td style={{ padding: '6px 7px', borderBottom: '1px solid rgba(148,163,184,0.08)', whiteSpace: 'nowrap' }}>{cell(long)}</td>
                          </tr>;
                        })}</tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
              <div style={{ color: '#64748b', fontSize: '10px' }}>T/F là phân vị động lượng có dấu trong từng phiên; thời lượng mẫu dùng cùng cấu hình Matrix.</div>
            </div>
          </section>

          <section style={cardStyle}>
            <h3 style={{ margin: '0 0 8px', color: '#c4b5fd', fontSize: '14px' }}>Xếp hạng xu hướng D‑VP</h3>
            {dvpRow ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(125px, 1fr))', gap: '10px' }}>
                <div><span style={{ color: '#94a3b8', fontSize: '11px' }}>Hạng trong nhóm</span><strong style={{ display: 'block', marginTop: '4px' }}>#{dvpRow.rank}/{info?.dvp?.rows?.length || '—'}</strong></div>
                <div><span style={{ color: '#94a3b8', fontSize: '11px' }}>Khoảng cách D‑VP TB</span><strong style={{ display: 'block', marginTop: '4px' }}>{dvpRow.gap_sd == null ? '—' : `${dvpRow.gap_sd.toFixed(3)} SD`}</strong></div>
                <div><span style={{ color: '#94a3b8', fontSize: '11px' }}>Phân vị Vol days</span><strong style={{ display: 'block', marginTop: '4px' }}>{dvpRow.percentile == null ? 'Chưa đủ mẫu' : `P${Number(dvpRow.percentile).toFixed(0)}`}</strong></div>
                <div><span style={{ color: '#94a3b8', fontSize: '11px' }}>Vị trí giá so với VWAP</span><strong style={{ display: 'block', marginTop: '4px', color: percentColor(dvpRow.close_vwap_sd) }}>{dvpRow.close_vwap_sd == null ? '—' : `${dvpRow.close_vwap_sd > 0 ? '+' : ''}${dvpRow.close_vwap_sd.toFixed(2)} SD`}</strong></div>
              </div>
            ) : <div style={{ color: '#94a3b8', fontSize: '12px' }}>Chưa có mẫu D‑VP cho tài sản này trong nhóm Matrix.</div>}
            <div style={{ color: '#64748b', fontSize: '10px', lineHeight: 1.5, marginTop: '9px' }}>Hạng được xếp theo phân vị khoảng trống D‑VP so với lịch sử của từng tài sản; khoảng trống lớn hơn biểu thị cấu trúc vùng thưa hơn.</div>
          </section>

          <section style={cardStyle}>
            <h3 style={{ margin: '0 0 8px', color: '#fcd34d', fontSize: '14px' }}>Spread so với biến động trung bình</h3>
            {spread ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px' }}>
                  <div><span style={{ color: '#94a3b8', fontSize: '11px' }}>Spread hiện tại</span><strong style={{ display: 'block', marginTop: '4px' }}>{formatPriceValue(info.spread.current.spread)}</strong></div>
                  <div><span style={{ color: '#94a3b8', fontSize: '11px' }}>Biến động TB M5 / 24h</span><strong style={{ display: 'block', marginTop: '4px' }}>{formatPriceValue(info.spread.current.average_range)}</strong></div>
                  <div><span style={{ color: '#94a3b8', fontSize: '11px' }}>Spread / biên độ TB</span><strong style={{ display: 'block', marginTop: '4px', color: '#fbbf24' }}>{Number(info.spread.current.spread_to_range_pct).toFixed(2)}%</strong></div>
                  <div><span style={{ color: '#94a3b8', fontSize: '11px' }}>So với nhóm cùng loại</span><strong style={{ display: 'block', marginTop: '4px', color: info.spread.assessment === 'cao' ? '#fb7185' : info.spread.assessment === 'thấp' ? '#4ade80' : '#fbbf24' }}>{info.spread.assessment ? `${info.spread.assessment} · P${info.spread.percentile}` : 'Chưa đủ dữ liệu'}{info.spread.relative_to_group_median != null ? ` · ${info.spread.relative_to_group_median.toFixed(2)}× trung vị` : ''}</strong></div>
                </div>
                <div style={{ color: '#64748b', fontSize: '10px', lineHeight: 1.5, marginTop: '9px' }}>So sánh các cặp FX có chung đồng tiền (hoặc cùng nhóm tài sản); biến động TB là High−Low trung bình của tối đa 288 nến M5 gần nhất (~24 giờ nến giao dịch).</div>
              </>
            ) : <div style={{ color: '#94a3b8', fontSize: '12px' }}>Chưa lấy được tick và nến để so sánh spread.</div>}
          </section>

          <section style={cardStyle}>
            <h3 style={{ margin: '0 0 8px', color: '#fcd34d', fontSize: '14px' }}>Spread trung bình theo phiên</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', minWidth: '440px' }}>
                <thead><tr style={{ color: '#94a3b8', textAlign: 'left' }}>
                  <th style={{ padding: '6px 7px', borderBottom: '1px solid rgba(148,163,184,0.12)' }}>Phiên</th>
                  <th style={{ padding: '6px 7px', borderBottom: '1px solid rgba(148,163,184,0.12)' }}>Spread TB</th>
                  <th style={{ padding: '6px 7px', borderBottom: '1px solid rgba(148,163,184,0.12)' }}>Spread / biên độ TB</th>
                  <th style={{ padding: '6px 7px', borderBottom: '1px solid rgba(148,163,184,0.12)' }}>So với nhóm</th>
                  <th style={{ padding: '6px 7px', borderBottom: '1px solid rgba(148,163,184,0.12)' }}>Số phiên</th>
                </tr></thead>
                <tbody>{(info?.sessionStats?.sessions || []).map(session => {
                  const value = getSessionSpread(session.key);
                  const comparison = getSessionSpreadComparison(session.key);
                  const assessmentColor = comparison?.assessment === 'cao' ? '#fb7185' : comparison?.assessment === 'thấp' ? '#4ade80' : '#fbbf24';
                  return <tr key={session.key}>
                    <td style={{ padding: '7px', color: '#cbd5e1', borderBottom: '1px solid rgba(148,163,184,0.08)' }}>{session.label}</td>
                    <td style={{ padding: '7px', color: '#f8fafc', borderBottom: '1px solid rgba(148,163,184,0.08)' }}>{value?.average_spread == null ? (value?.average_spread_points != null ? `${value.average_spread_points} điểm` : '—') : formatPriceValue(value.average_spread)}</td>
                    <td style={{ padding: '7px', color: '#fbbf24', borderBottom: '1px solid rgba(148,163,184,0.08)' }}>{value?.spread_to_range_pct == null ? '—' : `${Number(value.spread_to_range_pct).toFixed(2)}%`}</td>
                    <td title={comparison ? `So sánh với ${comparison.peerCount} mã cùng nhóm` : ''} style={{ padding: '7px', color: assessmentColor, borderBottom: '1px solid rgba(148,163,184,0.08)' }}>{comparison ? `P${comparison.percentile} · ${comparison.assessment}` : '—'}</td>
                    <td style={{ padding: '7px', color: '#94a3b8', borderBottom: '1px solid rgba(148,163,184,0.08)' }}>{value?.samples ?? '—'}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
            <div style={{ color: '#64748b', fontSize: '10px', lineHeight: 1.5, marginTop: '8px' }}>Trung bình từ nến M5 trong từng phiên của Vol days; spread được so với biên độ High−Low trung bình cùng phiên và xếp phân vị với nhóm tài sản tương ứng. Nếu broker không cung cấp spread lịch sử, mục đó sẽ hiện “—”.</div>
          </section>
        </div>
      </section>
    </div>
  );
}

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
    {name: "GOLD.i#", description: "Vàng (Gold)"},
    {name: "SILVER.i#", description: "Bạc (Silver)"},
    {name: "OILCash#", description: "Dầu thô (WTI Oil)"}
  ],
  "Tiền điện tử": [
    {name: "BTCUSD", description: "Bitcoin vs US Dollar"},
    {name: "ETHUSD", description: "Ethereum vs US Dollar"},
    {name: "SOLUSD", description: "Solana vs US Dollar"}
  ],
  "Chỉ số chứng khoán": [
    {name: "Nasdaq", description: "Nasdaq 100"},
    {name: "US500Cash#", description: "S&P 500"},
    {name: "US30Cash#", description: "Dow Jones 30"},
    {name: "US100", description: "Nasdaq 100 (Alternative)"}
  ]
};

const normalizeSymbolQuery = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[\s_./#-]/g, '');

const getQuickSymbolMatches = (query, symbols) => {
  const normalizedQuery = normalizeSymbolQuery(query);
  if (!normalizedQuery) return [];

  const syntheticSymbols = [
    { name: 'GLOBAL_INDEX', description: 'Thị trường chung · FX GI', aliases: 'global index thi truong chung fx gi' },
    { name: 'US_STOCKS_GI', description: 'Chỉ số Cổ phiếu Mỹ · US Stocks GI', aliases: 'us stocks stocks gi chi so co phieu my' },
    { name: 'COMMODITIES_GI', description: 'Chỉ số Hàng hóa · Commodities GI', aliases: 'commodities hang hoa chi so hang hoa' },
    { name: 'CRYPTO_GI', description: 'Chỉ số Tiền điện tử · Crypto GI', aliases: 'crypto tien dien tu chi so tien dien tu' },
  ];
  const listedSymbols = Object.entries(symbols || {}).flatMap(([group, items]) =>
    (Array.isArray(items) ? items : []).map(item => ({ ...item, group }))
  );
  const uniqueSymbols = new Map();
  [...syntheticSymbols, ...listedSymbols].forEach(item => {
    const name = String(item.name || '').trim();
    if (name && !uniqueSymbols.has(name.toUpperCase())) uniqueSymbols.set(name.toUpperCase(), { ...item, name });
  });

  return [...uniqueSymbols.values()]
    .map(item => {
      const normalizedName = normalizeSymbolQuery(item.name);
      const normalizedDescription = normalizeSymbolQuery(`${item.description || ''} ${item.aliases || ''}`);
      const rank = normalizedName === normalizedQuery ? 0
        : normalizedName.startsWith(normalizedQuery) ? 1
          : normalizedName.includes(normalizedQuery) ? 2
            : normalizedDescription.includes(normalizedQuery) ? 3 : Infinity;
      return { ...item, rank };
    })
    .filter(item => Number.isFinite(item.rank))
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
    .slice(0, 8);
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
  const [viewMode, setViewMode] = useState('chart'); // 'chart' hoặc 'matrix'

  useEffect(() => {
    const featureByShortcut = { '1': 'chart', '2': 'matrix', '3': 'backtest', '4': 'catalyst' };
    const handleFeatureShortcut = (event) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (
        target.isContentEditable
        || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
        || target.closest('[contenteditable="true"], [role="textbox"]')
      )) return;

      const nextView = featureByShortcut[event.key];
      if (!nextView) return;
      event.preventDefault();
      setViewMode(nextView);
    };

    window.addEventListener('keydown', handleFeatureShortcut, true);
    return () => window.removeEventListener('keydown', handleFeatureShortcut, true);
  }, []);

  const [chartType, setChartType] = useState(localStorage.getItem('chartType') || 'candles');
  const [chartTheme, setChartTheme] = useState(localStorage.getItem('chartTheme') || 'dark');
  const [showSdBands, setShowSdBands] = useState(localStorage.getItem('showSdBands') !== 'false');
  const [showMomFlipChart, setShowMomFlipChart] = useState(false);
  const [showVolChart, setShowVolChart] = useState(localStorage.getItem('showVolChart') !== 'false');
  const [showMomChart, setShowMomChart] = useState(localStorage.getItem('showMomChart') !== 'false');
  const [showMatrixBubble, setShowMatrixBubble] = useState(localStorage.getItem('showMatrixBubble') === 'true');
  const [bubbleSessionMatrix, setBubbleSessionMatrix] = useState(null);
  const [bubblePowerLong, setBubblePowerLong] = useState(null);
  const [bubblePowerShort, setBubblePowerShort] = useState(null);
  const [bubbleMatrixLoading, setBubbleMatrixLoading] = useState(false);
  const [bubbleMatrixError, setBubbleMatrixError] = useState('');
  const [bubbleDvpTrend, setBubbleDvpTrend] = useState(null);
  const [bubbleDvpTrendLoading, setBubbleDvpTrendLoading] = useState(false);
  const [bubbleDvpTrendError, setBubbleDvpTrendError] = useState('');

  
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
    preUsStart: "16:00",
    preUsEnd: "19:00",
    usStart: "07:30",
    usEnd: "11:00",
    autoDst: true,
    emailSender: '',
    emailPassword: '',
    emailReceiver: '',
  }));
  const [configsLoaded, setConfigsLoaded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isLogOpen, setIsLogOpen] = useState(false);
  const [isAssetInfoOpen, setIsAssetInfoOpen] = useState(false);
  const [assetSpread, setAssetSpread] = useState(null);
  const [availableSymbols, setAvailableSymbols] = useState(DEFAULT_SYMBOLS);
  const [quickSymbolQuery, setQuickSymbolQuery] = useState('');
  const [quickSymbolError, setQuickSymbolError] = useState('');
  const [quickSymbolActiveIndex, setQuickSymbolActiveIndex] = useState(0);
  const availableSymbolsRef = useRef(availableSymbols);
  const quickSymbolQueryRef = useRef('');
  const quickSymbolActiveIndexRef = useRef(0);
  availableSymbolsRef.current = availableSymbols;
  const quickSymbolMatches = getQuickSymbolMatches(quickSymbolQuery, availableSymbols);
  const quickSymbolMatchesRef = useRef(quickSymbolMatches);
  quickSymbolMatchesRef.current = quickSymbolMatches;

  useEffect(() => {
    const isEditableTarget = (target) => target instanceof HTMLElement && (
      target.isContentEditable
      || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      || target.closest('[contenteditable="true"], [role="textbox"]')
    );

    const clearQuickSearch = () => {
      quickSymbolQueryRef.current = '';
      quickSymbolActiveIndexRef.current = 0;
      setQuickSymbolQuery('');
      setQuickSymbolError('');
      setQuickSymbolActiveIndex(0);
    };

    const handleQuickSymbolKeyDown = (event) => {
      if (isEditableTarget(event.target) || event.isComposing) return;
      const query = quickSymbolQueryRef.current;

      if (event.key === 'Escape' && query) {
        event.preventDefault();
        event.stopPropagation();
        clearQuickSearch();
        return;
      }

      if (event.ctrlKey || event.altKey || event.metaKey) return;

      if (query && event.key === 'Backspace') {
        event.preventDefault();
        const nextQuery = query.slice(0, -1);
        quickSymbolQueryRef.current = nextQuery;
        quickSymbolActiveIndexRef.current = 0;
        setQuickSymbolQuery(nextQuery);
        setQuickSymbolError('');
        setQuickSymbolActiveIndex(0);
        return;
      }

      if (query && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        const matchCount = quickSymbolMatchesRef.current.length;
        if (matchCount) {
          const delta = event.key === 'ArrowDown' ? 1 : -1;
          const nextIndex = (quickSymbolActiveIndexRef.current + delta + matchCount) % matchCount;
          quickSymbolActiveIndexRef.current = nextIndex;
          setQuickSymbolActiveIndex(nextIndex);
        }
        return;
      }

      if (query && event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        const matches = getQuickSymbolMatches(query, availableSymbolsRef.current);
        const normalizedQuery = normalizeSymbolQuery(query);
        const exactMatch = matches.find(match => normalizeSymbolQuery(match.name) === normalizedQuery);
        const selectedMatch = exactMatch || matches[quickSymbolActiveIndexRef.current] || matches[0];
        if (!selectedMatch) {
          setQuickSymbolError(`Không tìm thấy mã “${query}”`);
          return;
        }
        setSymbol(selectedMatch.name);
        setViewMode('chart');
        setSearchSymbol('');
        clearQuickSearch();
        return;
      }

      if (event.key.length === 1 && /^[a-zA-Z0-9._/# -]$/.test(event.key)) {
        event.preventDefault();
        const nextQuery = query + event.key;
        quickSymbolQueryRef.current = nextQuery;
        quickSymbolActiveIndexRef.current = 0;
        setQuickSymbolQuery(nextQuery);
        setQuickSymbolError('');
        setQuickSymbolActiveIndex(0);
      }
    };

    window.addEventListener('keydown', handleQuickSymbolKeyDown, true);
    return () => window.removeEventListener('keydown', handleQuickSymbolKeyDown, true);
  }, []);

  const selectQuickSymbol = (match) => {
    setSymbol(match.name);
    setViewMode('chart');
    setSearchSymbol('');
    quickSymbolQueryRef.current = '';
    setQuickSymbolQuery('');
    setQuickSymbolError('');
    setQuickSymbolActiveIndex(0);
    quickSymbolActiveIndexRef.current = 0;
  };

  useEffect(() => {
    if (!showMatrixBubble) return;
    
    let isFetching = false;
    let pendingBacktestRefresh = false;
    let isDvpTrendFetching = false;
    let lastDvpTrendRequestAt = 0;
    let unlockTimer = null;
    const finishBubbleFetch = () => {
      if (viewMode !== 'backtest') {
        isFetching = false;
        setBubbleMatrixLoading(false);
        return;
      }
      unlockTimer = setTimeout(() => {
        unlockTimer = null;
        isFetching = false;
        if (pendingBacktestRefresh) {
          pendingBacktestRefresh = false;
          fetchBubbleMatrix();
        } else {
          setBubbleMatrixLoading(false);
        }
      }, 1000);
    };
    const fetchBubbleMatrix = () => {
      if (isFetching) {
        if (viewMode === 'backtest') pendingBacktestRefresh = true;
        return;
      }

      const matrixType = getMatrixTypeForSymbol(symbol);
      const sessionSettings = {
        asiaStart: configs.asiaStart || '07:00', asiaEnd: configs.asiaEnd || '11:00',
        euroStart: configs.euroStart || '07:00', euroEnd: configs.euroEnd || '09:00',
        preUsStart: configs.preUsStart || '16:00', preUsEnd: configs.preUsEnd || '19:00',
        usStart: configs.usStart || '07:30', usEnd: configs.usEnd || '11:00',
        autoDst: configs.autoDst ?? true,
        browserOffsetHours: -new Date().getTimezoneOffset() / 60
      };
      const params = {
        short_hours: Number(localStorage.getItem('currencyMatrixHours')) || configs.matrixHours || 24,
        long_hours: Number(localStorage.getItem('currencyMatrixHoursLong')) || 89,
        vol_days: configs.matrixVolDays || 30,
        matrix_type: matrixType,
        brokerTimezone: configs.brokerTimezone || 'Europe/Athens',
        ...sessionSettings
      };
      if (viewMode === 'backtest' && window.currentSimulatedTime) params.end_time = window.currentSimulatedTime;
      const shortHours = params.short_hours;
      const longHours = params.long_hours;
      const legacyParams = {
        vol_days: params.vol_days,
        matrix_type: matrixType,
        end_time: params.end_time || 0,
        brokerTimezone: params.brokerTimezone
      };

      if (!isDvpTrendFetching && Date.now() - lastDvpTrendRequestAt >= 60 * 1000) {
        isDvpTrendFetching = true;
        lastDvpTrendRequestAt = Date.now();
        setBubbleDvpTrendLoading(true);
        setBubbleDvpTrendError('');
        axios.get(`${API_BASE}/api/v1/matrix/dvp-trend`, {
          params: {
            ...legacyParams,
            dvp_lookback_days: configs.dvpLookbackDays,
            vwap_length: configs.vwapLength,
            vwap_mult: configs.vwapMult,
            pct1: configs.pct1,
            grid_mode: configs.gridMode,
            fixed_pips: configs.fixedPips,
            row_count: configs.rowCount,
            timeout_hours: configs.timeoutHours,
            force: false
          }
        }).then(response => {
          setBubbleDvpTrend(response.data);
        }).catch(error => {
          console.error('Error fetching bubble D-VP trend ranking:', error);
          setBubbleDvpTrendError('Không tải được BXH D-VP.');
        }).finally(() => {
          isDvpTrendFetching = false;
          setBubbleDvpTrendLoading(false);
        });
      }

      isFetching = true;
      setBubbleMatrixLoading(true);
      setBubbleMatrixError('');
      Promise.all([
        axios.get(`${API_BASE}/api/v1/matrix`, { params: { ...legacyParams, n_hours: shortHours, matrix_mode: 'money_flow' } }),
        axios.get(`${API_BASE}/api/v1/matrix`, { params: { ...legacyParams, n_hours: longHours, matrix_mode: 'money_flow' } }),
        axios.get(`${API_BASE}/api/v1/matrix`, { params: { ...legacyParams, n_hours: shortHours, matrix_mode: 'trend' } }),
        axios.get(`${API_BASE}/api/v1/matrix`, { params: { ...legacyParams, n_hours: longHours, matrix_mode: 'trend' } }),
        axios.get(`${API_BASE}/api/v1/matrix/session-stats`, { params })
      ]).then(([flowShort, flowLong, trendShort, trendLong, sessionStats]) => {
          setBubbleSessionMatrix(sessionStats.data);
          setBubblePowerLong(computeCompositeRanking(flowLong.data?.ranking, trendLong.data?.ranking));
          setBubblePowerShort(computeCompositeRanking(flowShort.data?.ranking, trendShort.data?.ranking));
          finishBubbleFetch();
      }).catch(err => {
          console.error(err);
          setBubbleMatrixError('Không cập nhật được Matrix; các số đang thấy là dữ liệu lần trước.');
          finishBubbleFetch();
      });
    };
    
    fetchBubbleMatrix();
    const interval = setInterval(fetchBubbleMatrix, 60000);
    
    window.addEventListener('simulatedTimeChanged', fetchBubbleMatrix);
    
    return () => {
      clearInterval(interval);
      if (unlockTimer) clearTimeout(unlockTimer);
      window.removeEventListener('simulatedTimeChanged', fetchBubbleMatrix);
    };
  }, [showMatrixBubble, viewMode, configs.brokerTimezone, configs.matrixHours, configs.matrixVolDays, configs.dvpLookbackDays, configs.vwapLength, configs.vwapMult, configs.pct1, configs.gridMode, configs.fixedPips, configs.rowCount, configs.timeoutHours, configs.asiaStart, configs.asiaEnd, configs.euroStart, configs.euroEnd, configs.preUsStart, configs.preUsEnd, configs.usStart, configs.usEnd, configs.autoDst, symbol]);

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
      .catch(err => console.error("Could not load configs from backend", err))
      .finally(() => setConfigsLoaded(true));
  }, []);

  useEffect(() => {
    if (!configsLoaded || !symbol) return undefined;
    const unsubscribe = subscribeAssetInfo(symbol, configs, () => {});
    const refreshIfStale = () => {
      const release = subscribeAssetInfo(symbol, configs, () => {});
      release();
    };
    const intervalId = setInterval(refreshIfStale, 60 * 1000);
    return () => {
      clearInterval(intervalId);
      unsubscribe();
    };
  }, [configsLoaded, symbol, configs]);

  useEffect(() => {
    if (!['chart', 'backtest'].includes(viewMode) || !symbol) {
      setAssetSpread(null);
      return undefined;
    }
    let active = true;
    const matrixType = getMatrixTypeForSymbol(symbol);
    const brokerTimezone = configs.brokerTimezone || 'Europe/Athens';
    setAssetSpread(null);
    const refreshSpread = () => {
      fetchAssetSpread(symbol, matrixType, brokerTimezone)
        .then(data => { if (active) setAssetSpread(data); })
        .catch(error => console.warn(`Could not load spread status for ${symbol}:`, error));
    };
    refreshSpread();
    const intervalId = setInterval(refreshSpread, 60 * 1000);
    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [symbol, viewMode, configs.brokerTimezone]);

  // Kích hoạt lại resize khi ẩn/hiện thanh công cụ để chart tự giãn cách
  useEffect(() => {
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 150);
    return () => clearTimeout(timer);
  }, [sidebarOpen]);



  return (
    <div className="dashboard-container">
      <TradingLogPanel isOpen={isLogOpen} onClose={() => setIsLogOpen(false)} apiBase={API_BASE} />
      {isAssetInfoOpen && ['chart', 'backtest'].includes(viewMode) && (
        <AssetInfoModal symbol={symbol} timeframe={timeframe} configs={configs} viewMode={viewMode} onClose={() => setIsAssetInfoOpen(false)} />
      )}

      {quickSymbolQuery && (
        <div role="dialog" aria-label="Tìm nhanh tài sản" style={{ position: 'fixed', top: '72px', left: '50%', transform: 'translateX(-50%)', width: 'min(460px, calc(100vw - 28px))', zIndex: 10002, padding: '12px', borderRadius: '12px', background: 'rgba(2,6,18,0.97)', border: '1px solid rgba(0,240,255,0.55)', boxShadow: '0 12px 36px rgba(0,0,0,0.65), 0 0 22px rgba(0,240,255,0.16)', color: '#e0f2fe', fontFamily: 'monospace' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '9px' }}>
            <strong style={{ color: '#67e8f9', fontSize: '12px' }}>TÌM NHANH TÀI SẢN</strong>
            <span style={{ color: '#64748b', fontSize: '10px' }}>Enter mở · Esc đóng</span>
          </div>
          <div style={{ padding: '9px 10px', borderRadius: '7px', background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(0,240,255,0.25)', color: '#f8fafc', fontSize: '18px', fontWeight: 700, letterSpacing: '1px', minHeight: '40px' }}>
            {quickSymbolQuery.toUpperCase()}
            <span aria-hidden="true" style={{ display: 'inline-block', width: '1px', height: '17px', marginLeft: '3px', verticalAlign: 'middle', background: '#00f0ff' }} />
          </div>
          {quickSymbolMatches.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '8px', maxHeight: '300px', overflowY: 'auto' }}>
              {quickSymbolMatches.map((match, index) => (
                <button
                  key={match.name}
                  type="button"
                  onClick={() => selectQuickSymbol(match)}
                  onMouseEnter={() => { quickSymbolActiveIndexRef.current = index; setQuickSymbolActiveIndex(index); }}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '14px', width: '100%', padding: '8px 9px', textAlign: 'left', border: `1px solid ${index === quickSymbolActiveIndex ? 'rgba(0,240,255,0.5)' : 'transparent'}`, borderRadius: '6px', background: index === quickSymbolActiveIndex ? 'rgba(8,145,178,0.2)' : 'transparent', color: '#e2e8f0', cursor: 'pointer' }}
                >
                  <span style={{ color: '#67e8f9', fontWeight: 700, whiteSpace: 'nowrap' }}>{match.name}</span>
                  <span style={{ color: '#94a3b8', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{match.description}{match.group ? ` · ${match.group}` : ''}</span>
                </button>
              ))}
            </div>
          ) : (
            <div style={{ padding: '10px 3px 3px', color: quickSymbolError ? '#fca5a5' : '#94a3b8', fontSize: '11px' }}>
              {quickSymbolError || 'Không tìm thấy mã phù hợp'}
            </div>
          )}
        </div>
      )}

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
        bubbleSessionMatrix={bubbleSessionMatrix}
        bubblePowerLong={bubblePowerLong}
        bubblePowerShort={bubblePowerShort}
        bubbleMatrixLoading={bubbleMatrixLoading}
        bubbleMatrixError={bubbleMatrixError}
        bubbleDvpTrend={bubbleDvpTrend}
        bubbleDvpTrendLoading={bubbleDvpTrendLoading}
        bubbleDvpTrendError={bubbleDvpTrendError}
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
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Cặp tiền tệ (Symbol)</label>
            <input
              type="text"
              placeholder="Tìm mã... (hoặc gõ ở bất kỳ đâu rồi Enter)"
              value={searchSymbol}
              onChange={(e) => setSearchSymbol(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const searchStr = searchSymbol.trim().toLowerCase();
                  if (!searchStr) return;
                  
                  let matchedSymbol = null;
                  
                  if ("thị trường chung fx gi global_index".includes(searchStr)) matchedSymbol = "GLOBAL_INDEX";
                  else if ("us stocks us_stocks_gi".includes(searchStr)) matchedSymbol = "US_STOCKS_GI";
                  else if ("hàng hóa commodities commodities_gi".includes(searchStr)) matchedSymbol = "COMMODITIES_GI";
                  else if ("tiền điện tử crypto crypto_gi".includes(searchStr)) matchedSymbol = "CRYPTO_GI";
                  
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
              <optgroup label="Chỉ số Tổng hợp">
                <option value="GLOBAL_INDEX">Thị trường chung (FX GI)</option>
                <option value="US_STOCKS_GI">Chỉ số Cổ phiếu Mỹ (US Stocks GI)</option>
                <option value="COMMODITIES_GI">Chỉ số Hàng hóa (Commodities GI)</option>
                <option value="CRYPTO_GI">Chỉ số Tiền điện tử (Crypto GI)</option>
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
                <optgroup label="Đang tải danh sách...">
                  <option value="EURUSD">EURUSD</option>
                </optgroup>
              )}
            </select>
          </div>
          
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Khung thời gian (Timeframe)</label>
            <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)} style={{ width: '100%' }}>
              <option value="M1">1 Minute</option>
              <option value="M3">3 Minutes</option>
              <option value="M5">5 Minutes</option>
              <option value="M15">15 Minutes</option>
              <option value="M30">30 Minutes</option>
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
          
          <div style={{ marginTop: '15px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Màu nền biểu đồ (Theme)</label>
            <select value={chartTheme} onChange={(e) => {
              setChartTheme(e.target.value);
              localStorage.setItem('chartTheme', e.target.value);
            }} style={{ width: '100%' }}>
              <option value="dark">Tối (Mặc định)</option>
              <option value="sunset">Hoàng Hôn (Sunset)</option>
              <option value="night">Thành phố (Night)</option>
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
            <button 
              onClick={() => setViewMode('strategy')}
              style={{ width: '100%', marginBottom: '10px', textAlign: 'left', background: viewMode === 'strategy' ? 'rgba(59, 130, 246, 0.2)' : '' }}
            >
              🛠 Strategy Builder
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
                style={{ padding: '6px', borderRadius: '4px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', color: 'white', maxWidth: '170px', fontSize: '0.8rem' }}
              >
                <option value="price">Giá</option>
                <option value="mom">% TKH</option>
              </select>
              <input 
                type="number" 
                placeholder={newAlertType === 'price' ? "Giá" : "% TKH"}
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
              <label style={{ display: 'flex', alignItems: 'center', fontSize: '0.8rem', color: '#94a3b8', gap: '4px' }}>
                <input type="checkbox" checked={newAlertBarCloseOnly} onChange={e => setNewAlertBarCloseOnly(e.target.checked)} /> Đóng nến
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
                      <span style={{ margin: '0 5px', fontSize: '0.75rem', color: '#94a3b8' }}>{a.type === 'mom' ? 'Bùng nổ' : '@'}</span>
                      <span style={{ marginLeft: '2px', color: '#4ade80' }}>{a.type === 'mom' ? a.price + '%' : a.price}</span>
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
            {viewMode === 'chart' || viewMode === 'backtest' ? (
              <>
                <span
                  title={assetSpread?.assessment
                    ? `Spread ${assetSpread.assessment}: ${Number(assetSpread.current?.spread_to_range_pct || 0).toFixed(2)}% biên độ M5 trung bình · tick hiện tại`
                    : 'Đang tải mức spread so với biến động trung bình'}
                  style={{ color: assetSpread?.assessment === 'cao' ? '#fb7185' : assetSpread?.assessment === 'thấp' ? '#4ade80' : assetSpread?.assessment === 'trung bình' ? '#fbbf24' : 'var(--text-primary)', transition: 'color 250ms ease' }}
                >{symbol}</span>
                <span>• {timeframe}{viewMode === 'backtest' ? ' (Backtest Mode)' : ''}</span>
                <button
                  type="button"
                  onClick={() => setIsAssetInfoOpen(true)}
                  title={`Thông tin ${symbol}`}
                  aria-label={`Thông tin ${symbol}`}
                  style={{ width: '23px', height: '23px', padding: 0, borderRadius: '50%', border: '1px solid rgba(103,232,249,0.65)', background: 'rgba(8,47,73,0.48)', color: '#67e8f9', cursor: 'pointer', fontSize: '13px', fontWeight: 800, lineHeight: '21px' }}
                >i</button>
              </>
            ) : viewMode === 'catalyst' ? 'Lịch Tin tức Catalyst' : viewMode === 'strategy' ? 'Strategy Builder' : 'Currency Strength Matrix'}
          </div>
          <div className="toolbar">
              <button onClick={() => setIsLogOpen(true)} className="primary" style={{ boxShadow: '0 0 10px rgba(0,240,255,0.4)', border: '1px solid #00f0ff' }}>[SYS.LOG]</button>
            
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
                sessionSettings={configs}
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














