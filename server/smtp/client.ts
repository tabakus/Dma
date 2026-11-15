/**
 * Минимальный SMTP-клиент для Cloudflare Workers Runtime.
 *
 * Почему свой, а не Nodemailer: Nodemailer и большинство Node.js SMTP-библиотек используют
 * модули net/tls, которых в Workers нет. Здесь только стандартные Web API (TextEncoder, btoa)
 * и абстрактный сокет; реальное TCP/TLS-соединение даёт cloudflare:sockets (см. cloudflare-socket.ts).
 *
 * Поддерживается: порт 465 (TLS сразу) и 587 (STARTTLS), AUTH PLAIN / AUTH LOGIN,
 * один отправитель и один получатель. Порт 25 не поддерживается.
 *
 * ВАЖНО: работа с конкретным почтовым провайдером ещё не проверена (провайдер не выбран).
 * См. docs/smtp.md — план проверки перед запуском.
 */
import type { SmtpConfig } from '../application/config.ts';
import type { EmailMessage } from '../application/email.ts';

/** Двунаправленный поток байтов (TCP или TLS). Позволяет тестировать протокол без сети. */
export interface SmtpSocket {
  /** Следующий фрагмент данных; null — соединение закрыто. */
  read(): Promise<Uint8Array | null>;
  write(data: Uint8Array): Promise<void>;
  /** Перевод соединения в TLS после STARTTLS. Возвращает новый сокет. */
  startTls(): SmtpSocket;
  close(): Promise<void>;
}

export type SocketFactory = (config: SmtpConfig) => SmtpSocket;

export class SmtpError extends Error {
  /** Этап протокола, на котором произошла ошибка (без данных посетителя). */
  readonly stage: string;
  readonly code: number | null;
  constructor(stage: string, code: number | null, message: string) {
    super(message);
    this.name = 'SmtpError';
    this.stage = stage;
    this.code = code;
  }
}

interface Reply {
  code: number;
  lines: string[];
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class Connection {
  private socket: SmtpSocket;
  private buffer = '';

  constructor(socket: SmtpSocket) {
    this.socket = socket;
  }

  upgrade(): void {
    this.buffer = '';
    this.socket = this.socket.startTls();
  }

  async send(line: string): Promise<void> {
    await this.socket.write(encoder.encode(`${line}\r\n`));
  }

  async sendRaw(data: string): Promise<void> {
    await this.socket.write(encoder.encode(data));
  }

  private async readLine(): Promise<string> {
    for (;;) {
      const idx = this.buffer.indexOf('\r\n');
      if (idx >= 0) {
        const line = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 2);
        return line;
      }
      const chunk = await this.socket.read();
      if (chunk === null) throw new SmtpError('read', null, 'Соединение закрыто сервером');
      this.buffer += decoder.decode(chunk, { stream: true });
      if (this.buffer.length > 64 * 1024) throw new SmtpError('read', null, 'Слишком длинный ответ сервера');
    }
  }

  /** Читает ответ целиком (многострочные ответы вида 250-…/250 …). */
  async reply(): Promise<Reply> {
    const lines: string[] = [];
    for (;;) {
      const line = await this.readLine();
      const match = /^(\d{3})([ -])(.*)$/.exec(line);
      if (!match) throw new SmtpError('read', null, 'Некорректный ответ SMTP');
      lines.push(match[3] ?? '');
      if (match[2] === ' ') return { code: Number(match[1]), lines };
    }
  }

  async expect(stage: string, ...codes: number[]): Promise<Reply> {
    const r = await this.reply();
    if (!codes.includes(r.code)) {
      // Текст ответа сервера не содержит данных посетителя; обрезаем на всякий случай.
      throw new SmtpError(stage, r.code, `SMTP ${stage}: ожидался ${codes.join('/')}, получен ${r.code}`);
    }
    return r;
  }

  async command(stage: string, line: string, ...codes: number[]): Promise<Reply> {
    await this.send(line);
    return this.expect(stage, ...codes);
  }

  async close(): Promise<void> {
    await this.socket.close().catch(() => undefined);
  }
}

/** Экранирование точки в начале строки (RFC 5321, 4.5.2). */
export function dotStuff(raw: string): string {
  return raw.replace(/\r?\n/g, '\r\n').replace(/(^|\r\n)\./g, '$1..');
}

const b64 = (value: string) => {
  let binary = '';
  for (const byte of encoder.encode(value)) binary += String.fromCharCode(byte);
  return btoa(binary);
};

function authMethods(ehlo: Reply): Set<string> {
  const line = ehlo.lines.find((l) => /^AUTH[ =]/i.test(l));
  return new Set(line ? line.slice(5).toUpperCase().split(/\s+/) : []);
}

export interface SendOptions {
  /** Имя для EHLO (обычно домен отправителя). */
  clientName: string;
  /** Общий лимит времени на отправку, мс. */
  timeoutMs?: number;
}

export async function sendMail(
  config: SmtpConfig,
  message: EmailMessage,
  createSocket: SocketFactory,
  options: SendOptions,
): Promise<void> {
  const conn = new Connection(createSocket(config));
  const timeoutMs = options.timeoutMs ?? 15_000;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const session = async () => {
    await conn.expect('greeting', 220);
    let ehlo = await conn.command('ehlo', `EHLO ${options.clientName}`, 250);

    if (config.security === 'starttls') {
      const supports = ehlo.lines.some((l) => /^STARTTLS\b/i.test(l));
      if (!supports) throw new SmtpError('starttls', null, 'Сервер не поддерживает STARTTLS');
      await conn.command('starttls', 'STARTTLS', 220);
      conn.upgrade();
      ehlo = await conn.command('ehlo', `EHLO ${options.clientName}`, 250);
    }

    const methods = authMethods(ehlo);
    if (methods.has('PLAIN')) {
      await conn.command('auth', `AUTH PLAIN ${b64(`\u0000${config.username}\u0000${config.password}`)}`, 235);
    } else if (methods.has('LOGIN')) {
      await conn.command('auth', 'AUTH LOGIN', 334);
      await conn.command('auth', b64(config.username), 334);
      await conn.command('auth', b64(config.password), 235);
    } else {
      throw new SmtpError('auth', null, 'Сервер не предлагает AUTH PLAIN или AUTH LOGIN');
    }

    await conn.command('mail', `MAIL FROM:<${message.envelopeFrom}>`, 250);
    await conn.command('rcpt', `RCPT TO:<${message.envelopeTo}>`, 250, 251);
    await conn.command('data', 'DATA', 354);
    await conn.sendRaw(`${dotStuff(message.raw)}\r\n.\r\n`);
    await conn.expect('data-end', 250);
    // Письмо принято сервером. Ошибка на QUIT уже не влияет на результат.
    await conn.command('quit', 'QUIT', 221).catch(() => undefined);
  };

  try {
    await Promise.race([
      session(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SmtpError('timeout', null, `SMTP: нет ответа за ${timeoutMs} мс`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    await conn.close();
  }
}
