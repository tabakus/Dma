/**
 * Cloudflare Pages Function: POST /api/application
 *
 * Тонкая обёртка: связывает окружение Cloudflare (переменные, KV, статические файлы, TCP-сокеты)
 * с независимой от платформы логикой в server/application/handler.ts.
 */
import type { CatalogEntry } from '../../shared/application-contract.ts';
import { PRODUCT_CATALOG_PATH } from '../../shared/application-contract.ts';
import { readConfig, type ApplicationEnv } from '../../server/application/config.ts';
import { handleApplication } from '../../server/application/handler.ts';
import { sendMail } from '../../server/smtp/client.ts';
import { createCloudflareSocket } from '../../server/smtp/cloudflare-socket.ts';

export const onRequest: PagesFunction<ApplicationEnv> = async ({ request, env }) => {
  const config = readConfig(env);

  return handleApplication(request, {
    config,
    kv: env.APPLICATION_KV,
    sendMail: (message, clientName) => {
      if (!config.ok) throw new Error('not configured');
      return sendMail(config.config.smtp, message, createCloudflareSocket, { clientName });
    },
    loadCatalog: async () => {
      if (!env.ASSETS) throw new Error('ASSETS binding unavailable');
      const res = await env.ASSETS.fetch(new URL(PRODUCT_CATALOG_PATH, request.url));
      if (!res.ok) throw new Error(`catalog ${res.status}`);
      return (await res.json()) as CatalogEntry[];
    },
    // Только коды событий и этапы — без имён, адресов и текстов заявок.
    log: (event, details) => console.log(JSON.stringify({ scope: 'application', event, ...details })),
  });
};
