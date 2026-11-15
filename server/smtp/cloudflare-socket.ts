/**
 * Адаптер TCP/TLS-сокета Cloudflare (API connect() из cloudflare:sockets) к интерфейсу SmtpSocket.
 * Этот файл работает только в Cloudflare Workers / Pages Functions; в тестах не используется.
 */
import { connect } from 'cloudflare:sockets';
import type { SmtpConfig } from '../application/config.ts';
import type { SmtpSocket } from './client.ts';

function wrap(socket: Socket): SmtpSocket {
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  return {
    async read() {
      const { value, done } = await reader.read();
      return done ? null : (value as Uint8Array);
    },
    async write(data) {
      await writer.write(data);
    },
    startTls() {
      reader.releaseLock();
      writer.releaseLock();
      return wrap(socket.startTls());
    },
    async close() {
      await socket.close();
    },
  };
}

export function createCloudflareSocket(config: SmtpConfig): SmtpSocket {
  const socket = connect(
    { hostname: config.host, port: config.port },
    { secureTransport: config.security === 'tls' ? 'on' : 'starttls', allowHalfOpen: false },
  );
  return wrap(socket);
}
