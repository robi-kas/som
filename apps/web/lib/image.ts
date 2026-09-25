/**
 * Phone photos are 3–8 MB; the API takes up to 4 MB and slow cafe Wi-Fi hates big uploads.
 * Shrink to at most 1600 px on the long side as JPEG (~200–400 KB): still sharp enough to
 * read a transaction number, and it drops the photo's location data (EXIF) too.
 */
export async function compressPhoto(file: File, maxSide = 1600, quality = 0.82): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('That is not a photo');
  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  } catch {
    // Older Safari: fall back to an <img>.
    bitmap = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not read the photo'));
      img.src = URL.createObjectURL(file);
    });
  }
  const w = bitmap.width;
  const h = bitmap.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if ('close' in bitmap) bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  return blob ?? file;
}
