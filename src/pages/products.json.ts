/**
 * Публичный список опубликованных продуктов (тип, адрес, название).
 * Серверный обработчик заявок сверяет с ним продукт из формы и берёт отсюда название для письма.
 */
import type { APIRoute } from 'astro';
import { getCatalog } from '../lib/products';

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify(await getCatalog()), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
