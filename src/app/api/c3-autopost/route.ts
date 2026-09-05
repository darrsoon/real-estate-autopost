import { NextResponse } from 'next/server';
import { listC3UnitNumbers, getC3PostData, C3_PROJECT } from '@/lib/c3/units';
import { findC3SlideByUnit } from '@/lib/google/drive';
import { buildTelegramHtmlPost } from '@/lib/posts/templates';

// Данные C3 берутся из базы вживую — кэшировать нечего.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    return NextResponse.json({ units: await listC3UnitNumbers() });
  } catch (error: any) {
    console.error('Failed to get C3 units:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch units' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { unit } = await req.json();
    if (!unit) {
      return NextResponse.json({ error: 'Unit is required' }, { status: 400 });
    }

    const parsed = await getC3PostData(unit);
    if (!parsed) {
      return NextResponse.json({ error: `Юнит ${unit} не найден в базе среди доступных по ${C3_PROJECT}` }, { status: 404 });
    }

    // Слайд лежит на Диске отдельным файлом, названным по номеру юнита.
    let slideDataUrl = '';
    try {
      slideDataUrl = await findC3SlideByUnit(unit);
    } catch (e: any) {
      return NextResponse.json({ error: `Failed to find slide image: ${e.message}` }, { status: 404 });
    }

    const data: any = { ...parsed, slideDataUrl, slideName: `${unit}.jpg` };
    const preview = await buildTelegramHtmlPost(data);

    return NextResponse.json({ parsed: data, preview, slideDataUrl });
  } catch (error: any) {
    console.error('C3 Autopost error:', error);
    return NextResponse.json({ error: error.message || 'Failed to process request' }, { status: 500 });
  }
}
