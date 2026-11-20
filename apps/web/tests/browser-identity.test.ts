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

it('returns a TutWithUs page to go back to and strips it from the URL', async () => {
  vi.resetModules();
  window.history.replaceState(
    null,
    '',
    '/#returnTo=https%3A%2F%2Ftutwithus.com%2Fen%2Fcourses&view=voice',
  );
  const { readReturnTo } = await import('../src/screen/voice/browser-identity');
  expect(readReturnTo()).toBe('https://tutwithus.com/en/courses');
  expect(window.location.href).not.toContain('returnTo');
  expect(window.location.hash).toBe('#view=voice');
});

it('reads the proof and the return page from a single fragment', async () => {
  vi.resetModules();
  window.history.replaceState(
    null,
    '',
    '/#identityProof=proof-1&returnTo=https%3A%2F%2Fwww.tutwithus.com%2Fen',
  );
  const { readBrowserIdentityProof, readReturnTo } =
    await import('../src/screen/voice/browser-identity');
  // Whichever is read first must not strip the other.
  expect(readBrowserIdentityProof()).toBe('proof-1');
  expect(readReturnTo()).toBe('https://www.tutwithus.com/en');
});

it.each([
  ['https://evil.example.com/phish', 'a different host'],
  ['https://tutwithus.com.evil.example/x', 'a lookalike host'],
  ['javascript:alert(1)', 'a script URL'],
  ['http://tutwithus.com/en', 'plain http'],
])('refuses %s as a return page (%s)', async (candidate) => {
  vi.resetModules();
  window.history.replaceState(
    null,
    '',
    `/#returnTo=${encodeURIComponent(candidate)}`,
  );
  const { readReturnTo } = await import('../src/screen/voice/browser-identity');
  expect(readReturnTo()).toBeUndefined();
});
