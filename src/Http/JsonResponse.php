<?php

declare(strict_types=1);

namespace PlanTrace\Http;

/**
 * Minimal JSON response helper — the seed of a future Kernel/Request/Response
 * trio (the pattern chrisrobison/panic-backstage uses in src/Kernel.php,
 * src/Request.php, src/Response.php) once PlanTrace grows a real server-side
 * ProjectRepository. Deliberately small: this phase of the app persists
 * entirely to IndexedDB in the browser (see docs/ARCHITECTURE.md), so there
 * is no database or business logic behind this yet — only the boundary.
 */
final class JsonResponse
{
    public static function send(array $body, int $status = 200): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: no-referrer');
        echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }
}
