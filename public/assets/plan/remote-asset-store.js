// Talks to the small PHP upload API (public/api/uploads.php) for
// source-image storage. The API base is computed from `import.meta.url`
// rather than a hard-coded absolute path, so this keeps working regardless
// of what subdirectory PlanTrace is mounted under (see README "Serving
// PlanTrace from a subdirectory") — nothing here needs to know
// APP_BASE_PATH; the browser already resolved this module's own URL
// relative to wherever the page was served from.
const API_BASE = new URL('../../api/', import.meta.url);

function uploadsUrl(id = '') {
  return new URL(`uploads/${id}`, API_BASE).href;
}

/**
 * @param {Blob} blob
 * @param {{filename?:string, width?:number, height?:number}} meta
 * @returns {Promise<{id:string,url:string,filename:string,mimeType:string,size:number,width:number,height:number}>}
 */
export async function uploadAsset(blob, meta = {}) {
  const form = new FormData();
  form.append('file', blob, meta.filename || 'upload');
  if (meta.width) form.append('width', String(Math.round(meta.width)));
  if (meta.height) form.append('height', String(Math.round(meta.height)));

  let res;
  try {
    res = await fetch(uploadsUrl(), { method: 'POST', body: form });
  } catch {
    throw new Error('Could not reach the upload server. Check that PlanTrace\'s PHP server is running.');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.id) {
    throw new Error(body?.message || `Upload failed (HTTP ${res.status}).`);
  }
  return body;
}

/** @returns {Promise<{blob:Blob, filename:string, mimeType:string, width:number, height:number}>} */
export async function fetchAsset(id) {
  let res;
  try {
    res = await fetch(uploadsUrl(id));
  } catch {
    throw new Error('Could not reach the upload server. Check that PlanTrace\'s PHP server is running.');
  }
  if (!res.ok) {
    if (res.status === 404) throw new Error('That uploaded file no longer exists on the server.');
    throw new Error(`Could not load the uploaded file (HTTP ${res.status}).`);
  }
  const blob = await res.blob();
  return {
    blob,
    filename: decodeURIComponent(res.headers.get('X-Upload-Filename') || ''),
    mimeType: res.headers.get('Content-Type') || blob.type,
    width: Number(res.headers.get('X-Upload-Width') || 0),
    height: Number(res.headers.get('X-Upload-Height') || 0),
  };
}

export async function deleteAsset(id) {
  try {
    await fetch(uploadsUrl(id), { method: 'DELETE' });
  } catch {
    // Best-effort — an unreachable server on cleanup shouldn't block the UI
    // action (e.g. deleting a sheet) that triggered this.
  }
}
