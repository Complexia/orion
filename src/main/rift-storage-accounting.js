import fs from 'node:fs/promises';
import path from 'node:path';

const isSameOrNestedPath = (candidate, parent) => {
  const relative = path.relative(parent, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
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
