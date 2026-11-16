/**
 * Акцент в текстах из YAML: фрагмент в двойных квадратных скобках выделяется фирменным цветом.
 * «Немецкая грамматика — это [[система]], а не набор правил» → три части, средняя с accent: true.
 */
export interface TextPart {
  text: string;
  accent: boolean;
}

export function splitAccent(value: string): TextPart[] {
  const parts: TextPart[] = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let last = 0;
  for (const m of value.matchAll(re)) {
    if (m.index > last) parts.push({ text: value.slice(last, m.index), accent: false });
    parts.push({ text: m[1] ?? '', accent: true });
    last = m.index + m[0].length;
  }
  if (last < value.length) parts.push({ text: value.slice(last), accent: false });
  return parts;
}

/** Текст без разметки акцента (для title, aria-label, meta). */
export function plainText(value: string): string {
  return value.replace(/\[\[([^\]]+)\]\]/g, '$1');
}

/** Делит слоган на предложения: «Dein Deutsch. Dein Weg.» → ["Dein Deutsch.", "Dein Weg."]. */
export function sentences(value: string): string[] {
  return value.split(/(?<=[.!?])\s+/).filter(Boolean);
}
