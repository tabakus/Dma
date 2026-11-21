import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDateRange, formatPrice } from '../src/lib/format.ts';

const nb = (s: string) => s.replace(/\s/g, ' ');

test('цена: целая сумма без копеек, дробная — с двумя знаками', () => {
  assert.equal(nb(formatPrice(144, 'EUR', 'ru')), '144 €');
  assert.equal(nb(formatPrice(390.5, 'EUR', 'ru')), '390,50 €');
});

test('диапазон дат в одном месяце — компактно', () => {
  assert.equal(nb(formatDateRange(new Date('2027-01-05'), new Date('2027-01-28'), 'ru')), '5–28 января 2027 г.');
});
