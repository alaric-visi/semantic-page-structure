# Semantic Page Structure Studio

An open-source, client-first technical SEO intelligence platform that reverse-engineers on-page topical authority, heading hierarchy and semantic keyword distribution.

Built for technical SEOs, content architects and search engineers, this application parses raw HTML or live URLs, strips away document boilerplate, constructs a hierarchical section tree, scores candidate phrases across multiple on-page zones, clusters related entities, detects heading-to-copy alignment gaps and correlates on-page signals with real search query impressions from the Microsoft Bing API.

---

## Table of Contents

- [Why Semantic Page Structure?](#why-semantic-page-structure)
- [System Architecture](#system-architecture)
  - [1. DOM Sanitisation and Boilerplate Stripping](#1-dom-sanitisation-and-boilerplate-stripping)
  - [2. Heading Hierarchy and Section Tree Reconstruction](#2-heading-hierarchy-and-section-tree-reconstruction)
  - [3. Multi-Zone Relevance Scoring Algorithm](#3-multi-zone-relevance-scoring-algorithm)
  - [4. Topical Entity Clustering](#4-topical-entity-clustering)
  - [5. Heading-to-Copy Support Alignment](#5-heading-to-copy-support-alignment)
  - [6. Sentence-Level Co-occurrence Matrix](#6-sentence-level-co-occurrence-matrix)
  - [7. Real-Time Microsoft Bing Webmaster Intelligence](#7-real-time-microsoft-bing-webmaster-intelligence)
- [Core Capabilities](#core-capabilities)
- [Visualisation Studio](#visualisation-studio)
- [API Reference and Code Examples](#api-reference-and-code-examples)
  - [Analyse Endpoint (`/api/page-structure/analyze`)](#analyse-endpoint-apipage-structureanalyze)
  - [Search Volume Endpoint (`/api/keywords/volume`)](#search-volume-endpoint-apikeywordsvolume)
  - [Programmatic TypeScript Integration](#programmatic-typescript-integration)
- [Security and SSRF Defence](#security-and-ssrf-defence)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Local Installation](#local-installation)
  - [Running the Test Suite](#running-the-test-suite)
- [Production Deployment](#production-deployment)
  - [Deploying to Netlify](#deploying-to-netlify)
  - [Deploying to a VPS or Node Server](#deploying-to-a-vps-or-node-server)
- [Technical SEO Use Cases](#technical-seo-use-cases)
- [Licence](#licence)

---

## Why Semantic Page Structure?

Modern search engines do not evaluate documents as flat bags of words. With developments such as passage ranking, neural matching and information gain scoring, search engines evaluate:

1. **Topical Focus**: What core entity or concept does the document satisfy?
2. **Structural Depth**: How logically is the content segmented under H1, H2, H3 and H4 tags?
3. **Heading Support**: Does the body copy beneath a heading actually answer the promise made in that heading or does it leave an unfulfilled topical vacuum?
4. **Co-occurrence Context**: Do related entities, lexical variants and supporting concepts appear within the same sentence structures?
5. **Real-World Demand**: How do on-page topical priorities align with actual search volume and user search impressions?

Traditional SEO tools typically check keyword density across the whole page or extract raw heading tags without analysing whether the copy beneath those headings supports the stated topic. **Semantic Page Structure Studio** bridges this gap by transforming raw DOM nodes into an inspectable, mathematically scored semantic graph.

---

## System Architecture

The application runs an end-to-end processing pipeline built entirely in TypeScript:

```
[Target URL / Raw HTML]
        │
        ▼
[SSRF Validation & Safe Fetch]
        │
        ▼
[DOM Parsing & Boilerplate Removal (parse5)]
        │
        ▼
[Heading Tree & Section Segmentation]
        │
        ▼
[N-Gram Extraction (1–4 words) & Multi-Zone Scoring]
        │
        ▼
[Topical Entity Clustering & Co-occurrence Matrix]
        │
        ▼
[Heading-to-Copy Alignment Calculation]
        │
        ▼
[Client-Side Bing Webmaster Tools API Correlation]
        │
        ▼
[Interactive 3D Graph / Data Table / Diagnostic Report]
```

### 1. DOM Sanitisation and Boilerplate Stripping

The analysis begins by isolating genuine editorial body content from layout chrome. Using `parse5`, the parser strips elements that contaminate topical signals:

- Structural noise: `<nav>`, `<header>`, `<footer>`, `<aside>`, `<form>`, `<noscript>`, `<svg>`, `<canvas>`, `<dialog>` and `<menu>`
- Executable or presentation code: `<script>`, `<style>` and `<iframe>`
- Boilerplate markers: Elements matching regex patterns for breadcrumbs, cookie notices, author bios, social sharing strips, related article carousels, comments and copyright footers
- Hidden nodes: Elements carrying `hidden`, `aria-hidden="true"` or `display:none`

The remaining DOM nodes are converted into a clean document model preserving semantic inline placements: bold text (`<strong>`, `<b>`), anchor links (`<a>` with href attributes) and image alternative text (`<img>` alt attributes).

### 2. Heading Hierarchy and Section Tree Reconstruction

The engine parses all heading tags (`<h1>` through `<h6>`) in strict document order. It establishes a virtual root section (`level: 0`) representing the document as a whole, then constructs a nested tree:

- An H1 establishes the primary document section.
- Subsequent H2 tags become immediate children of the preceding H1.
- H3 tags become children of the active H2, cascading down to H6.
- Any body copy before the first heading is assigned to the virtual root section.
- For each section, the engine tracks cumulative word counts, section depth, child section identifiers and direct parent references.

### 3. Multi-Zone Relevance Scoring Algorithm

Every candidate n-gram between 1 and 4 words is extracted from the cleaned copy. The candidate pool is filtered against an English stopword list and lemmatised for surface variations. Each term is then evaluated across a multi-zone weighting matrix:

| On-Page Zone | Base Weight | Rationale |
| :--- | :---: | :--- |
| **Document Title (`<title>`)** | `10.0` | Primary canonical signal of page intent |
| **Main Heading (`<h1>`)** | `8.0` | Primary visual and structural editorial topic |
| **URL Slug** | `6.0` | Clean URI keyword signal |
| **Subheadings (`<h2>`)** | `5.0` | Major thematic division of document |
| **Meta Description** | `5.0` | Summarised intent statement |
| **Secondary Subheadings (`<h3>`)** | `3.0` | Sub-topic demarcation |
| **Minor Subheadings (`<h4>` to `<h6>`)** | `2.0` | Granular structural sections |
| **Emphasis Text (`<strong>`, `<b>`)** | `1.5` | Editorial visual prominence |
| **Image Alt Attributes (`<img>`)** | `1.5` | Visual asset topical relevance |
| **Anchor Text (`<a>`)** | `1.0` | Internal and external cross-reference relevance |

Beyond raw zone hits, the engine applies contextual adjustments:

- **Diminishing Body Returns**: Body copy mentions use a square-root dampening function: $\text{score} = \sqrt{\text{count}} \times 1.2$, preventing keyword stuffing from artificially inflating relevance.
- **Early Placement Bonus**: Phrases appearing within the opening 10% of body copy receive an early-position bonus.
- **Section Distribution Bonus**: Terms distributed evenly across multiple unique sections receive a spread multiplier.
- **Exact Match Bonus**: Terms matching the exact title or H1 receive an intent bonus.
- **Specificity Multiplier**: Longer multi-word phrases receive a multiplier ($\text{length} \times 1.15$) to reward specificity.
- **Subphrase Discount**: Single-word fragments that only appear inside longer compound phrases are discounted.

Raw scores are normalised against the highest-scoring candidate:

$$\text{Relevance} = \min\left(100, \text{round}\left(100 \times \sqrt{\frac{\text{score}}{\text{max\_score}}}\right)\right)$$

Terms are categorised into four operational tiers:
- **Primary Tier**: Relevance $\ge 65$
- **Secondary Tier**: Relevance $\ge 45$
- **Supporting Tier**: Relevance $\ge 25$
- **Long-tail Tier**: Relevance $< 25$

### 4. Topical Entity Clustering

Keywords are clustered using an agglomerative word-overlap algorithm. The primary document topic forms the foundational root. Remaining keywords are grouped by shared lexical roots, multi-word stem matches and semantic adjacency. Each cluster computes:
- Aggregate keyword count
- Average cluster relevance
- Cluster strength score based on cumulative keyword distribution across sections

### 5. Heading-to-Copy Support Alignment

A common cause of organic ranking failure is heading misalignment: an H2 or H3 promises a topic, but the subsequent paragraphs fail to substantiate that topic with relevant terms. The engine computes an alignment support score (0 to 100) for every section:

$$\text{Support Score} = (0.50 \times \text{Heading Keyword Recurrence}) + (0.30 \times \text{Supporting Term Density}) + (0.20 \times \text{Section Depth Factor})$$

Sections are labelled into clear technical bands:
- **Strong Support ($\ge 70$)**: Body copy thoroughly reinforces and substantiates the heading keywords.
- **Moderate Support ($40$ to $69$)**: The copy partially covers the topic but lacks supporting depth.
- **Weak Support ($< 40$)**: The heading is unfulfilled or thin, representing a high-priority content optimisation opportunity.

### 6. Sentence-Level Co-occurrence Matrix

To reveal latent semantic connections, the text parser scans sentences for pairwise term co-occurrences. When two distinct keywords appear within the same sentence boundary, their edge weight increments. This generates a co-occurrence matrix that exposes which sub-topics are contextually bound together in the editorial prose.

### 7. Real-Time Microsoft Bing Webmaster Intelligence

On-page frequency alone does not indicate search demand. The application correlates on-page relevance with real-world query impressions via Microsoft Bing:

- **Client-Side Key Isolation**: In compliance with zero-trust storage principles, user API keys are stored exclusively in the browser (`localStorage`) and never written to backend server logs, databases or repository secrets.
- **Bing Webmaster Tools API Integration**: Directly connects to `https://ssl.bing.com/webmaster/api.svc/json/GetKeywordStats` to retrieve organic search query impressions on the Bing network.
- **Azure Bing Search v7 Fallback**: Automatically supports Azure Cognitive Services (`api.bing.microsoft.com/v7.0/search`) for total estimated matching web pages.
- **Transparent Citations**: Every returned search figure is explicitly cited across tables, inspectors, summary cards, reports and CSV exports as `Source: Microsoft Bing API`.

---

## Core Capabilities

- **Zero-Storage Client Security**: Personal API credentials remain entirely in the local browser.
- **Live URL or Raw HTML Input**: Analyse public URLs directly or paste raw HTML for staging environments, single-page apps (SPAs) and paywalled pages.
- **Automated Diagnostic Audit**: Automatically detects unfulfilled headings, missing H1 tags, skipped heading levels, keyword stuffing and excessive heading density.
- **Multi-Format Export**: One-click exports for full Markdown content briefs, formatted PDF printable reports, keyword CSV telemetry and section hierarchy CSVs.
- **Responsive Split Studio**: Resizable panels with side-by-side inspection, full-screen canvas modes and collapsible navigation.

---

## Visualisation Studio

The platform includes four synchronised analytical views:

```
┌────────────────────────────────────────────────────────────────────────┐
│ TOP STUDIO HEADER: Title · Quick Metrics · View Switcher · API Keys    │
├──────────────────────────┬─────────────────────────────────────────────┤
│ INPUT & PAGE OVERVIEW    │ STRUCTURE & TOPICAL OUTPUT                  │
│                          │                                             │
│ - Target URL / HTML Box  │ [Knowledge Graph] [Data] [Text] [Report]    │
│ - Page Metadata Cards    ├─────────────────────────────────────────────┤
│ - Summary Gauges         │                                             │
│   • Heading Support (%)  │  • 3D Interactive Force Network (Canvas)    │
│   • Core Topic Focus (%) │  • Hierarchical Collapsible Tree View       │
│ - Cluster Distribution   │  • 18-Column Interactive Data Table         │
│ - Word Count Breakdown   │  • Plain-Text Hierarchical Outline          │
│                          │  • Executive Technical SEO Diagnostic Doc   │
└──────────────────────────┴─────────────────────────────────────────────┘
```

### Knowledge Graph
Rendered with an optimised D3.js force simulation, the graph provides both **Topic Clusters** and **Heading Hierarchy** modes:
- **3D Canvas Projection**: Orthographic 3D camera projection with depth sorting, dynamic node radius scaling and smooth depth perspective.
- **Interactive Orbit and Pan**: Left-click drag rotates the 3D graph, middle/right-click pans the coordinate space and mouse-wheel zooms anchored to cursor position.
- **Intelligent Front-Facing Animation**: Clicking any node positioned in the background triggers a smooth spherical animation bringing that node directly to the foreground for inspection.
- **Inspection HUD**: Real-time detail pane displaying relevance scores, Bing search impressions, placement checks, section relationships and co-occurring terms.

---

## API Reference and Code Examples

### Analyse Endpoint (`/api/page-structure/analyze`)

Scrapes a page or parses supplied HTML, executes the full semantic pipeline and returns structured JSON telemetry.

#### HTTP Request

```bash
curl -X POST "https://your-domain.com/api/page-structure/analyze" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/running-shoes-guide",
    "html": ""
  }'
```

#### JSON Response Structure

```json
{
  "url": "https://example.com/running-shoes-guide",
  "analyzed_at": "2026-11-14T00:50:00.000Z",
  "meta": {
    "title": "Best Trail Running Shoes: 2026 Review & Buying Guide",
    "meta_description": "Comprehensive review of the top trail running shoes tested on technical terrain.",
    "h1": "Best Trail Running Shoes for Technical Terrain",
    "word_count": 2840,
    "heading_counts": { "h1": 1, "h2": 6, "h3": 14, "h4": 0, "h5": 0, "h6": 0 }
  },
  "main_topic": {
    "id": "trail running shoes",
    "keyword": "trail running shoes"
  },
  "keywords": [
    {
      "id": "trail running shoes",
      "keyword": "trail running shoes",
      "relevance": 100,
      "tier": "Primary",
      "rank": 1,
      "words": 3,
      "frequency": 28,
      "body_count": 24,
      "density": 2.96,
      "in_title": true,
      "in_h1": true,
      "in_url": true,
      "in_meta": true,
      "h2_count": 3,
      "h3_count": 1,
      "section_count": 7,
      "first_position": 1.4,
      "raw_score": 148.5,
      "cluster": "Footwear"
    }
  ],
  "sections": [
    {
      "id": 1,
      "level": 2,
      "tag": "h2",
      "heading": "Cushioning and Outsole Grip Comparison",
      "cumulative_word_count": 480,
      "alignment": 82,
      "alignment_label": "strong",
      "heading_keywords": [
        { "id": "outsole grip", "keyword": "outsole grip", "copy_mentions": 6 }
      ],
      "supporting_keywords": [
        { "id": "traction", "keyword": "traction", "mentions": 5, "support": 85 }
      ],
      "notes": [],
      "children": [2, 3]
    }
  ],
  "clusters": [
    {
      "id": "c_footwear",
      "label": "Footwear",
      "keywords": ["trail running shoes", "running shoes", "outsole grip"],
      "avg_relevance": 74.2,
      "strength": 88
    }
  ],
  "issues": [
    {
      "severity": "warn",
      "message": "Heading 'Price and Availability' has low copy support (28/100)."
    }
  ]
}
```

---

### Search Volume Endpoint (`/api/keywords/volume`)

Stateless CORS proxy that receives client-provided API keys on demand, queries Bing services and returns verified volume figures without server persistence.

#### Fetching Bing Webmaster Impressions

```bash
curl -X POST "https://your-domain.com/api/keywords/volume" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "batch",
    "provider": "bing",
    "serviceType": "webmaster",
    "apiKey": "YOUR_32_CHAR_BING_WEBMASTER_KEY",
    "keywords": ["trail running shoes", "carbon plate racers"]
  }'
```

#### JSON Response

```json
{
  "ok": true,
  "serviceType": "webmaster",
  "citation": "Source: Microsoft Bing Webmaster Tools API (GetKeywordStats)",
  "results": {
    "trail running shoes": 48200,
    "carbon plate racers": 12400
  }
}
```

---

### Programmatic TypeScript Integration

You can import and execute the core analyser directly in your own Node.js or serverless scripts:

```typescript
import { PageStructureAnalyzer } from './src/lib/analyzer';
import type { AnalysisResult } from './src/lib/types';

const htmlContent = `
<!doctype html>
<html lang="en">
  <head>
    <title>Technical SEO Guide | Core Web Vitals Optimisation</title>
    <meta name="description" content="Master Core Web Vitals and page speed optimisation." />
  </head>
  <body>
    <h1>Mastering Core Web Vitals and Performance</h1>
    <p>Core Web Vitals represent essential user experience metrics for search ranking.</p>
    <h2>Largest Contentful Paint Optimisation</h2>
    <p>Largest Contentful Paint measures perceived loading speed of your hero element.</p>
    <h3>Optimising Server Response Time</h3>
    <p>Reduce time to first byte through edge caching and CDN routing.</p>
  </body>
</html>
`;

// Initialise analyser with target URL and raw HTML
const analyzer = new PageStructureAnalyzer('https://example.com/cwv-guide', htmlContent);
const result: AnalysisResult = analyzer.analyze();

console.log(`Main Topic: ${result.main_topic?.keyword}`);
console.log(`Total Keywords Identified: ${result.keywords.length}`);
console.log(`Top Primary Keyword: ${result.keywords[0].keyword} (Relevance: ${result.keywords[0].relevance})`);

// Inspect section alignment
result.sections.forEach((section) => {
  if (section.level > 0) {
    console.log(`[${section.tag.toUpperCase()}] ${section.heading} -> Support: ${section.alignment}/100 (${section.alignment_label})`);
  }
});
```

---

## Security and SSRF Defence

Allowing a server to fetch arbitrary URLs supplied by users introduces severe Server-Side Request Forgery (SSRF) vulnerabilities. The fetch engine ([`src/lib/safe-fetch.ts`](file:///Users/mikehiggins/work/semantic-page-structure/src/lib/safe-fetch.ts)) enforces multi-layered validation:

1. **Protocol Restriction**: Only `http:` and `https:` schemes are permitted.
2. **Pre-Flight DNS Resolution**: Resolves hostnames to IP addresses before initiating network calls.
3. **Blacklisted IP Ranges**: Rejects any address resolving to:
   - Loopback: `127.0.0.0/8`, `::1`
   - RFC1918 Private subnets: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
   - Link-local and cloud metadata endpoints: `169.254.0.0/16`, `fe80::/10` (protecting AWS, GCP and Azure metadata services)
   - Carrier-Grade NAT (CGNAT): `100.64.0.0/10`
   - IPv6 local, site-local and IPv4-mapped vectors: `fc00::/7`, `::ffff:0:0/96`
4. **Redirect Validation**: Validates every hop in a redirect chain against the same security constraints.
5. **Payload Caps and Timeouts**: Enforces an 8-second request timeout and caps body transfers at 5 MB to prevent resource exhaustion attacks.

---

## Getting Started

### Prerequisites

- Node.js 18.0.0 or higher
- npm 9.0.0 or higher

### Local Installation

Clone the repository and install project dependencies:

```bash
git clone https://github.com/alaric-visi/semantic-page-structure.git
cd semantic-page-structure
npm install
```

Start the Vite development server:

```bash
npm run dev
```

Visit `http://localhost:5173` in your browser. The Vite development server automatically proxies requests to the local API middleware.

### Running the Test Suite

The test suite validates HTML parsing, multi-zone scoring, SSRF protection and client key management:

```bash
npm test
```

To run continuous test monitoring during development:

```bash
npx vitest
```

---

## Production Deployment

### Deploying to Netlify

This project is configured out of the box for Netlify deployment using [`netlify.toml`](file:///Users/mikehiggins/work/semantic-page-structure/netlify.toml) and Netlify Edge/Functions:

1. Push your repository to GitHub.
2. Create a new site in Netlify and link your repository.
3. Netlify automatically detects the build command (`npm run build`) and publishes `dist/`.
4. Backend API requests routes to [`netlify/functions/analyze.mts`](file:///Users/mikehiggins/work/semantic-page-structure/netlify/functions/analyze.mts).
5. In Netlify Domain Management, assign your preferred custom domain or subdomain (e.g. `seo-studio.yourdomain.com`).

### Deploying to a VPS or Node Server

To run on a standalone Linux VPS, Railway, Render or containerised Docker environment:

```bash
npm install
npm run build
PORT=8080 npm start
```

The server binary ([`server.mjs`](file:///Users/mikehiggins/work/semantic-page-structure/server.mjs)) starts an HTTP daemon serving static assets from `dist/` with built-in API handlers.

---

## Technical SEO Use Cases

- **Content Pruning and Cannibalisation Audits**: Compare competing URLs on your site to determine whether their primary and secondary keyword entities overlap dangerously.
- **Heading Alignment and Thin Content Audits**: Identify pages that use broad, clickbait H2 tags but provide inadequate supporting copy underneath.
- **Content Brief Engineering**: Use the plain-text outline and Markdown report generator to produce comprehensive author briefs specifying required heading keywords and supporting terms.
- **Competitor Reverse-Engineering**: Deconstruct top-ranking competitor pages to uncover their semantic structure, section division and co-occurring entity clusters.
- **Information Gain Verification**: Ensure updated articles introduce genuine secondary and supporting sub-topics rather than superficial wording changes.

---

## Licence

Distributed under the MIT Licence. See `LICENSE` for further details.
