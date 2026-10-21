// DOM helpers. Text always goes in through textContent; no markup string is ever parsed, so event text
// (evidence detail, model code and explanation, stderr) cannot become elements or attributes.

export function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function append(parent, ...children) {
  for (const child of children) if (child) parent.append(child);
  return parent;
}

// Ids built from event ids (ev-7) stay inside a safe alphabet.
export const safeId = value => String(value).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60);

export const sleepFor = (ms, signal) => new Promise(resolve => {
  if (ms <= 0) return resolve();
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});
