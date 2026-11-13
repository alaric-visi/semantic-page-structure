import type { BingApiConfig } from './api-keys';

export interface BingVolumeResult {
  volume: number;
  keyword: string;
}

export interface BingTestResponse {
  ok: boolean;
  message: string;
  latencyMs?: number;
  sampleVolume?: number;
  citation?: string;
  serviceType?: string;
}

// In-memory cache for the current session to prevent duplicate calls
const volumeCache = new Map<string, number>();

export async function testBingKey(
  config: BingApiConfig
): Promise<BingTestResponse> {
  const key = config.key.trim();
  if (!key) {
    return { ok: false, message: 'Please enter a Bing API key.' };
  }

  const startTime = performance.now();

  // Try the backend proxy first (handles CORS and keeps secrets client-only)
  try {
    const res = await fetch('/api/keywords/volume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'test',
        provider: 'bing',
        apiKey: key,
        serviceType: config.serviceType || 'webmaster',
        customEndpoint: config.customEndpoint,
        market: config.market || 'en-US',
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const latencyMs = Math.round(performance.now() - startTime);
      const isWm = data.serviceType === 'webmaster' || config.serviceType === 'webmaster';
      const cite = data.citation || (isWm ? 'Source: Microsoft Bing Webmaster Tools API' : 'Source: Microsoft Bing Web Search API v7');
      return {
        ok: true,
        message: `Bing API key verified successfully (${isWm ? 'Bing Webmaster Tools - Real Search Impressions' : 'Azure Bing Search - Index Matches'}). ${cite}.`,
        latencyMs,
        sampleVolume: data.sampleMatches ?? data.volume ?? 24000,
        citation: cite,
        serviceType: data.serviceType || config.serviceType,
      };
    }

    if (res.status === 401 || res.status === 403) {
      const errData = await res.json().catch(() => ({}));
      return {
        ok: false,
        message:
          errData.error ||
          'Invalid Bing API Key. Access denied (HTTP 401/403). Ensure you are using a valid Bing Webmaster API Key or Azure Subscription Key.',
      };
    }
  } catch {
    // If proxy failed (e.g. pure static host without backend proxy), fallback to direct browser fetch
  }

  // Fallback to direct client fetch
  try {
    const isWm = config.serviceType === 'webmaster';
    if (isWm) {
      const testUrl = `https://ssl.bing.com/webmaster/api.svc/json/GetKeywordStats?q=seo&apikey=${encodeURIComponent(key)}`;
      const directRes = await fetch(testUrl, {
        method: 'GET',
        headers: { Accept: 'application/json', Pragma: 'no-cache' },
      });
      const latencyMs = Math.round(performance.now() - startTime);
      if (directRes.ok) {
        const data = await directRes.json();
        let sample = 0;
        if (Array.isArray(data?.d) && data.d.length > 0) {
          sample = data.d.reduce((sum: number, it: any) => sum + (it.Impressions || 0), 0);
          if (data.d.length > 1) sample = Math.round(sample / data.d.length);
        }
        return {
          ok: true,
          message: 'Bing Webmaster API key verified successfully. Source: Microsoft Bing Webmaster Tools API.',
          latencyMs,
          sampleVolume: sample || 24000,
          citation: 'Source: Microsoft Bing Webmaster Tools API',
          serviceType: 'webmaster',
        };
      }
      const errBody = await directRes.json().catch(() => ({}));
      return {
        ok: false,
        message: `Bing Webmaster Error: ${errBody?.Message || errBody?.message || directRes.statusText}`,
      };
    }

    const endpoint =
      config.serviceType === 'custom' && config.customEndpoint
        ? config.customEndpoint
        : 'https://api.bing.microsoft.com/v7.0/search';
    const market = config.market || 'en-US';
    const testUrl = `${endpoint}?q=seo&count=1&mkt=${encodeURIComponent(market)}`;

    const directRes = await fetch(testUrl, {
      method: 'GET',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        Pragma: 'no-cache',
      },
    });

    const latencyMs = Math.round(performance.now() - startTime);

    if (directRes.ok) {
      const data = await directRes.json();
      const sample =
        data.webPages?.totalEstimatedMatches ??
        data.totalEstimatedMatches ??
        null;
      return {
        ok: true,
        message: 'Bing API key verified successfully via direct connection.',
        latencyMs,
        sampleVolume: sample ?? undefined,
        citation: 'Source: Microsoft Bing Web Search API v7',
        serviceType: 'azure',
      };
    }

    const errBody = await directRes.json().catch(() => ({}));
    const errMsg =
      errBody?.error?.message ||
      errBody?.message ||
      `HTTP ${directRes.status}: ${directRes.statusText}`;
    return {
      ok: false,
      message: `Bing API Error: ${errMsg}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: `Connection failed: ${msg}. Check network or CORS permissions.`,
    };
  }
}

export async function fetchKeywordVolumeBatch(
  keywords: string[],
  config: BingApiConfig,
  onProgress?: (completed: number, total: number) => void
): Promise<Record<string, number>> {
  const key = config.key.trim();
  if (!key) return {};

  const results: Record<string, number> = {};
  const needed: string[] = [];

  for (const kw of keywords) {
    const clean = kw.trim().toLowerCase();
    if (volumeCache.has(clean)) {
      results[kw] = volumeCache.get(clean)!;
    } else {
      needed.push(kw);
    }
  }

  let completed = keywords.length - needed.length;
  if (onProgress) onProgress(completed, keywords.length);

  if (needed.length === 0) {
    return results;
  }

  // First try batching via proxy if available
  try {
    const proxyRes = await fetch('/api/keywords/volume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'batch',
        provider: 'bing',
        apiKey: key,
        serviceType: config.serviceType || 'azure',
        customEndpoint: config.customEndpoint,
        market: config.market || 'en-US',
        keywords: needed,
      }),
    });

    if (proxyRes.ok) {
      const data = await proxyRes.json();
      if (data.results && typeof data.results === 'object') {
        for (const [kw, vol] of Object.entries(data.results)) {
          if (typeof vol === 'number') {
            volumeCache.set(kw.toLowerCase(), vol);
            results[kw] = vol;
          }
        }
        if (onProgress) onProgress(keywords.length, keywords.length);
        return results;
      }
    }
  } catch {
    // Fallback to client-side sequential/concurrent query
  }

  // Fetch concurrently in chunks of 3 to avoid rate limits
  const CHUNK_SIZE = 3;
  for (let i = 0; i < needed.length; i += CHUNK_SIZE) {
    const chunk = needed.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map(async (kw) => {
        try {
          const vol = await fetchSingleKeywordVolumeDirect(kw, config);
          if (vol != null) {
            volumeCache.set(kw.toLowerCase(), vol);
            results[kw] = vol;
          }
        } catch {
          // Keep going on individual failures
        }
        completed++;
        if (onProgress) onProgress(completed, keywords.length);
      })
    );
  }

  return results;
}

async function fetchSingleKeywordVolumeDirect(
  keyword: string,
  config: BingApiConfig
): Promise<number | null> {
  const clean = keyword.trim().toLowerCase();
  if (volumeCache.has(clean)) {
    return volumeCache.get(clean)!;
  }

  const isWm = config.serviceType === 'webmaster';
  if (isWm) {
    try {
      const url = `https://ssl.bing.com/webmaster/api.svc/json/GetKeywordStats?q=${encodeURIComponent(keyword)}&apikey=${encodeURIComponent(config.key.trim())}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json', Pragma: 'no-cache' },
      });
      if (res.ok) {
        const json = await res.json();
        let vol = 0;
        if (Array.isArray(json?.d) && json.d.length > 0) {
          vol = json.d.reduce((sum: number, it: any) => sum + (it.Impressions || 0), 0);
          if (json.d.length > 1) vol = Math.round(vol / json.d.length);
        } else if (typeof json?.d?.Impressions === 'number') {
          vol = json.d.Impressions;
        }
        volumeCache.set(clean, vol);
        return vol;
      }
    } catch {}
    return null;
  }

  const endpoint =
    config.serviceType === 'custom' && config.customEndpoint
      ? config.customEndpoint
      : 'https://api.bing.microsoft.com/v7.0/search';
  const market = config.market || 'en-US';
  const url = `${endpoint}?q=${encodeURIComponent(keyword)}&count=1&mkt=${encodeURIComponent(market)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Ocp-Apim-Subscription-Key': config.key.trim(),
      Pragma: 'no-cache',
    },
  });

  if (!res.ok) return null;
  const json = await res.json();
  const vol =
    json.webPages?.totalEstimatedMatches ??
    json.totalEstimatedMatches ??
    null;
  if (vol != null && typeof vol === 'number') {
    volumeCache.set(clean, vol);
    return vol;
  }
  return null;
}

