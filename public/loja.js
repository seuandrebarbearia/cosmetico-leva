import { money, productPhoto, productRef, PRODUCT_COUNT, UNIT_PRICE } from './catalogo.js';
import { api, element, setError } from './interface.js';
import { rememberedEmail, rememberEmail } from './conta.js';

const get = id => document.getElementById(id);
const storageKey = 'cosmetico-leva-cart-v1';
const dialog = get('cart-dialog');
const form = get('checkout-form');
const itemsList = get('cart-items');
const toast = get('toast');
let toastTimer;
let submitting = false;
const attemptStorage = 'cosmetico-leva-checkout-v1';
let attempt;

function checkoutId(items) {
  const signature = JSON.stringify(items);
  try { attempt ??= JSON.parse(localStorage.getItem(attemptStorage)); } catch { /* Storage is optional. */ }
  if (attempt?.signature !== signature || !/^[a-f0-9]{32}$/.test(attempt.id)) {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    attempt = { signature, id };
    try { localStorage.setItem(attemptStorage, JSON.stringify(attempt)); } catch { /* Keep the key in memory. */ }
  }
  return attempt.id;
}

function readCart() {
  try {
    const entries = Object.entries(JSON.parse(localStorage.getItem(storageKey) || '{}'));
    return new Map(entries.map(([id, qty]) => [Number(id), qty]).filter(([id, qty]) =>
      Number.isInteger(id) && id >= 1 && id <= PRODUCT_COUNT && Number.isInteger(qty) && qty >= 1 && qty <= 99));
  } catch {
    return new Map();
  }
}

const cart = readCart();

function quantityTotal() {
  return [...cart.values()].reduce((sum, quantity) => sum + quantity, 0);
}

function updateCart(save = true) {
  try {
    if (save) localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(cart)));
  } catch {
    // The open page can still hold the cart when browser storage is unavailable.
  }
  get('cart-count').textContent = quantityTotal();
  get('cart-open').setAttribute('aria-label', `Carrinho, ${quantityTotal()} itens`);
}

function notify(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toastTimer = setTimeout(() => { toast.textContent = ''; }, 2800);
}

function photo(id, lazy) {
  const image = element('img');
  image.src = productPhoto(id);
  image.alt = '';
  image.decoding = 'async';
  if (lazy) image.loading = 'lazy';
  return image;
}

for (let id = 1; id <= PRODUCT_COUNT; id++) {
  const card = element('article', undefined, 'product-card');
  const visual = element('a', undefined, 'product-photo');
  visual.href = productPhoto(id);
  visual.target = '_blank';
  visual.rel = 'noopener';
  visual.setAttribute('aria-label', `Ampliar a foto de ${productRef(id)} em outra aba`);
  const info = element('div', undefined, 'product-info');
  const add = element('button', 'Adicionar ao carrinho', 'button add');
  add.type = 'button';
  add.setAttribute('aria-label', `Adicionar ${productRef(id)} ao carrinho`);
  add.addEventListener('click', () => {
    const quantity = cart.get(id) || 0;
    if (quantity >= 99) return notify(`Limite de 99 unidades para ${productRef(id)}.`);
    cart.set(id, quantity + 1);
    updateCart();
    notify(`${productRef(id)} adicionado ao carrinho.`);
  });
  const image = photo(id, id > 4);
  image.alt = productRef(id);
  visual.append(image);
  info.append(element('h3', productRef(id)), element('p', money(UNIT_PRICE), 'price'), add);
  card.append(visual, info);
  get('products').append(card);
}

function cartButton(id, action, label, className, accessibleLabel) {
  const button = element('button', label, className);
  button.type = 'button';
  button.dataset.id = id;
  button.dataset.action = action;
  button.setAttribute('aria-label', `${accessibleLabel} de ${productRef(id)}`);
  return button;
}

function renderCart() {
  itemsList.replaceChildren();
  for (const [id, quantity] of cart) {
    const line = element('li', undefined, 'cart-item');
    const details = element('div', undefined, 'cart-product');
    const controls = element('div', undefined, 'quantity');
    const decrease = cartButton(id, 'minus', '−', 'icon-button', 'Reduzir quantidade');
    const increase = cartButton(id, 'plus', '+', 'icon-button', 'Aumentar quantidade');
    const remove = cartButton(id, 'remove', 'Excluir', 'text-button', 'Excluir item');
    increase.disabled = quantity >= 99;
    controls.append(decrease, element('span', quantity), increase, remove);
    details.append(element('strong', productRef(id)), controls);
    line.append(photo(id, false), details, element('strong', money(quantity * UNIT_PRICE), 'subtotal'));
    itemsList.append(line);
  }
  get('cart-empty').hidden = cart.size > 0;
  get('cart-total-line').hidden = cart.size === 0;
  get('checkout-open').hidden = cart.size === 0;
  get('cart-total').textContent = money(quantityTotal() * UNIT_PRICE);
}

itemsList.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const id = Number(button.dataset.id);
  const action = button.dataset.action;
  const quantity = cart.get(id);
  if (action === 'remove' || (action === 'minus' && quantity === 1)) cart.delete(id);
  else cart.set(id, quantity + (action === 'plus' ? 1 : -1));
  updateCart();
  renderCart();
  const sameButton = itemsList.querySelector(`[data-id="${id}"][data-action="${action}"]:not(:disabled)`);
  const alternative = itemsList.querySelector(`[data-id="${id}"][data-action="minus"]`) || itemsList.querySelector('button');
  (sameButton || alternative || get('shop-more')).focus();
});

function showView(view) {
  get('cart-view').hidden = view !== 'cart';
  form.hidden = view !== 'checkout';
  get('confirmation').hidden = view !== 'confirmation';
  get('cart-title').textContent = { cart: 'Seu carrinho', checkout: 'Finalizar compra', confirmation: 'Confirme no e-mail' }[view];
}

get('cart-open').addEventListener('click', () => {
  showView('cart');
  renderCart();
  dialog.showModal();
});
for (const id of ['cart-close', 'shop-more', 'finish']) get(id).addEventListener('click', () => dialog.close());
dialog.addEventListener('cancel', event => { if (submitting) event.preventDefault(); });
function setProfile({ email, hasCpf, hasPin } = {}) {
  get('checkout-email').value = email || rememberedEmail();
  get('checkout-email').readOnly = Boolean(email);
  get('checkout-change-email').hidden = !email;
  get('checkout-cpf-group').hidden = get('cpf').disabled = Boolean(hasCpf);
  get('checkout-pin-group').hidden = get('checkout-pin').disabled = Boolean(hasPin);
}

function openCheckout(profile) {
  setProfile(profile);
  get('checkout-total').textContent = money(quantityTotal() * UNIT_PRICE);
  setError(get('checkout-error'));
  showView('checkout');
  get('customer').focus();
}

get('checkout-open').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  let profile;
  try {
    profile = await api('/api/cliente/sessao');
  } catch {
    // The identification form can still be used when the session check fails.
  } finally {
    button.disabled = false;
  }
  if (!dialog.open || get('cart-view').hidden) return;
  openCheckout(profile);
});
get('back-to-cart').addEventListener('click', () => {
  showView('cart');
  renderCart();
  (cart.size ? get('checkout-open') : get('shop-more')).focus();
});
get('checkout-change-email').addEventListener('click', () => {
  setProfile();
  get('checkout-email').select();
});
get('checkout-edit').addEventListener('click', () => {
  showView('checkout');
  get('checkout-email').focus();
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submitting) return;
  const data = new FormData(form);
  const payload = {
    customer: data.get('customer').trim(),
    whatsapp: data.get('whatsapp').trim(),
    email: data.get('email'),
    cpf: data.get('cpf'),
    pin: data.get('pin'),
    address: Object.fromEntries(['cep', 'street', 'number', 'district', 'city', 'uf', 'complement'].map(field => [field, data.get(field)])),
    items: [...cart].sort(([a], [b]) => a - b).map(([id, quantity]) => ({ id, quantity })),
  };
  const requestId = checkoutId(payload.items);
  submitting = true;
  const lockedControls = [...form.querySelectorAll('input:enabled, button:enabled'), get('cart-close')];
  for (const control of lockedControls) control.disabled = true;
  get('checkout-submit').textContent = 'Enviando…';
  setError(get('checkout-error'));
  try {
    const { email } = await api('/api/pedidos', { ...payload, requestId });
    rememberEmail(email);
    get('checkout-pin').value = '';
    get('confirmation-email').textContent = `Enviamos um link de confirmação para ${email}.`;
    showView('confirmation');
    get('confirmation-email').focus();
  } catch (error) {
    setError(get('checkout-error'), error);
  } finally {
    submitting = false;
    for (const control of lockedControls) control.disabled = false;
    get('checkout-submit').textContent = 'Enviar pedido';
  }
});

addEventListener('storage', event => {
  if (event.key === attemptStorage) attempt = undefined;
  if (event.key !== storageKey && event.key !== null) return;
  cart.clear();
  for (const [id, quantity] of readCart()) cart.set(id, quantity);
  updateCart(false);
  if (dialog.open && !get('cart-view').hidden) renderCart();
});

updateCart();
