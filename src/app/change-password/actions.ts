'use server';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { getUserByEmail, setUserPassword } from '@/lib/auth/users';
import { verifyPassword } from '@/lib/auth/password';

export interface ChangePasswordState {
  error?: string;
}

export async function changePasswordAction(
  _prevState: ChangePasswordState,
  formData: FormData
): Promise<ChangePasswordState> {
  const session = await getSession();
  if (!session) redirect('/login');

  const current = String(formData.get('current') || '');
  const next1 = String(formData.get('next1') || '');
  const next2 = String(formData.get('next2') || '');

  if (next1.length < 8) return { error: 'Новый пароль должен быть не короче 8 символов' };
  if (next1 !== next2) return { error: 'Пароли не совпадают' };

  const user = await getUserByEmail(session.email);
  if (!user) redirect('/login');
  if (!verifyPassword(current, user.password_hash, user.password_salt)) {
    return { error: 'Текущий пароль указан неверно' };
  }

  await setUserPassword(user.id, next1, false);
  redirect('/');
}
