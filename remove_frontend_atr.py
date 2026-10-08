import re

with open("frontend/src/App.jsx", "r", encoding="utf-8") as f:
    content = f.read()

# 1. Remove momLength from UI inputs
pattern_ui = r'\s*<label style=\{styleLabel\}>Chu kỳ Động lượng \(momLength\)</label>\s*<input type="number" value=\{local\.momLength\} onChange=\{e => handleChange\(\'momLength\', Number\(e\.target\.value\)\)\} style=\{styleInput\} />\s*'
content = re.sub(pattern_ui, '\n', content)

# 2. Remove momLength from default configs
content = re.sub(r'\s*momLength:\s*20,', '', content)

# 3. Remove momLength from params in fetchData
content = re.sub(r'momLength=\$\{config\.momLength\}&', '', content)

# 4. Remove mom_ma plotting logic
# Locate the mom_ma drawing code and remove it
pattern_mom_ma_1 = r'\s*const sortedRawForMomMa\s*=\s*rawData.*?if\s*\(momMaData\.length\s*>\s*0\)\s*lastMomMaColorRef\.current\s*=\s*momMaData\[momMaData\.length\s*-\s*1\]\.color;'
content = re.sub(pattern_mom_ma_1, '', content, flags=re.DOTALL)

pattern_mom_ma_2 = r'\s*momMaSeriesRef\.current\.setData\(momMaData\);'
content = re.sub(pattern_mom_ma_2, '', content)

# 5. Remove momMaSeriesRef creation
pattern_mom_ma_3 = r'\s*const momMaSeries\s*=\s*chart\.addLineSeries\(\{\s*color:\s*\'rgba\(0,\s*255,\s*0,\s*1\)\',\s*lineWidth:\s*2,\s*priceScaleId:\s*\'mom\',\s*crosshairMarkerVisible:\s*false\s*\}\);\s*momMaSeriesRef\.current\s*=\s*momMaSeries;'
content = re.sub(pattern_mom_ma_3, '', content, flags=re.DOTALL)

# 6. Remove momMaSeriesRef declaration
content = re.sub(r'\s*const momMaSeriesRef = useRef\(null\);', '', content)

# 7. Remove momMaSeriesRef updating
content = re.sub(r'\s*if\s*\(momMaSeriesRef\.current\)\s*momMaSeriesRef\.current\.update\(\{.*?\}\);', '', content, flags=re.DOTALL)

# 8. Wait, is momMaData updated in handleNewTick?
pattern_tick = r'\s*if\s*\(momMaSeriesRef\.current\s*&&\s*lastTickRef\.current\.mom_ma\s*!==\s*undefined\).*?momMaSeriesRef\.current\.update\(\{ time: t, value: lastTickRef\.current\.mom_ma, color: col_ma \}\);\s*\}'
content = re.sub(pattern_tick, '', content, flags=re.DOTALL)


with open("frontend/src/App.jsx", "w", encoding="utf-8") as f:
    f.write(content)
print("Updated frontend/src/App.jsx")
