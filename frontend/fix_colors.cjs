const fs = require('fs');
const file_path = 'src/App.jsx';
let text = fs.readFileSync(file_path, 'utf8');

text = text.replace(
    'if (index > 0) {\n              if (item.vwap >= arr[index - 1].vwap) col = \'#39ff14\';\n              else col = \'#ff073a\';\n            } else if (lastVwapColorRef.current !== null) {',
    'if (index < arr.length - 1) {\n              if (arr[index + 1].vwap >= item.vwap) col = \'#39ff14\';\n              else col = \'#ff073a\';\n            } else if (lastVwapColorRef.current !== null) {'
);

text = text.replace(
    'if (index > 0) {\n            if (i.mom_ma >= arr[index - 1].mom_ma) col = "rgba(0, 255, 0, 1)"; // Lên màu xanh lá\n            else col = "rgba(255, 0, 0, 1)"; // Xuống màu đỏ\n          } else if (lastMomMaColorRef.current !== null) {',
    'if (index < arr.length - 1) {\n            if (arr[index + 1].mom_ma >= i.mom_ma) col = "rgba(0, 255, 0, 1)";\n            else col = "rgba(255, 0, 0, 1)";\n          } else if (lastMomMaColorRef.current !== null) {'
);

text = text.replace(
    'if (index > 0) {\n            if (i.ma_vol >= arr[index - 1].ma_vol) col = "rgba(0, 255, 255, 1)";\n            else col = "rgba(255, 0, 255, 1)";\n          } else if (lastMaVolColorRef.current !== null) {',
    'if (index < arr.length - 1) {\n            if (arr[index + 1].ma_vol >= i.ma_vol) col = "rgba(0, 255, 255, 1)";\n            else col = "rgba(255, 0, 255, 1)";\n          } else if (lastMaVolColorRef.current !== null) {'
);

text = text.replace(
    'if (index > 0 || lastHl2ColorRef.current === null) {\n            if (index > 0) {\n              if (item.hl2 >= arr[index - 1].hl2) col = "rgba(0, 255, 0, 1)";\n              else col = "rgba(255, 0, 0, 1)";\n            }\n          } else {\n            col = lastHl2ColorRef.current;\n          }',
    'if (index < arr.length - 1) {\n            if (arr[index + 1].hl2 >= item.hl2) col = "rgba(0, 255, 0, 1)";\n            else col = "rgba(255, 0, 0, 1)";\n          } else {\n            col = lastHl2ColorRef.current !== null ? lastHl2ColorRef.current : "rgba(128, 128, 128, 0.8)";\n          }'
);

fs.writeFileSync(file_path, text);
console.log('Success');
