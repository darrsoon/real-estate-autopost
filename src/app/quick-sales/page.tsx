"use client";

import { useCallback, useEffect, useState } from 'react';

/* Quick Sales: все срочные продажи по Абу-Даби из базы (deal_type = Distress
   Deal). Текст можно править перед отправкой в группу Hot deals. */

const HOT_DEALS_GROUP = { id: '120363386844150161@g.us', name: 'Hot deals in abu dhabi 🏠' };

interface Item {
  type: string;
  view?: string;
  unit?: string;
  rowName?: string;
  price: number;
  originalPrice?: number | string;
}

interface Group {
  project: string;
  island?: string;
  emoji?: string;
  items: Item[];
}

export default function QuickSalesPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [count, setCount] = useState(0);
  const [text, setText] = useState('');
  const [edited, setEdited] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const [groupOn, setGroupOn] = useState(true);
  const [startAt, setStartAt] = useState('');
  const [sending, setSending] = useState(false);
  const [queued, setQueued] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/quick-sales');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setGroups(data.groups || []);
      setCount(data.count || 0);
      setText(data.text || '');
      setEdited(false);
      setQueued(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Через микротаск: правило запрещает менять состояние прямо в теле эффекта.
  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  const send = async () => {
    if (!text || !startAt || !groupOn) return;
    setSending(true);
    setQueued(false);
    setSendError(null);
    try {
      const res = await fetch('/api/wa-broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          label: 'Quick Sales',
          groups: [HOT_DEALS_GROUP],
          startAt,
        }),
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      setQueued(true);
    } catch (e: any) {
      setSendError(e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto w-full space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <h1 className="bb-title text-[22px]">⚡ Quick Sales</h1>
            {!loading && count > 0 && (
              <span className="bb-chip bb-chip-lemon">
                {count} юнитов · {groups.length} проектов
              </span>
            )}
          </div>
          <p className="bb-sub text-sm">
            Все срочные продажи по Абу-Даби из базы. Текст можно поправить перед отправкой.
          </p>
        </div>
        <button onClick={load} disabled={loading} className="bb-btn bb-btn-ghost shrink-0">
          {loading ? 'Загружаю…' : '🔄 Обновить'}
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 text-sm bb-tint-bad" style={{ borderRadius: 'var(--r-md)' }}>
          {error}
        </div>
      )}

      {!loading && !error && count === 0 && (
        <div className="bb-card p-4 sm:p-6 bb-sub text-sm">
          В базе нет юнитов со срочной продажей.
        </div>
      )}

      {count > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
          {/* ── Что попало в подборку ── */}
          <div className="bb-card p-4 sm:p-6 space-y-4 bb-rise">
            <h3 className="bb-title text-[17px]">Что вошло</h3>
            {groups.map(g => (
              <div key={g.project} className="space-y-1.5">
                <div className="bb-label">
                  {g.project} {g.emoji}
                  {g.island ? <span className="bb-sub font-normal"> · {g.island}</span> : null}
                </div>
                {g.items.map((it, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-sm px-3 py-2"
                    style={{ background: 'var(--sky-50)', borderRadius: 'var(--r-md)' }}
                  >
                    <span className="font-semibold bb-ink">{it.type}</span>
                    <span className="bb-sub truncate">{it.view || it.unit}</span>
                    <span className="ml-auto font-bold bb-ink shrink-0">
                      {it.price.toLocaleString('de-DE')} AED
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* ── Текст и отправка ── */}
          <div className="bb-card p-4 sm:p-6 bb-rise" style={{ animationDelay: '60ms' }}>
            <div className="flex flex-wrap items-center justify-between mb-4 gap-3">
              <h3 className="bb-title text-[17px]">
                Текст для WhatsApp
                {edited && <span className="bb-sub text-xs font-normal"> · изменён</span>}
              </h3>
              <div className="flex items-center gap-2">
                {edited && (
                  <button onClick={load} className="bb-btn bb-btn-ghost py-2 px-4 text-[13px]">
                    Вернуть
                  </button>
                )}
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(text);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1600);
                  }}
                  className="bb-btn bb-btn-ghost py-2 px-4 text-[13px]"
                  style={copied ? { background: 'var(--mint)', color: '#075f3d' } : undefined}
                >
                  {copied ? '✓ Скопировано' : 'Копировать'}
                </button>
              </div>
            </div>

            <textarea
              value={text}
              onChange={e => {
                setText(e.target.value);
                setEdited(true);
                setQueued(false);
              }}
              rows={18}
              className="bb-input text-sm resize-y font-mono leading-relaxed"
            />

            {/* ── Рассылка ── */}
            <div className="mt-5 pt-5 space-y-3" style={{ borderTop: '2px solid var(--sky-50)' }}>
              <span className="bb-title text-[15px]">📤 Отправка в группу</span>

              <button
                onClick={() => setGroupOn(v => !v)}
                disabled={sending || queued}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold
                           select-none cursor-pointer transition-all duration-200
                           hover:-translate-y-0.5 active:scale-[.96] disabled:opacity-50 disabled:pointer-events-none"
                style={{
                  background: groupOn ? 'var(--lilac)' : 'var(--sky-50)',
                  color: groupOn ? '#5b21b6' : 'var(--ink-300)',
                }}
              >
                {groupOn ? '✓' : '○'} {HOT_DEALS_GROUP.name}
              </button>

              <div className="flex items-center gap-2 flex-wrap">
                <span className="bb-label shrink-0">⏰ Старт (Дубай)</span>
                <input
                  type="datetime-local"
                  value={startAt}
                  onChange={e => { setStartAt(e.target.value); setQueued(false); }}
                  className="bb-input py-2 text-sm w-auto"
                />
              </div>

              <button
                onClick={send}
                disabled={sending || queued || !startAt || !groupOn || !text}
                className="bb-btn bb-btn-primary w-full"
              >
                {queued ? '✓ Поставлено в очередь' : sending ? 'Ставлю в очередь…' : 'Запланировать отправку'}
              </button>

              {sendError && (
                <div className="px-4 py-3 text-sm bb-tint-bad" style={{ borderRadius: 'var(--r-md)' }}>
                  {sendError}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
