<?php

declare(strict_types=1);

/**
 * PlanTrace API shell.
 *
 * Project documents (sheets, geometry, layers, review state) still live in
 * the browser's IndexedDB and travel between machines as portable JSON —
 * see docs/ARCHITECTURE.md "Persistence" and docs/PROJECT-FORMAT.md; there
 * is no server-side database in this phase. Uploaded source images
 * (JPG/PNG/WebP/PDF) are the one thing that DOES live here now, via
 * uploads.php + src/Http/UploadStore.php (filesystem storage, no
 * database) — see docs/ARCHITECTURE.md "File uploads."
 *
 * Path matching goes through BasePath::stripWeb() so this still resolves
 * correctly when the app is mounted under a subdirectory (APP_BASE_PATH in
 * .env) — $_SERVER['REQUEST_URI'] still carries the full, unstripped path
 * even when Apache's .htaccess already routed the request here.
 */

require_once dirname(__DIR__, 2) . '/src/Support/Env.php';
require_once dirname(__DIR__, 2) . '/src/Support/BasePath.php';
require_once PlanTrace\Support\BasePath::root() . '/src/Http/JsonResponse.php';
require_once PlanTrace\Support\BasePath::root() . '/src/Http/UploadStore.php';

use PlanTrace\Http\JsonResponse;
use PlanTrace\Support\BasePath;

$fullPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$path = BasePath::stripWeb($fullPath);

if ($path === '/api/health') {
    JsonResponse::send(['status' => 'ok', 'persistence' => 'client-side (IndexedDB) + server-side file uploads']);
    return;
}

if ($path === '/api/uploads' || str_starts_with($path, '/api/uploads/')) {
    require __DIR__ . '/uploads.php';
    return;
}

JsonResponse::send([
    'error' => 'not_implemented',
    'message' => 'No PlanTrace API endpoint matches this path. See /api/health and /api/uploads.',
], 404);
