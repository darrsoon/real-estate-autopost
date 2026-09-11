// HMAC-подписанные сессии на Web Crypto — работает и в Node, и в Edge-рантайме
// (middleware выполняется на Edge, где node:crypto недоступен).
const encoder = new TextEncoder();

async function getKey() {
  const secret = process.env.SESSION_SECRET || 'dev-only-insecure-secret-change-me';
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = '';
  for (const b of arr) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const pad = (4 - (s.length % 4)) % 4;
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  const str = atob(b64);
  const arr = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i);
  return arr;
}

export interface SessionPayload {
  uid: number;
  email: string;
  role: 'admin' | 'editor';
  exp: number; // unix seconds
}

export async function signSession(payload: SessionPayload): Promise<string> {
  const key = await getKey();
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return `${body}.${toBase64Url(sig)}`;
}

export async function verifySession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const key = await getKey();
    const ok = await crypto.subtle.verify('HMAC', key, (fromBase64Url(sig).buffer as ArrayBuffer), encoder.encode(body));
    if (!ok) return null;
    const payload: SessionPayload = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
