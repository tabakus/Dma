/** Структурированные данные schema.org для страниц продуктов (только из заполненных полей). */
import type { Product } from './products';
import { isoDate } from './format';

export function productJsonLd(product: Product, url: string): Record<string, unknown> {
  const d = product.data;
  const offers =
    d.price !== undefined ? { '@type': 'Offer', price: d.price.toFixed(2), priceCurrency: d.currency, url } : undefined;

  if (product.collection === 'courses') {
    return {
      '@context': 'https://schema.org',
      '@type': 'Course',
      name: d.title,
      description: d.summary,
      url,
      ...(offers && { offers }),
    };
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'EducationEvent',
    name: d.title,
    description: d.summary,
    url,
    ...(d.start && { startDate: isoDate(d.start) }),
    ...('end' in d && d.end && { endDate: isoDate(d.end) }),
    ...(offers && { offers }),
  };
}
