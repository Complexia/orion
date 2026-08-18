export const grokSessionModeForAccessMode = (accessMode) => {
  if (accessMode === 'read-only' || accessMode === 'workspace-write') return 'default';
  return null;
};

export const grokPermissionModeForAccessMode = (accessMode) => {
  if (accessMode === 'read-only') return 'default';
  if (accessMode === 'workspace-write') return 'acceptEdits';
  return null;
};
