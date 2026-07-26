/** Hand generated data to the browser as a file download. */
export function downloadBlob(
  data: BlobPart,
  filename: string,
  type = 'application/octet-stream',
): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
