import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { orderDatabase } from './banco.js';
import { customerAuth } from './clientes.js';
import { HttpError } from './http.js';
import { orderRepository } from './pedidos.js';
import { PRODUCT_COUNT } from './public/catalogo.js';

const { ADMIN_USER, ADMIN_PASSWORD, SECURE_COOKIE, HOST, PORT } = process.env;
if (!ADMIN_USER?.trim() || ADMIN_USER.trim().length > 100 ||
  !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12 || ADMIN_PASSWORD.length > 256) {
  throw new Error('Defina ADMIN_USER (até 100 caracteres) e ADMIN_PASSWORD (12 a 256 caracteres) no arquivo .env.');
}

const query = await orderDatabase();
const orders = orderRepository(query);
const customers = customerAuth(query);

const sessions = new Map();
const attempts = new Map();
const sessionDuration = 8 * 60 * 60 * 1000;
const attemptWindow = 15 * 60 * 1000;
const sessionCookie = `; Path=/; HttpOnly; SameSite=Strict${SECURE_COOKIE === 'true' ? '; Secure' : ''}`;
const digest = value => createHash('sha256').update(value).digest();
const adminUser = digest(ADMIN_USER.trim());
const adminPassword = digest(ADMIN_PASSWORD);

setInterval(() => {
  const now = Date.now();
  for (const [key, expires] of sessions) if (expires <= now) sessions.delete(key);
  for (const [key, attempt] of attempts) if (attempt.expires <= now) attempts.delete(key);
}, 60_000).unref();

function json(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new HttpError(415, 'Envie os dados em formato JSON.');
  }
  if (request.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Origem inválida.');
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 16_384) throw new HttpError(413, 'Dados do pedido muito grandes.');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new HttpError(400, 'Dados inválidos.');
  }
}

function sessionToken(request) {
  return request.headers.cookie?.match(/(?:^|;\s*)leva_session=([a-f0-9]{64})(?:;|$)/)?.[1];
}

function signedIn(request) {
  return sessions.get(sessionToken(request)) > Date.now();
}

function login(request, response, body) {
  const address = request.socket.remoteAddress;
  const now = Date.now();
  let attempt = attempts.get(address);
  if (!attempt || attempt.expires <= now) attempt = { count: 0, expires: now + attemptWindow };
  if (attempt.count >= 8) throw new HttpError(429, 'Muitas tentativas. Aguarde 15 minutos.');

  const validUser = typeof body.user === 'string' && timingSafeEqual(digest(body.user.trim()), adminUser);
  const validPassword = typeof body.password === 'string' && timingSafeEqual(digest(body.password), adminPassword);
  if (!validUser || !validPassword) {
    attempt.count++;
    attempts.set(address, attempt);
    throw new HttpError(401, 'Usuário ou senha incorretos.');
  }

  attempts.delete(address);
  sessions.delete(sessionToken(request));
  const token = randomBytes(32).toString('hex');
  sessions.set(token, now + sessionDuration);
  response.setHeader('Set-Cookie', `leva_session=${token}; Max-Age=${sessionDuration / 1000}${sessionCookie}`);
}

const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/painel', ['painel.html', 'text/html; charset=utf-8']],
  ['/meus-pedidos', ['meus-pedidos.html', 'text/html; charset=utf-8']],
  ['/confirmar-email', ['confirmar-email.html', 'text/html; charset=utf-8']],
  ['/estilos.css', ['estilos.css', 'text/css; charset=utf-8']],
  ...['catalogo', 'loja', 'painel', 'interface', 'conta', 'meus-pedidos', 'confirmar-email', 'pedido-ui'].map(name => [`/${name}.js`, [`${name}.js`, 'text/javascript; charset=utf-8']]),
]);

function orderNumber(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1 || id > 2_147_483_647) throw new HttpError(404, 'Pedido não encontrado.');
  return id;
}

const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'");

  try {
    const { pathname: path } = new URL(request.url, 'http://localhost');
    const { method } = request;
    if (method === 'POST' && path === '/api/pedidos') {
      return json(response, 202, await customers.checkout(request, await readJson(request)));
    }
    if (method === 'GET' && path === '/api/cliente/sessao') return json(response, 200, await customers.profile(request));
    if (method === 'POST' && path === '/api/cliente/recuperar') {
      return json(response, 200, await customers.requestReset(request, await readJson(request)));
    }
    if (method === 'POST' && path === '/api/cliente/verificar-link') {
      return json(response, 200, await customers.confirmationKind((await readJson(request)).token));
    }
    if (method === 'POST' && path === '/api/cliente/confirmar') {
      return json(response, 200, await customers.confirm(request, response, await readJson(request)));
    }
    if (method === 'POST' && path === '/api/cliente/entrar') {
      return json(response, 200, await customers.login(request, response, await readJson(request)));
    }
    if (method === 'POST' && path === '/api/cliente/sair') {
      await readJson(request);
      await customers.logout(request, response);
      return json(response, 200, { ok: true });
    }
    const myOrders = path.match(/^\/api\/cliente\/pedidos(?:\/(\d+))?$/);
    if (method === 'GET' && myOrders) {
      const email = await customers.email(request);
      if (!email) throw new HttpError(401, 'Entre com seu e-mail para consultar seus pedidos.');
      return json(response, 200, await orders.forCustomer(email, myOrders[1] ? orderNumber(myOrders[1]) : undefined));
    }
    if (method === 'POST' && path === '/api/login') {
      login(request, response, await readJson(request));
      return json(response, 200, { ok: true });
    }

    const orderApi = path.match(/^\/api\/painel\/pedidos\/(\d+)(?:\/(abrir|status|reenviar-email))?$/);
    if (path === '/api/painel/pedidos' || path === '/api/painel/novos' || path === '/api/logout' || orderApi) {
      if (!signedIn(request)) throw new HttpError(401, 'Entre no painel para continuar.');
      if (method === 'POST' && path === '/api/logout') {
        await readJson(request);
        sessions.delete(sessionToken(request));
        response.setHeader('Set-Cookie', `leva_session=; Max-Age=0${sessionCookie}`);
        return json(response, 200, { ok: true });
      }
      if (method === 'GET' && path === '/api/painel/pedidos') return json(response, 200, await orders.forOwner());
      if (method === 'GET' && path === '/api/painel/novos') return json(response, 200, await orders.unread());
      if (orderApi) {
        const id = orderNumber(orderApi[1]);
        const action = orderApi[2];
        if (method === 'GET' && !action) return json(response, 200, await orders.detail(id, false));
        if (method === 'POST' && action) {
          const body = await readJson(request);
          if (action === 'abrir') return json(response, 200, await orders.detail(id, true));
          if (action === 'status') return json(response, 200, await orders.changeStatus(id, body));
          return json(response, 200, await orders.trackingMail(id));
        }
      }
    }

    const printPage = /^\/painel\/imprimir\/\d+$/.test(path);
    if (printPage && !signedIn(request)) {
      response.writeHead(303, { Location: '/painel' });
      return response.end();
    }
    const photo = path.match(/^\/fotos\/(produto-(\d{3})\.jpg)$/);
    let asset = staticFiles.get(printPage ? '/painel' : path);
    if (photo && Number(photo[2]) >= 1 && Number(photo[2]) <= PRODUCT_COUNT) {
      asset = [`fotos/${photo[1]}`, 'image/jpeg'];
    }
    if (asset && (method === 'GET' || method === 'HEAD')) {
      const contents = await readFile(new URL(`./public/${asset[0]}`, import.meta.url));
      response.writeHead(200, {
        'Content-Type': asset[1], 'Content-Length': contents.length,
        'Cache-Control': photo ? 'public, max-age=86400' : 'no-store',
      });
      return response.end(method === 'HEAD' ? undefined : contents);
    }

    throw new HttpError(404, 'Página não encontrada.');
  } catch (error) {
    if (error instanceof HttpError) return json(response, error.status, { error: error.message });
    console.error('Falha ao atender solicitação:', error.code || error.name);
    return json(response, 500, { error: 'O servidor encontrou um problema. Tente novamente.' });
  }
});

server.listen(Number(PORT || 3000), HOST || '127.0.0.1', () => {
  console.log(`Cosmético Leva em http://${HOST || '127.0.0.1'}:${server.address().port}`);
});
