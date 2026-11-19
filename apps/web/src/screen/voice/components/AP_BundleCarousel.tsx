import { useState } from 'react';
import type { Locale } from '../../../shared/i18n';
import type { BundleCarouselDisplay } from '../realtime-connection';

type Props = {
  carousel: BundleCarouselDisplay;
  locale: Locale;
  variant?: 'default' | 'orb';
};

const labels = {
  en: {
    options: 'Bundle options for',
    oneToOne: 'Live one-to-one',
    group: 'Live group',
    sessions: 'sessions',
    total: 'Total price',
    perSession: 'per session',
    previous: 'Previous bundle',
    next: 'Next bundle',
    edition: 'Choose a session edition',
    familyPosition: (current: number, total: number) =>
      `Bundle ${current} of ${total}`,
  },
  fr: {
    options: 'Forfaits pour',
    oneToOne: 'Cours individuel en direct',
    group: 'Cours collectif en direct',
    sessions: 'séances',
    total: 'Prix total',
    perSession: 'par séance',
    previous: 'Forfait précédent',
    next: 'Forfait suivant',
    edition: 'Choisir un nombre de séances',
    familyPosition: (current: number, total: number) =>
      `Forfait ${current} sur ${total}`,
  },
  'ar-SA': {
    options: 'خيارات الباقات لـ',
    oneToOne: 'جلسات فردية مباشرة',
    group: 'جلسات جماعية مباشرة',
    sessions: 'جلسات',
    total: 'السعر الإجمالي',
    perSession: 'لكل جلسة',
    previous: 'الباقة السابقة',
    next: 'الباقة التالية',
    edition: 'اختر عدد الجلسات',
    familyPosition: (current: number, total: number) =>
      `الباقة ${current} من ${total}`,
  },
} satisfies Record<Locale, object>;

function initialFamilyIndex(carousel: BundleCarouselDisplay): number {
  const index = carousel.families.findIndex(
    (family) => family.id === carousel.activeFamilyId,
  );
  return index < 0 ? 0 : index;
}

export function AP_BundleCarousel({
  carousel,
  locale,
  variant = 'default',
}: Props) {
  const copy = labels[locale];
  const [familyIndex, setFamilyIndex] = useState(() =>
    initialFamilyIndex(carousel),
  );
  const [editionIndex, setEditionIndex] = useState(0);
  const family = carousel.families[familyIndex] ?? carousel.families[0];
  if (!family) return null;
  const edition = family.editions[editionIndex] ?? family.editions[0];
  if (!edition) return null;
  const money = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: edition.currency,
    maximumFractionDigits: 2,
  });

  const move = (step: number) => {
    setFamilyIndex((current) => {
      const next =
        (current + step + carousel.families.length) % carousel.families.length;
      return next;
    });
    setEditionIndex(0);
  };

  return (
    <article
      className={`ap-bundle-carousel${variant === 'orb' ? ' ap-bundle-carousel--orb' : ''}`}
      aria-live="polite"
    >
      <header className="ap-bundle-carousel__header">
        <div>
          <p className="ap-bundle-carousel__eyebrow">
            {copy.options} {carousel.subjectName}
          </p>
          <p className="ap-bundle-carousel__position">
            {copy.familyPosition(familyIndex + 1, carousel.families.length)}
          </p>
        </div>
        {carousel.families.length > 1 && (
          <div className="ap-bundle-carousel__arrows">
            <button
              aria-label={copy.previous}
              onClick={() => move(-1)}
              type="button"
            >
              ‹
            </button>
            <button
              aria-label={copy.next}
              onClick={() => move(1)}
              type="button"
            >
              ›
            </button>
          </div>
        )}
      </header>

      <div className="ap-bundle-carousel__title-row">
        <h2>{family.name}</h2>
        <span>
          {family.deliveryMode === 'group' ? copy.group : copy.oneToOne}
        </span>
      </div>

      <div
        aria-label={copy.edition}
        className="ap-bundle-carousel__editions"
        role="tablist"
      >
        {family.editions.map((candidate, index) => (
          <button
            aria-selected={candidate.id === edition.id}
            className={candidate.id === edition.id ? 'is-active' : undefined}
            key={candidate.id}
            onClick={() => setEditionIndex(index)}
            role="tab"
            type="button"
          >
            <strong>{candidate.sessions}</strong> {copy.sessions}
          </button>
        ))}
      </div>

      <div className="ap-bundle-carousel__price" role="tabpanel">
        <p>{copy.total}</p>
        <strong>{money.format(edition.totalPrice)}</strong>
        <span>
          {money.format(edition.pricePerSession)} {copy.perSession}
        </span>
      </div>

      {carousel.families.length > 1 && (
        <div className="ap-bundle-carousel__dots" aria-hidden="true">
          {carousel.families.map((candidate, index) => (
            <span
              className={index === familyIndex ? 'is-active' : undefined}
              key={candidate.id}
            />
          ))}
        </div>
      )}
    </article>
  );
}
