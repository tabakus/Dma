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

// --- П-1: завершение соединения не может подвесить отправку ---------------------------------

const fast = { clientName: 'site.test', timeoutMs: 100, closeTimeoutMs: 50 };

/** Время выполнения промиса в мс. */
async function timed<T>(p: Promise<T>): Promise<{ ms: number; result: PromiseSettledResult<T> }> {
  const t0 = Date.now();
  const [result] = await Promise.allSettled([p]);
  return { ms: Date.now() - t0, result: result! };
}

test('STARTTLS успешен: письмо принято, сокет закрыт один раз', async () => {
  const server = new FakeSmtpServer({ extensions: ['STARTTLS', 'AUTH PLAIN'] });
  await sendMail(starttls, message, () => server.socket(), fast);
  assert.equal(server.tlsUpgraded, true);
  assert.equal(server.messages.length, 1);
  assert.equal(server.closeCalls, 1);
});

test('STARTTLS отклонён сервером (454): ошибка starttls, сокет закрыт один раз', async () => {
  const server = new FakeSmtpServer({ extensions: ['STARTTLS', 'AUTH PLAIN'], override: { STARTTLS: '454 TLS not available\r\n' } });
  const { result } = await timed(sendMail(starttls, message, () => server.socket(), fast));
  assert.equal(result.status, 'rejected');
  assert.ok(result.status === 'rejected' && result.reason instanceof SmtpError && result.reason.stage === 'starttls');
  assert.equal(server.tlsUpgraded, false);
  assert.equal(server.closeCalls, 1);
});

test('TLS-рукопожатие после STARTTLS завершилось ошибкой: быстрый отказ, письмо не отправлено', async () => {
  const server = new FakeSmtpServer({ extensions: ['STARTTLS', 'AUTH PLAIN'], tls: 'fail' });
  const { ms, result } = await timed(sendMail(starttls, message, () => server.socket(), fast));
  assert.equal(result.status, 'rejected');
  assert.ok(ms < 100, `ожидался отказ до таймаута, прошло ${ms} мс`);
  assert.equal(server.messages.length, 0);
  assert.equal(server.closeCalls, 1);
});

test('TLS не устанавливается и close() зависает: отказ по таймауту за ограниченное время (П-1)', async () => {
  const server = new FakeSmtpServer({ extensions: ['STARTTLS', 'AUTH PLAIN'], tls: 'hang', close: 'hang' });
  const { ms, result } = await timed(sendMail(starttls, message, () => server.socket(), fast));
  assert.equal(result.status, 'rejected');
  assert.ok(result.status === 'rejected' && result.reason instanceof SmtpError && result.reason.stage === 'timeout');
  // timeoutMs (100) + closeTimeoutMs (50) + запас на планировщик
  assert.ok(ms >= 140 && ms < 600, `время ${ms} мс вне ожидаемого диапазона`);
  assert.equal(server.messages.length, 0);
  assert.equal(server.closeCalls, 1);
});

test('close() зависает после успешной отправки: успех возвращается не позже closeTimeoutMs', async () => {
  const server = new FakeSmtpServer({ close: 'hang' });
  const { ms, result } = await timed(sendMail(tls, message, () => server.socket(), fast));
  assert.equal(result.status, 'fulfilled');
  assert.equal(server.messages.length, 1);
  assert.ok(ms < 400, `закрытие ждали ${ms} мс`);
});

test('штатное закрытие не ждёт closeTimeoutMs', async () => {
  const server = new FakeSmtpServer();
  const { ms, result } = await timed(sendMail(tls, message, () => server.socket(), { ...fast, closeTimeoutMs: 5_000 }));
  assert.equal(result.status, 'fulfilled');
  assert.equal(server.closed, true);
  assert.ok(ms < 1_000, `закрытие ждали ${ms} мс`);
});

test('ошибка сокета при закрытии (reject и синхронный throw) не меняет результат отправки', async () => {
  for (const mode of ['reject', 'throw'] as const) {
    const ok = new FakeSmtpServer({ close: mode });
    await sendMail(tls, message, () => ok.socket(), fast);
    assert.equal(ok.messages.length, 1, `${mode}: письмо принято`);
    assert.equal(ok.closeCalls, 1);

    const bad = new FakeSmtpServer({ close: mode, override: { 'AUTH PLAIN': '535 auth failed\r\n' } });
    await assert.rejects(sendMail(tls, message, () => bad.socket(), fast), (e: unknown) => {
      assert.ok(e instanceof SmtpError);
      assert.equal(e.stage, 'auth', `${mode}: исходная ошибка не подменяется ошибкой закрытия`);
      return true;
    });
    assert.equal(bad.closeCalls, 1);
  }
});
