import { analyzeHtml } from './analyzer';
import { FetchError, safeFetch } from './safe-fetch';

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB

const JSON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

export async function handleAnalyzeRequest(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'POST only.' }, 405);
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (contentLength > MAX_BODY_BYTES) {
    return jsonResponse(
      { error: 'Request body exceeds the 2 MB limit.' },
      413
    );
  }

  let rawText: string;
  try {
    rawText = await request.text();
  } catch {
    return jsonResponse({ error: 'Could not read request body.' }, 400);
  }

  if (rawText.length > MAX_BODY_BYTES) {
    return jsonResponse(
      { error: 'Request body exceeds the 2 MB limit.' },
      413
    );
  }

  let payload: { url?: unknown; html?: unknown };
  try {
    payload = JSON.parse(rawText || '{}');
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400);
  }

  let url = typeof payload.url === 'string' ? payload.url.trim() : '';
  const html = typeof payload.html === 'string' ? payload.html.trim() : '';

  if (url && !/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }

  try {
    if (html) {
      const data = analyzeHtml(html, url);
      return jsonResponse(data, 200);
    }
    if (!url) {
      return jsonResponse(
        { error: 'Provide a URL (or pasted HTML) to analyze.' },
        400
      );
    }

    const fetched = await safeFetch(url);
    const data = analyzeHtml(fetched.html, fetched.finalUrl);
    data.requested_url = url;
    data.http_status = fetched.status;
    return jsonResponse(data, 200);
  } catch (err) {
    if (err instanceof FetchError) {
      const code =
        err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 400;
      return jsonResponse({ error: err.message }, code);
    }
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: `Analysis failed: ${msg}` }, 500);
  }
}

export async function handleVolumeRequest(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'POST only.' }, 405);
  }

  let rawText: string;
  try {
    rawText = await request.text();
  } catch {
    return jsonResponse({ error: 'Could not read request body.' }, 400);
  }

  let payload: {
    action?: string;
    provider?: string;
    apiKey?: string;
    serviceType?: string;
    customEndpoint?: string;
    market?: string;
    keywords?: string[];
  };

  try {
    payload = JSON.parse(rawText || '{}');
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400);
  }

  const apiKey = (payload.apiKey || '').trim();
  if (!apiKey) {
    return jsonResponse({ error: 'No API key provided.' }, 400);
  }

  const endpoint =
    payload.serviceType === 'custom' && payload.customEndpoint
      ? payload.customEndpoint
      : 'https://api.bing.microsoft.com/v7.0/search';
  const mkt = payload.market || 'en-US';

  if (payload.action === 'test') {
    try {
      const testUrl = `${endpoint}?q=seo&count=1&mkt=${encodeURIComponent(mkt)}`;
      const res = await fetch(testUrl, {
        method: 'GET',
        headers: {
          'Ocp-Apim-Subscription-Key': apiKey,
          Pragma: 'no-cache',
        },
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const errMsg =
          errJson?.error?.message ||
          errJson?.message ||
          `Bing API returned HTTP ${res.status}: ${res.statusText}`;
        return jsonResponse(
          { error: errMsg },
          res.status >= 400 && res.status < 600 ? res.status : 400
        );
      }

      const json = await res.json();
      const sampleMatches =
        json.webPages?.totalEstimatedMatches ??
        json.totalEstimatedMatches ??
        null;
      return jsonResponse({ ok: true, sampleMatches }, 200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonResponse({ error: `Connection failed: ${msg}` }, 500);
    }
  }

  const keywords = Array.isArray(payload.keywords) ? payload.keywords : [];
  if (!keywords.length) {
    return jsonResponse({ error: 'No keywords provided.' }, 400);
  }

  const results: Record<string, number> = {};
  const batch = keywords.slice(0, 40);

  await Promise.all(
    batch.map(async (kw) => {
      try {
        const url = `${endpoint}?q=${encodeURIComponent(kw)}&count=1&mkt=${encodeURIComponent(mkt)}`;
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            'Ocp-Apim-Subscription-Key': apiKey,
            Pragma: 'no-cache',
          },
        });
        if (res.ok) {
          const json = await res.json();
          const vol =
            json.webPages?.totalEstimatedMatches ??
            json.totalEstimatedMatches ??
            null;
          if (vol != null && typeof vol === 'number') {
            results[kw] = vol;
          }
        }
      } catch {
        // Individual keyword failures don't abort batch
      }
    })
  );

  return jsonResponse({ ok: true, results }, 200);
}

export async function handleApiRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (
    url.pathname === '/api/keywords/volume' ||
    url.pathname === '/api/volume'
  ) {
    return handleVolumeRequest(request);
  }
  return handleAnalyzeRequest(request);
}

