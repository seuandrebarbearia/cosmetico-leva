export const UNIT_PRICE = 19000;
export const PRODUCT_COUNT = 59;

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo',
});

export const money = cents => currency.format(cents / 100);
export const dateLabel = isoDate => dateTime.format(new Date(isoDate));
export const productRef = id => `Produto ${String(id).padStart(3, '0')}`;
export const productPhoto = id => `/fotos/produto-${String(id).padStart(3, '0')}.jpg`;
export const orderRef = id => `#${String(id).padStart(5, '0')}`;
