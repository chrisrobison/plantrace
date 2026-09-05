// Adapter boundary between "a File the user dropped in" and "pixels the
// workspace can render." Every sheet import goes through here so the rest
// of the app never has to know or care what the original container format
// was. Raster formats (JPG/PNG/WebP) are fully supported today; PDF is
// wired up to the same boundary but intentionally stubbed rather than
// pulling in a PDF-rendering dependency for this phase (see the project
// brief: "if PDF rasterization cannot be implemented without a significant
// dependency, implement the upload and adapter boundary, show a useful
// explanation, and fully support raster images").
export const MAX_FILE_SIZE = 60 * 1024 * 1024; // 60MB
export const ACCEPTED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const ACCEPT_ATTR = '.jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf';

const PDF_MESSAGE = 'PDF rasterization is not implemented in this build. Export the page you need as a PNG or JPG — most PDF viewers offer "Export as image" or "Print to image" — and import that instead. The upload and adapter boundary already exist here so a real PDF renderer can be dropped in later without touching the rest of the app.';

const imageAdapter = {
  supported: true,
  message: '',
  /** @returns {Promise<{blob: Blob, width: number, height: number}>} */
  async decode(file) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new Error('This image could not be decoded. It may be corrupt, truncated, or in an unsupported format.');
    }
    const { width, height } = bitmap;
    bitmap.close?.();
    return { blob: file, width, height };
  },
};

const pdfAdapter = {
  supported: false,
  message: PDF_MESSAGE,
  async decode() { throw new Error(PDF_MESSAGE); },
};

function unsupportedAdapter(mimeType) {
  const message = `Unsupported file type${mimeType ? ` (${mimeType})` : ''}. Import a JPG, PNG, WebP, or PDF.`;
  return { supported: false, message, async decode() { throw new Error(message); } };
}

export function getSourceAdapter(mimeType) {
  if (mimeType === 'application/pdf') return pdfAdapter;
  if (mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/webp') return imageAdapter;
  return unsupportedAdapter(mimeType);
}

/** Validate a File against size/type limits before it ever reaches an adapter. */
export function validateFile(file) {
  if (!file) return { ok: false, message: 'No file selected.' };
  if (file.size > MAX_FILE_SIZE) return { ok: false, message: `File is too large (${Math.round(file.size / 1024 / 1024)}MB). The limit is ${MAX_FILE_SIZE / 1024 / 1024}MB.` };
  if (!ACCEPTED_MIME.includes(file.type)) return { ok: false, message: `Unsupported file type: ${file.type || 'unknown'}. Import a JPG, PNG, WebP, or PDF.` };
  return { ok: true, message: '' };
}
