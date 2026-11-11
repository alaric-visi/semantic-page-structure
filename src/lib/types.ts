export type KeywordTier = 'Primary' | 'Secondary' | 'Supporting' | 'Long-tail';
export type AlignmentLabel = 'Strong' | 'Moderate' | 'Weak' | null;
export type IssueSeverity = 'high' | 'medium' | 'low';

export interface PageMeta {
  title: string;
  title_length: number;
  description: string;
  description_length: number;
  canonical: string;
  robots: string;
  lang: string;
  h1s: string[];
  word_count: number;
  heading_counts: Record<'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6', number>;
  images: number;
  images_missing_alt: number;
  internal_links: number;
  external_links: number;
}

export interface KeywordEntry {
  id: string;
  keyword: string;
  relevance: number;
  tier: KeywordTier;
  rank: number;
  words: number;
  frequency: number;
  body_count: number;
  density: number;
  in_title: boolean;
  in_meta: boolean;
  in_url: boolean;
  in_h1: boolean;
  h2_count: number;
  h3_count: number;
  heading_count: number;
  alt_count: number;
  emphasis_count: number;
  anchor_count: number;
  section_count: number;
  first_position: number | null;
  raw_score: number;
  cluster?: string;
}

export interface HeadingKeywordRef {
  id: string;
  keyword: string;
  relevance: number;
  copy_mentions: number;
}

export interface SupportingKeywordRef {
  id: string;
  keyword: string;
  support: number;
  mentions: number;
  relevance: number;
  related_to_heading: boolean;
}

export interface SectionEntry {
  id: number;
  level: number;
  tag: string;
  heading: string;
  parent: number | null;
  children: number[];
  word_count: number;
  cumulative_word_count: number;
  heading_keywords: HeadingKeywordRef[];
  supporting_keywords: SupportingKeywordRef[];
  alignment: number | null;
  alignment_label: AlignmentLabel;
  notes: string[];
  excerpt: string;
}

export interface ClusterEntry {
  id: string;
  token: string;
  label: string;
  keywords: string[];
  strength: number;
  avg_relevance: number;
}

export interface CooccurrenceEdge {
  source: string;
  target: string;
  weight: number;
}

export interface PageIssue {
  severity: IssueSeverity;
  message: string;
}

export interface AnalysisResult {
  url: string;
  requested_url: string;
  http_status?: number;
  analyzed_at: string;
  meta: PageMeta;
  main_topic: { id: string; keyword: string } | null;
  keywords: KeywordEntry[];
  sections: SectionEntry[];
  clusters: ClusterEntry[];
  cooccurrence: CooccurrenceEdge[];
  issues: PageIssue[];
}

