package utils

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// PKCE auth state
type PKCEState struct {
	CodeVerifier string
	State        string
	ClientID     string
	RedirectURI  string
	CreatedAt    time.Time
}

// Token response from Spotify
type SpotifyTokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	Scope        string `json:"scope"`
}

// Auth start response
type AuthStartResponse struct {
	AuthURL string `json:"auth_url"`
	State   string `json:"state"`
}

// Global PKCE state storage (in memory, single pending auth at a time)
var (
	pendingAuth *PKCEState
	authMutex   sync.Mutex
)

// Default scopes for Spotify
const defaultScopes = "streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state user-read-currently-playing user-read-recently-played user-top-read user-library-read user-library-modify playlist-read-private playlist-read-collaborative user-follow-read"

// Generate random string for PKCE
func generateRandomString(length int) (string, error) {
	bytes := make([]byte, length)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	// Use URL-safe base64 without padding
	return base64.RawURLEncoding.EncodeToString(bytes)[:length], nil
}

// Generate code verifier (43-128 chars)
func generateCodeVerifier() (string, error) {
	return generateRandomString(64)
}

// Generate code challenge from verifier (SHA256 + base64url)
func generateCodeChallenge(verifier string) string {
	hash := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(hash[:])
}

// Start PKCE auth flow - returns auth URL
func StartPKCEAuth(clientID string, redirectURI string) (*AuthStartResponse, error) {
	authMutex.Lock()
	defer authMutex.Unlock()

	// Generate PKCE values
	codeVerifier, err := generateCodeVerifier()
	if err != nil {
		return nil, fmt.Errorf("failed to generate code verifier: %w", err)
	}

	state, err := generateRandomString(16)
	if err != nil {
		return nil, fmt.Errorf("failed to generate state: %w", err)
	}

	codeChallenge := generateCodeChallenge(codeVerifier)

	// Store pending auth state
	pendingAuth = &PKCEState{
		CodeVerifier: codeVerifier,
		State:        state,
		ClientID:     clientID,
		RedirectURI:  redirectURI,
		CreatedAt:    time.Now(),
	}

	// Build auth URL
	params := url.Values{}
	params.Set("client_id", clientID)
	params.Set("response_type", "code")
	params.Set("redirect_uri", redirectURI)
	params.Set("scope", defaultScopes)
	params.Set("state", state)
	params.Set("code_challenge_method", "S256")
	params.Set("code_challenge", codeChallenge)

	authURL := "https://accounts.spotify.com/authorize?" + params.Encode()

	return &AuthStartResponse{
		AuthURL: authURL,
		State:   state,
	}, nil
}

// Handle PKCE callback - exchange code for tokens
func HandlePKCECallback(code string, state string) (*SpotifyTokenResponse, error) {
	authMutex.Lock()
	defer authMutex.Unlock()

	// Verify we have pending auth
	if pendingAuth == nil {
		return nil, fmt.Errorf("no pending auth flow")
	}

	// Verify state matches
	if pendingAuth.State != state {
		return nil, fmt.Errorf("state mismatch")
	}

	// Check if auth is expired (10 minutes)
	if time.Since(pendingAuth.CreatedAt) > 10*time.Minute {
		pendingAuth = nil
		return nil, fmt.Errorf("auth flow expired")
	}

	// Exchange code for tokens
	data := url.Values{}
	data.Set("client_id", pendingAuth.ClientID)
	data.Set("grant_type", "authorization_code")
	data.Set("code", code)
	data.Set("redirect_uri", pendingAuth.RedirectURI)
	data.Set("code_verifier", pendingAuth.CodeVerifier)

	req, err := http.NewRequest("POST", "https://accounts.spotify.com/api/token", strings.NewReader(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("token request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		var errResp map[string]interface{}
		json.NewDecoder(resp.Body).Decode(&errResp)
		return nil, fmt.Errorf("token exchange failed: %d - %v", resp.StatusCode, errResp)
	}

	var tokens SpotifyTokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokens); err != nil {
		return nil, fmt.Errorf("failed to decode token response: %w", err)
	}

	// Clear pending auth
	pendingAuth = nil

	return &tokens, nil
}

// Refresh access token using refresh token
func RefreshPKCEToken(clientID string, refreshToken string) (*SpotifyTokenResponse, error) {
	data := url.Values{}
	data.Set("client_id", clientID)
	data.Set("grant_type", "refresh_token")
	data.Set("refresh_token", refreshToken)

	req, err := http.NewRequest("POST", "https://accounts.spotify.com/api/token", strings.NewReader(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("token refresh failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		var errResp map[string]interface{}
		json.NewDecoder(resp.Body).Decode(&errResp)
		return nil, fmt.Errorf("token refresh failed: %d - %v", resp.StatusCode, errResp)
	}

	var tokens SpotifyTokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokens); err != nil {
		return nil, fmt.Errorf("failed to decode token response: %w", err)
	}

	return &tokens, nil
}

// Get pending auth state (for checking if auth is in progress)
func GetPendingAuthState() string {
	authMutex.Lock()
	defer authMutex.Unlock()
	if pendingAuth == nil {
		return ""
	}
	return pendingAuth.State
}
