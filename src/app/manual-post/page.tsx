"use client";

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Segmented from '@/components/Segmented';

// useSearchParams в пререндеренной странице требует Suspense-границы (Next 16).
// Варианты для поля «Floor». Раньше читались из колонки F листа CONFIG —
// ради четырёх неизменных слов приложение ходило в таблицу на каждой загрузке.
// Регистр как в базе: там «Low floor», а в таблице было «Low Floor», из-за чего
// в списке появлялись оба варианта.
const FLOOR_OPTIONS = ['Ground floor', 'Low floor', 'Middle floor', 'High floor'];

export default function ManualPostPage() {
  return (
    <Suspense fallback={null}>
      <ManualPostForm />
    </Suspense>
  );
}

function ManualPostForm() {
  const searchParams = useSearchParams();
  const [project, setProject] = useState('');
  const [postType, setPostType] = useState('NEW');
  const [parsedData, setParsedData] = useState<any>(null);
  const [sending, setSending] = useState(false);
  const [postPreview, setPostPreview] = useState('');


  const [searchingOldPrice, setSearchingOldPrice] = useState(false);
  const [oldPostsResult, setOldPostsResult] = useState<any>(null);

  const [lastSent, setLastSent] = useState<{ code: string; unit: string } | null>(null);
  const [approving, setApproving] = useState(false);
  const [sentPost, setSentPost] = useState<{ messageIds: number[]; chatId: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editableTgHtml, setEditableTgHtml] = useState('');
  const [editableWaText, setEditableWaText] = useState('');
  // Once the user manually edits a field, the live preview must stop overwriting it.
  const [editedByUser, setEditedByUser] = useState(false);
  // Раскрытые исходники занимают пол-экрана — держим их свёрнутыми, пока не понадобится правка.
  const [showTgSource, setShowTgSource] = useState(false);
  const [showWaSource, setShowWaSource] = useState(false);

  // ── source: paste (Sheets), db (Neon), c3 (C3 autopost from Sheets+Drive) ──
  const [source, setSource] = useState<'db' | 'c3'>('db');
  const [c3Units, setC3Units] = useState<string[]>([]);
  const [c3Unit, setC3Unit] = useState('');
  const [c3Loading, setC3Loading] = useState(false);
  const [unitQuery, setUnitQuery] = useState('');
  const [unitResults, setUnitResults] = useState<{ id: string; code: string; unitNumber: string; project: string }[]>([]);
  const [dbLoading, setDbLoading] = useState(false);
  const [emojiMissing, setEmojiMissing] = useState<{ projectId: string; projectName: string } | null>(null);
  const [emojiInput, setEmojiInput] = useState('');

  // Search units by code (dots optional) or name across all Abu Dhabi projects.
  // No project picker here: the unit row already carries its project.
  useEffect(() => {
    if (source !== 'db') return;
    const t = setTimeout(async () => {
      if (!unitQuery.trim()) { setUnitResults([]); return; }
      try {
        const params = new URLSearchParams({ q: unitQuery.trim() });
        const d = await fetch(`/api/unit-from-db?${params}`).then(r => r.json());
        setUnitResults(d.results || []);
      } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(t);
  }, [unitQuery, source]);

  const pickDbUnit = async (id: string) => {
    setDbLoading(true);
    setEditedByUser(false);
    setEmojiMissing(null);
    try {
      const d = await fetch(`/api/unit-from-db?id=${id}`).then(r => r.json());
      if (d.error) throw new Error(d.error);
      setParsedData(d.post);
      setProject(d.post.project || '');
      if (d.emojiMissing) {
        setEmojiMissing({ projectId: d.projectId, projectName: d.projectName });
        setEmojiInput('');
      }
      setUnitResults([]);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setDbLoading(false);
    }
  };

  // Deep link из «Юнитов без постов»: /manual-post?unit=<id> — сразу собираем пост,
  // пользователю остаётся выбрать тип. Один раз за загрузку страницы.
  const deepLinked = useRef(false);
  useEffect(() => {
    const id = searchParams.get('unit');
    if (!id || deepLinked.current) return;
    deepLinked.current = true;
    setSource('db');
    pickDbUnit(id);
  }, [searchParams]);

  const saveEmoji = async () => {
    if (!emojiMissing || !emojiInput.trim()) return;
    await fetch('/api/project-emoji', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...emojiMissing, emoji: emojiInput.trim() }),
    });
    // inject emoji into the current post so the preview updates immediately
    setParsedData((prev: any) => ({ ...prev, emoji: emojiInput.trim() }));
    setEmojiMissing(null);
  };

  // Load C3 units (from Google Sheets) when switching to the C3 source
  useEffect(() => {
    if (source !== 'c3' || c3Units.length) return;
    fetch('/api/c3-autopost')
      .then(r => r.json())
      .then(d => setC3Units(d.units || []))
      .catch(() => {});
  }, [source]);

  const pickC3Unit = async (unit: string) => {
    setC3Unit(unit);
    if (!unit) return;
    setC3Loading(true);
    setEditedByUser(false);
    try {
      const d = await fetch('/api/c3-autopost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit }),
      }).then(r => r.json());
      if (d.error) throw new Error(d.error);
      setParsedData(d.parsed);          // includes slideDataUrl from Drive
      setProject('C3 Garden Residence');
    } catch (e: any) {
      alert(e.message);
    } finally {
      setC3Loading(false);
    }
  };



  // Live preview update
  useEffect(() => {
    if (!parsedData) return;
    
    const debounce = setTimeout(async () => {
      try {
        const payload = { ...parsedData, postType, project };
        const res = await fetch('/api/build-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: payload })
        });
        const data = await res.json();
        // Always refresh the read-only reference; only re-seed the editable
        // fields while the user hasn't started editing them by hand.
        if (data.preview) {
          setPostPreview(data.preview);
          if (!editedByUser) setEditableTgHtml(data.preview);
        }
        if (data.whatsappText && !editedByUser) setEditableWaText(data.whatsappText);
      } catch (e) {
        console.error("Preview error", e);
      }
    }, 500);

    return () => clearTimeout(debounce);
  }, [parsedData, postType, project, editedByUser]);

  const handleSend = async () => {
    if (!parsedData) return;
    setSending(true);
    try {
      const payload = { ...parsedData, postType, project };
      const res = await fetch('/api/send-telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: payload, telegramHtmlOverride: editableTgHtml || undefined, whatsappTextOverride: editableWaText || undefined })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setLastSent({ code: parsedData.code || '', unit: parsedData.unit || '' });
      if (data.messageIds?.length) {
        setSentPost({ messageIds: data.messageIds, chatId: data.chatId });
      }
      setParsedData(null);
      setPostPreview('');
      setOldPostsResult(null);
      setProject('');
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSending(false);
    }
  };

  const updateField = (field: string, value: string) => {
    setParsedData((prev: any) => ({ ...prev, [field]: value }));
  };

  const [lastSearchedUnit, setLastSearchedUnit] = useState('');

  // Ищем по коду юнита: поле unit у виллы — это положение дома в ряду
  // («Middle»), искать по нему нечего.
  const handleSearchOldPrice = async (overrideUnit?: string) => {
    const unit = overrideUnit || parsedData?.code;
    if (!unit) {
      if (!overrideUnit) alert("Сначала укажите код юнита.");
      return;
    }
    setSearchingOldPrice(true);
    setOldPostsResult(null);
    try {
      const res = await fetch('/api/search-old-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      
      setOldPostsResult(data);
      
      // Нашёлся ровно один пост — подставляем его цену продажи как старую.
      // Original Price сюда не годится: это цена от застройщика, а не прошлая
      // цена объявления.
      if (data.posts?.length === 1 && data.extractedOldPrice) {
        setParsedData((prev: any) => ({ ...prev, oldPrice: data.extractedOldPrice, oldPostUrl: data.posts[0].url }));
      }
    } catch (e: any) {
      if (!overrideUnit) alert("Error searching: " + e.message);
    } finally {
      setSearchingOldPrice(false);
    }
  };

  useEffect(() => {
    if (!parsedData) return;
    if (postType !== 'PRICE_CHANGE' && postType !== 'NEW_PRICE') return;
    
    const unit = parsedData.code;
    if (unit && unit !== lastSearchedUnit) {
      setLastSearchedUnit(unit);
      handleSearchOldPrice(unit);
    }
  }, [parsedData?.code, parsedData?.unit, postType]);

  const isVilla = ['villa', 'townhouse', 'condo'].includes(String(parsedData?.objectType || '').toLowerCase());

  const handleApprove = async () => {
    if (!lastSent) return;
    setApproving(true);
    try {
      const res = await fetch('/api/approve-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: lastSent.code, unit: lastSent.unit }),
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      setLastSent(null);
    } catch (e: any) {
      alert('Ошибка: ' + e.message);
    } finally {
      setApproving(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto w-full">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2" style={{ color: 'var(--ink-900)' }}>Посты</h1>
        <p className="bb-ink-3">Возьми юнит из базы или из C3 — и собери пост.</p>
      </div>

      {lastSent && (
        <div className="flex flex-wrap items-center gap-3 mb-6 p-4 rounded-2xl bb-tint-ok border bb-edge">
          <div className="w-full sm:flex-1 text-sm bb-ok">
            Пост отправлен —{' '}
            <span className="font-mono font-semibold">{lastSent.code || lastSent.unit}</span>
            . Отметить как Approved в таблице?
          </div>
          <button
            onClick={handleApprove}
            disabled={approving}
            className="flex items-center gap-2 bb-fill-accent hover:bb-fill-accent text-white font-semibold py-2 px-5 rounded-xl transition-all disabled:opacity-50 disabled:pointer-events-none text-sm"
          >
            {approving ? (
              <>
                <div className="w-3.5 h-3.5 border-2 bb-spin rounded-full animate-spin" />
                Сохраняю...
              </>
            ) : '✓ Approved'}
          </button>
          {sentPost && (
            <button
              onClick={async () => {
                setDeleting(true);
                try {
                  const res = await fetch('/api/delete-telegram', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(sentPost),
                  });
                  const d = await res.json();
                  if (d.error) throw new Error(d.error);
                  setSentPost(null);
                  setLastSent(null);
                } catch (e: any) {
                  alert('Ошибка удаления: ' + e.message);
                } finally {
                  setDeleting(false);
                }
              }}
              disabled={deleting}
              className="flex items-center gap-1.5 bb-tint-bad hover:bb-tint-bad border bb-edge bb-bad hover:bb-bad font-medium py-2 px-4 rounded-xl transition-all disabled:opacity-50 disabled:pointer-events-none text-sm"
            >
              {deleting ? (
                <div className="w-3.5 h-3.5 border-2 bb-spin rounded-full animate-spin" />
              ) : '🗑️ Удалить из TG'}
            </button>
          )}
          <button
            onClick={() => { setLastSent(null); setSentPost(null); }}
            className="bb-ink-4 hover:bb-ink-2 text-xs transition-colors"
          >
            Пропустить
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 xl:gap-8">
        {/* Left Column: Input Form & Preview */}
        <div className="space-y-8">
          <div className="p-4 sm:p-6 rounded-2xl bb-surface border bb-edge relative overflow-hidden">

            <div className="space-y-5">
              {/* Source toggle */}
              <Segmented
                full
                value={source}
                onChange={val => {
                  setSource(val);
                  if (val === 'c3' && postType !== 'READY_TO_MOVE' && postType !== 'NEW_PRICE') setPostType('READY_TO_MOVE');
                }}
                options={[
                  { value: 'db', label: 'Из базы', icon: '🗄' },
                  { value: 'c3', label: 'C3', icon: '⭐' },
                ] as const}
              />

              {source === 'db' && (
                <>
                  <div className="relative">
                    <label className="block text-sm font-medium bb-ink-2 mb-2">Юнит — код (с точками или без) или название</label>
                    <input
                      type="text"
                      value={unitQuery}
                      onChange={e => setUnitQuery(e.target.value)}
                      placeholder="003·02·001 / 00302001 / Un-902"
                      className="w-full px-4 py-3 bb-surface-soft border bb-edge rounded-xl focus:ring-2 focus:bb-ring outline-none bb-ink bb-ph font-mono text-sm"
                    />
                    {unitResults.length > 0 && (
                      <div className="mt-2 bb-surface border bb-edge rounded-xl max-h-64 overflow-y-auto p-1 custom-scrollbar">
                        {unitResults.map(u => (
                          <div
                            key={u.id}
                            onClick={() => pickDbUnit(u.id)}
                            className="px-3 py-2.5 rounded-lg cursor-pointer text-sm bb-ink-2 hover:bb-surface-soft hover:bb-ink flex items-center justify-between gap-3"
                          >
                            <span className="font-mono bb-accent">{u.code}</span>
                            <span className="flex-1 truncate">{u.unitNumber}</span>
                            <span className="text-xs bb-ink-4 truncate">{u.project}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {dbLoading && <div className="mt-2 text-xs bb-ink-3">Загружаю юнит…</div>}
                    {!dbLoading && parsedData?.code && (
                      <div className="mt-2 flex items-center gap-2 text-xs bb-ink-3">
                        <span className="bb-ok">✓ Загружен:</span>
                        <span className="font-mono bb-accent">{parsedData.code}</span>
                        <span className="truncate">{parsedData.unitNumber || parsedData.unit}</span>
                        <span className="bb-ink-4 truncate">· {parsedData.project}</span>
                      </div>
                    )}
                  </div>

                  {emojiMissing && (
                    <div className="p-3 rounded-xl bb-tint-warn border bb-edge">
                      <div className="text-xs bb-warn mb-2">⚠️ У проекта «{emojiMissing.projectName}» не задан смайлик. Добавь — сохранится в базу:</div>
                      <div className="flex gap-2">
                        <input
                          value={emojiInput}
                          onChange={e => setEmojiInput(e.target.value)}
                          placeholder="🌿"
                          className="w-20 px-3 py-2 bb-surface-soft border bb-edge rounded-lg text-center text-lg outline-none focus:ring-2 focus:bb-ring"
                        />
                        <button onClick={saveEmoji} className="bb-fill-accent text-white text-sm font-bold px-4 rounded-full">Сохранить</button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {source === 'c3' && (
                <div>
                  <label className="block text-sm font-medium bb-ink-2 mb-2">Юнит C3 (из Google-таблицы)</label>
                  <select
                    value={c3Unit}
                    onChange={e => pickC3Unit(e.target.value)}
                    className="w-full px-4 py-3 bb-surface-soft border bb-edge rounded-xl focus:ring-2 focus:bb-ring outline-none bb-ink appearance-none cursor-pointer"
                  >
                    <option value="">— выбери юнит —</option>
                    {c3Units.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                  {c3Loading && <div className="mt-2 text-xs bb-ink-3">Загружаю юнит и слайд…</div>}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium bb-ink-2 mb-2">Post Type</label>
                <select
                  value={postType}
                  onChange={(e) => setPostType(e.target.value)}
                  className="w-full px-4 py-3 bb-surface-soft border bb-edge rounded-xl focus:ring-2 focus:bb-ring focus:bb-edge outline-none transition-all bb-ink appearance-none cursor-pointer"
                >
                  {source === 'c3' ? (
                    <>
                      <option value="READY_TO_MOVE">❗️ READY TO MOVE</option>
                      <option value="NEW_PRICE">🔥 NEW PRICE</option>
                    </>
                  ) : (
                    <>
                      <option value="NEW">🔥 NEW</option>
                      <option value="HOT_PRICE">🔥 HOT PRICE</option>
                      <option value="DISTRESS">⚡ QUICK SALE</option>
                      <option value="NEW_PRICE">🔥 NEW PRICE</option>
                      <option value="READY_TO_MOVE">❗️ READY TO MOVE</option>
                      <option value="PRICE_CHANGE">❗️ PRICE CHANGE</option>
                    </>
                  )}
                </select>
              </div>

            </div>
          </div>

          {postPreview && (
            <div className="p-4 sm:p-6 rounded-2xl bb-surface border bb-edge space-y-4">
              <h3 className="text-lg font-semibold bb-ink flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bb-fill-accent animate-pulse" />
                Preview &amp; Edit
              </h3>
              <div>
                <div
                  className="whitespace-pre-wrap font-sans text-[14px] bb-ink-2 bb-surface-soft p-4 rounded-xl border bb-edge leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: editableTgHtml.replace(/\n/g, '<br/>') }}
                />
                <button
                  type="button"
                  onClick={() => setShowTgSource(v => !v)}
                  className="mt-2 flex items-center gap-1.5 text-xs bb-ink-3 hover:bb-ink-2 transition-colors"
                >
                  <span className="inline-block w-3 text-center">{showTgSource ? '▾' : '▸'}</span>
                  Telegram (HTML)
                </button>
                {showTgSource && (
                  <textarea
                    rows={8}
                    value={editableTgHtml}
                    onChange={e => { setEditableTgHtml(e.target.value); setEditedByUser(true); }}
                    className="mt-1.5 w-full px-3 py-2 bb-surface-soft border bb-edge rounded-xl text-sm bb-ink-2 font-mono outline-none focus:ring-2 focus:bb-ring resize-y"
                    spellCheck={false}
                  />
                )}
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => setShowWaSource(v => !v)}
                  className="flex items-center gap-1.5 text-xs bb-ink-3 hover:bb-ink-2 transition-colors"
                >
                  <span className="inline-block w-3 text-center">{showWaSource ? '▾' : '▸'}</span>
                  WhatsApp
                </button>
                {showWaSource && (
                  <textarea
                    rows={8}
                    value={editableWaText}
                    onChange={e => { setEditableWaText(e.target.value); setEditedByUser(true); }}
                    className="mt-1.5 w-full px-3 py-2 bb-surface-soft border bb-edge rounded-xl text-sm bb-ink-2 font-mono outline-none focus:ring-2 focus:bb-ring resize-y"
                    spellCheck={false}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Parsed Data Editor */}
        {parsedData && (
          <div className="p-4 sm:p-6 rounded-2xl bb-surface border bb-edge space-y-6 h-fit">
            <div className="flex items-center justify-between border-b bb-edge pb-4">
              <h3 className="text-lg font-semibold bb-ink flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bb-fill-accent" />
                Edit Parsed Data
              </h3>
              <span className="text-xs font-medium px-2.5 py-1 rounded-md bb-tint-accent bb-accent border bb-edge uppercase tracking-wider">
                {parsedData.objectType} Format
              </span>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs bb-ink-3 mb-1">Unit / Code</label>
                  <input type="text" value={parsedData.code || parsedData.unit} onChange={(e) => updateField('code', e.target.value)} className="w-full px-3 py-2 bb-surface-soft border bb-edge rounded-lg text-sm bb-ink outline-none focus:ring-2 focus:bb-ring" />
                </div>
                {postType !== 'PRICE_CHANGE' && (
                  <div>
                    <label className="block text-xs bb-ink-3 mb-1">Type</label>
                    <input type="text" value={parsedData.type} onChange={(e) => updateField('type', e.target.value)} className="w-full px-3 py-2 bb-surface-soft border bb-edge rounded-lg text-sm bb-ink outline-none focus:ring-2 focus:bb-ring" />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs bb-ink-3 mb-1">Selling Price (AED)</label>
                  <input type="text" value={parsedData.sellingPrice} onChange={(e) => updateField('sellingPrice', e.target.value)} className="w-full px-3 py-2 bb-surface-soft border bb-edge rounded-lg text-sm bb-ok font-medium outline-none focus:ring-2 focus:bb-ring" />
                </div>
                <div>
                  <label className="block text-xs bb-ink-3 mb-1">Original Price (AED)</label>
                  <input type="text" value={parsedData.originalPrice || ''} onChange={(e) => updateField('originalPrice', e.target.value)} className="w-full px-3 py-2 bb-surface-soft border bb-edge rounded-lg text-sm bb-ink-2 outline-none focus:ring-2 focus:bb-ring" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {(postType === 'NEW_PRICE' || postType === 'PRICE_CHANGE') ? (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs bb-ink-3">Old Price (AED)</label>
                      <button 
                        onClick={() => handleSearchOldPrice()}
                        disabled={searchingOldPrice}
                        className="text-xs bb-accent hover:bb-accent font-medium"
                      >
                        {searchingOldPrice ? 'Searching...' : '🔍 Find in Channel'}
                      </button>
                    </div>
                    <input type="text" value={parsedData.oldPrice || ''} onChange={(e) => updateField('oldPrice', e.target.value)} className="w-full px-3 py-2 bb-surface-soft border bb-edge rounded-lg text-sm bb-bad outline-none focus:ring-2 focus:bb-ring" placeholder="Required" />
                    
                    {oldPostsResult && (
                      <div className="mt-3 p-3 bb-surface-soft border bb-edge rounded-lg max-h-60 overflow-y-auto custom-scrollbar">
                        <div className="text-xs bb-ink-3 mb-2">Ищем по Original Price из базы: <strong className="bb-ink">{oldPostsResult.originalPrice || '—'}</strong></div>
                        {oldPostsResult.posts?.length > 0 ? (
                          <div className="space-y-2">
                            {oldPostsResult.posts.map((post: any) => (
                              <div key={post.id} className="p-2 bb-surface border bb-edge rounded relative">
                                {post.date && <div className="absolute top-2 right-2 text-[9px] bb-ink-4/70">{post.date}</div>}
                                <p className="text-[10px] bb-ink-3 line-clamp-3 mb-2 pr-12">{post.text}</p>
                                <div className="flex items-center justify-between">
                                  <a href={post.url} target="_blank" rel="noreferrer" className="text-[10px] bb-accent hover:underline">View Post</a>
                                  {post.extractedSellingPrice && (
                                    <button onClick={() => {
                                      updateField('oldPrice', post.extractedSellingPrice);
                                      updateField('oldPostUrl', post.url);
                                    }} className="text-[10px] bb-tint-accent bb-accent px-2 py-0.5 rounded hover:bb-tint-accent">
                                      Use Price ({post.extractedSellingPrice})
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-[10px] bb-bad">{oldPostsResult.message || 'Старый пост не найден.'}</div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div></div> /* Empty div to keep grid layout */
                )}

                {postType !== 'PRICE_CHANGE' && (
                  <div>
                    <label className="block text-xs bb-ink-3 mb-1">Approx. Rental Rate</label>
                    <input type="text" value={parsedData.approxRentalRate || ''} onChange={(e) => updateField('approxRentalRate', e.target.value)} className="w-full px-3 py-2 bb-surface-soft border bb-edge rounded-lg text-sm bb-ink-2 outline-none focus:ring-2 focus:bb-ring" placeholder="e.g. 10%" />
                  </div>
                )}
              </div>

              {postType !== 'PRICE_CHANGE' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t bb-edge pt-4">
                  {!isVilla && (
                    <div>
                      <label className="block text-xs bb-ink-3 mb-1">Area (sqm)</label>
                      <input type="text" value={parsedData.areaM2 || ''} onChange={(e) => updateField('areaM2', e.target.value)} className="w-full px-3 py-2 bb-surface-soft border bb-edge rounded-lg text-sm bb-ink outline-none focus:ring-2 focus:bb-ring" />
                    </div>
                  )}
                  {isVilla && (
                    <>
                      <div>
                        <label className="block text-xs bb-ink-3 mb-1">Gross Area (sqm)</label>
                        <input type="text" value={parsedData.grossAreaM2 || ''} onChange={(e) => updateField('grossAreaM2', e.target.value)} className="w-full px-3 py-2 bb-surface-soft border bb-edge rounded-lg text-sm bb-ink outline-none focus:ring-2 focus:bb-ring" />
                      </div>
                      <div>
                        <label className="block text-xs bb-ink-3 mb-1">Plot Area (sqm)</label>
                        <input type="text" value={parsedData.plotAreaM2 || ''} onChange={(e) => updateField('plotAreaM2', e.target.value)} className="w-full px-3 py-2 bb-surface-soft border bb-edge rounded-lg text-sm bb-ink outline-none focus:ring-2 focus:bb-ring" />
                      </div>
                    </>
                  )}
                  {!isVilla && (
                    <div>
                      <label className="block text-xs bb-ink-3 mb-1">Floor</label>
                      {FLOOR_OPTIONS.length > 0 ? (
                        <select
                          value={parsedData.floor || ''}
                          onChange={(e) => updateField('floor', e.target.value)}
                          className="w-full px-3 py-2 bb-surface-soft border bb-edge rounded-lg text-sm bb-ink outline-none focus:ring-2 focus:bb-ring appearance-none cursor-pointer"
                        >
                          <option value="">Select floor...</option>
                          {/* value from the DB may not be in the sheet list — keep it selectable */}
                          {parsedData.floor && !FLOOR_OPTIONS.includes(parsedData.floor) && (
                            <option value={parsedData.floor}>{parsedData.floor}</option>
                          )}
                          {FLOOR_OPTIONS.map((f, idx) => (
                            <option key={idx} value={f}>{f}</option>
                          ))}
                        </select>
                      ) : (
                        <input type="text" value={parsedData.floor || ''} onChange={(e) => updateField('floor', e.target.value)} className="w-full px-3 py-2 bb-surface-soft border bb-edge rounded-lg text-sm bb-ink outline-none focus:ring-2 focus:bb-ring" />
                      )}
                    </div>
                  )}
                </div>
              )}

              {postType !== 'PRICE_CHANGE' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {!isVilla && (
                    <div>
                      <label className="block text-xs bb-ink-3 mb-1">View</label>
                      <input type="text" value={parsedData.view || ''} onChange={(e) => updateField('view', e.target.value)} className="w-full px-3 py-2 bb-surface-soft border bb-edge rounded-lg text-sm bb-ink outline-none focus:ring-2 focus:bb-ring" />
                    </div>
                  )}
                  <div className={isVilla ? "sm:col-span-2" : ""}>
                    <label className="block text-xs bb-ink-3 mb-1">Handover</label>
                    <input type="text" value={parsedData.handover || ''} onChange={(e) => updateField('handover', e.target.value)} className="w-full px-3 py-2 bb-surface-soft border bb-edge rounded-lg text-sm bb-ink outline-none focus:ring-2 focus:bb-ring" />
                  </div>
                </div>
              )}

              {isVilla && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t bb-edge pt-4">
                  <div>
                    <label className="block text-xs bb-ink-3 mb-1">Row (Single / Double)</label>
                    <input type="text" value={parsedData.rowName || ''} onChange={(e) => updateField('rowName', e.target.value)} className="w-full px-3 py-2 bb-surface-soft border bb-edge rounded-lg text-sm bb-ink outline-none focus:ring-2 focus:bb-ring" />
                  </div>
                  <div>
                    <label className="block text-xs bb-ink-3 mb-1">Unit position (Middle / Corner)</label>
                    <input type="text" value={parsedData.unit || ''} onChange={(e) => updateField('unit', e.target.value)} className="w-full px-3 py-2 bb-surface-soft border bb-edge rounded-lg text-sm bb-ink outline-none focus:ring-2 focus:bb-ring" />
                  </div>
                </div>
              )}

              {postType !== 'PRICE_CHANGE' && (
                <div className="pt-4 border-t bb-edge">
                  <label className="block text-sm font-medium bb-ink-2 mb-2">Slide Image</label>
                  
                  {parsedData.slideDataUrl ? (
                    <div className="relative w-full rounded-xl overflow-hidden border bb-edge mb-3 group">
                      <img src={parsedData.slideDataUrl} alt="Slide preview" className="w-full h-auto block max-h-72 object-contain" />
                      <div className="absolute inset-0 bb-surface opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <button 
                          onClick={() => updateField('slideDataUrl', '')}
                          className="bb-fill-ink hover:bb-fill-ink text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                        >
                          Remove Image
                        </button>
                      </div>
                    </div>
                  ) : (
                    <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed bb-edge rounded-xl hover:bb-edge hover:bb-tint-accent transition-all cursor-pointer">
                      <div className="flex flex-col items-center justify-center pt-5 pb-6">
                        <svg className="w-8 h-8 mb-3 bb-ink-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
                        <p className="mb-2 text-sm bb-ink-3"><span className="font-semibold bb-accent">Click to upload</span> or drag and drop</p>
                        <p className="text-xs bb-ink-4">JPG, PNG или WEBP — слайд юнита</p>
                      </div>
                      <input 
                        type="file" 
                        className="hidden" 
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          
                          const reader = new FileReader();
                          reader.onload = (event) => {
                            if (event.target?.result) {
                              // Ensure we also save the filename so the API can use it
                              setParsedData({
                                ...parsedData,
                                slideDataUrl: event.target.result as string,
                                slideName: file.name
                              });
                            }
                          };
                          reader.readAsDataURL(file);
                        }}
                      />
                    </label>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={handleSend}
              disabled={sending}
              className="w-full bb-fill-accent hover: hover: bb-ink font-medium py-3 px-6 rounded-xl transition-all shadow-lg bb-lift active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none mt-6"
            >
              {sending ? 'Sending to Review Group...' : 'Send to Telegram'}
            </button>

          </div>
        )}
      </div>
    </div>
  );
}
