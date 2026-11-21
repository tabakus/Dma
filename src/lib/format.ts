/** Форматирование значений для вывода. Локаль берётся из настроек сайта. */

export function formatPrice(amount: number, currency: string, locale: string): string {
  // Целая сумма — без копеек (144 €), дробная — с двумя знаками (390,50 €).
  const digits = Number.isInteger(amount) ? 0 : 2;
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
}

export function formatDate(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

/** Диапазон дат компактно: «5–28 января 2027 г.» (общие месяц и год не повторяются). */
export function formatDateRange(start: Date, end: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).formatRange(start, end);
}

/** Машиночитаемая дата для <time datetime>. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
