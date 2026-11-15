/**
 * Доступ к продуктам (курсы и семинары) для страниц и компонентов.
 * Здесь решается, что видно на сайте: только status: published и не образцы (папки с «_»).
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

const byOrder = (a: Product, b: Product) => a.data.order - b.data.order || a.data.title.localeCompare(b.data.title);

export async function getPublishedCourses(): Promise<Course[]> {
  return (await getCollection('courses', isVisible)).sort(byOrder);
}

export async function getPublishedSeminars(): Promise<Seminar[]> {
  return (await getCollection('seminars', isVisible)).sort(byOrder);
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
