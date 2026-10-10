import re

with open("frontend/src/App.jsx", "r", encoding="utf-8") as f:
    content = f.read()

target1 = """              if (projectedVolSeriesRef.current && !isPolling) {
                projectedVolSeriesRef.current.setData(projectedNormVol.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
              }"""
replacement1 = """              if (projectedVolSeriesRef.current) {
                if (!isPolling) projectedVolSeriesRef.current.setData(projectedNormVol.filter(d => d && Number.isFinite(d.value) && Number.isFinite(d.time)));
                else projectedVolSeriesRef.current.setData([]);
              }"""

target2 = """            if (res.data.data.vp_boxes && res.data.data.vp_boxes.length > 0) {
              setVpBoxes(res.data.data.vp_boxes);
            }"""
replacement2 = """            if (res.data.data.vp_boxes && res.data.data.vp_boxes.length > 0) {
              setVpBoxes(res.data.data.vp_boxes);
            } else if (isPolling) {
              setVpBoxes([]);
            }"""

if target1 in content:
    content = content.replace(target1, replacement1)
    print("Replaced target1")
else:
    print("Target1 not found")

if target2 in content:
    content = content.replace(target2, replacement2)
    print("Replaced target2")
else:
    print("Target2 not found")

with open("frontend/src/App.jsx", "w", encoding="utf-8") as f:
    f.write(content)
