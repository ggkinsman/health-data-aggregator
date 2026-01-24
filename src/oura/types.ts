/**
 * Oura API OAuth2 types
 */

export interface OuraOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface OuraTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp in milliseconds
  tokenType: string;
  scope: string;
}

export interface OuraTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds until expiration
  token_type: string;
  scope: string;
}

export type OuraScope =
  | 'personal'
  | 'daily'
  | 'heartrate'
  | 'workout'
  | 'tag'
  | 'session'
  | 'spo2';

export const ALL_OURA_SCOPES: OuraScope[] = [
  'personal',
  'daily',
  'heartrate',
  'workout',
  'tag',
  'session',
  'spo2',
];

export interface OuraAuthError {
  error: string;
  error_description?: string;
}

export class OuraAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public errorCode?: string
  ) {
    super(message);
    this.name = 'OuraAPIError';
  }
}

export class OuraMembershipError extends OuraAPIError {
  constructor(message: string = 'Oura membership required to access API') {
    super(message, 403, 'membership_required');
    this.name = 'OuraMembershipError';
  }
}

export class OuraTokenExpiredError extends OuraAPIError {
  constructor(message: string = 'Access token has expired') {
    super(message, 401, 'token_expired');
    this.name = 'OuraTokenExpiredError';
  }
}
