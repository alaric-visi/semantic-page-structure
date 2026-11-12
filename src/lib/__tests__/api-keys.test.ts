import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getStoredApiKeys,
  saveBingConfig,
  getBingConfig,
  removeBingConfig,
  clearAllApiKeys,
} from '../api-keys';
import { handleVolumeRequest, handleApiRequest } from '../api-handler';

describe('Client-Side API Key Storage', () => {
  const mockStorage: Record<string, string> = {};

  beforeEach(() => {
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);

    // Mock localStorage for node test environment
    const localStorageMock = {
      getItem: vi.fn((key: string) => mockStorage[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        mockStorage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockStorage[key];
      }),
      clear: vi.fn(() => {
        Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
      }),
    };

    vi.stubGlobal('localStorage', localStorageMock);
    vi.stubGlobal('window', { localStorage: localStorageMock });
  });

  it('stores and retrieves Bing configuration with clean trimming', () => {
    expect(getStoredApiKeys()).toEqual({});
    expect(getBingConfig()).toBeNull();

    saveBingConfig({
      key: '   azure-bing-test-key-123   ',
      serviceType: 'azure',
      market: 'en-US',
      autoFetch: true,
    });

    const bing = getBingConfig();
    expect(bing).not.toBeNull();
    expect(bing?.key).toBe('azure-bing-test-key-123');
    expect(bing?.serviceType).toBe('azure');
    expect(bing?.autoFetch).toBe(true);
    expect(bing?.market).toBe('en-US');
  });

  it('removes Bing configuration safely while leaving others intact', () => {
    saveBingConfig({ key: 'test-key' });
    expect(getBingConfig()).not.toBeNull();

    removeBingConfig();
    expect(getBingConfig()).toBeNull();
    expect(getStoredApiKeys()).toEqual({});
  });

  it('clears all API keys completely', () => {
    saveBingConfig({ key: 'test-key-all' });
    expect(getBingConfig()).not.toBeNull();

    clearAllApiKeys();
    expect(getStoredApiKeys()).toEqual({});
  });
});

describe('Volume Request Proxy Handler', () => {
  it('rejects non-POST methods with 405', async () => {
    const req = new Request('http://localhost/api/keywords/volume', {
      method: 'GET',
    });
    const res = await handleVolumeRequest(req);
    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body.error).toContain('POST only');
  });

  it('rejects requests missing an API key with 400', async () => {
    const req = new Request('http://localhost/api/keywords/volume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'test' }),
    });
    const res = await handleVolumeRequest(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('No API key provided');
  });

  it('routes correctly via handleApiRequest', async () => {
    const req = new Request('http://localhost/api/keywords/volume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'test' }),
    });
    const res = await handleApiRequest(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('No API key provided');
  });
});

