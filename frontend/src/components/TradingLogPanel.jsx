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

const JournalWhiteboard = ({ canvasRef, initialData, onChange, tool, color, lineWidth }) => {
  const isDrawingRef = useRef(false);
  const previousPointRef = useRef(null);
  const initializedRef = useRef(false);
  const savedImageRef = useRef(initialData || '');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const drawSavedImage = (dataUrl, width, height) => {
      if (!dataUrl) return;
      const image = new Image();
      image.onload = () => {
        const context = canvas.getContext('2d');
        if (!context) return;
        context.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
        context.drawImage(image, 0, 0, width, height);
      };
      image.src = dataUrl;
    };

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const previousImage = initializedRef.current ? canvas.toDataURL('image/png') : savedImageRef.current;
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.fillStyle = '#020612';
      context.fillRect(0, 0, rect.width, rect.height);
      initializedRef.current = true;
      drawSavedImage(previousImage, rect.width, rect.height);
    };

    const observer = new ResizeObserver(resizeCanvas);
    observer.observe(canvas);
    resizeCanvas();
    return () => observer.disconnect();
  }, [canvasRef]);

  const getPoint = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const handlePointerDown = (event) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = getPoint(event);
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    isDrawingRef.current = true;
    previousPointRef.current = point;
    context.beginPath();
    context.moveTo(point.x, point.y);
    context.lineTo(point.x + 0.01, point.y + 0.01);
    context.strokeStyle = tool === 'eraser' ? '#020612' : color;
    context.lineWidth = tool === 'eraser' ? Math.max(lineWidth * 4, 18) : lineWidth;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.stroke();
  };

  const handlePointerMove = (event) => {
    if (!isDrawingRef.current) return;
    const point = getPoint(event);
    const previousPoint = previousPointRef.current;
    const context = event.currentTarget.getContext('2d');
    if (!context || !previousPoint) return;
    context.beginPath();
    context.moveTo(previousPoint.x, previousPoint.y);
    context.lineTo(point.x, point.y);
    context.strokeStyle = tool === 'eraser' ? '#020612' : color;
    context.lineWidth = tool === 'eraser' ? Math.max(lineWidth * 4, 18) : lineWidth;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.stroke();
    previousPointRef.current = point;
  };

  const finishStroke = (event) => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    previousPointRef.current = null;
    onChange(event.currentTarget.toDataURL('image/png'));
  };

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishStroke}
      onPointerCancel={finishStroke}
      aria-label="Bảng vẽ nhật ký"
      style={{ display: 'block', width: '100%', height: '100%', minHeight: '280px', background: '#020612', border: '1px solid rgba(0,240,255,0.35)', borderRadius: '10px', cursor: tool === 'eraser' ? 'cell' : 'crosshair', touchAction: 'none' }}
    />
  );
};

const TradingLogPanel = ({ isOpen, onClose, apiBase }) => {
  const [logs, setLogs] = useState(readLocalLogs);
  const [inputText, setInputText] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [drawingTool, setDrawingTool] = useState('pen');
  const [drawingColor, setDrawingColor] = useState('#00f0ff');
  const [lineWidth, setLineWidth] = useState(4);
  const [draftDrawing, setDraftDrawing] = useState('');
  const [whiteboardKey, setWhiteboardKey] = useState(0);
  const [storageReady, setStorageReady] = useState(false);
  const [storageStatus, setStorageStatus] = useState('Đang tải nhật ký đã lưu…');
  const logsRef = useRef(logs);
  const saveQueueRef = useRef(Promise.resolve());
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (isFullscreen) setIsFullscreen(false);
      else onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isFullscreen, onClose]);

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
    if (!inputText.trim() && !draftDrawing) return;
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
      content: inputText,
      ...(draftDrawing ? { drawing: draftDrawing } : {})
    };

    saveLogs([newNote, ...logs]);
    setInputText('');
    setDraftDrawing('');
    setWhiteboardKey(key => key + 1);
  };

  const handleDelete = (id) => {
    const newLogs = logs.filter(l => l.id !== id);
    saveLogs(newLogs);
  };

  const clearWhiteboard = () => {
    setDraftDrawing('');
    setWhiteboardKey(key => key + 1);
  };

  const downloadJournalPng = () => {
    const source = canvasRef.current;
    if (!source) return;

    const output = document.createElement('canvas');
    const outputContext = output.getContext('2d');
    if (!outputContext) return;
    const width = Math.max(1400, Math.min(2400, source.width));
    const boardHeight = Math.round(width * (source.height / Math.max(1, source.width)));
    const padding = 64;
    const textWidth = width - padding * 2;
    outputContext.font = '24px sans-serif';
    const paragraphs = (inputText.trim() || 'Ghi chú giao dịch').split('\n');
    const lines = [];
    paragraphs.forEach(paragraph => {
      const words = paragraph.split(/\s+/);
      let line = '';
      words.forEach(word => {
        const candidate = line ? `${line} ${word}` : word;
        if (line && outputContext.measureText(candidate).width > textWidth) {
          lines.push(line);
          line = word;
        } else line = candidate;
      });
      lines.push(line);
    });
    const noteHeight = Math.max(40, lines.length * 36);
    const boardTop = padding + 58 + noteHeight + 38;
    output.width = width;
    output.height = boardTop + boardHeight + padding;
    outputContext.fillStyle = '#020612';
    outputContext.fillRect(0, 0, output.width, output.height);
    outputContext.fillStyle = '#00f0ff';
    outputContext.font = 'bold 32px sans-serif';
    outputContext.fillText('[SYS.LOG] JOURNAL', padding, padding + 30);
    outputContext.fillStyle = '#94a3b8';
    outputContext.font = '18px sans-serif';
    outputContext.fillText(new Date().toLocaleString(), padding, padding + 58);
    outputContext.fillStyle = '#e0f2fe';
    outputContext.font = '24px sans-serif';
    lines.forEach((line, index) => outputContext.fillText(line, padding, padding + 104 + index * 36));
    outputContext.drawImage(source, 0, boardTop, width, boardHeight);
    outputContext.strokeStyle = 'rgba(0,240,255,0.45)';
    outputContext.lineWidth = 2;
    outputContext.strokeRect(0, 0, output.width, output.height);

    output.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `SYS-LOG-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  };

  return (
    <>
      {/* Overlay để click ra ngoài thì đóng */}
      {isOpen && (
        <div 
          onClick={() => { setIsFullscreen(false); onClose(); }}
          style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.3)' }}
        />
      )}

      {/* Slide Panel */}
      <div style={{
        position: 'fixed',
        inset: isFullscreen ? 0 : '0 0 0 auto',
        height: isFullscreen ? '100dvh' : '100vh',
        width: isFullscreen ? '100vw' : '350px',
        background: 'rgba(2, 6, 18, 0.95)',
        backdropFilter: 'blur(12px)',
        border: isFullscreen ? '1px solid rgba(0, 240, 255, 0.5)' : 'none',
        borderLeft: isFullscreen ? undefined : '2px solid rgba(0, 240, 255, 0.6)',
        boxShadow: isFullscreen ? '0 0 30px rgba(0, 240, 255, 0.12)' : '-5px 0 20px rgba(0, 240, 255, 0.1)',
        zIndex: 10000,
        transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'monospace',
        boxSizing: 'border-box',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{ padding: isFullscreen ? '14px 22px' : '20px', borderBottom: '1px solid rgba(0,240,255,0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flex: '0 0 auto' }}>
          <h2 style={{ margin: 0, color: '#00f0ff', fontSize: isFullscreen ? '1.3rem' : '1.2rem', textShadow: '0 0 10px rgba(0,240,255,0.5)' }}>[SYS.LOG] JOURNAL</h2>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span role="status" aria-live="polite" style={{ color: storageStatus.startsWith('Lỗi') || storageStatus.startsWith('Không') ? '#fca5a5' : '#94a3b8', fontSize: '0.72rem', textAlign: 'right' }}>
              {storageStatus}
            </span>
            <button
              onClick={() => setIsFullscreen(value => !value)}
              title={isFullscreen ? 'Thu nhỏ nhật ký' : 'Phóng to toàn màn hình'}
              aria-label={isFullscreen ? 'Thu nhỏ nhật ký' : 'Phóng to toàn màn hình'}
              style={{ background: 'rgba(0,240,255,0.08)', border: '1px solid rgba(0,240,255,0.3)', color: '#67e8f9', borderRadius: '6px', padding: '7px 9px', cursor: 'pointer', fontSize: '15px', lineHeight: 1 }}
            >{isFullscreen ? '❐' : '⛶'}</button>
            <button onClick={() => { setIsFullscreen(false); onClose(); }} aria-label="Đóng nhật ký" style={{ background: 'transparent', border: 'none', color: '#00f0ff', fontSize: '1.5rem', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>&times;</button>
          </div>
        </div>

        {isFullscreen ? (
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 430px), 1fr))', alignContent: 'start', gap: '18px' }}>
            <section style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0 }}>
              <label htmlFor="journal-fullscreen-note" style={{ color: '#67e8f9', fontSize: '0.9rem', fontWeight: 700 }}>Nội dung nhật ký</label>
              <textarea
                id="journal-fullscreen-note"
                value={inputText}
                onChange={event => setInputText(event.target.value)}
                placeholder="Ghi lại bối cảnh, kế hoạch và kết quả giao dịch…"
                style={{ width: '100%', height: '135px', resize: 'vertical', background: '#020612', border: '1px solid rgba(0,240,255,0.3)', color: '#e0f2fe', padding: '12px', borderRadius: '8px', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5 }}
              />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                <strong style={{ color: '#67e8f9', fontSize: '0.9rem' }}>Bảng vẽ</strong>
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                  <button onClick={() => setDrawingTool('pen')} aria-pressed={drawingTool === 'pen'} style={{ padding: '7px 10px', borderRadius: '6px', border: `1px solid ${drawingTool === 'pen' ? '#00f0ff' : 'rgba(148,163,184,0.3)'}`, background: drawingTool === 'pen' ? 'rgba(0,240,255,0.15)' : 'transparent', color: '#e0f2fe', cursor: 'pointer' }}>✎ Bút</button>
                  <button onClick={() => setDrawingTool('eraser')} aria-pressed={drawingTool === 'eraser'} style={{ padding: '7px 10px', borderRadius: '6px', border: `1px solid ${drawingTool === 'eraser' ? '#00f0ff' : 'rgba(148,163,184,0.3)'}`, background: drawingTool === 'eraser' ? 'rgba(0,240,255,0.15)' : 'transparent', color: '#e0f2fe', cursor: 'pointer' }}>⌫ Tẩy</button>
                  <label title="Màu bút" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: '#94a3b8', fontSize: '0.78rem' }}>
                    Màu <input type="color" value={drawingColor} onChange={event => { setDrawingColor(event.target.value); setDrawingTool('pen'); }} style={{ width: '32px', height: '30px', padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }} />
                  </label>
                  <label title="Độ dày nét" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: '#94a3b8', fontSize: '0.78rem' }}>
                    Nét <input type="range" min="1" max="16" value={lineWidth} onChange={event => setLineWidth(Number(event.target.value))} style={{ width: '76px', accentColor: '#00f0ff' }} />
                  </label>
                  <button onClick={clearWhiteboard} style={{ padding: '7px 10px', borderRadius: '6px', border: '1px solid rgba(251,113,133,0.45)', background: 'rgba(251,113,133,0.08)', color: '#fda4af', cursor: 'pointer' }}>Xóa bảng</button>
                  <button onClick={downloadJournalPng} style={{ padding: '7px 10px', borderRadius: '6px', border: '1px solid rgba(0,240,255,0.45)', background: 'rgba(0,240,255,0.1)', color: '#67e8f9', cursor: 'pointer' }}>↓ Tải PNG</button>
                </div>
              </div>
              <div style={{ width: '100%', height: 'min(58vh, 650px)', minHeight: '320px' }}>
                <JournalWhiteboard key={whiteboardKey} canvasRef={canvasRef} initialData={draftDrawing} onChange={setDraftDrawing} tool={drawingTool} color={drawingColor} lineWidth={lineWidth} />
              </div>
              <button
                onClick={handleCreate}
                disabled={!storageReady || (!inputText.trim() && !draftDrawing)}
                style={{ padding: '12px', background: 'rgba(0,240,255,0.12)', border: '1px solid #00f0ff', color: '#00f0ff', fontWeight: 'bold', cursor: storageReady ? 'pointer' : 'wait', opacity: storageReady && (inputText.trim() || draftDrawing) ? 1 : 0.55, borderRadius: '7px', letterSpacing: '0.5px' }}
              >{storageReady ? '+ Lưu bản ghi và bảng vẽ' : 'Đang tải nhật ký…'}</button>
            </section>

            <section style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <h3 style={{ margin: 0, color: '#67e8f9', fontSize: '0.95rem' }}>Các bản ghi đã lưu ({logs.length})</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {logs.map(log => (
                  <div key={log.id} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(0,240,255,0.15)', padding: '14px', borderRadius: '8px', position: 'relative' }}>
                    <div style={{ color: '#f59e0b', fontSize: '0.78rem', marginBottom: '8px', fontWeight: 'bold', paddingRight: '25px' }}>{log.timestamp}</div>
                    <div style={{ color: '#e0f2fe', whiteSpace: 'pre-wrap', fontSize: '0.88rem', lineHeight: 1.45 }}>{log.content}</div>
                    {log.drawing && <img src={log.drawing} alt="Bản vẽ trong nhật ký" style={{ display: 'block', maxWidth: '100%', maxHeight: '300px', objectFit: 'contain', objectPosition: 'left top', marginTop: '10px', border: '1px solid rgba(0,240,255,0.18)', borderRadius: '6px' }} />}
                    <button onClick={() => handleDelete(log.id)} disabled={!storageReady} title="Xóa bản ghi" aria-label="Xóa bản ghi" style={{ position: 'absolute', top: '8px', right: '9px', background: 'transparent', border: 'none', color: '#fb7185', fontSize: '1.2rem', cursor: storageReady ? 'pointer' : 'wait' }}>&times;</button>
                  </div>
                ))}
                {logs.length === 0 && <div style={{ textAlign: 'center', color: '#94a3b8', fontStyle: 'italic', marginTop: '20px' }}>Chưa có bản ghi nào.</div>}
              </div>
            </section>
          </div>
        ) : (
          <>
            <div style={{ padding: '20px', borderBottom: '1px solid rgba(0,240,255,0.2)', display: 'flex', flexDirection: 'column', gap: '15px', flex: '0 0 auto' }}>
              <textarea
                value={inputText}
                onChange={event => setInputText(event.target.value)}
                placeholder="Type your trade log here..."
                style={{ width: '100%', minHeight: '100px', background: '#020612', border: '1px solid rgba(0,240,255,0.3)', color: '#0ea5e9', padding: '10px', borderRadius: '4px', resize: 'vertical', outline: 'none', boxShadow: 'inset 0 0 10px rgba(0,240,255,0.1)', fontFamily: 'inherit' }}
              />
              <button onClick={handleCreate} disabled={!storageReady || (!inputText.trim() && !draftDrawing)} style={{ width: '100%', padding: '12px', background: 'rgba(0,240,255,0.1)', border: '1px solid #00f0ff', color: '#00f0ff', fontWeight: 'bold', cursor: storageReady ? 'pointer' : 'wait', opacity: storageReady ? 1 : 0.65, borderRadius: '4px', boxShadow: '0 0 10px rgba(0,240,255,0.2)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                {storageReady ? '+ Khởi tạo bản ghi' : 'Đang tải nhật ký…'}
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
              {logs.map(log => (
                <div key={log.id} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(0,240,255,0.15)', padding: '15px', borderRadius: '6px', position: 'relative' }}>
                  <div style={{ color: '#f59e0b', fontSize: '0.8rem', marginBottom: '8px', fontWeight: 'bold', paddingRight: '20px' }}>{log.timestamp}</div>
                  <div style={{ color: '#e0f2fe', whiteSpace: 'pre-wrap', fontSize: '0.9rem', lineHeight: '1.4' }}>{log.content}</div>
                  {log.drawing && <img src={log.drawing} alt="Bản vẽ trong nhật ký" style={{ display: 'block', maxWidth: '100%', maxHeight: '220px', objectFit: 'contain', objectPosition: 'left top', marginTop: '8px' }} />}
                  <button onClick={() => handleDelete(log.id)} disabled={!storageReady} title="Xóa bản ghi" aria-label="Xóa bản ghi" style={{ position: 'absolute', top: '8px', right: '8px', background: 'transparent', border: 'none', color: '#ff3333', fontSize: '1rem', cursor: 'pointer', opacity: 0.65, padding: '5px' }}>&times;</button>
                </div>
              ))}
              {logs.length === 0 && <div style={{ textAlign: 'center', color: '#94a3b8', fontStyle: 'italic', marginTop: '20px' }}>Chưa có bản ghi nào.</div>}
            </div>
          </>
        )}
      </div>
    </>
  );
};

export default TradingLogPanel;
