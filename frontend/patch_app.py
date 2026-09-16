import re

with open('src/App.jsx', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Replace SettingsModal
new_modal = """const SettingsModal = ({ configs, setConfigs, onClose }) => {
  const [local, setLocal] = useState({ ...configs });

  const handleChange = (key, val) => setLocal({ ...local, [key]: val });

  const handleSave = () => {
    Object.keys(local).forEach(k => localStorage.setItem(k, local[k]));
    setConfigs(local);
    onClose();
  };

  const styleGroup = { marginBottom: '15px', background: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: '8px' };
  const styleLabel = { display: 'block', marginBottom: '8px', fontSize: '0.9rem', color: '#94a3b8' };
  const styleInput = { width: '100%', padding: '8px', borderRadius: '4px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', color: 'white' };

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div style={{ background: 'var(--bg-panel)', padding: '20px', borderRadius: '12px', width: '400px', color: 'var(--text-primary)', boxShadow: '0 4px 20px rgba(0,0,0,0.5)', maxHeight: '90vh', overflowY: 'auto' }}>
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
              <input type="number" step="1" value={local.fixedPips} onChange={e => handleChange('fixedPips', Number(e.target.value))} style={styleInput} />
            </div>
          )}
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Số giờ Timeout để Reset</label>
            <input type="number" step="0.5" value={local.timeoutHours} onChange={e => handleChange('timeoutHours', Number(e.target.value))} style={styleInput} />
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
            <label style={styleLabel}>Chu kỳ Phân phối (momLookback)</label>
            <input type="number" value={local.momLookback} onChange={e => handleChange('momLookback', Number(e.target.value))} style={styleInput} />
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
        </details>

        <details style={styleGroup}>
          <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#a78bfa' }}>Chỉ báo Khối lượng (Volume)</summary>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Chu kỳ Phân phối (volLookback)</label>
            <input type="number" value={local.volLookback} onChange={e => handleChange('volLookback', Number(e.target.value))} style={styleInput} />
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Chu kỳ MA Volume</label>
            <input type="number" value={local.maVolLength} onChange={e => handleChange('maVolLength', Number(e.target.value))} style={styleInput} />
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Xác suất Tím (volPct1)</label>
            <input type="number" value={local.volPct1} onChange={e => handleChange('volPct1', Number(e.target.value))} style={styleInput} />
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Xác suất Đỏ (volPct2)</label>
            <input type="number" value={local.volPct2} onChange={e => handleChange('volPct2', Number(e.target.value))} style={styleInput} />
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Xác suất Cam (volPct3)</label>
            <input type="number" value={local.volPct3} onChange={e => handleChange('volPct3', Number(e.target.value))} style={styleInput} />
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={styleLabel}>Xác suất Xanh (volPct4)</label>
            <input type="number" value={local.volPct4} onChange={e => handleChange('volPct4', Number(e.target.value))} style={styleInput} />
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
"""

start_idx = text.find('const SettingsModal = ({')
end_idx = text.find('function App() {')
if start_idx != -1 and end_idx != -1:
    text = text[:start_idx] + new_modal + text[end_idx:]

# 2. Update states in App()
app_states_pattern = r"  const \[pct1, setPct1.*?const \[showSettings, setShowSettings\] = useState\(false\);"
new_states = """  const [configs, setConfigs] = useState(() => ({
    pct1: Number(localStorage.getItem('pct1')) || 70,
    pct2: Number(localStorage.getItem('pct2')) || 85,
    gridMode: localStorage.getItem('gridMode') || 'auto',
    fixedPips: Number(localStorage.getItem('fixedPips')) || 10.0,
    rowCount: Number(localStorage.getItem('rowCount')) || 50,
    timeoutHours: Number(localStorage.getItem('timeoutHours')) || 1.0,
    vwapLength: Number(localStorage.getItem('vwapLength')) || 89,
    vwapMult: Number(localStorage.getItem('vwapMult')) || 2.0,
    momLength: Number(localStorage.getItem('momLength')) || 20,
    momLookback: Number(localStorage.getItem('momLookback')) || 720,
    momPct1: Number(localStorage.getItem('momPct1')) || 85.0,
    momPct2: Number(localStorage.getItem('momPct2')) || 75.0,
    momPct3: Number(localStorage.getItem('momPct3')) || 50.0,
    volLookback: Number(localStorage.getItem('volLookback')) || 720,
    maVolLength: Number(localStorage.getItem('maVolLength')) || 2,
    volPct1: Number(localStorage.getItem('volPct1')) || 85.0,
    volPct2: Number(localStorage.getItem('volPct2')) || 75.0,
    volPct3: Number(localStorage.getItem('volPct3')) || 50.0,
    volPct4: Number(localStorage.getItem('volPct4')) || 15.0
  }));
  const [showSettings, setShowSettings] = useState(false);"""
text = re.sub(app_states_pattern, new_states, text, flags=re.DOTALL)

# 3. Update SettingsModal props in App render
modal_render_pattern = r"<SettingsModal[^>]+onClose=\{.*?\} \n\s+/>"
new_modal_render = """<SettingsModal 
          configs={configs} 
          setConfigs={setConfigs} 
          onClose={() => setShowSettings(false)} 
        />"""
text = re.sub(r'<SettingsModal.*?onClose=\{.*?\} \n\s*/>', new_modal_render, text, flags=re.DOTALL)

# 4. Update axios GET call
axios_pattern = r"params: \{ symbol, timeframe, count: 10000, [^}]+\}"
text = re.sub(axios_pattern, "params: { symbol, timeframe, count: 10000, ...configs }", text)

# 5. Update useEffect dependencies
effect_deps_pattern = r"\[symbol, timeframe, pct1, pct2, gridMode, fixedPips, rowCount, timeoutHours, momLength\]"
text = text.replace(effect_deps_pattern, "[symbol, timeframe, configs]")

with open('src/App.jsx', 'w', encoding='utf-8') as f:
    f.write(text)
