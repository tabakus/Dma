import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateApplication } from '../server/application/validate.ts';
import { buildApplicationEmail, encodeHeaderValue } from '../server/application/email.ts';
import { readConfig } from '../server/application/config.ts';
import { VALID_FIELDS } from './helpers.ts';

const getter = (fields: Record<string, string>) => (name: string) => fields[name] ?? null;

test('корректная заявка проходит проверку', () => {
  const r = validateApplication(getter(VALID_FIELDS));
  assert.ok(r.ok);
  assert.equal(r.data.name, 'Anna Schmidt');
  assert.equal(r.data.productType, 'course');
});

test('телефон и комментарий необязательны', () => {
  const r = validateApplication(getter({ ...VALID_FIELDS, phone: '', message: '', submission_id: '' }));
  assert.ok(r.ok);
  assert.equal(r.data.phone, null);
  assert.equal(r.data.message, null);
  assert.equal(r.data.submissionId, null);
});

test('обязательные поля и согласие', () => {
  const r = validateApplication(getter({ ...VALID_FIELDS, name: ' ', email: '', consent: '' }));
  assert.ok(!r.ok);
  assert.deepEqual(r.fields, { name: 'required', email: 'required', consent: 'required' });
});

test('некорректные значения', () => {
  const r = validateApplication(
    getter({
      ...VALID_FIELDS,
      email: 'anna@@example',
      phone: 'call me',
      product_type: 'webinar',
      product_slug: '../etc',
      submission_id: 'not-a-uuid',
    }),
  );
  assert.ok(!r.ok);
  assert.deepEqual(r.fields, {
    email: 'invalid',
    phone: 'invalid',
    product_type: 'invalid',
    product_slug: 'invalid',
    submission_id: 'invalid',
  });
});

test('перевод строки в имени или email отклоняется (защита заголовков)', () => {
  const r1 = validateApplication(getter({ ...VALID_FIELDS, email: 'a@b.de\r\nBcc: x@y.de' }));
  assert.ok(!r1.ok);
  assert.equal(r1.fields.email, 'invalid');
  // в имени пробельные символы схлопываются в один пробел
  const r2 = validateApplication(getter({ ...VALID_FIELDS, name: 'Anna\r\nBcc: x@y.de' }));
  assert.ok(r2.ok);
  assert.equal(r2.data.name, 'Anna Bcc: x@y.de');
});

test('ограничения длины', () => {
  const r = validateApplication(getter({ ...VALID_FIELDS, name: 'A', message: 'x'.repeat(2001) }));
  assert.ok(!r.ok);
  assert.equal(r.fields.name, 'too_short');
  assert.equal(r.fields.message, 'too_long');
});

test('письмо: данные посетителя не попадают в заголовки в сыром виде', () => {
  const v = validateApplication(getter({ ...VALID_FIELDS, name: 'Анна <script>' }));
  assert.ok(v.ok);
  const email = buildApplicationEmail({
    data: v.data,
    product: { type: 'course', slug: 'grammatik-b1', title: 'Grammatik: B1 — für alle' },
    mailFrom: 'Deutsch mit Akzent <noreply@site.test>',
    mailTo: 'teacher@site.test',
    receivedAt: new Date('2026-11-15T10:00:00Z'),
    messageIdToken: 'abc',
  });
  const [head = '', body = ''] = email.raw.split('\r\n\r\n');
  assert.equal(email.envelopeFrom, 'noreply@site.test');
  assert.equal(email.envelopeTo, 'teacher@site.test');
  assert.match(head, /^Reply-To: <anna@example\.org>$/m);
  assert.match(head, /^Subject: =\?UTF-8\?B\?/m);
  assert.ok(!head.includes('Анна'), 'имя посетителя не в заголовках');
  assert.match(head, /^Content-Transfer-Encoding: base64$/m);
  const decoded = new TextDecoder().decode(Uint8Array.from(atob(body.replace(/\r\n/g, '')), (c) => c.charCodeAt(0)));
  assert.match(decoded, /Имя: Анна <script>/);
  assert.match(decoded, /Курс: Grammatik: B1 — für alle \(grammatik-b1\)/);
});

test('encodeHeaderValue: ASCII без изменений, переводы строк убираются', () => {
  assert.equal(encodeHeaderValue('Hello\r\nBcc: x'), 'Hello Bcc: x');
  assert.match(encodeHeaderValue('Заявка'), /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
});

test('конфигурация: без переменных — список недостающих, порт 25 не принимается', () => {
  const empty = readConfig({});
  assert.ok(!empty.ok);
  assert.ok(empty.missing.includes('SMTP_PASSWORD'));

  const base = {
    SMTP_HOST: 'smtp.test',
    SMTP_USERNAME: 'u',
    SMTP_PASSWORD: 'p',
    MAIL_FROM: 'a@site.test',
    MAIL_TO: 'b@site.test',
    ALLOWED_ORIGINS: 'https://deutschmitakzent.de/, http://localhost:8788',
  };
  assert.ok(!readConfig({ ...base, SMTP_PORT: '25', SMTP_SECURITY: 'tls' }).ok);
  assert.ok(!readConfig({ ...base, SMTP_PORT: '465', SMTP_SECURITY: 'starttls' }).ok);
  const ok = readConfig({ ...base, SMTP_PORT: '587', SMTP_SECURITY: 'starttls' });
  assert.ok(ok.ok);
  assert.deepEqual(ok.config.allowedOrigins, ['https://deutschmitakzent.de', 'http://localhost:8788']);
});
