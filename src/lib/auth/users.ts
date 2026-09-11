import { authDb } from './db';
import { hashPassword, generateTempPassword } from './password';

export type Role = 'admin' | 'editor';

export interface AppUser {
  id: number;
  email: string;
  role: Role;
  active: boolean;
  must_change_password: boolean;
  created_at: string;
}

let tableReady = false;

export async function ensureUsersTable() {
  if (tableReady) return;
  await authDb`
    CREATE TABLE IF NOT EXISTS app_users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'editor',
      active BOOLEAN NOT NULL DEFAULT true,
      must_change_password BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  tableReady = true;
}

export async function getUserByEmail(email: string) {
  await ensureUsersTable();
  const rows = await authDb`SELECT * FROM app_users WHERE email = ${email.toLowerCase().trim()} LIMIT 1`;
  return rows[0] as any;
}

export async function getUserById(id: number) {
  await ensureUsersTable();
  const rows = await authDb`SELECT * FROM app_users WHERE id = ${id} LIMIT 1`;
  return rows[0] as any;
}

export async function listUsers(): Promise<AppUser[]> {
  await ensureUsersTable();
  const rows = await authDb`SELECT id, email, role, active, must_change_password, created_at FROM app_users ORDER BY created_at ASC`;
  return rows as any;
}

export async function createUser(email: string, role: Role): Promise<{ tempPassword: string }> {
  await ensureUsersTable();
  const tempPassword = generateTempPassword();
  const { hash, salt } = hashPassword(tempPassword);
  await authDb`
    INSERT INTO app_users (email, password_hash, password_salt, role, active, must_change_password)
    VALUES (${email.toLowerCase().trim()}, ${hash}, ${salt}, ${role}, true, true)
    ON CONFLICT (email) DO NOTHING
  `;
  return { tempPassword };
}

export async function setUserActive(id: number, active: boolean) {
  await ensureUsersTable();
  await authDb`UPDATE app_users SET active = ${active} WHERE id = ${id}`;
}

export async function setUserRole(id: number, role: Role) {
  await ensureUsersTable();
  await authDb`UPDATE app_users SET role = ${role} WHERE id = ${id}`;
}

export async function setUserPassword(id: number, newPassword: string, mustChange = false) {
  await ensureUsersTable();
  const { hash, salt } = hashPassword(newPassword);
  await authDb`UPDATE app_users SET password_hash = ${hash}, password_salt = ${salt}, must_change_password = ${mustChange} WHERE id = ${id}`;
}
