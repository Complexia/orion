export const isPdfFilePath = (filePath: string | null | undefined) =>
  Boolean(filePath && /\.pdf$/i.test(filePath));
