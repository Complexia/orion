import { ReactNode, UIEventHandler, useLayoutEffect, useRef, useState } from 'react';

// Composer dropdowns (@-mentions, the /review pickers) hang off the composer
// shell and prefer to open upward. A composer full of text can be tall enough
// that there is no room left above it, which used to push the list off the top
// of the window. Measure the anchor against its visible boundary (the pane in a
// split, otherwise the viewport): flip below when there is more space that way,
// and cap the height so every option remains reachable.
const GAP = 8; // matches the popover's offset from the composer in CSS
const VIEWPORT_MARGIN = 12;
const MAX_HEIGHT = 320;

type Layout = { below: boolean; maxHeight: number; hidden: boolean };

export const ComposerPopover = ({
  className = '',
  onScroll,
  children,
}: {
  className?: string;
  onScroll?: UIEventHandler<HTMLDivElement>;
  children: ReactNode;
}) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<Layout>({
    below: false,
    maxHeight: MAX_HEIGHT,
    hidden: false,
  });

  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current;
      // The composer shell is the positioned ancestor the popover hangs off.
      const anchor = el?.offsetParent as HTMLElement | null;
      if (!el || !anchor) return;
      const anchorRect = anchor.getBoundingClientRect();
      const pane = el.closest<HTMLElement>('.thread-pane.split');
      const paneRect = pane?.getBoundingClientRect();
      const boundaryTop = Math.max(
        VIEWPORT_MARGIN,
        paneRect ? paneRect.top + VIEWPORT_MARGIN : VIEWPORT_MARGIN
      );
      const boundaryBottom = Math.min(
        window.innerHeight - VIEWPORT_MARGIN,
        paneRect ? paneRect.bottom - VIEWPORT_MARGIN : window.innerHeight - VIEWPORT_MARGIN
      );
      const spaceAbove = anchorRect.top - GAP - boundaryTop;
      const spaceBelow = boundaryBottom - anchorRect.bottom - GAP;
      const style = window.getComputedStyle(el);
      const borderHeight =
        Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
      const chromeHeight =
        borderHeight +
        Number.parseFloat(style.paddingTop) +
        Number.parseFloat(style.paddingBottom);
      // scrollHeight includes padding but not borders and reports the natural
      // content height even while max-height clips it.
      const wanted = Math.min(el.scrollHeight + borderHeight, MAX_HEIGHT);
      const below = spaceAbove < wanted && spaceBelow > spaceAbove;
      const space = Math.max(0, below ? spaceBelow : spaceAbove);
      const next: Layout = {
        below,
        maxHeight: Math.min(wanted, space),
        hidden: space <= chromeHeight,
      };
      setLayout((prev) =>
        prev.below === next.below &&
        prev.maxHeight === next.maxHeight &&
        prev.hidden === next.hidden
          ? prev
          : next
      );
    };

    measure();
    // Re-measure as the composer grows/shrinks with the draft and as the list
    // itself changes length.
    const observer = new ResizeObserver(measure);
    const el = ref.current;
    if (el) observer.observe(el);
    const anchor = el?.offsetParent as HTMLElement | null;
    if (anchor) observer.observe(anchor);
    const pane = el?.closest<HTMLElement>('.thread-pane.split');
    if (pane) observer.observe(pane);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  return (
    <div
      ref={ref}
      role="listbox"
      className={`mention-popover${layout.below ? ' below' : ''}${className ? ` ${className}` : ''}`}
      style={{ maxHeight: layout.maxHeight, visibility: layout.hidden ? 'hidden' : undefined }}
      onScroll={onScroll}
    >
      {children}
    </div>
  );
};
