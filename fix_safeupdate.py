import re

with open("frontend/src/App.jsx", "r", encoding="utf-8") as f:
    content = f.read()

target = """          if (candlestickSeriesRef.current && chartRef.current) {
            if (isPolling) {
              const safeUpdate = (series, d) => {
                if (d.time >= lastUpdateTimeRef.current) {"""
                
replacement = """          if (candlestickSeriesRef.current && chartRef.current) {
            const oldLastTime = lastUpdateTimeRef.current || 0;
            if (isPolling) {
              const safeUpdate = (series, d) => {
                if (d.time >= oldLastTime) {"""

if target in content:
    content = content.replace(target, replacement)
    print("Replaced!")
else:
    print("Not found! Trying regex...")
    # Just in case whitespace is slightly different
    pattern = r"if \(\s*candlestickSeriesRef\.current\s*&&\s*chartRef\.current\s*\)\s*\{\s*if\s*\(\s*isPolling\s*\)\s*\{\s*const\s*safeUpdate\s*=\s*\(\s*series,\s*d\s*\)\s*=>\s*\{\s*if\s*\(\s*d\.time\s*>=\s*lastUpdateTimeRef\.current\s*\)\s*\{"
    match = re.search(pattern, content)
    if match:
        content = content.replace(match.group(0), replacement)
        print("Replaced via regex!")
    else:
        print("Still not found!")

with open("frontend/src/App.jsx", "w", encoding="utf-8") as f:
    f.write(content)
