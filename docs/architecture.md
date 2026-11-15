# Архитектура Deutsch mit Akzent

Статический сайт (Astro) плюс одна серверная функция для заявок (Cloudflare Pages Functions).
Сервера приложений, базы данных и админ-панели нет.

## Четыре зоны

| Зона | Где | Отвечает за | Меняется при обновлении контента |
| --- | --- | --- | --- |
| Content | `src/content/`, `src/data/` | Тексты, данные продуктов, изображения | Да |
| Design | `src/components/`, `src/layouts/`, `src/styles/`, `public/` | Внешний вид | Нет |
| Application | `src/pages/`, `src/lib/`, `src/content.config.ts`, `shared/` | Маршруты, схемы, отбор опубликованного, контракт формы | Нет |
| Backend | `functions/`, `server/` | Приём заявки, проверки, защита, SMTP | Нет |

Зависимости идут в одну сторону: Design и Application читают Content; Backend не зависит
от Design и знает о контенте только через публичный `/products.json`. Общий код браузера и сервера —
только контракт формы в `shared/application-contract.ts`.

## Отклонения от исходной структуры ТЗ (с обоснованием)

| Добавлено | Зачем |
| --- | --- |
| `server/` | Логика обработчика вынесена из `functions/`: в `functions/` каждый файл становится маршрутом Cloudflare, а логику нужно тестировать отдельно от платформы. `functions/api/application.ts` — тонкая обёртка. |
| `shared/` | Имена полей, лимиты и коды ошибок нужны и форме, и серверу. Один источник вместо двух копий. |
| `docs/` | Архитектура, требования к SMTP и открытые вопросы — отдельно от README. |
| `src/lib/schemas.ts` | Схемы отделены от `content.config.ts`, чтобы их можно было тестировать без Astro. |
| `src/content.config.ts` | Файл конфигурации коллекций, обязательный для Astro. |
| `wrangler.toml`, `.dev.vars.example`, `tsconfig.server.json` | Конфигурация Cloudflare (без секретов), пример локальных переменных, проверка типов серверной части. |

`tests/` использует встроенный в Node `node:test` вместо Vitest: установка Vitest падала из-за ошибки
npm при разрешении зависимостей, а встроенный раннер не требует зависимостей вовсе.

## Контент

- Коллекции: `courses`, `seminars` (одна папка = один продукт, id = имя папки), `pages`,
  `site` (`src/data/site.yaml`, ключ `settings`), `home` (`src/data/home.yaml`, ключ `content`).
- Схемы строгие: лишние или неверно названные поля — ошибка сборки.
- Курс: обязательны `level`, `format`, `duration`. Семинар: обязателен `format`, `level`/`duration`
  необязательны, `end` только вместе со `start` и не раньше него.
- Видимость: `status: published` и папка не начинается с `_` (`src/lib/products.ts → isVisible`).
  `draft`/`archived` не получают страниц, не попадают в каталог, sitemap и `/products.json`.

## Маршруты

| Адрес | Источник | Примечание |
| --- | --- | --- |
| `/` | `src/pages/index.astro` | Технический каркас главной |
| `/kurse/`, `/kurse/<папка>/` | `src/pages/kurse/` | Каталог и страницы курсов |
| `/seminare/`, `/seminare/<папка>/` | `src/pages/seminare/` | Каталог и страницы семинаров |
| `/<страница>/` | `src/pages/[page].astro` | Опубликованные `src/content/pages/*.md` |
| `/anfrage/danke/`, `/anfrage/fehler/` | `src/pages/anfrage/` | Ответ формы без JavaScript, `noindex` |
| `/products.json` | `src/pages/products.json.ts` | Опубликованные продукты для сервера |
| `/robots.txt`, `/sitemap-index.xml` | эндпоинт + `@astrojs/sitemap` | |
| `POST /api/application` | `functions/api/application.ts` | Обработчик заявок |

Названия разделов (`kurse`, `seminare`, `anfrage`) — рабочие, язык сайта не утверждён.

## Поток заявки

```text
Браузер (ApplicationForm)
  │  POST /api/application  (multipart/form-data со скриптом, urlencoded без него)
  ▼
functions/api/application.ts — окружение Cloudflare: переменные, KV, ASSETS, сокеты
  ▼
server/application/handler.ts
  1  метод POST                         → иначе 405
  2  Origin из ALLOWED_ORIGINS          → иначе 403
  3  Content-Type формы                 → иначе 415
  4  тело ≤ 16 КБ, без файлов           → иначе 413 / 422
  5  honeypot пуст                      → иначе «успех» без письма (бот)
  6  SMTP настроен                      → иначе 500 not_configured
  7  частота по хэшу IP (если есть KV)  → иначе 429
  8  проверка полей                     → иначе 422 + коды по полям
  9  продукт опубликован (/products.json), название — из каталога → иначе 422 unknown_product
 10  submission_id уже обработан (KV)   → «успех» без повторного письма
 11  письмо: text/plain UTF-8, данные посетителя в теле (base64) и Reply-To
 12  SMTP (server/smtp/client.ts → cloudflare:sockets), успех = 250 после DATA → иначе 502
 13  ответ: JSON для скрипта / 303 на /anfrage/danke|fehler/ без JS
```

### Защита

| Требование | Реализация |
| --- | --- |
| Серверная валидация | `server/application/validate.ts`, лимиты из `shared/` |
| Honeypot | поле `website`, скрыто CSS и `aria-hidden` |
| Ограничение частоты | KV-счётчик по SHA-256(IP + окно), 8 запросов / 10 мин; приблизительный. **Рекомендуется** правило Rate Limiting в Cloudflare WAF для `/api/application` |
| Проверка источника | заголовок `Origin` против `ALLOWED_ORIGINS` |
| Размер тела | `Content-Length` и фактическое чтение потока с лимитом 16 КБ |
| Повторная отправка | клиент блокирует кнопку; `submission_id` (UUID) хранится в KV 24 ч после успешной отправки |
| Безопасное письмо | заголовки без CR/LF, RFC 2047; тело base64; Reply-To только из проверенного email |
| Логи | только коды событий и этап SMTP, без персональных данных |
| Секреты | только переменные Cloudflare; в репозитории — `.dev.vars.example` с заглушками `.invalid` |

Без KV (`APPLICATION_KV` не подключено) пункты 7 и 10 на сервере пропускаются: остаются
блокировка кнопки в браузере, honeypot, проверка Origin и (рекомендуемое) правило WAF.

### Поведение формы в браузере

Состояния `idle → sending → success | error` (атрибут `data-state` на форме, текст в `role="status"`).
Успех — только при `{ ok: true }` от сервера. При ошибке поля сохраняются, кнопка становится
«Отправить ещё раз», ошибки полей показываются рядом с полями. Один `submission_id` на заполнение
формы: повтор после сбоя сети не создаст второе письмо; после успеха id обновляется.

## SEO и производительность

- Уникальные `title`/`description` (для продуктов — `seo.*`, иначе `title`/`summary`), canonical,
  Open Graph, JSON-LD (`Course` / `EducationEvent`) только из заполненных полей.
- `sitemap-index.xml` (без `/anfrage/`), `robots.txt` (закрыты `/api/` и `/anfrage/`).
- Нет клиентских фреймворков; JS — только скрипт формы (встраивается, хэш в CSP).
- CSP генерируется Astro (`security.csp`); прочие заголовки — `public/_headers`.
- Шрифты — только локально (`public/fonts/`), внешних запросов страница не делает.

## Публикация

```text
ветка → Pull Request → Cloudflare Pages preview → проверка владельцем → merge в main → продакшен
```

Откат — Rollback к предыдущему деплою в Cloudflare Pages или revert коммита. На этом этапе
проект не опубликован, домен и почта не подключены.
