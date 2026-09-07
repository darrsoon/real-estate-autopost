"use client";

import { useEffect, useState } from 'react';

interface WaItem {
  id: string;
  created_at: string;
  label: string;
  wa_text: string;
  drive_file_id: string;
  scheduled_at: string;
  status: string;
}

interface WaConfig {
  wa_chatid: string;
}

export default function ScheduledPage() {
  const [items, setItems] = useState<WaItem[]>([]);
  const [config, setConfig] = useState<WaConfig>({ wa_chatid: '' });
  const [loading, setLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [chatId, setChatId] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmSendId, setConfirmSendId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [state, setState] = useState<string>('');
  const [refreshingState, setRefreshingState] = useState(false);

  // Роут при таймауте/падении отдаёт не JSON, а HTML-страницу ошибки — тогда
  // res.json() бросал невнятное «Unexpected token», и на кнопку это выглядело
  // как «ничего не происходит». Показываем настоящий код ответа.
  const postAction = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/wa-schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    let data: any = null;
    try { data = JSON.parse(raw); } catch { /* не JSON — ниже */ }

    if (!data) {
      const hint = res.status === 504 ? 'сервер не уложился во время' : `код ${res.status}`;
      throw new Error(`${hint}. Ответ: ${raw.slice(0, 120) || '(пусто)'}`);
    }
    if (data.error) throw new Error(data.error);
    return data;
  };

  const load = async () => {
    const data = await fetch('/api/wa-schedule').then(r => r.json());
    setConfig(data.config);
    setItems(data.items || []);
    setState(data.state || 'unknown');
    // Без запасного значения: раньше сюда подставлялся личный номер, и при
    // пустой настройке рассылка ушла бы человеку, а не в рабочую группу.
    setChatId(data.config?.wa_chatid || '');
  };

  const refreshState = async () => {
    setRefreshingState(true);
    try {
      const data = await fetch('/api/wa-schedule').then(r => r.json());
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
    notAuthorized: { dot: '🔴', label: 'Не авторизован — переподключи WhatsApp в Green API', cls: 'bb-tint-bad bb-edge bb-bad' },
    sleepMode: { dot: '🟡', label: 'Спящий режим — телефон офлайн', cls: 'bb-tint-warn bb-edge bb-warn' },
    starting: { dot: '⚪', label: 'Запускается...', cls: 'bb-surface-soft bb-ink-2' },
    unknown: { dot: '⚪', label: 'Статус неизвестен', cls: 'bb-surface-soft bb-ink-3' },
  };
  const si = stateInfo[state] || stateInfo.unknown;

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  // Convert stored "YYYY-MM-DD HH:MM" <-> datetime-local "YYYY-MM-DDTHH:MM"
  const toInput = (s: string) => (s ? s.replace(' ', 'T').slice(0, 16) : '');
  const fromInput = (s: string) => (s ? s.replace('T', ' ').slice(0, 16) : '');

  const setSchedule = async (item: WaItem, inputVal: string) => {
    const scheduledAt = fromInput(inputVal);
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, scheduled_at: scheduledAt } : i));
    await fetch('/api/wa-schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'schedule', id: item.id, scheduledAt }),
    });
  };

  const sendOne = async (item: WaItem) => {
    setConfirmSendId(null);
    setBusyId(item.id);
    try {
      const data = await postAction({ action: 'send-one', id: item.id });
      if (data?.warnings?.length) {
        setErrorMsg('Отправлено, но есть предупреждение: ' + data.warnings.join('; '));
      }
      await load();
    } catch (e: any) {
      setErrorMsg('Ошибка отправки: ' + e.message);
    } finally {
      setBusyId(null);
    }
  };

  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  // Никаких confirm()/alert() на этой странице: Chrome после нескольких
  // диалогов подряд предлагает «не показывать больше», и дальше confirm()
  // молча возвращает false — кнопка выглядит мёртвой, запрос не уходит.
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

  const deleteOne = async (item: WaItem) => {
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

  const [configMsg, setConfigMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const saveChatId = async () => {
    if (!chatId.trim()) return setConfigMsg({ ok: false, text: 'Введи Chat ID' });
    setSavingConfig(true);
    setConfigMsg(null);
    try {
      await postAction({ action: 'config', waChatId: chatId.trim() });
      setConfig(prev => ({ ...prev, wa_chatid: chatId.trim() }));
      setConfigMsg({ ok: true, text: 'Сохранено' });
    } catch (e: any) {
      setConfigMsg({ ok: false, text: 'Ошибка: ' + e.message });
    } finally {
      setSavingConfig(false);
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
        <h1 className="text-3xl font-bold tracking-tight mb-1" style={{ color: 'var(--ink-900)' }}>Расписание WA</h1>
        <p className="bb-ink-3 text-sm">
          Посты попадают сюда после «Send to Telegram». Задай время по Дубаю — пост сам уйдёт и в TG-канал, и в WhatsApp. Кнопка «Отправить» — то же самое, но прямо сейчас, не дожидаясь времени.
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
          ⚠️ Пока WhatsApp не в статусе 🟢 «Авторизован», отправка в WhatsApp заблокирована (и ручная, и автоматическая) — чтобы не усугублять блокировку. Переждите ограничение и не шлите тесты. На TG-канал по расписанию это не влияет — он уйдёт всё равно.
        </div>
      )}

      {errorMsg && (
        <div className="px-4 py-3 rounded-2xl bb-tint-bad border bb-edge bb-bad text-sm flex items-start gap-3">
          <span className="flex-1">{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="bb-bad hover:bb-ink text-lg leading-none">×</button>
        </div>
      )}

      {/* Chat ID */}
      <div className="p-4 sm:p-5 rounded-2xl bb-surface border bb-edge space-y-3">
        <h2 className="text-sm font-semibold bb-ink-2 uppercase tracking-wider">⚙️ WhatsApp Chat ID</h2>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={chatId}
            onChange={e => setChatId(e.target.value)}
            placeholder="120363...@g.us для группы или номер@c.us для личного чата"
            className="flex-1 min-w-[200px] px-3 py-2 bb-surface-soft border bb-edge rounded-xl text-sm bb-ink outline-none focus:ring-2 focus:bb-ring font-mono"
          />
          <button
            onClick={saveChatId}
            disabled={savingConfig}
            className="px-4 py-2 bb-surface-soft hover:bb-surface-soft bb-ink text-sm font-medium rounded-xl transition-all disabled:opacity-50 whitespace-nowrap"
          >
            {savingConfig ? '...' : 'Сохранить'}
          </button>
        </div>
        <p className="text-[11px] bb-ink-4">
          Личный чат: <code className="bb-ink-3">номер@c.us</code> · Группа: <code className="bb-ink-3">id@g.us</code>
        </p>
        {configMsg && (
          <p className={`text-[11px] ${configMsg.ok ? 'bb-ok' : 'bb-bad'}`}>
            {configMsg.ok ? '✓ ' : '⚠️ '}{configMsg.text}
          </p>
        )}
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
                <button
                  onClick={clearAll}
                  className="text-xs px-3 py-1.5 bb-tint-bad border bb-edge bb-bad rounded-lg font-medium"
                >
                  Да, удалить
                </button>
                <button
                  onClick={() => setConfirmClear(false)}
                  className="text-xs px-3 py-1.5 bb-ink-4 hover:bb-ink-2"
                >
                  Отмена
                </button>
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
            Очередь пуста. Посты появятся здесь после нажатия «Send to Telegram» на странице Manual Post.
          </div>
        ) : (
          <div className="space-y-3">
            {waiting.map(item => (
              <div key={item.id} className="rounded-2xl border bb-edge bb-surface p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium bb-ink truncate">{item.label}</span>
                      {item.drive_file_id && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bb-tint-accent bb-accent shrink-0">📷 фото</span>
                      )}
                    </div>
                    <span className="text-[11px] bb-ink-4">создан {formatCreated(item.created_at)}</span>
                  </div>

                  <button
                    onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                    className="text-[11px] bb-accent hover:bb-accent shrink-0"
                  >
                    {expandedId === item.id ? 'скрыть ▲' : 'текст ▼'}
                  </button>
                </div>

                {expandedId === item.id && (
                  <pre className="text-[11px] bb-ink-2 whitespace-pre-wrap font-sans bb-surface-soft p-3 rounded-xl border bb-edge max-h-48 overflow-y-auto">
                    {item.wa_text}
                  </pre>
                )}

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
                          title={!isReady ? 'Отправка заблокирована: WhatsApp не авторизован' : ''}
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
                    Уйдёт автоматически (TG-канал + WhatsApp): <strong>{item.scheduled_at}</strong> (по Дубаю)
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
