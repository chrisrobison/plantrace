<?php

declare(strict_types=1);

/**
 * Router for PHP's built-in server: `php -S localhost:8080 -t public public/router.php`
 *
 * PlanTrace is a static-HTML + vanilla-ES-module app — this router's only
 * jobs are (1) let the built-in server serve real files under public/
 * directly, (2) hand /api/ requests to the tiny API shell, and (3) fall
 * back to index.html for everything else, since the app is a single page
 * with no server-rendered routes of its own.
 *
 * It also honors APP_BASE_PATH / APP_ROOT_PATH from .env (see
 * .env.example and src/Support/BasePath.php) so a subdirectory deployment
 * can be exercised locally with the same server that ships in this repo.
 * When no .env is present, both default to "mounted at the root, files
 * live next to this script" — i.e. exactly today's behavior.
 */

require_once __DIR__ . '/../src/Support/Env.php';
require_once __DIR__ . '/../src/Support/BasePath.php';

use PlanTrace\Support\BasePath;

$requestUri = $_SERVER['REQUEST_URI'] ?? '/';
$fullPath = parse_url($requestUri, PHP_URL_PATH) ?: '/';
$basePath = BasePath::web();
$path = BasePath::stripWeb($fullPath);
$publicDir = BasePath::publicDir();
$file = $publicDir . $path;

// A request for something outside the configured base path (e.g. hitting
// this server directly on a different mount point than .env declares) is
// not ours to answer.
if ($basePath !== '' && !str_starts_with($fullPath, $basePath)) {
    http_response_code(404);
    echo 'Not found';
    return true;
}

if ($path !== '/' && is_file($file)) {
    // With no base path configured, the built-in server's own static-file
    // handling (triggered by returning false) is simplest and already
    // covers this case correctly, since $fullPath then equals $path.
    if ($basePath === '') {
        return false;
    }
    // With a base path configured, `return false` would make the built-in
    // server look for the file at the ORIGINAL (unstripped) request path
    // under the docroot, which doesn't exist there — so serve it ourselves.
    header('Content-Type: ' . plantrace_content_type($file));
    readfile($file);
    return true;
}

// Minimal API shell for future server-side persistence (see docs/ARCHITECTURE.md
// "Persistence" and src/Http/JsonResponse.php). Nothing in the UI requires this
// today — PlanTrace persists to IndexedDB — the boundary just exists so a future
// PHP/MySQL ProjectRepository can occupy this same path without any UI changes.
if (str_starts_with($path, '/api/')) {
    require $publicDir . '/api/index.php';
    return true;
}

header('Content-Type: text/html; charset=utf-8');
readfile($publicDir . '/index.html');
return true;

function plantrace_content_type(string $file): string
{
    $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
    return match ($ext) {
        'html' => 'text/html; charset=utf-8',
        'css' => 'text/css; charset=utf-8',
        'js', 'mjs' => 'text/javascript; charset=utf-8',
        'json' => 'application/json; charset=utf-8',
        'svg' => 'image/svg+xml',
        'png' => 'image/png',
        'jpg', 'jpeg' => 'image/jpeg',
        'webp' => 'image/webp',
        'ico' => 'image/x-icon',
        'woff' => 'font/woff',
        'woff2' => 'font/woff2',
        'map' => 'application/json; charset=utf-8',
        default => 'application/octet-stream',
    };
}
