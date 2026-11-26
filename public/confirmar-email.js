import { api, setError } from './interface.js';
import { rememberEmail } from './conta.js';

const token = location.hash.slice(1);
const get = id => document.getElementById(id);
const form = get('confirm-form');
const status = get('confirm-text');
const errorNode = get('confirm-error');
const button = get('confirm-submit');

function clearConfirmedCart(requestId) {
  try {
    const attemptKey = 'cosmetico-leva-checkout-v1';
    const cartKey = 'cosmetico-leva-cart-v1';
    const attempt = JSON.parse(localStorage.getItem(attemptKey) || 'null');
    if (attempt?.id !== requestId) return;
    const cart = JSON.parse(localStorage.getItem(cartKey) || '{}');
    const items = Object.entries(cart).map(([id, quantity]) => ({ id: Number(id), quantity })).sort((a, b) => a.id - b.id);
    if (JSON.stringify(items) === attempt.signature) localStorage.removeItem(cartKey);
    localStorage.removeItem(attemptKey);
  } catch { /* The order is already confirmed. */ }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  button.disabled = true;
  setError(errorNode);
  try {
    const result = await api('/api/cliente/confirmar', { token, pin: form.elements.pin.value });
    history.replaceState(null, '', location.pathname);
    rememberEmail(result.email);
    if (result.order) clearConfirmedCart(result.order.requestId);
    location.replace(result.order ? `/meus-pedidos?pedido=${result.order.id}&confirmado=1` : '/meus-pedidos');
  } catch (error) {
    setError(errorNode, error);
    button.disabled = false;
  }
});

try {
  const { kind } = await api('/api/cliente/verificar-link', { token });
  if (kind === 'senha') {
    get('confirm-title').textContent = 'Crie sua senha';
    status.textContent = 'Escolha quatro dígitos para entrar em Meus pedidos.';
    get('confirm-pin-group').hidden = false;
    form.elements.pin.disabled = false;
    form.elements.pin.required = true;
    button.textContent = 'Salvar senha';
  } else status.textContent = 'Confirme seu e-mail para registrar o pedido e abrir os detalhes.';
  form.hidden = false;
} catch (error) {
  status.hidden = true;
  setError(errorNode, error);
}
