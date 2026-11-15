/**
 * Обработка заявки: POST /api/application.
 *
 * Последовательность (соответствует требованиям ТЗ, раздел 6):
 *  1. метод и формат запроса → 2. источник (Origin) → 3. размер тела → 4. разбор формы
 *  → 5. honeypot → 6. конфигурация → 7. частота запросов → 8. проверка полей
 *  → 9. продукт по опубликованному каталогу → 10. повторная отправка
 *  → 11. письмо → 12. SMTP → 13. ответ браузеру.
 *
 * Успех возвращается ТОЛЬКО после того, как SMTP-сервер принял письмо (код 250 на DATA).
 * В логи пишутся коды событий и этапы, без данных посетителя.
 *
 * Ответ: JSON, если браузер прислал Accept: application/json (скрипт формы);
 * иначе переход 303 на /anfrage/danke/ или /anfrage/fehler/ (форма без JavaScript).
 */
import type { ApplicationResponse, CatalogEntry, ErrorCode, FieldErrorCode } from '../../shared/application-contract.ts';
import type { ConfigResult } from './config.ts';
import { buildApplicationEmail, extractAddress, type EmailMessage } from './email.ts';
import {
  bodyKind,
  checkRateLimit,
  isAllowedOrigin,
  markSubmitted,
  parseForm,
  PayloadTooLarge,
  readBodyLimited,
  wasSubmitted,
  type KVLike,
} from './protection.ts';
import { FIELD } from '../../shared/application-contract.ts';
import { validateApplication } from './validate.ts';

export interface HandlerDeps {
  config: ConfigResult;
  /** Отправка письма; должна завершиться ошибкой, если сервер не принял письмо. */
  sendMail: (message: EmailMessage, clientName: string) => Promise<void>;
  /** Опубликованные продукты (из /products.json, который создаёт сборка). */
  loadCatalog: () => Promise<CatalogEntry[]>;
  kv?: KVLike;
  now?: () => Date;
  randomId?: () => string;
  log?: (event: string, details?: Record<string, string | number>) => void;
}

const STATUS: Record<ErrorCode, number> = {
  method_not_allowed: 405,
  forbidden_origin: 403,
  unsupported_content_type: 415,
  payload_too_large: 413,
  invalid_fields: 422,
  unknown_product: 422,
  rate_limited: 429,
  not_configured: 500,
  delivery_failed: 502,
};

const NO_STORE = { 'Cache-Control': 'no-store' };

function respond(request: Request, result: ApplicationResponse, status: number): Response {
  const wantsJson = (request.headers.get('Accept') ?? '').includes('application/json');
  if (wantsJson) {
    return new Response(JSON.stringify(result), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...NO_STORE },
    });
  }
  const location = result.ok ? '/anfrage/danke/' : `/anfrage/fehler/?grund=${result.error}`;
  return new Response(null, { status: 303, headers: { Location: location, ...NO_STORE } });
}

const fail = (request: Request, error: ErrorCode, fields?: Partial<Record<string, FieldErrorCode>>) =>
  respond(request, fields ? { ok: false, error, fields } : { ok: false, error }, STATUS[error]);

const succeed = (request: Request) => respond(request, { ok: true }, 200);

export async function handleApplication(request: Request, deps: HandlerDeps): Promise<Response> {
  const log = deps.log ?? (() => undefined);
  const now = deps.now ?? (() => new Date());
  const randomId = deps.randomId ?? (() => crypto.randomUUID());

  // 1. Метод и формат
  if (request.method !== 'POST') {
    const res = fail(request, 'method_not_allowed');
    res.headers.set('Allow', 'POST');
    return res;
  }

  // 2. Источник: только со своего сайта (защита от отправки с чужих страниц)
  const allowedOrigins = deps.config.ok ? deps.config.config.allowedOrigins : [];
  if (deps.config.ok && !isAllowedOrigin(request, allowedOrigins)) {
    log('rejected', { reason: 'origin' });
    return fail(request, 'forbidden_origin');
  }

  const kind = bodyKind(request);
  if (!kind) return fail(request, 'unsupported_content_type');

  // 3–4. Размер и разбор тела
  let get: ((name: string) => string | null) | null;
  try {
    const bytes = await readBodyLimited(request);
    get = await parseForm(bytes, kind, request.headers.get('Content-Type') ?? '');
  } catch (error) {
    if (error instanceof PayloadTooLarge) return fail(request, 'payload_too_large');
    return fail(request, 'invalid_fields');
  }
  if (!get) return fail(request, 'invalid_fields');

  // 5. Honeypot: боту отвечаем как обычно, но письмо не отправляем
  if ((get(FIELD.honeypot) ?? '') !== '') {
    log('rejected', { reason: 'honeypot' });
    return succeed(request);
  }

  // 6. Конфигурация SMTP
  if (!deps.config.ok) {
    log('not_configured', { missing: deps.config.missing.join(',') });
    return fail(request, 'not_configured');
  }
  const config = deps.config.config;

  // 7. Частота запросов (если подключено KV)
  if (deps.kv) {
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (!(await checkRateLimit(deps.kv, ip, now()))) {
      log('rejected', { reason: 'rate_limit' });
      return fail(request, 'rate_limited');
    }
  }

  // 8. Поля
  const validation = validateApplication(get);
  if (!validation.ok) return fail(request, 'invalid_fields', validation.fields);
  const data = validation.data;

  // 9. Продукт должен быть опубликован; название берём из каталога, а не из формы
  let catalog: CatalogEntry[];
  try {
    catalog = await deps.loadCatalog();
  } catch {
    log('catalog_unavailable');
    return fail(request, 'delivery_failed');
  }
  const product = catalog.find((p) => p.type === data.productType && p.slug === data.productSlug);
  if (!product) return fail(request, 'unknown_product');

  // 10. Повторная отправка той же попытки (сеть оборвалась после успешной отправки)
  if (deps.kv && data.submissionId && (await wasSubmitted(deps.kv, data.submissionId))) {
    log('duplicate_ignored');
    return succeed(request);
  }

  // 11–12. Письмо и SMTP
  const message = buildApplicationEmail({
    data,
    product,
    mailFrom: config.mailFrom,
    mailTo: config.mailTo,
    receivedAt: now(),
    messageIdToken: randomId(),
  });
  const clientName = extractAddress(config.mailFrom).split('@')[1] ?? 'localhost';
  try {
    await deps.sendMail(message, clientName);
  } catch (error) {
    const stage = typeof error === 'object' && error && 'stage' in error ? String(error.stage) : 'unknown';
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
    log('delivery_failed', { stage, code });
    return fail(request, 'delivery_failed');
  }

  if (deps.kv && data.submissionId) {
    await markSubmitted(deps.kv, data.submissionId).catch(() => log('kv_write_failed'));
  }
  log('delivered', { type: product.type });

  // 13. Ответ
  return succeed(request);
}
