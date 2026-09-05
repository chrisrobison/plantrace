<?php

declare(strict_types=1);

namespace PlanTrace\Support;

/**
 * Trivial `.env` reader — no Composer dependency (vlucas/phpdotenv et al.)
 * for what amounts to a handful of KEY=VALUE lines. Values already present
 * in the real process environment (`getenv()`) win, so a hosting panel's
 * own env-var configuration always overrides a checked-in `.env`.
 *
 * See .env.example for what this project actually reads.
 */
final class Env
{
    private static ?array $values = null;

    public static function get(string $key, string $default = ''): string
    {
        $fromEnv = getenv($key);
        if ($fromEnv !== false && $fromEnv !== '') {
            return $fromEnv;
        }
        self::load();
        return self::$values[$key] ?? $default;
    }

    private static function load(): void
    {
        if (self::$values !== null) {
            return;
        }
        self::$values = [];
        $path = dirname(__DIR__, 2) . '/.env';
        if (!is_file($path) || !is_readable($path)) {
            return;
        }
        $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#')) {
                continue;
            }
            $parts = explode('=', $line, 2);
            if (count($parts) !== 2) {
                continue;
            }
            [$key, $value] = $parts;
            $key = trim($key);
            $value = trim($value);
            // Strip one matching pair of surrounding quotes, if present.
            if (strlen($value) >= 2 && ($value[0] === '"' || $value[0] === "'") && $value[-1] === $value[0]) {
                $value = substr($value, 1, -1);
            }
            if ($key !== '') {
                self::$values[$key] = $value;
            }
        }
    }
}
