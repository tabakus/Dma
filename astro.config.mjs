// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Адрес сайта используется для canonical, Open Graph и sitemap.
// Домен deutschmitakzent.de — рабочее предположение, не куплен (см. docs/open-questions.md).
const SITE_URL = process.env.SITE_URL ?? 'https://deutschmitakzent.de';

export default defineConfig({
  site: SITE_URL,
  output: 'static',
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
  // Подсветка кода в Markdown не нужна и несовместима с CSP (встроенные стили Shiki).
  markdown: {
    syntaxHighlight: false,
  },
  // CSP через <meta>: Astro сам считает хэши своих скриптов и стилей.
  // Остальные заголовки безопасности — в public/_headers.
  security: {
    csp: true,
  },
  integrations: [
    sitemap({
      // Служебные страницы не попадают в sitemap.
      filter: (page) => !page.includes('/anfrage/'),
    }),
  ],
});
