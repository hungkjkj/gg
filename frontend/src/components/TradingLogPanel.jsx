import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const LOGS_STORAGE_KEY = 'jarvis_trading_logs';

const readLocalLogs = () => {
  try {
    const saved = localStorage.getItem(LOGS_STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed.filter(log => log && log.id != null && typeof log.content === 'string') : [];
  } catch (e) {
    console.error('Error loading local trading logs', e);
    return [];
  }
};

const mergeLogs = (...groups) => {
  const unique = new Map();
  groups.flat().forEach(log => {
    if (log && log.id != null && typeof log.content === 'string' && !unique.has(String(log.id))) {
      unique.set(String(log.id), { ...log, id: String(log.id) });
    }
  });
  return [...unique.values()].sort((a, b) => {
    const aId = Number(a.id);
    const bId = Number(b.id);
    return Number.isFinite(aId) && Number.isFinite(bId) ? bId - aId : 0;
  });
};

const TradingLogPanel = ({ isOpen, onClose, apiBase }) => {
  const [logs, setLogs] = useState(readLocalLogs);
  const [inputText, setInputText] = useState('');
  const [storageReady, setStorageReady] = useState(false);
  const [storageStatus, setStorageStatus] = useState('Đang tải nhật ký đã lưu…');
  const logsRef = useRef(logs);
  const saveQueueRef = useRef(Promise.resolve());

  const persistLogs = (nextLogs) => {
    setStorageStatus('Đang lưu…');
    saveQueueRef.current = saveQueueRef.current
      .catch(() => {})
      .then(() => axios.put(`${apiBase}/api/v1/trading-logs`, nextLogs))
      .then(() => {
        if (logsRef.current === nextLogs) setStorageStatus('Đã lưu an toàn trên thiết bị');
      })
      .catch((e) => {
        console.error('Error saving trading logs', e);
        if (logsRef.current === nextLogs) setStorageStatus('Lỗi đồng bộ — bản tạm còn trên trình duyệt');
      });
  };

  useEffect(() => {
    let isActive = true;
    try {
      const localLogs = readLocalLogs();
      axios.get(`${apiBase}/api/v1/trading-logs`)
        .then(response => {
          if (!isActive) return;
          const remoteLogs = Array.isArray(response.data?.logs) ? response.data.logs : [];
          const mergedLogs = mergeLogs(logsRef.current, localLogs, remoteLogs);
          logsRef.current = mergedLogs;
          setLogs(mergedLogs);
          try { localStorage.setItem(LOGS_STORAGE_KEY, JSON.stringify(mergedLogs)); } catch (e) { console.error('Error updating local trading log cache', e); }
          setStorageReady(true);
          if (JSON.stringify(mergedLogs) !== JSON.stringify(remoteLogs)) {
            persistLogs(mergedLogs);
          } else {
            setStorageStatus('Đã lưu an toàn trên thiết bị');
          }
        })
        .catch(e => {
          console.error('Error loading trading logs from backend', e);
          if (!isActive) return;
          setStorageReady(true);
          setStorageStatus('Không kết nối được nơi lưu nhật ký — đang giữ bản trên trình duyệt');
        });
    } catch (e) {
      console.error('Error starting trading log load', e);
      setStorageReady(true);
      setStorageStatus('Không đọc được nhật ký đã lưu');
    }
    return () => { isActive = false; };
  }, [apiBase]);

  const saveLogs = (newLogs) => {
    logsRef.current = newLogs;
    setLogs(newLogs);
    try { localStorage.setItem(LOGS_STORAGE_KEY, JSON.stringify(newLogs)); } catch (e) { console.error('Error saving local trading log cache', e); }
    persistLogs(newLogs);
  };

  const handleCreate = () => {
    if (!inputText.trim()) return;
    const date = new Date();
    const d = date.getDate().toString().padStart(2, '0');
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const y = date.getFullYear();
    const hh = date.getHours().toString().padStart(2, '0');
    const mm = date.getMinutes().toString().padStart(2, '0');
    const ss = date.getSeconds().toString().padStart(2, '0');
    const timestampStr = `${d}-${m}-${y} // ${hh}:${mm}:${ss}`;

    const newNote = {
      id: Date.now().toString(),
      timestamp: `<LOG_ID: ${timestampStr}>`,
      content: inputText
    };

    saveLogs([newNote, ...logs]);
    setInputText('');
  };

  const handleDelete = (id) => {
    const newLogs = logs.filter(l => l.id !== id);
    saveLogs(newLogs);
  };

  return (
    <>
      {/* Overlay để click ra ngoài thì đóng */}
      {isOpen && (
        <div 
          onClick={onClose}
          style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.3)' }}
        />
      )}

      {/* Slide Panel */}
      <div style={{
        position: 'fixed',
        top: 0,
        right: 0,
        height: '100vh',
        width: '350px',
        background: 'rgba(2, 6, 18, 0.95)',
        backdropFilter: 'blur(12px)',
        borderLeft: '2px solid rgba(0, 240, 255, 0.6)',
        boxShadow: '-5px 0 20px rgba(0, 240, 255, 0.1)',
        zIndex: 9999,
        transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'monospace'
      }}>
        {/* Header */}
        <div style={{ padding: '20px', borderBottom: '1px solid rgba(0,240,255,0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, color: '#00f0ff', fontSize: '1.2rem', textShadow: '0 0 10px rgba(0,240,255,0.5)' }}>[SYS.LOG] JOURNAL</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#00f0ff', fontSize: '1.5rem', cursor: 'pointer', padding: 0 }}>&times;</button>
        </div>

        {/* Input Area */}
        <div style={{ padding: '20px', borderBottom: '1px solid rgba(0,240,255,0.2)', display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <textarea 
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Type your trade log here..."
            style={{
              width: '100%',
              minHeight: '100px',
              background: '#020612',
              border: '1px solid rgba(0, 240, 255, 0.3)',
              color: '#0ea5e9',
              padding: '10px',
              borderRadius: '4px',
              resize: 'vertical',
              outline: 'none',
              boxShadow: 'inset 0 0 10px rgba(0, 240, 255, 0.1)',
              fontFamily: 'inherit'
            }}
          />
          <button 
            onClick={handleCreate}
            disabled={!storageReady}
            style={{
              width: '100%',
              padding: '12px',
              background: 'rgba(0, 240, 255, 0.1)',
              border: '1px solid #00f0ff',
              color: '#00f0ff',
              fontWeight: 'bold',
              cursor: storageReady ? 'pointer' : 'wait',
              opacity: storageReady ? 1 : 0.65,
              borderRadius: '4px',
              boxShadow: '0 0 10px rgba(0,240,255,0.2)',
              transition: 'all 0.2s',
              textTransform: 'uppercase',
              letterSpacing: '1px'
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0, 240, 255, 0.3)'; e.currentTarget.style.boxShadow = '0 0 20px rgba(0,240,255,0.5)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0, 240, 255, 0.1)'; e.currentTarget.style.boxShadow = '0 0 10px rgba(0,240,255,0.2)'; }}
          >
            {storageReady ? '+ Khởi tạo bản ghi' : 'Đang tải nhật ký…'}
          </button>
          <div role="status" aria-live="polite" style={{ color: storageStatus.startsWith('Lỗi') || storageStatus.startsWith('Không') ? '#fca5a5' : '#94a3b8', fontSize: '0.72rem', textAlign: 'center', marginTop: '-8px' }}>
            {storageStatus}
          </div>
        </div>

        {/* Log List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
          {logs.map(log => (
            <div 
              key={log.id}
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(0,240,255,0.15)',
                padding: '15px',
                borderRadius: '6px',
                position: 'relative'
              }}
              onMouseEnter={e => e.currentTarget.querySelector('.del-btn').style.opacity = '1'}
              onMouseLeave={e => e.currentTarget.querySelector('.del-btn').style.opacity = '0.3'}
            >
              <div style={{ color: '#f59e0b', fontSize: '0.8rem', marginBottom: '8px', fontWeight: 'bold' }}>
                {log.timestamp}
              </div>
              <div style={{ color: '#e0f2fe', whiteSpace: 'pre-wrap', fontSize: '0.9rem', lineHeight: '1.4' }}>
                {log.content}
              </div>
              <button 
                className="del-btn"
                onClick={() => handleDelete(log.id)}
                disabled={!storageReady}
                style={{
                  position: 'absolute',
                  top: '10px',
                  right: '10px',
                  background: 'transparent',
                  border: 'none',
                  color: '#ff3333',
                  fontSize: '1rem',
                  cursor: 'pointer',
                  opacity: 0.3,
                  transition: 'opacity 0.2s',
                  padding: '5px'
                }}
                title="Xóa bản ghi"
              >
                &times;
              </button>
            </div>
          ))}
          {logs.length === 0 && (
            <div style={{ textAlign: 'center', color: '#94a3b8', fontStyle: 'italic', marginTop: '20px' }}>
              Chưa có bản ghi nào.
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default TradingLogPanel;
