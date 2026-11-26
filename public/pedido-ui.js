import { dateLabel, money, productRef } from './catalogo.js';
import { element } from './interface.js';

export const orderStatuses = {
  recebido: 'Recebido', em_preparo: 'Em preparo', preparado: 'Preparado', enviado: 'Enviado',
};

export function renderItems(target, items) {
  target.replaceChildren();
  for (const item of items) {
    const row = element('tr');
    const reference = element('th', productRef(item.id));
    reference.scope = 'row';
    row.append(reference, element('td', item.quantity), element('td', money(item.unitPrice * item.quantity)));
    target.append(row);
  }
}

export function renderProgress(historyNode, trackingNode, order) {
  historyNode.replaceChildren();
  for (const entry of order.history) {
    const line = element('li', orderStatuses[entry.status]);
    const time = element('time', dateLabel(entry.at));
    time.dateTime = entry.at;
    line.append(time);
    historyNode.append(line);
  }
  trackingNode.replaceChildren();
  if (!order.tracking) return;
  trackingNode.append(element('p', `Transportadora: ${order.carrier}`));
  const line = element('p', 'Rastreio: ');
  if (/^https?:\/\//i.test(order.tracking)) {
    const link = element('a', order.tracking);
    link.href = order.tracking;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    line.append(link);
  } else line.append(order.tracking);
  trackingNode.append(line);
}
