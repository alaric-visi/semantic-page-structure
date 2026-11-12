import './styles.css';
import * as d3 from 'd3';
import type {
  AnalysisResult,
  ClusterEntry,
  KeywordEntry,
  SectionEntry,
} from './lib/types';
import {
  getStoredApiKeys,
  getBingConfig,
  saveBingConfig,
  removeBingConfig,
  clearAllApiKeys,
  type BingApiConfig,
} from './lib/api-keys';
import { testBingKey, fetchKeywordVolumeBatch } from './lib/bing-service';

interface ClientKeyword extends KeywordEntry {
  _inHeadings: number[];
  _supports: number[];
}

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  type: 'root' | 'cluster' | 'section' | 'kw';
  other?: boolean;
  label: string;
  r: number;
  dup?: boolean;
  ref: any;
  // 3D layout (Network + Heading hierarchy only)
  z?: number;
  vz?: number;
  _px?: number;
  _py?: number;
  _pz?: number;
  _ps?: number;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
  kind: 'tree' | 'heading' | 'support' | 'cooc';
  dist: number;
  w?: number;
}

const SAMPLE_HTML = `<!doctype html>
<html lang="en">
<head>
  <title>Technical SEO Audit Guide: Crawlability, Indexing &amp; Core Web Vitals | SearchLab</title>
  <meta name="description" content="Complete technical SEO audit guide covering crawlability, XML sitemaps, canonical tags, structured data, site architecture and Core Web Vitals performance.">
  <link rel="canonical" href="https://example.com/technical-seo-audit-guide">
</head>
<body>
  <main>
    <h1>Technical SEO Audit Guide</h1>
    <p>A comprehensive <strong>technical SEO audit</strong> ensures search engines can crawl, render and index your site architecture without friction. Modern technical SEO combines crawl budget management, clean internal linking, canonical tags and fast Core Web Vitals.</p>

    <h2>Crawlability and Robots Directives</h2>
    <p>Search engine crawlers start with your robots.txt file and XML sitemaps. During a technical SEO audit, inspect server log files to see how Googlebot allocates crawl budget across indexable pages versus duplicate URL parameters.</p>
    <p>Use robots meta tags and X-Robots-Tag headers carefully so important category pages and product templates remain open to crawlability and indexing.</p>

    <h3>XML Sitemaps and Discovery</h3>
    <p>Dynamic XML sitemaps should list only canonical, 200-status URLs. Submitting clean XML sitemaps in Google Search Console accelerates discovery of new content and highlights indexing gaps across large site architectures.</p>

    <h2>Indexing, Canonical Tags and Duplicate Content</h2>
    <p>Duplicate content dilutes ranking signals across multiple URLs. Self-referencing <strong>canonical tags</strong> consolidate link equity and tell search engines which version of a page should rank in organic search results.</p>
    <p>Audit faceted navigation, pagination and trailing-slash redirects so canonical tags, internal links and XML sitemaps all point to the same primary URL.</p>

    <h2>Site Architecture and Internal Linking</h2>
    <p>A shallow, logical site architecture keeps high-priority pages within three clicks of the homepage. Topic clusters connected by descriptive anchor text pass topical authority from pillar guides to supporting articles.</p>
    <img src="/architecture-diagram.png" alt="Technical SEO site architecture and internal linking diagram">

    <h2>Core Web Vitals and Page Experience</h2>
    <p>Core Web Vitals measure real-user loading performance, interactivity and visual stability. Optimise Largest Contentful Paint (LCP), Interaction to Next Paint (INP) and Cumulative Layout Shift (CLS) by compressing hero images, deferring non-critical JavaScript and reserving layout space.</p>

    <h2>Structured Data and Schema Markup</h2>
    <p>Implementing JSON-LD structured data helps search engines understand entities, breadcrumbs, FAQs and software applications. Validate schema markup during every technical SEO audit to qualify for rich results.</p>
  </main>
</body>
</html>`;

const SAMPLE_URL = 'https://example.com/technical-seo-audit-guide';

function initStudio(): void {
  const rootEl = document.getElementById('page-structure-studio');
  if (!rootEl) return;

  const $ = <T extends Element = HTMLElement>(s: string): T | null =>
    rootEl.querySelector<T>(s);
  const $$ = <T extends Element = HTMLElement>(s: string): T[] =>
    Array.from(rootEl.querySelectorAll<T>(s));

  const esc = (s: unknown): string =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c] || c
    );

  const css = (v: string): string =>
    getComputedStyle(rootEl).getPropertyValue(v).trim();
  const fmt = (n: unknown): string => Number(n ?? 0).toLocaleString();

  const state: {
    data: AnalysisResult | null;
    kwById: Record<string, ClientKeyword>;
    secById: Record<number, SectionEntry>;
    mode: 'clusters' | 'structure';
    layout: 'network' | 'tree';
    limit: number;
    cooc: boolean;
    allLabels: boolean;
    sort: { key: string; dir: 1 | -1 };
    filter: string;
    tier: string;
    cluster: string;
    selected: string | null;
    zoom: d3.ZoomBehavior<SVGSVGElement, unknown> | null;
    _graph: {
      node?: d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown>;
      link?: d3.Selection<SVGLineElement, GraphLink, SVGGElement, unknown>;
      links: GraphLink[];
      onHighlight?: () => void;
    } | null;
  } = {
    data: null,
    kwById: {},
    secById: {},
    mode: 'clusters',
    layout: 'network',
    limit: 50,
    cooc: false,
    allLabels: false,
    sort: { key: 'relevance', dir: -1 },
    filter: '',
    tier: 'all',
    cluster: 'all',
    selected: null,
    zoom: null,
    _graph: null,
  };

  // ------------------------------------------------------------------ View Switcher, Collapsible Left Panel & Split Resizer
  const viewButtons = $$<HTMLButtonElement>('.segment-btn[data-view]');
  const btnCollapseSidebar = $<HTMLButtonElement>('#btn-collapse-sidebar');
  const btnToggleSidebar = $<HTMLButtonElement>('#btn-toggle-sidebar');
  const btnToggleSidebarLabel = $('#btn-toggle-sidebar-label');
  const sidebarCollapsedRail = $<HTMLButtonElement>('#sidebar-collapsed-rail');

  const graphPanelEl = $('#p-graph');
  const graphFullscreenBtn = $<HTMLButtonElement>('#graphFullscreenBtn');
  const graphExitFullscreenBtn = $<HTMLButtonElement>('#graphExitFullscreenBtn');

  function setGraphFullscreen(on: boolean, moveFocus = false): void {
    if (!graphPanelEl) return;
    const wasOn = graphPanelEl.classList.contains('is-fullscreen');
    if (wasOn === on) return;
    graphPanelEl.classList.toggle('is-fullscreen', on);
    rootEl!.classList.toggle('is-graph-fullscreen', on);
    graphFullscreenBtn?.setAttribute('aria-pressed', String(on));
    if (moveFocus) {
      (on ? graphExitFullscreenBtn : graphFullscreenBtn)?.focus();
    }
    if (state.data && graphPanelEl.classList.contains('on')) {
      requestAnimationFrame(() => renderGraph());
    }
  }

  graphFullscreenBtn?.addEventListener('click', () => {
    setGraphFullscreen(true, true);
  });

  graphExitFullscreenBtn?.addEventListener('click', () => {
    setGraphFullscreen(false, true);
  });

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (rootEl?.getAttribute('data-active-page') === 'keys') {
        closeApiKeysPage();
        return;
      }
      if (graphPanelEl?.classList.contains('is-fullscreen')) {
        setGraphFullscreen(false, true);
      }
    }
  });

  // ------------------------------------------------------------------ Dedicated API Keys Page Controller
  const btnApiKeys = $<HTMLButtonElement>('#btn-api-keys');
  const btnBackToStudio = $<HTMLButtonElement>('#btn-back-to-studio');
  const pageApiKeys = $('#page-api-keys');
  const headerKeyDot = $('#header-key-dot');

  // Form elements inside Bing card
  const bingApiKeyInput = $<HTMLInputElement>('#bingApiKeyInput');
  const btnToggleBingKeyVis = $<HTMLButtonElement>('#btnToggleBingKeyVis');
  const btnClearBingKeyInput = $<HTMLButtonElement>('#btnClearBingKeyInput');
  const bingServiceType = $<HTMLSelectElement>('#bingServiceType');
  const bingMarket = $<HTMLSelectElement>('#bingMarket');
  const bingCustomEndpointGroup = $('#bingCustomEndpointGroup');
  const bingCustomEndpointInput = $<HTMLInputElement>('#bingCustomEndpointInput');
  const bingAutoFetchCheck = $<HTMLInputElement>('#bingAutoFetchCheck');
  const btnSaveBingKey = $<HTMLButtonElement>('#btnSaveBingKey');
  const btnTestBingKey = $<HTMLButtonElement>('#btnTestBingKey');
  const btnRemoveBingKey = $<HTMLButtonElement>('#btnRemoveBingKey');
  const bingTestFeedback = $('#bingTestFeedback');
  const bingCardStatus = $('#bingCardStatus');
  const btnClearAllKeys = $<HTMLButtonElement>('#btnClearAllKeys');

  function updateKeyIndicator(): void {
    const bing = getBingConfig();
    const hasKey = Boolean(bing?.key);
    headerKeyDot?.classList.toggle('dot-active', hasKey);
    headerKeyDot?.setAttribute(
      'title',
      hasKey
        ? `Bing API key configured (${bing?.serviceType || 'azure'})`
        : 'No API keys set'
    );
  }

  function updateBingCardStatus(
    status: 'connected' | 'inactive' | 'testing' | 'error',
    text?: string
  ): void {
    if (!bingCardStatus) return;
    const dot = bingCardStatus.querySelector('.status-dot');
    const label = bingCardStatus.querySelector('.status-label');
    if (dot) {
      dot.className = `status-dot ${
        status === 'connected'
          ? 'dot-active'
          : status === 'testing'
            ? 'dot-testing'
            : 'dot-inactive'
      }`;
    }
    if (label) {
      label.textContent =
        text ||
        (status === 'connected'
          ? 'Connected & Ready'
          : status === 'testing'
            ? 'Testing connection…'
            : status === 'error'
              ? 'Key error'
              : 'Not configured');
    }
  }

  function syncBingFormFromStorage(): void {
    const bing = getBingConfig();
    if (bingApiKeyInput) bingApiKeyInput.value = bing?.key || '';
    if (bingServiceType) bingServiceType.value = bing?.serviceType || 'azure';
    if (bingMarket) bingMarket.value = bing?.market || 'en-US';
    if (bingCustomEndpointInput) {
      bingCustomEndpointInput.value = bing?.customEndpoint || '';
    }
    if (bingCustomEndpointGroup) {
      bingCustomEndpointGroup.hidden = bing?.serviceType !== 'custom';
    }
    if (bingAutoFetchCheck) {
      bingAutoFetchCheck.checked = Boolean(bing?.autoFetch);
    }
    updateBingCardStatus(bing?.key ? 'connected' : 'inactive');
    if (bingTestFeedback) {
      bingTestFeedback.hidden = true;
      bingTestFeedback.className = 'api-test-feedback';
      bingTestFeedback.textContent = '';
    }
  }

  function openApiKeysPage(): void {
    setGraphFullscreen(false);
    rootEl!.setAttribute('data-active-page', 'keys');
    pageApiKeys?.removeAttribute('hidden');
    syncBingFormFromStorage();
    if (window.location.hash !== '#api-keys') {
      window.location.hash = 'api-keys';
    }
  }

  function closeApiKeysPage(): void {
    rootEl!.removeAttribute('data-active-page');
    pageApiKeys?.setAttribute('hidden', '');
    updateKeyIndicator();
    if (window.location.hash === '#api-keys') {
      history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search
      );
    }
    if (state.data) {
      renderTable();
      renderDetail(null);
    }
  }

  btnApiKeys?.addEventListener('click', () => {
    if (rootEl!.getAttribute('data-active-page') === 'keys') {
      closeApiKeysPage();
    } else {
      openApiKeysPage();
    }
  });

  btnBackToStudio?.addEventListener('click', () => {
    closeApiKeysPage();
  });

  btnToggleBingKeyVis?.addEventListener('click', () => {
    if (!bingApiKeyInput) return;
    const isPass = bingApiKeyInput.type === 'password';
    bingApiKeyInput.type = isPass ? 'text' : 'password';
    btnToggleBingKeyVis.setAttribute(
      'title',
      isPass ? 'Hide key' : 'Show key'
    );
  });

  btnClearBingKeyInput?.addEventListener('click', () => {
    if (bingApiKeyInput) {
      bingApiKeyInput.value = '';
      bingApiKeyInput.focus();
    }
  });

  bingServiceType?.addEventListener('change', () => {
    if (bingCustomEndpointGroup) {
      bingCustomEndpointGroup.hidden = bingServiceType.value !== 'custom';
    }
  });

  btnSaveBingKey?.addEventListener('click', () => {
    const key = bingApiKeyInput?.value.trim() || '';
    if (!key) {
      removeBingConfig();
      updateBingCardStatus('inactive', 'Not configured');
      updateKeyIndicator();
      if (bingTestFeedback) {
        bingTestFeedback.hidden = false;
        bingTestFeedback.className = 'api-test-feedback is-error';
        bingTestFeedback.textContent = 'Bing API key cleared.';
      }
      return;
    }

    const cfg: Partial<BingApiConfig> = {
      key,
      serviceType: (bingServiceType?.value as any) || 'azure',
      market: bingMarket?.value || 'en-US',
      customEndpoint: bingCustomEndpointInput?.value.trim(),
      autoFetch: bingAutoFetchCheck?.checked ?? false,
    };
    saveBingConfig(cfg);
    updateBingCardStatus('connected', 'Saved & Connected');
    updateKeyIndicator();

    if (bingTestFeedback) {
      bingTestFeedback.hidden = false;
      bingTestFeedback.className = 'api-test-feedback is-success';
      bingTestFeedback.textContent =
        '✓ Bing API key saved safely in your browser storage. You can now fetch real search volumes!';
    }
  });

  btnTestBingKey?.addEventListener('click', async () => {
    const key = bingApiKeyInput?.value.trim() || '';
    if (!key) {
      if (bingTestFeedback) {
        bingTestFeedback.hidden = false;
        bingTestFeedback.className = 'api-test-feedback is-error';
        bingTestFeedback.textContent = 'Please enter an API key to test.';
      }
      return;
    }

    const cfg: BingApiConfig = {
      key,
      serviceType: (bingServiceType?.value as any) || 'azure',
      market: bingMarket?.value || 'en-US',
      customEndpoint: bingCustomEndpointInput?.value.trim(),
    };

    updateBingCardStatus('testing');
    if (btnTestBingKey) btnTestBingKey.disabled = true;
    if (bingTestFeedback) {
      bingTestFeedback.hidden = false;
      bingTestFeedback.className = 'api-test-feedback is-loading';
      bingTestFeedback.textContent = 'Connecting to Microsoft Bing API…';
    }

    try {
      const res = await testBingKey(cfg);
      if (res.ok) {
        updateBingCardStatus('connected', 'Verified & Working');
        saveBingConfig({ ...cfg, isValid: true });
        updateKeyIndicator();
        if (bingTestFeedback) {
          bingTestFeedback.className = 'api-test-feedback is-success';
          const sampleText =
            res.sampleVolume != null
              ? ` Sample search test query ("seo") found ${fmt(res.sampleVolume)} estimated matches.`
              : '';
          bingTestFeedback.textContent = `✓ Success: ${res.message} (latency ${res.latencyMs}ms).${sampleText}`;
        }
      } else {
        updateBingCardStatus('error', 'Connection failed');
        if (bingTestFeedback) {
          bingTestFeedback.className = 'api-test-feedback is-error';
          bingTestFeedback.textContent = `✗ ${res.message}`;
        }
      }
    } finally {
      if (btnTestBingKey) btnTestBingKey.disabled = false;
    }
  });

  btnRemoveBingKey?.addEventListener('click', () => {
    removeBingConfig();
    if (bingApiKeyInput) bingApiKeyInput.value = '';
    updateBingCardStatus('inactive');
    updateKeyIndicator();
    if (bingTestFeedback) {
      bingTestFeedback.hidden = false;
      bingTestFeedback.className = 'api-test-feedback';
      bingTestFeedback.textContent =
        'Bing API key removed from browser storage.';
    }
  });

  btnClearAllKeys?.addEventListener('click', () => {
    if (confirm('Clear all stored API keys from this browser?')) {
      clearAllApiKeys();
      syncBingFormFromStorage();
      updateKeyIndicator();
    }
  });

  // Global delegation for opening API keys from table links or detail inspector
  rootEl?.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>(
      '[data-action="open-keys"], .btn-table-key-link'
    );
    if (target) {
      e.preventDefault();
      openApiKeysPage();
    }
  });

  // Check URL hash on startup for direct link to API keys page
  if (window.location.hash === '#api-keys') {
    openApiKeysPage();
  }
  updateKeyIndicator();

  function setViewMode(v: string): void {
    if (v === 'input') setGraphFullscreen(false);
    rootEl!.setAttribute('data-view', v);
    const isLeftOpen = v !== 'output';
    viewButtons.forEach((b) => {
      const active = b.dataset.view === v;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    btnCollapseSidebar?.setAttribute('aria-expanded', String(isLeftOpen));
    btnToggleSidebar?.setAttribute('aria-expanded', String(isLeftOpen));
    sidebarCollapsedRail?.setAttribute('aria-expanded', String(isLeftOpen));
    if (btnToggleSidebarLabel) {
      btnToggleSidebarLabel.textContent = isLeftOpen
        ? 'Hide Input'
        : 'Open Input';
    }
    if (v !== 'input' && state.data) {
      setTimeout(() => renderGraph(), 60);
    }
  }

  viewButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      setViewMode(btn.dataset.view || 'split');
    });
  });

  btnCollapseSidebar?.addEventListener('click', () => {
    setViewMode('output');
  });

  sidebarCollapsedRail?.addEventListener('click', () => {
    setViewMode('split');
  });

  btnToggleSidebar?.addEventListener('click', () => {
    const cur = rootEl!.getAttribute('data-view') || 'split';
    setViewMode(cur === 'output' ? 'split' : 'output');
  });

  const resizer = $('#split-resizer');
  const workspace = $('#workspace');
  const leftPanel = $('#panel-input');
  if (resizer && workspace && leftPanel) {
    let dragging = false;
    resizer.addEventListener('pointerdown', (e: PointerEvent) => {
      dragging = true;
      resizer.classList.add('is-resizing');
      resizer.setPointerCapture(e.pointerId);
    });
    resizer.addEventListener('pointermove', (e: PointerEvent) => {
      if (!dragging) return;
      const rect = workspace.getBoundingClientRect();
      const pct = Math.min(62, Math.max(24, ((e.clientX - rect.left) / rect.width) * 100));
      leftPanel.style.width = `${pct.toFixed(1)}%`;
    });
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      resizer.classList.remove('is-resizing');
      if (state.data) renderGraph();
    };
    resizer.addEventListener('pointerup', endDrag);
    resizer.addEventListener('pointercancel', endDrag);
  }

  // ------------------------------------------------------------------ Fetch & Input Controls
  const toggleHtmlBtn = $<HTMLButtonElement>('#toggleHtml');
  const htmlBox = $('#htmlBox');
  const inputModeBadge = $('#input-mode-badge');

  toggleHtmlBtn?.addEventListener('click', () => {
    if (!htmlBox || !toggleHtmlBtn) return;
    const open = htmlBox.style.display === 'flex';
    htmlBox.style.display = open ? 'none' : 'flex';
    toggleHtmlBtn.textContent = open ? 'Paste HTML instead' : 'Hide HTML box';
    if (inputModeBadge) {
      inputModeBadge.textContent = open ? 'URL Fetch' : 'Pasted HTML';
    }
  });

  $$<HTMLButtonElement>('.demo').forEach((b) => {
    b.addEventListener('click', () => {
      const urlInput = $<HTMLInputElement>('#url');
      if (urlInput && b.dataset.url) {
        urlInput.value = b.dataset.url;
        if (htmlBox && htmlBox.style.display === 'flex') {
          htmlBox.style.display = 'none';
          if (toggleHtmlBtn) toggleHtmlBtn.textContent = 'Paste HTML instead';
          if (inputModeBadge) inputModeBadge.textContent = 'URL Fetch';
        }
        analyze();
      }
    });
  });

  const runInstantSample = () => {
    const urlInput = $<HTMLInputElement>('#url');
    const htmlInput = $<HTMLTextAreaElement>('#html');
    if (urlInput) urlInput.value = SAMPLE_URL;
    if (htmlInput) htmlInput.value = SAMPLE_HTML;
    if (htmlBox) htmlBox.style.display = 'flex';
    if (toggleHtmlBtn) toggleHtmlBtn.textContent = 'Hide HTML box';
    if (inputModeBadge) inputModeBadge.textContent = 'Pasted HTML';
    analyze();
  };

  $('#demoSampleHtml')?.addEventListener('click', runInstantSample);
  $('#emptySampleBtn')?.addEventListener('click', runInstantSample);

  const form = $<HTMLFormElement>('#f');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    analyze();
  });

  function showErr(m: string): void {
    const b = $('#err');
    if (!b) return;
    b.textContent = m;
    b.style.display = m ? 'block' : 'none';
  }

  async function analyze(): Promise<void> {
    const urlInput = $<HTMLInputElement>('#url');
    const htmlInput = $<HTMLTextAreaElement>('#html');
    const goBtn = $<HTMLButtonElement>('#go');
    const loadingEl = $('#loading');
    const statusText = $('#status-text');

    const url = urlInput?.value.trim() || '';
    const html =
      htmlBox?.style.display === 'flex' ? htmlInput?.value || '' : '';

    if (!url && !html.trim()) {
      showErr('Enter a URL (or paste HTML) to analyse.');
      return;
    }

    showErr('');
    if (goBtn) goBtn.disabled = true;
    if (loadingEl) loadingEl.style.display = ' inline-flex';
    if (statusText) statusText.textContent = 'Fetching & analysing…';

    try {
      const r = await fetch('/api/page-structure/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, html }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      load(j as AnalysisResult);
      if (statusText) statusText.textContent = 'Analysis complete';
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showErr(msg);
      if (statusText) statusText.textContent = 'Error';
    } finally {
      if (goBtn) goBtn.disabled = false;
      if (loadingEl) loadingEl.style.display = 'none';
    }
  }

  function load(d: AnalysisResult): void {
    state.data = d;
    state.selected = null;
    const kwEntries: [string, ClientKeyword][] = d.keywords.map((k) => [
      k.id,
      { ...k, _inHeadings: [], _supports: [] },
    ]);
    state.kwById = Object.fromEntries(kwEntries);
    state.secById = Object.fromEntries(d.sections.map((s) => [s.id, s]));

    d.sections.forEach((s) => {
      s.heading_keywords.forEach((h) => {
        if (state.kwById[h.id]) state.kwById[h.id]._inHeadings.push(s.id);
      });
      s.supporting_keywords.forEach((h) => {
        if (state.kwById[h.id]) state.kwById[h.id]._supports.push(s.id);
      });
    });

    const emptyEl = $('#empty');
    const resultsEl = $('#results');
    const summaryWrap = $('#summaryWrap');
    if (emptyEl) emptyEl.hidden = true;
    if (resultsEl) resultsEl.hidden = false;
    if (summaryWrap) summaryWrap.hidden = false;

    const cs = $<HTMLSelectElement>('#clusterSel');
    if (cs) {
      cs.innerHTML =
        `<option value="all">All clusters</option>` +
        ['Main topic', ...d.clusters.map((c) => c.label)]
          .map((l) => `<option value="${esc(l)}">${esc(l)}</option>`)
          .join('');
    }
    state.cluster = 'all';

    // Update top studio header pills & footer
    const metricTopic = $('#metric-topic');
    const metricKeywords = $('#metric-keywords');
    const metricSections = $('#metric-sections');
    const outputFooter = $('#output-footer-meta');
    const secs = d.sections.filter((s) => s.level > 0);
    if (metricTopic) {
      metricTopic.textContent = `Topic: ${d.main_topic?.keyword || '–'}`;
    }
    if (metricKeywords) {
      metricKeywords.textContent = `${d.keywords.length} keywords`;
    }
    if (metricSections) {
      metricSections.textContent = `${secs.length} sections`;
    }
    if (outputFooter) {
      outputFooter.textContent = `${d.meta.title || d.url} · ${fmt(d.meta.word_count)} words · ${d.keywords.length} keywords`;
    }

    renderSummary();
    renderGraph();
    renderDetail(null);
    renderTable();
    renderText();
    renderReport();

    const bing = getBingConfig();
    if (bing?.key && bing?.autoFetch) {
      setTimeout(() => {
        triggerFetchBingVolume(true);
      }, 300);
    }
  }

  // ------------------------------------------------------------------ Summary & Neon Gauge Helper
  function gaugeRingSvg(pct: number, centerText: string, gradId: string): string {
    const r = 21;
    const c = 2 * Math.PI * r;
    const clamped = Math.max(0, Math.min(100, pct));
    const offset = (c * (1 - clamped / 100)).toFixed(1);
    return `<svg class="gauge-svg" viewBox="0 0 54 54" aria-hidden="true">
      <defs>
        <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#00e5ff" />
          <stop offset="52%" stop-color="#3b82f6" />
          <stop offset="100%" stop-color="#ff2a85" />
        </linearGradient>
      </defs>
      <circle class="gauge-track" cx="27" cy="27" r="${r}" />
      <circle class="gauge-fill" cx="27" cy="27" r="${r}" stroke="url(#${gradId})" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${offset}" />
      <text class="gauge-label" x="27" y="27">${esc(centerText)}</text>
    </svg>`;
  }

  function renderSummary(): void {
    const d = state.data;
    if (!d) return;
    const m = d.meta;
    const tiers = d3.rollup(
      d.keywords,
      (v) => v.length,
      (k) => k.tier
    );
    const totalKw = Math.max(1, d.keywords.length);
    const pCount = tiers.get('Primary') || 0;
    const sCount = tiers.get('Secondary') || 0;
    const supCount = tiers.get('Supporting') || 0;
    const ltCount = tiers.get('Long-tail') || 0;
    const corePct = Math.round(((pCount + sCount) / totalKw) * 100);

    const secs = d.sections.filter((s) => s.level > 0);
    const avgAlign = secs.length
      ? Math.round(d3.mean(secs, (s) => s.alignment ?? 0) ?? 0)
      : 0;

    const summaryEl = $('#summary');
    if (!summaryEl) return;
    summaryEl.innerHTML = `
      <div class="card"><div class="k">Main topic</div><div class="v topic">${esc(d.main_topic?.keyword || '–')}</div>
        <div class="s" title="${esc(m.title)}">${esc(m.title || d.url)}</div></div>
      <div class="card card-gauge">
        ${gaugeRingSvg(avgAlign, `${avgAlign}%`, 'g-align')}
        <div class="gauge-info">
          <div class="k">Heading support</div>
          <div class="v">${avgAlign}<span style="font-size:12px;color:var(--text-tertiary)">/100</span></div>
          <div class="s">heading ↔ copy alignment</div>
        </div>
      </div>
      <div class="card card-gauge">
        ${gaugeRingSvg(corePct, `${corePct}%`, 'g-core')}
        <div class="gauge-info">
          <div class="k">Keywords</div>
          <div class="v">${d.keywords.length}</div>
          <div class="s">${pCount} primary · ${sCount} secondary</div>
        </div>
      </div>
      <div class="card"><div class="k">Topic clusters</div><div class="v">${d.clusters.filter((c) => c.id !== 'c_other').length}</div><div class="s">sub-topics detected</div>
        <div class="card-meter" title="Tier breakdown: Primary / Secondary / Supporting / Long-tail">
          <span style="width:${(pCount / totalKw) * 100}%;background:#00e5ff"></span>
          <span style="width:${(sCount / totalKw) * 100}%;background:#3b82f6"></span>
          <span style="width:${(supCount / totalKw) * 100}%;background:#ff2a85"></span>
          <span style="width:${(ltCount / totalKw) * 100}%;background:#9333ea"></span>
        </div>
      </div>
      <div class="card"><div class="k">Sections</div><div class="v">${secs.length}</div><div class="s">${
        Object.entries(m.heading_counts)
          .filter(([, v]) => v)
          .map(([k, v]) => `${v} ${k.toUpperCase()}`)
          .join(' · ') || 'no headings'
      }</div></div>
      <div class="card"><div class="k">Words</div><div class="v">${fmt(m.word_count)}</div><div class="s">main body copy</div></div>`;
  }

  // ------------------------------------------------------------------ Tabs & Graph Toolbar
  $$<HTMLButtonElement>('.tab').forEach((t) => {
    t.addEventListener('click', () => {
      $$<HTMLButtonElement>('.tab').forEach((x) => {
        const isOn = x === t;
        x.classList.toggle('on', isOn);
        x.setAttribute('aria-selected', String(isOn));
      });
      $$('.view-panel').forEach((p) =>
        p.classList.toggle('on', p.id === 'p-' + t.dataset.tab)
      );
      if (t.dataset.tab === 'graph') renderGraph();
      else setGraphFullscreen(false);
    });
  });

  function bindSeg(id: string, key: 'mode' | 'layout'): void {
    $$<HTMLButtonElement>(`#${id} button`).forEach((b) => {
      b.addEventListener('click', () => {
        $$(`#${id} button`).forEach((x) => x.classList.toggle('on', x === b));
        (state as any)[key] = b.dataset.v;
        renderGraph();
      });
    });
  }
  bindSeg('modeSeg', 'mode');
  bindSeg('layoutSeg', 'layout');

  const limitInput = $<HTMLInputElement>('#limit');
  const limitV = $('#limitV');
  limitInput?.addEventListener('input', () => {
    state.limit = Number(limitInput.value);
    if (limitV) limitV.textContent = String(state.limit);
  });
  limitInput?.addEventListener('change', () => renderGraph());

  $<HTMLInputElement>('#cooc')?.addEventListener('change', (e) => {
    state.cooc = (e.target as HTMLInputElement).checked;
    renderGraph();
  });
  $<HTMLInputElement>('#allLabels')?.addEventListener('change', (e) => {
    state.allLabels = (e.target as HTMLInputElement).checked;
    renderGraph();
  });

  // ------------------------------------------------------------------ Graph Data Builders
  const tierColor = (t: string): string =>
    css(
      (
        {
          Primary: '--t-primary',
          Secondary: '--t-secondary',
          Supporting: '--t-supporting',
        } as Record<string, string>
      )[t] || '--t-longtail'
    );
  const kwR = (k: KeywordEntry): number => 4 + (k.relevance / 100) * 13;

  function topKeywords(): KeywordEntry[] {
    return state.data ? state.data.keywords.slice(0, state.limit) : [];
  }

  function buildClusterGraph(): { nodes: GraphNode[]; links: GraphLink[] } {
    const d = state.data!;
    const keep = new Set(topKeywords().map((k) => k.id));
    const main = d.keywords[0];
    if (!main) return { nodes: [], links: [] };
    const nodes: GraphNode[] = [
      { id: 'root', type: 'root', label: main.keyword, r: 24, ref: state.kwById[main.id] || main },
    ];
    const links: GraphLink[] = [];
    d.clusters.forEach((c) => {
      const ks = c.keywords.filter((id) => keep.has(id));
      if (!ks.length) return;
      const cid = 'c:' + c.id;
      const other = c.id === 'c_other';
      nodes.push({
        id: cid,
        type: 'cluster',
        other,
        label: other ? 'Other terms' : c.label,
        r: other ? 8 : Math.min(26, 9 + Math.sqrt(c.strength) * 0.9),
        ref: c,
      });
      links.push({ source: 'root', target: cid, kind: 'tree', dist: 110 });
      ks.forEach((id) => {
        const k = state.kwById[id];
        if (!k) return;
        nodes.push({
          id: 'k:' + id,
          type: 'kw',
          label: k.keyword,
          r: kwR(k),
          ref: k,
          dup: k.keyword === c.label,
        });
        links.push({
          source: cid,
          target: 'k:' + id,
          kind: 'tree',
          dist: 40 + (100 - k.relevance) * 0.4,
        });
      });
    });
    return { nodes, links };
  }

  function soleH1(): SectionEntry | null {
    const d = state.data!;
    const h1s = d.sections.filter((s) => s.level === 1);
    return h1s.length === 1 &&
      h1s[0].parent != null &&
      state.secById[h1s[0].parent]?.level === 0
      ? h1s[0]
      : null;
  }

  function buildStructureGraph(): { nodes: GraphNode[]; links: GraphLink[] } {
    const d = state.data!;
    const keep = new Set(topKeywords().map((k) => k.id));
    const page = d.sections.find((s) => s.level === 0);
    const h1 = soleH1();
    const isRoot = (s: SectionEntry | undefined): boolean =>
      Boolean(s && (s.level === 0 || s === h1));
    const nodes: GraphNode[] = [
      {
        id: 'root',
        type: 'root',
        label: d.meta.h1s[0] || d.main_topic?.keyword || 'Page',
        r: 24,
        ref: page,
      },
    ];
    const links: GraphLink[] = [];
    const have = new Set(['root']);

    const addKw = (
      id: string,
      from: string,
      kind: 'heading' | 'support',
      strength?: number
    ) => {
      if (!keep.has(id) && kind === 'support') return;
      const k = state.kwById[id];
      if (!k) return;
      const nid = 'k:' + id;
      if (!have.has(nid)) {
        nodes.push({
          id: nid,
          type: 'kw',
          label: k.keyword,
          r: kwR(k),
          ref: k,
        });
        have.add(nid);
      }
      links.push({
        source: from,
        target: nid,
        kind,
        dist: kind === 'heading' ? 34 : 70,
        w: strength,
      });
    };

    d.sections.forEach((s) => {
      if (isRoot(s)) {
        s.heading_keywords.forEach((h) => addKw(h.id, 'root', 'heading'));
        return;
      }
      const sid = 's:' + s.id;
      nodes.push({
        id: sid,
        type: 'section',
        label: s.heading,
        r: Math.max(7, 15 - s.level * 1.6),
        ref: s,
      });
      have.add(sid);
    });

    d.sections.forEach((s) => {
      if (isRoot(s)) return;
      const sid = 's:' + s.id;
      const parent =
        s.parent == null || isRoot(state.secById[s.parent])
          ? 'root'
          : 's:' + s.parent;
      links.push({ source: parent, target: sid, kind: 'tree', dist: 90 });
      s.heading_keywords.forEach((h) => addKw(h.id, sid, 'heading'));
      s.supporting_keywords
        .slice(0, 5)
        .forEach((h) => addKw(h.id, sid, 'support', h.support));
    });
    return { nodes, links };
  }

  function hierarchyData(): any {
    const d = state.data!;
    if (state.mode === 'clusters') {
      const keep = new Set(topKeywords().map((k) => k.id));
      const firstKw = d.keywords[0];
      return {
        name: firstKw?.keyword || 'Page',
        type: 'root',
        ref: firstKw ? state.kwById[firstKw.id] || firstKw : null,
        children: d.clusters
          .map((c) => ({
            name: c.label,
            type: 'cluster',
            ref: c,
            children: c.keywords
              .filter((id) => keep.has(id) && state.kwById[id])
              .map((id) => ({
                name: state.kwById[id].keyword,
                type: 'kw',
                ref: state.kwById[id],
              })),
          }))
          .filter((c) => c.children.length > 0),
      };
    }

    const build = (s: SectionEntry): any => {
      const kids: any[] = [];
      s.heading_keywords.forEach((h) => {
        if (state.kwById[h.id]) {
          kids.push({
            name: h.keyword,
            type: 'kw',
            role: 'heading',
            ref: state.kwById[h.id],
          });
        }
      });
      if (s.level > 0) {
        s.supporting_keywords.slice(0, 4).forEach((h) => {
          if (state.kwById[h.id]) {
            kids.push({
              name: h.keyword,
              type: 'kw',
              role: 'support',
              ref: state.kwById[h.id],
            });
          }
        });
      }
      s.children
        .map((c) => state.secById[c])
        .filter(Boolean)
        .forEach((c) => kids.push(build(c)));
      return {
        name: s.level === 0 ? d.meta.h1s[0] || s.heading : s.heading,
        type: s.level === 0 ? 'root' : 'section',
        ref: s,
        children: kids,
      };
    };

    const page = d.sections.find((s) => s.level === 0)!;
    const h1 = soleH1();
    if (!h1) return build(page);
    const root = build(h1);
    root.type = 'root';
    const extra = page.children
      .map((c) => state.secById[c])
      .filter((c) => c && c !== h1)
      .map(build);
    root.children = root.children.concat(extra);
    return root;
  }

  // ------------------------------------------------------------------ Graph Render
  let stop3d: (() => void) | null = null;
  let reset3d: (() => void) | null = null;
  let export3dSvg: (() => string) | null = null;
  let last3dMode: 'clusters' | 'structure' | null = null;
  let dragTool3d: 'pan' | 'orbit' = 'pan';
  const CAM3D_DEFAULT = { yaw: -0.42, pitch: 0.36, zoom: 1.15, tx: 0, ty: 0, tz: 0 };
  const cam3d = { ...CAM3D_DEFAULT };

  function update3dHint(): void {
    const hintEl = $('#hint');
    if (!hintEl || state.layout !== 'network') return;
    hintEl.textContent =
      dragTool3d === 'pan'
        ? 'Drag: move · Right/Shift-drag: rotate · Scroll: zoom at cursor · Dbl-click: focus'
        : 'Drag: rotate · Right/Shift-drag: move · Scroll: zoom at cursor · Dbl-click: focus';
  }

  function nodeColor(n: { type: string; other?: boolean; ref?: any }): string {
    if (n.type === 'root') return css('--n-root');
    if (n.type === 'cluster') {
      return n.other || n.ref?.id === 'c_other'
        ? css('--t-longtail')
        : css('--n-cluster');
    }
    if (n.type === 'section') return css('--n-section');
    return tierColor(n.ref?.tier || 'Long-tail');
  }

  function renderGraph(): void {
    const graphPanel = $('#p-graph');
    if (!state.data || !graphPanel || !graphPanel.classList.contains('on')) {
      return;
    }
    if (stop3d) {
      stop3d();
      stop3d = null;
    }
    reset3d = null;
    export3dSvg = null;
    const box = $('#graph');
    if (!box) return;
    // 3D canvas style applies to Network layout (both Topic Clusters and Heading Hierarchy)
    const is3d = state.layout === 'network';
    box.classList.toggle('is-3d', is3d);
    box.querySelectorAll('svg, canvas.graph-3d-canvas, .hud-3d-top, .hud-3d-controls').forEach((el) => el.remove());
    const W = box.clientWidth || 720;
    const H = box.clientHeight || 520;

    const mode = state.mode;
    const legendEl = $('#legend');
    if (legendEl) {
      legendEl.innerHTML =
        `<div><i style="background:${css('--n-root')}"></i>${mode === 'clusters' ? 'Main topic' : 'Page (H1)'}</div>` +
        (mode === 'clusters'
          ? `<div><i style="background:${css('--n-cluster')}"></i>Topic cluster</div>`
          : `<div><i style="background:${css('--n-section')}"></i>Section heading</div>`) +
        ['Primary', 'Secondary', 'Supporting', 'Long-tail']
          .map(
            (t) =>
              `<div><i style="background:${tierColor(t)}"></i>${t} keyword</div>`
          )
          .join('') +
        (mode === 'structure'
          ? `<div style="margin-top:3px;color:var(--text-tertiary)">— in heading &nbsp;┄ supports copy</div>`
          : '');
    }
    const hintEl = $('#hint');
    if (hintEl) {
      if (is3d) {
        update3dHint();
      } else {
        hintEl.textContent = 'Click a branch node to collapse/expand';
      }
    }

    if (is3d) {
      state.zoom = null;
      if (last3dMode !== mode) {
        Object.assign(cam3d, CAM3D_DEFAULT);
        last3dMode = mode;
      }
      const { nodes, links } =
        mode === 'clusters' ? buildClusterGraph() : buildStructureGraph();
      if (!nodes.length) return;
      if (state.cooc) {
        const ids = new Set(nodes.map((n) => n.id));
        state.data.cooccurrence.forEach((e) => {
          if (ids.has('k:' + e.source) && ids.has('k:' + e.target)) {
            links.push({
              source: 'k:' + e.source,
              target: 'k:' + e.target,
              kind: 'cooc',
              dist: 80,
              w: e.weight,
            });
          }
        });
      }
      const labelSet = new Set(
        nodes
          .filter((n) => n.type !== 'kw')
          .map((n) => n.id)
          .concat(
            nodes
              .filter((n) => n.type === 'kw')
              .sort((a, b) => b.ref.relevance - a.ref.relevance)
              .slice(0, 22)
              .map((n) => n.id)
          )
      );
      render3D(W, H, nodes, links, labelSet, box, graphPanel);
      return;
    }

    const svg = d3
      .select(box)
      .insert('svg', ':first-child')
      .attr('viewBox', `0 0 ${W} ${H}`)
      .attr('xmlns', 'http://www.w3.org/2000/svg');

    const defs = svg.append('defs');
    const glowFilter = defs
      .append('filter')
      .attr('id', 'ps-node-glow')
      .attr('x', '-60%')
      .attr('y', '-60%')
      .attr('width', '220%')
      .attr('height', '220%');
    glowFilter
      .append('feGaussianBlur')
      .attr('stdDeviation', '4.5')
      .attr('result', 'coloredBlur');
    const feMerge = glowFilter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'coloredBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    const g = svg.append('g');
    state.zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 4])
      .on('zoom', (e) => g.attr('transform', e.transform));
    svg.call(state.zoom).on('dblclick.zoom', null);
    svg.on('click', (e) => {
      if (e.target === svg.node()) select(null);
    });

    renderTree(svg, g, W, H);
  }

  // ------------------------------------------------------------------ 3D Network (Topic Clusters & Heading Hierarchy, High-DPI Canvas)
  function render3D(
    W: number,
    H: number,
    nodes: GraphNode[],
    rawLinks: GraphLink[],
    labelSet: Set<string>,
    box: HTMLElement,
    graphPanel: HTMLElement
  ): void {
    const isClusters = state.mode === 'clusters';
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links: GraphLink[] = [];
    rawLinks.forEach((l) => {
      const s = byId.get(typeof l.source === 'object' ? l.source.id : l.source);
      const t = byId.get(typeof l.target === 'object' ? l.target.id : l.target);
      if (s && t) links.push({ ...l, source: s, target: t });
    });

    // Helper to convert hex/rgb CSS color to rgba(...)
    const toRgba = (col: string, alpha: number): string => {
      const a = Math.max(0, Math.min(1, alpha));
      const c = col.trim();
      if (c.startsWith('#')) {
        let hex = c.slice(1);
        if (hex.length === 3) hex = hex.split('').map((ch) => ch + ch).join('');
        const num = parseInt(hex, 16);
        if (!Number.isNaN(num)) {
          return `rgba(${(num >> 16) & 255},${(num >> 8) & 255},${num & 255},${a.toFixed(3)})`;
        }
      }
      const m = c.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
      if (m) return `rgba(${m[1]},${m[2]},${m[3]},${a.toFixed(3)})`;
      return c;
    };

    // Build hub tree from non-keyword tree links (sections in structure mode, clusters in clusters mode)
    const childHubs = new Map<string, GraphNode[]>();
    links.forEach((l) => {
      if (l.kind !== 'tree') return;
      const target = l.target as GraphNode;
      if (target.type === 'kw') return;
      const pid = (l.source as GraphNode).id;
      if (!childHubs.has(pid)) childHubs.set(pid, []);
      childHubs.get(pid)!.push(target);
    });

    const anchor = new Map<string, { x: number; y: number; z: number }>();
    const rootNode = nodes[0];
    rootNode.x = 0;
    rootNode.y = -210;
    rootNode.z = 0;
    anchor.set(rootNode.id, { x: 0, y: -210, z: 0 });

    const topHubs = childHubs.get(rootNode.id) || [];
    const M = Math.max(1, topHubs.length);
    const baseR1 = isClusters ? Math.max(290, M * 68) : Math.max(270, M * 58);

    const placeSubtree = (
      hub: GraphNode,
      ang: number,
      span: number,
      rad: number,
      yPos: number
    ) => {
      const x = Math.cos(ang) * rad;
      const z = Math.sin(ang) * rad;
      hub.x = x;
      hub.y = yPos;
      hub.z = z;
      anchor.set(hub.id, { x, y: yPos, z });

      const kids = childHubs.get(hub.id) || [];
      if (!kids.length) return;
      const childSpan = Math.min(Math.PI * 0.72, span * 0.92);
      kids.forEach((kid, idx) => {
        const frac = kids.length === 1 ? 0 : idx / (kids.length - 1) - 0.5;
        const cAng = ang + frac * childSpan;
        const cRad = rad + 195 + (idx % 2 === 1 ? 35 : 0);
        const cY = yPos + 130 + (idx % 2 === 0 ? -24 : 24);
        placeSubtree(kid, cAng, childSpan / Math.max(1, kids.length), cRad, cY);
      });
    };

    topHubs.forEach((hub, i) => {
      const ang = (i / M) * Math.PI * 2 - Math.PI / 2;
      const span = (Math.PI * 1.8) / M;
      const rad = hub.other ? baseR1 + 75 : baseR1;
      const yPos = (hub.other ? 45 : -30) + (i % 2 === 0 ? -42 : 42);
      placeSubtree(hub, ang, span, rad, yPos);
    });

    // Place keywords cleanly around their owning section/cluster(s), pushed outward from center
    const kwLinks = new Map<string, { hub: GraphNode; kind: GraphLink['kind'] }[]>();
    links.forEach((l) => {
      const s = l.source as GraphNode;
      const t = l.target as GraphNode;
      const isClusterKwLink = l.kind === 'tree' && (s.type === 'kw' || t.type === 'kw');
      if (l.kind !== 'heading' && l.kind !== 'support' && !isClusterKwLink) return;
      const kw = t.type === 'kw' ? t : s.type === 'kw' ? s : null;
      const hub = t.type === 'kw' ? s : t;
      if (!kw || !hub || hub.type === 'kw') return;
      if (!kwLinks.has(kw.id)) kwLinks.set(kw.id, []);
      kwLinks.get(kw.id)!.push({ hub, kind: l.kind });
    });

    const hubInnerKws = new Map<string, GraphNode[]>();
    const hubOuterKws = new Map<string, GraphNode[]>();
    const sharedKws: { kw: GraphNode; hubs: GraphNode[] }[] = [];

    nodes.forEach((n) => {
      if (n.type !== 'kw') return;
      const owners = kwLinks.get(n.id) || [];
      const uniqueHubs = Array.from(new Set(owners.map((o) => o.hub)));
      const headingOwner = owners.find((o) => o.kind === 'heading')?.hub;

      if (!isClusters && uniqueHubs.length > 1 && !headingOwner) {
        sharedKws.push({ kw: n, hubs: uniqueHubs });
      } else {
        const primary = headingOwner || uniqueHubs[0] || rootNode;
        const isInner = isClusters
          ? (n.ref?.relevance ?? 0) >= 45
          : owners.some((o) => o.hub === primary && o.kind === 'heading');
        const bucket = isInner ? hubInnerKws : hubOuterKws;
        if (!bucket.has(primary.id)) bucket.set(primary.id, []);
        bucket.get(primary.id)!.push(n);
      }
    });

    const placeKwRing = (
      hub: GraphNode,
      kws: GraphNode[],
      orbitR: number,
      yBase: number,
      arcSpan: number
    ) => {
      if (!kws.length) return;
      const sx = hub.x || 0;
      const sy = hub.y || 0;
      const sz = hub.z || 0;
      const isRootHub = hub.id === rootNode.id;
      const outAng = isRootHub ? -Math.PI / 2 : Math.atan2(sz, sx);
      const count = kws.length;
      const span = isRootHub ? Math.PI * 1.85 : Math.min(arcSpan, 0.45 * count + 0.5);

      kws.forEach((kw, idx) => {
        const frac = count === 1 ? 0 : idx / (count - 1) - 0.5;
        const ang = outAng + frac * span;
        const rJitter = orbitR + (idx % 2 === 0 ? 0 : 34);
        const yOff = yBase + ((idx % 3) - 1) * 34;
        const x = sx + Math.cos(ang) * rJitter;
        const z = sz + Math.sin(ang) * rJitter;
        const y = sy + yOff;
        kw.x = x;
        kw.y = y;
        kw.z = z;
        anchor.set(kw.id, { x, y, z });
      });
    };

    nodes.forEach((n) => {
      if (n.type === 'kw') return;
      placeKwRing(n, hubInnerKws.get(n.id) || [], isClusters ? 115 : 125, -22, 1.65);
      placeKwRing(n, hubOuterKws.get(n.id) || [], isClusters ? 175 : 185, 60, 2.0);
    });

    sharedKws.forEach(({ kw, hubs }, idx) => {
      let cx = 0;
      let cy = 0;
      let cz = 0;
      hubs.forEach((s) => {
        cx += s.x || 0;
        cy += s.y || 0;
        cz += s.z || 0;
      });
      cx /= hubs.length;
      cy /= hubs.length;
      cz /= hubs.length;
      const ang = Math.atan2(cz, cx) + ((idx % 5) - 2) * 0.22;
      const rLen = Math.hypot(cx, cz);
      const scale = rLen > 1 ? (rLen + 55) / rLen : 1;
      const x = cx * scale + Math.cos(ang) * 28;
      const z = cz * scale + Math.sin(ang) * 28;
      const y = cy + 68 + (idx % 3) * 30;
      kw.x = x;
      kw.y = y;
      kw.z = z;
      anchor.set(kw.id, { x, y, z });
    });

    // Gentle 3D anti-overlap relaxation preserving architectural hierarchy
    const N = nodes.length;
    nodes.forEach((n) => {
      n.vx = n.vy = n.vz = 0;
      if (n.x == null || n.y == null || n.z == null) {
        n.x = 0;
        n.y = 0;
        n.z = 0;
      }
    });

    for (let it = 0; it < 130; it++) {
      const decay = 1 - it / 135;
      // Pairwise minimum-distance separation so nodes & labels never bunch up
      for (let i = 0; i < N; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < N; j++) {
          const b = nodes[j];
          let dx = b.x! - a.x!;
          let dy = b.y! - a.y!;
          let dz = b.z! - a.z!;
          let d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < 0.01) {
            dx = 1;
            dy = 0.5;
            dz = 0.5;
            d2 = 1.5;
          }
          const minD =
            a.type !== 'kw' && b.type !== 'kw'
              ? 165
              : a.type !== 'kw' || b.type !== 'kw'
                ? 112
                : 88;
          if (d2 < minD * minD) {
            const d = Math.sqrt(d2);
            const push = ((minD - d) / d) * 0.32 * decay;
            if (a.id !== rootNode.id) {
              a.vx! -= dx * push;
              a.vy! -= dy * push;
              a.vz! -= dz * push;
            }
            if (b.id !== rootNode.id) {
              b.vx! += dx * push;
              b.vy! += dy * push;
              b.vz! += dz * push;
            }
          }
        }
      }

      // Anchor spring + slight link spring
      for (const l of links) {
        if (l.kind === 'cooc') continue;
        const s = l.source as GraphNode;
        const t = l.target as GraphNode;
        const dx = t.x! - s.x!;
        const dy = t.y! - s.y!;
        const dz = t.z! - s.z!;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const targetD =
          l.kind === 'tree'
            ? t.type === 'kw'
              ? 135
              : 220
            : l.kind === 'heading'
              ? 125
              : 175;
        const pull = ((d - targetD) / d) * 0.035 * decay;
        if (s.id !== rootNode.id) {
          s.vx! += dx * pull;
          s.vy! += dy * pull;
          s.vz! += dz * pull;
        }
        if (t.id !== rootNode.id) {
          t.vx! -= dx * pull;
          t.vy! -= dy * pull;
          t.vz! -= dz * pull;
        }
      }

      for (const n of nodes) {
        if (n.id === rootNode.id) {
          n.vx = n.vy = n.vz = 0;
          continue;
        }
        const anc = anchor.get(n.id);
        if (anc) {
          const stiff = n.type !== 'kw' ? 0.14 : 0.065;
          n.vx! += (anc.x - n.x!) * stiff;
          n.vy! += (anc.y - n.y!) * stiff;
          n.vz! += (anc.z - n.z!) * stiff;
        }
        n.vx! *= 0.62;
        n.vy! *= 0.62;
        n.vz! *= 0.62;
        n.x! += n.vx!;
        n.y! += n.vy!;
        n.z! += n.vz!;
      }
    }

    // Center vertically around midpoint for natural orbiting
    let minY = Infinity;
    let maxY = -Infinity;
    nodes.forEach((n) => {
      if (n.y! < minY) minY = n.y!;
      if (n.y! > maxY) maxY = n.y!;
    });
    const midY = (minY + maxY) / 2;
    nodes.forEach((n) => {
      n.y! -= midY;
    });
    const floorY = maxY - midY + 45;
    const h2RingY = topHubs[0]?.y ?? -40;

    // World bounds & perspective framing
    const R =
      (d3.max(nodes, (n) => Math.sqrt(n.x! ** 2 + n.y! ** 2 + n.z! ** 2)) || 260) + 60;
    const focal = R * 2.8;
    const baseScale = (Math.min(W, H) * 0.44) / R;

    // Create High-DPI Canvas
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement('canvas');
    canvas.className = 'graph-3d-canvas';
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    box.insertBefore(canvas, box.firstChild);
    const ctx = canvas.getContext('2d')!;

    // 3D HUD: Quick Jumper (top-left) & Camera Controls (bottom-right)
    const hudTop = document.createElement('div');
    hudTop.className = 'hud-3d-top';
    const jumpSel = document.createElement('select');
    jumpSel.className = 'hud-3d-select';
    jumpSel.setAttribute(
      'aria-label',
      isClusters ? 'Jump to topic cluster' : 'Jump to heading section'
    );
    const hubNodes = nodes.filter((n) => n.type !== 'kw');
    jumpSel.innerHTML =
      `<option value="__overview__">${isClusters ? 'Overview (All clusters)' : 'Overview (All headings)'}</option>` +
      hubNodes
        .map((n) => {
          if (isClusters) {
            const tag = n.type === 'root' ? 'TOPIC' : n.other ? 'OTHER' : 'CLUSTER';
            return `<option value="${esc(n.id)}">${tag} · ${esc(trunc(n.label, 34))}</option>`;
          }
          const lvl = n.type === 'root' ? 1 : n.ref?.level || 2;
          const indent = '\u00A0'.repeat(Math.max(0, (lvl - 1) * 2));
          const tag = n.type === 'root' ? 'H1' : (n.ref?.tag || 'H2').toUpperCase();
          return `<option value="${esc(n.id)}">${indent}${tag} · ${esc(trunc(n.label, 34))}</option>`;
        })
        .join('');
    hudTop.appendChild(jumpSel);
    box.appendChild(hudTop);

    const hudCtrl = document.createElement('div');
    hudCtrl.className = 'hud-3d-controls';
    hudCtrl.innerHTML = `
      <button type="button" class="hud-3d-btn ${dragTool3d === 'pan' ? 'on' : ''}" id="hud3d-pan" aria-pressed="${dragTool3d === 'pan'}" title="Drag to move the graph">Move</button>
      <button type="button" class="hud-3d-btn ${dragTool3d === 'orbit' ? 'on' : ''}" id="hud3d-rotate" aria-pressed="${dragTool3d === 'orbit'}" title="Drag to rotate in 3D">Rotate</button>
      <span class="hud-3d-sep" aria-hidden="true"></span>
      <button type="button" class="hud-3d-btn" id="hud3d-zin" title="Zoom in">+</button>
      <button type="button" class="hud-3d-btn" id="hud3d-zout" title="Zoom out">&minus;</button>
      <button type="button" class="hud-3d-btn" id="hud3d-reset" title="Reset 3D camera">Reset</button>
      <button type="button" class="hud-3d-btn" id="hud3d-orbit" aria-pressed="false" title="Toggle gentle auto-rotation">Auto-orbit</button>
    `;
    box.appendChild(hudCtrl);

    // Camera state, inertia, & smooth time-based camera animations
    const camTarget = { ...cam3d };
    let velYaw = 0;
    let velPitch = 0;
    let autoOrbit = false;
    let camAnim: {
      start: number;
      duration: number;
      ease: 'inOut' | 'out';
      from: typeof CAM3D_DEFAULT;
      to: typeof CAM3D_DEFAULT;
    } | null = null;
    let hovered: GraphNode | null = null;
    let dirty = true;

    const cCluster = css('--n-cluster');
    const cBlue = css('--accent-blue');
    const cAccent = css('--accent');
    const cLink = css('--link');

    const colFor = (n: GraphNode) => nodeColor(n);
    const linkCol = (l: GraphLink, s: GraphNode, t: GraphNode): string => {
      if (l.kind === 'cooc') return cCluster;
      if (l.kind === 'heading') return cAccent;
      if (l.kind === 'tree') {
        if (isClusters) {
          return s.id === rootNode.id ? cCluster : (t.ref?.relevance ?? 0) >= 55 ? cAccent : cBlue;
        }
        return cBlue;
      }
      return cLink;
    };

    const getNeighbors = (id: string | null): Set<string> | null => {
      if (!id) return null;
      const nb = new Set<string>([id]);
      links.forEach((l) => {
        const sid = (l.source as GraphNode).id;
        const tid = (l.target as GraphNode).id;
        if (sid === id) nb.add(tid);
        if (tid === id) nb.add(sid);
      });
      return nb;
    };

    const projectPt = (
      x: number,
      y: number,
      z: number,
      cy: number,
      sy: number,
      cp: number,
      sp: number,
      cam = cam3d
    ) => {
      const dx = x - cam.tx;
      const dy = y - cam.ty;
      const dz = z - cam.tz;
      const x1 = dx * cy - dz * sy;
      const z1 = dx * sy + dz * cy;
      const y2 = dy * cp - z1 * sp;
      const z2 = dy * sp + z1 * cp;
      const denom = Math.max(focal * 0.22, focal + z2);
      const persp = focal / denom;
      const s = persp * baseScale * cam.zoom;
      return {
        px: W / 2 + x1 * s,
        py: H / 2 + y2 * s,
        pz: z2,
        ps: persp,
      };
    };

    const ringPts = (radius: number, yPlane: number) =>
      d3.range(0, 65).map((i) => {
        const a = (i / 64) * Math.PI * 2;
        return [Math.cos(a) * radius, yPlane, Math.sin(a) * radius] as [number, number, number];
      });
    const eqRing = ringPts(baseR1, h2RingY);
    const floorRing = ringPts(R * 0.88, floorY);

    const visualRadius = (n: GraphNode, persp: number): number => {
      const base =
        n.type === 'root'
          ? 16
          : n.type === 'cluster'
            ? n.other
              ? 8.5
              : Math.max(10.5, Math.min(16.5, n.r * 0.72))
            : n.type === 'section'
              ? 11.5
              : 4.5 + ((n.ref?.relevance || 20) / 100) * 6.5;
      const zoomBoost = Math.pow(cam3d.zoom, 0.42);
      return Math.max(3.5, Math.min(28, base * persp * zoomBoost));
    };

    const drawRoundRect = (
      x: number,
      y: number,
      w: number,
      h: number,
      rad: number
    ) => {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, rad);
    };

    const renderFrame = () => {
      const cy = Math.cos(cam3d.yaw);
      const sy = Math.sin(cam3d.yaw);
      const cp = Math.cos(cam3d.pitch);
      const sp = Math.sin(cam3d.pitch);

      nodes.forEach((n) => {
        const p = projectPt(n.x!, n.y!, n.z!, cy, sy, cp, sp);
        n._px = p.px;
        n._py = p.py;
        n._pz = p.pz;
        n._ps = p.ps;
      });

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, W, H);

      const activeId = hovered?.id || state.selected;
      const nb = getNeighbors(activeId);

      // 1. Subtle 3D orbital reference rings & spokes
      const drawRing = (pts: [number, number, number][], alpha: number, dashed: boolean) => {
        ctx.save();
        ctx.beginPath();
        pts.forEach((pt, idx) => {
          const q = projectPt(pt[0], pt[1], pt[2], cy, sy, cp, sp);
          if (idx === 0) ctx.moveTo(q.px, q.py);
          else ctx.lineTo(q.px, q.py);
        });
        ctx.strokeStyle = toRgba(cAccent, alpha);
        ctx.lineWidth = 1;
        if (dashed) ctx.setLineDash([4, 6]);
        ctx.stroke();
        ctx.restore();
      };
      drawRing(eqRing, 0.16, false);
      drawRing(floorRing, 0.09, true);

      // Floor spokes under top-level hubs
      ctx.save();
      ctx.strokeStyle = toRgba(cBlue, 0.08);
      ctx.lineWidth = 1;
      const originP = projectPt(0, floorY, 0, cy, sy, cp, sp);
      topHubs.forEach((s) => {
        const spP = projectPt(s.x!, floorY, s.z!, cy, sy, cp, sp);
        ctx.beginPath();
        ctx.moveTo(originP.px, originP.py);
        ctx.lineTo(spP.px, spP.py);
        ctx.stroke();
      });
      ctx.restore();

      // 2. Links (sorted far-to-near by midpoint depth)
      const sortedLinks = [...links].sort((a, b) => {
        const za = ((a.source as GraphNode)._pz! + (a.target as GraphNode)._pz!) / 2;
        const zb = ((b.source as GraphNode)._pz! + (b.target as GraphNode)._pz!) / 2;
        return zb - za;
      });

      sortedLinks.forEach((l) => {
        const s = l.source as GraphNode;
        const t = l.target as GraphNode;
        const midZ = (s._pz! + t._pz!) / 2;
        const depthFade = Math.max(0.28, 1 - 0.65 * Math.max(0, Math.min(1, (midZ + R) / (2 * R))));
        const isLit = !nb || (s.id === activeId || t.id === activeId);
        const alpha = isLit
          ? (l.kind === 'support' ? 0.52 : l.kind === 'cooc' ? 0.55 : isClusters && s.id !== rootNode.id ? 0.64 : 0.85) * depthFade
          : 0.07;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(s._px!, s._py!);
        ctx.lineTo(t._px!, t._py!);
        ctx.strokeStyle = toRgba(linkCol(l, s, t), alpha);
        ctx.lineWidth = isLit
          ? (l.kind === 'tree' ? (isClusters && t.type === 'kw' ? 1.3 : 1.8) : l.kind === 'heading' ? 1.6 : 1.1) *
            Math.min(1.4, (s._ps! + t._ps!) / 2)
          : 0.9;
        if (l.kind === 'support') ctx.setLineDash([4, 4]);
        else if (l.kind === 'cooc') ctx.setLineDash([2, 4]);
        ctx.stroke();
        ctx.restore();
      });

      // 3. Nodes (sorted back-to-front by pz)
      const sortedNodes = [...nodes].sort((a, b) => b._pz! - a._pz!);
      sortedNodes.forEach((n) => {
        const px = n._px!;
        const py = n._py!;
        const sr = visualRadius(n, n._ps!);
        if (px < -60 || px > W + 60 || py < -60 || py > H + 60) return;

        const isSel = n.id === state.selected;
        const isHov = n.id === hovered?.id;
        const isLit = !nb || nb.has(n.id);
        const depthT = Math.max(0, Math.min(1, (n._pz! + R) / (2 * R)));
        const baseAlpha = isLit ? Math.max(0.4, 1 - 0.52 * depthT) : 0.14;
        const baseCol = colFor(n);

        // Soft aura only on hubs, selected, or hovered
        if ((n.type !== 'kw' || isSel || isHov) && isLit) {
          const auraR = sr * (isSel || isHov ? 2.15 : 1.75);
          const aura = ctx.createRadialGradient(px, py, sr * 0.4, px, py, auraR);
          aura.addColorStop(0, toRgba(baseCol, isSel || isHov ? 0.36 : 0.22));
          aura.addColorStop(1, toRgba(baseCol, 0));
          ctx.fillStyle = aura;
          ctx.beginPath();
          ctx.arc(px, py, auraR, 0, Math.PI * 2);
          ctx.fill();
        }

        // Crisp 3D sphere shading gradient
        const grad = ctx.createRadialGradient(
          px - sr * 0.32,
          py - sr * 0.32,
          sr * 0.1,
          px,
          py,
          sr
        );
        grad.addColorStop(0, `rgba(255,255,255,${(0.9 * baseAlpha).toFixed(3)})`);
        grad.addColorStop(0.32, toRgba(baseCol, baseAlpha));
        grad.addColorStop(1, toRgba('#040814', Math.min(0.92, baseAlpha * 0.85)));

        ctx.beginPath();
        ctx.arc(px, py, sr, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        // Crisp rim ring
        ctx.lineWidth = isSel || isHov ? 2.2 : n.type !== 'kw' ? 1.3 : 0.9;
        ctx.strokeStyle =
          isSel || isHov
            ? '#ffffff'
            : toRgba(baseCol, Math.min(1, baseAlpha * 0.9));
        ctx.stroke();
      });

      // 4. Crisp Pill Labels with Screen-Space Collision Culling
      const candidates = nodes
        .filter((n) => {
          if (n.dup) return false;
          if (n._px! < -40 || n._px! > W + 40 || n._py! < -30 || n._py! > H + 30) return false;
          if (state.allLabels) return true;
          if (n.id === state.selected || n.id === hovered?.id) return true;
          if (nb && nb.has(n.id)) return true;
          if (n.type !== 'kw') return true;
          // When zoomed in, reveal nearby keywords cleanly even beyond top 22
          return labelSet.has(n.id) || cam3d.zoom >= 1.5;
        })
        .map((n) => {
          let prio = 0;
          if (n.id === state.selected || n.id === hovered?.id) prio = 10000;
          else if (nb && nb.has(n.id)) prio = 5000 + (n.ref?.relevance || 0);
          else if (n.type === 'root') prio = 4000;
          else if (n.type === 'cluster') prio = 3000 - (n.other ? 400 : 0) + (n.ref?.strength || 0) - n._pz! * 0.2;
          else if (n.type === 'section') prio = 3000 - (n.ref?.level || 2) * 100 - n._pz! * 0.2;
          else prio = (labelSet.has(n.id) ? 1000 : 200) + (n.ref?.relevance || 0) - n._pz! * 0.25;
          return { n, prio };
        })
        .sort((a, b) => b.prio - a.prio);

      const placedBoxes: Array<[number, number, number, number]> = [];
      const padMargin = 5;

      candidates.forEach(({ n }) => {
        const isSelOrHov = n.id === state.selected || n.id === hovered?.id;
        const isLit = !nb || nb.has(n.id);
        if (!isLit && !state.allLabels) return;

        const px = n._px!;
        const py = n._py!;
        const sr = visualRadius(n, n._ps!);
        const isHub = n.type !== 'kw';
        const fontSize = isSelOrHov ? 12.5 : n.type === 'root' ? 13 : isHub ? 11.5 : 10.5;
        ctx.font = `${isHub || isSelOrHov ? '600' : '500'} ${fontSize}px Inter, -apple-system, sans-serif`;

        const tagPrefix =
          n.type === 'root'
            ? isClusters
              ? 'TOPIC'
              : 'H1'
            : n.type === 'cluster'
              ? n.other
                ? 'OTHER'
                : 'CLUSTER'
              : n.type === 'section'
                ? (n.ref?.tag || 'H2').toUpperCase()
                : '';
        const textStr = trunc(n.label, n.type === 'section' || n.type === 'cluster' ? 28 : 24);
        const textW = ctx.measureText(textStr).width;
        const tagW = tagPrefix ? ctx.measureText(tagPrefix).width + 10 : 0;
        const pillW = textW + tagW + 14;
        const pillH = fontSize + 8;

        const pillX = Math.max(6, Math.min(W - pillW - 6, px - pillW / 2));
        const pillY = py + sr + 6;
        if (pillY + pillH > H - 6) return;

        // Screen-space collision culling (skip overlapping lower-priority labels unless All labels is on)
        if (!state.allLabels && !isSelOrHov) {
          const x1 = pillX - padMargin;
          const y1 = pillY - padMargin;
          const x2 = pillX + pillW + padMargin;
          const y2 = pillY + pillH + padMargin;
          for (const [bx1, by1, bx2, by2] of placedBoxes) {
            if (x1 < bx2 && x2 > bx1 && y1 < by2 && y2 > by1) {
              return;
            }
          }
          placedBoxes.push([x1, y1, x2, y2]);
        }

        const depthT = Math.max(0, Math.min(1, (n._pz! + R) / (2 * R)));
        const labelAlpha = isSelOrHov ? 1 : Math.max(0.55, 1 - 0.35 * depthT);
        const accentCol = colFor(n);

        // Short vertical stem connecting sphere to pill
        ctx.save();
        ctx.strokeStyle = toRgba(accentCol, 0.45 * labelAlpha);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, py + sr + 1);
        ctx.lineTo(px, pillY);
        ctx.stroke();

        // Pill background
        drawRoundRect(pillX, pillY, pillW, pillH, 5);
        ctx.fillStyle = isSelOrHov
          ? `rgba(10, 26, 56, ${(0.96 * labelAlpha).toFixed(3)})`
          : `rgba(6, 11, 26, ${(0.86 * labelAlpha).toFixed(3)})`;
        ctx.fill();
        ctx.lineWidth = isSelOrHov ? 1.4 : 1;
        ctx.strokeStyle = isSelOrHov
          ? '#ffffff'
          : toRgba(accentCol, (isHub ? 0.55 : 0.32) * labelAlpha);
        ctx.stroke();

        // Optional TOPIC/CLUSTER/H1/H2/H3 badge inside pill
        let textStartX = pillX + 7;
        ctx.textBaseline = 'middle';
        if (tagPrefix) {
          ctx.fillStyle = toRgba(accentCol, labelAlpha);
          ctx.font = `700 ${Math.max(9.5, fontSize - 1.5)}px "DM Mono", monospace`;
          ctx.fillText(tagPrefix, textStartX, pillY + pillH / 2 + 0.5);
          textStartX += tagW;
          ctx.font = `600 ${fontSize}px Inter, -apple-system, sans-serif`;
        }

        // Main label text
        ctx.fillStyle = `rgba(240, 246, 255, ${labelAlpha.toFixed(3)})`;
        ctx.fillText(textStr, textStartX, pillY + pillH / 2 + 0.5);
        ctx.restore();
      });

      ctx.restore();
    };

    const hitTest = (mx: number, my: number): GraphNode | null => {
      // Search front-to-back (lowest pz first)
      const frontFirst = [...nodes].sort((a, b) => a._pz! - b._pz!);
      for (const n of frontFirst) {
        const sr = visualRadius(n, n._ps!) + 6;
        const dx = mx - n._px!;
        const dy = my - n._py!;
        if (dx * dx + dy * dy <= sr * sr) return n;
      }
      return null;
    };

    const shortestDeltaYaw = (fromYaw: number, toYaw: number, screenBiasPx?: number) => {
      let d = Math.atan2(Math.sin(toYaw - fromYaw), Math.cos(toYaw - fromYaw));
      if (Math.abs(Math.abs(d) - Math.PI) < 0.08 && screenBiasPx != null) {
        d = screenBiasPx < W / 2 ? Math.PI : -Math.PI;
      }
      return d;
    };

    const animateTo = (
      next: Partial<typeof CAM3D_DEFAULT>,
      ease: 'inOut' | 'out' = 'inOut',
      customDuration?: number,
      screenBiasPx?: number
    ) => {
      const to = { ...cam3d, ...next };
      if (next.yaw != null) {
        to.yaw = cam3d.yaw + shortestDeltaYaw(cam3d.yaw, next.yaw, screenBiasPx);
      }
      to.pitch = Math.max(-1.38, Math.min(1.38, to.pitch));
      to.zoom = Math.max(0.35, Math.min(6, to.zoom));
      const angDist = Math.abs(to.yaw - cam3d.yaw) + Math.abs(to.pitch - cam3d.pitch);
      const moveDist = Math.hypot(to.tx - cam3d.tx, to.ty - cam3d.ty, to.tz - cam3d.tz) / (R || 300);
      const zoomDist = Math.abs(Math.log(to.zoom / (cam3d.zoom || 1)));
      const duration =
        customDuration ??
        Math.round(Math.min(940, Math.max(400, 340 + angDist * 190 + moveDist * 180 + zoomDist * 150)));
      Object.assign(camTarget, to);
      velYaw = 0;
      velPitch = 0;
      camAnim = {
        start: performance.now(),
        duration,
        ease,
        from: { ...cam3d },
        to,
      };
      dirty = true;
    };

    // Bring a clicked back/off-angle node smoothly to the front of the 3D view
    const bringToFront = (n: GraphNode) => {
      const cy = Math.cos(cam3d.yaw);
      const sy = Math.sin(cam3d.yaw);
      const xView = n.x! * cy - n.z! * sy;
      const zView = n.x! * sy + n.z! * cy;
      const rHoriz = Math.hypot(n.x!, n.z!);
      const frontAngle = Math.abs(Math.atan2(xView, -zView));
      const inFrame =
        n._px != null &&
        n._py != null &&
        n._px >= W * 0.12 &&
        n._px <= W * 0.88 &&
        n._py >= H * 0.12 &&
        n._py <= H * 0.78;
      const alreadyFront = rHoriz < 10 || (zView < 0 && frontAngle <= 0.62);

      // Don't jerk the camera if the clicked node is already cleanly at the front
      if (alreadyFront && inFrame) return;

      const targetYaw = rHoriz > 8 ? -Math.atan2(n.z!, n.x!) - Math.PI / 2 : cam3d.yaw;
      const idealPitch = Math.max(0.18, Math.min(0.56, 0.34 - (n.y! / (R || 300)) * 0.24));
      const targetPitch = cam3d.pitch * 0.3 + idealPitch * 0.7;
      const targetZoom = cam3d.zoom < 0.9 ? 1.05 : cam3d.zoom;

      // Keep overall 3D constellation centered when orbiting, but pan just enough so node + pill label fit cleanly
      const baseFocusW =
        targetZoom <= 1.35 ? 0.22 : Math.min(0.88, 0.22 + (targetZoom - 1.35) * 0.38);
      const candWeights = [baseFocusW, 0.55, 0.85, 1.0].filter((w, i, arr) => i === 0 || w > arr[i - 1]);
      let chosen = { tx: n.x! * baseFocusW, ty: n.y! * baseFocusW, tz: n.z! * baseFocusW };

      const tcy = Math.cos(targetYaw);
      const tsy = Math.sin(targetYaw);
      const tcp = Math.cos(targetPitch);
      const tsp = Math.sin(targetPitch);
      for (const fw of candWeights) {
        const probeCam = {
          yaw: targetYaw,
          pitch: targetPitch,
          zoom: targetZoom,
          tx: n.x! * fw,
          ty: n.y! * fw,
          tz: n.z! * fw,
        };
        const p = projectPt(n.x!, n.y!, n.z!, tcy, tsy, tcp, tsp, probeCam);
        chosen = { tx: probeCam.tx, ty: probeCam.ty, tz: probeCam.tz };
        if (p.px >= W * 0.16 && p.px <= W * 0.84 && p.py >= H * 0.18 && p.py <= H * 0.74) {
          break;
        }
      }

      animateTo(
        {
          yaw: targetYaw,
          pitch: targetPitch,
          zoom: targetZoom,
          tx: chosen.tx,
          ty: chosen.ty,
          tz: chosen.tz,
        },
        'inOut',
        undefined,
        n._px
      );
    };

    const flyTo = (n: GraphNode | null) => {
      if (n) {
        const desiredYaw =
          Math.hypot(n.x!, n.z!) > 8 ? -Math.atan2(n.z!, n.x!) - Math.PI / 2 : cam3d.yaw;
        animateTo(
          {
            tx: n.x!,
            ty: n.y!,
            tz: n.z!,
            zoom: Math.max(cam3d.zoom, 1.85),
            yaw: desiredYaw,
          },
          'inOut',
          undefined,
          n._px
        );
      } else {
        animateTo({ ...CAM3D_DEFAULT }, 'inOut');
      }
    };

    // Shared camera-space to world-target displacement helper
    const shiftCamTargetByCamXY = (ux: number, uy: number) => {
      const cy = Math.cos(cam3d.yaw);
      const sy = Math.sin(cam3d.yaw);
      const cp = Math.cos(cam3d.pitch);
      const sp = Math.sin(cam3d.pitch);
      const maxT = R * 1.8;
      cam3d.tx = Math.max(-maxT, Math.min(maxT, cam3d.tx + (ux * cy - uy * sy * sp)));
      cam3d.ty = Math.max(-maxT, Math.min(maxT, cam3d.ty + uy * cp));
      cam3d.tz = Math.max(-maxT, Math.min(maxT, cam3d.tz - (ux * sy + uy * cy * sp)));
      camTarget.tx = cam3d.tx;
      camTarget.ty = cam3d.ty;
      camTarget.tz = cam3d.tz;
    };

    // Pointer Interaction (default Move/pan like Tree view; Rotate toggle or Shift/Right-drag for 3D orbit)
    let dragMode: 'orbit' | 'pan' | null = null;
    let lastX = 0;
    let lastY = 0;
    let moved = 0;

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('pointerdown', (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const wantsAlt = e.button === 2 || e.button === 1 || e.shiftKey;
      dragMode =
        dragTool3d === 'pan'
          ? wantsAlt
            ? 'orbit'
            : 'pan'
          : wantsAlt
            ? 'pan'
            : 'orbit';
      lastX = e.clientX;
      lastY = e.clientY;
      moved = 0;
      velYaw = 0;
      velPitch = 0;
      camAnim = null;
      canvas.classList.toggle('is-panning', dragMode === 'pan');
      canvas.classList.toggle('is-dragging', dragMode === 'orbit');
    });

    canvas.addEventListener('pointermove', (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (dragMode) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        moved += Math.hypot(dx, dy);

        if (dragMode === 'orbit') {
          const dYaw = dx * 0.0075;
          const dPitch = dy * 0.0075;
          cam3d.yaw += dYaw;
          cam3d.pitch = Math.max(-1.38, Math.min(1.38, cam3d.pitch + dPitch));
          camTarget.yaw = cam3d.yaw;
          camTarget.pitch = cam3d.pitch;
          velYaw = dYaw * 0.85;
          velPitch = dPitch * 0.85;
        } else {
          // 1:1 screen-plane drag in world coordinates
          const scale = 1 / (baseScale * cam3d.zoom);
          shiftCamTargetByCamXY(-dx * scale, -dy * scale);
        }
        hideTip();
        dirty = true;
        return;
      }

      const hit = hitTest(mx, my);
      if (hit !== hovered) {
        hovered = hit;
        canvas.style.cursor = hit ? 'pointer' : dragTool3d === 'pan' ? 'move' : 'grab';
        dirty = true;
      }
      if (hit) {
        tip(e, hit);
      } else {
        hideTip();
      }
    });

    const endDrag = (e: PointerEvent) => {
      if (!dragMode) return;
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
      const wasClick = moved < 5 && e.button === 0;
      dragMode = null;
      canvas.classList.remove('is-dragging', 'is-panning');
      if (wasClick) {
        velYaw = 0;
        velPitch = 0;
        const rect = canvas.getBoundingClientRect();
        const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
        select(hit);
        if (hit) {
          bringToFront(hit);
        }
        if (hit && jumpSel) {
          jumpSel.value = hit.type === 'kw' ? '__overview__' : hit.id;
        }
        dirty = true;
      }
    };

    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('mouseleave', () => {
      if (!dragMode && hovered) {
        hovered = null;
        dirty = true;
      }
      hideTip();
    });

    canvas.addEventListener('dblclick', (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
      select(hit);
      flyTo(hit);
      if (jumpSel) {
        jumpSel.value = hit && hit.type !== 'kw' ? hit.id : '__overview__';
      }
    });

    // Cursor-anchored wheel zoom so zooming magnifies the cluster under the pointer instead of pulling to center
    canvas.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        e.preventDefault();
        camAnim = null;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const oldZoom = cam3d.zoom;
        const factor = Math.exp(-e.deltaY * 0.0018);
        const newZoom = Math.max(0.35, Math.min(6, oldZoom * factor));
        if (newZoom !== oldZoom) {
          let anchorPs = 1;
          let bestD2 = 120 * 120;
          for (const n of nodes) {
            if (n._px == null || n._py == null || n._ps == null) continue;
            const d2 = (mx - n._px) ** 2 + (my - n._py) ** 2;
            if (d2 < bestD2) {
              bestD2 = d2;
              anchorPs = n._ps;
            }
          }
          const invScale = (1 / oldZoom - 1 / newZoom) / (baseScale * anchorPs);
          shiftCamTargetByCamXY((mx - W / 2) * invScale, (my - H / 2) * invScale);
          cam3d.zoom = newZoom;
          camTarget.zoom = newZoom;
          dirty = true;
        }
      },
      { passive: false }
    );

    // HUD buttons
    jumpSel.addEventListener('change', () => {
      const val = jumpSel.value;
      if (val === '__overview__') {
        select(null);
        flyTo(null);
        return;
      }
      const target = byId.get(val) || null;
      select(target);
      flyTo(target);
    });

    const panBtn = hudCtrl.querySelector<HTMLButtonElement>('#hud3d-pan');
    const rotateBtn = hudCtrl.querySelector<HTMLButtonElement>('#hud3d-rotate');
    const setDragTool = (tool: 'pan' | 'orbit') => {
      dragTool3d = tool;
      panBtn?.classList.toggle('on', tool === 'pan');
      panBtn?.setAttribute('aria-pressed', String(tool === 'pan'));
      rotateBtn?.classList.toggle('on', tool === 'orbit');
      rotateBtn?.setAttribute('aria-pressed', String(tool === 'orbit'));
      if (!hovered) canvas.style.cursor = tool === 'pan' ? 'move' : 'grab';
      update3dHint();
    };
    panBtn?.addEventListener('click', () => setDragTool('pan'));
    rotateBtn?.addEventListener('click', () => setDragTool('orbit'));
    if (!hovered) canvas.style.cursor = dragTool3d === 'pan' ? 'move' : 'grab';

    hudCtrl.querySelector('#hud3d-zin')?.addEventListener('click', () => {
      const next: Partial<typeof CAM3D_DEFAULT> = {
        zoom: Math.min(6, cam3d.zoom * 1.28),
      };
      if (
        state.selected &&
        Math.abs(cam3d.tx) < 1 &&
        Math.abs(cam3d.ty) < 1 &&
        Math.abs(cam3d.tz) < 1
      ) {
        const sel = byId.get(state.selected);
        if (sel && sel.id !== rootNode.id) {
          next.tx = sel.x!;
          next.ty = sel.y!;
          next.tz = sel.z!;
        }
      }
      animateTo(next, 'out', 240);
    });
    hudCtrl.querySelector('#hud3d-zout')?.addEventListener('click', () => {
      animateTo({ zoom: Math.max(0.35, cam3d.zoom / 1.28) }, 'out', 240);
    });
    hudCtrl.querySelector('#hud3d-reset')?.addEventListener('click', () => {
      jumpSel.value = '__overview__';
      select(null);
      flyTo(null);
    });
    const orbitBtn = hudCtrl.querySelector<HTMLButtonElement>('#hud3d-orbit');
    orbitBtn?.addEventListener('click', () => {
      autoOrbit = !autoOrbit;
      orbitBtn.classList.toggle('on', autoOrbit);
      orbitBtn.setAttribute('aria-pressed', String(autoOrbit));
      dirty = true;
    });

    // High-FPS animation loop (idle at 0% CPU when nothing moves)
    let rafId = 0;
    const tick = () => {
      if (!box.isConnected) return;
      const visible = graphPanel.classList.contains('on');
      if (visible) {
        if (!dragMode) {
          if (Math.abs(velYaw) > 0.0001 || Math.abs(velPitch) > 0.0001) {
            cam3d.yaw += velYaw;
            cam3d.pitch = Math.max(-1.38, Math.min(1.38, cam3d.pitch + velPitch));
            camTarget.yaw = cam3d.yaw;
            camTarget.pitch = cam3d.pitch;
            velYaw *= 0.88;
            velPitch *= 0.88;
            dirty = true;
          }
          if (camAnim) {
            const raw = Math.min(1, (performance.now() - camAnim.start) / camAnim.duration);
            const t =
              camAnim.ease === 'inOut'
                ? raw < 0.5
                  ? 4 * raw * raw * raw
                  : 1 - Math.pow(-2 * raw + 2, 3) / 2
                : 1 - Math.pow(1 - raw, 3);
            const { from, to } = camAnim;
            cam3d.yaw = from.yaw + (to.yaw - from.yaw) * t;
            cam3d.pitch = from.pitch + (to.pitch - from.pitch) * t;
            cam3d.zoom = from.zoom + (to.zoom - from.zoom) * t;
            cam3d.tx = from.tx + (to.tx - from.tx) * t;
            cam3d.ty = from.ty + (to.ty - from.ty) * t;
            cam3d.tz = from.tz + (to.tz - from.tz) * t;
            Object.assign(camTarget, cam3d);
            dirty = true;
            if (raw >= 1) {
              Object.assign(cam3d, to);
              Object.assign(camTarget, to);
              camAnim = null;
            }
          } else if (autoOrbit && !hovered) {
            cam3d.yaw += 0.0025;
            camTarget.yaw = cam3d.yaw;
            dirty = true;
          }
        }
        if (dirty) {
          dirty = false;
          renderFrame();
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    renderFrame();
    rafId = requestAnimationFrame(tick);

    stop3d = () => cancelAnimationFrame(rafId);
    reset3d = () => {
      jumpSel.value = '__overview__';
      flyTo(null);
    };
    export3dSvg = () => {
      const lines = links
        .map((l) => {
          const s = l.source as GraphNode;
          const t = l.target as GraphNode;
          const col = linkCol(l, s, t);
          return `<line x1="${s._px!.toFixed(1)}" y1="${s._py!.toFixed(1)}" x2="${t._px!.toFixed(1)}" y2="${t._py!.toFixed(1)}" stroke="${col}" stroke-opacity="0.65" stroke-width="1.3"${l.kind === 'support' ? ' stroke-dasharray="4 4"' : ''}/>`;
        })
        .join('');
      const sorted = [...nodes].sort((a, b) => b._pz! - a._pz!);
      const circles = sorted
        .map((n) => {
          const r = visualRadius(n, n._ps!);
          const showLbl = !n.dup && (state.allLabels || n.type !== 'kw' || labelSet.has(n.id));
          return `<g><circle cx="${n._px!.toFixed(1)}" cy="${n._py!.toFixed(1)}" r="${r.toFixed(1)}" fill="${colFor(n)}"/>${showLbl ? `<text x="${n._px!.toFixed(1)}" y="${(n._py! + r + 14).toFixed(1)}" text-anchor="middle" fill="#f0f6ff" font-size="11">${esc(trunc(n.label, 28))}</text>` : ''}</g>`;
        })
        .join('');
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" style="background:${css('--bg-base')};font-family:Inter,sans-serif">${lines}${circles}</svg>`;
    };

    state._graph = {
      links,
      onHighlight: () => {
        dirty = true;
      },
    };
    if (state.selected) {
      const n = nodes.find((x) => x.id === state.selected);
      if (n) highlight(n);
      else state.selected = null;
    }
  }

  function renderTree(
    svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    _W: number,
    H: number
  ): void {
    const data = hierarchyData();
    const root: any = d3.hierarchy(data);
    root.x0 = H / 2;
    root.y0 = 0;
    root.descendants().forEach((d: any) => {
      d._id = Math.random().toString(36).slice(2);
    });
    const dx = 20;
    const dy = state.mode === 'clusters' ? 230 : 250;
    const tree = d3.tree().nodeSize([dx, dy]);
    const gl = g
      .append('g')
      .attr('fill', 'none')
      .attr('stroke', css('--link'))
      .attr('stroke-width', 1.2);
    const gn = g.append('g');

    function update(src: any) {
      tree(root);
      const nodes = root.descendants();
      const links = root.links();
      const t = svg.transition().duration(300);
      const nodeSel = gn
        .selectAll<SVGGElement, any>('g.node')
        .data(nodes, (d: any) => d._id);
      const enter = nodeSel
        .enter()
        .append('g')
        .attr(
          'class',
          (d: any) =>
            `node ${d.data.type === 'root' ? 'root' : d.data.type !== 'kw' ? 'hub' : ''}`
        )
        .attr('transform', `translate(${src.y0},${src.x0})`)
        .on('click', (e: MouseEvent, d: any) => {
          e.stopPropagation();
          if (d.data.type !== 'kw' && (d.children || d._children)) {
            d.children = d.children ? null : d._children;
            if (!d.children) d._children = d._children || null;
            update(d);
          }
          selectRef(d.data);
        })
        .on('mouseenter', (e: MouseEvent, d: any) =>
          tip(e, { type: d.data.type, label: d.data.name, ref: d.data.ref })
        )
        .on('mousemove', (e: MouseEvent) => moveTip(e))
        .on('mouseleave', () => hideTip());

      enter
        .append('circle')
        .attr('r', (d: any) =>
          d.data.type === 'kw'
            ? 3 + (d.data.ref.relevance / 100) * 5
            : d.data.type === 'root'
              ? 8
              : 6
        )
        .attr('fill', (d: any) =>
          nodeColor({ type: d.data.type, ref: d.data.ref })
        );
      enter
        .append('text')
        .attr('dy', '0.32em')
        .attr('x', (d: any) => (d.data.type === 'kw' ? 10 : -10))
        .attr('text-anchor', (d: any) =>
          d.data.type === 'kw' ? 'start' : 'end'
        )
        .text((d: any) =>
          d.data.type === 'kw'
            ? `${d.data.name}  ${Math.round(d.data.ref.relevance)}`
            : trunc(d.data.name, 36)
        )
        .attr('font-style', (d: any) =>
          d.data.role === 'support' ? 'italic' : null
        );

      nodeSel
        .merge(enter as any)
        .transition(t as any)
        .attr('transform', (d: any) => `translate(${d.y},${d.x})`)
        .select('circle')
        .attr('stroke-width', (d: any) => (d._children && !d.children ? 3 : 1.5))
        .attr('stroke', (d: any) =>
          d._children && !d.children ? css('--accent') : css('--bg-base')
        );

      nodeSel
        .exit()
        .transition(t as any)
        .attr('transform', `translate(${src.y},${src.x})`)
        .remove();

      const linkSel = gl
        .selectAll<SVGPathElement, any>('path')
        .data(links, (d: any) => d.target._id);
      const diag = d3
        .linkHorizontal<any, any>()
        .x((d: any) => d.y)
        .y((d: any) => d.x);
      linkSel
        .enter()
        .append('path')
        .attr('d', () =>
          diag({
            source: { x: src.x0, y: src.y0 },
            target: { x: src.x0, y: src.y0 },
          })
        )
        .attr('stroke-dasharray', (d: any) =>
          d.target.data.role === 'support' ? '3 3' : null
        )
        .merge(linkSel as any)
        .transition(t as any)
        .attr('d', diag);
      linkSel
        .exit()
        .transition(t as any)
        .attr('d', () => diag({ source: src, target: src }))
        .remove();

      nodes.forEach((d: any) => {
        d.x0 = d.x;
        d.y0 = d.y;
      });
    }

    root.descendants().forEach((d: any) => {
      d._children = d.children;
    });
    update(root);
    setTimeout(() => fit(svg, g), 350);
  }

  function fit(
    svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    dur = 500
  ): void {
    const gNode = g.node();
    const svgNode = svg.node();
    if (!gNode || !svgNode || !state.zoom) return;
    const b = gNode.getBBox();
    if (!b.width || !b.height) return;
    const W = svgNode.clientWidth || 720;
    const H = svgNode.clientHeight || 520;
    const pad = 40;
    const k = Math.min(2, Math.min((W - pad) / b.width, (H - pad) / b.height));
    svg
      .transition()
      .duration(dur)
      .call(
        state.zoom.transform as any,
        d3.zoomIdentity
          .translate(
            W / 2 - k * (b.x + b.width / 2),
            H / 2 - k * (b.y + b.height / 2)
          )
          .scale(k)
      );
  }

  $('#fit')?.addEventListener('click', () => {
    if (reset3d) {
      reset3d();
      return;
    }
    const svg = d3.select<SVGSVGElement, unknown>('#page-structure-studio #graph svg');
    if (!svg.empty()) {
      fit(svg as any, svg.select<SVGGElement>('g') as any);
    }
  });

  $('#svgDl')?.addEventListener('click', () => {
    if (export3dSvg) {
      download(
        export3dSvg(),
        `${slug()}-page-structure.svg`,
        'image/svg+xml'
      );
      return;
    }
    const svgEl = $<SVGSVGElement>('#graph svg');
    if (!svgEl) return;
    const clone = svgEl.cloneNode(true) as SVGSVGElement;
    clone.setAttribute(
      'style',
      `background:${css('--bg-base')};font-family:Inter,sans-serif`
    );
    clone.querySelectorAll('text').forEach((t) => {
      t.setAttribute('fill', css('--text-primary'));
      t.setAttribute('stroke', css('--bg-base'));
      t.setAttribute('stroke-width', '3');
      t.setAttribute('paint-order', 'stroke');
      t.setAttribute('font-size', '11');
    });
    download(
      new XMLSerializer().serializeToString(clone),
      `${slug()}-page-structure.svg`,
      'image/svg+xml'
    );
  });

  function select(n: GraphNode | null): void {
    state.selected = n ? n.id : null;
    if (!n) {
      state._graph?.node?.classed('faded', false);
      state._graph?.link?.classed('faded', false);
      state._graph?.onHighlight?.();
      renderDetail(null);
      return;
    }
    highlight(n);
    selectRef({ type: n.type, ref: n.ref });
  }

  function highlight(n: GraphNode): void {
    if (!state._graph) return;
    if (state._graph.onHighlight) {
      state._graph.onHighlight();
    }
    const { node, link, links } = state._graph;
    if (!node || !link) return;
    const nb = new Set([n.id]);
    links.forEach((l) => {
      const sid = typeof l.source === 'object' ? l.source.id : l.source;
      const tid = typeof l.target === 'object' ? l.target.id : l.target;
      if (sid === n.id) nb.add(tid);
      if (tid === n.id) nb.add(sid);
    });
    node.classed('faded', (d) => !nb.has(d.id));
    link.classed('faded', (l) => {
      const sid = typeof l.source === 'object' ? l.source.id : l.source;
      const tid = typeof l.target === 'object' ? l.target.id : l.target;
      return sid !== n.id && tid !== n.id;
    });
    node
      .select('text')
      .attr('display', (d) =>
        nb.has(d.id) || state.allLabels ? null : d.type !== 'kw' ? null : 'none'
      );
  }

  function selectRef(d: { type: string; ref: any } | null): void {
    renderDetail(d);
  }

  // ------------------------------------------------------------------ Tooltip & Detail Inspector
  const tipEl = $('#tip');

  function tip(e: MouseEvent, n: { type: string; label: string; ref: any }): void {
    if (!tipEl) return;
    let h = `<b>${esc(n.label)}</b>`;
    if (n.type === 'kw' && n.ref) {
      h += `<br>Relevance ${n.ref.relevance} · ${esc(n.ref.tier)}<br>${n.ref.frequency}× in copy & headings · ${n.ref.section_count} sections`;
    } else if (n.type === 'cluster' && n.ref) {
      h += `<br>${n.ref.keywords.length} keywords · strength ${n.ref.strength}`;
    } else if (n.type === 'section' && n.ref) {
      h += `<br>${esc(n.ref.tag.toUpperCase())} · ${n.ref.cumulative_word_count} words · support ${n.ref.alignment ?? '–'}/100`;
    }
    tipEl.innerHTML = h;
    tipEl.style.display = 'block';
    moveTip(e);
  }

  function moveTip(e: MouseEvent): void {
    if (!tipEl) return;
    tipEl.style.left = Math.min(window.innerWidth - 290, e.clientX + 14) + 'px';
    tipEl.style.top = e.clientY + 14 + 'px';
  }

  function hideTip(): void {
    if (tipEl) tipEl.style.display = 'none';
  }

  function placements(k: KeywordEntry): string {
    const items: Array<[string, boolean]> = [
      ['Title', k.in_title],
      ['H1', k.in_h1],
      ['URL', k.in_url],
      ['Meta desc.', k.in_meta],
      [`H2 ×${k.h2_count}`, k.h2_count > 0],
      [`H3 ×${k.h3_count}`, k.h3_count > 0],
      [`Bold ×${k.emphasis_count}`, k.emphasis_count > 0],
      [`Alt ×${k.alt_count}`, k.alt_count > 0],
      [`Anchor ×${k.anchor_count}`, k.anchor_count > 0],
    ];
    return items
      .map(
        ([l, on]) =>
          `<span class="tag ${on ? 'on' : ''}">${on ? '✓' : '–'} ${l}</span>`
      )
      .join('');
  }

  function renderDetail(d: { type: string; ref: any } | null): void {
    const el = $('#detail');
    const data = state.data;
    if (!el || !data) return;

    if (!d || (d.type === 'root' && state.mode === 'clusters' && !d.ref)) {
      d = null;
    }
    if (!d) {
      const top = data.keywords.slice(0, 12);
      el.innerHTML = `<h3>${esc(data.main_topic?.keyword || 'Page')}</h3><div class="muted small">Main topic of ${esc(data.meta.title || data.url)}</div>
        <h4>Strongest signals</h4>${top
          .map(
            (k) =>
              `<div class="signal-row">
                <div class="signal-row-top"><span>${esc(k.keyword)}</span><span class="mono muted">${k.relevance}</span></div>
                <div class="signal-bar-track"><div class="signal-bar-fill" style="width:${Math.max(4, k.relevance)}%"></div></div>
              </div>`
          )
          .join('')}
        <h4>How to read this</h4><p class="muted small">Node size is relevance (0–100). Click any node for its signals. Switch to <b>Heading hierarchy</b> to see which headings target which keywords, and which copy terms back them up.</p>`;
      return;
    }

    if (d.type === 'kw' || (d.type === 'root' && d.ref?.relevance != null)) {
      const k: ClientKeyword = state.kwById[d.ref.id] || d.ref;
      const co = data.cooccurrence
        .filter((e) => e.source === k.id || e.target === k.id)
        .slice(0, 10)
        .map((e) => state.kwById[e.source === k.id ? e.target : e.source])
        .filter(Boolean);
      const secName = (id: number) =>
        esc(trunc(state.secById[id]?.heading || '', 40));
      const bing = getBingConfig();
      const volText =
        k.search_volume != null
          ? `<b>${fmt(k.search_volume)}</b> matches <span class="tag-bing">Bing</span>`
          : bing?.key
            ? `<span class="muted">Not fetched</span> · <button type="button" class="btn-table-key-link" id="btnDetailFetchThisKw">Fetch</button>`
            : `<button type="button" class="btn-table-key-link" data-action="open-keys">+ Connect Bing API</button>`;

      el.innerHTML = `<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
          ${gaugeRingSvg(k.relevance, String(Math.round(k.relevance)), 'g-det-kw')}
          <div style="min-width:0;flex:1">
            <h3>${esc(k.keyword)}</h3>
            <span class="tier ${esc(k.tier)}">${esc(k.tier)}</span> <span class="muted small">Rank #${k.rank} · ${esc(k.cluster)}</span>
          </div>
        </div>
        <dl><dt>Relevance</dt><dd><b>${k.relevance}</b> / 100</dd>
        <dt>Search Vol.</dt><dd>${volText}</dd>
        <dt>Frequency</dt><dd>${k.frequency} (${k.body_count} in body copy)</dd>
        <dt>Density</dt><dd>${k.density}%</dd><dt>Sections</dt><dd>${k.section_count}</dd>
        <dt>First seen</dt><dd>${k.first_position == null ? 'headings only' : k.first_position + '% into the copy'}</dd></dl>
        <h4>Placements</h4>${placements(k)}
        ${k._inHeadings?.length ? `<h4>Targeted by headings</h4>${k._inHeadings.map((id) => `<span class="tag">${secName(id)}</span>`).join('')}` : ''}
        ${k._supports?.length ? `<h4>Supports sections</h4>${k._supports.map((id) => `<span class="tag">${secName(id)}</span>`).join('')}` : ''}
        ${co.length ? `<h4>Co-occurs with</h4>${co.map((c) => `<span class="tag">${esc(c.keyword)}</span>`).join('')}` : ''}`;

      $('#btnDetailFetchThisKw')?.addEventListener('click', async () => {
        const b = getBingConfig();
        if (!b) return;
        const btn = $<HTMLButtonElement>('#btnDetailFetchThisKw');
        if (btn) btn.textContent = 'Fetching…';
        try {
          const res = await fetchKeywordVolumeBatch([k.keyword], b);
          if (res[k.keyword] != null) {
            k.search_volume = res[k.keyword];
            if (state.data) {
              const found = state.data.keywords.find((x) => x.id === k.id);
              if (found) found.search_volume = res[k.keyword];
            }
            renderDetail({ type: 'kw', ref: k });
            renderTable();
          }
        } finally {
          if (btn) btn.textContent = 'Fetch';
        }
      });
      return;
    }

    if (d.type === 'cluster') {
      const c: ClusterEntry = d.ref;
      el.innerHTML = `<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
          ${gaugeRingSvg(c.avg_relevance, String(Math.round(c.avg_relevance)), 'g-det-cl')}
          <div style="min-width:0;flex:1">
            <h3>${esc(c.label)}</h3>
            <div class="muted small">Topic cluster · ${c.keywords.length} keywords · avg ${c.avg_relevance}</div>
          </div>
        </div>
        <h4>Keywords</h4>${c.keywords
          .map((id) => state.kwById[id])
          .filter(Boolean)
          .map(
            (k) =>
              `<div class="signal-row">
                <div class="signal-row-top"><span>${esc(k.keyword)}</span><span class="mono muted">${k.relevance}</span></div>
                <div class="signal-bar-track"><div class="signal-bar-fill" style="width:${Math.max(4, k.relevance)}%"></div></div>
              </div>`
          )
          .join('')}`;
      return;
    }

    const s: SectionEntry = d.ref;
    el.innerHTML = `<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
        ${s.alignment != null ? gaugeRingSvg(s.alignment, `${s.alignment}%`, 'g-det-sec') : ''}
        <div style="min-width:0;flex:1">
          <h3>${esc(s.heading)}</h3>
          <div class="muted small">${s.level === 0 ? 'Page' : esc(s.tag.toUpperCase())} · ${s.cumulative_word_count} words${s.alignment != null ? ` · ${esc(s.alignment_label)} support (${s.alignment}/100)` : ''}</div>
        </div>
      </div>
      <h4>Heading keywords</h4>${s.heading_keywords.length ? s.heading_keywords.map((h) => `<span class="tag on">${esc(h.keyword)} · ${h.copy_mentions}× in copy</span>`).join('') : `<span class="muted small">None</span>`}
      <h4>Supported by</h4>${
        s.supporting_keywords
          .map(
            (h) =>
              `<div class="signal-row">
                <div class="signal-row-top"><span>${esc(h.keyword)}${h.related_to_heading ? ' ●' : ''}</span><span class="mono muted">${h.mentions}× · ${h.support}</span></div>
                <div class="signal-bar-track"><div class="signal-bar-fill" style="width:${Math.max(6, Math.min(100, h.support))}%"></div></div>
              </div>`
          )
          .join('') || `<span class="muted small">No supporting copy</span>`
      }
      ${s.notes.length ? `<h4>Notes</h4>${s.notes.map((n) => `<p class="muted small" style="margin:0 0 4px">${esc(n)}</p>`).join('')}` : ''}
      ${s.excerpt ? `<h4>Excerpt</h4><p class="muted small">${esc(s.excerpt)}…</p>` : ''}`;
  }

  // ------------------------------------------------------------------ Data Table & CSV Exports
  const COLS: Array<[string, string, string?]> = [
    ['rank', '#', 'num'],
    ['keyword', 'Keyword'],
    ['search_volume', 'Search Vol. (Bing)', 'num'],
    ['relevance', 'Relevance', 'num'],
    ['tier', 'Tier'],
    ['cluster', 'Cluster'],
    ['words', 'Words', 'num'],
    ['frequency', 'Freq.', 'num'],
    ['density', 'Density %', 'num'],
    ['section_count', 'Sections', 'num'],
    ['in_title', 'Title'],
    ['in_h1', 'H1'],
    ['in_url', 'URL'],
    ['in_meta', 'Meta'],
    ['h2_count', 'H2', 'num'],
    ['h3_count', 'H3', 'num'],
    ['emphasis_count', 'Bold', 'num'],
    ['first_position', 'First seen %', 'num'],
  ];

  const btnFetchBingVol = $<HTMLButtonElement>('#btnFetchBingVol');
  const bingVolStatus = $('#bingVolStatus');

  async function triggerFetchBingVolume(silent = false): Promise<void> {
    if (!state.data || !state.data.keywords.length) {
      if (!silent) showErr('Analyze a page first before fetching keyword volumes.');
      return;
    }

    const bing = getBingConfig();
    if (!bing || !bing.key) {
      if (!silent) {
        openApiKeysPage();
        if (bingTestFeedback) {
          bingTestFeedback.hidden = false;
          bingTestFeedback.className = 'api-test-feedback is-loading';
          bingTestFeedback.textContent =
            'Please enter and save your Bing API key to fetch real search volume.';
        }
      }
      return;
    }

    const keywordsToFetch = state.data.keywords
      .slice(0, 40)
      .map((k) => k.keyword);
    if (!keywordsToFetch.length) return;

    if (btnFetchBingVol) btnFetchBingVol.disabled = true;
    if (bingVolStatus) {
      bingVolStatus.hidden = false;
      bingVolStatus.textContent = `Fetching Bing volume (0/${keywordsToFetch.length})…`;
    }

    try {
      const volMap = await fetchKeywordVolumeBatch(
        keywordsToFetch,
        bing,
        (done, total) => {
          if (bingVolStatus) {
            bingVolStatus.textContent = `Fetching Bing volume (${done}/${total})…`;
          }
        }
      );

      let updatedCount = 0;
      state.data.keywords.forEach((k) => {
        const v = volMap[k.keyword];
        if (v != null) {
          k.search_volume = v;
          if (state.kwById[k.id]) {
            state.kwById[k.id].search_volume = v;
          }
          updatedCount++;
        }
      });

      renderTable();
      if (state.selected) {
        const selNode = state.kwById[state.selected];
        if (selNode) renderDetail({ type: 'kw', ref: selNode });
      }

      if (bingVolStatus) {
        bingVolStatus.textContent = `✓ ${updatedCount} keyword volumes synced`;
        setTimeout(() => {
          if (bingVolStatus) bingVolStatus.hidden = true;
        }, 5000);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (bingVolStatus) {
        bingVolStatus.textContent = `Bing volume error: ${msg}`;
      }
    } finally {
      if (btnFetchBingVol) btnFetchBingVol.disabled = false;
    }
  }

  btnFetchBingVol?.addEventListener('click', () => {
    triggerFetchBingVolume(false);
  });

  $<HTMLInputElement>('#filter')?.addEventListener('input', (e) => {
    state.filter = (e.target as HTMLInputElement).value.toLowerCase();
    renderTable();
  });
  $<HTMLSelectElement>('#tierSel')?.addEventListener('change', (e) => {
    state.tier = (e.target as HTMLSelectElement).value;
    renderTable();
  });
  $<HTMLSelectElement>('#clusterSel')?.addEventListener('change', (e) => {
    state.cluster = (e.target as HTMLSelectElement).value;
    renderTable();
  });

  function filteredKeywords(): ClientKeyword[] {
    if (!state.data) return [];
    const { filter, tier, cluster, sort } = state;
    return state.data.keywords
      .map((k) => state.kwById[k.id] || (k as ClientKeyword))
      .filter(
        (k) =>
          (!filter || k.keyword.toLowerCase().includes(filter)) &&
          (tier === 'all' || k.tier === tier) &&
          (cluster === 'all' || k.cluster === cluster)
      )
      .sort((a, b) => {
        const x = (a as any)[sort.key];
        const y = (b as any)[sort.key];
        if ((x == null) !== (y == null)) return x == null ? 1 : -1;
        return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
      });
  }

  function renderTable(): void {
    if (!state.data) return;
    const rows = filteredKeywords();
    const countEl = $('#count');
    if (countEl) {
      countEl.textContent = `${rows.length} of ${state.data.keywords.length} keywords`;
    }
    const cell = (k: ClientKeyword, [key, , cls]: [string, string, string?]) => {
      const v = (k as any)[key];
      if (key === 'search_volume') {
        const bing = getBingConfig();
        if (v != null && typeof v === 'number') {
          return `<td class="num font-mono"><b>${fmt(v)}</b><span class="tag-bing">Bing</span></td>`;
        }
        if (bing && bing.key) {
          return `<td class="num muted">–</td>`;
        }
        return `<td class="num"><button type="button" class="btn-table-key-link" data-action="open-keys" title="Enter Bing API key to fetch real volume">+ Connect Bing</button></td>`;
      }
      if (key === 'relevance') {
        return `<td class="num"><b>${v}</b><span class="bar" style="width:${Number(v) * 0.5}px"></span></td>`;
      }
      if (key === 'tier') {
        return `<td><span class="tier ${esc(v)}">${esc(v)}</span></td>`;
      }
      if (typeof v === 'boolean') {
        return `<td>${v ? '<span class="yes">✓</span>' : '<span class="no">–</span>'}</td>`;
      }
      return `<td class="${cls || ''}">${v == null ? '–' : esc(v)}</td>`;
    };

    const tblEl = $('#tbl');
    if (!tblEl) return;
    tblEl.innerHTML = `<thead><tr>${COLS.map(
      (c) =>
        `<th class="${c[2] || ''}" data-k="${c[0]}">${c[1]}${state.sort.key === c[0] ? ` <span class="arr">${state.sort.dir < 0 ? '↓' : '↑'}</span>` : ''}</th>`
    ).join('')}</tr></thead>
      <tbody>${rows.map((k) => `<tr>${COLS.map((c) => cell(k, c)).join('')}</tr>`).join('')}</tbody>`;

    $$<HTMLTableCellElement>('#tbl th').forEach((th) => {
      th.addEventListener('click', () => {
        const k = th.dataset.k!;
        state.sort = {
          key: k,
          dir:
            state.sort.key === k
              ? (-state.sort.dir as 1 | -1)
              : ['keyword', 'tier', 'cluster', 'rank', 'first_position'].includes(k)
                ? 1
                : -1,
        };
        renderTable();
      });
    });
  }

  const csvCell = (v: unknown): string => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const toCsv = (head: string[], rows: unknown[][]): string =>
    '\uFEFF' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');

  $('#csvKw')?.addEventListener('click', () => {
    const head = [
      'rank',
      'keyword',
      'search_volume_bing',
      'relevance',
      'tier',
      'cluster',
      'words',
      'frequency',
      'body_count',
      'density_pct',
      'section_count',
      'in_title',
      'in_h1',
      'in_url',
      'in_meta_description',
      'h2_count',
      'h3_count',
      'heading_count',
      'emphasis_count',
      'alt_count',
      'anchor_count',
      'first_position_pct',
      'targeted_by_headings',
      'supports_sections',
    ];
    const rows = filteredKeywords().map((k) => [
      k.rank,
      k.keyword,
      k.search_volume ?? '',
      k.relevance,
      k.tier,
      k.cluster,
      k.words,
      k.frequency,
      k.body_count,
      k.density,
      k.section_count,
      k.in_title,
      k.in_h1,
      k.in_url,
      k.in_meta,
      k.h2_count,
      k.h3_count,
      k.heading_count,
      k.emphasis_count,
      k.alt_count,
      k.anchor_count,
      k.first_position,
      k._inHeadings.map((id) => state.secById[id]?.heading || '').join(' | '),
      k._supports.map((id) => state.secById[id]?.heading || '').join(' | '),
    ]);
    download(toCsv(head, rows), `${slug()}-keywords.csv`, 'text/csv');
  });

  $('#csvSec')?.addEventListener('click', () => {
    if (!state.data) return;
    const head = [
      'section_id',
      'level',
      'heading',
      'parent_heading',
      'words',
      'words_incl_subsections',
      'heading_keywords',
      'supporting_keywords',
      'alignment_score',
      'alignment',
      'notes',
    ];
    const rows = state.data.sections.map((s) => [
      s.id,
      s.level === 0 ? 'page' : s.tag.toUpperCase(),
      s.heading,
      s.parent != null ? state.secById[s.parent]?.heading || '' : '',
      s.word_count,
      s.cumulative_word_count,
      s.heading_keywords
        .map((h) => `${h.keyword} (${h.copy_mentions}x)`)
        .join('; '),
      s.supporting_keywords
        .map((h) => `${h.keyword} (${h.mentions}x)`)
        .join('; '),
      s.alignment ?? '',
      s.alignment_label ?? '',
      s.notes.join(' '),
    ]);
    download(toCsv(head, rows), `${slug()}-sections.csv`, 'text/csv');
  });

  // ------------------------------------------------------------------ Text Outline View
  function buildText(): string {
    const d = state.data;
    if (!d) return '';
    const m = d.meta;
    const L: string[] = [];
    const rule = '='.repeat(72);
    L.push(
      'PAGE STRUCTURE',
      rule,
      `Page:        ${m.title}`,
      `URL:         ${d.url}`,
      `Analysed:    ${d.analyzed_at}`,
      `Main topic:  ${d.main_topic?.keyword || '–'}`,
      `Body copy:   ${fmt(m.word_count)} words · ${d.sections.filter((s) => s.level > 0).length} sections · ${d.keywords.length} keywords`,
      ''
    );
    L.push('TOP KEYWORDS (relevance 0-100)', '-'.repeat(72));
    d.keywords
      .slice(0, 25)
      .forEach((k) =>
        L.push(
          `  ${String(k.relevance).padStart(5)}  ${k.keyword.padEnd(38)} ${k.tier}`
        )
      );
    L.push(
      '',
      'TOPIC CLUSTERS',
      '-'.repeat(72),
      `${d.main_topic?.keyword || '–'}  [main topic]`
    );
    d.clusters.forEach((c, i) => {
      const last = i === d.clusters.length - 1;
      L.push(
        `${last ? '└──' : '├──'} ${c.label}  (${c.keywords.length} terms, strength ${c.strength})`
      );
      const ks = c.keywords
        .slice(0, c.id === 'c_other' ? 12 : 20)
        .map((id) => state.kwById[id])
        .filter(Boolean);
      ks.forEach((k, j) =>
        L.push(
          `${last ? '    ' : '│   '}${j === ks.length - 1 ? '└──' : '├──'} ${k.keyword} [${k.relevance}]`
        )
      );
      if (c.keywords.length > ks.length) {
        L.push(
          `${last ? '    ' : '│   '}    … ${c.keywords.length - ks.length} more`
        );
      }
    });
    L.push(
      '',
      'HEADING HIERARCHY  (heading → heading keywords → supporting copy keywords)',
      '-'.repeat(72)
    );
    const walk = (s: SectionEntry, depth: number) => {
      const ind = '    '.repeat(depth);
      if (s.level === 0) {
        L.push(
          `PAGE  ${s.heading}`,
          `  title keywords: ${s.heading_keywords.map((h) => h.keyword).join(', ') || '—'}`
        );
      } else {
        L.push(
          `${ind}${s.tag.toUpperCase()}  ${s.heading}${s.alignment != null ? `   [${s.alignment_label} support ${s.alignment}/100, ${s.cumulative_word_count} words]` : ''}`
        );
        L.push(
          `${ind}    heading keywords: ${s.heading_keywords.map((h) => `${h.keyword} (${h.copy_mentions}× in copy)`).join(', ') || '— none —'}`
        );
        L.push(
          `${ind}    supported by:     ${s.supporting_keywords.slice(0, 8).map((h) => `${h.keyword} (${h.mentions}×)`).join(', ') || '— no copy —'}`
        );
      }
      s.children
        .map((c) => state.secById[c])
        .filter(Boolean)
        .forEach((c) => walk(c, s.level === 0 ? 0 : depth + 1));
    };
    const rootSec = d.sections.find((s) => s.level === 0);
    if (rootSec) walk(rootSec, 0);
    if (d.issues.length) {
      L.push('', 'ISSUES', '-'.repeat(72));
      d.issues.forEach((i) =>
        L.push(`  [${i.severity.toUpperCase()}] ${i.message}`)
      );
    }
    return L.join('\n');
  }

  function renderText(): void {
    const out = $('#textOut');
    if (out) out.textContent = buildText();
  }

  const copyTxtBtn = $<HTMLButtonElement>('#copyTxt');
  copyTxtBtn?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(buildText());
    copyTxtBtn.textContent = 'Copied';
    setTimeout(() => {
      copyTxtBtn.textContent = 'Copy';
    }, 1200);
  });

  $('#dlTxt')?.addEventListener('click', () => {
    download(buildText(), `${slug()}-page-structure.txt`, 'text/plain');
  });

  // ------------------------------------------------------------------ Report View
  const q = (s: string) => `“${s}”`;
  const listJoin = (a: string[]) =>
    a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];

  function sectionSentence(s: SectionEntry, md = false): string {
    const kw = (x: string) => (md ? `**${x}**` : `<span class="kw">${esc(x)}</span>`);
    const sup = s.supporting_keywords
      .slice(0, 5)
      .map((h) => `${md ? h.keyword : esc(h.keyword)} (${h.mentions}×)`);
    const hk = s.heading_keywords;
    let t: string;
    if (hk.length) {
      t = `This section has ${listJoin(hk.map((h) => kw(h.keyword)))} in the heading`;
      t += sup.length
        ? `, which is supported by ${listJoin(sup)} in the copy.`
        : `, but there is little copy to support it.`;
      const rep = hk
        .map((h) =>
          h.copy_mentions
            ? `${md ? q(h.keyword) : esc(q(h.keyword))} is repeated ${h.copy_mentions}× in the copy`
            : null
        )
        .filter((x): x is string => Boolean(x));
      if (rep.length) t += ` ${listJoin(rep)}.`;
    } else {
      t =
        `The heading doesn't contain any of the page's ranking keywords` +
        (sup.length ? `; the copy focuses on ${listJoin(sup)}.` : '.');
    }
    return t;
  }

  function reportModel() {
    const d = state.data!;
    const m = d.meta;
    const main = d.keywords[0];
    const secs = d.sections.filter((s) => s.level > 0);
    const avg = secs.length
      ? Math.round(d3.mean(secs, (s) => s.alignment ?? 0) ?? 0)
      : 0;
    const clusters = d.clusters.filter((c) => c.id !== 'c_other');
    return { d, m, main, secs, avg, clusters };
  }

  function renderReport(): void {
    const reportOut = $('#reportOut');
    if (!reportOut || !state.data || !state.data.keywords.length) return;
    const { d, m, main, secs, avg, clusters } = reportModel();
    const checks: Array<[string, boolean]> = [
      ['Title', main.in_title],
      ['H1', main.in_h1],
      ['URL slug', main.in_url],
      ['Meta description', main.in_meta],
      [
        'Opening copy (first 10%)',
        main.first_position != null && main.first_position <= 10,
      ],
      ['Subheadings (H2/H3)', main.h2_count + main.h3_count > 0],
    ];
    const sup = d.keywords
      .filter((k) => k.tier !== 'Long-tail')
      .slice(1, 9)
      .map((k) => k.keyword);
    const page = d.sections.find((s) => s.level === 0)!;

    const rows = (s: SectionEntry): string => {
      const kids = s.children
        .map((c) => d.sections.find((x) => x.id === c))
        .filter((x): x is SectionEntry => Boolean(x));
      const self =
        s.level === 0
          ? ''
          : `<div class="sec ${esc(s.alignment_label)}" style="margin-left:${Math.max(0, s.level - 1) * 18}px">
        <span class="score">${esc(s.alignment_label)} support · ${s.alignment}/100 · ${s.cumulative_word_count} words</span>
        <h3><span class="lvl">${esc(s.tag.toUpperCase())}</span>${esc(s.heading)}</h3>
        <p>${sectionSentence(s)}</p>
        ${s.notes.length ? `<ul>${s.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}</div>`;
      return self + kids.map(rows).join('');
    };

    reportOut.innerHTML = `
      <h2>Page Structure report</h2>
      <p class="lede">${esc(m.title || d.url)}<br><span class="small muted">${esc(d.url)} · analysed ${esc(d.analyzed_at.replace('T', ' ').replace('+00:00', ' UTC'))}</span></p>
      <p>The page's main topic is <span class="kw">${esc(main.keyword)}</span>. It is supported by ${clusters.length} sub-topic cluster${clusters.length === 1 ? '' : 's'}${clusters.length ? ` (${listJoin(clusters.slice(0, 6).map((c) => esc(c.label)))})` : ''}
        across ${secs.length} sections and ${fmt(m.word_count)} words of body copy. ${sup.length ? `The strongest secondary signals are ${listJoin(sup.map(esc))}.` : ''}
        On average, headings are backed up by their copy at <b>${avg}/100</b>.</p>

      <h2>Main topic placement</h2>
      <p>Where <span class="kw">${esc(main.keyword)}</span> appears in the page's most important positions:</p>
      <div class="checks">${checks.map(([l, ok]) => `<div class="check"><b style="color:${ok ? 'var(--ok)' : 'var(--danger)'}">${ok ? '✓ Present' : '✗ Missing'}</b>${l}</div>`).join('')}</div>
      <p class="small muted">Frequency ${main.frequency} · density ${main.density}% · appears in ${main.section_count} sections.</p>

      <h2>Top keywords</h2>
      <table class="mini"><thead><tr><th>Keyword</th><th class="num">Relevance</th><th>Tier</th><th>Cluster</th><th class="num">Freq.</th><th>Key placements</th></tr></thead><tbody>
      ${d.keywords
        .slice(0, 15)
        .map(
          (k) => `<tr><td>${esc(k.keyword)}</td><td class="num"><b>${k.relevance}</b></td><td><span class="tier ${esc(k.tier)}">${esc(k.tier)}</span></td><td>${esc(k.cluster)}</td><td class="num">${k.frequency}</td>
        <td>${[k.in_title && 'Title', k.in_h1 && 'H1', k.in_url && 'URL', k.in_meta && 'Meta', k.h2_count && `H2×${k.h2_count}`, k.h3_count && `H3×${k.h3_count}`].filter(Boolean).join(', ') || 'Copy only'}</td></tr>`
        )
        .join('')}
      </tbody></table>

      <h2>Topic clusters</h2>
      ${
        clusters
          .slice(0, 10)
          .map((c) => {
            const ks = c.keywords
              .slice(0, 7)
              .map((id) => state.kwById[id])
              .filter(Boolean);
            return `<p><span class="kw">${esc(c.label)}</span> (${c.keywords.length} terms, avg relevance ${c.avg_relevance}): ${ks.map((k) => `${esc(k.keyword)} <span class="muted mono">${k.relevance}</span>`).join(', ')}.</p>`;
          })
          .join('') || '<p>No distinct sub-topic clusters were detected.</p>'
      }

      <h2>Section-by-section</h2>
      <p class="small muted">For each heading: the keywords it targets, and the copy terms beneath it that support it (mentions in that section, including its sub-sections). Support score blends whether heading keywords recur in the copy (50%), related supporting terms (30%) and section depth (20%).</p>
      ${page.heading_keywords.length ? `<div class="sec"><h3><span class="lvl">TITLE</span>${esc(m.title)}</h3><p>The title targets ${listJoin(page.heading_keywords.map((h) => `<span class="kw">${esc(h.keyword)}</span>`))}.</p></div>` : ''}
      ${rows(page)}

      <h2>Issues &amp; recommendations</h2>
      ${d.issues.map((i) => `<div class="issue"><span class="sev ${esc(i.severity)}">${esc(i.severity)}</span>${esc(i.message)}</div>`).join('') || '<p>No on-page issues detected.</p>'}

      <h2>How relevance is estimated</h2>
      <p class="method">Every 1–4 word phrase on the page is a candidate. Its score adds placement weights (title 10, H1 8, URL 6, H2 5, meta description 5, H3 3, H4–H6 2, bold and alt text 1.5, anchor text 1) to body frequency with diminishing returns, plus bonuses for appearing early in the copy, being spread across many sections and being an exact match for the title/H1. Longer phrases get a specificity multiplier, and fragments that only appear inside a longer phrase are discounted. Scores are normalised so the strongest keyword is 100. Tiers: Primary ≥ 65, Secondary ≥ 45, Supporting ≥ 25, Long-tail below. Scores are on-page estimates only and don't include search volume or competition.</p>`;
  }

  function buildMarkdown(): string {
    if (!state.data || !state.data.keywords.length) return '';
    const { d, m, main, secs, avg, clusters } = reportModel();
    const L: string[] = [
      `# Page Structure report: ${m.title || d.url}`,
      '',
      `- URL: ${d.url}`,
      `- Analysed: ${d.analyzed_at}`,
      `- Main topic: **${main.keyword}**`,
      `- ${fmt(m.word_count)} words · ${secs.length} sections · ${d.keywords.length} keywords · heading support ${avg}/100`,
      '',
      '## Main topic placement',
      '',
      ...(
        [
          ['Title', main.in_title],
          ['H1', main.in_h1],
          ['URL', main.in_url],
          ['Meta description', main.in_meta],
          ['Opening copy', main.first_position != null && main.first_position <= 10],
        ] as Array<[string, boolean]>
      ).map(([l, ok]) => `- [${ok ? 'x' : ' '}] ${l}`),
      '',
      '## Top keywords',
      '',
      '| Keyword | Relevance | Tier | Cluster | Freq |',
      '|---|---:|---|---|---:|',
      ...d.keywords
        .slice(0, 20)
        .map(
          (k) =>
            `| ${k.keyword} | ${k.relevance} | ${k.tier} | ${k.cluster} | ${k.frequency} |`
        ),
      '',
      '## Topic clusters',
      '',
      ...clusters.map(
        (c) =>
          `- **${c.label}** (${c.keywords.length}): ${c.keywords
            .slice(0, 8)
            .map((id) => state.kwById[id]?.keyword || id)
            .join(', ')}`
      ),
      '',
      '## Section-by-section',
      '',
    ];
    secs.forEach((s) => {
      L.push(
        `### ${s.tag.toUpperCase()}: ${s.heading}`,
        '',
        `*${s.alignment_label} support (${s.alignment}/100) · ${s.cumulative_word_count} words*`,
        '',
        sectionSentence(s, true),
        ''
      );
      s.notes.forEach((n) => L.push(`- ${n}`));
      if (s.notes.length) L.push('');
    });
    L.push(
      '## Issues',
      '',
      ...d.issues.map((i) => `- **${i.severity}**: ${i.message}`)
    );
    return L.join('\n');
  }

  $('#dlMd')?.addEventListener('click', () => {
    download(
      buildMarkdown(),
      `${slug()}-page-structure-report.md`,
      'text/markdown'
    );
  });

  $('#printRep')?.addEventListener('click', () => window.print());

  // ------------------------------------------------------------------ Utilities & Auto-Run
  function trunc(s: unknown, n: number): string {
    const str = String(s ?? '');
    return str.length > n ? str.slice(0, n - 1) + '…' : str;
  }

  function slug(): string {
    try {
      const u = new URL(state.data?.url || '');
      return (
        (u.hostname + u.pathname)
          .replace(/[^a-z0-9]+/gi, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 60) || 'page'
      );
    } catch {
      return 'page';
    }
  }

  function download(text: string, name: string, type: string): void {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(
      new Blob([text], { type: type + ';charset=utf-8' })
    );
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  let rz: ReturnType<typeof setTimeout>;
  window.addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => renderGraph(), 250);
  });

  const qs = new URLSearchParams(window.location.search).get('url');
  if (qs) {
    const urlInput = $<HTMLInputElement>('#url');
    if (urlInput) {
      urlInput.value = qs;
      analyze();
    }
  }
}

initStudio();

// Wire up About dialogue
const about = document.getElementById('about-dialog') as HTMLDialogElement | null;
const openAbout = () => {
  if (about && !about.open) about.showModal();
};
document.getElementById('btn-about')?.addEventListener('click', openAbout);
document.getElementById('btn-close-about')?.addEventListener('click', () => about?.close());
about?.addEventListener('click', (e) => {
  if (e.target === about) about.close();
});
about?.addEventListener('close', () => {
  if (location.hash === '#about-semantic-page-structure') {
    history.replaceState(null, '', location.pathname + location.search);
  }
});
if (location.hash === '#about-semantic-page-structure') openAbout();


