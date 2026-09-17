export const SIDEBAR_MIN_WIDTH = 240;
export const SIDEBAR_MAX_WIDTH = 640;
export const MAIN_PANE_MIN_WIDTH = 320;

/** Keeps a sidebar between its fixed bounds while leaving room for the main pane. */
export const clampSidebarWidth = (width: number, availableWidth: number) => {
  const availableMaximum = Math.max(SIDEBAR_MIN_WIDTH, availableWidth - MAIN_PANE_MIN_WIDTH);
  return Math.round(
    Math.min(
      Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, availableMaximum)),
      Math.max(SIDEBAR_MIN_WIDTH, width)
    )
  );
};
