import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dotStuff, sendMail, SmtpError } from '../server/smtp/client.ts';
import type { SmtpConfig } from '../server/application/config.ts';
import type { EmailMessage } from '../server/application/email.ts';
import { FakeSmtpServer } from './helpers.ts';

const tls: SmtpConfig = { host: 'smtp.test', port: 465, security: 'tls', username: 'user', password: 'pa55' };
const starttls: SmtpConfig = { ...tls, port: 587, security: 'starttls' };
const message: EmailMessage = {
  envelopeFrom: 'noreply@site.test',
  envelopeTo: 'teacher@site.test',
  raw: 'Subject: test\r\n\r\nline one\r\n.starts with dot',
};
const opts = { clientName: 'site.test', timeoutMs: 1000 };

test('порт 465: TLS сразу, AUTH PLAIN, письмо принято', async () => {
  const server = new FakeSmtpServer();
  await sendMail(tls, message, () => server.socket(), opts);
  assert.equal(server.tlsUpgraded, false);
  assert.deepEqual(
    server.commands.map((c) => c.split(' ')[0]),
    ['EHLO', 'AUTH', 'MAIL', 'RCPT', 'DATA', 'QUIT'],
  );
  assert.equal(server.commands[1], `AUTH PLAIN ${btoa('\u0000user\u0000pa55')}`);
  assert.equal(server.messages.length, 1);
  assert.match(server.messages[0]!, /\r\n\.\.starts with dot$/, 'точка в начале строки экранирована');
  assert.equal(server.closed, true);
});

test('порт 587: STARTTLS, повторный EHLO, затем AUTH', async () => {
  const server = new FakeSmtpServer({ extensions: ['STARTTLS', 'AUTH PLAIN'] });
  await sendMail(starttls, message, () => server.socket(), opts);
  assert.equal(server.tlsUpgraded, true);
  assert.deepEqual(server.commands.slice(0, 3).map((c) => c.split(' ')[0]), ['EHLO', 'STARTTLS', 'EHLO']);
});

test('587 без поддержки STARTTLS — ошибка, пароль не отправляется', async () => {
  const server = new FakeSmtpServer({ extensions: ['AUTH PLAIN'] });
  await assert.rejects(sendMail(starttls, message, () => server.socket(), opts), (e: unknown) => {
    assert.ok(e instanceof SmtpError);
    assert.equal(e.stage, 'starttls');
    return true;
  });
  assert.ok(!server.commands.some((c) => c.startsWith('AUTH')));
});

test('AUTH LOGIN, если PLAIN не предлагается', async () => {
  const server = new FakeSmtpServer({ extensions: ['AUTH LOGIN'] });
  await sendMail(tls, message, () => server.socket(), opts);
  assert.deepEqual(server.commands.slice(1, 4), ['AUTH LOGIN', btoa('user'), btoa('pa55')]);
  assert.equal(server.messages.length, 1);
});

test('неверный пароль — SmtpError на этапе auth, письмо не отправлено', async () => {
  const server = new FakeSmtpServer({ override: { 'AUTH PLAIN': '535 auth failed\r\n' } });
  await assert.rejects(sendMail(tls, message, () => server.socket(), opts), (e: unknown) => {
    assert.ok(e instanceof SmtpError);
    assert.equal(e.stage, 'auth');
    assert.equal(e.code, 535);
    return true;
  });
  assert.equal(server.messages.length, 0);
});

test('сервер отклонил письмо после DATA — ошибка (успех не засчитывается)', async () => {
  const server = new FakeSmtpServer({ override: { 'DATA-END': '554 rejected\r\n' } });
  await assert.rejects(sendMail(tls, message, () => server.socket(), opts), (e: unknown) => {
    assert.ok(e instanceof SmtpError);
    assert.equal(e.stage, 'data-end');
    return true;
  });
});

test('ошибка на QUIT после принятого письма не считается сбоем', async () => {
  const server = new FakeSmtpServer({ override: { QUIT: '500 whatever\r\n' } });
  await sendMail(tls, message, () => server.socket(), opts);
  assert.equal(server.messages.length, 1);
});

test('таймаут, если сервер молчит', async () => {
  const silent = {
    read: () => new Promise<Uint8Array | null>(() => undefined),
    write: async () => undefined,
    startTls() {
      return silent;
    },
    close: async () => undefined,
  };
  await assert.rejects(sendMail(tls, message, () => silent, { clientName: 'x', timeoutMs: 50 }), (e: unknown) => {
    assert.ok(e instanceof SmtpError);
    assert.equal(e.stage, 'timeout');
    return true;
  });
});

test('dotStuff нормализует переводы строк и экранирует точки', () => {
  assert.equal(dotStuff('.a\n.b\r\nc'), '..a\r\n..b\r\nc');
});
