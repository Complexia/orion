import React from 'react';
import { type ImageAttachment } from '../store';

export const imageFileNamePattern = /\.(apng|avif|gif|jpe?g|png|svg|webp)$/i;
export const videoFileNamePattern = /\.(mp4|webm|mov|m4v|ogv|mkv|avi)(?:[?#]|$)/i;

export const isImageFile = (file: File) =>
  file.type.startsWith('image/') || imageFileNamePattern.test(file.name);

export const isVideoFile = (file: File) =>
  file.type.startsWith('video/') || videoFileNamePattern.test(file.name);

// Models that accept image input can generally interpret video too, so any
// image-capable model gets both — same behavior as the codex desktop app.
export const isMediaFile = (file: File) => isImageFile(file) || isVideoFile(file);

export const formatAttachmentSize = (size: number) => {
  if (!Number.isFinite(size) || size <= 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

export const imageAttachmentSrc = (attachment: ImageAttachment) => {
  if (/^(blob|data|orion-attachment):/i.test(attachment.path)) return attachment.path;

  const normalizedPath = attachment.path.replace(/\\/g, '/');
  return `orion-attachment://local/image?path=${encodeURIComponent(normalizedPath)}`;
};

export const isVideoAttachment = (attachment: ImageAttachment) =>
  attachment.mimeType.startsWith('video/') ||
  videoFileNamePattern.test(attachment.name) ||
  videoFileNamePattern.test(attachment.path);

// Small still-frame preview used in the composer, queued messages, and
// message history — branches <video> vs <img> the same way MarkdownMedia does.
export const AttachmentThumb: React.FC<{ attachment: ImageAttachment }> = ({ attachment }) =>
  isVideoAttachment(attachment) ? (
    <video src={imageAttachmentSrc(attachment)} muted preload="metadata" />
  ) : (
    <img src={imageAttachmentSrc(attachment)} alt={attachment.name} />
  );

export const isLocalFilePath = (src: string) =>
  src.startsWith('/') || src.startsWith('~/') || /^[a-zA-Z]:[\\/]/.test(src);

// Markdown percent-encodes e.g. spaces in urls; decode so the value can be
// used as a filesystem path, but tolerate raw `%` characters in filenames.
export const decodeMediaPath = (value: string) => {
  if (!/%[0-9a-f]{2}/i.test(value)) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

// Turn a media src an agent emitted in markdown (absolute path, ~ path,
// file:// URL, or relative path) into a URL the renderer is allowed to load
// via the orion-attachment protocol. Relative paths produce one candidate per
// base dir; the protocol handler serves the first candidate that exists.
export const localMediaSrc = (src: string, baseDirs: string[]) => {
  const toProtocolUrl = (paths: string[]) =>
    `orion-attachment://local/media?${paths
      .map((p) => `path=${encodeURIComponent(p.replace(/\\/g, '/'))}`)
      .join('&')}`;

  if (/^file:\/\//i.test(src)) {
    try {
      const url = new URL(src);
      let pathname = decodeMediaPath(url.pathname);
      if (/^\/[A-Za-z]:/.test(pathname)) {
        // Windows drive path: file:///C:/Users/... parses to "/C:/Users/..."
        // and the leading slash breaks path resolution — strip it.
        pathname = pathname.slice(1);
      } else if (url.hostname && url.hostname !== 'localhost') {
        // UNC path: file://server/share/... keeps its host as a UNC prefix.
        pathname = `//${url.hostname}${pathname}`;
      }
      return toProtocolUrl([pathname]);
    } catch {
      return toProtocolUrl([decodeMediaPath(src.replace(/^file:\/\//i, ''))]);
    }
  }
  if (isLocalFilePath(src)) return toProtocolUrl([decodeMediaPath(src)]);
  if (baseDirs.length === 0) return src;
  const relativePath = decodeMediaPath(src);
  return toProtocolUrl(baseDirs.map((dir) => `${dir.replace(/[\\/]+$/, '')}/${relativePath}`));
};

export const buildPromptWithAttachments = (prompt: string, attachments: ImageAttachment[]) => {
  const trimmedPrompt = prompt.trim();
  if (attachments.length === 0) return trimmedPrompt;

  const mediaLines = attachments.map(
    (attachment, index) => `${index + 1}. ${attachment.name}: ${attachment.path}`
  );
  const hasVideo = attachments.some(isVideoAttachment);
  const hasImage = attachments.some((attachment) => !isVideoAttachment(attachment));
  const label = hasVideo && hasImage ? 'media files' : hasVideo ? 'videos' : 'images';
  const attachmentText = [
    `Attached ${label}:`,
    `Use these local file paths as visual references for the request.`,
    ...mediaLines,
  ].join('\n');

  return trimmedPrompt ? `${trimmedPrompt}\n\n${attachmentText}` : attachmentText;
};

export const getDroppedFilePath = (file: File) => {
  const bridgePath = window.orion?.getPathForFile?.(file);
  if (bridgePath) return bridgePath;

  const legacyPath = (file as File & { path?: string }).path;
  return typeof legacyPath === 'string' && legacyPath.length > 0 ? legacyPath : '';
};
