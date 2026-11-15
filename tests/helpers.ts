/** Общие заглушки для тестов: SMTP-сервер в памяти, KV в памяти, построитель запросов. */
import type { SmtpSocket } from '../server/smtp/client.ts';
import type { KVLike } from '../server/application/protection.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

export interface FakeSmtpOptions {
  /** Строки, которые сервер перечисляет в ответе на EHLO (после первой). */
  extensions?: string[];
  /** Переопределить ответ на конкретную команду (по началу строки). */
  override?: Record<string, string>;
}

/**
 * SMTP-сервер в памяти. Записывает команды клиента и принятые письма.
 */
export class FakeSmtpServer {
  commands: string[] = [];
  messages: string[] = [];
  tlsUpgraded = false;
  closed = false;
  private options: FakeSmtpOptions;

  constructor(options: FakeSmtpOptions = {}) {
    this.options = options;
  }

  socket(): SmtpSocket {
    const queue: string[] = ['220 fake.smtp ready\r\n'];
    let waiters: Array<(v: Uint8Array | null) => void> = [];
    let inData = false;
    let dataBuf = '';
    let pending = '';
    const server = this;

    const push = (text: string) => {
      const w = waiters.shift();
      if (w) w(enc.encode(text));
      else queue.push(text);
    };

    const replyFor = (cmd: string): string => {
      for (const [prefix, reply] of Object.entries(server.options.override ?? {})) {
        if (cmd.toUpperCase().startsWith(prefix)) return reply;
      }
      const upper = cmd.toUpperCase();
      if (upper.startsWith('EHLO')) {
        const ext = server.options.extensions ?? ['AUTH PLAIN LOGIN'];
        return ['250-fake.smtp', ...ext.map((e, i) => `250${i === ext.length - 1 ? ' ' : '-'}${e}`)].join('\r\n') + '\r\n';
      }
      if (upper === 'STARTTLS') return '220 go ahead\r\n';
      if (upper.startsWith('AUTH PLAIN')) return '235 ok\r\n';
      if (upper === 'AUTH LOGIN') return '334 VXNlcm5hbWU6\r\n';
      if (upper.startsWith('MAIL FROM')) return '250 ok\r\n';
      if (upper.startsWith('RCPT TO')) return '250 ok\r\n';
      if (upper === 'DATA') return '354 go\r\n';
      if (upper === 'QUIT') return '221 bye\r\n';
      return '500 unknown command\r\n';
    };

    let loginStep = -1; // -1: AUTH LOGIN не начат; 0,1: ждём логин и пароль
    const make = (): SmtpSocket => ({
      async read() {
        const next = queue.shift();
        if (next !== undefined) return enc.encode(next);
        if (server.closed) return null;
        return new Promise((resolve) => waiters.push(resolve));
      },
      async write(data) {
        pending += dec.decode(data);
        if (inData) {
          dataBuf += pending;
          pending = '';
          if (dataBuf.endsWith('\r\n.\r\n')) {
            server.messages.push(dataBuf.slice(0, -5));
            dataBuf = '';
            inData = false;
            push(server.options.override?.['DATA-END'] ?? '250 queued\r\n');
          }
          return;
        }
        let idx: number;
        while ((idx = pending.indexOf('\r\n')) >= 0) {
          const cmd = pending.slice(0, idx);
          pending = pending.slice(idx + 2);
          server.commands.push(cmd);
          let reply: string;
          if (loginStep >= 0) {
            reply = loginStep === 0 ? '334 UGFzc3dvcmQ6\r\n' : '235 ok\r\n';
            loginStep = loginStep === 0 ? 1 : -1;
          } else {
            reply = replyFor(cmd);
            if (cmd.toUpperCase() === 'AUTH LOGIN' && reply.startsWith('334')) loginStep = 0;
          }
          if (cmd.toUpperCase() === 'DATA' && reply.startsWith('354')) inData = true;
          push(reply);
          if (inData && pending) {
            dataBuf += pending;
            pending = '';
          }
        }
      },
      startTls() {
        server.tlsUpgraded = true;
        return make();
      },
      async close() {
        server.closed = true;
        waiters.forEach((w) => w(null));
        waiters = [];
      },
    });
    return make();
  }
}

export class MemoryKV implements KVLike {
  store = new Map<string, string>();
  async get(key: string) {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string) {
    this.store.set(key, value);
  }
}

export const VALID_FIELDS: Record<string, string> = {
  name: 'Anna Schmidt',
  email: 'anna@example.org',
  phone: '+49 30 1234567',
  message: 'Hallo!\nIch habe eine Frage.',
  consent: 'yes',
  product_type: 'course',
  product_slug: 'grammatik-b1',
  submission_id: '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90',
  website: '',
};

export function formRequest(
  fields: Record<string, string>,
  init: { method?: string; origin?: string | null; accept?: string; contentType?: string; body?: BodyInit } = {},
): Request {
  const headers = new Headers();
  if (init.origin !== null) headers.set('Origin', init.origin ?? 'https://deutschmitakzent.de');
  headers.set('Accept', init.accept ?? 'application/json');
  headers.set('Content-Type', init.contentType ?? 'application/x-www-form-urlencoded');
  headers.set('CF-Connecting-IP', '203.0.113.7');
  const method = init.method ?? 'POST';
  return new Request('https://deutschmitakzent.de/api/application', {
    method,
    headers,
    body: method === 'GET' ? undefined : (init.body ?? new URLSearchParams(fields).toString()),
  });
}
