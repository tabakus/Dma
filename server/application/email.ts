/**
 * Формирование письма с заявкой (RFC 5322 / MIME, UTF-8).
 *
 * Безопасность: данные посетителя попадают в заголовки только в закодированном виде
 * (RFC 2047) и без переводов строк, а тело письма — обычный текст в base64.
 * Это исключает подмену заголовков (header injection) и HTML-инъекции.
 */
import type { ApplicationData } from './validate.ts';
import type { CatalogEntry } from '../../shared/application-contract.ts';

export interface EmailMessage {
  /** Адрес для команды MAIL FROM. */
  envelopeFrom: string;
  /** Адрес для команды RCPT TO. */
  envelopeTo: string;
  /** Готовое письмо с CRLF-переводами строк, без завершающей точки SMTP. */
  raw: string;
}

const encoder = new TextEncoder();

export function base64Utf8(value: string): string {
  let binary = '';
  for (const byte of encoder.encode(value)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const stripLineBreaks = (value: string) => value.replace(/[\r\n\u2028\u2029]+/g, ' ').trim();

/** Кодированное слово RFC 2047 для заголовков с не-ASCII символами. */
export function encodeHeaderValue(value: string): string {
  const clean = stripLineBreaks(value);
  if (/^[\x20-\x7E]*$/.test(clean)) return clean;
  // Разбиваем на части, чтобы закодированные слова не превышали 75 символов.
  const words: string[] = [];
  let chunk = '';
  for (const ch of clean) {
    if (encoder.encode(chunk + ch).length > 45) {
      words.push(`=?UTF-8?B?${base64Utf8(chunk)}?=`);
      chunk = '';
    }
    chunk += ch;
  }
  if (chunk) words.push(`=?UTF-8?B?${base64Utf8(chunk)}?=`);
  return words.join('\r\n ');
}

/** Достаёт адрес из "Имя <адрес>" или возвращает строку как есть. */
export function extractAddress(mailbox: string): string {
  const match = /<([^<>\s]+)>\s*$/.exec(mailbox);
  return (match?.[1] ?? mailbox).trim();
}

/** Форматирует "Имя <адрес>" с безопасной кодировкой имени. */
function formatMailbox(mailbox: string): string {
  const address = extractAddress(mailbox);
  const display = mailbox.replace(/<[^<>]*>\s*$/, '').trim().replace(/^"|"$/g, '');
  return display ? `${encodeHeaderValue(display)} <${address}>` : `<${address}>`;
}

function wrapBase64(value: string): string {
  return value.replace(/.{1,76}/g, '$&\r\n');
}

export interface BuildEmailInput {
  data: ApplicationData;
  product: CatalogEntry;
  mailFrom: string;
  mailTo: string;
  /** Время получения (для письма и Message-ID). */
  receivedAt: Date;
  /** Случайная часть Message-ID. */
  messageIdToken: string;
}

const TYPE_LABEL = { course: 'Курс', seminar: 'Семинар' } as const;

export function buildApplicationEmail(input: BuildEmailInput): EmailMessage {
  const { data, product, mailFrom, mailTo, receivedAt, messageIdToken } = input;
  const fromAddress = extractAddress(mailFrom);
  const domain = fromAddress.split('@')[1] ?? 'localhost';

  const lines = [
    `Новая заявка: ${TYPE_LABEL[product.type]} «${product.title}»`,
    '',
    `Имя: ${data.name}`,
    `Email: ${data.email}`,
    `Телефон: ${data.phone ?? '—'}`,
    `${TYPE_LABEL[product.type]}: ${product.title} (${product.slug})`,
    '',
    'Комментарий:',
    data.message ?? '—',
    '',
    `Получено: ${receivedAt.toISOString()}`,
    'Согласие на обработку персональных данных: да',
  ];
  const body = lines.join('\r\n');

  const headers = [
    `From: ${formatMailbox(mailFrom)}`,
    `To: ${formatMailbox(mailTo)}`,
    `Reply-To: <${data.email}>`,
    `Subject: ${encodeHeaderValue(`Заявка: ${product.title}`)}`,
    `Date: ${receivedAt.toUTCString()}`,
    `Message-ID: <${messageIdToken}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ];

  return {
    envelopeFrom: fromAddress,
    envelopeTo: extractAddress(mailTo),
    raw: `${headers.join('\r\n')}\r\n\r\n${wrapBase64(base64Utf8(body))}`,
  };
}
