import { WaQueueItem } from '../wa-queue/store';
import { downloadFromDrive } from '../google/drive';
import { sendWhatsAppImage, sendWhatsAppText, sendWhatsAppFile } from './green-api';

// Sends one queue item to the given WhatsApp chat (image + caption, video + caption, or text only).
export async function dispatchWaItem(item: WaQueueItem, chatId: string): Promise<void> {
  if (item.drive_file_id) {
    const buf = await downloadFromDrive(item.drive_file_id);
    if (item.media_type === 'video') {
      await sendWhatsAppFile(chatId, buf, item.wa_text, 'news.mp4', 'video/mp4');
    } else {
      await sendWhatsAppImage(chatId, buf, item.wa_text);
    }
  } else {
    await sendWhatsAppText(chatId, item.wa_text);
  }
}

// scheduled_at is "YYYY-MM-DD HH:MM" in Dubai wall-clock time (UTC+4, no DST).
// Returns true if that moment is now or in the past.
export function isDue(scheduledAt: string): boolean {
  const m = scheduledAt.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  if (!m) return false;
  const dt = new Date(`${m[1]}T${m[2]}:00+04:00`);
  if (isNaN(dt.getTime())) return false;
  return new Date() >= dt;
}
