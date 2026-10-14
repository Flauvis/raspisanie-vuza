export function setText(node: HTMLElement, value: string): void {
  node.textContent = value;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function requireElement<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing_element:${id}`);
  return node as T;
}
