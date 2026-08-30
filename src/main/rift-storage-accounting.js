import fs from 'node:fs/promises';
import path from 'node:path';

const isSameOrNestedPath = (candidate, parent) => {
  const relative = path.relative(parent, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
};

// A single-project Epic persists its repository row at the same path as the
// Epic workspace. Only distinct paths are children of a shared workspace;
// treating the same path as both parent and child overwrites the parent owner
// and makes the whole Rift disappear from Storage.
export const isRiftRepositoryChildPath = (workspaceRiftPath, repositoryRiftPath) =>
  typeof workspaceRiftPath === 'string' &&
  Boolean(workspaceRiftPath) &&
  typeof repositoryRiftPath === 'string' &&
  Boolean(repositoryRiftPath) &&
  path.resolve(workspaceRiftPath) !== path.resolve(repositoryRiftPath);

// Shared-workspace sizing counts real child directories but deliberately does
// not follow symlinks. An expanded legacy Rift keeps its original repository
// outside the markerless workspace, so it must be measured separately before
// that size is folded into the parent row.
export const isRiftRepositoryIncludedInWorkspaceSize = (riftPath, owner) => {
  if (
    !owner?.repositoryChild ||
    typeof owner.workspaceRiftPath !== 'string' ||
    !owner.workspaceRiftPath
  ) {
    return false;
  }
  return path.dirname(path.resolve(riftPath)) === path.resolve(owner.workspaceRiftPath);
};

// If a legacy shared parent disappears, its symlink cannot be resolved again.
// Persisted repository metadata still identifies the one supported external
// shape: a Rift outside the parent with a link path that was an immediate child
// of that exact workspace. Callers must additionally require a safe Rift path
// and a live `.rift` marker before removal.
export const isExternalRiftLinkedFromWorkspace = (workspacePath, repository) => {
  if (
    typeof workspacePath !== 'string' ||
    !workspacePath ||
    typeof repository?.riftPath !== 'string' ||
    !repository.riftPath ||
    typeof repository.workspaceLinkPath !== 'string' ||
    !repository.workspaceLinkPath
  ) {
    return false;
  }
  const resolvedWorkspace = path.resolve(workspacePath);
  const resolvedRepository = path.resolve(repository.riftPath);
  const resolvedLink = path.resolve(repository.workspaceLinkPath);
  const relativeRepository = path.relative(resolvedWorkspace, resolvedRepository);
  const repositoryIsInsideWorkspace =
    Boolean(relativeRepository) &&
    !path.isAbsolute(relativeRepository) &&
    relativeRepository !== '..' &&
    !relativeRepository.startsWith(`..${path.sep}`);
  return !repositoryIsInsideWorkspace && path.dirname(resolvedLink) === resolvedWorkspace;
};

// Storage exposes one releasable row per owned workspace. Real repository
// children are already counted by the parent directory, while an expanded
// legacy Rift's external repository is measured separately and folded into
// that same parent row. If the markerless parent disappeared, synthesize its
// row from the durable external-link metadata so cleanup still routes through
// the Epic owner rather than publishing the child as an orphan.
export const planRiftStorageEntries = (discovered, owners, pathExists) => {
  const discoveredPaths = new Set(
    discovered.map(({ riftPath }) => path.resolve(riftPath))
  );
  const visibleRifts = [];
  const externalSizePathsByWorkspace = new Map();
  const syntheticWorkspacePaths = new Set();

  for (const entry of discovered) {
    const riftPath = path.resolve(entry.riftPath);
    const owner = owners.get(riftPath) ?? owners.get(entry.riftPath);
    if (
      !owner?.repositoryChild ||
      typeof owner.workspaceRiftPath !== 'string' ||
      !owner.workspaceRiftPath
    ) {
      visibleRifts.push({ ...entry, riftPath });
      continue;
    }

    const workspaceRiftPath = path.resolve(owner.workspaceRiftPath);
    const includedInWorkspace = isRiftRepositoryIncludedInWorkspaceSize(riftPath, owner);
    const workspaceExists = pathExists(workspaceRiftPath);
    const persistedExternalLink = isExternalRiftLinkedFromWorkspace(workspaceRiftPath, {
      riftPath,
      workspaceLinkPath: owner.workspaceLinkPath,
    });

    if (!workspaceExists && !persistedExternalLink) {
      visibleRifts.push({ ...entry, riftPath });
      continue;
    }

    if (!includedInWorkspace) {
      const sizePaths = externalSizePathsByWorkspace.get(workspaceRiftPath) ?? [];
      if (!sizePaths.includes(riftPath)) sizePaths.push(riftPath);
      externalSizePathsByWorkspace.set(workspaceRiftPath, sizePaths);
    }

    if (
      !workspaceExists &&
      persistedExternalLink &&
      !discoveredPaths.has(workspaceRiftPath) &&
      !syntheticWorkspacePaths.has(workspaceRiftPath)
    ) {
      visibleRifts.push({
        riftPath: workspaceRiftPath,
        riftRoot: path.dirname(workspaceRiftPath),
      });
      syntheticWorkspacePaths.add(workspaceRiftPath);
    }
  }

  return { visibleRifts, externalSizePathsByWorkspace };
};

// A known `.trash` parent subsumes the individual child rows returned by
// Rift's registry. Collapse them before measuring so the same parked Rift is
// not counted twice.
export const collapseNestedPaths = (paths) => {
  const candidates = [
    ...new Set(
      paths.flatMap((value) =>
        typeof value === 'string' && value ? [path.resolve(value)] : []
      )
    ),
  ];
  return candidates.filter(
    (candidate) =>
      !candidates.some(
        (other) => other !== candidate && isSameOrNestedPath(candidate, other)
      )
  );
};

// Free space on the volume holding `target`. Sampling this before and after a
// sweep is the only way to report what was *actually* reclaimed, as opposed to
// the copy-on-write upper bound the per-rift sizes show.
export const readFreeBytes = async (target) => {
  try {
    const stats = await fs.statfs(target);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
};

// Keep one stable sample path per filesystem. A cleanup can touch several
// mounted volumes, and sampling only the first path silently drops every other
// volume from the reclaimed-space result.
export const readVolumeFreeSpace = async (targets) => {
  const volumes = new Map();
  for (const target of new Set(targets)) {
    try {
      const stat = await fs.stat(target);
      const volumeId = String(stat.dev);
      if (volumes.has(volumeId)) continue;
      const freeBytes = await readFreeBytes(target);
      if (freeBytes != null) volumes.set(volumeId, { path: target, freeBytes });
    } catch {}
  }
  return volumes;
};

export const reclaimedBytesAcrossVolumes = (before, after) => {
  if (before.size === 0) return null;
  let reclaimedBytes = 0;
  for (const [volumeId, beforeSample] of before) {
    const afterSample = after.get(volumeId);
    if (!afterSample) return null;
    reclaimedBytes += Math.max(0, afterSample.freeBytes - beforeSample.freeBytes);
  }
  return reclaimedBytes;
};
