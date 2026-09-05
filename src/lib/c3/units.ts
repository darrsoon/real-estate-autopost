// C3 Garden Residence — единственный проект со своей вкладкой в «Постах».
// Раньше данные для неё брались из листа OBJECTS Google-таблицы; теперь всё
// приходит из базы, как и у обычных юнитов. От таблицы осталась только запись
// даты по кнопке Approved (лист «C3 Garden Res»), это отдельная история.
//
// Своего тут два: юнит выбирают по номеру квартиры (G01, 203), а не по коду —
// им же назван слайд на Диске; и этаж считается из номера.
import { listAvailableUnits, getUnitByNumber, RawUnit } from '../units-db/units';
import { mapRawUnitToPostData } from '../units-db/map';
import { getProjectMeta } from '../post-meta/emoji';

export const C3_PROJECT = 'C3 Garden Residence';

/**
 * Этаж из номера юнита: G0x → Ground Floor, 101 → 1st Floor, 203 → 2nd Floor.
 * В базе этаж записан крупными зонами («Low floor», «Middle floor») — для
 * низкого дома C3 это грубо, поэтому здесь считаем точный этаж по номеру.
 */
export function c3Floor(unitNumber: string): string {
  const uv = String(unitNumber || '').toUpperCase().trim();
  if (!uv) return '';
  if (uv.startsWith('G')) return 'Ground Floor';

  const firstDigit = parseInt(uv.replace(/\D/g, '').charAt(0), 10);
  if (!(firstDigit >= 1)) return '';

  const ord = firstDigit === 1 ? '1st' : firstDigit === 2 ? '2nd' : firstDigit === 3 ? '3rd' : `${firstDigit}th`;
  return `${ord} Floor`;
}

// Номера доступных юнитов C3 для выпадающего списка: сначала этаж G, потом
// цифры по возрастанию — иначе строковая сортировка ставит «G01» после «113».
export async function listC3UnitNumbers(): Promise<string[]> {
  const units = await listAvailableUnits(C3_PROJECT);
  return units
    .map(u => String(u.unit_number || '').trim())
    .filter(Boolean)
    .sort((a, b) => {
      const ga = a.toUpperCase().startsWith('G');
      const gb = b.toUpperCase().startsWith('G');
      if (ga !== gb) return ga ? -1 : 1;
      return a.localeCompare(b, 'en', { numeric: true });
    });
}

// Готовые данные поста по номеру юнита. Слайд с Диска сюда не входит — его
// подставляет роут, чтобы качать картинку только когда она правда нужна.
export async function getC3PostData(unitNumber: string) {
  const raw: RawUnit | null = await getUnitByNumber(C3_PROJECT, unitNumber);
  if (!raw) return null;

  const meta = await getProjectMeta(raw.project_id);
  const post = mapRawUnitToPostData(raw, meta?.emoji || '');

  return {
    ...post,
    // Номер квартиры — по нему ищется слайд и строка в листе «C3 Garden Res».
    unit: raw.unit_number || '',
    unitNumber: raw.unit_number || '',
    floor: c3Floor(raw.unit_number || '') || post.floor,
    postType: 'READY_TO_MOVE',
  };
}
