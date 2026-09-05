<?php

declare(strict_types=1);

/**
 * Router for PHP's built-in server: `php -S localhost:8080 -t public public/router.php`
 *
 * PlanTrace is a static-HTML + vanilla-ES-module app — this router's only
 * jobs are (1) let the built-in server serve real files under public/
 * directly, (2) hand /api/ requests to the tiny API shell, and (3) fall back
 * to index.html for everything else, since the app is a single page with no
 * server-rendered routes of its own.
 */

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$file = __DIR__ . $path;

// Real, existing static files (CSS/JS/icons/etc.) — let the built-in server
// stream them itself with correct MIME types rather than us re-implementing that.
if ($path !== '/' && is_file($file)) {
    return false;
}

// Minimal API shell for future server-side persistence (see docs/ARCHITECTURE.md
// "Persistence" and src/Http/JsonResponse.php). Nothing in the UI requires this
// today — PlanTrace persists to IndexedDB — the boundary just exists so a future
// PHP/MySQL ProjectRepository can occupy this same path without any UI changes.
if (str_starts_with($path, '/api/')) {
    require __DIR__ . '/api/index.php';
    return true;
}

header('Content-Type: text/html; charset=utf-8');
readfile(__DIR__ . '/index.html');
return true;
