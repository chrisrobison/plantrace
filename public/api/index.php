<?php

declare(strict_types=1);

/**
 * PlanTrace API shell. There is no server-side persistence in this phase —
 * projects live in the browser's IndexedDB and travel between machines as
 * portable JSON (see docs/ARCHITECTURE.md "Persistence" and
 * docs/PROJECT-FORMAT.md). This endpoint exists so the /api/ boundary is
 * real and reachable, ready for a future PHP/MySQL ProjectRepository to
 * occupy without any change to the front end.
 *
 * Path matching goes through BasePath::stripWeb() so this still resolves
 * correctly when the app is mounted under a subdirectory (APP_BASE_PATH in
 * .env) — $_SERVER['REQUEST_URI'] still carries the full, unstripped path
 * even when Apache's .htaccess already routed the request here.
 */

require_once dirname(__DIR__, 2) . '/src/Support/Env.php';
require_once dirname(__DIR__, 2) . '/src/Support/BasePath.php';
require_once PlanTrace\Support\BasePath::root() . '/src/Http/JsonResponse.php';

use PlanTrace\Http\JsonResponse;
use PlanTrace\Support\BasePath;

$fullPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$path = BasePath::stripWeb($fullPath);

if ($path === '/api/health') {
    JsonResponse::send(['status' => 'ok', 'persistence' => 'client-side (IndexedDB)']);
    return;
}

JsonResponse::send([
    'error' => 'not_implemented',
    'message' => 'PlanTrace has no server-side project API in this phase. Use the app\'s Export/Import (project JSON) to move projects between browsers.',
], 501);
