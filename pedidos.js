import { createHash } from 'node:crypto';
import { normalizeEmail } from './dados-cliente.js';
import { HttpError } from './http.js';
import { sendMail } from './mail.js';
import { orderRef, PRODUCT_COUNT, UNIT_PRICE } from './public/catalogo.js';

const states = new Set(['recebido', 'em_preparo', 'preparado', 'enviado']);
const statesUF = new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));
const clean = value => typeof value === 'string' ? value.trim() : '';
const now = () => new Date().toISOString();
const fields = 'id, created_at, customer, whatsapp, items, total, account_email, delivery_address, read_at, status, status_history, carrier, tracking, mail_status, mail_attempt_at';

function address(value) {
  const cep = clean(value?.cep);
  const street = clean(value?.street);
  const number = clean(value?.number);
  const district = clean(value?.district);
  const city = clean(value?.city);
  const uf = clean(value?.uf).toUpperCase();
  const complement = clean(value?.complement);
  if (!/^\d{5}-?\d{3}$/.test(cep) || !street || street.length > 150 || !number || number.length > 20 ||
      !district || district.length > 100 || !city || city.length > 100 || !statesUF.has(uf) || complement.length > 120) {
    throw new HttpError(400, 'Confira o CEP, a rua, o número, o bairro, a cidade e a UF do endereço de entrega.');
  }
  return { cep: cep.replace(/^(\d{5})(\d{3})$/, '$1-$2'), street, number, district, city, uf, complement };
}

function orderItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > PRODUCT_COUNT) {
    throw new HttpError(400, 'Adicione pelo menos um produto ao carrinho.');
  }
  const seen = new Set();
  return items.map(item => {
    if (!item || !Number.isInteger(item.id) || item.id < 1 || item.id > PRODUCT_COUNT || seen.has(item.id) ||
      !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
      throw new HttpError(400, 'Confira os produtos e as quantidades do carrinho.');
    }
    seen.add(item.id);
    return { id: item.id, quantity: item.quantity, unitPrice: UNIT_PRICE };
  }).sort((a, b) => a.id - b.id);
}

export function checkoutData(body, email) {
  const customer = clean(body.customer);
  const phone = clean(body.whatsapp);
  let whatsapp = phone.replace(/\D/g, '');
  if (whatsapp.length === 10 || whatsapp.length === 11) whatsapp = `55${whatsapp}`;
  if (customer.length < 2 || customer.length > 100) throw new HttpError(400, 'Informe seu nome (2 a 100 caracteres).');
  if (!/^\+?[\d(). -]{10,28}$/.test(phone) || !/^55[1-9]\d{9,10}$/.test(whatsapp)) {
    throw new HttpError(400, 'Informe um WhatsApp brasileiro com DDD.');
  }
  if (normalizeEmail(body.email) !== email) throw new HttpError(400, 'Confira o e-mail da conta.');
  if (typeof body.requestId !== 'string' || !/^[\da-f]{32}$/.test(body.requestId)) {
    throw new HttpError(400, 'Atualize a página e tente novamente.');
  }
  return { customer, whatsapp, email, address: address(body.address), items: orderItems(body.items), requestId: body.requestId };
}

function history(row) {
  const saved = JSON.parse(row.status_history);
  return saved.length ? saved : [{ status: 'recebido', at: row.created_at }];
}

function view(row) {
  return {
    id: row.id, created_at: row.created_at, items: JSON.parse(row.items), total: row.total,
    status: row.status, history: history(row), carrier: row.carrier, tracking: row.tracking,
  };
}

function ownerView(row) {
  const { mail_status, mail_attempt_at } = row;
  const expired = mail_status === 'sending' && Date.parse(mail_attempt_at) <= Date.now() - 120_000;
  return {
    ...view(row), customer: row.customer, whatsapp: row.whatsapp, email: row.account_email, read_at: row.read_at,
    address: row.delivery_address ? JSON.parse(row.delivery_address) : null, mail_status: expired ? 'failed' : mail_status,
  };
}

function deliveryTracking(body) {
  const carrier = clean(body.carrier);
  const tracking = clean(body.tracking);
  let valid = /^[\p{L}\p{N}][\p{L}\p{N} ._/-]{0,99}$/u.test(tracking);
  if (/^https?:\/\//i.test(tracking) && tracking.length <= 600) {
    try {
      const url = new URL(tracking);
      valid = ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !/\s/.test(tracking);
    } catch {
      valid = false;
    }
  }
  if (!carrier || carrier.length > 100 || /[\r\n]/.test(carrier) || !valid) {
    throw new HttpError(400, 'Informe a transportadora e um código ou link de rastreio válido.');
  }
  return { carrier, tracking };
}

export function orderRepository(query) {
  async function get(id) {
    const [row] = await query(`SELECT ${fields} FROM pedidos WHERE id = ?`, id);
    if (!row) throw new HttpError(404, 'Pedido não encontrado.');
    return row;
  }

  async function trackingMail(id) {
    const row = await get(id);
    if (row.status !== 'enviado' || !row.account_email) throw new HttpError(409, 'Este pedido não tem rastreio com e-mail disponível.');
    const attempt = now();
    const retryBefore = new Date(Date.now() - 120_000).toISOString();
    const [claimed] = await query(`UPDATE pedidos SET mail_status = 'sending', mail_attempt_at = ?
      WHERE id = ? AND (mail_status IN ('pending', 'failed') OR (mail_status = 'sending' AND mail_attempt_at <= ?))
      RETURNING account_email, carrier, tracking`, attempt, id, retryBefore);
    if (!claimed) return ownerView(await get(id));
    let result = 'sent';
    try {
      await sendMail(claimed.account_email, `Rastreio do pedido ${orderRef(id)} | Cosmético Leva`,
        `Seu pedido ${orderRef(id)} foi enviado.\nTransportadora: ${claimed.carrier}\nRastreio: ${claimed.tracking}\n\nVocê também pode acompanhar o pedido em Meus pedidos na loja.`);
    } catch (error) {
      result = 'failed';
      console.warn('Envio de rastreio indisponível:', error.code || error.name);
    }
    await query("UPDATE pedidos SET mail_status = ? WHERE id = ? AND status = 'enviado' AND mail_attempt_at = ?", result, id, attempt);
    return ownerView(await get(id));
  }

  return {
    async create(body, email) {
      const { customer, whatsapp, address: deliveryAddress, items } = checkoutData(body, email);
      const delivery = JSON.stringify(deliveryAddress);
      const total = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
      const serialized = JSON.stringify(items);
      const key = createHash('sha256').update(`${email}:${body.requestId}`).digest('hex');
      const created = now();
      const initial = JSON.stringify([{ status: 'recebido', at: created }]);
      await query(`INSERT INTO pedidos (created_at, customer, whatsapp, items, total, request_id, account_email, delivery_address, status_history)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (request_id) DO NOTHING`,
      created, customer, whatsapp, serialized, total, key, email, delivery, initial);
      const [saved] = await query('SELECT id, customer, whatsapp, items, total, account_email, delivery_address FROM pedidos WHERE request_id = ?', key);
      if (saved.account_email !== email || saved.customer !== customer || saved.whatsapp !== whatsapp || saved.items !== serialized || saved.delivery_address !== delivery) {
        throw new HttpError(409, 'Esse envio já foi registrado. Confira o pedido em Meus pedidos.');
      }
      return { id: saved.id, total: saved.total };
    },
    async forCustomer(email, id) {
      const rows = id === undefined
        ? await query(`SELECT ${fields} FROM pedidos WHERE account_email = ? ORDER BY id DESC`, email)
        : await query(`SELECT ${fields} FROM pedidos WHERE account_email = ? AND id = ?`, email, id);
      if (id === undefined) return rows.map(view);
      if (!rows.length) throw new HttpError(404, 'Pedido não encontrado.');
      return view(rows[0]);
    },
    forOwner: () => query('SELECT id, created_at, customer, whatsapp, total, status, read_at FROM pedidos ORDER BY id DESC'),
    async unread() {
      const [row] = await query('SELECT COUNT(*) AS count, MAX(id) AS latest FROM pedidos WHERE read_at IS NULL');
      return { count: Number(row.count), latest: row.latest };
    },
    async detail(id, markRead) {
      if (markRead) await query('UPDATE pedidos SET read_at = ? WHERE id = ? AND read_at IS NULL', now(), id);
      return ownerView(await get(id));
    },
    async changeStatus(id, body) {
      if (!states.has(body.status)) throw new HttpError(400, 'Selecione um status válido.');
      const order = await get(id);
      if (body.status === order.status) return ownerView(order);
      const shipped = body.status === 'enviado';
      const { carrier, tracking } = shipped ? deliveryTracking(body) : { carrier: null, tracking: null };
      const mailStatus = shipped && order.account_email ? 'pending' : null;
      const savedHistory = JSON.stringify([...history(order), { status: body.status, at: now() }]);
      const [saved] = await query(`UPDATE pedidos SET status = ?, status_history = ?, carrier = ?, tracking = ?, mail_status = ?, mail_attempt_at = NULL
        WHERE id = ? AND status = ? AND status_history = ? RETURNING id`,
      body.status, savedHistory, carrier, tracking, mailStatus, id, order.status, order.status_history);
      if (!saved) throw new HttpError(409, 'O pedido foi atualizado em outra aba. Reabra os detalhes para continuar.');
      return mailStatus ? trackingMail(id) : ownerView(await get(id));
    },
    trackingMail,
  };
}
