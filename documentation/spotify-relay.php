<?php
/**
 * Spotify PKCE Auth Relay for Nocturne
 *
 * Host this on your HTTPS server and set VITE_AUTH_RELAY_URL in .env
 *
 * Flow:
 * 1. Device calls ?action=start&client_id=XXX&session=YYY
 *    - Returns Spotify auth URL for QR code
 * 2. User scans QR, authorizes on Spotify
 * 3. Spotify redirects to ?code=ABC&state=YYY
 *    - PHP stores code, shows success page
 * 4. Device polls ?action=check&session=YYY
 *    - Returns {"code": "ABC"} when ready
 * 5. Device exchanges code for tokens locally (keeps code_verifier secret)
 */

// CORS headers for device polling
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Session storage OUTSIDE web root (not accessible via HTTP)
// Goes one directory up from the script location
$sessionDir = dirname(__DIR__) . '/nocturne_sessions/';
if (!is_dir($sessionDir)) {
    mkdir($sessionDir, 0700, true); // 0700 = only owner can read/write/execute
}

// Clean old sessions (older than 10 minutes)
foreach (glob($sessionDir . '*.json') as $file) {
    if (filemtime($file) < time() - 600) {
        unlink($file);
    }
}

$action = $_GET['action'] ?? null;
$session = $_GET['session'] ?? $_GET['state'] ?? null;

// Security: Validate session ID (prevent path traversal)
function isValidSession($s) {
    return $s && preg_match('/^[A-Za-z0-9_\-]{8,64}$/', $s);
}

// Security: Validate client ID (32 hex chars)
function isValidClientId($id) {
    return $id && preg_match('/^[a-f0-9]{32}$/', $id);
}

// Spotify scopes
$scopes = 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state user-read-currently-playing user-read-recently-played user-top-read user-library-read user-library-modify playlist-read-private playlist-read-collaborative user-follow-read';

// Get the base URL of this script for redirect
$protocol = isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? 'https' : 'http';
$baseUrl = $protocol . '://' . $_SERVER['HTTP_HOST'] . strtok($_SERVER['REQUEST_URI'], '?');

// Action: Test - verify relay is working
if ($action === 'test') {
    echo json_encode([
        'status' => 'ok',
        'session_dir' => is_dir($sessionDir) && is_writable($sessionDir) ? 'writable' : 'error',
        'redirect_uri' => $baseUrl,
        'timestamp' => time()
    ]);
    exit;
}

// Action: Start auth flow
if ($action === 'start') {
    $clientId = $_GET['client_id'] ?? null;
    $codeChallenge = $_GET['code_challenge'] ?? null;

    if (!isValidClientId($clientId) || !isValidSession($session) || !$codeChallenge) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid or missing parameters']);
        exit;
    }

    // Store session info
    $sessionFile = $sessionDir . $session . '.json';
    file_put_contents($sessionFile, json_encode([
        'client_id' => $clientId,
        'created' => time(),
        'code' => null
    ]), LOCK_EX);
    chmod($sessionFile, 0600); // Only owner can read/write

    // Build Spotify auth URL
    $params = http_build_query([
        'client_id' => $clientId,
        'response_type' => 'code',
        'redirect_uri' => $baseUrl,
        'scope' => $scopes,
        'state' => $session,
        'code_challenge_method' => 'S256',
        'code_challenge' => $codeChallenge
    ]);

    $authUrl = 'https://accounts.spotify.com/authorize?' . $params;

    echo json_encode([
        'auth_url' => $authUrl,
        'session' => $session,
        'redirect_uri' => $baseUrl
    ]);
    exit;
}

// Action: Check for code
if ($action === 'check') {
    if (!isValidSession($session)) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid session']);
        exit;
    }

    $sessionFile = $sessionDir . $session . '.json';
    if (!file_exists($sessionFile)) {
        http_response_code(404);
        echo json_encode(['error' => 'Session not found', 'pending' => false]);
        exit;
    }

    $data = json_decode(file_get_contents($sessionFile), true);

    if ($data['code']) {
        // Code is ready - delete session file after returning
        unlink($sessionFile);
        echo json_encode([
            'code' => $data['code'],
            'redirect_uri' => $baseUrl,
            'pending' => false
        ]);
    } else {
        echo json_encode(['pending' => true, 'code' => null]);
    }
    exit;
}

// Spotify callback - code received
if (isset($_GET['code']) && isset($_GET['state'])) {
    $code = $_GET['code'];
    $state = $_GET['state'];

    if (!isValidSession($state)) {
        http_response_code(400);
        header('Content-Type: text/html');
        echo '<html><body style="background:#1a1a1a;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">';
        echo '<h1>Invalid Session</h1>';
        echo '</body></html>';
        exit;
    }

    $sessionFile = $sessionDir . $state . '.json';
    if (!file_exists($sessionFile)) {
        http_response_code(400);
        header('Content-Type: text/html');
        echo '<html><body style="background:#1a1a1a;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;">';
        echo '<h1>Session Expired</h1>';
        echo '<p>Please try again from your device.</p>';
        echo '</body></html>';
        exit;
    }

    $data = json_decode(file_get_contents($sessionFile), true);
    $data['code'] = $code;
    file_put_contents($sessionFile, json_encode($data), LOCK_EX);

    // Show success page
    header('Content-Type: text/html');
    echo '<html><body style="background:#1a1a1a;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;">';
    echo '<div style="text-align:center;">';
    echo '<svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="#1db954" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>';
    echo '<h1 style="color:#1db954;margin-top:20px;">Authorization Successful!</h1>';
    echo '<p style="color:#888;font-size:18px;">You can close this window.<br>Your device will connect automatically.</p>';
    echo '</div></body></html>';
    exit;
}

// Spotify error callback
if (isset($_GET['error'])) {
    header('Content-Type: text/html');
    $error = htmlspecialchars($_GET['error']);
    $desc = htmlspecialchars($_GET['error_description'] ?? 'Unknown error');
    echo '<html><body style="background:#1a1a1a;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;">';
    echo '<h1 style="color:#e74c3c;">Authorization Failed</h1>';
    echo '<p style="color:#888;">' . $error . ': ' . $desc . '</p>';
    echo '<p style="color:#666;margin-top:20px;">Please try again from your device.</p>';
    echo '</body></html>';
    exit;
}

// Default: show info
header('Content-Type: text/html');
echo '<html><body style="background:#1a1a1a;color:#fff;font-family:system-ui;padding:40px;">';
echo '<h1>Nocturne Spotify Auth Relay</h1>';
echo '<p style="color:#888;">This endpoint handles Spotify authentication for Nocturne devices.</p>';
echo '<p style="color:#666;font-size:14px;">API endpoints:</p>';
echo '<ul style="color:#666;font-size:14px;">';
echo '<li>GET ?action=test - Test relay is working</li>';
echo '<li>GET ?action=start&client_id=XXX&session=YYY&code_challenge=ZZZ - Start auth flow</li>';
echo '<li>GET ?action=check&session=YYY - Check for auth code</li>';
echo '</ul>';
echo '</body></html>';
