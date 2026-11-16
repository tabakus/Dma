import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'astro/zod';
import { courseSchema, pageSchema, seminarSchema } from '../src/lib/schemas.ts';

// В тестах image() заменяется строкой (настоящая функция есть только внутри Astro).
const image = () => z.string();
const course = courseSchema(image);
const seminar = seminarSchema(image);

const validCourse = {
  title: 'Kurs',
  status: 'published',
  level: ['A2', 'B1'],
  format: 'Online',
  duration: '8 Wochen',
  summary: 'Kurz',
};

test('курс: корректные данные, значения по умолчанию', () => {
  const r = course.parse(validCourse);
  assert.equal(r.order, 100);
  assert.equal(r.currency, 'EUR');
});

test('курс: уровень и продолжительность обязательны', () => {
  const r = course.safeParse({ ...validCourse, level: undefined, duration: undefined });
  assert.ok(!r.success);
  const paths = r.error.issues.map((i) => i.path.join('.'));
  assert.deepEqual(paths.sort(), ['duration', 'level']);
});

test('семинар: уровень и продолжительность необязательны', () => {
  const { level: _l, duration: _d, ...rest } = validCourse;
  assert.ok(seminar.safeParse(rest).success);
});

test('недопустимый статус, уровень, цена и дата', () => {
  const r = course.safeParse({ ...validCourse, status: 'live', level: ['B5'], price: -1, start: 'вчера' });
  assert.ok(!r.success);
  const paths = r.error.issues.map((i) => i.path.join('.')).sort();
  assert.deepEqual(paths, ['level.0', 'price', 'start', 'status']);
});

test('цена с тремя знаками после запятой отклоняется', () => {
  assert.ok(!course.safeParse({ ...validCourse, price: 10.555 }).success);
  assert.ok(course.safeParse({ ...validCourse, price: 390.5 }).success);
});

test('опечатка в имени поля отклоняется (strict)', () => {
  const r = course.safeParse({ ...validCourse, tilte: 'x' });
  assert.ok(!r.success);
});

test('обложка без описания (coverAlt) отклоняется', () => {
  const r = course.safeParse({ ...validCourse, cover: './cover.jpg' });
  assert.ok(!r.success);
  assert.equal(r.error.issues[0]?.path.join('.'), 'coverAlt');
});

test('семинар: end без start и end раньше start отклоняются', () => {
  const base = { title: 'S', status: 'draft', format: 'Online', summary: 'K' };
  assert.ok(!seminar.safeParse({ ...base, end: '2027-01-02' }).success);
  assert.ok(!seminar.safeParse({ ...base, start: '2027-01-03', end: '2027-01-02' }).success);
  assert.ok(seminar.safeParse({ ...base, start: '2027-01-02', end: '2027-01-03' }).success);
});

test('страница: статус обязателен, noindex по умолчанию false', () => {
  assert.equal(pageSchema.parse({ title: 'Impressum', status: 'draft' }).noindex, false);
  assert.ok(!pageSchema.safeParse({ title: 'Impressum' }).success);
});

// --- Главная страница и ссылки ---------------------------------------------------------------
import { homeSchema, siteSchema } from '../src/lib/schemas.ts';

const minimalHome = { hero: { title: 'Заголовок', lead: null } };

test('главная: минимальный набор (только hero) проходит, необязательные секции можно не задавать', () => {
  const r = homeSchema.parse(minimalHome);
  assert.deepEqual(r.hero.secondaryLinks, []);
  assert.equal(r.directions, undefined);
});

test('главная: ссылки принимают якорь на странице, но не внешние адреса', () => {
  const ok = homeSchema.safeParse({ hero: { ...minimalHome.hero, primaryCta: { label: 'Обучение', href: '/#obuchenie' } } });
  assert.ok(ok.success);
  for (const href of ['https://evil.test/', '#obuchenie', '/kurse/#A', 'javascript:alert(1)']) {
    const bad = homeSchema.safeParse({ hero: { ...minimalHome.hero, primaryCta: { label: 'x', href } } });
    assert.ok(!bad.success, href);
  }
});

test('главная: автор без имени и текста допустим (место для будущих материалов)', () => {
  const r = homeSchema.parse({ ...minimalHome, author: { title: 'Автор методики' } });
  assert.equal(r.author?.name, null);
  assert.equal(r.author?.text, null);
});

test('главная: методика требует хотя бы двух шагов, опечатка в поле отклоняется', () => {
  assert.ok(!homeSchema.safeParse({ ...minimalHome, method: { title: 'М', steps: [{ title: 'a', text: 'b' }] } }).success);
  assert.ok(!homeSchema.safeParse({ ...minimalHome, heroo: {} }).success);
});

test('настройки: headerCta необязательна и проверяется как внутренняя ссылка', () => {
  const base = {
    name: 'X', locale: 'ru', defaultDescription: 'D', contactEmail: null, nav: [{ label: 'Главная', href: '/' }], footerNav: [],
    form: { title: 'T', labels: { name: 'a', email: 'b', phone: 'c', message: 'd', consent: 'e', submit: 'f', optional: 'g' },
      states: { sending: 'a', success: 'b', error: 'c', retry: 'd' }, errors: {} },
  };
  assert.ok(siteSchema.safeParse(base).success);
  assert.ok(siteSchema.safeParse({ ...base, headerCta: { label: 'Оставить заявку', href: '/#obuchenie' } }).success);
  assert.ok(!siteSchema.safeParse({ ...base, headerCta: { label: 'x', href: 'mailto:a@b.de' } }).success);
});
