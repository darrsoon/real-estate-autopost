import { NextResponse } from 'next/server';
import { del } from '@vercel/blob';
import { sendNewsDraft, updateNewsReviewMessage } from '@/lib/telegram/bot';
import { uploadToWaQueue } from '@/lib/google/drive';
import { addWaQueueItem } from '@/lib/wa-queue/store';

export const maxDuration = 300;

// Превращает **жирный** маркдаун автора в HTML для Telegram и *жирный* для
// WhatsApp. Экранируем HTML-спецсимволы ДО подстановки тегов, чтобы <b> не
// сломался, если в тексте случайно есть < или &.
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function toTelegramHtml(text: string): string {
  return escapeHtml(text).replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>');
}

function toWhatsAppText(text: string): string {
  return text.replace(/\*\*([\s\S]+?)\*\*/g, '*$1*');
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const text: string = (body.text || '').trim();
    const blobUrl: string | undefined = body.blobUrl;
    const mediaType: 'image' | 'video' | undefined = body.mediaType;
    const fileName: string = body.fileName || (mediaType === 'video' ? 'news.mp4' : 'news.jpg');
    // «YYYY-MM-DD HH:MM» по Дубаю, уже сконвертировано на клиенте; пусто — без расписания
    // (тогда время ставится позже на странице «Расписание WA», как и раньше).
    const scheduledAt: string = body.scheduledAt || '';

    if (!text) throw new Error('Текст новости обязателен');

    const chatId = process.env.TELEGRAM_REVIEW_CHAT_ID;
    if (!chatId) throw new Error('TELEGRAM_REVIEW_CHAT_ID not configured');

    const telegramHtml = toTelegramHtml(text);
    const whatsappText = toWhatsAppText(text);

    let mediaBuffer: Buffer | null = null;
    if (blobUrl) {
      const res = await fetch(blobUrl);
      if (!res.ok) throw new Error(`Не удалось скачать файл из Blob: ${res.status}`);
      mediaBuffer = Buffer.from(await res.arrayBuffer());
    }

    const r1 = await sendNewsDraft(
      chatId,
      mediaBuffer ? { type: mediaType === 'video' ? 'video' : 'photo', source: mediaBuffer } : null,
      telegramHtml,
    );

    // Кладём медиа в Drive — Blob временный (мы его удалим ниже), а
    // «Расписание WA» может сработать через дни: крону в момент отправки
    // нужно постоянное хранилище файла, а не временную ссылку на Blob.
    let driveFileId = '';
    if (mediaBuffer) {
      const mimeType = mediaType === 'video' ? 'video/mp4' : 'image/jpeg';
      driveFileId = await uploadToWaQueue(mediaBuffer, fileName, mimeType);
    }

    const label = `NEWS – ${text.replace(/\s+/g, ' ').slice(0, 60)}`;
    // itemChatId оставляем пустым — Даша подтвердила, что для новостей нет
    // отдельной WA-группы, они уходят в ту же группу, что и обычные Посты.
    // Крон (`/api/cron/wa-send`) сам подставит общий config.wa_chatid, когда
    // item_chatid пуст — см. src/app/api/cron/wa-send/route.ts.
    const waQueueId = await addWaQueueItem(
      label,
      whatsappText,
      driveFileId,
      scheduledAt,
      '',
      r1.mainIds,
      chatId,
      mediaType || 'image',
    );

    await updateNewsReviewMessage(chatId, r1.reviewMsgId, r1.ids, r1.mainIds, waQueueId).catch(() => {});

    if (blobUrl) {
      await del(blobUrl).catch(() => {});
    }

    return NextResponse.json({ ok: true, messageIds: r1.ids, chatId, waQueueId });
  } catch (error: any) {
    console.error('send-news error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
