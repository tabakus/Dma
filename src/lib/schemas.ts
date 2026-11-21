/**
 * Схемы данных контента. Подключаются в src/content.config.ts и проверяются при каждой сборке:
 * ошибка в frontmatter или YAML останавливает сборку с указанием файла и поля.
 *
 * Схемы — часть архитектуры. Менять их только по решению владельца проекта (см. CLAUDE.md).
 */
import { z } from 'astro/zod';

/** Статус публикации страницы. Только `published` попадает на сайт. */
export const STATUSES = ['draft', 'published', 'archived'] as const;

/**
 * Статус курса или семинара:
 * - draft — черновик, на сайте не виден;
 * - announced — анонс: название видно в списках с пометкой «Скоро», страницы и заявки нет;
 * - published — опубликован: своя страница с формой заявки;
 * - archived — снят с публикации.
 */
export const PRODUCT_STATUSES = ['draft', 'announced', 'published', 'archived'] as const;

/** Подразделы раздела «Обучение» (id записей в src/data/directions.yaml). */
export const DIRECTIONS = ['grammatik', 'beruf'] as const;

/** Уровни по шкале CEFR. */
export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

/** Функция image() из контекста Astro; в тестах подменяется заглушкой. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ImageFn = () => z.ZodType<any>;

const nonEmpty = (max: number) => z.string().trim().min(1).max(max);

/** Цена в евро: неотрицательная, не больше двух знаков после запятой. */
const price = z
  .number()
  .nonnegative()
  .refine((v) => Math.round(v * 100) === v * 100, { message: 'Цена: не больше двух знаков после запятой' });

/** Дата в формате YYYY-MM-DD (YAML превращает её в Date). Строки тоже допускаются. */
const date = z.coerce.date();

const seo = z
  .strictObject({
    title: nonEmpty(70).optional(),
    description: nonEmpty(160).optional(),
  })
  .optional();

/**
 * Поля, общие для курсов и семинаров.
 * format и summary обязательны только для опубликованных продуктов (проверка — в publishedRequires):
 * черновик и анонс можно завести без данных, ничего не выдумывая.
 */
function productBase(image: ImageFn) {
  return {
    title: nonEmpty(120),
    /** Название на немецком (показывается рядом с русским). */
    titleDe: nonEmpty(120).optional(),
    status: z.enum(PRODUCT_STATUSES),
    /** Подраздел обучения: grammatik — Deutsche Grammatik, beruf — Sprachkurse für den Berufseinstieg. */
    direction: z.enum(DIRECTIONS),
    /** Порядок в каталоге: меньше — выше. */
    order: z.number().int().min(0).default(100),
    format: nonEmpty(80).optional(),
    summary: nonEmpty(300).optional(),
    /** Максимальный размер группы (человек): на карточке и странице — «до N человек». */
    groupSize: z.number().int().min(1).max(100).optional(),
    /** Расписание словами, например «вторник и четверг, 18:30–20:00». */
    schedule: nonEmpty(120).optional(),
    price: price.optional(),
    currency: z.literal('EUR').default('EUR'),
    cover: image().optional(),
    coverAlt: nonEmpty(200).optional(),
    seo,
  };
}

/** Обложка требует альтернативного текста (доступность). */
function requireCoverAlt<T extends { cover?: unknown; coverAlt?: string }>(data: T, ctx: z.RefinementCtx) {
  if (data.cover && !data.coverAlt) {
    ctx.addIssue({ code: 'custom', path: ['coverAlt'], message: 'Для обложки нужен coverAlt — описание изображения' });
  }
}

/** Конец (end) — только вместе с началом (start) и не раньше него. */
function startBeforeEnd(data: { start?: Date; end?: Date }, ctx: z.RefinementCtx) {
  if (data.end && !data.start) {
    ctx.addIssue({ code: 'custom', path: ['start'], message: 'Если указан end, нужен и start' });
  }
  if (data.start && data.end && data.end < data.start) {
    ctx.addIssue({ code: 'custom', path: ['end'], message: 'end не может быть раньше start' });
  }
}

/** Для опубликованного продукта перечисленные поля обязательны. */
function publishedRequires<T extends Record<string, unknown> & { status: string }>(
  data: T,
  ctx: z.RefinementCtx,
  fields: readonly (keyof T & string)[],
) {
  if (data.status !== 'published') return;
  for (const f of fields) {
    if (data[f] === undefined) {
      ctx.addIssue({ code: 'custom', path: [f], message: `Для публикации (status: published) нужно поле ${f}` });
    }
  }
}

/**
 * Курс: длительная программа. Для публикации обязательны уровень, формат, продолжительность и описание.
 * Если указан конец (end), он не может быть раньше начала (start).
 */
export function courseSchema(image: ImageFn) {
  return z
    .strictObject({
      ...productBase(image),
      level: z.array(z.enum(LEVELS)).min(1).optional(),
      duration: nonEmpty(80).optional(),
      start: date.optional(),
      end: date.optional(),
    })
    .superRefine((data, ctx) => {
      requireCoverAlt(data, ctx);
      publishedRequires(data, ctx, ['format', 'summary', 'level', 'duration']);
      startBeforeEnd(data, ctx);
    });
}

/**
 * Семинар: тематическое занятие. Для публикации обязательны формат и описание; уровень и продолжительность — нет.
 * Если указан конец (end), он не может быть раньше начала (start).
 */
export function seminarSchema(image: ImageFn) {
  return z
    .strictObject({
      ...productBase(image),
      level: z.array(z.enum(LEVELS)).min(1).optional(),
      duration: nonEmpty(80).optional(),
      start: date.optional(),
      end: date.optional(),
    })
    .superRefine((data, ctx) => {
      requireCoverAlt(data, ctx);
      publishedRequires(data, ctx, ['format', 'summary']);
      startBeforeEnd(data, ctx);
    });
}

/** Информационные страницы: «Обо мне», Impressum, Datenschutzerklärung и т. п. */
export const pageSchema = z.strictObject({
  title: nonEmpty(120),
  status: z.enum(STATUSES),
  description: nonEmpty(160).optional(),
  /** Язык текста страницы, если он отличается от языка сайта (например, de для Impressum). */
  lang: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).optional(),
  /** true — страница не индексируется поисковиками. */
  noindex: z.boolean().default(false),
});

const link = z.strictObject({
  label: nonEmpty(60),
  /** Внутренняя ссылка: /kurse/ или якорь на странице: /#obuchenie. */
  href: z
    .string()
    .trim()
    .regex(/^\/[a-z0-9\-/]*(#[a-z0-9-]+)?$/, 'Внутренняя ссылка вида /kurse/ или /#razdel'),
});

/** Глобальные настройки сайта: src/data/site.yaml, ключ `settings`. */
export const siteSchema = z.strictObject({
  name: nonEmpty(80),
  /** Слоган под логотипом в шапке (расшифровка «Akzent»); необязательный. */
  tagline: nonEmpty(80).optional(),
  /** Язык сайта (атрибут lang), например ru или de. */
  locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
  defaultDescription: nonEmpty(160),
  /** Контактный email; null, пока не утверждён. */
  contactEmail: z.email().nullable(),
  nav: z.array(link),
  /** Заметная кнопка в шапке (например, «Оставить заявку»). */
  headerCta: link.optional(),
  footerNav: z.array(link),
  form: z.strictObject({
    title: nonEmpty(120),
    labels: z.strictObject({
      name: nonEmpty(60),
      email: nonEmpty(60),
      phone: nonEmpty(60),
      message: nonEmpty(60),
      consent: nonEmpty(400),
      submit: nonEmpty(40),
      optional: nonEmpty(30),
    }),
    states: z.strictObject({
      sending: nonEmpty(80),
      success: nonEmpty(300),
      error: nonEmpty(300),
      retry: nonEmpty(40),
    }),
    errors: z.record(z.string(), nonEmpty(200)),
  }),
});

const textBlock = (max: number) => nonEmpty(max);
const sectionHead = {
  eyebrow: nonEmpty(60).optional(),
  title: nonEmpty(160),
};

/**
 * Тексты главной страницы: src/data/home.yaml, ключ `content`.
 * Каждый блок главной берёт тексты отсюда; в компонентах текстов нет.
 * Блоки author.text/name/photo необязательны: без них показывается аккуратное место для будущих материалов.
 */
export const homeSchema = z.strictObject({
  seo,
  hero: z.strictObject({
    eyebrow: nonEmpty(60).optional(),
    title: nonEmpty(120),
    lead: nonEmpty(300).nullable(),
    primaryCta: link.optional(),
    secondaryLinks: z.array(link).max(3).default([]),
    /** Описание фотографии первого экрана для экранных читалок. */
    imageAlt: nonEmpty(200).optional(),
  }),
  /** Раздел «Обучение» на главной: заголовок; подразделы — src/data/directions.yaml. */
  directions: z
    .strictObject({
      ...sectionHead,
      intro: textBlock(300).optional(),
    })
    .optional(),
  philosophy: z
    .strictObject({
      statement: nonEmpty(160),
      text: textBlock(400).optional(),
      /** Пример исправленной ошибки: неверный и верный вариант (немецкий). */
      example: z.strictObject({ wrong: nonEmpty(120), right: nonEmpty(120), note: nonEmpty(160).optional() }).optional(),
    })
    .optional(),
  method: z
    .strictObject({
      ...sectionHead,
      lead: textBlock(300).optional(),
      steps: z.array(z.strictObject({ title: nonEmpty(60), text: textBlock(240) })).min(2).max(6),
    })
    .optional(),
  results: z
    .strictObject({
      ...sectionHead,
      items: z.array(nonEmpty(160)).min(1).max(8),
      note: textBlock(240).optional(),
    })
    .optional(),
  author: z
    .strictObject({
      ...sectionHead,
      name: nonEmpty(80).nullable().default(null),
      text: textBlock(800).nullable().default(null),
      /** Подпись на месте будущей фотографии, пока её нет. */
      photoPlaceholder: nonEmpty(120).optional(),
      link: link.optional(),
    })
    .optional(),
  closing: z
    .strictObject({
      title: nonEmpty(160),
      text: textBlock(300).optional(),
      links: z.array(link).max(3).default([]),
    })
    .optional(),
});

/**
 * Подраздел обучения: src/data/directions.yaml, ключ = id подраздела (grammatik, beruf).
 * Страница подраздела, блок на главной, колонки «Курсы» и «Семинары», ссылка на пробный видеоурок.
 */
export const directionSchema = z.strictObject({
  /** Название (на немецком, как на сайте). */
  title: nonEmpty(80),
  /** Пояснение на русском под названием. */
  subtitle: nonEmpty(120).optional(),
  /** Адрес страницы подраздела. */
  path: z.string().regex(/^\/[a-z0-9-]+\/$/, 'Адрес вида /deutsche-grammatik/'),
  order: z.number().int().min(0).default(100),
  /** active — есть программа; preparing — подраздел в подготовке. */
  status: z.enum(['active', 'preparing']),
  lead: textBlock(300).optional(),
  /** Фраза над колонками курсов и семинаров, например «Два формата — одна система». */
  formatsTitle: nonEmpty(80).optional(),
  /** Текст для подраздела в подготовке. */
  preparingText: nonEmpty(200).optional(),
  /** Пробный видеоурок. Пока href = null, показывается муляж с пометкой «скоро». */
  video: z.strictObject({
    label: nonEmpty(60),
    href: z.url({ protocol: /^https$/ }).nullable(),
    placeholder: nonEmpty(120),
  }),
});
