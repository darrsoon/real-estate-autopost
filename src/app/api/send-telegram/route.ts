import { NextResponse } from 'next/server';
import { getBot, sendMediaGroupWithCaption, sendTextMessage, sendPlainTextMessage, sendPhoto, updateReviewMessage } from '@/lib/telegram/bot';

// Heavy flow: downloads Drive photos + uploads a media group to Telegram + writes
// to Sheets. 60 с не хватало — отправка падала с 504 (Task timed out).
export const maxDuration = 300;
import { getDriveImages, getProjectPhotoFolderId, uploadToWaQueue, compressImageBuffer } from '@/lib/google/drive';
import { addWaQueueItem } from '@/lib/wa-queue/store';
import { buildTelegramHtmlPost, buildWhatsAppMarkdown, PostData } from '@/lib/posts/templates';
import { validatePostData } from '@/lib/posts/validators';

export async function POST(request: Request) {
  // Отправка упирается в 60 с (тариф Hobby). Без потактовых замеров в логах
  // остаётся только «Task timed out» — непонятно, какой шаг съел время.
  const t0 = Date.now();
  const mark = (stage: string) => console.log(`send-telegram +${((Date.now() - t0) / 1000).toFixed(1)}s ${stage}`);
  try {
    const body = await request.json();
    const data: PostData = body.data;
    // «YYYY-MM-DD HH:MM» по Дубаю — если стоит время, крон сам отправит и в TG-канал, и в WA.
    const scheduledAt: string = body.scheduledAt || '';

    validatePostData(data);
    mark('body + validate');

    const telegramHtml = body.telegramHtmlOverride || await buildTelegramHtmlPost(data);
    const whatsappText = body.whatsappTextOverride || await buildWhatsAppMarkdown(data);
    mark('шаблоны');

    const chatId = process.env.TELEGRAM_REVIEW_CHAT_ID;
    if (!chatId) throw new Error('TELEGRAM_REVIEW_CHAT_ID not configured');

    if (data.postType === 'PRICE_CHANGE') {
      const allIds: number[] = [];
      if (data.oldPostUrl) {
        const r = await sendPlainTextMessage(chatId, data.oldPostUrl);
        allIds.push(...r.ids);
      }
      const r1 = await sendTextMessage(chatId, telegramHtml, data.code);
      allIds.push(...r1.ids);
      const r2 = await sendPlainTextMessage(chatId, whatsappText);
      allIds.push(...r2.ids);

      // Queue first: the WA button needs the queue item's id to be unambiguous.
      // Заодно кладём в очередь id сообщений в чате-модераторе (r1.mainIds) и
      // сам чат — если поставят время в «Расписании WA», крон сможет
      // форварднуть именно эти сообщения в TG-канал, а не только отправить WA.
      let waQueueId = '';
      try {
        const label = `PRICE_CHANGE – ${data.code || data.unit || '?'} in ${data.project}`;
        waQueueId = await addWaQueueItem(label, whatsappText, '', scheduledAt, '', r1.mainIds, chatId);
      } catch (e) {
        console.error('WA queue save error (price change):', e);
      }

      if (r1.reviewMsgId) {
        await updateReviewMessage(chatId, r1.reviewMsgId, data.code || '', allIds, r1.mainIds, waQueueId).catch(() => {});
      }

      return NextResponse.json({ ok: true, whatsappText, messageIds: allIds, chatId });
    }

    // Normal post: fetch photos and send
    if (!data.slideDataUrl) {
      throw new Error('Slide image required for normal post');
    }

    const slideRaw = Buffer.from(data.slideDataUrl.split(',')[1], 'base64');
    const slideBuffer = await compressImageBuffer(slideRaw);
    mark(`сжатие слайда (${(slideBuffer.length / 1048576).toFixed(2)} МБ)`);

    // Media group
    const media: { type: 'photo'; media: any }[] = [
      { type: 'photo', media: { source: slideBuffer, filename: 'slide.jpg' } }
    ];

    try {
      const folderId = await getProjectPhotoFolderId(data.project);
      mark('getProjectPhotoFolderId');
      const images = await getDriveImages(folderId, 5); // Get up to 5 to make 6 total with slide
      mark(`getDriveImages (${images.length})`);

      images.forEach((img, i) => {
        media.push({ type: 'photo', media: { source: img, filename: `img_${i}.jpg` } });
      });
    } catch (e) {
      console.error('Failed to get drive images:', e);
      // We can still send the slide if drive images fail, or we can throw.
      // Legacy code throws if < 5 photos are found, but let's be more lenient or follow exactly.
      // throw new Error('Failed to load project photos from Drive');
    }

    console.log(`Sending telegram media group with ${media.length} items`);

    // Пост C3 помечаем, чтобы кнопка Approved знала, в какой лист писать дату.
    // У C3 строка ищется по номеру юнита, у остальных — по коду: у юнитов из
    // базы поле unit это положение дома («Middle»), а не номер.
    const isC3 = /c3 garden residence/i.test(String(data.project || ''));
    const unitLabel = (isC3 ? data.unit || data.code : data.code || data.unit) || 'Unknown';
    const r1 = await sendMediaGroupWithCaption(chatId, media, telegramHtml, unitLabel, isC3);
    mark('sendMediaGroup');
    const allIds: number[] = [...r1.ids];

    const r2 = await sendPhoto(chatId, slideBuffer, whatsappText);
    mark('sendPhoto');
    allIds.push(...r2.ids);

    // Queue first: the WA button needs the queue item's id to be unambiguous.
    // Заодно кладём в очередь id сообщений в чате-модераторе (r1.mainIds) и
    // сам чат — если поставят время в «Расписании WA», крон сможет
    // форварднуть именно эти сообщения в TG-канал, а не только отправить WA.
    let waQueueId = '';
    try {
      const label = `${data.postType} – ${data.code || data.unit || '?'} in ${data.project}`;
      const filename = `wa_${Date.now()}.jpg`;
      const driveFileId = await uploadToWaQueue(slideBuffer, filename);
      waQueueId = await addWaQueueItem(label, whatsappText, driveFileId, scheduledAt, '', r1.mainIds, chatId);
      mark('очередь WA');
    } catch (e) {
      console.error('WA queue save error:', e);
    }

    await updateReviewMessage(chatId, r1.reviewMsgId, unitLabel, allIds, r1.mainIds, waQueueId, isC3).catch(() => {});
    mark('ГОТОВО');

    return NextResponse.json({ ok: true, whatsappText, messageIds: allIds, chatId });
  } catch (error: any) {
    console.error('Send Telegram error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
