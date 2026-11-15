/** Глобальные данные сайта из src/data/*.yaml. */
import { getEntry } from 'astro:content';

export async function getSiteSettings() {
  const entry = await getEntry('site', 'settings');
  if (!entry) throw new Error('src/data/site.yaml: нет ключа settings');
  return entry.data;
}

export async function getHomeContent() {
  const entry = await getEntry('home', 'content');
  if (!entry) throw new Error('src/data/home.yaml: нет ключа content');
  return entry.data;
}
