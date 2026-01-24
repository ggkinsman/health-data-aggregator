/**
 * Oura Ring OAuth2 Authentication
 *
 * Implements the OAuth2 authorization code flow for Oura API v2.
 * Personal Access Tokens are deprecated (end of 2025), so OAuth2 is required.
 */

import {
  OuraOAuthConfig,
  OuraTokens,
  OuraTokenResponse,
  OuraScope,
  ALL_OURA_SCOPES,
  OuraAPIError,
  OuraTokenExpiredError,
} from './types.js';

const OURA_AUTH_URL = 'https://cloud.ouraring.com/oauth/authorize';
const OURA_TOKEN_URL = 'https://api.ouraring.com/oauth/token';
const OURA_REVOKE_URL = 'https://api.ouraring.com/oauth/revoke';

/** Buffer time before token expiration to trigger refresh (5 minutes) */
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** Default timeout for API requests (30 seconds) */
const DEFAULT_TIMEOUT_MS = 30 * 1000;

export class OuraAuth {
  private config: OuraOAuthConfig;

  constructor(config: OuraOAuthConfig) {
    this.config = config;
  }

  /**
   * Generate the authorization URL for the user to visit.
   * After authorization, Oura will redirect to the redirectUri with an authorization code.
   *
   * @param scopes - Array of scopes to request (defaults to all scopes)
   * @param state - Optional state parameter for CSRF protection
   * @returns The authorization URL
   */
  generateAuthUrl(
    scopes: OuraScope[] = ALL_OURA_SCOPES,
    state?: string
  ): string {
    if (!scopes || scopes.length === 0) {
      throw new OuraAPIError('At least one scope is required');
    }

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
    });

    if (state) {
      params.set('state', state);
    }

    return `${OURA_AUTH_URL}?${params.toString()}`;
  }

  /**
   * Exchange an authorization code for access and refresh tokens.
   *
   * @param code - The authorization code from the OAuth callback
   * @returns The token response with access and refresh tokens
   */
  async exchangeCodeForToken(code: string): Promise<OuraTokens> {
    const response = await this.fetchWithTimeout(OURA_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.redirectUri,
      }),
    });

    if (!response.ok) {
      const error = await this.parseErrorResponse(response);
      throw new OuraAPIError(
        error.message,
        response.status,
        error.code
      );
    }

    const data = (await response.json()) as OuraTokenResponse;
    return this.normalizeTokenResponse(data);
  }

  /**
   * Refresh an access token using a refresh token.
   *
   * @param refreshToken - The refresh token
   * @returns New tokens (both access and refresh tokens may be updated)
   */
  async refreshAccessToken(refreshToken: string): Promise<OuraTokens> {
    const response = await this.fetchWithTimeout(OURA_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }),
    });

    if (!response.ok) {
      const error = await this.parseErrorResponse(response);
      throw new OuraAPIError(
        error.message,
        response.status,
        error.code
      );
    }

    const data = (await response.json()) as OuraTokenResponse;
    return this.normalizeTokenResponse(data);
  }

  /**
   * Revoke an access token, invalidating it and its associated refresh token.
   *
   * @param accessToken - The access token to revoke
   */
  async revokeAccessToken(accessToken: string): Promise<void> {
    const response = await this.fetchWithTimeout(OURA_REVOKE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        token: accessToken,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }),
    });

    // Revocation endpoint returns 200 even if token was already invalid
    // Only throw on actual errors
    if (!response.ok && response.status !== 200) {
      const error = await this.parseErrorResponse(response);
      throw new OuraAPIError(
        error.message,
        response.status,
        error.code
      );
    }
  }

  /**
   * Check if tokens need to be refreshed.
   *
   * @param tokens - The current tokens
   * @returns True if the access token is expired or will expire soon
   */
  needsRefresh(tokens: OuraTokens): boolean {
    const now = Date.now();
    return tokens.expiresAt - TOKEN_REFRESH_BUFFER_MS <= now;
  }

  /**
   * Get valid tokens, automatically refreshing if needed.
   *
   * @param tokens - The current tokens
   * @returns Valid tokens (may be refreshed)
   */
  async getValidTokens(tokens: OuraTokens): Promise<OuraTokens> {
    if (this.needsRefresh(tokens)) {
      return this.refreshAccessToken(tokens.refreshToken);
    }
    return tokens;
  }

  /**
   * Validate that tokens are present and not obviously invalid.
   *
   * @param tokens - The tokens to validate
   * @throws OuraTokenExpiredError if tokens are expired
   */
  validateTokens(tokens: OuraTokens): void {
    if (!tokens.accessToken || !tokens.refreshToken) {
      throw new OuraAPIError('Invalid tokens: missing access or refresh token');
    }

    if (tokens.expiresAt <= Date.now()) {
      throw new OuraTokenExpiredError();
    }
  }

  /**
   * Convert the API token response to our normalized format.
   */
  private normalizeTokenResponse(response: OuraTokenResponse): OuraTokens {
    this.validateTokenResponse(response);
    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiresAt: Date.now() + response.expires_in * 1000,
      tokenType: response.token_type,
      scope: response.scope,
    };
  }

  /**
   * Validate that a token response contains all required fields.
   */
  private validateTokenResponse(response: OuraTokenResponse): void {
    const required: (keyof OuraTokenResponse)[] = [
      'access_token',
      'refresh_token',
      'expires_in',
      'token_type',
    ];

    for (const field of required) {
      if (response[field] === undefined || response[field] === null) {
        throw new OuraAPIError(
          `Invalid token response: missing required field '${field}'`
        );
      }
    }

    if (typeof response.expires_in !== 'number' || response.expires_in <= 0) {
      throw new OuraAPIError(
        'Invalid token response: expires_in must be a positive number'
      );
    }
  }

  /**
   * Parse an error response from the Oura API.
   */
  private async parseErrorResponse(
    response: Response
  ): Promise<{ message: string; code?: string }> {
    try {
      const data = (await response.json()) as {
        error?: string;
        error_description?: string;
      };
      return {
        message: data.error_description || data.error || 'Unknown error',
        code: data.error,
      };
    } catch {
      return {
        message: `HTTP ${response.status}: ${response.statusText}`,
      };
    }
  }

  /**
   * Fetch with timeout support using AbortController.
   */
  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new OuraAPIError(
          `Request timed out after ${timeoutMs}ms`,
          undefined,
          'timeout'
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
