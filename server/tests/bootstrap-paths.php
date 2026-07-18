<?php
declare(strict_types=1);

require dirname(__DIR__) . '/public/resolve-bootstrap-paths.php';

function expectPath(string $actual, string $expected, string $message): void
{
    if ($actual !== $expected) {
        throw new RuntimeException($message . ': expected ' . $expected . ', got ' . $actual);
    }
}

$sourceRoot = dirname(__DIR__);
$sourcePaths = resolveBootstrapPaths($sourceRoot . '/public');
expectPath($sourcePaths['app'], $sourceRoot . '/src/CloudBackupApp.php', 'source app path');
expectPath($sourcePaths['config'], $sourceRoot . '/config.php', 'source config path');

$deploymentRoot = sys_get_temp_dir() . '/ai-chat-bootstrap-' . bin2hex(random_bytes(6));
mkdir($deploymentRoot . '/src', 0777, true);
touch($deploymentRoot . '/src/CloudBackupApp.php');
touch($deploymentRoot . '/config.php');

try {
    $deploymentPaths = resolveBootstrapPaths($deploymentRoot);
    expectPath($deploymentPaths['app'], $deploymentRoot . '/src/CloudBackupApp.php', 'deployment app path');
    expectPath($deploymentPaths['config'], $deploymentRoot . '/config.php', 'deployment config path');
} finally {
    unlink($deploymentRoot . '/src/CloudBackupApp.php');
    unlink($deploymentRoot . '/config.php');
    rmdir($deploymentRoot . '/src');
    rmdir($deploymentRoot);
}

echo "PHP bootstrap path tests passed\n";
