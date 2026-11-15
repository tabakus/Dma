/**
 * Контракт формы заявки: общий для браузерной формы (src/components/forms)
 * и серверного обработчика (server/application). Изменения здесь затрагивают обе стороны.
 */

/** Без завершающего слэша: так маршрут называет Cloudflare Pages (functions/api/application.ts). */
export const APPLICATION_ENDPOINT = '/api/application';

/** Имена полей формы (атрибут name). */
export const FIELD = {
  name: 'name',
  email: 'email',
  phone: 'phone',
  message: 'message',
  consent: 'consent',
  productType: 'product_type',
  productSlug: 'product_slug',
  /** Уникальный id попытки отправки (генерирует скрипт формы) — защита от повторной отправки. */
  submissionId: 'submission_id',
  /** Honeypot: скрытое поле, которое человек не заполняет. */
  honeypot: 'website',
} as const;

export const PRODUCT_TYPES = ['course', 'seminar'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

/** Ограничения длины — одинаковые для браузера (maxlength) и сервера. */
export const LIMITS = {
  nameMin: 2,
  nameMax: 100,
  emailMax: 254,
  phoneMax: 40,
  messageMax: 2000,
  slugMax: 120,
  /** Максимальный размер тела запроса в байтах. */
  bodyMaxBytes: 16 * 1024,
} as const;

/** Коды ошибок, которые сервер возвращает браузеру. Тексты для людей — в src/data/site.yaml. */
export const ERROR_CODES = [
  'method_not_allowed',
  'forbidden_origin',
  'unsupported_content_type',
  'payload_too_large',
  'invalid_fields',
  'unknown_product',
  'rate_limited',
  'not_configured',
  'delivery_failed',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Коды ошибок отдельных полей. */
export type FieldErrorCode = 'required' | 'too_short' | 'too_long' | 'invalid';

export type ApplicationResponse =
  | { ok: true }
  | { ok: false; error: ErrorCode; fields?: Partial<Record<string, FieldErrorCode>> };

/** Публичный список опубликованных продуктов, который генерирует сборка (src/pages/products.json.ts). */
export const PRODUCT_CATALOG_PATH = '/products.json';
export interface CatalogEntry {
  type: ProductType;
  slug: string;
  title: string;
}
