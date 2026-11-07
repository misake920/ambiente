import { createHash, scryptSync, randomBytes, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { dataDir } from './db.ts';
export const hash = (v: string) => createHash('sha256').update(v).digest('hex');
export function passwordHash(password: string) { const salt = randomBytes(16).toString('hex'); return salt + ':' + scryptSync(password, salt, 64).toString('hex'); }
export function checkPassword(password: string, stored: string) { const [salt, key] = stored.split(':'); if (!key) return false; return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(key, 'hex')); }
const keyPath = path.join(dataDir, 'encryption.key');
if (!process.env.ENCRYPTION_KEY && !existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32).toString('hex'), { mode: 0o600 });
const key = Buffer.from(process.env.ENCRYPTION_KEY || readFileSync(keyPath, 'utf8').trim(), 'hex');
if (key.length !== 32) throw new Error('ENCRYPTION_KEY precisa de 64 caracteres hexadecimais.');
export function encrypt(value: string) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); return [iv.toString('hex'), Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]).toString('hex'), cipher.getAuthTag().toString('hex')].join('.'); }
export function decrypt(value: string) { const [iv, text, tag] = value.split('.'); const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex')); cipher.setAuthTag(Buffer.from(tag, 'hex')); return Buffer.concat([cipher.update(Buffer.from(text, 'hex')), cipher.final()]).toString('utf8'); }
export function publicAccount(account: any) { const { tokens, ...safe } = account; return safe; }
