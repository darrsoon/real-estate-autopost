// Очередь сторис для WhatsApp Business Наташи. Сделана по образцу wa_queue
// (src/lib/wa-queue/store.ts), но своя таблица и свой смысл полей: тут не
// драйвовский file_id, а прямая ссылка Green API (urlFile), потому что
// файл грузится сразу в момент добавления в очередь (см. uploadFileNatalia
// в lib/whatsapp/green-api-natalia.ts) — своего облачного хранилища не
// заводим, Green API отдаёт временную (15 дней) ссылку сам.
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.META_DB_URL!);

export type StoryMediaType = 'image' | 'video' | 'text';

export interface StoryQueueItem {
  id: string;
  created_at: string;
  caption: string;
  media_type: StoryMediaType;
  /** Ссылка Green API (urlFile), пусто для текстовой сторис. Живёт 15 дней с момента загрузки. */
  media_url: string;
  file_name: string;
  /** Когда файл загружен в Green API — на это опирается проверка на протухание ссылки. */
  uploaded_at: string;
  /** «YYYY-MM-DD HH:MM» по Дубаю, пусто — без расписания. */
  scheduled_at: string;
  status: string;
}

let ready: Promise<void> | null = null;
function ensureTables() {
  ready ??= (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS story_queue (
        id text PRIMARY KEY,
        created_at timestamptz NOT NULL DEFAULT now(),
        caption text NOT NULL DEFAULT '',
        media_type text NOT NULL DEFAULT 'image',
        media_url text NOT NULL DEFAULT '',
        file_name text NOT NULL DEFAULT '',
        uploaded_at timestamptz NOT NULL DEFAULT now(),
        scheduled_at text NOT NULL DEFAULT '',
        status text NOT NULL DEFAULT 'WAITING'
      )
    `;
  })();
  return ready;
}

function toItem(r: any): StoryQueueItem {
  return {
    id: String(r.id),
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    caption: r.caption ?? '',
    media_type: (r.media_type || 'image') as StoryMediaType,
    media_url: r.media_url ?? '',
    file_name: r.file_name ?? '',
    uploaded_at: r.uploaded_at instanceof Date ? r.uploaded_at.toISOString() : String(r.uploaded_at ?? ''),
    scheduled_at: r.scheduled_at ?? '',
    status: r.status || 'WAITING',
  };
}

export async function getStoryQueue(): Promise<StoryQueueItem[]> {
  await ensureTables();
  const rows = (await sql`SELECT * FROM story_queue ORDER BY created_at`) as any[];
  return rows.map(toItem);
}

export async function addStoryQueueItem(
  caption: string,
  mediaType: StoryMediaType,
  mediaUrl: string,
  fileName: string,
  scheduledAt = '',
): Promise<string> {
  await ensureTables();
  // Тот же приём, что в wa_queue: id — метка времени, при коллизии берём
  // следующую свободную миллисекунду.
  let id = Date.now();
  for (let attempt = 0; attempt < 20; attempt++) {
    const rows = (await sql`
      INSERT INTO story_queue (id, caption, media_type, media_url, file_name, scheduled_at, status)
      VALUES (${String(id)}, ${caption}, ${mediaType}, ${mediaUrl}, ${fileName}, ${scheduledAt}, 'WAITING')
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `) as any[];
    if (rows.length) return String(id);
    id++;
  }
  throw new Error('Не удалось подобрать свободный id для очереди сторис');
}

export async function updateStoryQueueItemSchedule(id: string, scheduledAt: string) {
  await ensureTables();
  await sql`UPDATE story_queue SET scheduled_at = ${scheduledAt} WHERE id = ${id}`;
}

export async function updateStoryQueueItemStatus(id: string, status: string) {
  await ensureTables();
  await sql`UPDATE story_queue SET status = ${status} WHERE id = ${id}`;
}

/** Удаляет одну запись. true — если она существовала. */
export async function deleteStoryQueueItemById(id: string): Promise<boolean> {
  await ensureTables();
  const rows = (await sql`DELETE FROM story_queue WHERE id = ${id} RETURNING id`) as any[];
  return rows.length > 0;
}

/** Удаляет пачкой; возвращает, сколько реально удалено. */
export async function deleteStoryQueueItems(ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  await ensureTables();
  const rows = (await sql`DELETE FROM story_queue WHERE id = ANY(${ids}) RETURNING id`) as any[];
  return rows.length;
}
