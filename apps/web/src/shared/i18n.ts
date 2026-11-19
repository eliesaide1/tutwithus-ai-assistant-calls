import arSA from './locales/ar-SA.json';
import en from './locales/en.json';
import fr from './locales/fr.json';

export const messages = {
  'ar-SA': arSA,
  en,
  fr,
} as const;

export type Locale = keyof typeof messages;

export const localeOptions: { code: Locale }[] = [
  { code: 'ar-SA' },
  { code: 'en' },
  { code: 'fr' },
];

export function getDirection(locale: Locale): 'ltr' | 'rtl' {
  return locale === 'ar-SA' ? 'rtl' : 'ltr';
}
