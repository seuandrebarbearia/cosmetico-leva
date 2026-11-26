export function element(tag, label, className) {
  const node = document.createElement(tag);
  if (label !== undefined) node.textContent = label;
  if (className) node.className = className;
  return node;
}

export async function api(path, data) {
  const response = await fetch(path, data === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export function setError(node, error) {
  node.textContent = error?.status ? error.message : error ? 'Não foi possível conectar. Tente novamente.' : '';
  node.hidden = !error;
}
