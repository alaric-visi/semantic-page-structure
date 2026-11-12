export interface BingApiConfig {
  key: string;
  serviceType: 'azure' | 'webmaster' | 'custom';
  customEndpoint?: string;
  market?: string;
  lastTested?: string;
  isValid?: boolean;
  lastError?: string;
  autoFetch?: boolean;
}

export interface StoredApiKeys {
  bing?: BingApiConfig;
  google?: { key: string };
  openai?: { key: string };
}

const STORAGE_KEY = 'ps_api_keys_v1';

export function getStoredApiKeys(): StoredApiKeys {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as StoredApiKeys;
  } catch {
    return {};
  }
}

export function saveStoredApiKeys(keys: StoredApiKeys): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch (err) {
    console.error('Failed to save API keys to localStorage:', err);
  }
}

export function getBingConfig(): BingApiConfig | null {
  const keys = getStoredApiKeys();
  if (keys.bing && keys.bing.key && keys.bing.key.trim()) {
    return keys.bing;
  }
  return null;
}

export function saveBingConfig(cfg: Partial<BingApiConfig>): StoredApiKeys {
  const current = getStoredApiKeys();
  const existing = current.bing || {
    key: '',
    serviceType: 'azure',
    market: 'en-US',
    autoFetch: false,
  };
  const updated: BingApiConfig = {
    ...existing,
    ...cfg,
    key: (cfg.key ?? existing.key).trim(),
  };
  current.bing = updated;
  saveStoredApiKeys(current);
  return current;
}

export function removeBingConfig(): StoredApiKeys {
  const current = getStoredApiKeys();
  delete current.bing;
  saveStoredApiKeys(current);
  return current;
}

export function clearAllApiKeys(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

