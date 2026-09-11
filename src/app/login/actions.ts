'use server';
import { redirect } from 'next/navigation';
import { getUserByEmail } from '@/lib/auth/users';
import { verifyPassword } from '@/lib/auth/password';
import { createSessionCookie } from '@/lib/auth/session';

export interface LoginState {
  error?: string;
}

export async function loginAction(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');
  const next = String(formData.get('next') || '/');

  if (!email || !password) return { error: 'Введите email и пароль' };

  const user = await getUserByEmail(email);
  if (!user || !user.active) return { error: 'Неверный email или пароль' };

  const ok = verifyPassword(password, user.password_hash, user.password_salt);
  if (!ok) return { error: 'Неверный email или пароль' };

  await createSessionCookie({ id: user.id, email: user.email, role: user.role });

  if (user.must_change_password) redirect('/change-password');
  redirect(next && next.startsWith('/') ? next : '/');
}
