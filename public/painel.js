import { dateLabel, money, orderRef } from './catalogo.js';
import { api, element, setError } from './interface.js';
import { orderStatuses, renderItems, renderProgress } from './pedido-ui.js';

const get = id => document.getElementById(id);
const loginForm = get('login-form');
const ordersView = get('orders-view');
const orderView = get('order-view');
const status = get('panel-status');
const panelError = get('panel-error');
const logout = get('logout');
const reload = get('reload');
const printId = location.pathname.match(/^\/painel\/imprimir\/(\d+)$/)?.[1];
const requestedId = printId || new URLSearchParams(location.search).get('pedido');
const id = /^\d+$/.test(requestedId || '') ? requestedId : null;
const path = `/api/painel/pedidos${id ? `/${id}` : ''}`;
const notice = get('new-order-notice');
const statusForm = get('status-form');
const select = get('next-status');
const orderError = get('order-update-error');
const retry = get('resend-email');
let authenticated = false;
let refreshing = false;
let listSnapshot;

if (printId) document.body.classList.add('print-view');

function formatPhone(phone) {
  return phone.replace(/^55(\d{2})(\d{4,5})(\d{4})$/, '+55 ($1) $2-$3');
}

function showLogin() {
  authenticated = false;
  notice.hidden = true;
  if (printId) {
    location.replace('/painel');
    return;
  }
  ordersView.hidden = true;
  orderView.hidden = true;
  logout.hidden = true;
  get('panel-back').hidden = true;
  loginForm.hidden = false;
}

function renderOrders(orders) {
  const snapshot = JSON.stringify(orders);
  if (snapshot === listSnapshot) {
    ordersView.hidden = false;
    return;
  }
  listSnapshot = snapshot;
  const list = get('orders');
  const focusedOrder = list.contains(document.activeElement) ? document.activeElement.getAttribute('href') : null;
  const entries = [];
  for (const order of orders) {
    const item = element('li');
    const link = element('a', undefined, 'order-link');
    link.href = `/painel?pedido=${order.id}`;
    link.setAttribute('aria-label', `Abrir pedido ${orderRef(order.id)} de ${order.customer}`);
    const identity = element('div');
    identity.append(element('strong', `Pedido ${orderRef(order.id)}`));
    if (!order.read_at) identity.append(element('span', 'Novo', 'new-order-badge'));
    identity.append(element('span', dateLabel(order.created_at)));
    const customer = element('div');
    customer.append(element('strong', order.customer), element('span', formatPhone(order.whatsapp)), element('span', orderStatuses[order.status]));
    link.append(identity, customer, element('strong', money(order.total), 'order-amount'));
    item.append(link);
    entries.push(item);
  }
  list.replaceChildren(...entries);
  if (focusedOrder) [...list.querySelectorAll('a')].find(link => link.getAttribute('href') === focusedOrder)?.focus();
  get('orders-empty').hidden = orders.length > 0;
  ordersView.hidden = false;
}

function syncShippingFields() {
  const shipping = select.value === 'enviado';
  get('shipping-fields').hidden = !shipping;
  for (const input of get('shipping-fields').querySelectorAll('input')) {
    input.required = shipping;
    input.disabled = !shipping;
  }
}

function renderOrder(order, focus = false) {
  document.title = `Pedido ${orderRef(order.id)} | Cosmético Leva`;
  get('order-title').textContent = `Pedido ${orderRef(order.id)}`;
  get('order-date').textContent = dateLabel(order.created_at);
  get('order-customer').textContent = order.customer;
  if (printId) {
    get('order-whatsapp').textContent = formatPhone(order.whatsapp);
  } else {
    const phone = element('a', formatPhone(order.whatsapp));
    phone.href = `https://wa.me/${order.whatsapp}`;
    phone.target = '_blank';
    phone.rel = 'noopener';
    get('order-whatsapp').replaceChildren(phone);
  }
  get('order-email-group').hidden = !order.email;
  get('order-email').textContent = order.email || '';
  get('order-address-group').hidden = !order.address;
  if (order.address) {
    const { street, number, district, city, uf, cep, complement } = order.address;
    get('order-address').replaceChildren(
      element('span', `${street}, ${number}${complement ? ` · ${complement}` : ''}`),
      element('span', `${district} · ${city}/${uf} · CEP ${cep}`),
    );
  }
  renderItems(get('order-items'), order.items);
  get('order-total').textContent = money(order.total);
  get('print-link').href = `/painel/imprimir/${order.id}`;
  get('print-link').hidden = Boolean(printId);
  get('print-button').hidden = !printId;
  orderView.hidden = false;
  if (focus) get('order-title').focus();
  if (printId) return;

  get('current-order-status').textContent = orderStatuses[order.status];
  renderProgress(get('order-history'), get('order-tracking'), order);
  const nextOptions = Object.keys(orderStatuses).filter(key => key !== order.status);
  statusForm.hidden = false;
  const placeholder = element('option', 'Escolha o status');
  placeholder.value = '';
  placeholder.disabled = placeholder.selected = true;
  select.replaceChildren(placeholder, ...nextOptions.map(key => {
    const option = element('option', orderStatuses[key]);
    option.value = key;
    return option;
  }));
  syncShippingFields();

  const shipped = order.status === 'enviado';
  get('shipping-actions').hidden = !shipped;
  retry.hidden = !['failed', 'pending'].includes(order.mail_status);
  const emailStatus = get('tracking-email-status');
  emailStatus.hidden = !shipped;
  emailStatus.textContent = {
    sent: 'E-mail de rastreio enviado.', failed: 'O e-mail de rastreio falhou. Você pode reenviar.',
    pending: 'O e-mail de rastreio está pendente.', sending: 'Enviando o e-mail de rastreio…',
  }[order.mail_status] || 'Este pedido não tem um e-mail confirmado.';
  if (shipped) {
    const message = `Olá, ${order.customer}! Seu pedido ${orderRef(order.id)} da Cosmético Leva foi enviado.\nTransportadora: ${order.carrier}\nRastreio: ${order.tracking}`;
    get('send-whatsapp').href = `https://wa.me/${order.whatsapp}?text=${encodeURIComponent(message)}`;
  }
}

function renderNotice({ count, latest }) {
  notice.hidden = !count;
  const text = count === 1 ? '1 pedido novo ainda não aberto' : `${count} pedidos novos ainda não abertos`;
  if (notice.textContent !== text || notice.dataset.latest !== String(latest)) {
    notice.textContent = text;
    notice.dataset.latest = String(latest);
  }
}

async function poll() {
  if (!authenticated || printId || document.hidden || refreshing) return;
  refreshing = true;
  try {
    const [unread, list] = await Promise.all([api('/api/painel/novos'), !id && api(path)]);
    if (!authenticated) return;
    renderNotice(unread);
    if (list) renderOrders(list);
  } catch (error) {
    if (error.status === 401) showLogin();
  } finally {
    refreshing = false;
  }
}

async function load() {
  status.hidden = false;
  reload.disabled = true;
  setError(panelError);
  try {
    const result = await (id && !printId ? api(`${path}/abrir`, {}) : api(path));
    authenticated = true;
    loginForm.hidden = true;
    logout.hidden = Boolean(printId);
    get('panel-back').hidden = !id;
    if (id) renderOrder(result, true);
    else renderOrders(result);
    await poll();
  } catch (error) {
    if (error.status === 401) showLogin();
    else {
      get('panel-back').hidden = !id;
      setError(panelError, error);
    }
  } finally {
    reload.disabled = false;
    status.hidden = true;
  }
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  const submit = get('sign-in');
  const errorNode = get('login-error');
  submit.disabled = true;
  setError(errorNode);
  const credentials = Object.fromEntries(new FormData(loginForm));
  try {
    await api('/api/login', credentials);
    loginForm.reset();
    loginForm.hidden = true;
    await load();
  } catch (error) {
    setError(errorNode, error);
  } finally {
    submit.disabled = false;
  }
});

select.addEventListener('change', syncShippingFields);
statusForm.addEventListener('submit', async event => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(statusForm));
  const button = statusForm.querySelector('button[type="submit"]');
  button.disabled = select.disabled = true;
  setError(orderError);
  try {
    renderOrder(await api(`${path}/status`, payload));
  } catch (error) {
    if (error.status === 401) showLogin();
    else setError(orderError, error);
  } finally {
    button.disabled = select.disabled = false;
  }
});

retry.addEventListener('click', async () => {
  retry.disabled = true;
  setError(orderError);
  try {
    renderOrder(await api(`${path}/reenviar-email`, {}));
  } catch (error) {
    if (error.status === 401) showLogin();
    else setError(orderError, error);
  } finally {
    retry.disabled = false;
  }
});

logout.addEventListener('click', async () => {
  logout.disabled = true;
  try {
    await api('/api/logout', {});
    location.replace('/painel');
  } catch (error) {
    if (error.status === 401) location.replace('/painel');
    else setError(panelError, error);
  } finally {
    logout.disabled = false;
  }
});

reload.addEventListener('click', load);
get('print-button').addEventListener('click', () => window.print());
addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
document.addEventListener('visibilitychange', poll);
if (!printId) setInterval(poll, 30_000);
load();
