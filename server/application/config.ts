/**
 * Конфигурация обработчика заявок из переменных окружения Cloudflare.
 * Секрет SMTP_PASSWORD задаётся только как зашифрованная переменная (Secret) в Cloudflare
 * или локально в .dev.vars. В репозитории значений нет.
 */

export type SmtpSecurity = 'tls' | 'starttls';

export interface SmtpConfig {
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  password: string;
}

export interface ApplicationConfig {
  smtp: SmtpConfig;
  /** Адрес отправителя, например "Deutsch mit Akzent <noreply@домен>". */
  mailFrom: string;
  /** Получатель заявок. */
  mailTo: string;
  allowedOrigins: string[];
}

/** Переменные окружения Pages Function (wrangler.toml / панель Cloudflare / .dev.vars). */
export interface ApplicationEnv {
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_SECURITY?: string;
  SMTP_USERNAME?: string;
  SMTP_PASSWORD?: string;
  MAIL_FROM?: string;
  MAIL_TO?: string;
  ALLOWED_ORIGINS?: string;
  /** Необязательное KV для ограничения частоты и защиты от повторной отправки. */
  APPLICATION_KV?: KVNamespace;
  /** Статические файлы сайта (есть у каждой Pages Function). */
  ASSETS?: Fetcher;
}

export type ConfigResult = { ok: true; config: ApplicationConfig } | { ok: false; missing: string[] };

/** Разрешённые порты: 465 (TLS сразу) и 587 (STARTTLS). Порт 25 в Cloudflare закрыт и не используется. */
const PORT_SECURITY: Record<number, SmtpSecurity> = { 465: 'tls', 587: 'starttls' };

export function readConfig(env: ApplicationEnv): ConfigResult {
  const missing: string[] = [];
  const need = (key: keyof ApplicationEnv): string => {
    const value = env[key];
    if (typeof value !== 'string' || value.trim() === '') {
      missing.push(key);
      return '';
    }
    return value.trim();
  };

  const host = need('SMTP_HOST');
  const portRaw = need('SMTP_PORT');
  const securityRaw = need('SMTP_SECURITY');
  const username = need('SMTP_USERNAME');
  const password = need('SMTP_PASSWORD');
  const mailFrom = need('MAIL_FROM');
  const mailTo = need('MAIL_TO');
  const originsRaw = need('ALLOWED_ORIGINS');

  const port = Number(portRaw);
  const security = securityRaw as SmtpSecurity;
  if (portRaw && PORT_SECURITY[port] !== security) missing.push('SMTP_PORT/SMTP_SECURITY (465+tls или 587+starttls)');
  if (/[\r\n]/.test(mailFrom + mailTo)) missing.push('MAIL_FROM/MAIL_TO (без переводов строк)');

  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    config: {
      smtp: { host, port, security, username, password },
      mailFrom,
      mailTo,
      allowedOrigins: originsRaw.split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean),
    },
  };
}
