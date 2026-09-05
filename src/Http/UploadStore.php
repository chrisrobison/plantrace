<?php

declare(strict_types=1);

namespace PlanTrace\Http;

use PlanTrace\Support\BasePath;

/**
 * Filesystem-backed storage for uploaded source sheets — no database, one
 * file per upload plus a small JSON sidecar for metadata. This backs
 * public/api/uploads.php, which is the only thing that talks to this class.
 *
 * Files live under storage/uploads/, a sibling of public/ — deliberately
 * OUTSIDE the web root, so an uploaded file can never be requested directly
 * by path and is only ever served back through uploads.php, which sets a
 * safe Content-Type (sniffed server-side, not trusted from the client) and
 * validates the id format before touching the filesystem.
 */
final class UploadStore
{
    /** MIME type -> stored extension. Matches public/assets/plan/source-adapters.js's ACCEPTED_MIME. */
    private const ALLOWED_MIME = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/webp' => 'webp',
        'application/pdf' => 'pdf',
    ];

    public const MAX_BYTES = 60 * 1024 * 1024;

    private const ID_PATTERN = '/^up_[a-f0-9]{24}$/';

    public static function dir(): string
    {
        $dir = BasePath::root() . '/storage/uploads';
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        return $dir;
    }

    /**
     * @param array $file one entry of $_FILES (already confirmed present by the caller)
     * @return array{id:string,filename:string,mimeType:string,size:int,width:int,height:int}
     * @throws \RuntimeException on validation failure
     */
    public static function save(array $file, string $originalName, int $width = 0, int $height = 0): array
    {
        if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            throw new \RuntimeException(self::uploadErrorMessage((int) $file['error']));
        }
        if (!is_uploaded_file($file['tmp_name'])) {
            throw new \RuntimeException('Invalid upload.');
        }
        $size = (int) ($file['size'] ?? filesize($file['tmp_name']));
        if ($size <= 0 || $size > self::MAX_BYTES) {
            throw new \RuntimeException(sprintf('File is too large. The limit is %dMB.', self::MAX_BYTES / 1024 / 1024));
        }

        // Never trust the client-supplied Content-Type — sniff the real one.
        $finfo = new \finfo(FILEINFO_MIME_TYPE);
        $mime = (string) $finfo->file($file['tmp_name']);
        if (!isset(self::ALLOWED_MIME[$mime])) {
            throw new \RuntimeException("Unsupported file type: {$mime}. Import a JPG, PNG, WebP, or PDF.");
        }

        $id = 'up_' . bin2hex(random_bytes(12));
        $ext = self::ALLOWED_MIME[$mime];
        $dir = self::dir();
        $dataPath = "{$dir}/{$id}.{$ext}";

        if (!move_uploaded_file($file['tmp_name'], $dataPath)) {
            throw new \RuntimeException('Could not save the uploaded file.');
        }
        chmod($dataPath, 0644);

        $meta = [
            'id' => $id,
            'ext' => $ext,
            'filename' => self::sanitizeFilename($originalName),
            'mimeType' => $mime,
            'size' => $size,
            'width' => max(0, $width),
            'height' => max(0, $height),
            'uploadedAt' => date('c'),
        ];
        file_put_contents("{$dir}/{$id}.json", json_encode($meta, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));

        return $meta;
    }

    /** @return array{id:string,ext:string,filename:string,mimeType:string,size:int,width:int,height:int}|null */
    public static function find(string $id): ?array
    {
        if (!preg_match(self::ID_PATTERN, $id)) {
            return null;
        }
        $metaPath = self::dir() . "/{$id}.json";
        if (!is_file($metaPath)) {
            return null;
        }
        $meta = json_decode((string) file_get_contents($metaPath), true);
        if (!is_array($meta) || !isset($meta['ext'])) {
            return null;
        }
        $dataPath = self::dir() . "/{$id}.{$meta['ext']}";
        if (!is_file($dataPath)) {
            return null;
        }
        $meta['path'] = $dataPath;
        return $meta;
    }

    public static function delete(string $id): bool
    {
        $meta = self::find($id);
        if ($meta === null) {
            return false;
        }
        @unlink($meta['path']);
        @unlink(self::dir() . "/{$id}.json");
        return true;
    }

    private static function sanitizeFilename(string $name): string
    {
        $name = basename($name);
        $name = preg_replace('/[^\w.\-]+/u', '_', $name) ?? 'upload';
        return substr($name, 0, 180) ?: 'upload';
    }

    private static function uploadErrorMessage(int $code): string
    {
        return match ($code) {
            UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE => sprintf(
                'File exceeds this server\'s upload limit (upload_max_filesize/post_max_size). Current PHP limit is %s.',
                ini_get('upload_max_filesize') ?: 'unknown'
            ),
            UPLOAD_ERR_PARTIAL => 'The file was only partially uploaded. Please try again.',
            UPLOAD_ERR_NO_FILE => 'No file was uploaded.',
            UPLOAD_ERR_NO_TMP_DIR, UPLOAD_ERR_CANT_WRITE, UPLOAD_ERR_EXTENSION => 'The server could not store the uploaded file.',
            default => 'Upload failed.',
        };
    }
}
