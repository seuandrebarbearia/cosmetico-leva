import { api, setError } from './interface.js';

const emailKey = 'cosmetico-leva-email-v1';
export function rememberedEmail() {
  try { return localStorage.getItem(emailKey) || ''; } catch { return ''; }
}

export function rememberEmail(email) {
  try { localStorage.setItem(emailKey, email); } catch { /* Storage is optional. */ }
}

export function pinLogin(root, onLogin) {
  const form = root.querySelector('[data-pin-login]');
  const recovery = root.querySelector('[data-reset-pin]');
  const recoveryToggle = root.querySelector('[data-show-reset]');
  const errorNode = root.querySelector('[data-login-error]');
  const feedback = root.querySelector('[data-login-feedback]');

  function showRecovery(visible) {
    recovery.hidden = !visible;
    form.hidden = recoveryToggle.hidden = visible;
    setError(errorNode);
    feedback.textContent = '';
  }

  function reset() {
    form.reset();
    form.elements.email.value = rememberedEmail();
    showRecovery(false);
  }

  recoveryToggle.addEventListener('click', () => {
    recovery.elements.email.value = form.elements.email.value || rememberedEmail();
    showRecovery(true);
    recovery.elements.email.focus();
  });
  root.querySelector('[data-cancel-reset]').addEventListener('click', () => {
    showRecovery(false);
    form.elements.email.focus();
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    setError(errorNode);
    try {
      const account = await api('/api/cliente/entrar', Object.fromEntries(new FormData(form)));
      rememberEmail(account.email);
      reset();
      await onLogin(account);
    } catch (error) {
      form.elements.pin.value = '';
      setError(errorNode, error);
    } finally {
      button.disabled = false;
    }
  });

  recovery.addEventListener('submit', async event => {
    event.preventDefault();
    const button = recovery.querySelector('[type="submit"]');
    button.disabled = true;
    setError(errorNode);
    try {
      await api('/api/cliente/recuperar', { email: recovery.elements.email.value.trim() });
      feedback.textContent = 'Se o e-mail já estiver cadastrado, enviaremos um link para criar ou recuperar a senha.';
    } catch (error) {
      setError(errorNode, error);
    } finally {
      button.disabled = false;
    }
  });

  reset();
  return { reset, focus: () => (form.elements.email.value ? form.elements.pin : form.elements.email).focus() };
}
