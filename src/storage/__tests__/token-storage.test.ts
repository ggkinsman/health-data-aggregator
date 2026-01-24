import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { FileTokenStorage, MemoryTokenStorage } from '../token-storage.js';
import type { OuraTokens } from '../../oura/types.js';

const mockTokens: OuraTokens = {
  accessToken: 'test-access-token',
  refreshToken: 'test-refresh-token',
  expiresAt: Date.now() + 3600 * 1000,
  tokenType: 'Bearer',
  scope: 'daily heartrate',
};

describe('MemoryTokenStorage', () => {
  let storage: MemoryTokenStorage;

  beforeEach(() => {
    storage = new MemoryTokenStorage();
  });

  it('should save and load tokens', async () => {
    await storage.save('user-1', mockTokens);
    const loaded = await storage.load('user-1');

    expect(loaded).toEqual(mockTokens);
  });

  it('should return null for non-existent user', async () => {
    const loaded = await storage.load('non-existent');

    expect(loaded).toBeNull();
  });

  it('should delete tokens', async () => {
    await storage.save('user-1', mockTokens);
    await storage.delete('user-1');
    const loaded = await storage.load('user-1');

    expect(loaded).toBeNull();
  });

  it('should check if tokens exist', async () => {
    expect(await storage.exists('user-1')).toBe(false);

    await storage.save('user-1', mockTokens);

    expect(await storage.exists('user-1')).toBe(true);
  });

  it('should isolate tokens between users', async () => {
    const tokens2: OuraTokens = { ...mockTokens, accessToken: 'user-2-token' };

    await storage.save('user-1', mockTokens);
    await storage.save('user-2', tokens2);

    expect((await storage.load('user-1'))?.accessToken).toBe('test-access-token');
    expect((await storage.load('user-2'))?.accessToken).toBe('user-2-token');
  });

  it('should return copies of tokens (not references)', async () => {
    await storage.save('user-1', mockTokens);
    const loaded1 = await storage.load('user-1');
    const loaded2 = await storage.load('user-1');

    expect(loaded1).not.toBe(loaded2); // Different objects
    expect(loaded1).toEqual(loaded2); // Same content
  });

  it('should clear all tokens', async () => {
    await storage.save('user-1', mockTokens);
    await storage.save('user-2', mockTokens);
    storage.clear();

    expect(await storage.exists('user-1')).toBe(false);
    expect(await storage.exists('user-2')).toBe(false);
  });
});

describe('FileTokenStorage', () => {
  let storage: FileTokenStorage;
  let tempDir: string;
  const encryptionKey = 'test-encryption-key-for-testing';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'token-storage-test-'));
    storage = new FileTokenStorage(tempDir, encryptionKey);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should save and load tokens with encryption', async () => {
    await storage.save('user-1', mockTokens);
    const loaded = await storage.load('user-1');

    expect(loaded).toEqual(mockTokens);
  });

  it('should return null for non-existent user', async () => {
    const loaded = await storage.load('non-existent');

    expect(loaded).toBeNull();
  });

  it('should delete tokens', async () => {
    await storage.save('user-1', mockTokens);
    await storage.delete('user-1');
    const loaded = await storage.load('user-1');

    expect(loaded).toBeNull();
  });

  it('should not throw when deleting non-existent tokens', async () => {
    await expect(storage.delete('non-existent')).resolves.not.toThrow();
  });

  it('should check if tokens exist', async () => {
    expect(await storage.exists('user-1')).toBe(false);

    await storage.save('user-1', mockTokens);

    expect(await storage.exists('user-1')).toBe(true);
  });

  it('should encrypt tokens at rest', async () => {
    await storage.save('user-1', mockTokens);

    // Read the raw file
    const files = await fs.readdir(tempDir);
    expect(files.length).toBe(1);

    const rawContent = await fs.readFile(path.join(tempDir, files[0]), 'utf-8');
    const parsed = JSON.parse(rawContent);

    // File should contain encrypted data, not raw tokens
    expect(parsed).toHaveProperty('iv');
    expect(parsed).toHaveProperty('authTag');
    expect(parsed).toHaveProperty('data');
    expect(rawContent).not.toContain(mockTokens.accessToken);
  });

  it('should set restrictive file permissions (owner-only)', async () => {
    await storage.save('user-1', mockTokens);

    const files = await fs.readdir(tempDir);
    const filePath = path.join(tempDir, files[0]);
    const stats = await fs.stat(filePath);

    // Check file permissions are 0600 (owner read/write only)
    // mode includes file type bits, so mask with 0o777 to get just permissions
    const permissions = stats.mode & 0o777;
    expect(permissions).toBe(0o600);
  });

  it('should set restrictive directory permissions', async () => {
    // Trigger directory creation by saving
    await storage.save('user-1', mockTokens);

    const stats = await fs.stat(tempDir);
    const permissions = stats.mode & 0o777;

    // Directory should be 0700 (owner only)
    expect(permissions).toBe(0o700);
  });

  it('should fail to decrypt with wrong key', async () => {
    await storage.save('user-1', mockTokens);

    // Create new storage with different key
    const wrongKeyStorage = new FileTokenStorage(tempDir, 'wrong-key');

    await expect(wrongKeyStorage.load('user-1')).rejects.toThrow();
  });

  it('should sanitize user IDs to prevent path traversal', async () => {
    const maliciousUserId = '../../../etc/passwd';
    await storage.save(maliciousUserId, mockTokens);

    const files = await fs.readdir(tempDir);
    expect(files.length).toBe(1);
    // Should not contain path separators
    expect(files[0]).not.toContain('/');
    expect(files[0]).not.toContain('..');
  });

  it('should handle concurrent saves', async () => {
    const saves = Array.from({ length: 10 }, (_, i) => {
      const tokens: OuraTokens = { ...mockTokens, accessToken: `token-${i}` };
      return storage.save(`user-${i}`, tokens);
    });

    await Promise.all(saves);

    // Verify all saved correctly
    for (let i = 0; i < 10; i++) {
      const loaded = await storage.load(`user-${i}`);
      expect(loaded?.accessToken).toBe(`token-${i}`);
    }
  });

  it('should accept a Buffer encryption key', async () => {
    const bufferKey = Buffer.alloc(32, 'a'); // 32 bytes
    const bufferStorage = new FileTokenStorage(tempDir, bufferKey);

    await bufferStorage.save('user-buffer', mockTokens);
    const loaded = await bufferStorage.load('user-buffer');

    expect(loaded).toEqual(mockTokens);
  });

  it('should reject invalid Buffer key length', () => {
    const shortKey = Buffer.alloc(16, 'a'); // Only 16 bytes

    expect(() => new FileTokenStorage(tempDir, shortKey))
      .toThrow('Encryption key must be 32 bytes');
  });
});
