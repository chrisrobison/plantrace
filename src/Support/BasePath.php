<?php

declare(strict_types=1);

namespace PlanTrace\Support;

/**
 * Lets PlanTrace be mounted under any URL path segment (e.g. a site's
 * `/plantrace/` instead of its root) and, independently, live at any
 * filesystem location — both configured via .env (see .env.example).
 *
 * The app's own HTML/CSS/JS never hard-code a path (every asset reference
 * and module import is relative — see docs/ARCHITECTURE.md), so this is
 * needed in exactly two places: public/router.php (php -S's router script,
 * which has no other way to know it's simulating a sub-path) and
 * public/api/index.php (whose $_SERVER['REQUEST_URI'] still contains the
 * full, unstripped path even when Apache's per-directory .htaccess routing
 * already got the request to the right file).
 */
final class BasePath
{
    /** Normalized web base path: '' (mounted at the root) or '/segment' (no trailing slash). */
    public static function web(): string
    {
        $raw = trim(Env::get('APP_BASE_PATH', ''));
        $raw = rtrim($raw, '/');
        if ($raw === '') {
            return '';
        }
        return str_starts_with($raw, '/') ? $raw : '/' . $raw;
    }

    /** Strip the configured web base path from a request path. "/plantrace/api/health" -> "/api/health". */
    public static function stripWeb(string $path): string
    {
        $base = self::web();
        if ($base === '') {
            return $path;
        }
        if ($path === $base) {
            return '/';
        }
        if (str_starts_with($path, $base . '/')) {
            return substr($path, strlen($base));
        }
        return $path;
    }

    /** Absolute filesystem path to the project root (the parent of public/ and src/). */
    public static function root(): string
    {
        $configured = trim(Env::get('APP_ROOT_PATH', ''));
        if ($configured !== '') {
            return rtrim($configured, '/');
        }
        return dirname(__DIR__, 2);
    }

    public static function publicDir(): string
    {
        return self::root() . '/public';
    }
}
