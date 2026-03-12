/**
 * Oura API v2 Client
 *
 * Fetches health data from the Oura API using authenticated tokens.
 * Automatically handles token refresh and error handling.
 */

import { OuraAuth } from './auth.js';
import {
  OuraAPIError,
  type OuraTokens,
  type DateRangeQuery,
  type DailyReadinessResponse,
  type DailySleepResponse,
  type DailyActivityResponse,
  type SleepSessionResponse,
  type HeartRateResponse,
  type WorkoutResponse,
  type SessionResponse,
  type TagResponse,
  type PersonalInfoResponse,
} from './types.js';
import type { TokenStorage } from '../storage/token-storage.js';

const OURA_API_BASE_URL = 'https://api.ouraring.com/v2/usercollection';
const DEFAULT_TIMEOUT_MS = 30 * 1000;

export interface OuraClientConfig {
  auth: OuraAuth;
  tokenStorage: TokenStorage;
  userId: string;
}

/**
 * Client for fetching data from the Oura API v2.
 */
export class OuraClient {
  private auth: OuraAuth;
  private tokenStorage: TokenStorage;
  private userId: string;

  constructor(config: OuraClientConfig) {
    this.auth = config.auth;
    this.tokenStorage = config.tokenStorage;
    this.userId = config.userId;
  }

  /**
   * Get daily readiness scores and contributors.
   */
  async getDailyReadiness(
    query?: DateRangeQuery
  ): Promise<DailyReadinessResponse> {
    return this.fetch<DailyReadinessResponse>('daily_readiness', query);
  }

  /**
   * Get daily sleep scores and contributors.
   */
  async getDailySleep(query?: DateRangeQuery): Promise<DailySleepResponse> {
    return this.fetch<DailySleepResponse>('daily_sleep', query);
  }

  /**
   * Get daily activity scores and metrics.
   */
  async getDailyActivity(
    query?: DateRangeQuery
  ): Promise<DailyActivityResponse> {
    return this.fetch<DailyActivityResponse>('daily_activity', query);
  }

  /**
   * Get detailed sleep session data.
   */
  async getSleep(query?: DateRangeQuery): Promise<SleepSessionResponse> {
    return this.fetch<SleepSessionResponse>('sleep', query);
  }

  /**
   * Get heart rate measurements.
   */
  async getHeartRate(query?: DateRangeQuery): Promise<HeartRateResponse> {
    return this.fetch<HeartRateResponse>('heart_rate', query);
  }

  /**
   * Get workout data.
   */
  async getWorkouts(query?: DateRangeQuery): Promise<WorkoutResponse> {
    return this.fetch<WorkoutResponse>('workout', query);
  }

  /**
   * Get session/meditation data.
   */
  async getSessions(query?: DateRangeQuery): Promise<SessionResponse> {
    return this.fetch<SessionResponse>('session', query);
  }

  /**
   * Get user-created tags.
   */
  async getTags(query?: DateRangeQuery): Promise<TagResponse> {
    return this.fetch<TagResponse>('tag', query);
  }

  /**
   * Get user profile information.
   */
  async getPersonalInfo(): Promise<PersonalInfoResponse> {
    return this.fetch<PersonalInfoResponse>('personal_info');
  }

  /**
   * Fetch data from the Oura API with automatic token refresh.
   */
  private async fetch<T>(
    endpoint: string,
    query?: DateRangeQuery
  ): Promise<T> {
    // Load tokens from storage
    let tokens = await this.tokenStorage.load(this.userId);
    if (!tokens) {
      throw new OuraAPIError(
        'No tokens found. Please authenticate first.',
        401,
        'no_tokens'
      );
    }

    // Refresh tokens if needed
    tokens = await this.auth.getValidTokens(tokens);

    // Save refreshed tokens back to storage
    await this.tokenStorage.save(this.userId, tokens);

    // Build URL with query parameters
    const url = this.buildUrl(endpoint, query);

    // Make API request
    const response = await this.fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    // Handle rate limiting
    if (response.status === 429) {
      throw new OuraAPIError(
        'Rate limit exceeded. Please wait before making more requests.',
        429,
        'rate_limit_exceeded'
      );
    }

    // Handle membership required
    if (response.status === 403) {
      throw new OuraAPIError(
        'Oura membership required to access API data.',
        403,
        'membership_required'
      );
    }

    // Handle authentication errors
    if (response.status === 401) {
      // Token might be invalid, try refreshing once more
      tokens = await this.auth.refreshAccessToken(tokens.refreshToken);
      await this.tokenStorage.save(this.userId, tokens);

      // Retry the request
      const retryResponse = await this.fetchWithTimeout(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!retryResponse.ok) {
        const error = await this.parseErrorResponse(retryResponse);
        throw new OuraAPIError(
          error.message,
          retryResponse.status,
          error.code
        );
      }

      return (await retryResponse.json()) as T;
    }

    // Handle other errors
    if (!response.ok) {
      const error = await this.parseErrorResponse(response);
      throw new OuraAPIError(error.message, response.status, error.code);
    }

    return (await response.json()) as T;
  }

  /**
   * Build the full API URL with query parameters.
   */
  private buildUrl(endpoint: string, query?: DateRangeQuery): string {
    const url = new URL(`${OURA_API_BASE_URL}/${endpoint}`);
    if (query) {
      if (query.start_date) {
        url.searchParams.set('start_date', query.start_date);
      }
      if (query.end_date) {
        url.searchParams.set('end_date', query.end_date);
      }
    }
    return url.toString();
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
        message?: string;
      };
      return {
        message:
          data.error_description || data.message || data.error || 'Unknown error',
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
