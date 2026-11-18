/**
 * Коллекции контента. Схемы — в src/lib/schemas.ts.
 *
 * Курсы и семинары: одна папка = один продукт (index.md + изображения рядом).
 * id продукта = имя папки, оно же адрес страницы: /kurse/<папка>/, /seminare/<папка>/.
 * Папки, начинающиеся с «_», — образцы структуры: проверяются схемой, но на сайт не попадают.
 */
import { defineCollection } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { courseSchema, directionSchema, homeSchema, pageSchema, seminarSchema, siteSchema } from './lib/schemas';

const folderId = ({ entry }: { entry: string }) => entry.replace(/\/index\.md$/, '');

const courses = defineCollection({
  loader: glob({ base: './src/content/courses', pattern: '*/index.md', generateId: folderId }),
  schema: ({ image }) => courseSchema(image),
});

const seminars = defineCollection({
  loader: glob({ base: './src/content/seminars', pattern: '*/index.md', generateId: folderId }),
  schema: ({ image }) => seminarSchema(image),
});

const pages = defineCollection({
  loader: glob({ base: './src/content/pages', pattern: '*.md' }),
  schema: pageSchema,
});

const site = defineCollection({
  loader: file('src/data/site.yaml'),
  schema: siteSchema,
});

const home = defineCollection({
  loader: file('src/data/home.yaml'),
  schema: homeSchema,
});

const directions = defineCollection({
  loader: file('src/data/directions.yaml'),
  schema: directionSchema,
});

export const collections = { courses, seminars, pages, site, home, directions };
