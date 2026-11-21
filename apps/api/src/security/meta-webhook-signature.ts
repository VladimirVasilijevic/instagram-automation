import { createHmac, timingSafeEqual } from 'node:crypto';

/** Compares short webhook credentials without a content-dependent early return. */
export const equalWebhookSecrets = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

/** Verifies Meta's SHA-256 signature over the exact webhook delivery bytes. */
export const verifyMetaWebhookSignature = (
  rawBody: Buffer,
  signature: string | undefined,
  appSecret: string,
): boolean => {
  const match = signature?.match(/^sha256=([a-f0-9]{64})$/i);
  if (!match) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const provided = Buffer.from(match[1]!, 'hex');
  return expected.length === provided.length && timingSafeEqual(expected, provided);
};
