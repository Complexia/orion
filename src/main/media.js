import path from 'node:path';

export const imageExtensionsByMimeType = {
  'image/apng': '.apng',
  'image/avif': '.avif',
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/svg+xml': '.svg',
  'image/webp': '.webp',
};
export const imageMimeTypeByExtension = Object.fromEntries(
  Object.entries(imageExtensionsByMimeType).map(([mimeType, ext]) => [ext, mimeType])
);

export const videoMimeTypeByExtension = {
  '.avi': 'video/x-msvideo',
  '.m4v': 'video/x-m4v',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.ogv': 'video/ogg',
  '.webm': 'video/webm',
};

// Media the renderer may load from arbitrary local paths (agent-referenced
// images/videos in markdown), beyond files saved in the attachment dir.
export const mediaMimeTypeByExtension = {
  ...imageMimeTypeByExtension,
  '.jpeg': 'image/jpeg',
  ...videoMimeTypeByExtension,
};
export const mediaPreviewExtensions = new Set(Object.keys(mediaMimeTypeByExtension));

export const getMimeTypeForMediaPath = (filePath) =>
  mediaMimeTypeByExtension[path.extname(filePath).toLowerCase()] || 'application/octet-stream';

export const videoExtensionsByMimeType = Object.fromEntries(
  Object.entries(videoMimeTypeByExtension).map(([ext, mimeType]) => [mimeType, ext])
);

export const extensionFromMediaInput = (name, mimeType) => {
  const normalizedMimeType = String(mimeType || '').toLowerCase();
  const fromMime =
    imageExtensionsByMimeType[normalizedMimeType] || videoExtensionsByMimeType[normalizedMimeType];
  if (fromMime) return fromMime;

  const ext = path.extname(String(name || '')).toLowerCase();
  if (/^\.(apng|avif|gif|jpe?g|png|svg|webp|mp4|webm|mov|m4v|ogv|mkv|avi)$/.test(ext)) return ext;
  return normalizedMimeType.startsWith('video/') ? '.mp4' : '.png';
};

export const sanitizeAttachmentName = (name) => {
  const baseName = path.basename(String(name || 'image')).replace(/[^\w.-]+/g, '-');
  const trimmed = baseName.replace(/^-+|-+$/g, '');
  return trimmed || 'image';
};
