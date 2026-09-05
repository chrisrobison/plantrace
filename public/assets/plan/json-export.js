// Portable JSON backup: the whole normalized document, downloadable and
// re-importable. This is the format PlanDocumentStore.importDocument()
// validates/normalizes on the way back in, so a round trip can never
// silently corrupt editor state even if the file was hand-edited.
export function downloadProjectJSON(doc) {
  const json = JSON.stringify(doc, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(doc.project?.name || 'plantrace-project').replace(/[^a-z0-9-_]+/gi, '_')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** @returns {Promise<Object>} parsed JSON — throws a readable error on bad JSON. */
export async function readProjectJSONFile(file) {
  const text = await file.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`"${file.name}" is not valid JSON.`);
  }
}
