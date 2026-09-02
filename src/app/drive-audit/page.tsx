"use client";

import { useState } from 'react';
import type { AuditRow } from '@/app/api/audit/drive-folders/route';

const EXPECTED_LABEL: Record<string, string> = {
  search:  'Активный листинг',
  sold:    'Продано',
  removed: 'Снято с продажи',
};

const STATUS_STYLE: Record<string, string> = {
  ok:             'bb-ok',
  wrong:          'bb-bad',
  not_found:      'bb-warn',
  config_missing: 'bb-ink-3',
};

const STATUS_LABEL: Record<string, string> = {
  ok:             '✓ На месте',
  wrong:          '✗ Не там',
  not_found:      '⚠ Не найдена',
  config_missing: '— Нет конфига',
};

export default function DriveAuditPage() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{
    rows: AuditRow[];
    total: number;
    ok: number;
    wrong: number;
    missing: number;
  } | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'wrong' | 'ok'>('all');

  const run = async () => {
    setRunning(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/audit/drive-folders');
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      setResult(d);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  const visible = result
    ? result.rows.filter(r =>
        filter === 'all'   ? true :
        filter === 'wrong' ? r.status !== 'ok' :
                             r.status === 'ok'
      )
    : [];

  return (
    <div className="max-w-5xl mx-auto w-full">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2" style={{ color: 'var(--ink-900)' }}>Аудит папок Drive</h1>
        <p className="bb-ink-3 text-sm">
          Проверяет что все папки юнитов находятся в правильном месте согласно статусу в Abu Dhabi.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 sm:gap-4 mb-6">
        <button
          onClick={run}
          disabled={running}
          className="flex items-center gap-2 bb-fill-accent hover:bb-fill-accent text-white font-semibold py-3 px-6 rounded-xl transition-all disabled:opacity-50 disabled:pointer-events-none"
        >
          {running ? (
            <>
              <div className="w-4 h-4 border-2 bb-spin rounded-full animate-spin" />
              Проверяю...
            </>
          ) : '🔍 Запустить проверку'}
        </button>
        {running && (
          <p className="bb-ink-3 text-sm">Это может занять несколько минут — проверяем каждую папку в Drive</p>
        )}
      </div>

      {error && (
        <div className="p-4 rounded-xl bb-tint-bad border bb-edge bb-bad text-sm mb-6">
          {error}
        </div>
      )}

      {result && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
            {[
              { label: 'Всего проверено', value: result.total, color: 'bb-ink' },
              { label: 'На месте',        value: result.ok,    color: 'bb-ok' },
              { label: 'Не там',          value: result.wrong, color: 'bb-bad' },
              { label: 'Не найдено',      value: result.missing, color: 'bb-warn' },
            ].map(s => (
              <div key={s.label} className="p-4 rounded-2xl bb-surface border bb-edge text-center">
                <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs bb-ink-3 mt-1">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Filter */}
          <div className="flex gap-2 mb-4">
            {(['all', 'wrong', 'ok'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  filter === f
                    ? 'bb-tint-accent bb-accent border bb-edge'
                    : 'bb-ink-3 border bb-edge hover:bb-ink hover:bb-surface-soft'
                }`}
              >
                {f === 'all' ? 'Все' : f === 'wrong' ? 'Проблемные' : 'ОК'}
              </button>
            ))}
          </div>

          {/* Table */}
          <div className="rounded-2xl bb-surface border bb-edge overflow-auto max-h-[70vh]">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="sticky top-0 z-10 bb-surface">
                <tr className="border-b bb-edge text-left">
                  <th className="px-4 py-3 text-xs font-semibold bb-ink-3 uppercase tracking-wide">Строка</th>
                  <th className="px-4 py-3 text-xs font-semibold bb-ink-3 uppercase tracking-wide">Код</th>
                  <th className="px-4 py-3 text-xs font-semibold bb-ink-3 uppercase tracking-wide">Юнит</th>
                  <th className="px-4 py-3 text-xs font-semibold bb-ink-3 uppercase tracking-wide">Комментарий</th>
                  <th className="px-4 py-3 text-xs font-semibold bb-ink-3 uppercase tracking-wide">Должна быть</th>
                  <th className="px-4 py-3 text-xs font-semibold bb-ink-3 uppercase tracking-wide">Сейчас в</th>
                  <th className="px-4 py-3 text-xs font-semibold bb-ink-3 uppercase tracking-wide">Статус</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row, i) => (
                  <tr
                    key={row.rowNum}
                    className={`border-b bb-edge ${i % 2 === 0 ? '' : 'bb-surface-soft'} ${
                      row.status === 'wrong' ? 'bb-tint-bad' : ''
                    }`}
                  >
                    <td className="px-4 py-3 bb-ink-4">{row.rowNum}</td>
                    <td className="px-4 py-3 bb-ink-2 font-mono text-xs">
                      <a
                        href={`https://drive.google.com/drive/folders/${row.unitFolderId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:bb-accent transition-colors"
                      >
                        {row.code}
                      </a>
                    </td>
                    <td className="px-4 py-3 bb-ink-2 max-w-[180px] truncate" title={row.folderName || row.unit}>
                      {row.folderName || row.unit}
                    </td>
                    <td className="px-4 py-3 bb-ink-3 text-xs">{row.comment || '—'}</td>
                    <td className="px-4 py-3 bb-ink-2 text-xs">{EXPECTED_LABEL[row.expected]}</td>
                    <td className="px-4 py-3 text-xs">
                      {row.actualParentName ? (
                        <a
                          href={`https://drive.google.com/drive/folders/${row.actualParentId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="bb-ink-2 hover:bb-accent transition-colors"
                        >
                          {row.actualParentName}
                        </a>
                      ) : (
                        <span className="bb-ink-4">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${STATUS_STYLE[row.status]}`}>
                        {STATUS_LABEL[row.status]}
                      </span>
                      {row.detail && row.status === 'wrong' && (
                        <p className="text-[10px] bb-ink-4 mt-0.5 max-w-[200px]">{row.detail}</p>
                      )}
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center bb-ink-4">
                      {filter === 'wrong' ? 'Все папки на своих местах 🎉' : 'Нет данных'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
