import crypto from 'crypto';

if (!process.env.JWT_SECRET) {
  throw new Error('FATAL ERROR: JWT_SECRET environment variable is missing. Encryption cannot be initialized.');
}
const secret = process.env.JWT_SECRET;
const ENCRYPTION_KEY = crypto.createHash('sha256').update(secret).digest(); // 32 bytes
const IV_LENGTH = 16; // 16 bytes for AES

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

export function decrypt(text: string): string {
  const parts = text.split(':');
  const ivPart = parts[0];
  const encryptedPart = parts[1];
  if (!ivPart || !encryptedPart) throw new Error('Invalid encrypted format');
  
  const iv = Buffer.from(ivPart, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encryptedPart, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
