import { useEffect, useRef } from 'react';

type AP_VoiceOrbCanvasProps = {
  state: 'idle' | 'connecting' | 'listening' | 'speaking';
};

type Particle = {
  latitude: number;
  longitude: number;
  size: number;
  phase: number;
};

const particles: Particle[] = Array.from({ length: 960 }, (_, index) => {
  const y = 1 - (index / 959) * 2;
  const latitude = Math.asin(y);

  return {
    latitude,
    longitude: index * Math.PI * (3 - Math.sqrt(5)),
    size: index % 11 === 0 ? 1.5 : 0.65 + ((index * 7) % 5) * 0.12,
    phase: index * 2.399,
  };
});

export function AP_VoiceOrbCanvas({ state }: AP_VoiceOrbCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) {
      console.error('The voice orb could not initialize its canvas.');
      return;
    }

    let width = 0;
    let height = 0;
    let frameId = 0;
    let disposed = false;
    let lastFrameAt = 0;
    const motionPreference = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    );
    const shouldAnimate =
      !motionPreference?.matches &&
      (state === 'connecting' || state === 'speaking');

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      width = bounds.width;
      height = bounds.height;
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    };

    const paint = (time: number) => {
      if (disposed || width === 0 || height === 0) {
        return;
      }

      if (shouldAnimate && time - lastFrameAt < 30) {
        frameId = window.requestAnimationFrame(paint);
        return;
      }
      lastFrameAt = time;

      const rawLevel = Number.parseFloat(
        canvas.parentElement?.style.getPropertyValue('--ap-level') ?? '0',
      );
      const level = Number.isFinite(rawLevel)
        ? Math.min(1, Math.max(0, rawLevel))
        : 0;
      const speaking = state === 'speaking';
      const rotation =
        state === 'connecting'
          ? time * 0.00016
          : speaking
            ? time * 0.00011
            : 0.42;
      const breath = speaking ? Math.sin(time * 0.004) * (1.5 + level * 4) : 0;
      const centerX = width / 2;
      const centerY = height / 2;
      const radius = Math.min(width, height) * 0.37 + breath;

      context.clearRect(0, 0, width, height);

      const pointAt = (latitude: number, longitude: number) => {
        const turnedLongitude = longitude + rotation;
        const baseRadius = Math.cos(latitude);
        const depth = baseRadius * Math.cos(turnedLongitude);
        const wave =
          Math.sin(latitude * 5 + turnedLongitude * 3 + time * 0.001) * 0.035 +
          Math.sin(latitude * 8 - turnedLongitude * 4 - time * 0.0007) * 0.022 +
          Math.cos(turnedLongitude * 7 + latitude * 2 + time * 0.0012) * 0.018;
        const deformation = speaking
          ? wave * (0.25 + level * 0.75)
          : wave * 0.2;
        const localRadius = radius * (1 + deformation);

        return {
          x: centerX + baseRadius * Math.sin(turnedLongitude) * localRadius,
          y: centerY + Math.sin(latitude) * localRadius,
          depth,
        };
      };

      context.save();
      context.globalCompositeOperation = 'source-over';
      context.shadowBlur = Math.min(9, width / 30);
      particles.forEach((particle) => {
        const point = pointAt(particle.latitude, particle.longitude);
        if (point.depth < -0.12) {
          return;
        }

        const twinkle = speaking
          ? 0.7 + Math.sin(time * 0.004 + particle.phase) * 0.3
          : 0.82;
        const opacity = Math.min(
          0.96,
          (0.42 + (point.depth + 1) * 0.27) * twinkle,
        );
        const horizontalPosition = point.x / width;
        const color =
          horizontalPosition < 0.38
            ? '39, 160, 255'
            : horizontalPosition < 0.68
              ? '117, 91, 255'
              : '218, 59, 255';
        context.shadowColor = `rgba(${color}, ${opacity})`;
        context.beginPath();
        context.arc(
          point.x,
          point.y,
          particle.size * (0.8 + point.depth * 0.2) * (1 + level * 0.35),
          0,
          Math.PI * 2,
        );
        context.fillStyle = `rgba(${color}, ${opacity})`;
        context.fill();
      });

      for (let index = 0; index < 90; index += 1) {
        const x = ((index * 97.31) % 997) / 997;
        const y = ((index * 271.73) % 991) / 991;
        const distance = Math.hypot(x - 0.5, y - 0.5);
        if (distance < 0.32 || distance > 0.49) {
          continue;
        }
        context.beginPath();
        context.arc(
          x * width,
          y * height,
          index % 13 === 0 ? 1.05 : 0.55,
          0,
          Math.PI * 2,
        );
        context.fillStyle =
          index % 2 === 0
            ? 'rgba(91, 174, 255, 0.55)'
            : 'rgba(221, 100, 255, 0.5)';
        context.fill();
      }
      context.restore();

      if (shouldAnimate) {
        frameId = window.requestAnimationFrame(paint);
      }
    };

    resize();
    paint(0);

    const handleResize = () => {
      resize();
      if (!shouldAnimate) {
        paint(0);
      }
    };
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(handleResize);
    if (observer) {
      observer.observe(canvas);
    } else {
      window.addEventListener('resize', handleResize);
    }

    if (shouldAnimate) {
      frameId = window.requestAnimationFrame(paint);
    }

    return () => {
      disposed = true;
      observer?.disconnect();
      window.removeEventListener('resize', handleResize);
      window.cancelAnimationFrame(frameId);
    };
  }, [state]);

  return (
    <canvas
      aria-hidden="true"
      className="ap-sound-orb__canvas"
      ref={canvasRef}
    />
  );
}
