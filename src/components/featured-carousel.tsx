'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';

const FEATURED_IMAGES = [
  { src: '/item-jacket.jpg', alt: 'Chaqueta marrón sobre una percha', label: 'Chaqueta ligera' },
  { src: '/item-sweatshirt.jpg', alt: 'Sudadera blanca combinada con prendas neutras', label: 'Capas neutras' },
  { src: '/item-jeans.jpg', alt: 'Conjunto urbano con vaqueros negros', label: 'Estilo urbano' },
  { src: '/item-bag.jpg', alt: 'Bolso verde sobre una mesa de mármol', label: 'Acento de color' },
] as const;

export function FeaturedCarousel() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const programmaticTargetRef = useRef<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(
    () => () => {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    },
    [],
  );

  function goTo(index: number) {
    const normalizedIndex = (index + FEATURED_IMAGES.length) % FEATURED_IMAGES.length;
    const viewport = viewportRef.current;
    if (!viewport) return;
    programmaticTargetRef.current = normalizedIndex;
    viewport.scrollTo({ left: viewport.clientWidth * normalizedIndex, behavior: 'smooth' });
    setActiveIndex(normalizedIndex);
  }

  function handleScroll() {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      if (!viewport || viewport.clientWidth === 0) return;
      const programmaticTarget = programmaticTargetRef.current;
      if (programmaticTarget !== null) {
        const targetScrollLeft = viewport.clientWidth * programmaticTarget;
        if (Math.abs(viewport.scrollLeft - targetScrollLeft) > 1) {
          animationFrameRef.current = null;
          return;
        }
        programmaticTargetRef.current = null;
      }
      const nextIndex = Math.min(
        FEATURED_IMAGES.length - 1,
        Math.max(0, Math.round(viewport.scrollLeft / viewport.clientWidth)),
      );
      setActiveIndex(nextIndex);
      animationFrameRef.current = null;
    });
  }

  return (
    <div
      className="mx-auto w-full max-w-md"
      role="region"
      aria-roledescription="carrusel"
      aria-label="Inspiración de prendas"
      data-testid="featured-carousel"
    >
      <div className="group relative">
        <div
          ref={viewportRef}
          onScroll={handleScroll}
          onPointerDown={() => {
            programmaticTargetRef.current = null;
          }}
          onWheel={() => {
            programmaticTargetRef.current = null;
          }}
          className="no-scrollbar flex aspect-square w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-[1.35rem] bg-surface shadow-soft"
        >
          {FEATURED_IMAGES.map((image, index) => (
            <figure
              key={image.src}
              className="relative h-full min-w-full snap-center snap-always overflow-hidden"
              role="group"
              aria-roledescription="diapositiva"
              aria-label={`${index + 1} de ${FEATURED_IMAGES.length}`}
              data-active={index === activeIndex ? 'true' : 'false'}
            >
              <Image
                src={image.src}
                alt={image.alt}
                fill
                priority={index === 0}
                sizes="(max-width: 640px) calc(100vw - 64px), (max-width: 1024px) 448px, 384px"
                className="object-cover"
              />
              <figcaption className="absolute inset-x-3 bottom-3 rounded-full bg-black/55 px-3 py-2 text-center text-xs font-semibold text-white backdrop-blur-sm">
                {image.label}
              </figcaption>
            </figure>
          ))}
        </div>

        <button
          type="button"
          onClick={() => goTo(activeIndex - 1)}
          aria-label="Imagen anterior"
          className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 text-text-primary shadow-soft backdrop-blur transition-colors hover:bg-surface"
        >
          <ChevronLeftIcon size={20} />
        </button>
        <button
          type="button"
          onClick={() => goTo(activeIndex + 1)}
          aria-label="Siguiente imagen"
          className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 text-text-primary shadow-soft backdrop-blur transition-colors hover:bg-surface"
        >
          <ChevronRightIcon size={20} />
        </button>
      </div>

      <div className="mt-3 flex items-center justify-center gap-1" aria-label="Elegir imagen">
        {FEATURED_IMAGES.map((image, index) => (
          <button
            key={image.src}
            type="button"
            onClick={() => goTo(index)}
            aria-label={`Mostrar imagen ${index + 1}`}
            aria-current={index === activeIndex ? 'true' : undefined}
            className="flex h-11 w-11 items-center justify-center rounded-full"
          >
            <span
              className={`block rounded-full transition-all ${
                index === activeIndex ? 'h-2.5 w-6 bg-primary' : 'h-2.5 w-2.5 bg-border'
              }`}
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        Imagen {activeIndex + 1} de {FEATURED_IMAGES.length}
      </p>
    </div>
  );
}
