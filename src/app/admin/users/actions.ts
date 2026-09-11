'use server';
import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/auth/session';
import { createUser, setUserActive, setUserRole, listUsers, Role } from '@/lib/auth/users';

async function requireAdmin() {
  const session = await getSession();
  if (!session || session.role !== 'admin') throw new Error('Forbidden');
  return session;
}

export interface AddUserState {
  error?: string;
  tempPassword?: string;
  email?: string;
}

export async function addUserAction(_prevState: AddUserState, formData: FormData): Promise<AddUserState> {
  await requireAdmin();
  const email = String(formData.get('email') || '').trim().toLowerCase();
  const role = String(formData.get('role') || 'editor') as Role;
  if (!email) return { error: 'Введите email' };

  const existing = await listUsers();
  if (existing.some(u => u.email === email)) return { error: 'Такой пользователь уже есть' };

  const { tempPassword } = await createUser(email, role);
  revalidatePath('/admin/users');
  return { tempPassword, email };
}

export async function toggleActiveAction(id: number, active: boolean) {
  await requireAdmin();
  await setUserActive(id, active);
  revalidatePath('/admin/users');
}

export async function changeRoleAction(id: number, role: Role) {
  await requireAdmin();
  await setUserRole(id, role);
  revalidatePath('/admin/users');
}
