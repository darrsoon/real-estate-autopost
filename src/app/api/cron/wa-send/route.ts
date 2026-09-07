import { NextResponse } from 'next/server';
import { getWaQueue, deleteWaQueueItemById, markWaQueueItemSent } from '@/lib/wa-queue/store';
import { dispatchWaItem, isDue } from '@/lib/whatsapp/dispatch';
import { getInstanceState } from '@/lib/whatsapp/green-api';
import { forwardToChannel } from '@/lib/telegram/mtproto';

// Called by an external pinger (cron-job.org) every few minutes.
// Auth via Authorization header OR ?secret= query param.
//
// С 07.09.2026: каждый созревший пост (scheduled_at наступил) уходит САМ и в
// TG-канал (форвардом из чата-модератора), и в WhatsApp — раньше отсюда
// уходил только WhatsApp, и Даша ожидала, что «стоит дата — пост уйдёт
// целиком», а Telegram-канал ждал ручного нажатия кнопки в самом чате.
// Каждый канал отмечается отдельным флагом (tg_sent/wa_sent), запись из
// очереди удаляется только когда сделаны ОБА — иначе при сбое одного канала
// второй бы отправился повторно на следующий тик крона.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get('secret');
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}` && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { config, items } = await getWaQueue();

  // Порядок больше не важен: у записи постоянный id, удаление соседа её не сдвигает.
  const due = items.filter(i => i.status === 'WAITING' && i.scheduled_at && isDue(i.scheduled_at));

  // Не шлём WhatsApp, пока номер не в порядке (жёлтая карточка/бан/офлайн) — это
  // только усугубит блокировку. Telegram-канал от статуса WhatsApp не зависит,
  // поэтому его пробуем всегда, даже если с WhatsApp сейчас нельзя.
  const waState = config.wa_chatid ? await getInstanceState().catch(() => 'unknown') : 'unknown';
  const waReady = !!config.wa_chatid && waState === 'authorized';

  const reviewChatId = process.env.TELEGRAM_REVIEW_CHAT_ID;
  const channelId = process.env.TELEGRAM_CHANNEL_ID;

  const results: { label: string; tg: string; wa: string }[] = [];

  for (const item of due) {
    const r = { label: item.label, tg: '', wa: '' };

    // ── Telegram-канал ──────────────────────────────────────────────────
    if (item.tg_sent) {
      r.tg = 'already';
    } else {
      const mainIds = item.tg_main_ids ? item.tg_main_ids.split(',').map(Number).filter(Boolean) : [];
      const fromChat = item.tg_review_chatid || reviewChatId;
      if (mainIds.length && fromChat && channelId) {
        try {
          await forwardToChannel(fromChat, mainIds, channelId);
          await markWaQueueItemSent(item.id, { tg: true });
          item.tg_sent = true;
          r.tg = 'ok';
        } catch (e: any) {
          r.tg = `error: ${e.message}`;
        }
      } else {
        // Нечего форвардить (старый пост до этой доработки, или TG-канал не
        // настроен) — считаем эту часть неприменимой, чтобы не блокировать
        // удаление записи навсегда.
        await markWaQueueItemSent(item.id, { tg: true });
        item.tg_sent = true;
        r.tg = 'skip';
      }
    }

    // ── WhatsApp ────────────────────────────────────────────────────────
    if (item.wa_sent) {
      r.wa = 'already';
    } else if (!waReady) {
      r.wa = `skip (state=${waState})`;
    } else {
      try {
        const chatId = item.item_chatid || config.wa_chatid;
        await dispatchWaItem(item, chatId);
        await markWaQueueItemSent(item.id, { wa: true });
        item.wa_sent = true;
        r.wa = 'ok';
      } catch (e: any) {
        r.wa = `error: ${e?.response?.data ? JSON.stringify(e.response.data) : e.message}`;
      }
    }

    if (item.tg_sent && item.wa_sent) {
      await deleteWaQueueItemById(item.id);
    }

    results.push(r);
  }

  return NextResponse.json({
    ok: true,
    sent: results.filter(r => r.wa === 'ok').length,
    results,
  });
}
