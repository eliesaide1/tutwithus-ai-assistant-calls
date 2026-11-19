import { expect, it } from 'vitest';
import { accountAccessPolicy } from './account-access-policy.js';

it('does not confuse missing capability with lost verification', () => {
  const policy = accountAccessPolicy(true, ['search_tutor_profiles']);
  expect(policy).toContain('VERIFIED');
  expect(policy).toContain('Never request verification again');
  expect(policy).toContain('capability limitation');
});

it('keeps protected actions locked for guests', () => {
  const policy = accountAccessPolicy(false, ['search_tutor_profiles']);
  expect(policy).toContain('UNVERIFIED');
  expect(policy).toContain('Do not claim the caller is verified');
  expect(policy).toContain('public tools remain available');
});
