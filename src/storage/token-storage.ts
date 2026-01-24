/**
 * Secure token storage with encryption at rest.
 *
 * Uses AES-256-GCM for authenticated encryption of tokens.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { OuraTokens } from '../oura/types.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits
const FILE_MODE = 0o600; // Owner read/write only

export interface TokenStorage {
  save(userId: string, tokens: OuraTokens): Promise<void>;
  load(userId: string): Promise<OuraTokens | null>;
  delete(userId: string): Promise<void>;
  exists(userId: string): Promise<boolean>;
}

export interface EncryptedData {
  iv: string; // hex
  authTag: string; // hex
  data: string; // hex
}

/**
 * File-based token storage with AES-256-GCM encryption.
 */
export class FileTokenStorage implements TokenStorage {
  private storagePath: string;
  private encryptionKey: Buffer;

  /**
   * Create a new FileTokenStorage.
   *
   * @param storagePath - Directory to store encrypted token files
   * @param encryptionKey - 32-byte encryption key (or string to derive key from)
   */
  constructor(storagePath: string, encryptionKey: string | Buffer) {
    this.storagePath = storagePath;
    this.encryptionKey = this.deriveKey(encryptionKey);
  }

  async save(userId: string, tokens: OuraTokens): Promise<void> {
    await this.ensureStorageDir();
    const encrypted = this.encrypt(JSON.stringify(tokens));
    const filePath = this.getFilePath(userId);
    await fs.writeFile(filePath, JSON.stringify(encrypted), {
      encoding: 'utf-8',
      mode: FILE_MODE,
    });
  }

  async load(userId: string): Promise<OuraTokens | null> {
    const filePath = this.getFilePath(userId);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const encrypted: EncryptedData = JSON.parse(content);
      const decrypted = this.decrypt(encrypted);
      return JSON.parse(decrypted);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async delete(userId: string): Promise<void> {
    const filePath = this.getFilePath(userId);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async exists(userId: string): Promise<boolean> {
    const filePath = this.getFilePath(userId);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private deriveKey(key: string | Buffer): Buffer {
    if (Buffer.isBuffer(key)) {
      if (key.length !== KEY_LENGTH) {
        throw new Error(`Encryption key must be ${KEY_LENGTH} bytes`);
      }
      return key;
    }

    // Derive a key from the string using PBKDF2
    // Using a fixed salt since we need deterministic key derivation
    // In production, consider using a per-installation salt stored separately
    const salt = 'health-data-aggregator-v1';
    return crypto.pbkdf2Sync(key, salt, 100000, KEY_LENGTH, 'sha256');
  }

  private encrypt(plaintext: string): EncryptedData {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.encryptionKey, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf-8'),
      cipher.final(),
    ]);

    return {
      iv: iv.toString('hex'),
      authTag: cipher.getAuthTag().toString('hex'),
      data: encrypted.toString('hex'),
    };
  }

  private decrypt(encrypted: EncryptedData): string {
    const iv = Buffer.from(encrypted.iv, 'hex');
    const authTag = Buffer.from(encrypted.authTag, 'hex');
    const data = Buffer.from(encrypted.data, 'hex');

    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      this.encryptionKey,
      iv,
      { authTagLength: AUTH_TAG_LENGTH }
    );
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf-8');
  }

  private getFilePath(userId: string): string {
    // Sanitize userId to prevent path traversal
    const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.storagePath, `${safeUserId}.token`);
  }

  private async ensureStorageDir(): Promise<void> {
    await fs.mkdir(this.storagePath, { recursive: true, mode: 0o700 });
  }
}

/**
 * In-memory token storage (for testing or temporary use).
 */
export class MemoryTokenStorage implements TokenStorage {
  private tokens = new Map<string, OuraTokens>();

  async save(userId: string, tokens: OuraTokens): Promise<void> {
    this.tokens.set(userId, { ...tokens });
  }

  async load(userId: string): Promise<OuraTokens | null> {
    const tokens = this.tokens.get(userId);
    return tokens ? { ...tokens } : null;
  }

  async delete(userId: string): Promise<void> {
    this.tokens.delete(userId);
  }

  async exists(userId: string): Promise<boolean> {
    return this.tokens.has(userId);
  }

  clear(): void {
    this.tokens.clear();
  }
}
