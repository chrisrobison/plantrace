// Bakes a sheet's nondestructive rotation + crop into a derived raster blob.
// The ORIGINAL uploaded file is never touched or overwritten — this always
// starts from it fresh — but geometry is authored in world coordinates that
// must match what's on screen, so rotation/crop (unlike brightness/contrast/
// grayscale/opacity, which are cheap live CSS filters) need to actually
// change the pixel grid the workspace measures against. A canvas bake is the
// simplest way to get that pixel-perfect without a bundler/dependency.
function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function canvasToBlob(canvas) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: 'image/png' });
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))), 'image/png'));
}

/**
 * @param {Blob} blob original source image
 * @param {{rotation:number, crop:?{x:number,y:number,w:number,h:number}}} prep
 * @returns {Promise<{blob:Blob, width:number, height:number}>}
 */
export async function bakePreparedRaster(blob, prep) {
  const bitmap = await createImageBitmap(blob);
  const rotation = ((prep.rotation || 0) % 360 + 360) % 360;
  const swapped = rotation === 90 || rotation === 270;
  const rw = swapped ? bitmap.height : bitmap.width;
  const rh = swapped ? bitmap.width : bitmap.height;

  const rotatedCanvas = makeCanvas(rw, rh);
  const rctx = rotatedCanvas.getContext('2d');
  rctx.translate(rw / 2, rh / 2);
  rctx.rotate((rotation * Math.PI) / 180);
  rctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  bitmap.close?.();

  let finalCanvas = rotatedCanvas;
  const crop = prep.crop;
  if (crop && crop.w > 0 && crop.h > 0) {
    const cw = Math.round(Math.min(crop.w, rw - crop.x));
    const ch = Math.round(Math.min(crop.h, rh - crop.y));
    const croppedCanvas = makeCanvas(cw, ch);
    croppedCanvas.getContext('2d').drawImage(rotatedCanvas, crop.x, crop.y, cw, ch, 0, 0, cw, ch);
    finalCanvas = croppedCanvas;
  }

  const outBlob = await canvasToBlob(finalCanvas);
  return { blob: outBlob, width: finalCanvas.width, height: finalCanvas.height };
}

export function cssFilterFor(prep) {
  return `brightness(${prep.brightness}%) contrast(${prep.contrast}%) grayscale(${prep.grayscale}%)`;
}
