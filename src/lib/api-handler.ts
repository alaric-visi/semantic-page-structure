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

