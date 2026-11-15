/**
 * Поведение формы заявки в браузере: состояния, отправка без перезагрузки, показ ошибок.
 *
 * Правила:
 * - успех показывается ТОЛЬКО после ответа сервера { ok: true };
 * - при любой ошибке введённые данные остаются в форме, кнопка снова активна;
 * - один submission_id на заполнение формы: повторное нажатие после сбоя сети
 *   не создаёт второе письмо (сервер узнаёт тот же id).
 */
import { FIELD, type ApplicationResponse } from '../../../shared/application-contract';

type State = 'idle' | 'sending' | 'success' | 'error';

interface Messages {
  sending: string;
  success: string;
  error: string;
  retry: string;
  errors: Record<string, string>;
}

function newSubmissionId(): string {
  return crypto.randomUUID();
}

function setup(form: HTMLFormElement): void {
  const messages = JSON.parse(form.dataset.messages ?? '{}') as Messages;
  const status = form.querySelector<HTMLElement>('[data-status]');
  const submit = form.querySelector<HTMLButtonElement>('[data-submit]');
  const idInput = form.querySelector<HTMLInputElement>('[data-submission-id]');
  if (!status || !submit || !idInput) return;
  const submitLabel = submit.textContent ?? '';
  idInput.value = newSubmissionId();

  const setState = (state: State, text = '') => {
    form.dataset.state = state;
    status.textContent = text;
    submit.disabled = state === 'sending';
    submit.textContent = state === 'error' ? messages.retry : submitLabel;
  };

  const clearFieldErrors = () => {
    form.querySelectorAll<HTMLElement>('[data-error-for]').forEach((el) => (el.textContent = ''));
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  };

  const showFieldError = (name: string, code: string) => {
    const target = form.querySelector<HTMLElement>(`[data-error-for="${name}"]`);
    const input = form.elements.namedItem(name);
    if (target) target.textContent = messages.errors[code] ?? messages.errors.invalid ?? code;
    if (input instanceof HTMLElement) input.setAttribute('aria-invalid', 'true');
  };

  /** Проверка в браузере для быстрой подсказки. Окончательная проверка — на сервере. */
  const validateLocally = (): boolean => {
    let firstInvalid: HTMLElement | null = null;
    for (const name of [FIELD.name, FIELD.email, FIELD.phone, FIELD.message, FIELD.consent]) {
      const el = form.elements.namedItem(name);
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) continue;
      if (el.validity.valid) continue;
      const v = el.validity;
      const code = v.valueMissing ? 'required' : v.tooShort ? 'too_short' : v.tooLong ? 'too_long' : 'invalid';
      showFieldError(name, code);
      firstInvalid ??= el;
    }
    firstInvalid?.focus();
    return firstInvalid === null;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (form.dataset.state === 'sending') return;
    clearFieldErrors();
    if (!validateLocally()) return;

    setState('sending', messages.sending);
    try {
      const response = await fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: { Accept: 'application/json' },
      });
      const result = (await response.json().catch(() => null)) as ApplicationResponse | null;

      if (response.ok && result?.ok === true) {
        setState('success', messages.success);
        form.reset();
        idInput.value = newSubmissionId(); // следующая заявка — новая попытка
        return;
      }
      if (result && !result.ok && result.fields) {
        for (const [name, code] of Object.entries(result.fields)) if (code) showFieldError(name, code);
      }
      const specific = result && !result.ok ? messages.errors[result.error] : undefined;
      setState('error', specific ?? messages.error);
    } catch {
      // Сеть недоступна или ответ не получен: данные остаются в форме, id прежний.
      setState('error', messages.error);
    }
  });
}

export function initApplicationForms(): void {
  document.querySelectorAll<HTMLFormElement>('form[data-application-form]').forEach(setup);
}
