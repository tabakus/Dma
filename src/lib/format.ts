/** Форматирование значений для вывода. Локаль берётся из настроек сайта. */

export function formatPrice(amount: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
}

export function formatDate(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

/** Машиночитаемая дата для <time datetime>. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
