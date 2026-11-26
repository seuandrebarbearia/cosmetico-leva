import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { normalizeCpf, normalizeEmail } from './dados-cliente.js';
import { HttpError } from './http.js';
import { sendMail } from './mail.js';
import { checkoutData, orderRepository } from './pedidos.js';

const derive = promisify(scrypt);
const cookieOptions = `; Path=/; HttpOnly; SameSite=Strict${process.env.SECURE_COOKIE === 'true' ? '; Secure' : ''}`;
const sessionSeconds = 8 * 60 * 60;
const linkSeconds = 30 * 60;
const epoch = () => Math.floor(Date.now() / 1000);
const hash = token => createHash('sha256').update(token).digest('hex');
const invalidLink = () => new HttpError(400, 'Este link expirou ou já foi usado. Confira Meus pedidos ou solicite um novo link.');
const tokenFrom = request => request.headers.cookie?.match(/(?:^|;\s*)leva_cliente=([a-f0-9]{64})(?:;|$)/)?.[1];

function validatedPin(pin) {
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) throw new HttpError(400, 'Informe uma senha de quatro dígitos.');
  return pin;
}

function tokenHash(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw invalidLink();
  return hash(token);
}

function publicOrigin(request) {
  if (!process.env.APP_PUBLIC_URL) return `http://127.0.0.1:${request.socket.localPort}`;
  const url = new URL(process.env.APP_PUBLIC_URL);
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.username || url.password || url.search || url.hash ||
      (process.env.SECURE_COOKIE === 'true' && url.protocol !== 'https:')) {
    throw new Error('Configure APP_PUBLIC_URL com a origem da loja.');
  }
  return url.origin;
}

export function customerAuth(query) {
  const secret = process.env.CUSTOMER_PIN_SECRET;
  if (!secret || secret.length < 32) throw new Error('Defina CUSTOMER_PIN_SECRET com pelo menos 32 caracteres aleatórios.');
  if (process.env.SECURE_COOKIE === 'true' && !process.env.APP_PUBLIC_URL) throw new Error('Defina APP_PUBLIC_URL para os links de confirmação.');
  if (process.env.APP_PUBLIC_URL) publicOrigin();

  const ipLimits = new Map();
  const pinDigest = (email, pin, salt) => derive(createHmac('sha256', secret).update(`${email}:${pin}`).digest(), salt, 32);
  const cleanup = setInterval(async () => {
    const now = epoch();
    for (const [key, limit] of ipLimits) if (limit.until <= now) ipLimits.delete(key);
    try {
      await query('DELETE FROM sessoes_cliente WHERE expires_at <= ?', now);
      await query('DELETE FROM confirmacoes_cliente WHERE expires_at <= ?', now);
      await query('DELETE FROM tentativas_cliente WHERE expires_at <= ?', now);
    } catch (error) {
      console.warn('Limpeza de sessões indisponível:', error.code || error.name);
    }
  }, 10 * 60_000);
  cleanup.unref();

  function limitIp(request, action, max) {
    const key = `${action}:${request.socket.remoteAddress}`;
    const now = epoch();
    let limit = ipLimits.get(key);
    if (!limit || limit.until <= now) {
      limit = { until: now + 900, count: 0 };
      ipLimits.set(key, limit);
    }
    if (++limit.count > max) throw new HttpError(429, 'Muitas tentativas. Aguarde 15 minutos.');
  }

  async function makePin(email, pin) {
    const salt = randomBytes(16).toString('hex');
    const digest = await pinDigest(email, validatedPin(pin), salt);
    return `${salt}:${digest.toString('hex')}`;
  }

  async function checkPin(request, email, pin, saved) {
    limitIp(request, 'pin', 40);
    const value = validatedPin(pin);
    const now = epoch();
    const [attempt] = await query(`INSERT INTO tentativas_cliente (email, attempts, expires_at) VALUES (?, 1, ?)
      ON CONFLICT (email) DO UPDATE SET
      attempts = CASE WHEN tentativas_cliente.expires_at <= ? THEN 1 ELSE tentativas_cliente.attempts + 1 END,
      expires_at = CASE WHEN tentativas_cliente.expires_at <= ? THEN excluded.expires_at ELSE tentativas_cliente.expires_at END
      WHERE tentativas_cliente.expires_at <= ? OR tentativas_cliente.attempts < 5 RETURNING attempts`, email, now + 900, now, now, now);
    if (!attempt) throw new HttpError(429, 'Muitas tentativas para este e-mail. Aguarde 15 minutos.');
    const [salt, expected] = (saved || `${'0'.repeat(32)}:${'0'.repeat(64)}`).split(':');
    const digest = await pinDigest(email, value, salt);
    if (!saved || !timingSafeEqual(digest, Buffer.from(expected, 'hex'))) {
      throw new HttpError(401, 'E-mail ou senha incorretos. Se for seu primeiro acesso, use Criar ou recuperar senha.');
    }
    await query('DELETE FROM tentativas_cliente WHERE email = ?', email);
  }

  async function createSession(run, request, email) {
    const previous = tokenFrom(request);
    if (previous) await run('DELETE FROM sessoes_cliente WHERE token_hash = ?', hash(previous));
    const token = randomBytes(32).toString('hex');
    await run('INSERT INTO sessoes_cliente (token_hash, email, expires_at) VALUES (?, ?, ?)', hash(token), email, epoch() + sessionSeconds);
    return token;
  }

  function setSession(response, token) {
    response.setHeader('Set-Cookie', `leva_cliente=${token}${cookieOptions}`);
  }

  async function sessionEmail(request) {
    const token = tokenFrom(request);
    if (!token) return null;
    const [session] = await query('SELECT email FROM sessoes_cliente WHERE token_hash = ? AND expires_at > ?', hash(token), epoch());
    return session?.email || null;
  }

  async function sendLink(request, email, kind, payload) {
    const token = randomBytes(32).toString('hex');
    const digest = hash(token);
    const now = epoch();
    const link = `${publicOrigin(request)}/confirmar-email#${token}`;
    const [pending] = await query(`INSERT INTO confirmacoes_cliente (token_hash, email, kind, payload, expires_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT (email, kind) DO UPDATE SET token_hash = excluded.token_hash,
      payload = excluded.payload, expires_at = excluded.expires_at
      WHERE confirmacoes_cliente.expires_at <= ? RETURNING token_hash`,
    digest, email, kind, payload, now + linkSeconds, now + linkSeconds - 60);
    if (!pending) throw new HttpError(429, 'Aguarde um minuto antes de solicitar outro link.');
    try {
      const action = kind === 'pedido' ? 'Confirme seu e-mail e seu pedido' : 'Crie ou altere sua senha';
      await sendMail(email, `${action} | Cosmético Leva`, `${action} no link abaixo. Ele é válido por 30 minutos.\n\n${link}\n\nSe você não fez esta solicitação, ignore este e-mail.`);
    } catch (error) {
      await query('DELETE FROM confirmacoes_cliente WHERE token_hash = ?', digest);
      console.warn('Envio do link indisponível:', error.code || error.name);
      throw new HttpError(503, 'O link não pôde ser enviado. Tente novamente mais tarde.');
    }
  }

  return {
    email: sessionEmail,
    async profile(request) {
      const email = await sessionEmail(request);
      if (!email) return { email: null, hasCpf: false, hasPin: false };
      const [account] = await query('SELECT pin_hash, cpf FROM clientes WHERE email = ?', email);
      return { email, hasCpf: Boolean(account?.cpf), hasPin: Boolean(account?.pin_hash) };
    },
    async login(request, response, body) {
      const email = normalizeEmail(body.email);
      const [account] = await query('SELECT pin_hash FROM clientes WHERE email = ?', email);
      await checkPin(request, email, body.pin, account?.pin_hash);
      setSession(response, await createSession(query, request, email));
      return { email };
    },
    async checkout(request, body) {
      limitIp(request, 'checkout', 25);
      const email = normalizeEmail(body.email);
      const order = checkoutData(body, email);
      const signedIn = await sessionEmail(request) === email;
      const [account] = await query('SELECT pin_hash, cpf FROM clientes WHERE email = ?', email);
      const cpf = signedIn && account?.cpf ? null : normalizeCpf(body.cpf);
      let pin = null;
      if (!account?.pin_hash) pin = await makePin(email, body.pin);
      else if (!signedIn) await checkPin(request, email, body.pin, account.pin_hash);
      await sendLink(request, email, 'pedido', JSON.stringify({ order, cpf, pin }));
      return { email };
    },
    async requestReset(request, body) {
      limitIp(request, 'reset', 15);
      const email = normalizeEmail(body.email);
      const [account] = await query('SELECT email FROM clientes WHERE email = ?', email);
      if (account) {
        try { await sendLink(request, email, 'senha', null); }
        catch (error) { if (error.status !== 429) throw error; }
      }
      return { ok: true };
    },
    async confirmationKind(token) {
      const [pending] = await query('SELECT kind FROM confirmacoes_cliente WHERE token_hash = ? AND expires_at > ?', tokenHash(token), epoch());
      if (!pending) throw invalidLink();
      return { kind: pending.kind };
    },
    async confirm(request, response, body) {
      limitIp(request, 'confirm', 30);
      const digest = tokenHash(body.token);
      const [pending] = await query('SELECT email, kind FROM confirmacoes_cliente WHERE token_hash = ? AND expires_at > ?', digest, epoch());
      if (!pending) throw invalidLink();
      const newPin = pending.kind === 'senha' ? await makePin(pending.email, body.pin) : null;
      const result = await query.transaction(async run => {
        const [confirmed] = await run(`DELETE FROM confirmacoes_cliente WHERE token_hash = ? AND expires_at > ?
          RETURNING kind, email, payload`, digest, epoch());
        if (!confirmed) throw invalidLink();
        const { email } = confirmed;
        let purchase = null;
        if (confirmed.kind === 'senha') {
          await run('UPDATE clientes SET pin_hash = ? WHERE email = ?', newPin, email);
          await run('DELETE FROM sessoes_cliente WHERE email = ?', email);
          await run('DELETE FROM tentativas_cliente WHERE email = ?', email);
        } else {
          const { order, cpf, pin } = JSON.parse(confirmed.payload);
          await run(`INSERT INTO clientes (email, cpf, pin_hash) VALUES (?, ?, ?) ON CONFLICT (email) DO UPDATE
            SET cpf = COALESCE(clientes.cpf, excluded.cpf), pin_hash = COALESCE(clientes.pin_hash, excluded.pin_hash)`, email, cpf, pin);
          purchase = { ...await orderRepository(run).create(order, email), requestId: order.requestId };
        }
        return { email, purchase, session: await createSession(run, request, email) };
      });
      setSession(response, result.session);
      return { email: result.email, order: result.purchase };
    },
    async logout(request, response) {
      const token = tokenFrom(request);
      if (token) await query('DELETE FROM sessoes_cliente WHERE token_hash = ?', hash(token));
      response.setHeader('Set-Cookie', `leva_cliente=; Max-Age=0${cookieOptions}`);
    },
  };
}
