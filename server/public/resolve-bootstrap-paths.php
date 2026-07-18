<?php
declare(strict_types=1);

function resolveBootstrapPaths(string $entryDirectory): array
{
    foreach ([$entryDirectory, dirname($entryDirectory)] as $baseDirectory) {
        $appPath = $baseDirectory . '/src/CloudBackupApp.php';
        if (is_file($appPath)) {
            return [
                'app' => $appPath,
                'config' => $baseDirectory . '/config.php',
            ];
        }
    }

    throw new RuntimeException('Cloud backup application files are missing');
}
