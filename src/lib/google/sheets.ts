import { google } from 'googleapis';
import { getGoogleAuthClient } from './auth';

export async function getGoogleSheetsClient() {
  const auth = await getGoogleAuthClient();
  return google.sheets({ version: 'v4', auth });
}

export async function getSheetData(spreadsheetId: string, sheetName: string) {
  if (!spreadsheetId) throw new Error('Spreadsheet ID not configured');

  const sheets = await getGoogleSheetsClient();
  
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: sheetName,
  });

  return response.data.values || [];
}

// #d9ead3 — approved green
const APPROVED_COLOR = { red: 217 / 255, green: 234 / 255, blue: 211 / 255 };
const APPROVED_SHEET_GID = 1747337860;

function getColLetter(index: number) {
  let temp = index;
  let letter = '';
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

const C3_SHEET = 'C3 Garden Res';

/**
 * Ставит сегодняшнюю дату в колонку «Дата объявления» листа C3.
 * В отличие от листа Abu Dhabi здесь дата именно перезаписывается: по одному
 * юниту C3 пост делают повторно, и нужна дата последнего.
 */
export async function setC3PostDate(unit: string): Promise<{ row: number; date: string }> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_OBJECTS_ID ?? '';
  if (!spreadsheetId) throw new Error('GOOGLE_SHEETS_OBJECTS_ID not configured');

  const sheets = await getGoogleSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: C3_SHEET });
  const rows = res.data.values ?? [];
  if (rows.length < 2) throw new Error(`Лист «${C3_SHEET}» пуст`);

  const headers = (rows[0] as unknown[]).map(h => String(h).trim().toLowerCase());
  const unitCol = headers.indexOf('unit');
  const dateCol = headers.indexOf('дата объявления');
  if (unitCol === -1) throw new Error(`В листе «${C3_SHEET}» нет колонки Unit`);
  if (dateCol === -1) throw new Error(`В листе «${C3_SHEET}» нет колонки «Дата объявления»`);

  const norm = (v: unknown) =>
    String(v ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, '').replace(/^#/, '').trim().toLowerCase();
  const target = norm(unit);

  let rowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    if (norm((rows[i] as unknown[])[unitCol]) === target) { rowIndex = i; break; }
  }
  if (rowIndex === -1) throw new Error(`Юнит ${unit} не найден в листе «${C3_SHEET}»`);

  const now = new Date();
  const date = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}`;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${C3_SHEET}'!${getColLetter(dateCol)}${rowIndex + 1}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[date]] },
  });

  return { row: rowIndex + 1, date };
}

export async function approveUnitRow(code: string, unit?: string): Promise<{ row: number; sheet: string }> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_OBJECTS_ID ?? '';
  if (!spreadsheetId) throw new Error('GOOGLE_SHEETS_OBJECTS_ID not configured');

  const sheets = await getGoogleSheetsClient();

  // Resolve sheet name from GID
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
  const sheetTitle = meta.data.sheets?.find(s => s.properties?.sheetId === APPROVED_SHEET_GID)?.properties?.title;
  if (!sheetTitle) throw new Error(`Sheet GID ${APPROVED_SHEET_GID} not found`);

  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: sheetTitle });
  const rows = res.data.values ?? [];
  if (rows.length < 2) throw new Error('Sheet is empty');

  const headers = (rows[0] as unknown[]).map(h => String(h).trim().toLowerCase());
  const unitCol = headers.indexOf('unit');
  const codeCol = headers.findIndex(h => h === 'код' || h === 'code');

  const norm = (v: unknown) =>
    String(v ?? '').replace(/ /g, ' ').replace(/\s+/g, '').replace(/^#/, '').trim().toLowerCase();

  const targetCode = norm(code);
  const targetUnit = norm(unit ?? '');

  let rowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] as unknown[];
    const rowCode = norm(r[codeCol]);
    const rowUnit = norm(r[unitCol]);
    if ((targetCode && rowCode === targetCode) || (targetUnit && rowUnit === targetUnit)) {
      rowIndex = i;
      break;
    }
  }
  if (rowIndex === -1) throw new Error(`Unit not found: code=${code} unit=${unit}`);

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        repeatCell: {
          range: { sheetId: APPROVED_SHEET_GID, startRowIndex: rowIndex, endRowIndex: rowIndex + 1 },
          cell: { userEnteredFormat: { backgroundColor: APPROVED_COLOR } },
          fields: 'userEnteredFormat.backgroundColor',
        },
      }],
    },
  });

  // Write approval date to the correct column
  const now = new Date();
  const today = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}`;

  const dateAnnouncedCol = headers.findIndex(h => h === 'дата объявления');
  const datePriceChangeCol = headers.findIndex(h => h === 'объявление изменения цены');

  const row = rows[rowIndex] as unknown[];
  const dateAnnouncedVal = dateAnnouncedCol !== -1 ? String(row[dateAnnouncedCol] ?? '').trim() : '';

  let targetCol = -1;
  if (dateAnnouncedCol !== -1 && !dateAnnouncedVal) {
    targetCol = dateAnnouncedCol;
  } else if (datePriceChangeCol !== -1) {
    targetCol = datePriceChangeCol;
  }

  if (targetCol !== -1) {
    const colLetter = getColLetter(targetCol);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetTitle}!${colLetter}${rowIndex + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[today]] },
    });
  }

  return { row: rowIndex + 1, sheet: sheetTitle };
}

// ── C3 ──────────────────────────────────────────────────────────────────────

// Данные юнитов C3 переехали из листа OBJECTS в базу — см. src/lib/c3/units.ts.
// Из таблиц по C3 остался только setC3PostDate выше: дата поста в листе
// «C3 Garden Res» — это отдельный ручной трекер, база его не заменяет.

// ── WA QUEUE ─────────────────────────────────────────────────────────────────

// Очередь WhatsApp переехала из листа WA_QUEUE в базу — см. src/lib/wa-queue/store.ts.
// Лист в таблице остался как есть, но приложение его больше не читает.

// ── CATALOG ──────────────────────────────────────────────────────────────────

// Каталог переехал из листа CATALOG в базу — см. src/lib/catalog/store.ts.
// Лист остался в таблице нетронутым, приложение его больше не читает.

