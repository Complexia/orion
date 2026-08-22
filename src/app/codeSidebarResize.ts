export const CODE_SIDEBAR_MIN_WIDTH = 240;
export const CODE_SIDEBAR_MAX_WIDTH = 640;
export const CODE_EDITOR_MIN_WIDTH = 320;

export const clampCodeSidebarWidth = (width: number, availableWidth: number) => {
  const availableMaximum = Math.max(CODE_SIDEBAR_MIN_WIDTH, availableWidth - CODE_EDITOR_MIN_WIDTH);
  return Math.round(
    Math.min(
      Math.max(CODE_SIDEBAR_MIN_WIDTH, Math.min(CODE_SIDEBAR_MAX_WIDTH, availableMaximum)),
      Math.max(CODE_SIDEBAR_MIN_WIDTH, width)
    )
  );
};
