import React, { useState, useEffect } from 'react';
import axios from 'axios';

const conditionTypes = [
  { id: 'touch_dvp', label: 'Giá chạm D-VP' },
  { id: 'exit_dvp', label: 'Giá thoát D-VP' },
  { id: 'mf_touch_dvp', label: 'Money Flow chạm D-VP' },
  { id: 'mf_exit_dvp', label: 'Money Flow thoát D-VP' },
  { id: 'mom_lt', label: 'Động lượng (Mom) <= X %', hasValue: true },
  { id: 'mom_gt', label: 'Động lượng (Mom) >= X %', hasValue: true },
  { id: 'mom_flip_gt', label: 'Mom Flip >= X %', hasValue: true },
  { id: 'mom_flip_lt', label: 'Mom Flip <= X %', hasValue: true },
  { id: 'rvol_gt', label: 'RVol >= X', hasValue: true }
];

const StrategyBuilderTab = ({ symbol: currentSymbol, timeframe: currentTimeframe, configs }) => {
  const [strategies, setStrategies] = useState([]);
  
  const [newSymbol, setNewSymbol] = useState(currentSymbol);
  const [newTimeframe, setNewTimeframe] = useState(currentTimeframe);
  const [expirationHours, setExpirationHours] = useState(24);
  const [steps, setSteps] = useState([]);
  
  useEffect(() => {
    fetchStrategies();
  }, []);

  const fetchStrategies = async () => {
    try {
      const res = await axios.get('http://localhost:8000/api/v1/strategies');
      setStrategies(res.data);
    } catch (e) {
      console.error(e);
    }
  };

  const handleAddStep = () => {
    setSteps([...steps, { type: 'touch_dvp', value: '' }]);
  };

  const handleUpdateStep = (index, field, val) => {
    const updated = [...steps];
    updated[index][field] = val;
    setSteps(updated);
  };

  const handleRemoveStep = (index) => {
    setSteps(steps.filter((_, i) => i !== index));
  };

  const handleSaveStrategy = async () => {
    if (steps.length === 0) return alert('Hãy thêm ít nhất 1 bước');
    
    const newStrat = {
      id: Date.now().toString(),
      symbol: newSymbol,
      timeframe: newTimeframe,
      steps: steps,
      expiration_hours: expirationHours,
      current_step_index: 0,
      status: 'active',
      configs: configs
    };

    try {
      await axios.post('http://localhost:8000/api/v1/strategies', newStrat);
      setSteps([]);
      fetchStrategies();
    } catch (e) {
      console.error(e);
      alert('Lỗi lưu chiến lược');
    }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`http://localhost:8000/api/v1/strategies/${id}`);
      fetchStrategies();
    } catch (e) {
      console.error(e);
    }
  };

  const handleReset = async (id) => {
    try {
      await axios.put(`http://localhost:8000/api/v1/strategies/${id}/reset`);
      fetchStrategies();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div style={{ padding: '20px', color: 'var(--text-primary)', overflowY: 'auto', height: '100%' }}>
      <h2 style={{ marginBottom: '20px', color: '#60a5fa' }}>🛠 Xây dựng Chiến lược Giao dịch (Strategy Builder)</h2>
      
      <div style={{ background: 'rgba(0,0,0,0.2)', padding: '15px', borderRadius: '8px', marginBottom: '20px', border: '1px solid var(--border-color)' }}>
        <h3 style={{ marginBottom: '15px', fontSize: '1rem' }}>Thêm Chiến Lược Mới</h3>
        
        <div style={{ display: 'flex', gap: '15px', marginBottom: '15px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '5px' }}>Tài sản (Symbol)</label>
            <input type="text" value={newSymbol} onChange={e => setNewSymbol(e.target.value)} style={{ padding: '8px', borderRadius: '4px', background: 'rgba(255,255,255,0.05)', color: 'white', border: '1px solid var(--border-color)', width: '120px' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '5px' }}>Khung giờ (TF)</label>
            <select value={newTimeframe} onChange={e => setNewTimeframe(e.target.value)} style={{ padding: '8px', borderRadius: '4px', background: 'rgba(255,255,255,0.05)', color: 'white', border: '1px solid var(--border-color)', width: '80px' }}>
              <option value="M1">M1</option>
              <option value="M5">M5</option>
              <option value="M15">M15</option>
              <option value="M30">M30</option>
              <option value="H1">H1</option>
              <option value="H4">H4</option>
              <option value="D1">D1</option>
              <option value="W1">W1</option>
              <option value="MN1">MN1</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '5px' }}>Thời gian chờ tối đa (Giờ)</label>
            <input type="number" value={expirationHours} onChange={e => setExpirationHours(Number(e.target.value))} style={{ padding: '8px', borderRadius: '4px', background: 'rgba(255,255,255,0.05)', color: 'white', border: '1px solid var(--border-color)', width: '150px' }} />
          </div>
        </div>

        <div style={{ marginBottom: '15px' }}>
          <h4 style={{ fontSize: '0.9rem', marginBottom: '10px' }}>Trình tự các bước (Kéo thả/Thêm mới):</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {steps.map((step, idx) => {
              const typeDef = conditionTypes.find(c => c.id === step.type);
              return (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(59, 130, 246, 0.1)', padding: '10px', borderRadius: '6px', border: '1px dashed #3b82f6' }}>
                  <div style={{ background: '#3b82f6', color: 'white', borderRadius: '50%', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 'bold' }}>
                    {idx + 1}
                  </div>
                  <select 
                    value={step.type} 
                    onChange={e => handleUpdateStep(idx, 'type', e.target.value)}
                    style={{ padding: '8px', borderRadius: '4px', background: 'rgba(0,0,0,0.5)', color: 'white', border: '1px solid var(--border-color)' }}
                  >
                    {conditionTypes.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                  
                  {typeDef?.hasValue && (
                    <input 
                      type="number" 
                      placeholder="Giá trị X" 
                      value={step.value} 
                      onChange={e => handleUpdateStep(idx, 'value', Number(e.target.value))}
                      style={{ padding: '8px', borderRadius: '4px', background: 'rgba(0,0,0,0.5)', color: 'white', border: '1px solid var(--border-color)', width: '100px' }}
                    />
                  )}
                  
                  <button onClick={() => handleRemoveStep(idx)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', marginLeft: 'auto', fontSize: '1.2rem' }}>✕</button>
                </div>
              );
            })}
          </div>
          
          <button onClick={handleAddStep} style={{ marginTop: '10px', padding: '8px 16px', background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px dashed var(--border-color)', borderRadius: '4px', cursor: 'pointer' }}>
            + Thêm điều kiện mới
          </button>
        </div>

        <button onClick={handleSaveStrategy} className="primary" style={{ padding: '10px 20px', width: '100%', fontSize: '1rem', fontWeight: 'bold' }}>
          💾 LƯU VÀ KÍCH HOẠT CHIẾN LƯỢC
        </button>
      </div>

      <div>
        <h3 style={{ marginBottom: '15px', fontSize: '1rem' }}>Danh sách Chiến Lược đang chạy</h3>
        <div style={{ display: 'grid', gap: '15px', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {strategies.length === 0 && <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>Chưa có chiến lược nào</p>}
          {strategies.map(strat => (
            <div key={strat.id} style={{ background: 'rgba(255,255,255,0.05)', padding: '15px', borderRadius: '8px', border: '1px solid var(--border-color)', position: 'relative' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                <strong style={{ color: '#60a5fa' }}>{strat.symbol} • {strat.timeframe}</strong>
                <span style={{ 
                  fontSize: '0.75rem', 
                  padding: '2px 6px', 
                  borderRadius: '4px', 
                  background: strat.status === 'active' ? 'rgba(34, 197, 94, 0.2)' : strat.status === 'completed' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                  color: strat.status === 'active' ? '#4ade80' : strat.status === 'completed' ? '#60a5fa' : '#ef4444'
                }}>
                  {strat.status.toUpperCase()}
                </span>
              </div>
              
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                Quá trình: {strat.current_step_index} / {strat.steps.length} bước
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '15px' }}>
                {strat.steps.map((s, i) => {
                  const isDone = i < strat.current_step_index;
                  const isCurrent = i === strat.current_step_index;
                  return (
                    <div key={i} style={{ 
                      fontSize: '0.8rem', 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '8px',
                      color: isDone ? '#4ade80' : (isCurrent ? 'white' : 'var(--text-secondary)'),
                      opacity: isDone ? 0.7 : 1
                    }}>
                      <span>{isDone ? '✓' : (isCurrent ? '▶' : '○')}</span>
                      <span>{conditionTypes.find(c => c.id === s.type)?.label} {s.value ? `(${s.value})` : ''}</span>
                    </div>
                  );
                })}
              </div>
              
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={() => handleReset(strat.id)} style={{ flex: 1, padding: '6px', background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>
                  🔄 Reset
                </button>
                <button onClick={() => handleDelete(strat.id)} style={{ flex: 1, padding: '6px', background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.4)', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>
                  🗑 Xóa
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default StrategyBuilderTab;
