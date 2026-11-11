import './styles.css';
import * as d3 from 'd3';
import type {
  AnalysisResult,
  ClusterEntry,
  KeywordEntry,
  SectionEntry,
} from './lib/types';

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
      node: d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown>;
      link: d3.Selection<SVGLineElement, GraphLink, SVGGElement, unknown>;
      links: GraphLink[];
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

  // ------------------------------------------------------------------ View Switcher & Split Resizer
  const viewButtons = $$<HTMLButtonElement>('.segment-btn[data-view]');
  viewButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.view || 'split';
      rootEl.setAttribute('data-view', v);
      viewButtons.forEach((b) => {
        const active = b === btn;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', String(active));
      });
      if (v !== 'input' && state.data) {
        setTimeout(() => renderGraph(), 60);
      }
    });
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
  }

  // ------------------------------------------------------------------ Summary
  function renderSummary(): void {
    const d = state.data;
    if (!d) return;
    const m = d.meta;
    const tiers = d3.rollup(
      d.keywords,
      (v) => v.length,
      (k) => k.tier
    );
    const secs = d.sections.filter((s) => s.level > 0);
    const avgAlign = secs.length
      ? Math.round(d3.mean(secs, (s) => s.alignment ?? 0) ?? 0)
      : 0;

    const summaryEl = $('#summary');
    if (!summaryEl) return;
    summaryEl.innerHTML = `
      <div class="card"><div class="k">Main topic</div><div class="v topic">${esc(d.main_topic?.keyword || '–')}</div>
        <div class="s" title="${esc(m.title)}">${esc(m.title || d.url)}</div></div>
      <div class="card"><div class="k">Keywords</div><div class="v">${d.keywords.length}</div>
        <div class="s">${tiers.get('Primary') || 0} primary · ${tiers.get('Secondary') || 0} secondary</div></div>
      <div class="card"><div class="k">Topic clusters</div><div class="v">${d.clusters.filter((c) => c.id !== 'c_other').length}</div><div class="s">sub-topics detected</div></div>
      <div class="card"><div class="k">Sections</div><div class="v">${secs.length}</div><div class="s">${
        Object.entries(m.heading_counts)
          .filter(([, v]) => v)
          .map(([k, v]) => `${v} ${k.toUpperCase()}`)
          .join(' · ') || 'no headings'
      }</div></div>
      <div class="card"><div class="k">Words</div><div class="v">${fmt(m.word_count)}</div><div class="s">main body copy</div></div>
      <div class="card"><div class="k">Heading support</div><div class="v">${avgAlign}<span style="font-size:12px;color:var(--text-tertiary)">/100</span></div><div class="s">avg. heading ↔ copy alignment</div></div>`;
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
  let sim: d3.Simulation<GraphNode, GraphLink> | null = null;

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
    if (sim) {
      sim.stop();
      sim = null;
    }
    const box = $('#graph');
    if (!box) return;
    d3.select(box).select('svg').remove();
    const W = box.clientWidth || 720;
    const H = box.clientHeight || 520;
    const svg = d3
      .select(box)
      .insert('svg', ':first-child')
      .attr('viewBox', `0 0 ${W} ${H}`)
      .attr('xmlns', 'http://www.w3.org/2000/svg');
    const g = svg.append('g');
    state.zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 4])
      .on('zoom', (e) => g.attr('transform', e.transform));
    svg.call(state.zoom).on('dblclick.zoom', null);
    svg.on('click', (e) => {
      if (e.target === svg.node()) select(null);
    });

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
      hintEl.textContent =
        state.layout === 'network'
          ? 'Scroll to zoom · drag nodes · click for details'
          : 'Click a branch node to collapse/expand';
    }

    if (state.layout === 'tree') {
      renderTree(svg, g, W, H);
      return;
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

    const link = g
      .append('g')
      .selectAll<SVGLineElement, GraphLink>('line')
      .data(links)
      .join('line')
      .attr('stroke', (l) =>
        l.kind === 'cooc'
          ? css('--n-cluster')
          : l.kind === 'heading'
            ? css('--link-strong')
            : css('--link')
      )
      .attr('stroke-width', (l) =>
        l.kind === 'cooc'
          ? Math.min(4, 0.6 + (l.w || 1) * 0.35)
          : l.kind === 'heading'
            ? 1.8
            : 1.1
      )
      .attr('stroke-dasharray', (l) =>
        l.kind === 'support' ? '3 3' : l.kind === 'cooc' ? '1 3' : null
      )
      .attr('stroke-opacity', (l) => (l.kind === 'cooc' ? 0.55 : 1));

    const node = g
      .append('g')
      .selectAll<SVGGElement, GraphNode>('g')
      .data(nodes)
      .join('g')
      .attr(
        'class',
        (n) =>
          `node ${n.type === 'root' ? 'root' : n.type !== 'kw' ? 'hub' : ''}`
      )
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on('start', (e, d) => {
            if (!e.active && sim) sim.alphaTarget(0.25).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (e, d) => {
            d.fx = e.x;
            d.fy = e.y;
          })
          .on('end', (e, d) => {
            if (!e.active && sim) sim.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    node
      .append('circle')
      .attr('r', (n) => n.r)
      .attr('fill', (n) => nodeColor(n));
    node
      .append('text')
      .attr('dy', (n) => n.r + 12)
      .attr('text-anchor', 'middle')
      .text((n) => trunc(n.label, n.type === 'section' ? 34 : 30))
      .attr('display', (n) =>
        !n.dup && (state.allLabels || labelSet.has(n.id)) ? null : 'none'
      );

    node
      .on('mouseenter', (e, n) => tip(e, n))
      .on('mousemove', (e) => moveTip(e))
      .on('mouseleave', () => hideTip())
      .on('click', (e, n) => {
        e.stopPropagation();
        select(n);
      });

    const rootNode = nodes[0];
    rootNode.x = W / 2;
    rootNode.y = H / 2;

    sim = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        'link',
        d3
          .forceLink<GraphNode, GraphLink>(links)
          .id((n) => n.id)
          .distance((l) => l.dist)
          .strength((l) => (l.kind === 'cooc' ? 0.04 : 0.7))
      )
      .force(
        'charge',
        d3
          .forceManyBody<GraphNode>()
          .strength((n) =>
            n.type === 'root' ? -900 : n.type === 'kw' ? -110 : -380
          )
      )
      .force(
        'collide',
        d3.forceCollide<GraphNode>((n) => n.r + 5)
      )
      .force('x', d3.forceX<GraphNode>(W / 2).strength(0.04))
      .force('y', d3.forceY<GraphNode>(H / 2).strength(0.04))
      .stop();

    const draw = () => {
      link
        .attr('x1', (l) => (l.source as GraphNode).x ?? 0)
        .attr('y1', (l) => (l.source as GraphNode).y ?? 0)
        .attr('x2', (l) => (l.target as GraphNode).x ?? 0)
        .attr('y2', (l) => (l.target as GraphNode).y ?? 0);
      node.attr('transform', (n) => `translate(${n.x ?? 0},${n.y ?? 0})`);
    };

    for (let i = 0; i < 320; i++) sim.tick();
    draw();
    fit(svg, g, 0);
    sim.on('tick', draw);

    state._graph = { node, link, links };
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
    const svg = d3.select<SVGSVGElement, unknown>('#page-structure-studio #graph svg');
    if (!svg.empty()) {
      fit(svg, svg.select<SVGGElement>('g'));
    }
  });

  $('#svgDl')?.addEventListener('click', () => {
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
      state._graph?.node.classed('faded', false);
      state._graph?.link.classed('faded', false);
      renderDetail(null);
      return;
    }
    highlight(n);
    selectRef({ type: n.type, ref: n.ref });
  }

  function highlight(n: GraphNode): void {
    if (!state._graph) return;
    const { node, link, links } = state._graph;
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
              `<div style="display:flex;justify-content:space-between;gap:8px;font-size:12.5px;padding:2px 0"><span>${esc(k.keyword)}</span><span class="mono muted">${k.relevance}</span></div>`
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
      el.innerHTML = `<h3>${esc(k.keyword)}</h3><span class="tier ${esc(k.tier)}">${esc(k.tier)}</span> <span class="muted small">Rank #${k.rank} · cluster: ${esc(k.cluster)}</span>
        <dl><dt>Relevance</dt><dd><b>${k.relevance}</b> / 100</dd><dt>Frequency</dt><dd>${k.frequency} (${k.body_count} in body copy)</dd>
        <dt>Density</dt><dd>${k.density}%</dd><dt>Sections</dt><dd>${k.section_count}</dd>
        <dt>First seen</dt><dd>${k.first_position == null ? 'headings only' : k.first_position + '% into the copy'}</dd></dl>
        <h4>Placements</h4>${placements(k)}
        ${k._inHeadings?.length ? `<h4>Targeted by headings</h4>${k._inHeadings.map((id) => `<span class="tag">${secName(id)}</span>`).join('')}` : ''}
        ${k._supports?.length ? `<h4>Supports sections</h4>${k._supports.map((id) => `<span class="tag">${secName(id)}</span>`).join('')}` : ''}
        ${co.length ? `<h4>Co-occurs with</h4>${co.map((c) => `<span class="tag">${esc(c.keyword)}</span>`).join('')}` : ''}`;
      return;
    }

    if (d.type === 'cluster') {
      const c: ClusterEntry = d.ref;
      el.innerHTML = `<h3>${esc(c.label)}</h3><div class="muted small">Topic cluster · ${c.keywords.length} keywords · avg relevance ${c.avg_relevance}</div>
        <h4>Keywords</h4>${c.keywords
          .map((id) => state.kwById[id])
          .filter(Boolean)
          .map(
            (k) =>
              `<div style="display:flex;justify-content:space-between;gap:8px;font-size:12.5px;padding:2px 0"><span>${esc(k.keyword)}</span><span class="mono muted">${k.relevance}</span></div>`
          )
          .join('')}`;
      return;
    }

    const s: SectionEntry = d.ref;
    el.innerHTML = `<h3>${esc(s.heading)}</h3><div class="muted small">${s.level === 0 ? 'Page' : esc(s.tag.toUpperCase())} · ${s.cumulative_word_count} words${s.alignment != null ? ` · ${esc(s.alignment_label)} support (${s.alignment}/100)` : ''}</div>
      <h4>Heading keywords</h4>${s.heading_keywords.length ? s.heading_keywords.map((h) => `<span class="tag on">${esc(h.keyword)} · ${h.copy_mentions}× in copy</span>`).join('') : `<span class="muted small">None</span>`}
      <h4>Supported by</h4>${
        s.supporting_keywords
          .map(
            (h) =>
              `<div style="display:flex;justify-content:space-between;gap:8px;font-size:12.5px;padding:2px 0"><span>${esc(h.keyword)}${h.related_to_heading ? ' ●' : ''}</span><span class="mono muted">${h.mentions}× · ${h.support}</span></div>`
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


