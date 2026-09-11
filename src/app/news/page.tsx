"use client";

import { useRef, useState } from 'react';
import { upload } from '@vercel/blob/client';

// Экранирует HTML-спецсимволы для безопасного предпросмотра **жирного** текста.
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function boldPreviewHtml(text: string): string {
  return escapeHtml(text).replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br/>');
}

// Convert datetime-local "YYYY-MM-DDTHH:MM" <-> хранимый формат "YYYY-MM-DD HH:MM"
// (тот же формат, что и на странице «Расписание WA» — можно потом донастроить там же).
const fromInput = (s: string) => (s ? s.replace('T', ' ').slice(0, 16) : '');

export default function NewsPage() {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [scheduledAt, setScheduledAt] = useState('');
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [sentScheduledAt, setSentScheduledAt] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Выделил текст → нажал «Ж» (или Ctrl/Cmd+B) → вокруг выделения ставятся
  // ** — вручную печатать звёздочки не нужно. Повторное нажатие на уже
  // выделенный жирный кусок снимает выделение (toggle).
  const toggleBold = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart: start, selectionEnd: end, value } = ta;
    if (start === end) return; // нечего выделять

    const before = value.slice(0, start);
    const selected = value.slice(start, end);
    const after = value.slice(end);

    const alreadyBold =
      before.endsWith('**') && after.startsWith('**');

    let next: string;
    let newStart: number;
    let newEnd: number;

    if (alreadyBold) {
      next = before.slice(0, -2) + selected + after.slice(2);
      newStart = start - 2;
      newEnd = end - 2;
    } else if (selected.startsWith('**') && selected.endsWith('**') && selected.length >= 4) {
      const inner = selected.slice(2, -2);
      next = before + inner + after;
      newStart = start;
      newEnd = start + inner.length;
    } else {
      next = before + '**' + selected + '**' + after;
      newStart = start + 2;
      newEnd = end + 2;
    }

    setText(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(newStart, newEnd);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      toggleBold();
    }
  };

  const handleSend = async () => {
    if (!text.trim()) return setErrorMsg('Введите текст новости');
    setSending(true);
    setErrorMsg(null);
    try {
      let blobUrl: string | undefined;
      let mediaType: 'image' | 'video' | undefined;
      let fileName: string | undefined;

      if (file) {
        mediaType = file.type.startsWith('video/') ? 'video' : 'image';
        fileName = file.name;
        const blob = await upload(file.name, file, {
          access: 'public',
          handleUploadUrl: '/api/story-schedule/blob-upload',
        });
        blobUrl = blob.url;
      }

      const scheduledAtValue = fromInput(scheduledAt);

      const res = await fetch('/api/send-news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim(), blobUrl, mediaType, fileName, scheduledAt: scheduledAtValue }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setSent(true);
      setSentScheduledAt(scheduledAtValue);
      setText('');
      setFile(null);
      setScheduledAt('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto w-full space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-2" style={{ color: 'var(--ink-900)' }}>Новости</h1>
        <p className="bb-ink-3 text-sm">
          Пиши текст новости вручную, приложи фото или видео (необязательно) — черновик уйдёт на проверку
          в тот же Telegram-чат, что и Посты. Можно сразу поставить дату и время отправки ниже, либо
          оставить пустым и выставить позже на странице «Расписание WA» — как у обычных постов: уйдёт сама
          в WA-группу и в TG-канал, либо отправь вручную кнопкой в чате.
        </p>
      </div>

      {sent && (
        <div className="p-4 rounded-2xl bb-tint-ok border bb-edge bb-ok text-sm">
          {sentScheduledAt
            ? <>✓ Черновик отправлен на проверку. Уйдёт автоматически: <strong>{sentScheduledAt}</strong> (по Дубаю).</>
            : <>✓ Черновик отправлен на проверку. Найди его в «Расписании WA», чтобы выставить время.</>}
        </div>
      )}

      {errorMsg && (
        <div className="px-4 py-3 rounded-2xl bb-tint-bad border bb-edge bb-bad text-sm flex items-start gap-3">
          <span className="flex-1">{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="bb-bad hover:bb-ink text-lg leading-none">×</button>
        </div>
      )}

      <div className="p-4 sm:p-6 rounded-2xl bb-surface border bb-edge space-y-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium bb-ink-2">Текст новости</label>
            <button
              type="button"
              onClick={toggleBold}
              title="Выделить жирным (Ctrl/Cmd+B)"
              className="w-7 h-7 flex items-center justify-center rounded-lg bb-surface-soft hover:bb-surface-soft font-bold text-sm bb-ink-2"
            >
              Ж
            </button>
          </div>
          <p className="text-xs bb-ink-4 mb-2">
            Выдели текст мышкой и нажми «Ж» (или Ctrl/Cmd+B) — жирность сама подстроится и под Telegram, и под WhatsApp.
          </p>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={10}
            placeholder={'Aldar открыл новый парк в Al Reem Island 🌳\n\nКороткое описание новости...\n\n📅 04.09.2026\n🔗 Источник: ...'}
            className="w-full px-4 py-3 bb-surface-soft border bb-edge rounded-xl focus:ring-2 focus:bb-ring outline-none bb-ink text-sm resize-y"
          />
          {text && (
            <div className="mt-2 p-3 rounded-xl bb-surface-soft border bb-edge text-sm bb-ink-2 whitespace-pre-wrap"
              dangerouslySetInnerHTML={{ __html: boldPreviewHtml(text) }}
            />
          )}
        </div>

        <div>
          <label className="block text-sm font-medium bb-ink-2 mb-2">Фото или видео (необязательно)</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            onChange={e => setFile(e.target.files?.[0] || null)}
            className="w-full text-sm bb-ink-2 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bb-surface-soft file:text-sm file:font-medium"
          />
        </div>

        <div>
          <label className="block text-sm font-medium bb-ink-2 mb-2">⏰ Время отправки (Дубай, необязательно)</label>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={e => setScheduledAt(e.target.value)}
            className="px-3 py-2 bb-surface-soft border bb-edge rounded-xl text-sm bb-ink outline-none focus:ring-2 focus:bb-ring"
          />
          <p className="text-[11px] bb-ink-4 mt-1">
            Не заполнено — время можно будет поставить позже на странице «Расписание WA».
          </p>
        </div>

        <button
          onClick={handleSend}
          disabled={sending}
          className="w-full bb-fill-accent hover: hover: bb-ink font-medium py-3 px-6 rounded-xl transition-all shadow-lg bb-lift active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
        >
          {sending ? 'Отправляю на проверку...' : 'Отправить на проверку'}
        </button>
      </div>
    </div>
  );
}
