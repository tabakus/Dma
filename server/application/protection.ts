/**
 * Защитные проверки запроса: источник, тип и размер тела, частота, повторная отправка.
 */
import { LIMITS } from '../../shared/application-contract.ts';

/** Минимальный интерфейс KV (совместим с Cloudflare KVNamespace и тестовой заглушкой). */
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export function isAllowedOrigin(request: Request, allowed: string[]): boolean {
  const origin = request.headers.get('Origin');
  if (!origin || origin === 'null') return false;
  return allowed.includes(origin.replace(/\/$/, ''));
}

export type BodyKind = 'urlencoded' | 'multipart';

export function bodyKind(request: Request): BodyKind | null {
  const type = (request.headers.get('Content-Type') ?? '').toLowerCase();
  if (type.startsWith('application/x-www-form-urlencoded')) return 'urlencoded';
  if (type.startsWith('multipart/form-data')) return 'multipart';
  return null;
}

export class PayloadTooLarge extends Error {}

/** Читает тело запроса, не принимая больше лимита (даже если Content-Length не указан или неверен). */
export async function readBodyLimited(request: Request, maxBytes = LIMITS.bodyMaxBytes): Promise<Uint8Array> {
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > maxBytes) throw new PayloadTooLarge();
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new PayloadTooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Разбирает тело формы. Файлы не принимаются: при их наличии возвращает null. */
export async function parseForm(
  bytes: Uint8Array,
  kind: BodyKind,
  contentType: string,
): Promise<((name: string) => string | null) | null> {
  if (kind === 'urlencoded') {
    const params = new URLSearchParams(new TextDecoder().decode(bytes));
    return (name) => params.get(name);
  }
  const form = await new Response(bytes, { headers: { 'Content-Type': contentType } }).formData();
  for (const value of form.values()) if (typeof value !== 'string') return null;
  return (name) => {
    const v = form.get(name);
    return typeof v === 'string' ? v : null;
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const RATE_LIMIT = { windowSeconds: 600, maxRequests: 8 } as const;

/**
 * Ограничение частоты по IP: не больше RATE_LIMIT.maxRequests запросов за окно.
 * IP хранится только в виде хэша и только на время окна.
 * KV работает с задержкой согласования, поэтому лимит приблизительный — это защита
 * от массовых отправок, а не точный счётчик. Основная защита — правило Rate Limiting в Cloudflare.
 */
export async function checkRateLimit(kv: KVLike, ip: string, now: Date): Promise<boolean> {
  const bucket = Math.floor(now.getTime() / 1000 / RATE_LIMIT.windowSeconds);
  const key = `rl:${await sha256Hex(`${ip}|${bucket}`)}`;
  const count = Number((await kv.get(key)) ?? '0');
  if (count >= RATE_LIMIT.maxRequests) return false;
  await kv.put(key, String(count + 1), { expirationTtl: RATE_LIMIT.windowSeconds + 60 });
  return true;
}

export const SUBMISSION_TTL_SECONDS = 24 * 60 * 60;

const submissionKey = (id: string) => `sub:${id}`;

/** Была ли уже успешно обработана заявка с этим submission_id. */
export async function wasSubmitted(kv: KVLike, id: string): Promise<boolean> {
  return (await kv.get(submissionKey(id))) !== null;
}

export async function markSubmitted(kv: KVLike, id: string): Promise<void> {
  await kv.put(submissionKey(id), '1', { expirationTtl: SUBMISSION_TTL_SECONDS });
}
