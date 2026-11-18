/**
 * Доступ к продуктам (курсы и семинары) для страниц и компонентов.
 * Здесь решается, что видно на сайте:
 * - страницы, каталог для формы, sitemap — только status: published;
 * - списки (подразделы, каталоги, главная) — published и announced (анонс с пометкой «Скоро»).
 * Образцы (папки с «_») не видны нигде.
 */
import { getCollection, type CollectionEntry } from 'astro:content';
import type { CatalogEntry, ProductType } from '../../shared/application-contract';

export type Course = CollectionEntry<'courses'>;
export type Seminar = CollectionEntry<'seminars'>;
export type Product = Course | Seminar;

/** Адреса разделов. Меняются только вместе с папками в src/pages. */
export const PRODUCT_ROUTES: Record<ProductType, string> = {
  course: '/kurse/',
  seminar: '/seminare/',
};

const isSample = (id: string) => id.startsWith('_');

export function isVisible(entry: { id: string; data: { status: string } }): boolean {
  return entry.data.status === 'published' && !isSample(entry.id);
}

/** Показывается ли продукт в списках: опубликован или анонсирован. */
export function isListed(entry: { id: string; data: { status: string } }): boolean {
  return (entry.data.status === 'published' || entry.data.status === 'announced') && !isSample(entry.id);
}

/** Есть ли у продукта своя страница. */
export function hasPage(entry: Product): boolean {
  return entry.data.status === 'published';
}

const byOrder = (a: Product, b: Product) => a.data.order - b.data.order || a.data.title.localeCompare(b.data.title);

export async function getPublishedCourses(): Promise<Course[]> {
  return (await getCollection('courses', isVisible)).sort(byOrder);
}

export async function getPublishedSeminars(): Promise<Seminar[]> {
  return (await getCollection('seminars', isVisible)).sort(byOrder);
}

/** Курсы и семинары для списков (опубликованные и анонсы); при указании direction — только этого подраздела. */
export async function getListedCourses(direction?: string): Promise<Course[]> {
  return (await getCollection('courses', (e) => isListed(e) && (!direction || e.data.direction === direction))).sort(byOrder);
}

export async function getListedSeminars(direction?: string): Promise<Seminar[]> {
  return (await getCollection('seminars', (e) => isListed(e) && (!direction || e.data.direction === direction))).sort(byOrder);
}

export function productType(entry: Product): ProductType {
  return entry.collection === 'courses' ? 'course' : 'seminar';
}

export function productUrl(entry: Product): string {
  return `${PRODUCT_ROUTES[productType(entry)]}${entry.id}/`;
}

/** Каталог для серверной проверки заявок (src/pages/products.json.ts). */
export async function getCatalog(): Promise<CatalogEntry[]> {
  const [courses, seminars] = await Promise.all([getPublishedCourses(), getPublishedSeminars()]);
  return [...courses, ...seminars].map((p) => ({ type: productType(p), slug: p.id, title: p.data.title }));
}
