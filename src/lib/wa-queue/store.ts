// Очередь постов в WhatsApp. Раньше жила в листе WA_QUEUE гугл-таблицы —
// теперь в нашей базе. Из-за таблицы всё было завязано на номер строки: удалил
// одну — остальные съехали, и крон мог отправить не тот пост. Здесь у записи
// есть постоянный id.
//
// Картинка по-прежнему лежит в Google Drive, в базе только её id.
//
// С 07.09.2026: запись знает ещё и про свою публикацию в Telegram-канал
// (tg_main_ids/tg_review_chatid — какие сообщения в чате-модераторе форварднуть,
// tg_sent — уже форварднули или нет) — это нужно, чтобы крон по расписанию мог
// отправить пост САМ и в TG-канал, и в WhatsApp, а не только в WhatsApp.
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.META_DB_URL!);

export interface WaQueueItem {
  id: string;
  created_at: string;
  label: string;
  wa_text: string;
  drive_file_id: string;
  /** «YYYY-MM-DD HH:MM» по Дубаю, пусто — без расписания. */
  scheduled_at: string;
  status: string;
  /** Чат конкретного поста; пусто — общий чат из настроек. */
  item_chatid: string;
  /** ID сообщений в чате-модераторе (через запятую) — их форвардим в TG-канал. */
  tg_main_ids: string;
  /** Чат-модератор, где лежат tg_main_ids (обычно TELEGRAM_REVIEW_CHAT_ID). */
  tg_review_chatid: string;
  /** Уже отправлено в TG-канал (крон это уже сделал или нечего было слать). */
  tg_sent: boolean;
  /** Уже отправлено в WhatsApp (крон это уже сделал). */
  wa_sent: boolean;
}

export interface WaQueueConfig {
  wa_chatid: string;
}

let ready: Promise<void> | null = null;
function ensureTables() {
  ready ??= (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS wa_queue (
        id text PRIMARY KEY,
        created_at timestamptz NOT NULL DEFAULT now(),
        label text NOT NULL DEFAULT '',
        wa_text text NOT NULL DEFAULT '',
        drive_file_id text NOT NULL DEFAULT '',
        scheduled_at text NOT NULL DEFAULT '',
        status text NOT NULL DEFAULT 'WAITING',
        item_chatid text NOT NULL DEFAULT ''
      )
    `;
    // Догоняем схему для баз, созданных до фичи «TG-канал + WA по расписанию».
    await sql`ALTER TABLE wa_queue ADD COLUMN IF NOT EXISTS tg_main_ids text NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE wa_queue ADD COLUMN IF NOT EXISTS tg_review_chatid text NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE wa_queue ADD COLUMN IF NOT EXISTS tg_sent boolean NOT NULL DEFAULT false`;
    await sql`ALTER TABLE wa_queue ADD COLUMN IF NOT EXISTS wa_sent boolean NOT NULL DEFAULT false`;
    await sql`
      CREATE TABLE IF NOT EXISTS wa_queue_settings (
        key text PRIMARY KEY,
        value text NOT NULL
      )
    `;
  })();
  return ready;
}

function toItem(r: any): WaQueueItem {
  return {
    id: String(r.id),
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    label: r.label ?? '',
    wa_text: r.wa_text ?? '',
    drive_file_id: r.drive_file_id ?? '',
    scheduled_at: r.scheduled_at ?? '',
    status: r.status || 'WAITING',
    item_chatid: r.item_chatid ?? '',
    tg_main_ids: r.tg_main_ids ?? '',
    tg_review_chatid: r.tg_review_chatid ?? '',
    tg_sent: !!r.tg_sent,
    wa_sent: !!r.wa_sent,
  };
}

export async function getWaQueue(): Promise<{ config: WaQueueConfig; items: WaQueueItem[] }> {
  await ensureTables();
  const [rows, cfg] = await Promise.all([
    sql`SELECT * FROM wa_queue ORDER BY created_at` as Promise<any[]>,
    sql`SELECT value FROM wa_queue_settings WHERE key = 'wa_chatid'` as Promise<any[]>,
  ]);
  return {
    config: { wa_chatid: cfg[0]?.value ?? '' },
    items: rows.map(toItem),
  };
}

export async function addWaQueueItem(
  label: string,
  waText: string,
  driveFileId: string,
  scheduledAt = '',
  itemChatId = '',
  tgMainIds: number[] = [],
  tgReviewChatId = '',
): Promise<string> {
  await ensureTables();
  // id — это метка времени, и он же первичный ключ. Рассылка добавляет посты
  // подряд в цикле, так что две вставки могут попасть в одну миллисекунду;
  // тогда берём следующую свободную. Формат остаётся числовым: id уходит в
  // callback-кнопку Telegram, где важна длина.
  let id = Date.now();
  for (let attempt = 0; attempt < 20; attempt++) {
    const rows = (await sql`
      INSERT INTO wa_queue (id, label, wa_text, drive_file_id, scheduled_at, status, item_chatid, tg_main_ids, tg_review_chatid)
      VALUES (${String(id)}, ${label}, ${waText}, ${driveFileId}, ${scheduledAt}, 'WAITING', ${itemChatId}, ${tgMainIds.join(',')}, ${tgReviewChatId})
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `) as any[];
    if (rows.length) return String(id);
    id++;
  }
  throw new Error('Не удалось подобрать свободный id для очереди WhatsApp');
}

export async function updateWaQueueItemStatus(id: string, status: string) {
  await ensureTables();
  await sql`UPDATE wa_queue SET status = ${status} WHERE id = ${id}`;
}

export async function updateWaQueueItemSchedule(id: string, scheduledAt: string) {
  await ensureTables();
  await sql`UPDATE wa_queue SET scheduled_at = ${scheduledAt} WHERE id = ${id}`;
}

/** Отмечает канал(ы) как уже отправленные — не трогая остальные поля. */
export async function markWaQueueItemSent(id: string, fields: { wa?: boolean; tg?: boolean }) {
  await ensureTables();
  if (fields.wa) await sql`UPDATE wa_queue SET wa_sent = true WHERE id = ${id}`;
  if (fields.tg) await sql`UPDATE wa_queue SET tg_sent = true WHERE id = ${id}`;
}

/** Удаляет одну запись. true — если она существовала. */
export async function deleteWaQueueItemById(id: string): Promise<boolean> {
  await ensureTables();
  const rows = (await sql`DELETE FROM wa_queue WHERE id = ${id} RETURNING id`) as any[];
  return rows.length > 0;
}

/** Удаляет пачкой; возвращает, сколько реально удалено. */
export async function deleteWaQueueItems(ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  await ensureTables();
  const rows = (await sql`DELETE FROM wa_queue WHERE id = ANY(${ids}) RETURNING id`) as any[];
  return rows.length;
}

export async function updateWaQueueConfig(waChatId: string) {
  await ensureTables();
  await sql`
    INSERT INTO wa_queue_settings (key, value) VALUES ('wa_chatid', ${waChatId})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `;
}
