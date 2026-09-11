import { StoryQueueItem } from '../story-queue/store';
import { sendMediaStatusNatalia, sendTextStatusNatalia } from './green-api-natalia';

// Сколько живёт ссылка urlFile от Green API — если запланированное время
// наступает позже, ссылка почти наверняка уже протухла и отправка провалится
// с понятной ошибкой от Green API. Отдельно проверяем на 14 днях (с запасом
// в сутки), чтобы предупредить об этом ещё на странице очереди.
export const GREENAPI_FILE_URL_TTL_DAYS = 15;

export function isUploadStale(uploadedAtIso: string): boolean {
  if (!uploadedAtIso) return false;
  const uploaded = new Date(uploadedAtIso).getTime();
  if (isNaN(uploaded)) return false;
  const ageDays = (Date.now() - uploaded) / (1000 * 60 * 60 * 24);
  return ageDays >= GREENAPI_FILE_URL_TTL_DAYS - 1;
}

// Отправляет одну сторис: фото/видео по ссылке Green API + подпись, либо
// просто текстовую сторис.
export async function dispatchStoryItem(item: StoryQueueItem): Promise<void> {
  if (item.media_type === 'text') {
    await sendTextStatusNatalia(item.caption);
    return;
  }
  if (!item.media_url) throw new Error('У сторис нет ссылки на файл (media_url пуст)');
  await sendMediaStatusNatalia(item.media_url, item.file_name || 'story', item.caption);
}
