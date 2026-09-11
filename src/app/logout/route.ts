import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/auth/session';

// Обычная GET-ссылка в сайдбаре — так не нужно трогать AppShell ради формы/POST.
export async function GET(request: Request) {
  await clearSessionCookie();
  return NextResponse.redirect(new URL('/login', request.url));
}
