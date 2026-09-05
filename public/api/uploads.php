<?php

declare(strict_types=1);

/**
 * Upload API for source sheets: JPG/PNG/WebP/PDF in, a small JSON record
 * (with a fetchable URL) out. Required by public/assets/plan/remote-asset-
 * store.js, which is what PlanDocumentStore's ProjectRepository now calls
 * for saveAsset()/loadAsset()/removeAsset() — see docs/ARCHITECTURE.md
 * "Persistence." No database: one file + one metadata sidecar per upload,
 * via src/Http/UploadStore.php.
 *
 * Routed here from public/api/index.php for any /api/uploads[...] path.
 *
 *   POST   /api/uploads       multipart/form-data, field "file" (+ optional
 *                              "width"/"height" the client already knows)
 *                              -> 201 {id, url, filename, mimeType, size, width, height}
 *   GET    /api/uploads/{id}  -> the raw file, with metadata in response headers
 *   DELETE /api/uploads/{id}  -> 204
 */

use PlanTrace\Http\JsonResponse;
use PlanTrace\Http\UploadStore;
use PlanTrace\Support\BasePath;

$fullPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$path = BasePath::stripWeb($fullPath);
$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

if (!preg_match('#^/api/uploads/?([a-zA-Z0-9_]*)$#', $path, $m)) {
    JsonResponse::send(['error' => 'not_found'], 404);
    return;
}
$id = $m[1] !== '' ? $m[1] : null;

if ($method === 'POST' && $id === null) {
    handle_upload();
    return;
}
if ($method === 'GET' && $id !== null) {
    handle_fetch($id);
    return;
}
if ($method === 'DELETE' && $id !== null) {
    handle_delete($id);
    return;
}
JsonResponse::send(['error' => 'method_not_allowed'], 405);
return;

function handle_upload(): void
{
    // If the request body exceeded post_max_size, PHP silently empties both
    // $_FILES and $_POST — this is the only way to detect that and explain
    // it, rather than reporting a confusing generic "no file uploaded."
    $contentLength = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    if (empty($_FILES) && $contentLength > 0) {
        JsonResponse::send([
            'error' => 'payload_too_large',
            'message' => sprintf(
                'The upload (%.1fMB) exceeds this server\'s post_max_size (%s). Ask the server admin to raise it.',
                $contentLength / 1024 / 1024,
                ini_get('post_max_size') ?: 'unknown'
            ),
        ], 413);
        return;
    }
    if (!isset($_FILES['file'])) {
        JsonResponse::send(['error' => 'no_file', 'message' => 'No file was uploaded (expected multipart field "file").'], 400);
        return;
    }

    try {
        $width = isset($_POST['width']) ? (int) $_POST['width'] : 0;
        $height = isset($_POST['height']) ? (int) $_POST['height'] : 0;
        $originalName = (string) ($_FILES['file']['name'] ?? 'upload');
        $meta = UploadStore::save($_FILES['file'], $originalName, $width, $height);
    } catch (\RuntimeException $e) {
        JsonResponse::send(['error' => 'invalid_upload', 'message' => $e->getMessage()], 422);
        return;
    }

    JsonResponse::send([
        'id' => $meta['id'],
        'url' => BasePath::web() . '/api/uploads/' . $meta['id'],
        'filename' => $meta['filename'],
        'mimeType' => $meta['mimeType'],
        'size' => $meta['size'],
        'width' => $meta['width'],
        'height' => $meta['height'],
    ], 201);
}

function handle_fetch(string $id): void
{
    $meta = UploadStore::find($id);
    if ($meta === null) {
        JsonResponse::send(['error' => 'not_found', 'message' => 'Uploaded file not found. It may have been deleted.'], 404);
        return;
    }
    header('Content-Type: ' . $meta['mimeType']);
    header('Content-Length: ' . (string) filesize($meta['path']));
    header('Content-Disposition: inline; filename="' . str_replace('"', '', $meta['filename']) . '"');
    header('Cache-Control: private, max-age=31536000, immutable');
    header('X-Content-Type-Options: nosniff');
    // Small, app-specific metadata channel so the client can avoid a second
    // round trip for filename/dimensions when it fetches the file itself.
    header('X-Upload-Filename: ' . rawurlencode($meta['filename']));
    header('X-Upload-Width: ' . (string) $meta['width']);
    header('X-Upload-Height: ' . (string) $meta['height']);
    readfile($meta['path']);
}

function handle_delete(string $id): void
{
    UploadStore::delete($id);
    http_response_code(204);
}
