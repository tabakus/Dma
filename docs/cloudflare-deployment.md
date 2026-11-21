# Подключение к Cloudflare Pages

Инструкция по подключению репозитория [tabakus/dma](https://github.com/tabakus/dma) к Cloudflare Pages,
проверке preview-деплоя и переходу к production. Значения секретов, адреса почты и SMTP-настройки
здесь не указаны: они не выбраны (`docs/open-questions.md`).

**Состояние (15.11.2026):** проект Cloudflare Pages `deutschmitakzent` создан и подключён к `tabakus/dma`,
production-ветка `main`. Технический каркас доступен на https://deutschmitakzent.pages.dev
(первый деплой собран из коммита `74678e1`). Домен и SMTP не подключены.
Ниже — результаты аудита, проверки живого деплоя и шаги по подключению (для справки и повторной настройки).

## 1. Результаты аудита готовности

Проверено локально 15.11.2026. Локальные проверки не гарантируют успешного деплоя в Cloudflare:
пункты с пометкой «проверить» подтверждаются только на первом preview-деплое.

| Что | Результат |
| --- | --- |
| Режим сборки | `output: 'static'` (`astro.config.mjs`). Адаптер `@astrojs/cloudflare` **не нужен**: страницы статические, серверный код живёт в Pages Functions (`functions/`), которые Cloudflare собирает сам |
| Результат сборки | `dist/` содержит HTML, `_headers`, `products.json`, `robots.txt`, sitemap |
| Установка зависимостей | `npm ci` по `package-lock.json` (lockfileVersion 3) на чистой копии — без ошибок и уязвимостей. В lock-файле есть сборки `sharp` для Linux x64 |
| Сборка | `npm run build` на чистой копии — без ошибок и предупреждений |
| Проверки проекта | `npm run verify`: 0 ошибок типов, 42/42 теста, сборка без ошибок |
| Pages Functions | `wrangler pages functions build` (Wrangler 4.156.1) компилирует `functions/api/application.ts` без ошибок. Маршрут: `/api/application` |
| `_routes.json` | Генерируется Wrangler автоматически: `include: ["/api/application"]`. Функция **не вызывается** для статических страниц |
| Совместимость с Workers Runtime | В бандле функции из внешних модулей только `cloudflare:sockets`; модулей Node.js нет |
| Локальный запуск в workerd (`wrangler pages dev dist`) | Статика 200; `/kurse` → 308 на `/kurse/`; заголовки из `_headers` применяются; `/products.json` читается функцией через `ASSETS`; ответы функции: без SMTP-переменных — 500 `not_configured`, чужой Origin — 403, неопубликованный продукт — 422, ошибки полей — 422 с кодами |
| `cloudflare:sockets` в workerd | Подключение к фиктивному SMTP-серверу работает: приветствие, EHLO, STARTTLS проходят. **Найдена ошибка** при сбое TLS-рукопожатия — см. проблему П-1 |
| Секреты в репозитории | Не найдены. `.dev.vars` и `.env*` в `.gitignore`; в `.dev.vars.example` только заглушки на домене `.invalid` |
| Preview-деплои | Возможны штатно (сборка любой ветки, кроме production). Ограничение — проблема П-2 |
| `wrangler.toml` | Есть: `name = "deutschmitakzent"`, `pages_build_output_dir = "./dist"`, `compatibility_date = "2026-11-01"`, KV закомментировано. Секретов нет |

### Проверка живого деплоя (этап А, 15.11.2026)

| Что | Результат |
| --- | --- |
| Build log | `nodejs@22.23.4`, `npm clean-install` без уязвимостей, `astro build` без ошибок; `Found Functions directory`, `Compiled Worker successfully` (Wrangler 3.114.17 на стороне Cloudflare); `Parsed 2 valid header rules` |
| Страницы | `/`, `/kurse/`, `/seminare/`, `/anfrage/danke/` — 200; `/kurse` → 308 на `/kurse/`; несуществующие адреса и `/impressum/` (черновик) — 404 |
| SEO-файлы | `/robots.txt`, `/sitemap-index.xml`, `/products.json` (`[]`) — 200 |
| Заголовки | HSTS, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` из `_headers` |
| CSP | `<meta http-equiv="content-security-policy">` на страницах; в консоли Chromium на четырёх страницах ни ошибок, ни предупреждений |
| Функция `/api/application` | POST (JSON) → 500 `not_configured`; POST без JS → 303 на `/anfrage/fehler/?grund=not_configured`; GET (JSON) → 405 с `Allow: POST`; `Cache-Control: no-store`; `/api/other` → 404 |

Не проверено на живом сайте: форма (нет опубликованных продуктов), preview-деплой Pull Request,
реальная отправка письма (нет SMTP-провайдера).

## 2. Выявленные проблемы и рекомендации

П-1 исправлена в PR #3. П-2…П-4 не исправлены: исправление требует отдельного согласования.

### П-1. Зависание запроса при сбое TLS после STARTTLS — ИСПРАВЛЕНО (PR #3)

- **Где:** `server/smtp/client.ts`, метод `Connection.close()` и блок `finally` в `sendMail()`.
- **Что происходит:** если после команды STARTTLS TLS-рукопожатие не удаётся (неверный режим порта,
  проблема сертификата, сервер закрыл соединение), таймаут 15 с срабатывает, но `await socket.close()`
  в workerd не завершается. Ответ браузеру не уходит, посетитель видит бесконечное ожидание.
  Ложного «успеха» при этом нет.
- **Как проверено:** `wrangler pages dev` + фиктивный SMTP-сервер на 587, который после `220 go ahead`
  закрывает соединение. Запрос висел больше 40 с; отладочный лог: таймаут сработал, `close()` не завершился.
  Для порта 465 при недоступном сервере ошибка возвращается корректно (502 за 0,08 с).
- **Исправление (PR #3):** ожидание закрытия сокета ограничено 1 с (`closeTimeoutMs`), закрытие
  выполняется один раз и не завершается ошибкой. Добавлены тесты в `tests/smtp.test.ts` и
  `tests/handler.test.ts`. Проверено в workerd: тот же сценарий даёт 502 `delivery_failed` через ~16 с.
- На production исправление появится после слияния PR #3 в `main`.

### П-2. Проверка Origin и адреса preview-деплоев — средний приоритет

- Сервер принимает заявку только при точном совпадении `Origin` с одним из `ALLOWED_ORIGINS`.
  У каждого preview-деплоя есть уникальный адрес `https://<хэш>.<проект>.pages.dev` и постоянный
  адрес ветки `https://<ветка>.<проект>.pages.dev`. Шаблоны (`*.pages.dev`) не поддерживаются.
- **Рекомендация без изменения кода:** в переменных окружения Preview указывать адрес ветки, на которой
  проверяется форма, и открывать preview по этому адресу. Для произвольных хэш-адресов форма будет
  отвечать 403 `forbidden_origin` — это ожидаемо.
- Поддержка шаблонов в `ALLOWED_ORIGINS` — изменение кода, только по согласованию.

### П-3. Этап `unknown` в логе при ошибке соединения — низкий приоритет

При недоступном SMTP-сервере ошибка соединения не оборачивается в `SmtpError`, в логе
`"stage":"unknown"`. На поведение не влияет, затрудняет диагностику. Исправление — в SMTP-клиенте,
по согласованию.

### П-4. GET на `/api/application` из браузера — низкий приоритет

Без заголовка `Accept: application/json` неверный метод даёт переход 303 на `/anfrage/fehler/`,
а не 405 (с этим заголовком — 405 и `Allow: POST`). Безопасности не касается.

### Проверки на первом деплое

| # | Что проверить | Результат |
| --- | --- | --- |
| Ч-1 | Сборка с `NODE_VERSION=22.23.4` | **Подтверждено:** в build log `nodejs@22.23.4` |
| Ч-2 | Как Cloudflare применяет `wrangler.toml` | **Подтверждено:** файл читается как конфигурация проекта («Found wrangler.toml file. Reading build configuration»). Рекомендация из раздела 5 (переменные как Secret) остаётся |
| Ч-3 | Совпадение имени проекта с `name` в `wrangler.toml` | **Подтверждено:** проект называется `deutschmitakzent` |
| Ч-4 | CSP и встраиваемые Cloudflare скрипты | **Конфликтов нет** на текущих настройках; перепроверять при включении веб-аналитики или обфускации email |
| Ч-5 | `cloudflare:sockets` с реальным провайдером | Только после выбора провайдера (`docs/smtp.md`) |

## 3. Подключение (выполнено 15.11.2026; шаги для справки)

### 3.1. Создать проект и подключить GitHub

1. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Авторизовать GitHub-приложение Cloudflare и дать доступ к репозиторию `tabakus/dma`.
3. Имя проекта: рекомендуется `deutschmitakzent` (совпадает с `wrangler.toml`; станет адресом
   `deutschmitakzent.pages.dev`, если имя свободно).
4. **Production branch:** `main`.

### 3.2. Настройки сборки

| Параметр | Значение |
| --- | --- |
| Framework preset | `Astro` или `None` (команды ниже задать вручную) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | пусто (корень репозитория) |
| Переменная сборки `NODE_VERSION` | `22.23.4` (для Production и Preview) |

Зависимости Cloudflare устанавливает сам по `package-lock.json`; отдельная команда установки не нужна.
`npm run verify` (проверка типов и тесты) в команду сборки не входит — его запускают перед Pull Request.

### 3.3. Preview-деплои

- **Settings → Builds & deployments → Preview branches:** `All non-production branches` (по умолчанию).
- Для каждого Pull Request Cloudflare соберёт отдельный деплой и, при подключённом GitHub-приложении,
  добавит ссылку в Pull Request.
- Ограничение доступа к preview (например, Cloudflare Access) — по желанию заказчика, не обязательно.

### 3.4. Pages Functions

Отдельной настройки не требуют: Cloudflare находит папку `functions/` в корне репозитория,
собирает `functions/api/application.ts` и генерирует `_routes.json`. Совместимость рантайма
задаётся `compatibility_date` в `wrangler.toml`. Флаг `nodejs_compat` **не нужен**.

### 3.5. Что увидит проверяющий сразу после подключения

Сайт откроется (статические страницы-каркасы). Каталоги пусты: опубликованных продуктов нет.
Форма появится только на странице опубликованного продукта и до настройки SMTP будет отвечать
ошибкой `not_configured` — это ожидаемое поведение.

## 4. Что требует решений заказчика

| Шаг | Нужное решение | Вопрос |
| --- | --- | --- |
| SMTP-переменные (раздел 5) | SMTP-провайдер, адреса отправителя и получателя | В-1…В-3 |
| Проверка реальной отправки | То же | В-11, `docs/smtp.md` |
| KV `APPLICATION_KV` и правило Rate Limiting | Отдельное решение (не подключать без согласования) | В-5 |
| Публикация Impressum, Datenschutzerklärung, текста согласия | Тексты от специалиста | В-6…В-8 |
| Исправление П-2, П-3 (по желанию) | Согласование изменения кода | В-20 |

## 5. Переменные и секреты

Задаются в **Settings → Variables and Secrets**, отдельно для **Production** и **Preview**.
Значения в репозиторий не попадают.

**Рекомендация:** все переменные приложения ниже добавлять как тип **Secret** (зашифрованные).
Так адреса почты не видны в панели, а настройка не зависит от того, управляет ли `wrangler.toml`
обычными переменными (Ч-2).

| Переменная | Когда добавлять | Значение |
| --- | --- | --- |
| `SMTP_HOST` | После выбора провайдера | от провайдера |
| `SMTP_PORT` | После выбора провайдера | `465` или `587` |
| `SMTP_SECURITY` | После выбора провайдера | `tls` для 465, `starttls` для 587 |
| `SMTP_USERNAME` | После выбора провайдера | от провайдера |
| `SMTP_PASSWORD` | После выбора провайдера | только **Secret**; пароль приложения |
| `MAIL_FROM` | После выбора адреса отправителя | решение заказчика |
| `MAIL_TO` | После выбора адреса получателя | решение заказчика |
| `ALLOWED_ORIGINS` | Preview — можно сейчас; Production — после домена | Preview: адрес ветки `https://<ветка>.<проект>.pages.dev` (П-2). Production: адрес production-деплоя и, после подключения домена, `https://deutschmitakzent.de` |
| `NODE_VERSION` | Сейчас | `22.23.4` (переменная сборки, не секрет) |
| `SITE_URL` | По желанию | По умолчанию `https://deutschmitakzent.de`. Пока домен не подключён, canonical и sitemap указывают на него — для preview это допустимо |
| `APPLICATION_KV` (KV binding) | Только после решения по В-5 | Привязка задаётся в `wrangler.toml` (секция уже подготовлена в комментарии) |

Пока не заданы все SMTP-переменные, функция отвечает `not_configured`, писем не отправляет.

## 6. Порядок проверки preview-деплоя

**Этап А — сразу после подключения** (выполнен на production 15.11.2026, см. раздел 1):

1. Build log: установка зависимостей, `NODE_VERSION`, `astro build` без ошибок; в разделе Functions —
   маршрут `/api/application`.
2. Страницы `/`, `/kurse/`, `/seminare/` отвечают 200, `/kurse` перенаправляет на `/kurse/`.
3. Заголовки ответа содержат `X-Content-Type-Options`, `X-Frame-Options` из `_headers`;
   в HTML есть `<meta http-equiv="content-security-policy">`; в консоли браузера нет ошибок CSP.
4. `/robots.txt`, `/sitemap-index.xml`, `/products.json` открываются.
5. `curl -X POST -H 'Accept: application/json' https://<preview>/api/application` → `not_configured`
   или `forbidden_origin` (функция развёрнута и отвечает).

**Этап Б — после выбора SMTP-провайдера (и слияния PR #3 с исправлением П-1):**

6. Задать переменные Preview (раздел 5), `ALLOWED_ORIGINS` = адрес ветки.
7. Во временной ветке опубликовать тестовый продукт (не сливать в `main`) и пройти план из `docs/smtp.md`:
   реальная отправка, неверный пароль, проверка логов (только коды событий, без персональных данных).

## 7. Переход к production

Выполняется только после закрытия вопросов приоритета 1 в `docs/open-questions.md`.

1. Слияние проверенного Pull Request в `main` → автоматический production-деплой.
2. Задать переменные **Production** (раздел 5).
3. Домен подключён (21.11.2026): регистратор INWX, nameserver Cloudflare; в **Custom domains** — `deutschmitakzent.de`
   и `www.deutschmitakzent.de`; Redirect Rule `www` → основной адрес (301); `ALLOWED_ORIGINS` (Production) = `https://deutschmitakzent.de`.
   DNSSEC пока не включён (можно включить в Cloudflare и внести DS-запись в INWX).
4. Повторить проверки этапов А и Б на production-адресе.
5. Откат: **Deployments** → предыдущий деплой → **Rollback to this deployment**.

Лимиты бесплатного тарифа Cloudflare (количество сборок, вызовов Functions, процессорное время на вызов)
перед запуском сверить с актуальной документацией Cloudflare. Обработчик заявок вызывается только
для `/api/application`, ожидание ответа SMTP-сервера процессорным временем не считается.
