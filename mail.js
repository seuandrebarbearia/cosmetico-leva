import nodemailer from 'nodemailer';

const { SMTP_URL, MAIL_FROM } = process.env;
let transport;
if (SMTP_URL && MAIL_FROM) {
  const url = new URL(SMTP_URL);
  if (!['smtp:', 'smtps:'].includes(url.protocol)) throw new Error('Use smtp:// ou smtps:// em SMTP_URL.');
  const secure = url.protocol === 'smtps:';
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.username;
  transport = nodemailer.createTransport({
    host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || (secure ? 465 : 587)), secure,
    requireTLS: !secure && !local,
    auth: url.username ? { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) } : undefined,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
  });
}

export async function sendMail(to, subject, text) {
  if (!transport) throw new Error('SMTP não configurado');
  const result = await transport.sendMail({ from: MAIL_FROM, to, subject, text });
  if (!result.accepted.length) throw new Error('Destinatário recusado');
}
