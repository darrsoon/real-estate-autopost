"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import Segmented from '@/components/Segmented';

const convertRuToEn = (str: string) => {
  const ru = 'йцукенгшщзхъфывапролджэячсмитьбю.ЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭЯЧСМИТЬБЮ,';
  const en = 'qwertyuiop[]asdfghjkl;\'zxcvbnm,./QWERTYUIOP{}ASDFGHJKL:"ZXCVBNM<>?';
  let res = '';
  for (let i = 0; i < str.length; i++) {
    const idx = ru.indexOf(str[i]);
    res += idx !== -1 ? en[idx] : str[i];
  }
  return res;
};

// Адрес фида для Meta Commerce Manager — его же можно просто открыть и посмотреть.
const FEED_URL = '/api/catalog-feed';

type PreviewRow = {
  home_listing_id: string;
  unit_code?: string;
  name: string;
  description: string;
  price: string;
  image0: string;
  property_type: string;
  num_beds: string;
  area_size: string;
  address_addr1: string;
  construction_status: string;
  [key: string]: string | undefined;
};

type CatalogItem = {
  'home_listing_id': string;
  'name': string;
  'description': string;
  'price': string;
  'image[0].url': string;
  'image[1].url': string;
  'property_type': string;
  'num_beds': string;
  'area_size': string;
  'address.addr1': string;
};

function CoverDropZone({ listingId, existingUrl, onUploaded }: {
  listingId: string;
  existingUrl?: string;
  onUploaded: (url: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(existingUrl || '');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setUploading(true);
    setError('');
    const form = new FormData();
    form.append('file', file);
    form.append('listingId', listingId);
    try {
      const res = await fetch('/api/catalog-cover-upload', { method: 'POST', body: form });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setPreview(data.url);
      onUploaded(data.url);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) upload(file);
  };

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      className={`relative mt-3 rounded-xl border-2 border-dashed cursor-pointer transition-all overflow-hidden
 ${dragging ? 'bb-edge bb-tint-accent' : preview ? 'bb-edge bb-surface-soft' : 'bb-edge hover:bb-edge bb-surface-soft hover:bb-tint-accent'}`}
      style={{ height: preview ? 80 : 52 }}
    >
      <input ref={inputRef} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); }} />

      {uploading ? (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-xs bb-ink-3">
          <div className="w-3.5 h-3.5 border-2 bb-spin rounded-full animate-spin" />
          Uploading...
        </div>
      ) : preview ? (
        <div className="absolute inset-0 flex items-center gap-3 px-3">
          <img src={preview} alt="cover" className="h-14 w-14 object-cover rounded-lg border bb-edge flex-shrink-0"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          <div className="flex-1 min-w-0">
            <p className="text-xs bb-ok font-medium">Cover uploaded ✓</p>
            <p className="text-[10px] bb-ink-4">Drag new image to replace</p>
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-xs bb-ink-4">
          <span className="text-base">🖼</span>
          Drag cover image here or click to upload
        </div>
      )}

      {error && (
        <div className="absolute bottom-0 inset-x-0 px-2 py-1 bb-tint-bad bb-bad text-[10px] text-center">{error}</div>
      )}
    </div>
  );
}

const typeLabel = (pt: string) => pt === 'house' ? 'villa' : (pt || '');

const typeColor = (pt: string) => {
  const t = (pt || '').toLowerCase();
  if (t === 'apartment') return 'bb-tint-accent bb-accent bb-edge';
  if (t === 'house') return 'bb-tint-warn bb-warn bb-edge';
  if (t === 'townhouse') return 'bb-tint-accent bb-accent bb-edge';
  return 'bb-surface-soft bb-ink-2';
};

export default function CatalogPage() {
  const [tab, setTab] = useState<'add' | 'manage'>('add');

  // Add tab state
  const [projects, setProjects] = useState<string[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectSearch, setProjectSearch] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [project, setProject] = useState('');

  // Step: 'input' → 'preview' → 'saved'
  const [step, setStep] = useState<'input' | 'preview' | 'saved'>('input');
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [savedRows, setSavedRows] = useState<PreviewRow[]>([]);
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  // Manage tab state
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [manageCovers, setManageCovers] = useState<Record<string, string>>({});

  // Таблица-черновик по всем проектам — из неё вручную заполняют каталог в Meta.
  const [draft, setDraft] = useState<{ url: string; title: string; projects: number; listings: number } | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);

  const makeDraftSheet = async () => {
    setDraftBusy(true);
    setError('');
    try {
      const d = await fetch('/api/catalog-draft-sheet', { method: 'POST' }).then(r => r.json());
      if (d.error) throw new Error(d.error);
      setDraft(d);
      window.open(d.url, '_blank', 'noopener');
    } catch (e: any) {
      setError('Не удалось собрать таблицу: ' + e.message);
    } finally {
      setDraftBusy(false);
    }
  };

  // Проекты из нашей базы — те же, что в трекере «Рассылок».
  useEffect(() => {
    fetch('/api/project-emoji?names=1')
      .then(r => r.json())
      .then(d => { if (d.names?.length) setProjects(d.names); })
      .catch(() => {})
      .finally(() => setProjectsLoading(false));
  }, []);

  const loadItems = useCallback(async () => {
    setItemsLoading(true);
    try {
      const res = await fetch('/api/catalog-items');
      const data = await res.json();
      const rows = data.rows || [];
      setItems(rows);
      const covers: Record<string, string> = {};
      rows.forEach((r: CatalogItem) => { if (r['image[0].url']) covers[r['home_listing_id']] = r['image[0].url']; });
      setManageCovers(covers);
    } catch {} finally {
      setItemsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'manage') loadItems();
  }, [tab, loadItems]);

  const handleParse = async () => {
    if (!project) return;
    setParsing(true);
    setError('');
    try {
      const res = await fetch('/api/catalog-from-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectName: project }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setPreviewRows(data.rows || []);
      setStep('preview');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setParsing(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/catalog-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: previewRows }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSavedRows(previewRows);
      setStep('saved');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const filteredProjects = projects.filter(p =>
    p.toLowerCase().includes(projectSearch.toLowerCase())
  );

  return (
    <div className="max-w-6xl mx-auto w-full space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-1" style={{ color: 'var(--ink-900)' }}>Каталог</h1>
        <p className="bb-ink-3 text-sm">Build your WhatsApp catalog for Meta Commerce Manager.</p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'add', label: 'Добавить юниты', icon: '➕' },
            { value: 'manage', label: 'Каталог', icon: '📋' },
          ] as const}
        />
        <a href={FEED_URL} target="_blank" rel="noopener noreferrer"
          className="bb-btn bb-btn-ghost py-2 px-4 text-[13px]">
          Фид для Meta ↗
        </a>
        <button
          onClick={makeDraftSheet}
          disabled={draftBusy}
          title="Соберёт гугл-таблицу по всем проектам — заголовки и тексты для ручного ввода"
          className="bb-btn bb-btn-ghost py-2 px-4 text-[13px] disabled:opacity-50">
          {draftBusy ? 'Собираю таблицу…' : '📄 Таблица для ручного ввода'}
        </button>
      </div>

      {draft && (
        <div className="p-3 rounded-xl bb-tint-ok border bb-edge text-sm flex items-center gap-3 flex-wrap">
          <span className="bb-ok">✓ Готово: {draft.projects} проектов, {draft.listings} карточек</span>
          <a href={draft.url} target="_blank" rel="noopener noreferrer" className="bb-accent underline">
            {draft.title} ↗
          </a>
          <span className="bb-ink-4 text-xs">
            Описание разложено по строкам: выдели столбик ячеек и копируй — вставится без кавычек.
          </span>
        </div>
      )}

      {/* ── ADD TAB ── */}
      {tab === 'add' && (
        <div className="space-y-6">

          {/* STEP 1: Input */}
          {step === 'input' && (
            <div className="p-4 sm:p-6 rounded-2xl bb-surface border bb-edge relative max-w-2xl">
              <div className="space-y-6">
                <div className="relative">
                  <label className="block text-sm font-medium bb-ink-2 mb-2">Project Name</label>
                  {projectsLoading ? (
                    <div className="w-full px-4 py-3 bb-surface-soft border bb-edge rounded-xl bb-ink-4 flex items-center gap-2">
                      <div className="w-4 h-4 border-2 bb-spin rounded-full animate-spin" />
                      Loading projects...
                    </div>
                  ) : (
                    <div className="relative">
                      <input type="text" value={projectSearch}
                        onChange={e => { setProjectSearch(convertRuToEn(e.target.value)); setIsDropdownOpen(true); }}
                        onFocus={() => setIsDropdownOpen(true)}
                        onBlur={() => setTimeout(() => setIsDropdownOpen(false), 200)}
                        placeholder="Search project..."
                        className="w-full px-4 py-3 bb-surface-soft border bb-edge rounded-xl focus:ring-2 focus:bb-ring focus:bb-edge outline-none transition-all bb-ink bb-ph"
                      />
                      {isDropdownOpen && (
                        <div className="absolute z-50 w-full mt-2 bb-surface border bb-edge rounded-xl shadow-xl bb-lift max-h-60 overflow-y-auto p-1">
                          {filteredProjects.length > 0 ? filteredProjects.map(p => (
                            <div key={p} onClick={() => { setProject(p); setProjectSearch(p); setIsDropdownOpen(false); }}
                              className={`px-3 py-2.5 rounded-lg cursor-pointer text-sm transition-colors ${project === p ? 'bb-tint-accent bb-accent font-medium' : 'bb-ink-2 hover:bb-surface-soft hover:bb-ink'}`}>
                              {p}
                            </div>
                          )) : <div className="px-4 py-3 text-sm bb-ink-4 text-center">No projects found</div>}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <p className="text-xs bb-ink-3">
                  Юниты берутся из базы: по каждому типу — самый дешёвый доступный.
                </p>

                {error && (
                  <div className="px-4 py-3 bb-tint-bad border bb-edge rounded-xl bb-bad text-sm">{error}</div>
                )}

                <button onClick={handleParse} disabled={parsing || !project}
                  className="w-full bb-fill-accent hover: hover: bb-ink font-medium py-3 px-6 rounded-xl transition-all shadow-lg bb-lift active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none">
                  {parsing ? 'Собираю…' : 'Собрать из базы →'}
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: Preview & Edit */}
          {step === 'preview' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <button onClick={() => { setStep('input'); setError(''); }}
                    className="text-sm bb-ink-3 hover:bb-ink transition-colors">← Back</button>
                  <span className="text-sm font-semibold bb-ink">{previewRows.length} types found — edit if needed</span>
                </div>
                <button onClick={handleSave} disabled={saving}
                  className="bb-fill-accent hover:bb-fill-accent text-white text-sm font-medium px-5 py-2 rounded-xl transition-all disabled:opacity-50">
                  {saving ? 'Saving...' : '✓ Save to CATALOG'}
                </button>
              </div>

              {error && (
                <div className="px-4 py-3 bb-tint-bad border bb-edge rounded-xl bb-bad text-sm">{error}</div>
              )}

              <div className="space-y-4">
                {previewRows.map((row, idx) => (
                  <div key={row.home_listing_id} className="p-4 sm:p-5 rounded-2xl bb-surface border bb-edge">
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${typeColor(row.property_type)}`}>
                        {typeLabel(row.property_type)}
                      </span>
                      <span className="text-xs font-mono bb-ink-4">{row.home_listing_id}</span>
                      {row.unit_code && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border bb-edge bb-ink-3 font-mono">
                          {row.unit_code}
                        </span>
                      )}
                      <span className="text-xs bb-ok ml-auto">{row.price}</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-medium bb-ink-3 mb-1">Title</label>
                          <input
                            value={row.name}
                            onChange={e => setPreviewRows(rows => rows.map((r, i) => i === idx ? { ...r, name: e.target.value } : r))}
                            className="w-full px-3 py-2 bb-surface-soft border bb-edge rounded-lg text-sm bb-ink outline-none focus:bb-edge focus:ring-1 focus:bb-ring"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium bb-ink-3 mb-1">Cover image</label>
                          <CoverDropZone
                            listingId={row.home_listing_id}
                            existingUrl={coverUrls[row.home_listing_id] || row.image0}
                            onUploaded={url => {
                              setCoverUrls(p => ({ ...p, [row.home_listing_id]: url }));
                              setPreviewRows(rows => rows.map((r, i) => i === idx ? { ...r, image0: url } : r));
                            }}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium bb-ink-3 mb-1">Description</label>
                        <textarea
                          rows={7}
                          value={row.description}
                          onChange={e => setPreviewRows(rows => rows.map((r, i) => i === idx ? { ...r, description: e.target.value } : r))}
                          className="w-full px-3 py-2 bb-surface-soft border bb-edge rounded-lg text-sm bb-ink outline-none focus:bb-edge focus:ring-1 focus:bb-ring font-mono resize-none"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end pt-2">
                <button onClick={handleSave} disabled={saving}
                  className="bb-fill-accent hover:bb-fill-accent text-white font-medium px-6 py-3 rounded-xl transition-all disabled:opacity-50">
                  {saving ? 'Saving...' : '✓ Save to CATALOG'}
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: Saved — add covers */}
          {step === 'saved' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bb-fill-accent animate-pulse" />
                  <span className="text-sm font-semibold bb-ink">{savedRows.length} types saved</span>
                  <span className="text-xs bb-ink-4">Add cover images below</span>
                </div>
                <button onClick={() => { setStep('input'); setSavedRows([]); setCoverUrls({}); setProject(''); setProjectSearch(''); }}
                  className="text-xs bb-ink-3 hover:bb-ink transition-colors">+ Add another project</button>
              </div>
              <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                {savedRows.map((row) => (
                  <div key={row.home_listing_id} className="p-4 rounded-xl bb-surface border bb-edge">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${typeColor(row.property_type)}`}>
                            {typeLabel(row.property_type)}
                          </span>
                          <span className="text-xs font-mono bb-ink-4">{row.home_listing_id}</span>
                        </div>
                        <p className="text-sm font-medium bb-ink leading-tight">{row.name}</p>
                      </div>
                      <span className="text-sm font-semibold bb-ok whitespace-nowrap">{row.price}</span>
                    </div>
                    <CoverDropZone
                      listingId={row.home_listing_id}
                      existingUrl={coverUrls[row.home_listing_id]}
                      onUploaded={url => setCoverUrls(p => ({ ...p, [row.home_listing_id]: url }))}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── MANAGE TAB ── */}
      {tab === 'manage' && (
        <div className="p-4 sm:p-6 rounded-2xl bb-surface border bb-edge relative overflow-hidden">
          {itemsLoading ? (
            <div className="flex items-center gap-2 bb-ink-4 py-8 justify-center">
              <div className="w-4 h-4 border-2 bb-spin rounded-full animate-spin" />
              Loading catalog...
            </div>
          ) : items.length === 0 ? (
            <p className="bb-ink-4 text-sm py-8 text-center">No items in catalog yet.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-semibold bb-ink">{items.length} units in CATALOG</span>
                <button onClick={loadItems} className="text-xs bb-ink-3 hover:bb-ink transition-colors">↻ Refresh</button>
              </div>
              <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
                {items.map(item => (
                  <div key={item['home_listing_id']} className="p-4 rounded-xl bb-surface-soft border bb-edge">
                    <div className="flex items-start gap-3">
                      {(manageCovers[item['home_listing_id']] || item['image[0].url']) ? (
                        <img src={manageCovers[item['home_listing_id']] || item['image[0].url']} alt=""
                          className="w-14 h-14 rounded-lg object-cover flex-shrink-0 border bb-edge"
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      ) : (
                        <div className="w-14 h-14 rounded-lg bb-surface-soft border bb-edge flex items-center justify-center flex-shrink-0">
                          <span className="bb-ink-4 text-xs">no img</span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${typeColor(item['property_type'])}`}>
                            {typeLabel(item['property_type'])}
                          </span>
                          <span className="text-xs bb-ink-4">{item['address.addr1']}</span>
                        </div>
                        <p className="text-sm font-medium bb-ink leading-tight truncate">{item['name']}</p>
                        <p className="text-xs bb-ok mt-0.5">{item['price']}</p>
                      </div>
                    </div>
                    <CoverDropZone
                      listingId={item['home_listing_id']}
                      existingUrl={manageCovers[item['home_listing_id']] || item['image[0].url']}
                      onUploaded={url => setManageCovers(p => ({ ...p, [item['home_listing_id']]: url }))}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
