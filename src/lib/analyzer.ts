import { parse, type DefaultTreeAdapterMap } from 'parse5';
import type {
  AlignmentLabel,
  AnalysisResult,
  ClusterEntry,
  CooccurrenceEdge,
  HeadingKeywordRef,
  IssueSeverity,
  KeywordEntry,
  KeywordTier,
  PageIssue,
  PageMeta,
  SectionEntry,
  SupportingKeywordRef,
} from './types';
import {
  BLOCKISH,
  BOILERPLATE_RE,
  CHUNK_SPLIT,
  CONNECTORS,
  HEADINGS,
  HYPHEN_JOIN,
  LENGTH_FACTOR,
  NO_STEM,
  SENTENCE_SPLIT,
  SKIP_TAGS,
  STOPWORDS,
  TEXT_BLOCKS,
  TOKEN_RE,
  UNIGRAM_BLOCK,
  UTILITY_HEADING_RE,
  ZONE_WEIGHTS,
} from './vocab';

type PNode = DefaultTreeAdapterMap['node'];
type PElement = DefaultTreeAdapterMap['element'];
type PParent = DefaultTreeAdapterMap['parentNode'];
type PText = DefaultTreeAdapterMap['textNode'];

function isElement(n: PNode): n is PElement {
  return 'tagName' in n && typeof (n as PElement).tagName === 'string';
}

function isText(n: PNode): n is PText {
  return n.nodeName === '#text';
}

function isComment(n: PNode): boolean {
  return n.nodeName === '#comment';
}

function isParent(n: PNode): n is PParent {
  return 'childNodes' in n && Array.isArray((n as PParent).childNodes);
}

function getAttr(el: PElement, name: string): string | undefined {
  const lower = name.toLowerCase();
  const found = el.attrs?.find((a) => a.name.toLowerCase() === lower);
  return found ? found.value : undefined;
}

function hasAttr(el: PElement, name: string): boolean {
  const lower = name.toLowerCase();
  return Boolean(el.attrs?.some((a) => a.name.toLowerCase() === lower));
}

const NON_VISIBLE_STRING_PARENTS = new Set(['script', 'style', 'template']);

function collectStrings(node: PNode, strip: boolean, out: string[]): void {
  if (isComment(node)) return;
  if (isText(node)) {
    const val = strip ? node.value.trim() : node.value;
    if (strip ? val.length > 0 : true) {
      out.push(val);
    }
    return;
  }
  if (isElement(node) && NON_VISIBLE_STRING_PARENTS.has(node.tagName)) {
    return;
  }
  if (isParent(node)) {
    for (const child of node.childNodes) {
      collectStrings(child, strip, out);
    }
  }
}

function getText(node: PNode, sep = '', strip = false): string {
  const parts: string[] = [];
  collectStrings(node, strip, parts);
  return parts.join(sep);
}

function findAllElements(
  root: PNode,
  predicate?: (el: PElement) => boolean,
  includeRoot = false
): PElement[] {
  const out: PElement[] = [];
  function visit(n: PNode, isTop: boolean) {
    if (isElement(n)) {
      if (!isTop || includeRoot) {
        if (!predicate || predicate(n)) {
          out.push(n);
        }
      }
    }
    if (isParent(n)) {
      for (const c of n.childNodes) {
        visit(c, false);
      }
    }
  }
  visit(root, true);
  return out;
}

function findElement(
  root: PNode,
  predicate: (el: PElement) => boolean
): PElement | null {
  function visit(n: PNode, isTop: boolean): PElement | null {
    if (isElement(n) && !isTop && predicate(n)) {
      return n;
    }
    if (isParent(n)) {
      for (const c of n.childNodes) {
        const hit = visit(c, false);
        if (hit) return hit;
      }
    }
    return null;
  }
  return visit(root, true);
}

function decomposeNode(node: PNode, decomposed: WeakSet<PNode>): void {
  const parent = (node as PElement).parentNode;
  if (parent && Array.isArray(parent.childNodes)) {
    const idx = parent.childNodes.indexOf(node as never);
    if (idx !== -1) {
      parent.childNodes.splice(idx, 1);
    }
  }
  function mark(n: PNode) {
    decomposed.add(n);
    if (isParent(n)) {
      for (const c of n.childNodes) {
        mark(c);
      }
      n.childNodes = [];
    }
  }
  mark(node);
}

/**
 * Python-compatible round (round half to even) to avoid 0.05 boundary drift.
 */
function pyRound(value: number, ndigits = 0): number {
  const factor = Math.pow(10, ndigits);
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  const eps = 1e-9;
  let rounded: number;
  if (Math.abs(diff - 0.5) < eps) {
    rounded = floor % 2 === 0 ? floor : floor + 1;
  } else {
    rounded = Math.round(scaled);
  }
  return ndigits === 0 ? rounded : Number((rounded / factor).toFixed(ndigits));
}

const ALPHA_ONLY_RE = /^[a-z]+$/i;
const DIGITS_ONLY_RE = /^\d+$/;

export function stem(rawTok: string): string {
  let tok = rawTok;
  if (tok.endsWith("'s")) {
    tok = tok.slice(0, -2);
  }
  if (NO_STEM.has(tok) || !ALPHA_ONLY_RE.test(tok)) {
    return tok;
  }
  if (tok.length > 4 && tok.endsWith('ies')) {
    return tok.slice(0, -3) + 'y';
  }
  if (
    tok.length > 4 &&
    (tok.endsWith('sses') ||
      tok.endsWith('ches') ||
      tok.endsWith('shes') ||
      tok.endsWith('xes'))
  ) {
    return tok.slice(0, -2);
  }
  if (
    tok.length > 3 &&
    tok.endsWith('s') &&
    !tok.endsWith('ss') &&
    !tok.endsWith('us') &&
    !tok.endsWith('is') &&
    !tok.endsWith('ous')
  ) {
    return tok.slice(0, -1);
  }
  return tok;
}

export function tokenize(text: string): string[] {
  const normed = text
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/‘/g, "'")
    .replace(HYPHEN_JOIN, ' ');
  return normed.match(TOKEN_RE) ?? [];
}

export function cleanWs(s: string | undefined | null): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

export interface CandidateGram {
  key: string;
  surface: string;
  n: number;
}

export function* candidates(tokens: string[]): Generator<CandidateGram> {
  const L = tokens.length;
  for (let i = 0; i < L; i++) {
    const first = tokens[i];
    if (STOPWORDS.has(first) || CONNECTORS.has(first)) {
      continue;
    }
    for (let n = 1; n <= 4; n++) {
      if (i + n > L) break;
      const gram = tokens.slice(i, i + n);
      const last = gram[gram.length - 1];
      if (STOPWORDS.has(last) || CONNECTORS.has(last)) {
        continue;
      }
      const inner = gram.slice(1, -1);
      const innerStops = inner.filter(
        (t) => STOPWORDS.has(t) || CONNECTORS.has(t)
      );
      if (innerStops.length > 0) {
        if (
          innerStops.length > 1 ||
          innerStops.some((t) => !CONNECTORS.has(t))
        ) {
          continue;
        }
      }
      if (
        n === 1 &&
        gram.some((t) => DIGITS_ONLY_RE.test(t) && t.length !== 4)
      ) {
        continue;
      }
      if (DIGITS_ONLY_RE.test(first) && first.startsWith('0')) {
        continue;
      }
      if (n === 1) {
        if (
          UNIGRAM_BLOCK.has(first) ||
          first.length < 2 ||
          DIGITS_ONLY_RE.test(first)
        ) {
          continue;
        }
      } else {
        const content = gram.filter((t) => !CONNECTORS.has(t));
        if (
          content.every((t) => UNIGRAM_BLOCK.has(t) || DIGITS_ONLY_RE.test(t))
        ) {
          continue;
        }
      }
      const key = gram.map((t) => stem(t)).join(' ');
      yield { key, surface: gram.join(' '), n };
    }
  }
}

export function pickContentRoot(doc: PNode): PNode {
  const body = findElement(doc, (el) => el.tagName === 'body') ?? doc;
  const main =
    findElement(body, (el) => el.tagName === 'main') ??
    findElement(body, (el) => getAttr(el, 'role') === 'main');
  if (main && getText(main, ' ', true).length > 200) {
    return main;
  }
  const articles = findAllElements(body, (el) => el.tagName === 'article');
  if (articles.length > 0) {
    let biggest = articles[0];
    let biggestLen = getText(biggest, ' ', true).length;
    for (let i = 1; i < articles.length; i++) {
      const len = getText(articles[i], ' ', true).length;
      if (len > biggestLen) {
        biggest = articles[i];
        biggestLen = len;
      }
    }
    if (biggestLen > 400) {
      return biggest;
    }
  }
  return body;
}

const ROLE_DROP_SET = new Set([
  'navigation',
  'banner',
  'contentinfo',
  'dialog',
  'complementary',
]);

export function stripChrome(root: PNode): void {
  const decomposed = new WeakSet<PNode>();

  for (const t of findAllElements(root, (el) => SKIP_TAGS.has(el.tagName))) {
    decomposeNode(t, decomposed);
  }

  // Remove comments
  function removeComments(n: PNode) {
    if (!isParent(n)) return;
    for (let i = n.childNodes.length - 1; i >= 0; i--) {
      const c = n.childNodes[i];
      if (isComment(c)) {
        n.childNodes.splice(i, 1);
      } else {
        removeComments(c);
      }
    }
  }
  removeComments(root);

  for (const t of findAllElements(
    root,
    (el) =>
      el.tagName === 'nav' || el.tagName === 'aside' || el.tagName === 'footer'
  )) {
    decomposeNode(t, decomposed);
  }

  for (const t of findAllElements(root, (el) => {
    const role = getAttr(el, 'role');
    return Boolean(role && ROLE_DROP_SET.has(role));
  })) {
    if (!findElement(t, (el) => el.tagName === 'h1')) {
      decomposeNode(t, decomposed);
    }
  }

  for (const t of findAllElements(root, (el) => el.tagName === 'header')) {
    if (!findElement(t, (el) => el.tagName === 'h1')) {
      decomposeNode(t, decomposed);
    }
  }

  for (const t of findAllElements(root)) {
    if (decomposed.has(t)) continue;
    if (!t.attrs || t.attrs.length === 0) continue;
    const idVal = getAttr(t, 'id') || '';
    const classAttr = getAttr(t, 'class') || '';
    const classList = classAttr ? classAttr.trim().split(/\s+/).filter(Boolean) : [];
    const ident = [idVal, ...classList].join(' ');
    if (
      ident &&
      BOILERPLATE_RE.test(ident) &&
      !findElement(t, (el) => el.tagName === 'h1') &&
      t.tagName !== 'body' &&
      t.tagName !== 'main' &&
      t.tagName !== 'article'
    ) {
      decomposeNode(t, decomposed);
    }
  }
}

interface KwStat {
  key: string;
  n: number;
  surfaces: Map<string, number>;
  zones: Map<string, number>;
  section_counts: Map<number, number>;
  heading_sections: Set<number>;
  first_pos: number | null;
}

interface InternalSection {
  id: number;
  level: number;
  tag: string;
  heading: string;
  parent: number | null;
  children: number[];
  words: number;
  blocks: string[];
  utility: boolean;
  stems: Map<string, number>;
}

function incMap<K>(map: Map<K, number>, key: K, delta = 1): void {
  map.set(key, (map.get(key) ?? 0) + delta);
}

function mostCommonOne(map: Map<string, number>): string {
  let bestKey = '';
  let bestCount = -1;
  for (const [k, v] of map.entries()) {
    if (v > bestCount) {
      bestCount = v;
      bestKey = k;
    }
  }
  return bestKey;
}

export class Analyzer {
  private url: string;
  private doc: PNode;
  private kw = new Map<string, KwStat>();
  private sections: InternalSection[] = [];
  private sentences: Array<[number | null, Set<string>]> = [];
  private body_tokens = 0;
  private meta!: PageMeta;
  private _stack: InternalSection[] = [];

  constructor(html: string, url = '') {
    this.url = url;
    this.doc = parse(html);
  }

  private _stat(key: string, n: number): KwStat {
    let s = this.kw.get(key);
    if (!s) {
      s = {
        key,
        n,
        surfaces: new Map(),
        zones: new Map(),
        section_counts: new Map(),
        heading_sections: new Set(),
        first_pos: null,
      };
      this.kw.set(key, s);
    }
    return s;
  }

  private _ingest(
    rawText: string,
    zone: string,
    sectionId: number | null = null,
    trackSentences = false
  ): number {
    const text = cleanWs(rawText);
    if (!text) return 0;
    let total = 0;
    const sentences = trackSentences ? text.split(SENTENCE_SPLIT) : [text];
    for (const sent of sentences) {
      const sentKeys = new Set<string>();
      for (const chunk of sent.split(CHUNK_SPLIT)) {
        const toks = tokenize(chunk);
        if (toks.length === 0) continue;
        for (const { key, surface, n } of candidates(toks)) {
          const s = this._stat(key, n);
          incMap(s.surfaces, surface, 1);
          incMap(s.zones, zone, 1);
          if (zone === 'body' && sectionId !== null) {
            incMap(s.section_counts, sectionId, 1);
            if (s.first_pos === null) {
              s.first_pos = this.body_tokens + total;
            }
          }
          if (zone.startsWith('h') && sectionId !== null) {
            s.heading_sections.add(sectionId);
          }
          sentKeys.add(key);
        }
        total += toks.length;
      }
      if (trackSentences && sentKeys.size > 0) {
        this.sentences.push([sectionId, sentKeys]);
      }
    }
    return total;
  }

  private _newSection(
    level: number,
    heading: string,
    tag: string
  ): InternalSection {
    while (
      this._stack.length > 0 &&
      this._stack[this._stack.length - 1].level >= level
    ) {
      this._stack.pop();
    }
    const parent =
      this._stack.length > 0 ? this._stack[this._stack.length - 1].id : null;
    const utility = Boolean(
      level > 0 &&
        (UTILITY_HEADING_RE.test(heading) ||
          (parent !== null && this.sections[parent].utility))
    );
    const sec: InternalSection = {
      id: this.sections.length,
      level,
      tag,
      heading,
      parent,
      children: [],
      words: 0,
      blocks: [],
      utility,
      stems: new Map(),
    };
    this.sections.push(sec);
    if (parent !== null) {
      this.sections[parent].children.push(sec.id);
    }
    this._stack.push(sec);
    return sec;
  }

  private _addBody(rawText: string, el: PElement | null = null): void {
    const text = cleanWs(rawText);
    if (!text) return;
    const sec = this._stack[this._stack.length - 1];
    if (sec.utility) return;
    const n = this._ingest(text, 'body', sec.id, true);
    this.body_tokens += n;
    sec.words += n;
    sec.blocks.push(text);
    for (const t of tokenize(text)) {
      incMap(sec.stems, stem(t), 1);
    }
    if (el !== null) {
      for (const em of findAllElements(
        el,
        (e) =>
          e.tagName === 'strong' ||
          e.tagName === 'b' ||
          e.tagName === 'em' ||
          e.tagName === 'mark'
      )) {
        this._ingest(getText(em, ' ', true), 'em', sec.id);
      }
      for (const a of findAllElements(el, (e) => e.tagName === 'a')) {
        this._ingest(getText(a, ' ', true), 'anchor', sec.id);
      }
      for (const img of findAllElements(el, (e) => e.tagName === 'img')) {
        this._ingest(getAttr(img, 'alt') ?? '', 'alt', sec.id);
      }
    }
  }

  private _walk(node: PNode): void {
    if (!isParent(node)) return;
    const children = [...node.childNodes];
    for (const child of children) {
      if (isText(child)) {
        const txt = cleanWs(child.value);
        if (txt && txt.split(/\s+/).length >= 3) {
          this._addBody(txt);
        }
        continue;
      }
      if (!isElement(child)) continue;
      const name = child.tagName;
      if (SKIP_TAGS.has(name)) continue;
      if ((HEADINGS as readonly string[]).includes(name)) {
        const heading = cleanWs(getText(child, ' ', true));
        if (!heading) continue;
        const level = parseInt(name[1], 10);
        const sec = this._newSection(level, heading, name);
        const zone = level <= 3 ? name : 'h4';
        if (!sec.utility) {
          this._ingest(heading, zone, sec.id);
        }
        continue;
      }
      if (name === 'img') {
        if (this._stack[this._stack.length - 1].utility) continue;
        this._ingest(
          getAttr(child, 'alt') ?? '',
          'alt',
          this._stack[this._stack.length - 1].id
        );
        continue;
      }
      if (
        TEXT_BLOCKS.has(name) &&
        !findElement(child, (e) => BLOCKISH.has(e.tagName))
      ) {
        this._addBody(getText(child, ' ', true), child);
        continue;
      }
      this._walk(child);
    }
  }

  public run(): AnalysisResult {
    const doc = this.doc;
    const titleEl = findElement(doc, (el) => el.tagName === 'title');
    const headTitle = titleEl ? cleanWs(getText(titleEl, '', false)) : '';
    const mdEl = findElement(
      doc,
      (el) =>
        el.tagName === 'meta' &&
        /^description$/i.test(getAttr(el, 'name') ?? '')
    );
    const metaDesc = mdEl ? cleanWs(getAttr(mdEl, 'content') ?? '') : '';
    const canonEl = findElement(doc, (el) => {
      if (el.tagName !== 'link') return false;
      const rel = getAttr(el, 'rel');
      if (!rel) return false;
      return rel.split(/\s+/).includes('canonical');
    });
    const htmlTag = findElement(doc, (el) => el.tagName === 'html');
    const lang = htmlTag ? (getAttr(htmlTag, 'lang') ?? '') : '';
    const robotsEl = findElement(
      doc,
      (el) =>
        el.tagName === 'robots' ||
        (el.tagName === 'meta' && /^robots$/i.test(getAttr(el, 'name') ?? ''))
    );

    let host = '';
    try {
      if (this.url) host = new URL(this.url).host;
    } catch {
      host = '';
    }

    let internal = 0;
    let external = 0;
    for (const a of findAllElements(
      doc,
      (el) => el.tagName === 'a' && hasAttr(el, 'href')
    )) {
      const href = (getAttr(a, 'href') ?? '').trim();
      if (
        href.startsWith('#') ||
        href.startsWith('mailto:') ||
        href.startsWith('tel:') ||
        href.startsWith('javascript:')
      ) {
        continue;
      }
      let netloc = '';
      try {
        netloc = new URL(href, this.url || 'http://x/').host;
      } catch {
        netloc = '';
      }
      const bareHost = host.startsWith('www.') ? host.slice(4) : host;
      if (
        !host ||
        netloc === host ||
        netloc.endsWith('.' + bareHost)
      ) {
        internal += 1;
      } else {
        external += 1;
      }
    }

    const allH1 = findAllElements(doc, (el) => el.tagName === 'h1').map((h) =>
      cleanWs(getText(h, ' ', true))
    );

    const root = pickContentRoot(doc);
    stripChrome(root);
    const imgs = findAllElements(root, (el) => el.tagName === 'img');
    const missingAlt = imgs.filter(
      (i) => !(getAttr(i, 'alt') ?? '').trim()
    ).length;

    const titleParts = headTitle.split(/\s+[|\-–—:]\s+/);
    let titleMain = headTitle;
    if (titleParts.length > 1) {
      const candidatesParts = titleParts.slice(0, -1);
      titleMain = candidatesParts.reduce((best, cur) =>
        cur.length > best.length ? cur : best
      , candidatesParts[0]);
    }
    this._ingest(titleMain, 'title');
    this._ingest(metaDesc, 'meta');
    if (this.url) {
      let path = '';
      try {
        path = decodeURIComponent(new URL(this.url).pathname);
      } catch {
        path = this.url;
      }
      let slug = path
        .replace(/-/g, ' ')
        .replace(/_/g, ' ')
        .replace(/\//g, ' . ');
      slug = slug.replace(/\.(html?|php|aspx?)\b/g, ' ');
      this._ingest(slug, 'url');
    }

    this._stack = [];
    this._newSection(0, headTitle || (allH1[0] ? allH1[0] : 'Page'), 'page');
    this._walk(root);

    if (allH1.length > 0 && !this.sections.some((s) => s.level === 1)) {
      this._ingest(allH1[0], 'h1', 0);
    }

    const headingCounts = {
      h1: 0,
      h2: 0,
      h3: 0,
      h4: 0,
      h5: 0,
      h6: 0,
    };
    for (const h of HEADINGS) {
      headingCounts[h] = this.sections.filter((s) => s.tag === h).length;
    }

    this.meta = {
      title: headTitle,
      title_length: headTitle.length,
      description: metaDesc,
      description_length: metaDesc.length,
      canonical: canonEl ? (getAttr(canonEl, 'href') ?? '') : '',
      robots: robotsEl ? (getAttr(robotsEl, 'content') ?? '') : '',
      lang,
      h1s: allH1,
      word_count: this.body_tokens,
      heading_counts: headingCounts,
      images: imgs.length,
      images_missing_alt: missingAlt,
      internal_links: internal,
      external_links: external,
    };

    return this._score();
  }

  private _score(): AnalysisResult {
    const nSections = Math.max(
      1,
      this.sections.filter((s) => s.words > 0).length
    );
    const totalWords = Math.max(1, this.body_tokens);

    const exact = new Set<string>();
    const titleFirst = (this.meta.title || '').split(/\s+[|\-–—:]\s+/)[0];
    for (const t of [titleFirst, ...this.meta.h1s.slice(0, 1)]) {
      const toks = tokenize(t);
      if (toks.length >= 1 && toks.length <= 4) {
        exact.add(toks.map((x) => stem(x)).join(' '));
      }
    }

    const raw = new Map<string, number>();
    for (const [key, s] of this.kw.entries()) {
      const z = s.zones;
      const body = z.get('body') ?? 0;
      const headingHits =
        (z.get('h1') ?? 0) +
        (z.get('h2') ?? 0) +
        (z.get('h3') ?? 0) +
        (z.get('h4') ?? 0);
      const placed =
        (z.get('title') ?? 0) +
        (z.get('meta') ?? 0) +
        (z.get('url') ?? 0) +
        (z.get('h1') ?? 0) +
        (z.get('h2') ?? 0) +
        (z.get('h3') ?? 0);

      if (s.n === 1 && body < 2 && placed === 0) continue;
      if (s.n > 1 && body + headingHits < 2 && placed === 0) continue;
      if (body + headingHits + placed === 0) continue;
      if (
        s.n > 2 &&
        body < 2 &&
        key.split(' ').some((t) => CONNECTORS.has(t))
      ) {
        continue;
      }
      if (
        s.n > 2 &&
        body === 0 &&
        !(z.get('title') ?? 0) &&
        !exact.has(key)
      ) {
        continue;
      }

      let score = Math.pow(body, 0.7);
      for (const [zone, w] of Object.entries(ZONE_WEIGHTS)) {
        const c = z.get(zone) ?? 0;
        if (c > 0) {
          score += w * (1 + Math.log(c));
        }
      }
      if (s.first_pos !== null && s.first_pos < totalWords * 0.1) {
        score += 2.0;
      }
      const spread = s.section_counts.size / nSections;
      if (exact.has(key)) {
        score += 20.0;
      }
      score *= LENGTH_FACTOR[s.n] * (1 + spread);
      raw.set(key, score);
    }

    const copyFreq = (st: KwStat): number => {
      const z = st.zones;
      return (
        (z.get('body') ?? 0) +
        (z.get('h1') ?? 0) +
        (z.get('h2') ?? 0) +
        (z.get('h3') ?? 0) +
        (z.get('h4') ?? 0)
      );
    };

    const parentTotal = new Map<string, number>();
    for (const [k, st] of this.kw.entries()) {
      if (st.n < 2) continue;
      const f = copyFreq(st);
      if (f + (st.zones.get('title') ?? 0) < 2) continue;
      const toks = k.split(' ');
      incMap(parentTotal, toks.slice(1).join(' '), f);
      incMap(parentTotal, toks.slice(0, -1).join(' '), f);
    }

    for (const k of [...raw.keys()]) {
      const st = this.kw.get(k)!;
      const freq = copyFreq(st);
      if (!freq || exact.has(k)) continue;
      const share = (parentTotal.get(k) ?? 0) / freq;
      if (share >= 0.6) {
        raw.delete(k);
      } else if (share >= 0.45) {
        raw.set(k, raw.get(k)! * 0.5);
      }
    }

    if (raw.size === 0) {
      return this._package([], [], []);
    }

    let mxRaw = 0;
    for (const v of raw.values()) {
      if (v > mxRaw) mxRaw = v;
    }

    const declared = [...exact].filter((k) => (raw.get(k) ?? 0) >= 0.5 * mxRaw);
    if (declared.length > 0) {
      let best = declared[0];
      for (const k of declared) {
        if ((raw.get(k) ?? 0) > (raw.get(best) ?? 0)) {
          best = k;
        }
      }
      raw.set(best, Math.max(raw.get(best)!, mxRaw * 1.0001));
    }

    const top = [...raw.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 150);
    const mx = top[0][1];
    const keywords: KeywordEntry[] = [];

    for (let rank = 0; rank < top.length; rank++) {
      const [key, sc] = top[rank];
      const s = this.kw.get(key)!;
      const z = s.zones;
      const rel = pyRound(100 * Math.pow(sc / mx, 0.5), 1);
      const body = z.get('body') ?? 0;
      const headingHits =
        (z.get('h1') ?? 0) +
        (z.get('h2') ?? 0) +
        (z.get('h3') ?? 0) +
        (z.get('h4') ?? 0);
      const tier: KeywordTier =
        rel >= 65
          ? 'Primary'
          : rel >= 45
            ? 'Secondary'
            : rel >= 25
              ? 'Supporting'
              : 'Long-tail';
      keywords.push({
        id: key,
        keyword: mostCommonOne(s.surfaces),
        relevance: rel,
        tier,
        rank: rank + 1,
        words: s.n,
        frequency: body + headingHits,
        body_count: body,
        density: pyRound((100 * body * s.n) / totalWords, 2),
        in_title: (z.get('title') ?? 0) > 0,
        in_meta: (z.get('meta') ?? 0) > 0,
        in_url: (z.get('url') ?? 0) > 0,
        in_h1: (z.get('h1') ?? 0) > 0,
        h2_count: z.get('h2') ?? 0,
        h3_count: z.get('h3') ?? 0,
        heading_count: headingHits,
        alt_count: z.get('alt') ?? 0,
        emphasis_count: z.get('em') ?? 0,
        anchor_count: z.get('anchor') ?? 0,
        section_count: s.section_counts.size,
        first_position:
          s.first_pos !== null
            ? pyRound((100 * s.first_pos) / totalWords, 1)
            : null,
        raw_score: pyRound(sc, 2),
      });
    }

    const kept = new Map<string, KeywordEntry>(
      keywords.map((k) => [k.id, k])
    );
    const cooc = this._cooccurrence(kept);
    const clusters = this._clusters(keywords);
    const sections = this._sectionReport(kept, cooc);
    return this._package(keywords, sections, clusters, cooc);
  }

  private _cooccurrence(
    kept: Map<string, KeywordEntry>
  ): Map<string, number> {
    const pairs = new Map<string, number>();
    for (const [, keys] of this.sentences) {
      let ks = [...keys].filter((k) => kept.has(k)).sort();
      ks = ks.filter(
        (k) => !ks.some((o) => o !== k && ` ${o} `.includes(` ${k} `))
      );
      for (let i = 0; i < ks.length; i++) {
        for (let j = i + 1; j < ks.length; j++) {
          const pairKey = `${ks[i]}\0${ks[j]}`;
          incMap(pairs, pairKey, 1);
        }
      }
    }
    return pairs;
  }

  private _clusters(keywords: KeywordEntry[]): ClusterEntry[] {
    const main = keywords[0].id;
    const mainTokens = new Set(main.split(' '));
    const tokenWeight = new Map<string, number>();
    for (const k of keywords) {
      for (const t of new Set(k.id.split(' ').reverse())) {
        if (CONNECTORS.has(t) || STOPWORDS.has(t)) continue;
        incMap(tokenWeight, t, k.relevance);
      }
    }

    const sortedTokens = [...tokenWeight.entries()].sort((a, b) => b[1] - a[1]);
    const order = sortedTokens
      .map(([t]) => t)
      .filter((t) => !mainTokens.has(t));
    for (const t of mainTokens) {
      if (tokenWeight.has(t)) {
        order.push(t);
      }
    }
    const rank = new Map<string, number>(order.map((t, i) => [t, i]));

    const members = new Map<string, KeywordEntry[]>();
    for (const k of keywords.slice(1)) {
      const toks = [...new Set(k.id.split(' '))].filter((t) => rank.has(t));
      if (toks.length === 0) continue;
      let bestTok = toks[0];
      for (const t of toks) {
        if (rank.get(t)! < rank.get(bestTok)!) {
          bestTok = t;
        }
      }
      const list = members.get(bestTok) ?? [];
      list.push(k);
      members.set(bestTok, list);
    }

    const clusters: ClusterEntry[] = [];
    const other: KeywordEntry[] = [];
    for (const t of order) {
      const m = members.get(t) ?? [];
      if (m.length >= 2 && clusters.length < 20) {
        m.sort((a, b) => b.relevance - a.relevance);
        const uni = m.find((k) => k.id === t);
        const label =
          uni && uni.relevance >= 0.75 * m[0].relevance
            ? uni.keyword
            : m[0].keyword;
        const sumRel = m.reduce((acc, k) => acc + k.relevance, 0);
        const strength = pyRound(sumRel, 1);
        clusters.push({
          id: `c${clusters.length}`,
          token: t,
          label,
          keywords: m.map((k) => k.id),
          strength,
          avg_relevance: pyRound(strength / m.length, 1),
        });
      } else {
        other.push(...m);
      }
    }

    if (other.length > 0) {
      other.sort((a, b) => b.relevance - a.relevance);
      const sumRel = other.reduce((acc, k) => acc + k.relevance, 0);
      clusters.push({
        id: 'c_other',
        token: '',
        label: 'Other related terms',
        keywords: other.map((k) => k.id),
        strength: pyRound(sumRel, 1),
        avg_relevance: pyRound(sumRel / other.length, 1),
      });
    }

    const cmap = new Map<string, string>();
    for (const c of clusters) {
      for (const kid of c.keywords) {
        cmap.set(kid, c.label);
      }
    }
    cmap.set(main, 'Main topic');
    for (const k of keywords) {
      k.cluster = cmap.get(k.id) ?? 'Other related terms';
    }

    clusters.sort((a, b) => {
      const aOther = a.id === 'c_other' ? 1 : 0;
      const bOther = b.id === 'c_other' ? 1 : 0;
      if (aOther !== bOther) return aOther - bOther;
      return b.strength - a.strength;
    });
    return clusters;
  }

  private _sectionReport(
    kept: Map<string, KeywordEntry>,
    cooc: Map<string, number>
  ): SectionEntry[] {
    const secs = this.sections;
    const subtree = (i: number): number[] => {
      const out = [i];
      for (const c of secs[i].children) {
        out.push(...subtree(c));
      }
      return out;
    };

    const nSecs = Math.max(1, secs.length);
    const docFreq = new Map<string, number>();
    for (const k of kept.keys()) {
      docFreq.set(k, this.kw.get(k)!.section_counts.size);
    }

    const relatedPairs = new Map<string, number>();
    for (const [pairKey, w] of cooc.entries()) {
      const [a, b] = pairKey.split('\0');
      relatedPairs.set(`${a}\0${b}`, w);
      relatedPairs.set(`${b}\0${a}`, w);
    }

    const out: SectionEntry[] = [];
    for (const sec of secs) {
      if (sec.utility) continue;
      sec.children = sec.children.filter((c) => !secs[c].utility);
      const ids = subtree(sec.id);
      const idset = new Set(ids);
      const cumWords = ids.reduce((acc, i) => acc + secs[i].words, 0);

      let hk: string[];
      if (sec.level === 0) {
        hk = [...kept.keys()].filter(
          (k) => (this.kw.get(k)!.zones.get('title') ?? 0) > 0
        );
      } else {
        hk = [...kept.keys()].filter((k) =>
          this.kw.get(k)!.heading_sections.has(sec.id)
        );
      }
      hk.sort((a, b) => kept.get(b)!.relevance - kept.get(a)!.relevance);

      let chosen: string[] = [];
      for (const k of hk) {
        if (chosen.some((c) => ` ${c} `.includes(` ${k} `))) continue;
        chosen.push(k);
        if (chosen.length === 4) break;
      }
      chosen = chosen
        .filter(
          (k) => !chosen.some((o) => o !== k && ` ${o} `.includes(` ${k} `))
        )
        .slice(0, 3);

      const localCount = (k: string): number => {
        let sum = 0;
        for (const [sid, c] of this.kw.get(k)!.section_counts.entries()) {
          if (idset.has(sid)) sum += c;
        }
        return sum;
      };

      const headingKws: HeadingKeywordRef[] = chosen.map((k) => ({
        id: k,
        keyword: kept.get(k)!.keyword,
        relevance: kept.get(k)!.relevance,
        copy_mentions: localCount(k),
      }));

      const headTokens = new Set<string>();
      for (const k of chosen) {
        for (const t of k.split(' ')) {
          headTokens.add(t);
        }
      }

      const cands: Array<[number, string, number, boolean]> = [];
      for (const [k, kd] of kept.entries()) {
        if (
          chosen.includes(k) ||
          chosen.some((c) => ` ${c} `.includes(` ${k} `))
        ) {
          continue;
        }
        const lc = localCount(k);
        if (lc === 0) continue;
        const idf = Math.log(1 + nSecs / Math.max(1, docFreq.get(k) ?? 1));
        const related =
          k.split(' ').some((t) => headTokens.has(t)) ||
          chosen.some((c) => (relatedPairs.get(`${k}\0${c}`) ?? 0) > 0);
        const score =
          Math.sqrt(lc) *
          idf *
          (0.5 + kd.relevance / 100) *
          (related ? 1.35 : 1.0);
        cands.push([score, k, lc, related]);
      }

      cands.sort((a, b) => {
        if (b[0] !== a[0]) return b[0] - a[0];
        return b[1].localeCompare(a[1]);
      });

      const supp: Array<[number, string, number, boolean]> = [];
      for (const item of cands) {
        const [, k] = item;
        if (supp.some((s) => ` ${s[1]} `.includes(` ${k} `))) continue;
        supp.push(item);
        if (supp.length === 10) break;
      }

      const mx = supp.length > 0 ? supp[0][0] : 1;
      const supporting: SupportingKeywordRef[] = supp.map(
        ([sc, k, lc, rel]) => ({
          id: k,
          keyword: kept.get(k)!.keyword,
          support: pyRound((100 * sc) / mx),
          mentions: lc,
          relevance: kept.get(k)!.relevance,
          related_to_heading: rel,
        })
      );

      const notes: string[] = [];
      let alignment: number | null = null;
      if (sec.level > 0) {
        let aHead = 0.0;
        if (chosen.length === 0) {
          aHead = 0.0;
          notes.push('Heading contains no ranking keyword from the page.');
        } else {
          const secStems = new Map<string, number>();
          for (const i of ids) {
            for (const [st, cnt] of secs[i].stems.entries()) {
              incMap(secStems, st, cnt);
            }
          }
          const credit: number[] = [];
          for (const h of headingKws) {
            if (h.copy_mentions > 0) {
              credit.push(1.0);
              continue;
            }
            const toks = h.id
              .split(' ')
              .filter((t) => !CONNECTORS.has(t));
            const matched = toks.filter((t) => (secStems.get(t) ?? 0) > 0).length;
            const part = matched / Math.max(1, toks.length);
            credit.push(0.6 * part);
            if (part > 0) {
              notes.push(
                `“${h.keyword}” isn't repeated as a phrase in the copy; only parts of it are.`
              );
            } else {
              notes.push(
                `“${h.keyword}” is in the heading but never mentioned in the copy.`
              );
            }
          }
          aHead = credit.reduce((acc, c) => acc + c, 0) / credit.length;
        }
        const nRelated = supporting.filter((s) => s.related_to_heading).length;
        const aSupp = Math.min(1.0, nRelated / 4);
        const aWords = Math.min(1.0, cumWords / 150);
        if (cumWords < 50) {
          notes.push(`Thin section (${cumWords} words).`);
        }
        alignment = pyRound(100 * (0.5 * aHead + 0.3 * aSupp + 0.2 * aWords));
      }

      const label: AlignmentLabel =
        alignment === null
          ? null
          : alignment >= 70
            ? 'Strong'
            : alignment >= 40
              ? 'Moderate'
              : 'Weak';

      out.push({
        id: sec.id,
        level: sec.level,
        tag: sec.tag,
        heading: sec.heading,
        parent: sec.parent,
        children: sec.children,
        word_count: sec.words,
        cumulative_word_count: cumWords,
        heading_keywords: headingKws,
        supporting_keywords: supporting,
        alignment,
        alignment_label: label,
        notes,
        excerpt: sec.blocks.length > 0 ? sec.blocks.join(' ').slice(0, 280) : '',
      });
    }
    return out;
  }

  private _package(
    keywords: KeywordEntry[],
    sections: SectionEntry[],
    clusters: ClusterEntry[],
    cooc?: Map<string, number>
  ): AnalysisResult {
    const kept = new Set(keywords.slice(0, 60).map((k) => k.id));
    const edges: CooccurrenceEdge[] = [];
    if (cooc) {
      const sorted = [...cooc.entries()].sort((a, b) => b[1] - a[1]);
      for (const [pairKey, w] of sorted) {
        if (w < 2) break;
        const [a, b] = pairKey.split('\0');
        if (kept.has(a) && kept.has(b)) {
          edges.push({ source: a, target: b, weight: w });
        }
        if (edges.length >= 120) break;
      }
    }
    const issues = this._issues(keywords, sections);
    const isoNoMs = new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');
    return {
      url: this.url,
      analyzed_at: isoNoMs,
      meta: this.meta,
      main_topic:
        keywords.length > 0
          ? { id: keywords[0].id, keyword: keywords[0].keyword }
          : null,
      keywords,
      sections,
      clusters,
      cooccurrence: edges,
      issues,
      requested_url: this.url,
    };
  }

  private _issues(
    keywords: KeywordEntry[],
    sections: SectionEntry[]
  ): PageIssue[] {
    const m = this.meta;
    const out: Array<[IssueSeverity, string]> = [];
    if (!m.title) {
      out.push(['high', 'Page has no <title> tag.']);
    } else if (m.title_length > 65) {
      out.push([
        'low',
        `Title is ${m.title_length} characters; it may be truncated in results (aim for ≤ 60).`,
      ]);
    }
    if (!m.description) {
      out.push(['medium', 'No meta description found.']);
    } else if (m.description_length > 165) {
      out.push([
        'low',
        `Meta description is ${m.description_length} characters (aim for 120–160).`,
      ]);
    }
    if (!m.h1s || m.h1s.length === 0) {
      out.push(['high', 'Page has no H1.']);
    } else if (m.h1s.length > 1) {
      out.push([
        'medium',
        `Page has ${m.h1s.length} H1 headings; one clear H1 is usually best.`,
      ]);
    }
    if (keywords.length > 0) {
      const main = keywords[0];
      const checks: Array<[string, boolean]> = [
        ['title', main.in_title],
        ['H1', main.in_h1],
        ['meta description', main.in_meta],
        ['URL', main.in_url],
      ];
      const missing = checks.filter(([, ok]) => !ok).map(([label]) => label);
      if (missing.length > 0) {
        out.push([
          'medium',
          `Main topic “${main.keyword}” is missing from: ${missing.join(', ')}.`,
        ]);
      }
      if (main.first_position === null || main.first_position > 10) {
        out.push([
          'low',
          `Main topic “${main.keyword}” doesn't appear in the opening copy.`,
        ]);
      }
      if (main.density > 3.5) {
        out.push([
          'medium',
          `Main topic density is ${main.density}%; that may read as keyword stuffing.`,
        ]);
      }
    }
    if ((m.word_count ?? 0) < 300) {
      out.push([
        'medium',
        `Thin page: only ${m.word_count ?? 0} words of body copy were found (if the site renders with JavaScript, paste the rendered HTML instead).`,
      ]);
    }
    const weak = sections.filter((s) => s.alignment_label === 'Weak');
    if (weak.length > 0) {
      out.push([
        'low',
        `${weak.length} section(s) have weak keyword support between heading and copy.`,
      ]);
    }
    const noKw = sections.filter(
      (s) => s.level > 0 && s.heading_keywords.length === 0
    );
    if (noKw.length > 0) {
      out.push([
        'low',
        `${noKw.length} heading(s) don't contain any of the page's keywords.`,
      ]);
    }
    if (m.images_missing_alt > 0) {
      out.push([
        'low',
        `${m.images_missing_alt} of ${m.images} content images are missing alt text.`,
      ]);
    }
    return out.map(([severity, message]) => ({ severity, message }));
  }
}

export function analyzeHtml(html: string, url = ''): AnalysisResult {
  const res = new Analyzer(html, url).run();
  res.requested_url = url;
  return res;
}
