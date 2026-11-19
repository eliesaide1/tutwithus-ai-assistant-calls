import mongoose from 'mongoose';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { reserveMemberVerification } from './verification-limit.js';

beforeEach(() => {
  vi.stubEnv('MEMBER_VERIFICATION_SECRET', 's'.repeat(48));
  vi.spyOn(mongoose.models.MemberVerificationLimit!, 'init').mockResolvedValue(
    mongoose.models.MemberVerificationLimit!,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it('shares the phone limit across repeated reservations without storing the number', async () => {
  let attempts = 0;
  const update = vi
    .spyOn(mongoose.models.MemberVerificationLimit!, 'findOneAndUpdate')
    .mockImplementation((() => ({
      lean: async () => ({ attempts: ++attempts }),
    })) as never);
  for (let index = 0; index < 10; index++)
    expect(await reserveMemberVerification('+96170123456')).toBe(true);
  expect(await reserveMemberVerification('+96170123456')).toBe(false);
  expect(JSON.stringify(update.mock.calls)).not.toContain('96170123456');
});
it('fails closed when MongoDB cannot reserve an attempt', async () => {
  vi.spyOn(
    mongoose.models.MemberVerificationLimit!,
    'findOneAndUpdate',
  ).mockImplementation(() => {
    throw new Error('unavailable');
  });
  expect(await reserveMemberVerification('+96170123456')).toBe(false);
});
