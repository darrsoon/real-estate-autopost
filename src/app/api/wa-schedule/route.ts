import { NextResponse } from 'next/server';
import {
  getWaQueue,
  updateWaQueueItemSchedule,
  updateWaQueueConfig,
  deleteWaQueueItemById,
  deleteWaQueueItems,
  markWaQueueItemSent,
} from '@/lib/wa-queue/store';
import { dispatchWaItem } from '@/lib/whatsapp/dispatch';
import { getInstanceState } from '@/lib/whatsapp/green-api';
import { forwardToChannel } from '@/lib/telegram/mtproto';

// Отправка одного поста тянет фото из Drive и грузит его в Green API —
// дефолтных секунд на это не хватает.
export const maxDuration = 120;

export async function GET() {
  try {
    const data = await getWaQueue();
    const state = await getInstanceState().catch(() => 'unknown');
    return NextResponse.json({ ...data, state });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Set/clear a per-post scheduled time
    if (body.action === 'schedule') {
      const { id, scheduledAt } = body as { id: string; scheduledAt: string };
      await updateWaQueueItemSchedule(id, scheduledAt || '');
      return NextResponse.json({ ok: true });
    }

    // Manually send one post right now (both TG channel + WhatsApp), then
    // remove it from the queue. Каждый канал отмечается своим флагом
    // (tg_sent/wa_sent) — как и в кроне, чтобы повторное нажатие «Отправить»
    // после частичной ошибки не задвоило уже ушедший канал.
    if (body.action === 'send-one') {
      const { id } = body as { id: string };
      const { config, items } = await getWaQueue();
      const item = items.find(i => i.id === id);
      if (!item) return NextResponse.json({ error: 'Пост не найден' }, { status: 404 });

      const warnings: string[] = [];

      // ── Telegram-канал ────────────────────────────────────────────────
      if (!item.tg_sent) {
        const mainIds = item.tg_main_ids ? item.tg_main_ids.split(',').map(Number).filter(Boolean) : [];
        const fromChat = item.tg_review_chatid || process.env.TELEGRAM_REVIEW_CHAT_ID;
        const channelId = process.env.TELEGRAM_CHANNEL_ID;
        if (mainIds.length && fromChat && channelId) {
          try {
            await forwardToChannel(fromChat, mainIds, channelId);
            await markWaQueueItemSent(id, { tg: true });
          } catch (e: any) {
            warnings.push(`TG-канал: ${e.message}`);
          }
        } else {
          // Нечего форвардить (старый пост до этой доработки, или TG не
          // настроен) — не блокируем ручную отправку WhatsApp из-за этого.
          await markWaQueueItemSent(id, { tg: true });
        }
      }

      // ── WhatsApp ─────────────────────────────────────────────────────
      if (!config.wa_chatid) return NextResponse.json({ error: 'Chat ID не настроен', warnings }, { status: 400 });

      const state = await getInstanceState().catch(() => 'unknown');
      if (state !== 'authorized') {
        return NextResponse.json({ error: `WhatsApp не готов (статус: ${state}). Отправка заблокирована.`, warnings }, { status: 409 });
      }

      try {
        await dispatchWaItem(item, item.item_chatid || config.wa_chatid);
        await markWaQueueItemSent(id, { wa: true });
      } catch (e: any) {
        const detail = e?.response?.data ? JSON.stringify(e.response.data) : e.message;
        return NextResponse.json({ error: detail, warnings }, { status: 500 });
      }

      // Удаляем только когда оба канала подтверждены (перечитываем — на
      // случай, если TG форварднулся только что).
      const fresh = (await getWaQueue()).items.find(i => i.id === id);
      if (fresh && fresh.tg_sent && fresh.wa_sent) {
        await deleteWaQueueItemById(id);
      }

      return NextResponse.json({ ok: true, warnings: warnings.length ? warnings : undefined });
    }

    // Delete a post from the queue without sending
    if (body.action === 'delete') {
      const { id } = body as { id: string };
      await deleteWaQueueItemById(id);
      return NextResponse.json({ ok: true });
    }

    // Clear the whole queue. Настройка чата лежит отдельной таблицей, так что
    // чистка очереди её не задевает.
    if (body.action === 'clear-all') {
      const { items } = await getWaQueue();
      const cleared = await deleteWaQueueItems(items.map(i => i.id));
      return NextResponse.json({ ok: true, cleared });
    }

    // Save the WhatsApp chat id
    if (body.action === 'config') {
      const { waChatId } = body as { waChatId: string };
      await updateWaQueueConfig(waChatId);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
