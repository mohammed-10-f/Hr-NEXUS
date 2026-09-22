const encoder = new TextEncoder();

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}
function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
export async function hashPassword(password: string, salt = crypto.randomUUID()) {
  const iterations = 100000;
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations, hash: 'SHA-256' }, key, 256);
  return `pbkdf2$${iterations}$${salt}$${bytesToBase64(new Uint8Array(bits))}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [scheme, iterationText, salt, expected] = stored.split('$');
  const iterations = Number(iterationText);
  if (scheme !== 'pbkdf2' || !Number.isSafeInteger(iterations) || iterations < 100000 || !salt || !expected) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations, hash: 'SHA-256' }, key, 256);
  const actual = new Uint8Array(bits), exp = base64ToBytes(expected);
  if (actual.length !== exp.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ exp[i];
  return diff === 0;
}
export async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return bytesToBase64(new Uint8Array(digest));
}

export async function hashOptional(value: string | undefined) {
  return value ? sha256(value) : null;
}
