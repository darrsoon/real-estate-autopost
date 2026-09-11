import { NextResponse } from 'next/server';
import { getStoryQueue, deleteStoryQueueItemById } from '@/lib/story-queue/store';
import { isDue } from '@/lib/whatsapp/dispatch';
import { dispatchStoryItem } from '@/lib/whatsapp/story-dispatch';
import { getInstanceStateNatalia } from '@/lib/whatsapp/green-api-natalia';

// Дергается тем же внешним пингером (cron-job.org), что и /api/cron/wa-send —
// отдельный роут и отдельный секрет не нужен, но можно завести свой URL с тем
// же CRON_SECRET, если частоту проверки захотят развести.
// Авторизация: заголовок Authorization ИЛИ ?secret=.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get('secret');
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}` && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const items = await getStoryQueue();

  // Не шлём, пока инстанс Наташи не в статусе authorized — по той же логике,
  // что и в /api/cron/wa-send.
  const state = await getInstanceStateNatalia().catch(() => 'unknown');
  if (state !== 'authorized') {
    return NextResponse.json({ ok: true, skipped: `state=${state}` });
  }

  const due = items.filter(i => i.status === 'WAITING' && i.scheduled_at && isDue(i.scheduled_at));

  const results: { id: string; ok?: boolean; error?: string }[] = [];

  for (const item of due) {
    try {
      await dispatchStoryItem(item);
      await deleteStoryQueueItemById(item.id);
      results.push({ id: item.id, ok: true });
    } catch (e: any) {
      results.push({ id: item.id, error: e?.response?.data ? JSON.stringify(e.response.data) : e.message });
    }
  }

  return NextResponse.json({ ok: true, sent: results.filter(r => r.ok).length, results });
}
