import { NextResponse } from 'next/server';
import {
  getStoryQueue,
  addStoryQueueItem,
  updateStoryQueueItemSchedule,
  deleteStoryQueueItemById,
  deleteStoryQueueItems,
  StoryMediaType,
} from '@/lib/story-queue/store';
import { dispatchStoryItem } from '@/lib/whatsapp/story-dispatch';
import { getInstanceStateNatalia, uploadFileNatalia } from '@/lib/whatsapp/green-api-natalia';

// Загрузка файла в Green API + отправка сторис — обе операции по сети,
// дефолтных секунд может не хватить (как и в wa-schedule).
export const maxDuration = 120;

export async function GET() {
  try {
    const items = await getStoryQueue();
    const state = await getInstanceStateNatalia().catch(() => 'unknown');
    return NextResponse.json({ items, state });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Добавить сторис в очередь. Файл приходит с фронта уже загруженным
    // в Vercel Blob (см. stories/page.tsx, обходит лимит тела функции
    // Vercel ~4.5MB) — здесь скачиваем его с blobUrl на сервере, грузим
    // в Green API (UploadFile) и в очередь кладём готовую ссылку urlFile,
    // после чего временную копию в Blob удаляем.
    if (body.action === 'add') {
      const { caption, mediaType, blobUrl, fileName, contentType, scheduledAt } = body as {
        caption: string;
        mediaType: StoryMediaType;
        blobUrl?: string;
        fileName?: string;
        contentType?: string;
        scheduledAt?: string;
      };

      let mediaUrl = '';
      if (mediaType !== 'text') {
        if (!blobUrl) return NextResponse.json({ error: 'Нет файла' }, { status: 400 });
        const fileRes = await fetch(blobUrl);
        if (!fileRes.ok) return NextResponse.json({ error: 'Не удалось скачать файл из хранилища' }, { status: 500 });
        const arrayBuffer = await fileRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        mediaUrl = await uploadFileNatalia(buffer, fileName || 'story', contentType || 'application/octet-stream');
        try {
          const { del } = await import('@vercel/blob');
          await del(blobUrl);
        } catch {}
      }

      const id = await addStoryQueueItem(caption || '', mediaType, mediaUrl, fileName || '', scheduledAt || '');
      return NextResponse.json({ ok: true, id });
    }

    if (body.action === 'schedule') {
      const { id, scheduledAt } = body as { id: string; scheduledAt: string };
      await updateStoryQueueItemSchedule(id, scheduledAt || '');
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'send-one') {
      const { id } = body as { id: string };
      const items = await getStoryQueue();
      const item = items.find(i => i.id === id);
      if (!item) return NextResponse.json({ error: 'Сторис не найдена' }, { status: 404 });

      const state = await getInstanceStateNatalia().catch(() => 'unknown');
      if (state !== 'authorized') {
        return NextResponse.json({ error: `WhatsApp Наташи не готов (статус: ${state}). Отправка заблокирована.` }, { status: 409 });
      }

      try {
        await dispatchStoryItem(item);
      } catch (e: any) {
        const detail = e?.response?.data ? JSON.stringify(e.response.data) : e.message;
        return NextResponse.json({ error: detail }, { status: 500 });
      }
      await deleteStoryQueueItemById(id);
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'delete') {
      const { id } = body as { id: string };
      await deleteStoryQueueItemById(id);
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'clear-all') {
      const items = await getStoryQueue();
      const cleared = await deleteStoryQueueItems(items.map(i => i.id));
      return NextResponse.json({ ok: true, cleared });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
