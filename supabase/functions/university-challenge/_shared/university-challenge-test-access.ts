export function verifyChallengeTestToken(provided: unknown, configured: unknown): boolean {
  if (typeof configured !== 'string' || configured.length < 32 || configured.length > 512) return false;
  if (typeof provided !== 'string' || provided.length !== configured.length) return false;
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(configured);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
