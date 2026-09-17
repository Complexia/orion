import React, { useCallback, useLayoutEffect, useRef } from 'react';
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, clampSidebarWidth } from './sidebarResize';

const SIDEBAR_DEFAULT_WIDTH = 280;
const RESIZING_CLASS = 'sidebar-resizing';

type UseSidebarResizeOptions = {
  /** localStorage key holding the user's preferred width for this sidebar. */
  storageKey: string;
  /** Accessible name of the region being resized, e.g. "Explorer". */
  label: string;
};

/**
 * Drag-and-keyboard resizing for a `.sidebar` that sits inside `.app-container`.
 * The width is written to the container's `--sidebar-width` custom property so
 * the shell bar and main grid follow it. Attach `sidebarRef` to the sidebar root
 * and render `resizeHandle` as its last child.
 */
export const useSidebarResize = ({ storageKey, label }: UseSidebarResizeOptions) => {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const widthRef = useRef(SIDEBAR_DEFAULT_WIDTH);
  const preferredWidthRef = useRef(SIDEBAR_DEFAULT_WIDTH);
  const pointerIdRef = useRef<number | null>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(SIDEBAR_DEFAULT_WIDTH);

  const applyWidth = useCallback((requestedWidth: number, remember = false) => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const appContainer = sidebar.closest<HTMLElement>('.app-container');
    const availableWidth = sidebar.parentElement?.clientWidth ?? window.innerWidth;
    const preferredWidth = Math.min(
      SIDEBAR_MAX_WIDTH,
      Math.max(SIDEBAR_MIN_WIDTH, Math.round(requestedWidth))
    );
    const nextWidth = clampSidebarWidth(preferredWidth, availableWidth);
    const maximumWidth = clampSidebarWidth(SIDEBAR_MAX_WIDTH, availableWidth);
    if (remember) preferredWidthRef.current = preferredWidth;
    widthRef.current = nextWidth;
    appContainer?.style.setProperty('--sidebar-width', `${nextWidth}px`);
    handleRef.current?.setAttribute('aria-valuenow', String(nextWidth));
    handleRef.current?.setAttribute('aria-valuemax', String(maximumWidth));
  }, []);

  const persistWidth = useCallback(() => {
    try {
      window.localStorage.setItem(storageKey, String(preferredWidthRef.current));
    } catch {
      // A blocked storage backend should not prevent resizing for this session.
    }
  }, [storageKey]);

  useLayoutEffect(() => {
    try {
      const storedWidth = Number(window.localStorage.getItem(storageKey));
      if (Number.isFinite(storedWidth) && storedWidth > 0) {
        preferredWidthRef.current = storedWidth;
      }
    } catch {
      // Use the default width when local storage is unavailable.
    }

    applyWidth(preferredWidthRef.current);
    const handleWindowResize = () => applyWidth(preferredWidthRef.current);
    window.addEventListener('resize', handleWindowResize);

    const appContainer = sidebarRef.current?.closest<HTMLElement>('.app-container');
    return () => {
      window.removeEventListener('resize', handleWindowResize);
      appContainer?.classList.remove(RESIZING_CLASS);
      appContainer?.style.removeProperty('--sidebar-width');
    };
  }, [applyWidth, storageKey]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    pointerIdRef.current = event.pointerId;
    startXRef.current = event.clientX;
    startWidthRef.current = widthRef.current;
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    sidebarRef.current?.closest('.app-container')?.classList.add(RESIZING_CLASS);
    event.preventDefault();
  }, []);

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (pointerIdRef.current !== event.pointerId) return;
      applyWidth(startWidthRef.current + event.clientX - startXRef.current, true);
    },
    [applyWidth]
  );

  const finishResize = useCallback(
    (pointerId: number) => {
      if (pointerIdRef.current !== pointerId) return;
      pointerIdRef.current = null;
      sidebarRef.current?.closest('.app-container')?.classList.remove(RESIZING_CLASS);
      persistWidth();
    },
    [persistWidth]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      const availableWidth = sidebarRef.current?.parentElement?.clientWidth ?? window.innerWidth;
      const maximumWidth = clampSidebarWidth(SIDEBAR_MAX_WIDTH, availableWidth);
      const step = event.shiftKey ? 32 : 10;
      let nextWidth: number | null = null;
      if (event.key === 'ArrowLeft') nextWidth = widthRef.current - step;
      if (event.key === 'ArrowRight') nextWidth = widthRef.current + step;
      if (event.key === 'Home') nextWidth = SIDEBAR_MIN_WIDTH;
      if (event.key === 'End') nextWidth = maximumWidth;
      if (nextWidth === null) return;
      event.preventDefault();
      applyWidth(nextWidth, true);
      persistWidth();
    },
    [applyWidth, persistWidth]
  );

  const resizeHandle = (
    <button
      type="button"
      ref={handleRef}
      className="sidebar-resize-handle"
      role="separator"
      tabIndex={0}
      aria-label={`Resize ${label}`}
      aria-orientation="vertical"
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      aria-valuenow={SIDEBAR_DEFAULT_WIDTH}
      title={`Drag to resize ${label}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => finishResize(event.pointerId)}
      onPointerCancel={(event) => finishResize(event.pointerId)}
      onLostPointerCapture={(event) => finishResize(event.pointerId)}
      onKeyDown={handleKeyDown}
    />
  );

  return { sidebarRef, resizeHandle };
};
