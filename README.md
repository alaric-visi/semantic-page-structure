# Semantic Page Structure

**Semantic Page Structure** is a standalone web application that scrapes a web page (or analyses pasted HTML), strips navigation, footers and boilerplate, rebuilds the heading hierarchy, scores every 1–4 word phrase (0–100) for on-page SEO relevance and maps topic clusters and section alignment in an interactive D3 knowledge graph.

## Features

- **Knowledge Graph View**: Interactive D3 v7 force-directed network and collapsible tree visualising either **Topic Clusters** (main topic → sub-topic clusters → keywords) or **Heading Hierarchy** (H1 → H2 → H3 sections, targeted heading keywords and supporting copy terms), with optional sentence co-occurrence links, node inspector and SVG export.
- **Data Table View**: Sortable and filterable 17-column keyword table with relevance (0–100), tier, cluster, frequency, density, placement flags (title, H1, URL, meta, H2, H3, bold, alt, anchor) and first-seen position, plus one-click CSV exports for keywords and sections.
- **Plain-Text Outline View**: ASCII tree of top keywords, topic clusters and the heading → keyword → supporting-terms hierarchy, ready to copy or download as `.txt`.
- **Written Report View**: Narrative diagnostic report with a main-topic placement checklist, top keywords, topic clusters, section-by-section alignment breakdown, on-page issues and Markdown/PDF export.
- **SSRF-Hardened Server Fetch**: Blocks loopback, RFC1918 private networks, link-local and cloud metadata IPs (`169.254.169.254`), CGNAT and IPv6 local/mapped ranges across redirects, with an 8-second timeout and 5 MB response cap.

## Quick Start (Local Development)

```bash
npm install
npm run dev
```

The Vite development server starts with the built-in `/api/page-structure/analyze` middleware enabled.

## Running Tests

```bash
npm test
```

## Deploying on a Subdomain

### Option 1: Netlify (Recommended)

This repository includes a preconfigured [`netlify.toml`](./netlify.toml) and Netlify Function ([`netlify/functions/analyze.mts`](./netlify/functions/analyze.mts)):

1. Connect the `semantic-page-structure` GitHub repository to a new Netlify site.
2. Netlify will automatically run `npm run build`, publish `dist/` and bundle the serverless endpoint at `/api/page-structure/analyze` (and `/api/analyze`).
3. In Netlify **Domain management**, assign your custom subdomain (e.g. `structure.mikehiggins.me.uk` or `page-structure.mikehiggins.me.uk`).

### Option 2: Standalone Node Server (Railway / Fly.io / Render / VPS)

```bash
npm install
npm run build
PORT=8765 npm start
```

## API Endpoint

### `POST /api/page-structure/analyze` (also `POST /api/analyze`)

**Request Body:**

```json
{
  "url": "https://en.wikipedia.org/wiki/Search_engine_optimization",
  "html": ""
}
```

- `url`: Public `http(s)` URL to fetch and analyse (if `html` is also provided, `html` is parsed directly and `url` is used for slug scoring and link classification).
- `html`: Optional raw HTML string (up to 2 MB) for pages that block scrapers or render with client-side JavaScript.
