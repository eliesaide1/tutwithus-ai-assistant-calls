import { useEffect, useState } from 'react';
import type { TutorProfileDisplay } from '../realtime-connection';

type Props = {
  profiles: TutorProfileDisplay[];
  onImageError: (fullName: string) => void;
};

export function AP_TutorCarousel({ profiles, onImageError }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [rotationKey, setRotationKey] = useState(0);

  useEffect(() => {
    if (profiles.length < 2) return;
    const timer = window.setTimeout(
      () => setActiveIndex((current) => (current + 1) % profiles.length),
      3_000,
    );
    return () => window.clearTimeout(timer);
  }, [activeIndex, profiles.length, rotationKey]);

  if (profiles.length === 0) return null;
  const move = (direction: number) => {
    setActiveIndex(
      (current) => (current + direction + profiles.length) % profiles.length,
    );
    setRotationKey((current) => current + 1);
  };

  return (
    <section
      aria-label="Tutor profiles"
      aria-roledescription="carousel"
      className="ap-tutor-carousel"
      onPointerDown={(event) => {
        event.currentTarget.dataset.pointerStart = String(event.clientX);
      }}
      onPointerUp={(event) => {
        const start = Number(event.currentTarget.dataset.pointerStart);
        const distance = event.clientX - start;
        if (Number.isFinite(start) && Math.abs(distance) >= 35) {
          move(distance > 0 ? -1 : 1);
        }
        delete event.currentTarget.dataset.pointerStart;
      }}
    >
      <div className="ap-tutor-carousel__viewport">
        <div
          className="ap-tutor-carousel__track"
          style={{ transform: `translateX(-${activeIndex * 100}%)` }}
        >
          {profiles.map((profile, index) => (
            <article
              aria-hidden={index !== activeIndex}
              className="ap-tutor-carousel__card"
              key={`${profile.fullName}:${profile.profilePic}`}
            >
              <img
                alt={profile.fullName}
                onError={() => onImageError(profile.fullName)}
                src={profile.profilePic}
              />
              <strong>{profile.fullName}</strong>
            </article>
          ))}
        </div>
      </div>
      {profiles.length > 1 && (
        <>
          <button
            aria-label="Previous tutor"
            className="ap-tutor-carousel__arrow ap-tutor-carousel__arrow--previous"
            onClick={() => move(-1)}
            type="button"
          >
            ‹
          </button>
          <button
            aria-label="Next tutor"
            className="ap-tutor-carousel__arrow ap-tutor-carousel__arrow--next"
            onClick={() => move(1)}
            type="button"
          >
            ›
          </button>
          <div className="ap-tutor-carousel__dots" aria-hidden="true">
            {profiles.map((profile, index) => (
              <span
                className={index === activeIndex ? 'is-active' : undefined}
                key={profile.fullName}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
