import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

// scrypt — без внешних зависимостей, входит в node:crypto.
export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const attempt = scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, 'hex');
  if (attempt.length !== stored.length) return false;
  return timingSafeEqual(attempt, stored);
}

// Временный пароль для новых пользователей — печатные символы без похожих друг на друга (0/O, 1/l и т.п.).
export function generateTempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(10);
  let out = '';
  for (let i = 0; i < 10; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
