import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OuraClient } from '../client.js';
import { OuraAuth } from '../auth.js';
import { MemoryTokenStorage } from '../../storage/token-storage.js';
import {
  OuraAPIError,
  type OuraTokens,
  type DailyReadinessResponse,
  type DailySleepResponse,
} from '../types.js';

const mockConfig = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  redirectUri: 'http://localhost:3000/callback',
};

const mockTokens: OuraTokens = {
  accessToken: 'test-access-token',
  refreshToken: 'test-refresh-token',
  expiresAt: Date.now() + 3600 * 1000, // 1 hour from now
  tokenType: 'Bearer',
  scope: 'personal daily heartrate',
};

describe('OuraClient', () => {
  let client: OuraClient;
  let auth: OuraAuth;
  let tokenStorage: MemoryTokenStorage;
  const userId = 'test-user';

  beforeEach(() => {
    auth = new OuraAuth(mockConfig);
    tokenStorage = new MemoryTokenStorage();
    client = new OuraClient({
      auth,
      tokenStorage,
      userId,
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('getDailyReadiness', () => {
    it('should fetch daily readiness data', async () => {
      await tokenStorage.save(userId, mockTokens);

      const mockResponse: DailyReadinessResponse = {
        data: [
          {
            id: 'test-id',
            day: '2024-01-15',
            score: 85,
            contributors: {
              activity_balance: 90,
              body_temperature: 85,
            },
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await client.getDailyReadiness();

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('daily_readiness'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockTokens.accessToken}`,
          }),
        })
      );
    });

    it('should include date range query parameters', async () => {
      await tokenStorage.save(userId, mockTokens);

      const mockResponse: DailyReadinessResponse = { data: [] };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      await client.getDailyReadiness({
        start_date: '2024-01-01',
        end_date: '2024-01-31',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('start_date=2024-01-01'),
        expect.any(Object)
      );
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('end_date=2024-01-31'),
        expect.any(Object)
      );
    });

    it('should include next_token query parameter', async () => {
      await tokenStorage.save(userId, mockTokens);

      const mockResponse: DailyReadinessResponse = { data: [] };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      await client.getDailyReadiness({
        start_date: '2024-01-01',
        end_date: '2024-01-31',
        next_token: 'abc123',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('next_token=abc123'),
        expect.any(Object)
      );
    });

    it('should refresh tokens if expired', async () => {
      const expiredTokens: OuraTokens = {
        ...mockTokens,
        expiresAt: Date.now() - 1000, // Expired
      };
      await tokenStorage.save(userId, expiredTokens);

      const refreshedTokens: OuraTokens = {
        ...mockTokens,
        accessToken: 'new-access-token',
        expiresAt: Date.now() + 3600 * 1000,
      };

      const refreshSpy = vi
        .spyOn(auth, 'refreshAccessToken')
        .mockResolvedValue(refreshedTokens);

      const mockResponse: DailyReadinessResponse = { data: [] };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      await client.getDailyReadiness();

      expect(refreshSpy).toHaveBeenCalledWith(expiredTokens.refreshToken);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${refreshedTokens.accessToken}`,
          }),
        })
      );
    });

    it('should throw error when no tokens found', async () => {
      await expect(client.getDailyReadiness()).rejects.toThrow(OuraAPIError);
      await expect(client.getDailyReadiness()).rejects.toThrow(
        'No tokens found'
      );
    });

    it('should handle rate limit errors', async () => {
      await tokenStorage.save(userId, mockTokens);

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      });

      await expect(client.getDailyReadiness()).rejects.toThrow(OuraAPIError);
      await expect(client.getDailyReadiness()).rejects.toThrow(
        'Rate limit exceeded'
      );
    });

    it('should handle membership required errors', async () => {
      await tokenStorage.save(userId, mockTokens);

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

      await expect(client.getDailyReadiness()).rejects.toThrow(OuraAPIError);
      await expect(client.getDailyReadiness()).rejects.toThrow(
        'Oura membership required'
      );
    });

    it('should retry with refreshed token on 401 error', async () => {
      await tokenStorage.save(userId, mockTokens);

      const refreshedTokens: OuraTokens = {
        ...mockTokens,
        accessToken: 'new-access-token',
        expiresAt: Date.now() + 3600 * 1000,
      };

      const refreshSpy = vi
        .spyOn(auth, 'refreshAccessToken')
        .mockResolvedValue(refreshedTokens);

      const mockResponse: DailyReadinessResponse = { data: [] };

      // First call returns 401, second call succeeds
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockResponse,
        });

      const result = await client.getDailyReadiness();

      expect(refreshSpy).toHaveBeenCalled();
      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('getDailySleep', () => {
    it('should fetch daily sleep data', async () => {
      await tokenStorage.save(userId, mockTokens);

      const mockResponse: DailySleepResponse = {
        data: [
          {
            id: 'test-id',
            day: '2024-01-15',
            score: 88,
            contributors: {
              deep_sleep: 90,
              efficiency: 85,
            },
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await client.getDailySleep();

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('daily_sleep'),
        expect.any(Object)
      );
    });
  });

  describe('other endpoints', () => {
    beforeEach(async () => {
      await tokenStorage.save(userId, mockTokens);
    });

    it('should fetch daily activity', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      });

      await client.getDailyActivity();

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('daily_activity'),
        expect.any(Object)
      );
    });

    it('should fetch sleep sessions', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      });

      await client.getSleep();

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('sleep'),
        expect.any(Object)
      );
    });

    it('should fetch heart rate', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      });

      await client.getHeartRate();

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('heartrate'),
        expect.any(Object)
      );
    });

    it('should fetch workouts', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      });

      await client.getWorkouts();

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('workout'),
        expect.any(Object)
      );
    });

    it('should fetch sessions', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      });

      await client.getSessions();

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('session'),
        expect.any(Object)
      );
    });

    it('should fetch tags', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      });

      await client.getTags();

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('tag'),
        expect.any(Object)
      );
    });

    it('should fetch personal info', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: {} }),
      });

      await client.getPersonalInfo();

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('personal_info'),
        expect.any(Object)
      );
    });
  });
});
