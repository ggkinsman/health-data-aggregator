import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OuraAuth } from '../auth.js';
import { OuraAPIError, OuraTokenExpiredError, ALL_OURA_SCOPES } from '../types.js';

const mockConfig = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  redirectUri: 'http://localhost:3000/callback',
};

describe('OuraAuth', () => {
  let auth: OuraAuth;

  beforeEach(() => {
    auth = new OuraAuth(mockConfig);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('generateAuthUrl', () => {
    it('should generate a valid authorization URL with default scopes', () => {
      const url = auth.generateAuthUrl();

      expect(url).toContain('https://cloud.ouraring.com/oauth/authorize');
      expect(url).toContain(`client_id=${mockConfig.clientId}`);
      expect(url).toContain(`redirect_uri=${encodeURIComponent(mockConfig.redirectUri)}`);
      expect(url).toContain('response_type=code');
      // Should include all default scopes
      ALL_OURA_SCOPES.forEach(scope => {
        expect(url).toContain(scope);
      });
    });

    it('should generate URL with custom scopes', () => {
      const url = auth.generateAuthUrl(['daily', 'heartrate']);

      expect(url).toContain('scope=daily+heartrate');
    });

    it('should include state parameter when provided', () => {
      const state = 'random-state-123';
      const url = auth.generateAuthUrl(ALL_OURA_SCOPES, state);

      expect(url).toContain(`state=${state}`);
    });

    it('should not include state parameter when not provided', () => {
      const url = auth.generateAuthUrl();

      expect(url).not.toContain('state=');
    });

    it('should throw OuraAPIError when scopes array is empty', () => {
      expect(() => auth.generateAuthUrl([])).toThrow(OuraAPIError);
      expect(() => auth.generateAuthUrl([])).toThrow('At least one scope is required');
    });
  });

  describe('exchangeCodeForToken', () => {
    it('should exchange code for tokens successfully', async () => {
      const mockResponse = {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'daily heartrate',
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'));

      const tokens = await auth.exchangeCodeForToken('auth-code-123');

      expect(tokens.accessToken).toBe('new-access-token');
      expect(tokens.refreshToken).toBe('new-refresh-token');
      expect(tokens.tokenType).toBe('Bearer');
      expect(tokens.scope).toBe('daily heartrate');
      expect(tokens.expiresAt).toBe(Date.now() + 3600 * 1000);
    });

    it('should throw OuraAPIError on failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.resolve({
          error: 'invalid_grant',
          error_description: 'The authorization code has expired',
        }),
      } as Response);

      await expect(auth.exchangeCodeForToken('expired-code'))
        .rejects.toThrow(OuraAPIError);
    });

    it('should throw OuraAPIError when response is missing required fields', async () => {
      const incompleteResponse = {
        access_token: 'token',
        // missing refresh_token, expires_in, token_type
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(incompleteResponse),
      } as Response);

      await expect(auth.exchangeCodeForToken('code'))
        .rejects.toThrow('missing required field');
    });

    it('should throw OuraAPIError when expires_in is invalid', async () => {
      const invalidResponse = {
        access_token: 'token',
        refresh_token: 'refresh',
        expires_in: -100, // invalid
        token_type: 'Bearer',
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(invalidResponse),
      } as Response);

      await expect(auth.exchangeCodeForToken('code'))
        .rejects.toThrow('expires_in must be a positive number');
    });

    it('should throw OuraAPIError on timeout (AbortError)', async () => {
      // Simulate an AbortError which is what happens when fetch times out
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';

      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(abortError);

      await expect(auth.exchangeCodeForToken('code'))
        .rejects.toThrow('timed out');
    });
  });

  describe('refreshAccessToken', () => {
    it('should refresh tokens successfully', async () => {
      const mockResponse = {
        access_token: 'refreshed-access-token',
        refresh_token: 'refreshed-refresh-token',
        expires_in: 7200,
        token_type: 'Bearer',
        scope: 'daily heartrate',
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const tokens = await auth.refreshAccessToken('old-refresh-token');

      expect(tokens.accessToken).toBe('refreshed-access-token');
      expect(tokens.refreshToken).toBe('refreshed-refresh-token');
    });

    it('should throw OuraAPIError when refresh token is invalid', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: () => Promise.resolve({
          error: 'invalid_grant',
          error_description: 'The refresh token is invalid',
        }),
      } as Response);

      await expect(auth.refreshAccessToken('invalid-refresh-token'))
        .rejects.toThrow(OuraAPIError);
    });
  });

  describe('revokeAccessToken', () => {
    it('should revoke token successfully', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
      } as Response);

      await expect(auth.revokeAccessToken('token-to-revoke'))
        .resolves.not.toThrow();
    });

    it('should not throw when token is already invalid', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      await expect(auth.revokeAccessToken('already-invalid-token'))
        .resolves.not.toThrow();
    });
  });

  describe('needsRefresh', () => {
    it('should return true when token is expired', () => {
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'));

      const tokens = {
        accessToken: 'test',
        refreshToken: 'test',
        expiresAt: Date.now() - 1000, // expired 1 second ago
        tokenType: 'Bearer',
        scope: 'daily',
      };

      expect(auth.needsRefresh(tokens)).toBe(true);
    });

    it('should return true when token expires within buffer time', () => {
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'));

      const tokens = {
        accessToken: 'test',
        refreshToken: 'test',
        expiresAt: Date.now() + 2 * 60 * 1000, // expires in 2 minutes (within 5 min buffer)
        tokenType: 'Bearer',
        scope: 'daily',
      };

      expect(auth.needsRefresh(tokens)).toBe(true);
    });

    it('should return false when token is still valid', () => {
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'));

      const tokens = {
        accessToken: 'test',
        refreshToken: 'test',
        expiresAt: Date.now() + 30 * 60 * 1000, // expires in 30 minutes
        tokenType: 'Bearer',
        scope: 'daily',
      };

      expect(auth.needsRefresh(tokens)).toBe(false);
    });
  });

  describe('validateTokens', () => {
    it('should not throw for valid tokens', () => {
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'));

      const tokens = {
        accessToken: 'valid-access',
        refreshToken: 'valid-refresh',
        expiresAt: Date.now() + 3600 * 1000,
        tokenType: 'Bearer',
        scope: 'daily',
      };

      expect(() => auth.validateTokens(tokens)).not.toThrow();
    });

    it('should throw OuraTokenExpiredError for expired tokens', () => {
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'));

      const tokens = {
        accessToken: 'expired-access',
        refreshToken: 'valid-refresh',
        expiresAt: Date.now() - 1000, // expired
        tokenType: 'Bearer',
        scope: 'daily',
      };

      expect(() => auth.validateTokens(tokens)).toThrow(OuraTokenExpiredError);
    });

    it('should throw OuraAPIError for missing access token', () => {
      const tokens = {
        accessToken: '',
        refreshToken: 'valid-refresh',
        expiresAt: Date.now() + 3600 * 1000,
        tokenType: 'Bearer',
        scope: 'daily',
      };

      expect(() => auth.validateTokens(tokens)).toThrow(OuraAPIError);
    });
  });

  describe('getValidTokens', () => {
    it('should return existing tokens if still valid', async () => {
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'));

      const tokens = {
        accessToken: 'valid-access',
        refreshToken: 'valid-refresh',
        expiresAt: Date.now() + 30 * 60 * 1000, // 30 min from now
        tokenType: 'Bearer',
        scope: 'daily',
      };

      const result = await auth.getValidTokens(tokens);

      expect(result).toEqual(tokens);
    });

    it('should refresh tokens if expiring soon', async () => {
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'));

      const tokens = {
        accessToken: 'old-access',
        refreshToken: 'valid-refresh',
        expiresAt: Date.now() + 2 * 60 * 1000, // 2 min from now (within buffer)
        tokenType: 'Bearer',
        scope: 'daily',
      };

      const mockResponse = {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'daily',
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const result = await auth.getValidTokens(tokens);

      expect(result.accessToken).toBe('new-access');
    });
  });
});
