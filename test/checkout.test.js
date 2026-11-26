import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { SMTPServer } from 'smtp-server';

test('checkout, confirmação, login, painel e rastreio', { timeout: 35_000 }, async t => {
  const messages = [];
  const smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ['AUTH', 'STARTTLS'],
    disableReverseLookup: true,
    closeTimeout: 200,
    onData(stream, session, callback) {
      const chunks = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => {
        messages.push({ to: session.envelope.rcptTo[0].address, body: Buffer.concat(chunks).toString().replace(/=\r?\n/g, '') });
        callback();
      });
      stream.on('error', callback);
    },
  });
  await new Promise((resolve, reject) => {
    smtp.once('error', reject);
    smtp.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => smtp.close(resolve)));

  const password = randomBytes(24).toString('hex');
  const server = spawn(process.execPath, ['server.js'], {
    env: {
      ...process.env,
      HOST: '127.0.0.1', PORT: '0', SECURE_COOKIE: 'false', APP_PUBLIC_URL: '',
      DATABASE_URL: '', DB_PATH: ':memory:', ADMIN_USER: 'teste', ADMIN_PASSWORD: password,
      CUSTOMER_PIN_SECRET: randomBytes(32).toString('hex'), MAIL_FROM: 'loja@example.test',
      SMTP_URL: `smtp://127.0.0.1:${smtp.server.address().port}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (server.exitCode !== null || server.signalCode !== null) return;
    const exited = once(server, 'exit');
    server.kill();
    await exited;
  });
  server.stderr.on('data', data => t.diagnostic(data.toString().trim()));
  const origin = await new Promise((resolve, reject) => {
    server.stdout.on('data', data => {
      const url = data.toString().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (url) resolve(url);
    });
    server.once('error', reject);
    server.once('exit', code => reject(new Error(`Servidor de teste encerrou com código ${code}`)));
  });

  async function request(path, { data, cookie } = {}) {
    const headers = { connection: 'close' };
    if (cookie) headers.cookie = cookie;
    if (data !== undefined) headers['content-type'] = 'application/json';
    const options = data === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(data) };
    const response = await fetch(origin + path, options);
    return new Response(await response.arrayBuffer(), { status: response.status, headers: response.headers });
  }

  const login = await request('/api/login', { data: { user: 'teste', password } });
  assert.equal(login.status, 200);
  const owner = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/')).status, 200);
  assert.equal((await request('/fotos/produto-059.jpg')).status, 200);
  assert.equal((await request('/api/painel/pedidos')).status, 401);

  const email = 'cliente@example.test';
  const checkout = await request('/api/pedidos', { data: {
    customer: 'Cliente de teste', cpf: '529.982.247-25', email, pin: '0463', whatsapp: '(48) 99999-9999',
    address: { cep: '88000-000', street: 'Rua de Teste', number: '123', district: 'Centro', city: 'Florianópolis', uf: 'SC' },
    requestId: randomBytes(16).toString('hex'), items: [{ id: 1, quantity: 2 }, { id: 8, quantity: 1 }], total: 1,
  } });
  assert.equal(checkout.status, 202);
  assert.deepEqual(await (await request('/api/painel/pedidos', { cookie: owner })).json(), []);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, email);
  const token = messages[0].body.match(/\/confirmar-email#([a-f0-9]{64})/)?.[1];
  assert.ok(token);
  assert.equal((await request('/confirmar-email')).status, 200);

  const confirmed = await request('/api/cliente/confirmar', { data: { token } });
  assert.equal(confirmed.status, 200);
  const { order } = await confirmed.json();
  assert.equal(order.total, 57000);
  assert.equal((await request('/api/cliente/confirmar', { data: { token } })).status, 400);
  assert.equal((await request(`/api/cliente/pedidos/${order.id}`)).status, 401);

  const clientLogin = await request('/api/cliente/entrar', { data: { email, pin: '0463' } });
  assert.equal(clientLogin.status, 200);
  const customer = clientLogin.headers.get('set-cookie').split(';')[0];
  const orders = await (await request('/api/cliente/pedidos', { cookie: customer })).json();
  assert.deepEqual(orders.map(({ id, total }) => ({ id, total })), [{ id: order.id, total: 57000 }]);
  assert.equal((await (await request('/api/painel/novos', { cookie: owner })).json()).count, 1);
  const detail = await request(`/api/painel/pedidos/${order.id}/abrir`, { data: {}, cookie: owner });
  assert.equal(detail.status, 200);
  const opened = await detail.json();
  assert.equal(opened.address.street, 'Rua de Teste');
  assert.equal(opened.cpf, undefined);
  assert.equal((await (await request('/api/painel/novos', { cookie: owner })).json()).count, 0);
  assert.equal((await request(`/painel/imprimir/${order.id}`, { cookie: owner })).status, 200);

  const shipment = await request(`/api/painel/pedidos/${order.id}/status`, {
    cookie: owner, data: { status: 'enviado', carrier: 'Transportadora de teste', tracking: 'TESTE123' },
  });
  assert.equal(shipment.status, 200);
  assert.equal((await shipment.json()).mail_status, 'sent');
  assert.equal(messages.length, 2);
  assert.equal(messages[1].to, email);
  assert.match(messages[1].body, /TESTE123/);
});
