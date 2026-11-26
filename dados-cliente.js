import { HttpError } from './http.js';

export function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/i.test(email)) {
    throw new HttpError(400, 'Informe um e-mail válido.');
  }
  return email;
}

export function normalizeCpf(value) {
  const input = typeof value === 'string' ? value.trim() : '';
  const cpf = input.replace(/[.-]/g, '');
  if (!/^(?:\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})$/.test(input) || /^(\d)\1{10}$/.test(cpf)) {
    throw new HttpError(400, 'Informe um CPF válido.');
  }
  for (const length of [9, 10]) {
    const sum = [...cpf.slice(0, length)].reduce((total, digit, index) => total + Number(digit) * (length + 1 - index), 0);
    if ((sum * 10 % 11) % 10 !== Number(cpf[length])) throw new HttpError(400, 'Informe um CPF válido.');
  }
  return cpf;
}
