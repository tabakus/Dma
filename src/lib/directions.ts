/** Подразделы раздела «Обучение» из src/data/directions.yaml. */
import { getCollection, type CollectionEntry } from 'astro:content';
import { getListedCourses, getListedSeminars, type Course, type Seminar } from './products';

export type Direction = CollectionEntry<'directions'>;

export interface DirectionWithProducts {
  direction: Direction;
  courses: Course[];
  seminars: Seminar[];
}

export async function getDirections(): Promise<Direction[]> {
  return (await getCollection('directions')).sort((a, b) => a.data.order - b.data.order);
}

export async function getDirection(id: string): Promise<Direction> {
  const found = (await getDirections()).find((d) => d.id === id);
  if (!found) throw new Error(`src/data/directions.yaml: нет подраздела ${id}`);
  return found;
}

export async function withProducts(direction: Direction): Promise<DirectionWithProducts> {
  const [courses, seminars] = await Promise.all([getListedCourses(direction.id), getListedSeminars(direction.id)]);
  return { direction, courses, seminars };
}
