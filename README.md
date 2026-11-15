# Deutsch mit Akzent

Сайт авторской онлайн-школы немецкого языка: каталог курсов и семинаров, страницы продуктов,
форма заявки с отправкой на почту преподавателя.

> **Статус:** технический каркас (этап 1). Дизайна и готовых страниц пока нет.
> Сайт ещё не опубликован, отправка заявок не настроена (нет SMTP-реквизитов).
> Нерешённые вопросы — в [docs/open-questions.md](docs/open-questions.md).

- Репозиторий: [github.com/tabakus/dma](https://github.com/tabakus/dma), основная ветка `main`.
- Язык первой версии сайта — русский (`locale: ru` в `src/data/site.yaml`).
- Основной домен — `deutschmitakzent.de`; регистрация и настройка не подтверждены.

## Стек

| Часть | Технология |
| --- | --- |
| Генератор сайта | [Astro](https://astro.build) 7, статическая сборка |
| Контент | Markdown + YAML, Astro Content Collections со схемами (Zod) |
| Стили | Нативный CSS, дизайн-токены в `src/styles/tokens.css` |
| Интерактивность | TypeScript без клиентских фреймворков (только форма заявки) |
| Заявки | Cloudflare Pages Functions → собственный SMTP-клиент на `cloudflare:sockets` (с реальным провайдером не проверен, см. [docs/smtp.md](docs/smtp.md)) |
| Хостинг | Cloudflare Pages (проект в Cloudflare ещё не создан) |
| Тесты | Встроенный в Node.js `node:test` (без дополнительных зависимостей) |

## Требования

- Node.js **22.23.4** или новее (`node -v`)
- npm 10+

## Команды

```bash
npm install        # установка зависимостей (версии закреплены точно)
npm run dev        # dev-сервер Astro: http://localhost:4321 (без серверной функции)
npm run build      # сборка в dist/
npm run preview    # просмотр собранного сайта
npm run check      # проверка типов: Astro + серверная часть
npm test           # тесты
npm run verify     # всё вместе: check + test + build — запускать перед каждым PR
```

### Локальный запуск вместе с обработчиком заявок

`npm run dev` не запускает Cloudflare Pages Functions. Для проверки формы целиком нужен Wrangler
(в зависимости проекта не входит, запускается через npx):

```bash
cp .dev.vars.example .dev.vars   # подставить SMTP-реквизиты тестового ящика
npm run build
npx wrangler pages dev dist      # сайт + /api/application на http://localhost:8788
```

## Структура

```text
src/
  content/            КОНТЕНТ: курсы, семинары, страницы (Markdown)
    courses/<папка>/index.md   один курс = одна папка (+ изображения рядом)
    seminars/<папка>/index.md
    pages/*.md                 Impressum, Datenschutz и др.
  data/               site.yaml (настройки, меню, тексты формы), home.yaml (главная)
  content.config.ts   подключение коллекций и схем
  components/         ДИЗАЙН: brand/ layout/ catalog/ product/ forms/
  layouts/            BaseLayout: <head>, SEO, шапка, подвал
  styles/             tokens.css, global.css
  lib/                схемы данных, выбор опубликованного, форматирование, schema.org
  pages/              маршруты (/, /kurse/, /seminare/, /[страница]/, /anfrage/*, robots.txt, products.json);
                      адреса разделов — рабочие технические значения
shared/               контракт формы: поля, лимиты, коды ошибок (общий для браузера и сервера)
functions/api/        Cloudflare Pages Function: POST /api/application
server/
  application/        проверки, защита, формирование письма, обработчик
  smtp/               SMTP-клиент для Workers Runtime + адаптер cloudflare:sockets
public/               _headers, fonts/, assets/
tests/                тесты node:test
docs/                 архитектура, SMTP, открытые вопросы
```

Подробно об архитектуре: [docs/architecture.md](docs/architecture.md).
Правила для работы через Claude: [CLAUDE.md](CLAUDE.md).

## Контент

- Новый курс/семинар — новая папка по образцу `_example-course/` / `_example-seminar/`.
- На сайт попадает только `status: published`. `draft` и `archived` не публикуются.
- Схемы проверяются при каждой сборке: ошибка в данных останавливает сборку с указанием файла и поля.

## Переменные окружения (Cloudflare Pages → Settings → Variables and Secrets)

| Переменная | Тип | Назначение |
| --- | --- | --- |
| `SMTP_HOST` | Variable | SMTP-сервер провайдера |
| `SMTP_PORT` | Variable | `465` (TLS) или `587` (STARTTLS). Порт 25 не поддерживается |
| `SMTP_SECURITY` | Variable | `tls` для 465, `starttls` для 587 |
| `SMTP_USERNAME` | Variable | Логин SMTP |
| `SMTP_PASSWORD` | **Secret** | Пароль SMTP / пароль приложения |
| `MAIL_FROM` | Variable | Отправитель, например `Deutsch mit Akzent <noreply@домен>` |
| `MAIL_TO` | Variable | Получатель заявок |
| `ALLOWED_ORIGINS` | Variable | Разрешённые источники через запятую, например `https://deutschmitakzent.de` |
| `APPLICATION_KV` | KV binding | Ограничение частоты и защита от повторной отправки. **Не подключено**: без него эти проверки на сервере не выполняются. Решение — в [docs/open-questions.md](docs/open-questions.md) (В-5) |
| `SITE_URL` | Build variable (необяз.) | Адрес сайта для canonical/sitemap; по умолчанию `https://deutschmitakzent.de` (`astro.config.mjs`) |

Секреты хранятся только в защищённых переменных Cloudflare (`SMTP_PASSWORD` — тип Secret),
не в исходном коде и не в `wrangler.toml`. Для локальной проверки — `.dev.vars` (в `.gitignore`).

Без SMTP-переменных сайт собирается и работает, а форма отвечает ошибкой `not_configured`:
посетитель видит сообщение об ошибке, при отправке со скриптом введённые данные остаются в форме.

## Публикация в Cloudflare Pages (ещё не выполнялась)

1. Создать проект в Cloudflare Pages и подключить репозиторий `tabakus/dma`.
2. Настройки сборки: Build command `npm run build`, Output directory `dist`, переменная `NODE_VERSION=22.23.4`
   (проект требует Node.js ≥ 22.23.4; доступность версии в сборке Cloudflare не проверена — В-12).
3. Задать переменные окружения (таблица выше) отдельно для Production и Preview.
4. Каждый Pull Request получает preview-адрес; продакшен обновляется после слияния в `main`.
5. Откат: Cloudflare Pages → Deployments → выбрать предыдущий деплой → Rollback.

Перед публичным запуском формы нужны: SMTP-реквизиты и проверка по [docs/smtp.md](docs/smtp.md),
рабочее ограничение частоты и защита от повторной отправки (В-5), юридические тексты (В-6…В-8).
Домен, почтовый ящик и публикация на этом этапе не выполнялись.
