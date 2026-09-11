import { NextResponse } from 'next/server';
import { listUsers, createUser } from '@/lib/auth/users';

// Разовый бутстрап первого администратора. Работает только пока в
// app_users нет ни одной записи и только с правильным секретом — после
// первого успешного вызова становится бесполезным сам по себе.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const secret = url.searchParams.get('secret');
  if (!process.env.BOOTSTRAP_SECRET || secret !== process.env.BOOTSTRAP_SECRET) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const existing = await listUsers();
  if (existing.length > 0) {
    return NextResponse.json({ error: 'already bootstrapped' }, { status: 400 });
  }

  const email = process.env.INITIAL_ADMIN_EMAIL;
  if (!email) return NextResponse.json({ error: 'INITIAL_ADMIN_EMAIL not set' }, { status: 500 });

  const { tempPassword } = await createUser(email, 'admin');
  return NextResponse.json({ email, tempPassword });
}
