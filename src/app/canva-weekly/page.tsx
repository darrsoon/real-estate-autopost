'use client';

import React, { useState, useRef } from 'react';

interface LogEntry {
  type: string;
  index?: number;
  name?: string;
  step?: string;
  filename?: string;
  message?: string;
  total?: number;
}

const STEP_LABELS: Record<string, string> = {
  export: 'экспорт из Canva',
  download: 'скачивание',
  compress: 'сжатие',
  send: 'отправка в Telegram',
};

export default function CanvaWeeklyPage() {
  const [status, setStatus] = useState<'idle' | 'running' | 'done'>('idle');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const readerRef = useRef<ReadableStreamDefaultReader | null>(null);

  function addLog(entry: LogEntry) {
    setLogs(prev => [...prev, entry]);
  }

  async function handleStart() {
    setStatus('running');
    setLogs([]);
    setProgress({ done: 0, total: 0 });

    try {
      const res = await fetch('/api/canva-weekly', { method: 'POST' });
      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data: ')) continue;
          try {
            const event: LogEntry = JSON.parse(line.slice(6));
            addLog(event);
            if (event.type === 'start') setProgress(p => ({ ...p, total: event.total ?? 0 }));
            if (event.type === 'done') setProgress(p => ({ ...p, done: p.done + 1 }));
          } catch {}
        }
      }
    } catch (err: any) {
      addLog({ type: 'fatal', message: err.message });
    }

    setStatus('done');
  }

  function handleStop() {
    readerRef.current?.cancel();
    setStatus('done');
  }

  const errors = logs.filter(l => l.type === 'error').length;
  const successes = logs.filter(l => l.type === 'done').length;

  return (
    <main style={{ minHeight: '100vh', background: '#0f0f0f', color: '#fff', padding: 'clamp(16px, 5vw, 40px)', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Презентации → Telegram</h1>
        <p style={{ color: '#888', fontSize: 14, marginBottom: 32 }}>
          Скачает 16 PDF из Canva, сожмёт и отправит от твоего имени
        </p>

        {status === 'idle' && (
          <button
            onClick={handleStart}
            style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 12, padding: '12px 32px', fontSize: 16, fontWeight: 600, cursor: 'pointer' }}
          >
            Запустить
          </button>
        )}

        {status === 'running' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button
              onClick={handleStop}
              style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 12, padding: '10px 24px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
            >
              Остановить
            </button>
            <span style={{ color: '#888', fontSize: 14 }}>{progress.done} / {progress.total} готово</span>
          </div>
        )}

        {status === 'done' && (
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 12, color: errors === 0 ? '#4ade80' : '#facc15' }}>
              {errors === 0 ? `✅ Готово — ${successes} отправлено` : `⚠️ ${successes} отправлено, ${errors} ошибок`}
            </div>
            <button
              onClick={() => { setStatus('idle'); setLogs([]); setProgress({ done: 0, total: 0 }); }}
              style={{ background: '#374151', color: '#fff', border: 'none', borderRadius: 12, padding: '10px 24px', fontSize: 14, cursor: 'pointer' }}
            >
              Запустить снова
            </button>
          </div>
        )}

        {logs.length > 0 && (
          <div style={{ marginTop: 24, background: '#111', borderRadius: 12, padding: 16, fontFamily: 'monospace', fontSize: 13, maxHeight: 500, overflowY: 'auto' }}>
            {logs.map((log, i) => {
              if (log.type === 'start') return <div key={i} style={{ color: '#6b7280' }}>Начинаем — {log.total} презентаций</div>;
              if (log.type === 'log') return <div key={i} style={{ color: '#9ca3af' }}>{log.message}</div>;
              if (log.type === 'progress') return <div key={i} style={{ color: '#60a5fa' }}>[{(log.index ?? 0) + 1}] {log.name} — {STEP_LABELS[log.step!] ?? log.step}...</div>;
              if (log.type === 'done') return <div key={i} style={{ color: '#4ade80' }}>✅ [{(log.index ?? 0) + 1}] {log.filename}</div>;
              if (log.type === 'error') return <div key={i} style={{ color: '#f87171' }}>❌ [{(log.index ?? 0) + 1}] {log.name}: {log.message}</div>;
              if (log.type === 'fatal') return <div key={i} style={{ color: '#ef4444' }}>💥 {log.message}</div>;
              if (log.type === 'finish') return <div key={i} style={{ color: '#6b7280', paddingTop: 8 }}>— конец —</div>;
              return null;
            })}
          </div>
        )}

        <div style={{ marginTop: 48, paddingTop: 24, borderTop: '1px solid #1f2937' }}>
          <p style={{ color: '#6b7280', fontSize: 12, marginBottom: 6 }}>Первый раз или токен устарел:</p>
          <a href="/api/canva-oauth/start" style={{ color: '#a78bfa', fontSize: 12 }}>→ Подключить Canva заново</a>
        </div>
      </div>
    </main>
  );
}
