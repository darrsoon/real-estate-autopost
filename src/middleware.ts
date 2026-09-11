import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { verifySession } from '@/lib/auth/token';
import { SESSION_COOKIE } from '@/lib/auth/session';

// Пути, доступные без входа — сюда стучатся внешние сервисы (крон, вебхуки,
// OAuth-редиректы), у них нет и не может быть куки с сессией.
const PUBLIC_PREFIXES = [
  '/login',
  '/api/cron',
  '/api/telegram/webhook',
  '/api/canva-oauth',
  '/api/project-sync',
  '/api/admin/bootstrap',
];

function isPublic(pathname: string) {
  return PUBLIC_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);

  if (!session) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Мгновенная проверка: администратор мог только что отключить доступ —
  // сверяем актуальное состояние в базе на каждый переход по страницам,
  // а не полагаемся только на срок жизни куки.
  try {
    const sql = neon(process.env.META_DB_URL!);
    const rows = await sql`SELECT active, role, must_change_password FROM app_users WHERE id = ${session.uid} LIMIT 1`;
    const row = rows[0] as { active: boolean; role: string; must_change_password: boolean } | undefined;

    if (!row || !row.active) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('next', pathname);
      const res = NextResponse.redirect(url);
      res.cookies.delete(SESSION_COOKIE);
      return res;
    }

    if (row.must_change_password && pathname !== '/change-password') {
      const url = request.nextUrl.clone();
      url.pathname = '/change-password';
      return NextResponse.redirect(url);
    }

    if (pathname.startsWith('/admin') && row.role !== 'admin') {
      const url = request.nextUrl.clone();
      url.pathname = '/';
      return NextResponse.redirect(url);
    }
  } catch {
    // База недоступна — не блокируем работу мягким отказом, сессия остаётся
    // валидной до истечения срока куки.
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
