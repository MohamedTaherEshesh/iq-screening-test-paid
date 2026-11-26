// OMS-MND-261126-03: answer options are shuffled per exam. The order is derived from the session id and
// the question code, so it is the same every time that exam is resumed, and needs no extra storage.
// order[k] = index in the bank's option list that is shown at position k.
export function optionOrder(sessionId: string, itemCode: string, n = 4): number[] {
  let h = 2166136261;
  for (const ch of sessionId + '|' + itemCode) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const rand = () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  return order;
}
export function shuffledOptions<T>(options: T[], order: number[]): T[] {
  return Array.isArray(options) && options.length === order.length ? order.map(i => options[i]) : options;
}
// Position of the correct answer after shuffling.
export function shownCorrectIndex(bankCorrect: number, order: number[]): number {
  return order.length ? order.indexOf(bankCorrect) : bankCorrect;
}
