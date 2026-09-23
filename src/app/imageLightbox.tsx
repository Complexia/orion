import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { create } from 'zustand';

/**
 * Full-screen viewer for images rendered inline in the transcript (markdown
 * images agents emit, image attachments on messages). Clicking any image
 * marked with `data-lightbox` opens it; when the image sits inside a
 * `data-lightbox-scope` container, the other marked images in that container
 * (in document order) become a gallery navigable with the arrow keys.
 */

export type LightboxImage = { src: string; alt: string };

type LightboxState = {
  images: LightboxImage[];
  index: number;
  open: (images: LightboxImage[], index: number) => void;
  close: () => void;
  step: (delta: number) => void;
};

/** Wraps `index + delta` into `[0, count)`; a single image never moves. */
export const stepLightboxIndex = (index: number, delta: number, count: number) => {
  if (count <= 1) return 0;
  return (((index + delta) % count) + count) % count;
};

/**
 * Gallery for a clicked image: every lightbox image inside the nearest scope,
 * in document order, with the clicked one's position. Images outside any scope
 * (composer previews, for example) open alone.
 */
export const collectLightboxGallery = (target: HTMLImageElement) => {
  const scope = target.closest('[data-lightbox-scope]');
  const elements = scope
    ? (Array.from(scope.querySelectorAll('img[data-lightbox]')) as HTMLImageElement[])
    : [target];
  const images = elements.map((element) => ({
    src: element.currentSrc || element.src,
    alt: element.alt || element.title || '',
  }));
  const index = Math.max(0, elements.indexOf(target));
  return { images, index };
};

export const useImageLightbox = create<LightboxState>((set) => ({
  images: [],
  index: 0,
  open: (images, index) => set({ images, index }),
  close: () => set({ images: [], index: 0 }),
  step: (delta) =>
    set((state) => ({ index: stepLightboxIndex(state.index, delta, state.images.length) })),
}));

export const openImageLightbox = (target: HTMLImageElement) => {
  const { images, index } = collectLightboxGallery(target);
  if (images.length === 0) return;
  useImageLightbox.getState().open(images, index);
};

/** Click handler for inline images: expands the clicked image in the viewer. */
export const handleLightboxImageClick = (event: React.MouseEvent<HTMLImageElement>) => {
  event.preventDefault();
  event.stopPropagation();
  openImageLightbox(event.currentTarget);
};

export const ImageLightbox: React.FC = () => {
  const images = useImageLightbox((state) => state.images);
  const index = useImageLightbox((state) => state.index);
  const close = useImageLightbox((state) => state.close);
  const step = useImageLightbox((state) => state.step);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // Actual-size mode: the image renders at its natural pixel size inside a
  // scrollable stage instead of being fitted to the viewport.
  const [actualSize, setActualSize] = useState(false);
  const [canZoom, setCanZoom] = useState(false);

  const isOpen = images.length > 0;
  const current = images[index];
  const hasMany = images.length > 1;

  useEffect(() => {
    if (!isOpen) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (hasMany && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        event.stopPropagation();
        step(event.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    // Capture phase so the viewer wins over the transcript's own Escape and
    // arrow-key handlers while it is open.
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      restoreFocusRef.current?.focus?.();
      restoreFocusRef.current = null;
    };
  }, [isOpen, hasMany, close, step]);

  // Switching images always returns to the fitted view.
  useEffect(() => {
    setActualSize(false);
    setCanZoom(false);
  }, [current?.src]);

  const handleImageLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    setCanZoom(image.naturalWidth > image.clientWidth || image.naturalHeight > image.clientHeight);
  }, []);

  if (!isOpen || !current) return null;

  return createPortal(
    <div
      ref={dialogRef}
      className="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={current.alt || 'Image viewer'}
      tabIndex={-1}
      onClick={close}
    >
      <div className="image-lightbox-toolbar" onClick={(event) => event.stopPropagation()}>
        <span className="image-lightbox-caption" title={current.alt}>
          {current.alt}
        </span>
        {hasMany && (
          <span className="image-lightbox-counter">
            {index + 1} / {images.length}
          </span>
        )}
        <button
          type="button"
          className="image-lightbox-btn"
          aria-label="Close image viewer"
          title="Close (Esc)"
          onClick={close}
        >
          <X size={18} />
        </button>
      </div>

      {hasMany && (
        <button
          type="button"
          className="image-lightbox-btn image-lightbox-nav image-lightbox-nav-prev"
          aria-label="Previous image"
          title="Previous (←)"
          onClick={(event) => {
            event.stopPropagation();
            step(-1);
          }}
        >
          <ChevronLeft size={22} />
        </button>
      )}

      <div className={`image-lightbox-stage${actualSize ? ' actual-size' : ''}`}>
        <img
          key={current.src}
          className={`image-lightbox-image${canZoom ? (actualSize ? ' zoomed' : ' zoomable') : ''}`}
          src={current.src}
          alt={current.alt}
          draggable={false}
          onLoad={handleImageLoad}
          onClick={(event) => {
            event.stopPropagation();
            if (canZoom) setActualSize((value) => !value);
          }}
        />
      </div>

      {hasMany && (
        <button
          type="button"
          className="image-lightbox-btn image-lightbox-nav image-lightbox-nav-next"
          aria-label="Next image"
          title="Next (→)"
          onClick={(event) => {
            event.stopPropagation();
            step(1);
          }}
        >
          <ChevronRight size={22} />
        </button>
      )}
    </div>,
    document.body
  );
};
