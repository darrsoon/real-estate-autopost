// Read-only access to the IT team's "Prime Bridge" units database.
// STRICT RULE: we never write here. Every query runs inside a READ ONLY
// transaction, so even a stray INSERT/UPDATE/DELETE would be rejected by Postgres.
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.UNITS_DB_URL!);

// Run one or more queries in a single READ ONLY transaction.
async function readOnly<T = any>(queries: any[]): Promise<T[][]> {
  return (await sql.transaction(queries, { readOnly: true })) as T[][];
}

// Abu Dhabi projects that actually have units, for the post dropdown (read live).
export async function listAbuDhabiProjects(): Promise<{ id: string; name: string }[]> {
  const [rows] = await readOnly([
    sql`
      SELECT DISTINCT p.id, p.name
      FROM units u JOIN projects p ON p.id = u.project_id
      WHERE u.emirate::text = 'Abu Dhabi'
      ORDER BY p.name
    `,
  ]);
  return (rows as any[]).map(r => ({ id: String(r.id), name: String(r.name || '') }));
}

// ALL active Abu Dhabi projects (even without units yet) — for the emoji list/sync.
export async function listAllAbuDhabiProjects(): Promise<{ id: string; name: string }[]> {
  const [rows] = await readOnly([
    sql`
      SELECT id, name FROM projects
      WHERE emirate::text = 'Abu Dhabi' AND archived_at IS NULL
      ORDER BY name
    `,
  ]);
  return (rows as any[]).map(r => ({ id: String(r.id), name: String(r.name || '') }));
}

// Available Abu Dhabi units that have never been posted (first_post_date is null).
export async function listUnitsWithoutPost(): Promise<{ id: string; code: string; unitNumber: string; project: string }[]> {
  const [rows] = await readOnly([
    sql`
      SELECT u.id, u.code, u.unit_number, p.name AS project
      FROM units u JOIN projects p ON p.id = u.project_id
      WHERE u.emirate::text = 'Abu Dhabi'
        AND u.status::text = 'available'
        AND u.first_post_date IS NULL
      ORDER BY p.name, u.code
    `,
  ]);
  return (rows as any[]).map(r => ({ id: String(r.id), code: String(r.code || ''), unitNumber: String(r.unit_number || ''), project: String(r.project || '') }));
}

export interface UnitSearchResult {
  id: string;
  code: string;
  unitNumber: string;
  project: string;
}

// Search Abu Dhabi units by code (digits, dots optional) OR by unit name (partial).
// Optionally scoped to one project. Empty query + a projectId lists that project's units.
export async function searchUnits(query: string, projectId?: string): Promise<UnitSearchResult[]> {
  const raw = (query || '').trim();
  const digits = raw.replace(/\D/g, ''); // "003·02·001" / "003.02.001" / "00302001" → "00302001"
  if (!raw && !projectId) return [];

  const [rows] = await readOnly([
    sql`
      SELECT u.id, u.code, u.unit_number, p.name AS project
      FROM units u
      JOIN projects p ON p.id = u.project_id
      WHERE u.emirate::text = 'Abu Dhabi'
        AND (${projectId ?? null}::uuid IS NULL OR u.project_id = ${projectId ?? null}::uuid)
        AND (
          ${raw} = ''
          OR (${digits} <> '' AND regexp_replace(u.code, '[^0-9]', '', 'g') LIKE ${digits} || '%')
          OR u.unit_number ILIKE ${'%' + raw + '%'}
        )
      ORDER BY u.code
      LIMIT 100
    `,
  ]);

  return (rows as any[]).map(r => ({
    id: String(r.id),
    code: String(r.code || ''),
    unitNumber: String(r.unit_number || ''),
    project: String(r.project || ''),
  }));
}

export interface UnitPrices {
  code: string;
  project: string;
  originalPrice: number | null;
  oldPrice: number | null;
  sellingPrice: number | null;
}

// Цены одного юнита по коду — из них строится поиск старого поста в канале.
// Код сверяем по цифрам: в базе он «041·02·004», а прийти может «041.02.004»
// или «04102004».
export async function getUnitPricesByCode(code: string): Promise<UnitPrices | null> {
  const digits = String(code || '').replace(/\D/g, '');
  if (!digits) return null;

  const [rows] = await readOnly([
    sql`
      SELECT u.code, p.name AS project,
             u.original_price_aed, u.old_price_aed, u.selling_price_aed
      FROM units u JOIN projects p ON p.id = u.project_id
      WHERE u.emirate::text = 'Abu Dhabi'
        AND regexp_replace(u.code, '[^0-9]', '', 'g') = ${digits}
      LIMIT 1
    `,
  ]);

  const r = (rows as any[])[0];
  if (!r) return null;

  const num = (v: any): number | null => (v == null || v === '' ? null : Number(v));
  return {
    code: String(r.code || ''),
    project: String(r.project || ''),
    originalPrice: num(r.original_price_aed),
    oldPrice: num(r.old_price_aed),
    sellingPrice: num(r.selling_price_aed),
  };
}

export interface RawUnit {
  id: string;
  code: string;
  unit_number: string;
  project_id: string;
  project_name: string;
  island: string | null;
  property_type: string | null;
  unit_type: string | null;
  view: string | null;
  floor: string | null;
  area_sqm: string | null;
  gross_area_sqm: string | null;
  plot_area_sqm: string | null;
  original_price_aed: string | null;
  old_price_aed: string | null;
  selling_price_aed: string | null;
  approx_rental_rate: string | null;
  rental_yield_aed: string | null;
  rental_amount_aed: string | null;
  // Готовая подпись «August 2027»: месяц собираем в SQL, иначе Postgres отдаёт
  // дату полуночью UTC и в другом часовом поясе она съезжает на день назад.
  rented_until_label: string | null;
  payment_plan_label: string | null;
  readiness: string | null;
  row_type: string | null;
  unit_position: string | null;
  unit_handover: string | null;
  building_handover: string | null;
}

// Все доступные юниты Абу-Даби разом — для таблицы каталога по всем проектам.
export async function listAllAvailableUnits(): Promise<RawUnit[]> {
  const [rows] = await readOnly([
    sql`
      SELECT
        u.id, u.code, u.unit_number, u.project_id,
        p.name AS project_name,
        d.name AS island,
        u.property_type, u.unit_type, u.view, u.floor,
        u.area_sqm, u.gross_area_sqm, u.plot_area_sqm,
        u.original_price_aed, u.old_price_aed, u.selling_price_aed,
        u.approx_rental_rate, u.rental_yield_aed, u.rental_amount_aed,
        to_char(u.rented_until, 'FMMonth YYYY') AS rented_until_label,
        u.payment_plan_label, u.readiness::text AS readiness,
        u.row_type, u.unit_position,
        u.handover_date AS unit_handover,
        b.handover_date AS building_handover
      FROM units u
      JOIN projects p ON p.id = u.project_id
      LEFT JOIN districts d ON d.id = p.district_id
      LEFT JOIN buildings b ON b.id = u.building_ref_id
      WHERE u.emirate::text = 'Abu Dhabi'
        AND u.status::text = 'available'
      ORDER BY p.name, u.selling_price_aed
    `,
  ]);
  return rows as RawUnit[];
}

// Все доступные юниты проекта — из них собирается бюджетная рассылка.
// Проект ищем по имени: в интерфейсе выбирают плашку из списка проектов.
export async function listAvailableUnits(projectName: string): Promise<RawUnit[]> {
  const [rows] = await readOnly([
    sql`
      SELECT
        u.id, u.code, u.unit_number, u.project_id,
        p.name AS project_name,
        d.name AS island,
        u.property_type, u.unit_type, u.view, u.floor,
        u.area_sqm, u.gross_area_sqm, u.plot_area_sqm,
        u.original_price_aed, u.old_price_aed, u.selling_price_aed,
        u.approx_rental_rate, u.rental_yield_aed, u.rental_amount_aed,
        to_char(u.rented_until, 'FMMonth YYYY') AS rented_until_label,
        u.payment_plan_label, u.readiness::text AS readiness,
        u.row_type, u.unit_position,
        u.handover_date AS unit_handover,
        b.handover_date AS building_handover
      FROM units u
      JOIN projects p ON p.id = u.project_id
      LEFT JOIN districts d ON d.id = p.district_id
      LEFT JOIN buildings b ON b.id = u.building_ref_id
      WHERE u.emirate::text = 'Abu Dhabi'
        AND u.status::text = 'available'
        AND lower(p.name) = lower(${projectName})
      ORDER BY u.selling_price_aed
    `,
  ]);
  return rows as RawUnit[];
}

// Все срочные продажи по Абу-Даби. В базе это deal_type = 'Distress Deal';
// в постах и рассылке они называются Quick Sale.
export async function listQuickSaleUnits(): Promise<RawUnit[]> {
  const [rows] = await readOnly([
    sql`
      SELECT
        u.id, u.code, u.unit_number, u.project_id,
        p.name AS project_name,
        d.name AS island,
        u.property_type, u.unit_type, u.view, u.floor,
        u.area_sqm, u.gross_area_sqm, u.plot_area_sqm,
        u.original_price_aed, u.old_price_aed, u.selling_price_aed,
        u.approx_rental_rate, u.rental_yield_aed, u.rental_amount_aed,
        to_char(u.rented_until, 'FMMonth YYYY') AS rented_until_label,
        u.payment_plan_label, u.readiness::text AS readiness,
        u.row_type, u.unit_position,
        u.handover_date AS unit_handover,
        b.handover_date AS building_handover
      FROM units u
      JOIN projects p ON p.id = u.project_id
      LEFT JOIN districts d ON d.id = p.district_id
      LEFT JOIN buildings b ON b.id = u.building_ref_id
      WHERE u.emirate::text = 'Abu Dhabi'
        AND u.status::text = 'available'
        AND u.deal_type::text = 'Distress Deal'
      ORDER BY p.name, u.selling_price_aed
    `,
  ]);
  return rows as RawUnit[];
}

// Один юнит по проекту и номеру квартиры. Так ищет вкладка C3: там выбирают
// не код (041·02·004), а номер юнита (G01, 203) — им же назван слайд на Диске.
export async function getUnitByNumber(projectName: string, unitNumber: string): Promise<RawUnit | null> {
  const [rows] = await readOnly([
    sql`
      SELECT
        u.id, u.code, u.unit_number, u.project_id,
        p.name AS project_name,
        d.name AS island,
        u.property_type, u.unit_type, u.view, u.floor,
        u.area_sqm, u.gross_area_sqm, u.plot_area_sqm,
        u.original_price_aed, u.old_price_aed, u.selling_price_aed,
        u.approx_rental_rate, u.rental_yield_aed, u.rental_amount_aed,
        to_char(u.rented_until, 'FMMonth YYYY') AS rented_until_label,
        u.payment_plan_label, u.readiness::text AS readiness,
        u.row_type, u.unit_position,
        u.handover_date AS unit_handover,
        b.handover_date AS building_handover
      FROM units u
      JOIN projects p ON p.id = u.project_id
      LEFT JOIN districts d ON d.id = p.district_id
      LEFT JOIN buildings b ON b.id = u.building_ref_id
      WHERE u.emirate::text = 'Abu Dhabi'
        AND lower(p.name) = lower(${projectName})
        AND lower(trim(u.unit_number)) = lower(trim(${unitNumber}))
      LIMIT 1
    `,
  ]);
  const r = (rows as any[])[0];
  return r ? (r as RawUnit) : null;
}

// Fetch a single unit (with project, island, per-building handover) by its id.
export async function getRawUnit(id: string): Promise<RawUnit | null> {
  const [rows] = await readOnly([
    sql`
      SELECT
        u.id, u.code, u.unit_number, u.project_id,
        p.name AS project_name,
        d.name AS island,
        u.property_type, u.unit_type, u.view, u.floor,
        u.area_sqm, u.gross_area_sqm, u.plot_area_sqm,
        u.original_price_aed, u.old_price_aed, u.selling_price_aed,
        u.approx_rental_rate, u.rental_yield_aed, u.rental_amount_aed,
        to_char(u.rented_until, 'FMMonth YYYY') AS rented_until_label,
        u.payment_plan_label, u.readiness::text AS readiness,
        u.row_type, u.unit_position,
        u.handover_date AS unit_handover,
        b.handover_date AS building_handover
      FROM units u
      JOIN projects p ON p.id = u.project_id
      LEFT JOIN districts d ON d.id = p.district_id
      LEFT JOIN buildings b ON b.id = u.building_ref_id
      WHERE u.id = ${id} AND u.emirate::text = 'Abu Dhabi'
      LIMIT 1
    `,
  ]);
  const r = (rows as any[])[0];
  return r ? (r as RawUnit) : null;
}
