import { cookies } from 'next/headers';
import { signSession, verifySession, SessionPayload } from './token';

export const SESSION_COOKIE = 'ab_session';
const SESSION_DAYS = 14;

export async function createSessionCookie(user: { id: number; email: string; role: 'admin' | 'editor' }) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 60 * 60;
  const token = await signSession({ uid: user.id, email: user.email, role: user.role, exp });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return verifySession(token);
}
