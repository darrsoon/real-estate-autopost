import { getProjectConfig } from '../post-meta/project-config';
import {
  isVillaObject,
  escapeHtml,
  formatNumberLikeSheet,
  formatArea2,
  getPostTitle,
  formatUnitLabel,
  formatRowLabel,
  normalizeText
} from './formatters';

export interface PostData {
  postType: string;
  project: string;
  objectType?: string;
  code?: string;
  unit?: string;
  // Номер квартиры. У виллы в `unit` лежит положение дома в ряду, поэтому номер
  // хранится отдельно — по нему ищут слайд C3 и строку в листе «C3 Garden Res».
  unitNumber?: string;
  type?: string;
  view?: string;
  originalPrice?: string | number;
  sellingPrice?: string | number;
  oldPrice?: string | number;
  areaM2?: string | number;
  grossAreaM2?: string | number;
  plotAreaM2?: string | number;
  rowName?: string;
  paymentPlan?: string;
  handover?: string;
  floor?: string;
  approxRentalRate?: string;
  slideDataUrl?: string;
  slideName?: string;
  oldPostUrl?: string;
  // Optional header overrides used by DB-sourced posts. When absent, the
  // builders берут остров и смайлик проекта из базы.
  island?: string;
  emoji?: string;
}

export async function buildTelegramHtmlPost(data: any) {
  if (isVillaObject(data.objectType)) {
    return buildVillaPostText(data);
  }
  return buildApartmentPostText(data);
}

// Inserts a zero-width space after the first word so WhatsApp stops auto-detecting place names as geo-links.
function noGeoLink(s: string): string {
  return s.replace(' ', '​ ');
}

export async function buildWhatsAppMarkdown(data: any) {
  if (data.postType === 'PRICE_CHANGE') {
    return buildReducedPriceWhatsAppText(data);
  }
  if (isVillaObject(data.objectType)) {
    return buildVillaWhatsAppPostText(data);
  }
  return buildApartmentWhatsAppPostText(data);
}

// ---------------------------------------------------------
// TELEGRAM HTML BUILDERS
// ---------------------------------------------------------

async function buildApartmentPostText(data: any) {
  const cfg = await getProjectConfig(data.project);
  // У юнита из базы остров и смайлик уже свои — они точнее общих по проекту.
  if (data.island) cfg.island = data.island;
  if (data.emoji) cfg.emoji = data.emoji;

  if (data.postType === 'PRICE_CHANGE') {
    return buildReducedPriceText(data, cfg);
  }

  const title = getPostTitle(data.postType);
  let text = '';

  text += '<b>' + escapeHtml(title) + '</b>\n\n';
  text += '<b>' + escapeHtml(data.type) + ' in ' + escapeHtml(data.project);

  if (cfg.island) text += ' - ' + escapeHtml(cfg.island);
  if (cfg.emoji) text += ' ' + escapeHtml(cfg.emoji);
  text += '</b>\n\n';

  if (data.originalPrice) {
    text += '<u>Original Price:</u> ' + escapeHtml(formatNumberLikeSheet(data.originalPrice)) + ' AED\n';
  }

  if (data.postType === 'NEW_PRICE') {
    text += '<i><u>Old price:</u> <s>' + escapeHtml(formatNumberLikeSheet(data.oldPrice)) + ' AED</s></i>\n';
  }

  if (normalizeText(data.project) === normalizeText('C3 Garden Residence') && data.approxRentalRate) {
    text += '<u>Approx. rental rate:</u> ' + escapeHtml(data.approxRentalRate) + '\n';
  }

  text += '<b><u>Selling Price:</u> ' + escapeHtml(formatNumberLikeSheet(data.sellingPrice)) + ' AED</b>\n\n';

  text += '📐 ' + escapeHtml(formatArea2(data.areaM2)) + ' sqm';

  if (data.floor) text += '\n📦 ' + escapeHtml(data.floor);
  if (data.view) text += '\n🌳 ' + escapeHtml(data.view);
  if (data.handover) text += '\n🗓 <b>Handover:</b> ' + escapeHtml(data.handover);

  text += '\n\n<b>📞 Contact our broker Nataly:</b>\n';
  text += '📱 <a href="https://wa.me/971508697050">+971508697050</a>';

  return text;
}

// «📐 Gross area X sqm / Plot area Y sqm» — каждая половина только если есть.
function buildVillaAreaLine(data: any, esc: (v: string) => string): string {
  const has = (v: any) => v !== '' && v !== null && v !== undefined && Number(v) > 0;
  const parts: string[] = [];
  if (has(data.grossAreaM2)) parts.push('Gross area ' + esc(formatArea2(data.grossAreaM2)) + ' sqm');
  if (has(data.plotAreaM2)) parts.push('Plot area ' + esc(formatArea2(data.plotAreaM2)) + ' sqm');
  return parts.length ? '📐 ' + parts.join(' / ') : '';
}

async function buildVillaPostText(data: any) {
  const cfg = await getProjectConfig(data.project);
  // У юнита из базы остров и смайлик уже свои — они точнее общих по проекту.
  if (data.island) cfg.island = data.island;
  if (data.emoji) cfg.emoji = data.emoji;

  if (data.postType === 'PRICE_CHANGE') {
    return buildReducedPriceText(data, cfg);
  }

  const title = getPostTitle(data.postType);
  let text = '';

  text += '<b>' + escapeHtml(title) + '</b>\n\n';
  text += '<b>' + escapeHtml(data.type) + ' in ' + escapeHtml(data.project);

  if (cfg.island) text += ' - ' + escapeHtml(cfg.island);
  if (cfg.emoji) text += ' ' + escapeHtml(cfg.emoji);
  text += '</b>\n\n';

  if (data.originalPrice) {
    text += '<u>Original Price:</u> ' + escapeHtml(formatNumberLikeSheet(data.originalPrice)) + ' AED\n';
  }

  if (data.postType === 'NEW_PRICE') {
    text += '<i><u>Old price:</u> <s>' + escapeHtml(formatNumberLikeSheet(data.oldPrice)) + ' AED</s></i>\n';
  }

  text += '<b><u>Selling Price:</u> ' + escapeHtml(formatNumberLikeSheet(data.sellingPrice)) + ' AED</b>\n\n';

  // Строки собираем списком: у таунхаусов нет площади участка, а у части
  // юнитов не заполнена и площадь дома — тогда строки просто нет, а не «0,00».
  const lines: string[] = [];
  const areaLine = buildVillaAreaLine(data, escapeHtml);
  if (areaLine) lines.push(areaLine);
  if (data.unit) lines.push('🌳 ' + escapeHtml(formatUnitLabel(data.unit)));
  if (data.rowName) lines.push('📍 ' + escapeHtml(formatRowLabel(data.rowName)));
  if (data.handover) lines.push('🗓 <b>Handover:</b> ' + escapeHtml(data.handover));
  text += lines.join('\n');

  text += '\n\n<b>📞 Contact our broker Nataly:</b>\n';
  text += '📱 <a href="https://wa.me/971508697050">+971508697050</a>';

  return text;
}

function cleanPriceForComparison(price: string | number | undefined): number {
  if (typeof price === 'number') return price;
  if (!price) return 0;
  return parseInt(String(price).replace(/[^\d]/g, ''), 10) || 0;
}

function buildReducedPriceText(data: any, cfg: any) {
  let projectLabel = data.project;
  if (cfg.emoji) projectLabel += ' ' + cfg.emoji;

  const oldP = cleanPriceForComparison(data.oldPrice);
  const newP = cleanPriceForComparison(data.sellingPrice);
  const isIncreased = oldP > 0 && newP > oldP;

  const header = isIncreased ? '<b>❗ The price has been increased ❗</b>' : '<b>❗ The price has been reduced ❗</b>';
  const footer = isIncreased ? '' : '\n\n<b>The price of the property is below the market price!</b>';

  return (
    `${header}\n\n` +
    `<b>🏡 ${escapeHtml(data.code)} in ${escapeHtml(projectLabel)}</b>\n\n` +
    `<i><u>Old price:</u> <s>${escapeHtml(formatNumberLikeSheet(data.oldPrice))} AED</s></i>\n` +
    `<i><u>New Selling price:</u> ${escapeHtml(formatNumberLikeSheet(data.sellingPrice))} AED</i>` +
    footer
  );
}


// ---------------------------------------------------------
// WHATSAPP PLAIN TEXT BUILDERS
// ---------------------------------------------------------

async function buildApartmentWhatsAppPostText(data: any) {
  const cfg = await getProjectConfig(data.project);
  // У юнита из базы остров и смайлик уже свои — они точнее общих по проекту.
  if (data.island) cfg.island = data.island;
  if (data.emoji) cfg.emoji = data.emoji;
  const title = getPostTitle(data.postType);
  let text = '';

  text += '*' + title + '*\n\n';
  text += '*' + data.type + ' in ' + noGeoLink(data.project);

  if (cfg.island) text += ' - ' + noGeoLink(cfg.island);
  if (cfg.emoji) text += ' ' + cfg.emoji;
  text += '*\n\n';

  if (data.originalPrice) {
    text += 'Original Price: ' + formatNumberLikeSheet(data.originalPrice) + ' AED\n';
  }

  if (data.postType === 'NEW_PRICE') {
    text += '_Old price: ~' + formatNumberLikeSheet(data.oldPrice) + ' AED~_\n';
  }

  if (normalizeText(data.project) === normalizeText('C3 Garden Residence') && data.approxRentalRate) {
    text += 'Approx. rental rate: ' + data.approxRentalRate + '\n';
  }

  text += '*Selling Price: ' + formatNumberLikeSheet(data.sellingPrice) + ' AED*\n\n';

  text += '📐 ' + formatArea2(data.areaM2) + ' sqm';

  if (data.floor) text += '\n📦 ' + data.floor;
  if (data.view) text += '\n🌳 ' + data.view;
  if (data.handover) text += '\n🗓 *Handover:* ' + data.handover;

  text += '\n\n*📞 Contact our broker Nataly:*\n';
  text += '📱 +971508697050';

  return text;
}

async function buildVillaWhatsAppPostText(data: any) {
  const cfg = await getProjectConfig(data.project);
  // У юнита из базы остров и смайлик уже свои — они точнее общих по проекту.
  if (data.island) cfg.island = data.island;
  if (data.emoji) cfg.emoji = data.emoji;
  const title = getPostTitle(data.postType);
  let text = '';

  text += '*' + title + '*\n\n';
  text += '*' + data.type + ' in ' + noGeoLink(data.project);

  if (cfg.island) text += ' - ' + noGeoLink(cfg.island);
  if (cfg.emoji) text += ' ' + cfg.emoji;
  text += '*\n\n';

  if (data.originalPrice) {
    text += 'Original Price: ' + formatNumberLikeSheet(data.originalPrice) + ' AED\n';
  }

  if (data.postType === 'NEW_PRICE') {
    text += '_Old price: ~' + formatNumberLikeSheet(data.oldPrice) + ' AED~_\n';
  }

  text += '*Selling Price: ' + formatNumberLikeSheet(data.sellingPrice) + ' AED*\n\n';

  const lines: string[] = [];
  const areaLine = buildVillaAreaLine(data, (v: string) => v);
  if (areaLine) lines.push(areaLine);
  if (data.unit) lines.push('🌳 ' + formatUnitLabel(data.unit));
  if (data.rowName) lines.push('📍 ' + formatRowLabel(data.rowName));
  if (data.handover) lines.push('🗓 *Handover:* ' + data.handover);
  text += lines.join('\n');

  text += '\n\n*📞 Contact our broker Nataly:*\n';
  text += '📱 +971508697050';

  return text;
}

function buildReducedPriceWhatsAppText(data: any) {
  let projectLabel = data.project;

  const oldP = cleanPriceForComparison(data.oldPrice);
  const newP = cleanPriceForComparison(data.sellingPrice);
  const isIncreased = oldP > 0 && newP > oldP;

  const header = isIncreased ? '*❗ The price has been increased ❗*' : '*❗ The price has been reduced ❗*';
  const footer = isIncreased ? '' : '\n\n*The price of the property is below the market price!*';
  
  return (
    `${header}\n\n` +
    `*🏡 ${data.code} in ${projectLabel}*\n\n` +
    `_Old price: ~${formatNumberLikeSheet(data.oldPrice)} AED~_\n` +
    `_New Selling price: ${formatNumberLikeSheet(data.sellingPrice)} AED_\n` +
    footer
  ).trim();
}
