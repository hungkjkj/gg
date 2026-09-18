import sys
import re

file_path = 'frontend/src/App.jsx'
with open(file_path, 'r', encoding='utf-8') as f:
    text = f.read()

start_idx = text.find('        // Format n')
end_idx = text.find('            const totalCandles = formattedData.length;')

if start_idx == -1 or end_idx == -1:
    print('Failed to find block')
    sys.exit(1)

block = text[start_idx:end_idx]
block = block.replace('if (formattedData.length > 300) {', 'if (formattedData.length > 300 && !isBackground) {')

func_wrapper = """        const processAndDrawRawData = async (rawData, isBackground = false) => {
""" + block + """            
            const totalCandles = formattedData.length;
            
            if (savedTimeRangeRef.current) {
                try {
                    chartRef.current.timeScale().setVisibleRange(savedTimeRangeRef.current);
                    if (momentumChartRef.current) momentumChartRef.current.timeScale().setVisibleRange(savedTimeRangeRef.current);
                    if (volumeChartRef.current) volumeChartRef.current.timeScale().setVisibleRange(savedTimeRangeRef.current);
                    
                    const logical = chartRef.current.timeScale().getVisibleLogicalRange();
                    if (!logical || logical.from >= totalCandles || logical.to < 0 || Math.floor(logical.to) < Math.ceil(logical.from)) {
                        throw new Error("Out of bounds");
                    }
                } catch (e) {
                    const visibleBars = 50;
                    const halfBars = Math.floor(visibleBars / 2);
                    const startLogical = Math.max(0, totalCandles - 1 - halfBars);
                    const endLogical = totalCandles - 1 + halfBars;
                    const range = { from: startLogical, to: endLogical };

                    chartRef.current.timeScale().setVisibleLogicalRange(range);
                    if (momentumChartRef.current) momentumChartRef.current.timeScale().setVisibleLogicalRange(range);
                    if (volumeChartRef.current) volumeChartRef.current.timeScale().setVisibleLogicalRange(range);
                }
            } else {
                const visibleBars = 50;
                const halfBars = Math.floor(visibleBars / 2);
                const startLogical = Math.max(0, totalCandles - 1 - halfBars);
                const endLogical = totalCandles - 1 + halfBars;
                const range = { from: startLogical, to: endLogical };

                chartRef.current.timeScale().setVisibleLogicalRange(range);
                if (momentumChartRef.current) momentumChartRef.current.timeScale().setVisibleLogicalRange(range);
                if (volumeChartRef.current) volumeChartRef.current.timeScale().setVisibleLogicalRange(range);
            }
            
            if (formattedData.length === 0 && !isBackground) {
                candlestickSeriesRef.current.setData([]);
                if (vwapSeriesRef.current) vwapSeriesRef.current.setData([]);
                if (momentumSeriesRef.current) momentumSeriesRef.current.setData([]);
                if (normVolSeriesRef.current) normVolSeriesRef.current.setData([]);
                if (momMaSeriesRef.current) momMaSeriesRef.current.setData([]);
                if (maVolSeriesRef.current) maVolSeriesRef.current.setData([]);
                setVpBoxes([]);
                setVolStats(null);
            }
        };
"""

fetch_start = text.find('const rawData = response.data;')
fetch_end = text.find('      } finally {')

if fetch_start == -1 or fetch_end == -1:
    print('Failed to find fetch block')
    sys.exit(1)

new_fetch_logic = """const rawData = response.data;
        
        if (!isPolling) {
            window.chartDataCache = window.chartDataCache || {};
            window.chartDataCache[cacheKey] = rawData;
            const keys = Object.keys(window.chartDataCache);
            if (keys.length > 20) delete window.chartDataCache[keys[0]];
        }
        
        // Neu da co cache (va da ve tu truoc), lan nay ve duoi background de ko reset vung nhin
        let isBg = false;
        if (!isPolling && window.chartDataCache && window.chartDataCache[cacheKey]) {
            isBg = true;
        } else if (isPolling) {
            isBg = true;
        }
        
        await processAndDrawRawData(rawData, isBg);
"""

text = text[:start_idx] + text[fetch_end:]
text = text.replace('  const fetchData = async', func_wrapper + '\n  const fetchData = async')
fetch_start2 = text.find('const rawData = response.data;')
text = text[:fetch_start2] + new_fetch_logic + text[text.find('      } finally {'):]

cache_logic = """    const cacheKey = `${symbol}_${timeframe}`;
    
    try {
      if (!isPolling) {
        setLoading(true);
        loadingRef.current = true;
        
        if (window.chartDataCache && window.chartDataCache[cacheKey]) {
            await processAndDrawRawData(window.chartDataCache[cacheKey], false);
        } else if (candlestickSeriesRef.current) {
"""
text = text.replace('    try {\n      if (!isPolling && candlestickSeriesRef.current) {\n        candlestickSeriesRef.current.setData([]);', cache_logic + '        candlestickSeriesRef.current.setData([]);\n')
text = text.replace('    try {\r\n      if (!isPolling && candlestickSeriesRef.current) {\r\n        candlestickSeriesRef.current.setData([]);', cache_logic + '        candlestickSeriesRef.current.setData([]);\r\n')

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(text)
print('Done!')
