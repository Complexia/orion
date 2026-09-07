export const isPdfFilePath = (filePath: string | null | undefined) =>
  Boolean(filePath && /\.pdf$/i.test(filePath));

export const isVideoFilePath = (filePath: string | null | undefined) =>
  Boolean(filePath && /\.(mp4|webm|mov|m4v|ogv|mkv|avi)$/i.test(filePath));

export const isPreviewFilePath = (filePath: string | null | undefined) =>
  isPdfFilePath(filePath) || isVideoFilePath(filePath);

// Explorer paths are literal filesystem paths, not encoded Markdown URLs.
export const codeFilePreviewSrc = (filePath: string, revision = 0) =>
  `orion-attachment://local/media?path=${encodeURIComponent(filePath)}&revision=${revision}`;
