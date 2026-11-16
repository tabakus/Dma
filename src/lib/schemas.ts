/**
 * Схемы данных контента. Подключаются в src/content.config.ts и проверяются при каждой сборке:
 * ошибка в frontmatter или YAML останавливает сборку с указанием файла и поля.
 *
 * Схемы — часть архитектуры. Менять их только по решению владельца проекта (см. CLAUDE.md).
 */
import { z } from 'astro/zod';

/** Статус публикации. Только `published` попадает на сайт. */
export const STATUSES = ['draft', 'published', 'archived'] as const;

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

/** Поля, общие для курсов и семинаров. */
function productBase(image: ImageFn) {
  return {
    title: nonEmpty(120),
    status: z.enum(STATUSES),
    /** Порядок в каталоге: меньше — выше. */
    order: z.number().int().min(0).default(100),
    format: nonEmpty(80),
    summary: nonEmpty(300),
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

/**
 * Курс: длительная программа. Уровень, формат и продолжительность обязательны.
 */
export function courseSchema(image: ImageFn) {
  return z
    .strictObject({
      ...productBase(image),
      level: z.array(z.enum(LEVELS)).min(1),
      duration: nonEmpty(80),
      start: date.optional(),
    })
    .superRefine(requireCoverAlt);
}

/**
 * Семинар: тематическое занятие. Уровень и продолжительность необязательны.
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
      if (data.end && !data.start) {
        ctx.addIssue({ code: 'custom', path: ['start'], message: 'Если указан end, нужен и start' });
      }
      if (data.start && data.end && data.end < data.start) {
        ctx.addIssue({ code: 'custom', path: ['end'], message: 'end не может быть раньше start' });
      }
    });
}

/** Информационные страницы: «Обо мне», Impressum, Datenschutzerklärung и т. п. */
export const pageSchema = z.strictObject({
  title: nonEmpty(120),
  status: z.enum(STATUSES),
  description: nonEmpty(160).optional(),
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
  }),
  directions: z
    .strictObject({
      ...sectionHead,
      intro: textBlock(300).optional(),
      courses: z.strictObject({ title: nonEmpty(60), text: textBlock(400), points: z.array(nonEmpty(80)).max(5), link }),
      seminars: z.strictObject({ title: nonEmpty(60), text: textBlock(400), points: z.array(nonEmpty(80)).max(5), link }),
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
