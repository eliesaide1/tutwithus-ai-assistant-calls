import { describe, expect, it } from 'vitest';
import {
  canonicalPhone,
  phoneMatchKey,
  phonesMatch,
} from './customer-directory.js';

describe('phone matching', () => {
  it('treats common Saudi formats as equal', () => {
    for (const format of [
      '+966 50 000 0001',
      '+966500000001',
      '00966500000001',
      '0500000001',
      '966500000001',
      '500000001',
      '966-50-000-0001',
      '(0500) 000-001',
    ]) {
      expect(canonicalPhone(format)).toBe('966500000001');
    }
    expect(phonesMatch('0500000001', '+966 50 000 0001')).toBe(true);
  });

  it('does not match different or cross-country numbers', () => {
    expect(phonesMatch('0500000001', '0500000002')).toBe(false);
    expect(phonesMatch('+971500000001', '+966500000001')).toBe(false);
    expect(phonesMatch('+971500000001', '0500000001')).toBe(false);
    expect(phonesMatch('+971500000001', '+971 50 000 0001')).toBe(true);
    expect(phonesMatch('0500000001', '+971500000001', '971')).toBe(true);
  });

  it('preserves an international number when the plus sign is omitted', () => {
    expect(canonicalPhone('961 71 999 052')).toBe('96171999052');
    expect(canonicalPhone('971 50 000 0001')).toBe('971500000001');
    expect(phonesMatch('96171999052', '+961 71 999 052')).toBe(true);
  });

  it('rejects invalid numbers and builds the search key', () => {
    expect(canonicalPhone('12345')).toBeUndefined();
    expect(canonicalPhone('+1234567890123456789')).toBeUndefined();
    expect(phoneMatchKey('+966 50 000 0001')).toBe('500000001');
    expect(phoneMatchKey('1234')).toBeUndefined();
  });
});
