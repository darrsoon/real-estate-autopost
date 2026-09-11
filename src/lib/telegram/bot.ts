import { Telegraf } from 'telegraf';

import axios from 'axios';
import FormData from 'form-data';

export function getBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN not configured');
  return new Telegraf(token);
}

// The WA button carries the queue item's own id when we have it. Matching by unit code
// is ambiguous — a short C3 unit like "109" is a substring of codes such as "#210914",
// so the bot used to pick a completely unrelated post.
// Пост C3 помечаем в самой кнопке: его строка живёт в отдельном листе, а
// номера юнитов у C3 и Abu Dhabi местами совпадают (например «108»), так что
// угадать источник по номеру нельзя.
function reviewKeyboard(unitCode: string, waQueueId?: string, isC3 = false) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Approved', callback_data: `${isC3 ? 'approvec3_' : 'approve_'}${unitCode}` },
        { text: '🗑 Удалить', callback_data: `delete_${unitCode}` },
      ],
      [
        { text: '📲 WA', callback_data: `wa_${waQueueId || unitCode}` },
        { text: '✈️ TG канал', callback_data: `tg_${unitCode}` },
      ],
    ],
  };
}

export async function sendMediaGroupWithCaption(
  chatId: string,
  mediaUrlsOrIds: { type: 'photo'; media: string | { source: Buffer, filename?: string } }[],
  captionHtml: string,
  unitCode: string,
  isC3 = false,
) {
  const bot = getBot();

  const formData = new FormData();
  formData.append('chat_id', chatId);

  const mediaArray: any[] = [];
  mediaUrlsOrIds.forEach((m, index) => {
    let mediaStr = '';
    if (typeof m.media === 'string') {
      mediaStr = m.media;
    } else {
      const attachName = `photo${index}`;
      formData.append(attachName, m.media.source, {
        filename: m.media.filename || `image${index}.jpg`,
        contentType: 'image/jpeg'
      });
      mediaStr = `attach://${attachName}`;
    }

    const mediaItem: any = { type: 'photo', media: mediaStr };
    if (index === 0) {
      mediaItem.caption = captionHtml;
      mediaItem.parse_mode = 'HTML';
    }
    mediaArray.push(mediaItem);
  });

  formData.append('media', JSON.stringify(mediaArray));

  const res = await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMediaGroup`, formData, {
    headers: formData.getHeaders(),
    timeout: 45000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
  const message = res.data.result;

  const firstMsgId = message[0].message_id;
  const mainIds: number[] = message.map((m: any) => m.message_id);
  const ids: number[] = [...mainIds];

  const reviewMsg = await bot.telegram.sendMessage(chatId, `Review post for ${unitCode}:`, {
    reply_parameters: { message_id: firstMsgId },
    reply_markup: reviewKeyboard(unitCode, undefined, isC3),
  });
  ids.push(reviewMsg.message_id);

  return { message, ids, mainIds, reviewMsgId: reviewMsg.message_id };
}

export async function updateReviewMessage(
  chatId: string,
  reviewMsgId: number,
  unitCode: string,
  allIds: number[],
  mainIds?: number[],
  waQueueId?: string,
  isC3 = false,
) {
  const bot = getBot();
  const mainPart = mainIds ? `\nmain_ids:${mainIds.join(',')}` : '';
  await bot.telegram.editMessageText(
    chatId,
    reviewMsgId,
    undefined,
    `Review post for ${unitCode}:${mainPart}\nids:${allIds.join(',')}`,
    { reply_markup: reviewKeyboard(unitCode, waQueueId, isC3) }
  );
}

export async function sendTextMessage(chatId: string, textHtml: string, unitCode?: string) {
  const bot = getBot();
  const msg = await bot.telegram.sendMessage(chatId, textHtml, { parse_mode: 'HTML' });
  const ids: number[] = [msg.message_id];
  const mainIds: number[] = [msg.message_id];

  let reviewMsgId: number | undefined;
  if (unitCode) {
    const reviewMsg = await bot.telegram.sendMessage(chatId, `Review post for ${unitCode}:`, {
      reply_parameters: { message_id: msg.message_id },
      reply_markup: reviewKeyboard(unitCode),
    });
    ids.push(reviewMsg.message_id);
    reviewMsgId = reviewMsg.message_id;
  }
  return { msg, ids, mainIds, reviewMsgId };
}

export async function sendPlainTextMessage(chatId: string, text: string) {
  const bot = getBot();
  const msg = await bot.telegram.sendMessage(chatId, text);
  return { msg, ids: [msg.message_id] };
}

export async function sendPhoto(chatId: string, source: Buffer, caption: string) {
  const bot = getBot();
  const msg = await bot.telegram.sendPhoto(chatId, { source }, { caption });
  return { msg, ids: [msg.message_id] };
}


// ── Новости: черновик без привязки к юниту ──────────────────────────────
// В отличие от Постов, у Новости нет кода юнита и нет строки в Google-листе,
// поэтому кнопка «✅ Approved» тут не нужна — только доставка (WA/TG-канал)
// и удаление черновика. delete_/wa_/tg_ в вебхуке уже полностью общие (не
// завязаны на данные юнита, читают ids/main_ids из текста сообщения), так
// что их можно переиспользовать как есть — суффикс после wa_ важен (должен
// быть id записи в очереди WA), суффиксы delete_/tg_ вебхук не смотрит.
function newsReviewKeyboard(waQueueId?: string) {
  return {
    inline_keyboard: [
      [
        { text: '📲 WA', callback_data: `wa_${waQueueId || 'news'}` },
        { text: '✈️ TG канал', callback_data: 'tg_news' },
      ],
      [
        { text: '🗑 Удалить', callback_data: 'delete_news' },
      ],
    ],
  };
}

// Черновик Новости: фото/видео (если есть) или просто текст + отдельное
// сообщение-«шапка» с кнопками — тот же паттерн, что sendMediaGroupWithCaption
// у Постов (ids/main_ids кладём в текст шапки, а не в callback_data).
export async function sendNewsDraft(
  chatId: string,
  media: { type: 'photo' | 'video'; source: Buffer } | null,
  captionHtml: string,
) {
  const bot = getBot();
  let mainIds: number[];

  if (media) {
    const msg = media.type === 'video'
      ? await bot.telegram.sendVideo(chatId, { source: media.source }, { caption: captionHtml, parse_mode: 'HTML' })
      : await bot.telegram.sendPhoto(chatId, { source: media.source }, { caption: captionHtml, parse_mode: 'HTML' });
    mainIds = [msg.message_id];
  } else {
    const msg = await bot.telegram.sendMessage(chatId, captionHtml, { parse_mode: 'HTML' });
    mainIds = [msg.message_id];
  }

  const ids: number[] = [...mainIds];
  const reviewMsg = await bot.telegram.sendMessage(chatId, 'Review новости:', {
    reply_parameters: { message_id: mainIds[0] },
    reply_markup: newsReviewKeyboard(),
  });
  ids.push(reviewMsg.message_id);

  return { ids, mainIds, reviewMsgId: reviewMsg.message_id };
}

export async function updateNewsReviewMessage(
  chatId: string,
  reviewMsgId: number,
  allIds: number[],
  mainIds: number[],
  waQueueId?: string,
) {
  const bot = getBot();
  await bot.telegram.editMessageText(
    chatId,
    reviewMsgId,
    undefined,
    `Review новости:\nmain_ids:${mainIds.join(',')}\nids:${allIds.join(',')}`,
    { reply_markup: newsReviewKeyboard(waQueueId) }
  );
}
