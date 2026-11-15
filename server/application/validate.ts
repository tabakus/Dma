/**
 * Серверная проверка полей заявки. Браузерной проверке не доверяем: всё проверяется здесь заново.
 */
import { FIELD, LIMITS, PRODUCT_TYPES, type FieldErrorCode, type ProductType } from '../../shared/application-contract.ts';

export interface ApplicationData {
  name: string;
  email: string;
  phone: string | null;
  message: string | null;
  productType: ProductType;
  productSlug: string;
  submissionId: string | null;
}

export type ValidationResult =
  | { ok: true; data: ApplicationData }
  | { ok: false; fields: Partial<Record<string, FieldErrorCode>> };

/** Управляющие символы, кроме перевода строки и табуляции (их допускаем только в комментарии). */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029]/;
const CONTROL_SINGLE_LINE = /[\u0000-\u001F\u007F\u2028\u2029]/;

/**
 * Практичная проверка email: одна @, без пробелов и управляющих символов,
 * домен с точкой. Полная RFC 5322 здесь не нужна — адрес проверит ответное письмо.
 */
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]{2,}$/;
const PHONE = /^[0-9+()\-./\s]{5,}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Getter = (name: string) => string | null;

function text(get: Getter, name: string): string {
  return (get(name) ?? '').normalize('NFC').trim();
}

export function validateApplication(get: Getter): ValidationResult {
  const fields: Partial<Record<string, FieldErrorCode>> = {};

  const name = text(get, FIELD.name).replace(/\s+/g, ' ');
  if (!name) fields[FIELD.name] = 'required';
  else if (CONTROL_SINGLE_LINE.test(name)) fields[FIELD.name] = 'invalid';
  else if (name.length < LIMITS.nameMin) fields[FIELD.name] = 'too_short';
  else if (name.length > LIMITS.nameMax) fields[FIELD.name] = 'too_long';

  const email = text(get, FIELD.email);
  if (!email) fields[FIELD.email] = 'required';
  else if (email.length > LIMITS.emailMax) fields[FIELD.email] = 'too_long';
  else if (!EMAIL.test(email) || CONTROL_SINGLE_LINE.test(email)) fields[FIELD.email] = 'invalid';

  const phone = text(get, FIELD.phone);
  if (phone.length > LIMITS.phoneMax) fields[FIELD.phone] = 'too_long';
  else if (phone && !PHONE.test(phone)) fields[FIELD.phone] = 'invalid';

  const message = text(get, FIELD.message).replace(/\r\n?/g, '\n');
  if (message.length > LIMITS.messageMax) fields[FIELD.message] = 'too_long';
  else if (CONTROL.test(message)) fields[FIELD.message] = 'invalid';

  const consent = text(get, FIELD.consent);
  if (consent !== 'yes' && consent !== 'on') fields[FIELD.consent] = 'required';

  const productType = text(get, FIELD.productType);
  if (!(PRODUCT_TYPES as readonly string[]).includes(productType)) fields[FIELD.productType] = 'invalid';

  const productSlug = text(get, FIELD.productSlug);
  if (!productSlug || productSlug.length > LIMITS.slugMax || !SLUG.test(productSlug)) fields[FIELD.productSlug] = 'invalid';

  const submissionIdRaw = text(get, FIELD.submissionId);
  if (submissionIdRaw && !UUID.test(submissionIdRaw)) fields[FIELD.submissionId] = 'invalid';

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return {
    ok: true,
    data: {
      name,
      email,
      phone: phone || null,
      message: message || null,
      productType: productType as ProductType,
      productSlug,
      submissionId: submissionIdRaw ? submissionIdRaw.toLowerCase() : null,
    },
  };
}
