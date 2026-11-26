import { dateLabel, money, orderRef } from './catalogo.js';
import { pinLogin } from './conta.js';
import { api, element, setError } from './interface.js';
import { orderStatuses, renderItems, renderProgress } from './pedido-ui.js';

const get = id => document.getElementById(id);
const login = get('customer-login');
const logout = get('customer-logout');
const errorNode = get('customer-error');
const orderList = get('customer-order-list');
const account = get('account-email');
const control = pinLogin(login, ({ email }) => loadOrders(email));
const params = new URLSearchParams(location.search);
const selectedOrder = params.get('pedido');

function renderOrder(order) {
  const card = element('details', undefined, 'panel-card customer-order');
  card.open = String(order.id) === selectedOrder;
  const summary = element('summary');
  summary.append(element('strong', `Pedido ${orderRef(order.id)}`), element('time', dateLabel(order.created_at)),
    element('span', orderStatuses[order.status], 'order-badge'), element('strong', money(order.total)));
  const table = element('table', undefined, 'order-table');
  const caption = element('caption', 'Itens do pedido', 'sr-only');
  const headings = element('tr');
  for (const label of ['Produto', 'Qtd.', 'Subtotal']) {
    const heading = element('th', label);
    heading.scope = 'col';
    headings.append(heading);
  }
  const header = element('thead');
  header.append(headings);
  const items = element('tbody');
  renderItems(items, order.items);
  table.append(caption, header, items);
  const history = element('ol', undefined, 'status-history');
  const tracking = element('div', undefined, 'tracking-info');
  renderProgress(history, tracking, order);
  card.append(summary, table, element('h3', 'Andamento', 'space-top'), history, tracking);
  return card;
}

async function loadOrders(email) {
  setError(errorNode);
  get('customer-loading').hidden = false;
  try {
    email ??= (await api('/api/cliente/sessao')).email;
    if (email) {
      const orders = await api('/api/cliente/pedidos');
      login.hidden = true;
      logout.hidden = account.hidden = false;
      account.textContent = email;
      orderList.replaceChildren(...orders.map(renderOrder));
      const confirmed = orders.find(order => params.get('confirmado') === '1' && String(order.id) === selectedOrder);
      const notice = get('confirmed-order');
      notice.hidden = !confirmed;
      notice.textContent = confirmed ? `Pedido ${orderRef(confirmed.id)} confirmado. Total ${money(confirmed.total)}.` : '';
      get('customer-empty').hidden = orders.length > 0;
      get('customer-orders').hidden = false;
    } else login.hidden = false;
  } catch (error) {
    if (error.status === 401) login.hidden = false;
    else setError(errorNode, error);
  } finally {
    get('customer-loading').hidden = true;
  }
}

logout.addEventListener('click', async () => {
  logout.disabled = true;
  try {
    await api('/api/cliente/sair', {});
    account.hidden = logout.hidden = get('customer-orders').hidden = true;
    account.textContent = '';
    orderList.replaceChildren();
    control.reset();
    login.hidden = false;
    control.focus();
  } catch (error) {
    setError(errorNode, error);
  } finally {
    logout.disabled = false;
  }
});

addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
loadOrders();
