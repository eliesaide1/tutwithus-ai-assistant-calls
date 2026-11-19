import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => window.history.replaceState(null, '', '/'));
it('removes the handoff proof from the URL and keeps it only in module memory', async () => {
  vi.resetModules();
  window.history.replaceState(
    null,
    '',
    '/?language=en#identityProof=test-proof&view=voice',
  );
  const { readBrowserIdentityProof } =
    await import('../src/screen/voice/browser-identity');
  expect(readBrowserIdentityProof()).toBe('test-proof');
  expect(window.location.href).not.toContain('test-proof');
  expect(window.location.hash).toBe('#view=voice');
  expect(readBrowserIdentityProof()).toBe('test-proof');
});
