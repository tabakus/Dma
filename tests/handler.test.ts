import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleApplication, type HandlerDeps } from '../server/application/handler.ts';
import { readConfig } from '../server/application/config.ts';
import type { EmailMessage } from '../server/application/email.ts';
import { RATE_LIMIT } from '../server/application/protection.ts';
import { sendMail } from '../server/smtp/client.ts';
import { FakeSmtpServer, formRequest, MemoryKV, VALID_FIELDS } from './helpers.ts';

const ENV = {
  SMTP_HOST: 'smtp.test',
  SMTP_PORT: '465',
  SMTP_SECURITY: 'tls',
  SMTP_USERNAME: 'u',
  SMTP_PASSWORD: 'p',
  MAIL_FROM: 'Deutsch mit Akzent <noreply@site.test>',
  MAIL_TO: 'teacher@site.test',
  ALLOWED_ORIGINS: 'https://deutschmitakzent.de',
};

function setup(overrides: Partial<HandlerDeps> = {}) {
  const sent: EmailMessage[] = [];
  const events: string[] = [];
  const deps: HandlerDeps = {
    config: readConfig(ENV),
    sendMail: async (m) => {
      sent.push(m);
    },
    loadCatalog: async () => [{ type: 'course', slug: 'grammatik-b1', title: 'Grammatik B1' }],
    log: (event, details) => events.push(`${event}${details ? ' ' + JSON.stringify(details) : ''}`),
    ...overrides,
  };
  return { deps, sent, events };
}

async function json(res: Response) {
  return (await res.json()) as { ok: boolean; error?: string; fields?: Record<string, string> };
}

test('успешная заявка: письмо отправлено, ответ ok', async () => {
  const { deps, sent } = setup();
  const res = await handleApplication(formRequest(VALID_FIELDS), deps);
  assert.equal(res.status, 200);
  assert.deepEqual(await json(res), { ok: true });
  assert.equal(sent.length, 1);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});

test('без JavaScript: переход 303 на страницу подтверждения', async () => {
  const { deps } = setup();
  const res = await handleApplication(formRequest(VALID_FIELDS, { accept: 'text/html' }), deps);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('Location'), '/anfrage/danke/');
});

test('multipart/form-data (как отправляет FormData) тоже принимается', async () => {
  const { deps, sent } = setup();
  const fd = new FormData();
  for (const [k, v] of Object.entries(VALID_FIELDS)) fd.set(k, v);
  const probe = new Request('https://x/', { method: 'POST', body: fd });
  const res = await handleApplication(
    formRequest({}, { contentType: probe.headers.get('Content-Type')!, body: await probe.arrayBuffer() }),
    deps,
  );
  assert.equal(res.status, 200);
  assert.equal(sent.length, 1);
});

test('ошибка SMTP: никакого успеха, код delivery_failed, в логе нет данных посетителя', async () => {
  const { deps, events } = setup({
    sendMail: async () => {
      throw Object.assign(new Error('x'), { stage: 'auth', code: 535 });
    },
  });
  const res = await handleApplication(formRequest(VALID_FIELDS), deps);
  assert.equal(res.status, 502);
  assert.deepEqual(await json(res), { ok: false, error: 'delivery_failed' });
  const log = events.join('\n');
  assert.match(log, /delivery_failed .*"stage":"auth"/);
  assert.ok(!log.includes('anna@example.org') && !log.includes('Anna'));

  const html = await handleApplication(formRequest(VALID_FIELDS, { accept: 'text/html' }), deps);
  assert.equal(html.headers.get('Location'), '/anfrage/fehler/?grund=delivery_failed');
});

test('метод не POST — 405', async () => {
  const { deps } = setup();
  const res = await handleApplication(formRequest({}, { method: 'GET' }), deps);
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('Allow'), 'POST');
});

test('чужой или отсутствующий Origin — 403, письмо не отправлено', async () => {
  const { deps, sent } = setup();
  assert.equal((await handleApplication(formRequest(VALID_FIELDS, { origin: 'https://evil.test' }), deps)).status, 403);
  assert.equal((await handleApplication(formRequest(VALID_FIELDS, { origin: null }), deps)).status, 403);
  assert.equal(sent.length, 0);
});

test('неподдерживаемый Content-Type — 415', async () => {
  const { deps } = setup();
  const res = await handleApplication(formRequest(VALID_FIELDS, { contentType: 'application/json', body: '{}' }), deps);
  assert.equal(res.status, 415);
});

test('слишком большое тело — 413', async () => {
  const { deps } = setup();
  const res = await handleApplication(formRequest({ ...VALID_FIELDS, message: 'x'.repeat(20_000) }), deps);
  assert.equal(res.status, 413);
});

test('honeypot заполнен — ответ как обычно, но письмо не отправляется', async () => {
  const { deps, sent, events } = setup();
  const res = await handleApplication(formRequest({ ...VALID_FIELDS, website: 'http://spam' }), deps);
  assert.equal(res.status, 200);
  assert.equal(sent.length, 0);
  assert.ok(events.some((e) => e.includes('honeypot')));
});

test('ошибки полей — 422 с кодами по полям', async () => {
  const { deps, sent } = setup();
  const res = await handleApplication(formRequest({ ...VALID_FIELDS, email: 'nope', consent: '' }), deps);
  assert.equal(res.status, 422);
  assert.deepEqual(await json(res), { ok: false, error: 'invalid_fields', fields: { email: 'invalid', consent: 'required' } });
  assert.equal(sent.length, 0);
});

test('неопубликованный продукт — unknown_product; название берётся из каталога', async () => {
  const { deps, sent } = setup();
  const res = await handleApplication(formRequest({ ...VALID_FIELDS, product_slug: 'nicht-da' }), deps);
  assert.equal(res.status, 422);
  assert.equal((await json(res)).error, 'unknown_product');
  assert.equal(sent.length, 0);
});

test('SMTP не настроен — not_configured (500), письмо не отправляется', async () => {
  const { deps, sent } = setup({ config: readConfig({}) });
  const res = await handleApplication(formRequest(VALID_FIELDS), deps);
  assert.equal(res.status, 500);
  assert.equal((await json(res)).error, 'not_configured');
  assert.equal(sent.length, 0);
});

test('повторная отправка того же submission_id: письмо одно, ответ ok', async () => {
  const kv = new MemoryKV();
  const { deps, sent } = setup({ kv });
  assert.equal((await handleApplication(formRequest(VALID_FIELDS), deps)).status, 200);
  assert.equal((await handleApplication(formRequest(VALID_FIELDS), deps)).status, 200);
  assert.equal(sent.length, 1);
});

test('после сбоя SMTP повтор с тем же submission_id отправляет письмо', async () => {
  const kv = new MemoryKV();
  let fail = true;
  const sent: EmailMessage[] = [];
  const { deps } = setup({
    kv,
    sendMail: async (m) => {
      if (fail) throw new Error('down');
      sent.push(m);
    },
  });
  assert.equal((await handleApplication(formRequest(VALID_FIELDS), deps)).status, 502);
  fail = false;
  assert.equal((await handleApplication(formRequest(VALID_FIELDS), deps)).status, 200);
  assert.equal(sent.length, 1);
});

test('ограничение частоты: после лимита — 429', async () => {
  const kv = new MemoryKV();
  const { deps } = setup({ kv, now: () => new Date('2026-11-15T10:00:00Z') });
  for (let i = 0; i < RATE_LIMIT.maxRequests; i++) {
    const res = await handleApplication(formRequest({ ...VALID_FIELDS, submission_id: '' }), deps);
    assert.equal(res.status, 200);
  }
  const res = await handleApplication(formRequest(VALID_FIELDS), deps);
  assert.equal(res.status, 429);
  // IP хранится только в виде хэша
  assert.ok([...kv.store.keys()].every((k) => !k.includes('203.0.113.7')));
});

test('П-1: SMTP завис после STARTTLS — обработчик возвращает 502 за ограниченное время, без успеха', async () => {
  const smtp = new FakeSmtpServer({ extensions: ['STARTTLS', 'AUTH PLAIN'], tls: 'hang', close: 'hang' });
  const config = readConfig({ ...ENV, SMTP_PORT: '587', SMTP_SECURITY: 'starttls' });
  assert.ok(config.ok);
  const { deps, events } = setup({
    config,
    sendMail: (m, clientName) =>
      sendMail(config.config.smtp, m, () => smtp.socket(), { clientName, timeoutMs: 100, closeTimeoutMs: 50 }),
  });

  const t0 = Date.now();
  const res = await handleApplication(formRequest(VALID_FIELDS), deps);
  const ms = Date.now() - t0;
  assert.equal(res.status, 502);
  assert.deepEqual(await json(res), { ok: false, error: 'delivery_failed' });
  assert.ok(ms < 600, `ответ через ${ms} мс`);
  assert.ok(events.some((e) => e.startsWith('delivery_failed') && e.includes('"stage":"timeout"')));
  assert.equal(smtp.messages.length, 0);

  const html = await handleApplication(formRequest(VALID_FIELDS, { accept: 'text/html' }), deps);
  assert.equal(html.headers.get('Location'), '/anfrage/fehler/?grund=delivery_failed');
});
