import { z } from 'zod';

const RemoteSipHeadersSchema = z.object({
  headers: z.record(z.string(), z.string()),
});

const WACID_PATTERN = /^wacid\.[a-z0-9._-]{1,250}$/i;

export function getMetaWhatsAppCallId(rpcResponse: string): string | undefined {
  const parsed = RemoteSipHeadersSchema.safeParse(JSON.parse(rpcResponse));
  if (!parsed.success) {
    return undefined;
  }

  const header = Object.entries(parsed.data.headers).find(
    ([name]) => name.toLowerCase() === 'x-wa-meta-wacid',
  )?.[1];
  if (!header) {
    return undefined;
  }

  const callId = header.trim();
  return WACID_PATTERN.test(callId) ? callId : undefined;
}
