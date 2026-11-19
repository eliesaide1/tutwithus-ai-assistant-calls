import { describe, expect, it } from 'vitest';
import { getMetaWhatsAppCallId } from './meta-whatsapp-call-id.js';

describe('getMetaWhatsAppCallId', () => {
  it('finds the Meta WACID from SIP headers without depending on header casing', () => {
    expect(
      getMetaWhatsAppCallId(
        JSON.stringify({
          headers: {
            'X-WA-Meta-WACID': 'wacid.ABGGFjFVU2AfAgo6V-Hc5eCgK5Gh',
          },
        }),
      ),
    ).toBe('wacid.ABGGFjFVU2AfAgo6V-Hc5eCgK5Gh');
  });

  it('returns undefined when the header is absent or not a WACID', () => {
    expect(getMetaWhatsAppCallId('{"headers":{"x-other":"value"}}')).toBe(
      undefined,
    );
    expect(
      getMetaWhatsAppCallId('{"headers":{"x-wa-meta-wacid":"untrusted"}}'),
    ).toBe(undefined);
  });

  it('rejects malformed RPC payloads', () => {
    expect(() => getMetaWhatsAppCallId('not-json')).toThrow();
    expect(getMetaWhatsAppCallId('{"headers":[]}')).toBe(undefined);
  });
});
