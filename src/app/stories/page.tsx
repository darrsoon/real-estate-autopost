"use client";

import { useEffect, useRef, useState } from 'react';
import { upload } from '@vercel/blob/client';

type StoryMediaType = 'image' | 'video' | 'text';

interface StoryItem {
  id: string;
  created_at: string;
  caption: string;
  media_type: StoryMediaType;
  media_url: string;
  file_name: string;
  uploaded_at: string;
  scheduled_at: string;
  status: string;
}

const STALE_WARNING_DAYS = 13;
function isStale(uploadedAtIso: string): boolean {
  if (!uploadedAtIso) return false;
  const ageDays = (Date.now() - new Date(uploadedAtIso).getTime()) / (1000 * 60 * 60 * 24);
  return ageDays >= STALE_WARNING_DAYS;
}

export default function StoriesPage() {
  const [items, setItems] = useState<StoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<string>('');
  const [refreshingState, setRefreshingState] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmSendId, setConfirmSendId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const [textOnly, setTextOnly] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const postAction = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/story-schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    let data: any = null;
    try { data = JSON.parse(raw); } catch {}
    if (!data) {
      const hint = res.status === 504 ? 'сервер не уложился во время' : `код ${res.status}`;
      throw new Error(`${hint}. Ответ: ${raw.slice(0, 120) || '(пусто)'}`);
    }
    if (data.error) throw new Error(data.error);
    return data;
  };

  const load = async () => {
    const data = await fetch('/api/story-schedule').then(r => r.json());
    setItems(data.items || []);
    setState(data.state || 'unknown');
  };

  const refreshState = async () => {
    setRefreshingState(true);
    try {
      const data = await fetch('/api/story-schedule').then(r => r.json());
      setState(data.state || 'unknown');
    } finally {
      setRefreshingState(false);
    }
  };

  const isReady = state === 'authorized';

  const stateInfo: Record<string, { dot: string; label: string; cls: string }> = {
    authorized: { dot: '🟢', label: 'Авторизован — можно отправлять', cls: 'bb-tint-ok bb-edge bb-ok' },
    yellowCard: { dot: '🟡', label: 'Жёлтая карточка — WhatsApp ограничил номер, отправка заблокирована', cls: 'bb-tint-warn bb-edge bb-warn' },
    blocked: { dot: '🔴', label: 'Заблокирован — номер забанен', cls: 'bb-tint-bad bb-edge bb-bad' },
    notAuthorized: { dot: '🔴', label: 'Не авторизован — переподключи WhatsApp Наташи в Green API', cls: 'bb-tint-bad bb-edge bb-bad' },
    sleepMode: { dot: '🟡', label: 'Спящий режим — телефон офлайн', cls: 'bb-tint-warn bb-edge bb-warn' },
    starting: { dot: '⚪', label: 'Запускается...', cls: 'bb-surface-soft bb-ink-2' },
    unknown: { dot: '⚪', label: 'Статус неизвестен', cls: 'bb-surface-soft bb-ink-3' },
  };
  const si = stateInfo[state] || stateInfo.unknown;

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  const toInput = (s: string) => (s ? s.replace(' ', 'T').slice(0, 16) : '');
  const fromInput = (s: string) => (s ? s.replace('T', ' ').slice(0, 16) : '');

  const setSchedule = async (item: StoryItem, inputVal: string) => {
    const scheduledAt = fromInput(inputVal);
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, scheduled_at: scheduledAt } : i));
    await fetch('/api/story-schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'schedule', id: item.id, scheduledAt }),
    });
  };

  const sendOne = async (item: StoryItem) => {
    setConfirmSendId(null);
    setBusyId(item.id);
    try {
      await postAction({ action: 'send-one', id: item.id });
      await load();
    } catch (e: any) {
      setErrorMsg('Ошибка отправки: ' + e.message);
    } finally {
      setBusyId(null);
    }
  };

  const deleteOne = async (item: StoryItem) => {
    setBusyId(item.id);
    try {
      await postAction({ action: 'delete', id: item.id });
      await load();
    } catch (e: any) {
      setErrorMsg('Ошибка удаления: ' + e.message);
    } finally {
      setBusyId(null);
    }
  };

  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const clearAll = async () => {
    setConfirmClear(false);
    setClearing(true);
    setErrorMsg(null);
    try {
      await postAction({ action: 'clear-all' });
      await load();
    } catch (e: any) {
      setErrorMsg('Ошибка очистки: ' + e.message);
    } finally {
      setClearing(false);
    }
  };

  const addToQueue = async () => {
    if (!textOnly && !file) return setErrorMsg('Выбери фото/видео или переключись на текстовую сторис');
    if (!caption.trim() && textOnly) return setErrorMsg('Для текстовой сторис нужен текст');
    setUploading(true);
    setErrorMsg(null);
    try {
      if (textOnly) {
        await postAction({ action: 'add', mediaType: 'text', caption: caption.trim() });
      } else {
        const mediaType: StoryMediaType = file!.type.startsWith('video/') ? 'video' : 'image';
        const blob = await upload(file!.name, file!, {
          access: 'public',
          handleUploadUrl: '/api/story-schedule/blob-upload',
        });
        await postAction({
          action: 'add',
          mediaType,
          caption: caption.trim(),
          blobUrl: blob.url,
          fileName: file!.name,
          contentType: file!.type,
        });
      }
      setCaption('');
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await load();
    } catch (e: any) {
      setErrorMsg('Ошибка добавления: ' + e.message);
    } finally {
      setUploading(false);
    }
  };

  const formatCreated = (iso: string) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    } catch { return iso; }
  };

  const waiting = items.filter(i => i.status === 'WAITING');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 bb-spin rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto w-full space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-1" style={{ color: 'var(--ink-900)' }}>Сторис Наташе</h1>
        <p className="bb-ink-3 text-sm">
          Загрузи фото/видео или текст, задай время по Дубаю — сторис уйдёт сама в WhatsApp Business Наташи. Или отправь/удали вручную.
        </p>
      </div>

      {/* WhatsApp status */}
      <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl border ${si.cls}`}>
        <span className="text-lg leading-none">{si.dot}</span>
        <span className="text-sm font-medium flex-1">{si.label}</span>
        <button
          onClick={refreshState}
          disabled={refreshingState}
          className="text-xs px-2.5 py-1 rounded-lg bb-surface-soft hover:bb-surface-soft transition-all disabled:opacity-50"
        >
          {refreshingState ? '...' : '↻ Обновить'}
        </button>
      </div>

      {!isReady && (
        <div className="px-4 py-3 rounded-2xl bb-tint-warn border bb-edge bb-warn/90 text-xs leading-relaxed">
          ⚠️ Пока WhatsApp Наташи не в статусе 🟢 «Авторизован», отправка заблокирована (и ручная, и автоматическая).
        </div>
      )}

      {errorMsg && (
        <div className="px-4 py-3 rounded-2xl bb-tint-bad border bb-edge bb-bad text-sm flex items-start gap-3">
          <span className="flex-1">{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="bb-bad hover:bb-ink text-lg leading-none">×</button>
        </div>
      )}

      {/* Добавить сторис */}
      <div className="p-4 sm:p-5 rounded-2xl bb-surface border bb-edge space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold bb-ink-2 uppercase tracking-wider">➕ Новая сторис</h2>
          <label className="flex items-center gap-1.5 text-xs bb-ink-3 cursor-pointer">
            <input type="checkbox" checked={textOnly} onChange={e => { setTextOnly(e.target.checked); setFile(null); }} />
            Только текст (без фото/видео)
          </label>
        </div>

        {!textOnly && (
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            onChange={e => setFile(e.target.files?.[0] || null)}
            className="w-full text-sm bb-ink-2 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bb-surface-soft file:text-sm file:font-medium"
          />
        )}

        <textarea
          value={caption}
          onChange={e => setCaption(e.target.value)}
          placeholder={textOnly ? 'Текст сторис...' : 'Подпись (необязательно, до 1024 символов)...'}
          rows={2}
          className="w-full px-3 py-2 bb-surface-soft border bb-edge rounded-xl text-sm bb-ink outline-none focus:ring-2 focus:bb-ring resize-none"
        />

        <button
          onClick={addToQueue}
          disabled={uploading}
          className="px-4 py-2 bb-fill-accent hover:bb-fill-accent text-white text-sm font-medium rounded-xl transition-all disabled:opacity-50"
        >
          {uploading ? 'Загружаю...' : 'Добавить в очередь'}
        </button>
        <p className="text-[11px] bb-ink-4">
          Файл сразу грузится в Green API — своей ссылке отдельно быть негде, поэтому если сторис зависнет в очереди дольше ~2 недель без отправки, файл придётся загрузить заново.
        </p>
      </div>

      {/* Queue */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold bb-ink-2 uppercase tracking-wider">📋 Очередь ({waiting.length})</h2>
          {waiting.length > 0 && (
            clearing ? (
              <span className="text-xs px-3 py-1.5 bb-ink-3">Очищаю…</span>
            ) : confirmClear ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs bb-ink-3">Удалить все {waiting.length}? Это не отменить.</span>
                <button onClick={clearAll} className="text-xs px-3 py-1.5 bb-tint-bad border bb-edge bb-bad rounded-lg font-medium">Да, удалить</button>
                <button onClick={() => setConfirmClear(false)} className="text-xs px-3 py-1.5 bb-ink-4 hover:bb-ink-2">Отмена</button>
              </div>
            ) : (
              <button
                onClick={() => { setErrorMsg(null); setConfirmClear(true); }}
                className="text-xs px-3 py-1.5 bb-tint-bad hover:bb-tint-bad border bb-edge bb-bad hover:bb-bad rounded-lg transition-all"
              >
                🗑 Очистить всё
              </button>
            )
          )}
        </div>

        {waiting.length === 0 ? (
          <div className="p-8 rounded-2xl border bb-edge bb-surface text-center bb-ink-4 text-sm">
            Очередь пуста. Добавь сторис формой выше.
          </div>
        ) : (
          <div className="space-y-3">
            {waiting.map(item => {
              const stale = item.media_type !== 'text' && isStale(item.uploaded_at);
              return (
                <div key={item.id} className="rounded-2xl border bb-edge bb-surface p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bb-tint-accent bb-accent shrink-0">
                          {item.media_type === 'video' ? '🎬 видео' : item.media_type === 'image' ? '📷 фото' : '📝 текст'}
                        </span>
                        {stale && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bb-tint-warn bb-warn shrink-0" title="Ссылка на файл в Green API могла протухнуть (живёт ~15 дней)">
                            ⏳ ссылка может протухнуть
                          </span>
                        )}
                      </div>
                      <span className="text-sm bb-ink truncate block">{item.caption || <em className="bb-ink-4">без подписи</em>}</span>
                      <span className="text-[11px] bb-ink-4">создано {formatCreated(item.created_at)}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] bb-ink-3">⏰ Время (Дубай):</span>
                      <input
                        type="datetime-local"
                        value={toInput(item.scheduled_at)}
                        onChange={e => setSchedule(item, e.target.value)}
                        className="px-2 py-1.5 bb-surface-soft border bb-edge rounded-lg text-xs bb-ink outline-none focus:ring-2 focus:bb-ring"
                      />
                    </div>

                    <div className="flex items-center gap-2 ml-auto flex-wrap justify-end">
                      {busyId === item.id ? (
                        <div className="flex items-center gap-1.5 bb-ink-3 text-xs">
                          <div className="w-3 h-3 border-2 bb-spin rounded-full animate-spin" />
                          Обработка...
                        </div>
                      ) : confirmSendId === item.id ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs bb-warn">Отправить сейчас?</span>
                          <button onClick={() => sendOne(item)} className="text-xs px-2.5 py-1 bb-fill-accent hover:bb-fill-accent text-white rounded-lg transition-all">Да</button>
                          <button onClick={() => setConfirmSendId(null)} className="text-xs px-2.5 py-1 bb-surface-soft hover:bb-surface-soft bb-ink rounded-lg transition-all">Нет</button>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => setConfirmSendId(item.id)}
                            disabled={!isReady}
                            title={!isReady ? 'Отправка заблокирована: WhatsApp Наташи не авторизован' : ''}
                            className="flex items-center gap-1.5 bb-fill-accent hover:bb-fill-accent text-white text-xs font-medium py-1.5 px-3 rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            📤 Отправить
                          </button>
                          <button
                            onClick={() => deleteOne(item)}
                            disabled={busyId !== null}
                            className="flex items-center gap-1.5 bb-tint-bad text-xs font-medium py-1.5 px-3 rounded-lg transition-all disabled:opacity-50 hover:brightness-95"
                          >
                            🗑 Удалить
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {item.scheduled_at && (
                    <p className="text-[10px] bb-ok/80">
                      Уйдёт автоматически: <strong>{item.scheduled_at}</strong> (по Дубаю)
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
