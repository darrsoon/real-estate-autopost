"use client";

import { useState, useEffect } from 'react';
import QuickSalesPage from '../quick-sales/page';
import Segmented from '@/components/Segmented';

const WA_GROUPS = [
  { id: '120363213058937905@g.us', name: 'Abu Dhabi & Dubai properties', defaultOn: true },
  { id: '120363131158226499@g.us', name: 'Fliplux properties listing', defaultOn: true },
  { id: '120363243671933793@g.us', name: 'Blue One Properties', defaultOn: true },
  { id: '120363262055909265@g.us', name: 'AD Real Estate Availability', defaultOn: true },
  { id: '120363419032330817@g.us', name: '🆎 ALE + Rent', defaultOn: true },
  { id: '120363315978879330@g.us', name: '🏝️ Yas Island', defaultOn: false },
  { id: '120363180834286557@g.us', name: 'VIP Properties Abu Dhabi', defaultOn: true },
  { id: '120363023065348490@g.us', name: 'AD&D Realtors', defaultOn: true },
  { id: '120363179418473887@g.us', name: 'AUH Rent/Invest', defaultOn: true },
  { id: '120363425347743544@g.us', name: 'Abu Dhabi Off-Plan/Resale', defaultOn: true },
];

function formatDateRu() {
  const now = new Date();
  const months = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  const days = ['вс','пн','вт','ср','чт','пт','сб'];
  return `${now.getDate()} ${months[now.getMonth()]}, ${days[now.getDay()]}`;
}

function loadLocal(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem('budget_checks');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveLocal(c: Record<string, boolean>) {
  try { localStorage.setItem('budget_checks', JSON.stringify(c)); } catch {}
}

async function fetchChecked(): Promise<Record<string, boolean>> {
  try {
    const res = await fetch('/api/tracker');
    const data = await res.json();
    return data.checked ?? {};
  } catch { return {}; }
}

async function persistChecked(c: Record<string, boolean>) {
  saveLocal(c);
  try {
    await fetch('/api/tracker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checked: c }),
    });
  } catch {}
}

export default function BudgetPage() {
  const [mode, setMode] = useState<'budget' | 'quick'>('budget');
  const [copied, setCopied] = useState(false);
  // Проекты из базы — только для трекера отметок.
  const [dbProjects, setDbProjects] = useState<string[]>([]);
  const [dbProjectsLoading, setDbProjectsLoading] = useState(true);
  const [projects, setProjects] = useState<string[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [project, setProject] = useState('');
  const [parsedData, setParsedData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [enabledGroups, setEnabledGroups] = useState<Record<string, boolean>>(
    () => Object.fromEntries(WA_GROUPS.map(g => [g.id, g.defaultOn]))
  );
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastQueued, setBroadcastQueued] = useState(false);
  const [broadcastError, setBroadcastError] = useState<string | null>(null);
  const [broadcastTime, setBroadcastTime] = useState('');

  useEffect(() => {
    setChecked(loadLocal());
    fetchChecked().then(c => { setChecked(c); saveLocal(c); });

    // Запасной список проектов из таблицы — на случай, если база не ответит:
    // трекеру важно показать плашки, даже когда рассылку собрать нечем.
    fetch('/api/projects')
      .then(r => r.json())
      .then(d => { if (d.projects?.length) setProjects(d.projects); })
      .catch(() => {})
      .finally(() => setProjectsLoading(false));

    // Трекер — из нашей базы: отметки идут по проектам, а не по зданиям.
    // Наполняется ночной синхронизацией. Если не ответит — ниже подставится
    // список из таблицы.
    fetch('/api/project-emoji?names=1')
      .then(r => r.json())
      .then(d => {
        const names: string[] = (d.names || []).map((n: string) => (n || '').trim()).filter(Boolean);
        if (names.length) setDbProjects(names);
      })
      .catch(() => {})
      .finally(() => setDbProjectsLoading(false));
  }, []);

  const toggleCheck = (p: string, allProjects: string[]) => {
    const next = { ...checked, [p]: !checked[p] };
    const reset = allProjects.every(proj => next[proj]);
    const toSave = reset ? {} : next;
    setChecked(toSave);
    persistChecked(toSave);
  };


  // Основной путь: список собирается из базы по выбранному проекту.
  const handleBuildFromDb = async () => {
    if (!project) return;
    setLoading(true);
    setDbError(null);
    try {
      const res = await fetch('/api/budget-from-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectName: project }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setParsedData(data);
    } catch (e: any) {
      setDbError(e.message);
      setParsedData(null);
    } finally {
      setLoading(false);
    }
  };

  const toggleGroup = (id: string) => {
    setEnabledGroups(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const sendBroadcast = async () => {
    if (!parsedData?.text || !broadcastTime) return;
    const groups = WA_GROUPS.filter(g => enabledGroups[g.id]);
    if (!groups.length) return;
    setBroadcasting(true);
    setBroadcastQueued(false);
    setBroadcastError(null);
    try {
      const res = await fetch('/api/wa-broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: parsedData.text, label: project, groups, startAt: broadcastTime }),
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      setBroadcastQueued(true);
    } catch (e: any) {
      setBroadcastError(e.message);
    } finally {
      setBroadcasting(false);
    }
  };

  const isSunday = new Date().getDay() === 0;
  const activeGroups = WA_GROUPS.filter(g => enabledGroups[g.id]).length;

  // База — источник правды; таблица остаётся запасным вариантом.
  const trackerProjects = dbProjects.length ? dbProjects : projects;
  const trackerLoading = dbProjectsLoading && projectsLoading;
  const doneCount = trackerProjects.filter(p => checked[p]).length;

  return (
    <div className="max-w-6xl mx-auto w-full space-y-5">
      {/* ── Шапка ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bb-rise">
        <div>
          <h1 className="bb-title text-[26px] sm:text-[34px] leading-tight mb-1">Рассылки</h1>
          <p className="bb-sub text-sm">Две утренние рассылки: список Budget Units и Quick Sales.</p>
        </div>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'budget', label: 'Budget Units', icon: '💰' },
            { value: 'quick', label: 'Quick Sales', icon: '⚡' },
          ] as const}
        />
      </div>

      {mode === 'quick' ? (
        <QuickSalesPage />
      ) : (
        <>
          {/* ── Трекер проектов ── */}
          <div className="bb-card p-4 sm:p-5 bb-rise" style={{ animationDelay: '60ms' }}>
            <div className="flex items-center gap-2.5 mb-3.5 flex-wrap">
              <span className="bb-title text-[16px]">Расписание рассылки</span>
              <span className="bb-chip bb-chip-sky">{formatDateRu()}</span>
              {isSunday && <span className="bb-chip bb-chip-lemon">выходной</span>}
              {trackerProjects.length > 0 && (
                <span className="bb-chip bb-chip-mint ml-auto">
                  {doneCount} из {trackerProjects.length}
                </span>
              )}
            </div>

            {trackerLoading ? (
              <div className="flex items-center gap-2 text-sm py-2" style={{ color: 'var(--ink-500)' }}>
                <div
                  className="w-4 h-4 border-[3px] rounded-full animate-spin"
                  style={{ borderColor: 'var(--sky-200)', borderTopColor: 'var(--aqua-500)' }}
                />
                Загружаю проекты...
              </div>
            ) : trackerProjects.length === 0 ? (
              <p className="text-sm py-2" style={{ color: 'var(--ink-500)' }}>Проекты не найдены</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {trackerProjects.map((p, i) => {
                  const done = !!checked[p];
                  return (
                    <button
                      key={p}
                      onClick={() => { setProject(p); setParsedData(null); setDbError(null); }}
                      title="Выбрать проект — кружок слева отмечает, что рассылка ушла"
                      className="bb-pop flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full
                                 text-[12px] font-bold leading-none select-none cursor-pointer
                                 transition-all duration-200 hover:-translate-y-0.5 active:scale-[.96]"
                      style={{
                        animationDelay: `${Math.min(i * 14, 350)}ms`,
                        background: done ? 'var(--mint)' : '#fff',
                        color: done ? '#075f3d' : 'var(--ink-700)',
                        // Выбранный проект обводим — видно, для чего сейчас собирается рассылка.
                        boxShadow: project === p
                          ? '0 0 0 2.5px var(--aqua-400), var(--lift-2)'
                          : 'var(--lift-1)',
                      }}
                    >
                      {/* Кружок — отдельная кнопка: отметка «отправлено» не должна
                          срабатывать от простого выбора проекта. */}
                      <span
                        role="checkbox"
                        aria-checked={done}
                        tabIndex={0}
                        onClick={e => { e.stopPropagation(); toggleCheck(p, trackerProjects); }}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault(); e.stopPropagation(); toggleCheck(p, trackerProjects);
                          }
                        }}
                        className="w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center
                                   transition-all duration-200 hover:scale-110 cursor-pointer"
                        style={{
                          background: done ? '#10b981' : 'var(--sky-100)',
                          transform: done ? 'scale(1)' : 'scale(.85)',
                        }}
                      >
                        {done && (
                          <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </span>
                      <span className={done ? 'line-through decoration-2' : ''}>{p}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Форма и превью ── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
            <div className="bb-card p-4 sm:p-6 space-y-5 bb-rise" style={{ animationDelay: '120ms' }}>
              {/* Проект берётся из плашки в трекере — отдельный список тут не нужен */}
              <div>
                <label className="bb-label block mb-2">Проект</label>
                {project ? (
                  <div
                    className="bb-pop flex items-center gap-2 px-4 py-3 font-bold text-sm"
                    style={{ background: 'var(--sky-50)', borderRadius: 'var(--r-md)', color: 'var(--aqua-600)' }}
                  >
                    <span className="text-base leading-none">📌</span>
                    {project}
                    <button
                      onClick={() => setProject('')}
                      className="ml-auto text-xs font-bold transition-colors"
                      style={{ color: 'var(--ink-300)' }}
                      title="Снять выбор"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div
                    className="px-4 py-3 text-sm font-semibold"
                    style={{ background: 'var(--sky-50)', borderRadius: 'var(--r-md)', color: 'var(--ink-300)' }}
                  >
                    Выбери проект в расписании выше
                  </div>
                )}
              </div>

              <button
                onClick={handleBuildFromDb}
                disabled={loading || !project}
                className="bb-btn bb-btn-primary w-full"
              >
                {loading ? 'Считаю...' : '✨ Собрать из базы'}
              </button>

              <p className="text-xs" style={{ color: 'var(--ink-300)' }}>
                Берутся доступные юниты проекта, по каждому типу — самый дешёвый.
              </p>

              {dbError && (
                <div className="px-4 py-3 text-sm bb-tint-bad" style={{ borderRadius: 'var(--r-md)' }}>
                  {dbError}
                </div>
              )}

            </div>

            {parsedData && (
              <div className="bb-card p-4 sm:p-6 bb-rise">
                <div className="flex flex-wrap items-center justify-between mb-4 gap-3">
                  <h3 className="bb-title text-[17px]">Текст для WhatsApp</h3>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(parsedData.text || '');
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1600);
                    }}
                    className="bb-btn bb-btn-ghost py-2 px-4 text-[13px]"
                    style={copied ? { background: 'var(--mint)', color: '#075f3d' } : undefined}
                  >
                    {copied ? '✓ Скопировано' : 'Копировать'}
                  </button>
                </div>

                <div
                  className="p-4 sm:p-5 text-sm whitespace-pre-wrap overflow-auto max-h-[520px]"
                  style={{ background: 'var(--sky-50)', borderRadius: 'var(--r-md)', color: 'var(--ink-900)' }}
                >
                  {parsedData.text}
                </div>

                <div className="mt-3 text-xs text-right" style={{ color: 'var(--ink-300)' }}>
                  Из базы: выбрано {parsedData.selectedRows} юнитов из {parsedData.totalRows}
                </div>

                {/* ── Рассылка по группам ── */}
                <div className="mt-5 pt-5 space-y-3" style={{ borderTop: '2px solid var(--sky-50)' }}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="bb-title text-[15px]">📤 Рассылка по группам</span>
                    <span className="bb-chip bb-chip-sky">{activeGroups} из {WA_GROUPS.length}</span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {WA_GROUPS.map(g => {
                      const on = !!enabledGroups[g.id];
                      return (
                        <button
                          key={g.id}
                          onClick={() => toggleGroup(g.id)}
                          disabled={broadcasting || broadcastQueued}
                          className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold
                                     select-none cursor-pointer transition-all duration-200
                                     hover:-translate-y-0.5 active:scale-[.96] disabled:opacity-50 disabled:pointer-events-none"
                          style={{
                            background: on ? 'var(--lilac)' : 'var(--sky-50)',
                            color: on ? '#5b21b6' : 'var(--ink-300)',
                          }}
                        >
                          {on ? '✓' : '○'} {g.name}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="bb-label shrink-0">⏰ Старт (Дубай)</span>
                    <input
                      type="datetime-local"
                      value={broadcastTime}
                      onChange={e => { setBroadcastTime(e.target.value); setBroadcastQueued(false); }}
                      className="bb-input w-auto py-2 text-[13px] font-semibold"
                    />
                  </div>

                  {broadcastError && (
                    <div
                      className="bb-pop px-4 py-2.5 text-xs font-semibold"
                      style={{ background: 'var(--peach)', color: '#9f1239', borderRadius: 'var(--r-md)' }}
                    >
                      {broadcastError}
                    </div>
                  )}

                  {broadcastQueued && (
                    <div
                      className="bb-pop px-4 py-2.5 text-xs font-semibold"
                      style={{ background: 'var(--mint)', color: '#075f3d', borderRadius: 'var(--r-md)' }}
                    >
                      ✓ Добавлено в очередь. Группы получат сообщения с {broadcastTime.replace('T', ' ')} с интервалом 2 мин.
                      Смотри на странице <a href="/scheduled" className="underline">Расписание WA</a>.
                    </div>
                  )}

                  <button
                    onClick={sendBroadcast}
                    disabled={broadcasting || broadcastQueued || !broadcastTime || activeGroups === 0}
                    className="bb-btn bb-btn-ink w-full"
                  >
                    {broadcasting ? (
                      <>
                        <div className="w-4 h-4 border-2 bb-spin-on-fill rounded-full animate-spin" />
                        Добавляю в очередь...
                      </>
                    ) : '📲 Добавить в очередь'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
