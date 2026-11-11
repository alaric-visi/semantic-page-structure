/**
 * Vocabulary, stopword sets, zone weights, and regular expressions ported
 * verbatim from the Python reference implementation (analyzer.py).
 */

export const STOPWORDS = new Set(
  `
a about above after again against all am an and any are aren't as at be because
been before being below between both but by can can't cannot could couldn't did
didn't do does doesn't doing don't down during each few for from further had
hadn't has hasn't have haven't having he he'd he'll he's her here here's hers
herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's
its itself let's me more most mustn't my myself no nor not of off on once only or
other ought our ours ourselves out over own same shan't she she'd she'll she's
should shouldn't so some such than that that's the their theirs them themselves
then there there's these they they'd they'll they're they've this those through
to too under until up very was wasn't we we'd we'll we're we've were weren't what
what's when when's where where's which while who who's whom why why's with won't
would wouldn't you you'd you'll you're you've your yours yourself yourselves
also just like get gets got getting make makes made really may might must will
shall us one etc via per within without upon onto across among around yet still
even ever much many lot lots thing things whether however therefore thus though
although always often sometimes usually every another anything something nothing
everything someone anyone everyone able let say said says now today here there
including include includes towards toward allows allow allowed whose whatever whenever wherever since
ve ll re don doesn didn isn aren wasn weren won t s d m o
`
    .trim()
    .split(/\s+/)
);

export const UNIGRAM_BLOCK = new Set(
  `
best new good great first free top need needs use used using uses help helps find
work works time times day days year years way ways want wants know see go going
come take well back right left two three four five six seven eight nine ten
click here read more menu login log sign subscribe newsletter copyright rights
reserved skip content share facebook twitter linkedin instagram youtube pinterest
email javascript browser cookie cookies privacy policy terms home page pages site
website view next previous prev post posts comment comments reply search close open
yes ok via www com http https html php amp nbsp quot
archived retrieved original isbn doi pmid issn cite citation references edit wayback
different important simple easy many several various whole full part kind sure
just actually really quite able possible likely example examples start started
look looking keep give gives giving try trying put set sets show shows called
already either found understand early approach improve matters thing someone
around almost enough rather instead simply probably maybe perhaps certain clear
clearly especially particularly generally typically usually quickly easily often
later last next least less little long big small high low large real true sure
better worse own able ask asked asking says told tell think thought feel means mean
make making made goes went done does doing seen seem seems become becomes became
want wanted run runs ran got lot lots bit far away else whole per every various
following follow follows according related based see saw talk talking talked
`
    .trim()
    .split(/\s+/)
);

export const CONNECTORS = new Set([
  'of',
  'and',
  'for',
  'to',
  'in',
  'on',
  'with',
  'the',
  'a',
  '&',
  'vs',
  'or',
  'by',
  'from',
]);

export const NO_STEM = new Set([
  'news',
  'gas',
  'bus',
  'lens',
  'physics',
  'always',
  'analytics',
  'series',
  'species',
  'mathematics',
  'economics',
  'politics',
  'ethics',
  'status',
  'process',
  'access',
  'business',
  'class',
  'glass',
  'less',
  'bias',
  'atlas',
  'this',
  'his',
  'is',
  'was',
  'has',
  'does',
  'yes',
  'its',
  'us',
  'plus',
  'canvas',
  'chaos',
  'corpus',
  'focus',
  'virus',
  'campus',
  'census',
  'bonus',
]);

export const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

export const TEXT_BLOCKS = new Set([
  'p',
  'li',
  'td',
  'th',
  'dd',
  'dt',
  'blockquote',
  'figcaption',
  'pre',
  'caption',
  'summary',
]);

export const BLOCKISH = new Set([
  ...TEXT_BLOCKS,
  ...HEADINGS,
  'div',
  'ul',
  'ol',
  'table',
  'section',
  'article',
  'main',
  'aside',
  'dl',
  'form',
]);

export const SKIP_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'svg',
  'template',
  'iframe',
  'form',
  'button',
  'select',
  'option',
  'input',
  'textarea',
  'canvas',
  'video',
  'audio',
  'object',
  'embed',
  'map',
]);

export const BOILERPLATE_RE =
  /(cookie|consent|gdpr|modal|popup|newsletter|subscribe|social-share|share-buttons|sharing|advert|sponsor|reflist|mw-references|navbox|editsection|catlinks|printfooter|breadcrumb|related-posts|comment-list|comments-area|author-bio|ambox|hatnote|noprint|\btoc\b)/i;

export const ZONE_WEIGHTS: Record<string, number> = {
  title: 10.0,
  h1: 8.0,
  url: 6.0,
  h2: 5.0,
  meta: 5.0,
  h3: 3.0,
  h4: 2.0,
  alt: 1.5,
  em: 1.5,
  anchor: 1.0,
};

export const UTILITY_HEADING_RE =
  /^\s*(see also|references?|external links|further reading|notes|sources|bibliography|footnotes|citations|related (posts|articles|reading|content)|you (may|might) also like|comments?|leave a (reply|comment)|share (this|on)|about the author|recent posts|categories|tags|follow us|subscribe)\b/i;

export const LENGTH_FACTOR: Record<number, number> = {
  1: 1.0,
  2: 1.5,
  3: 1.8,
  4: 1.9,
};

export const TOKEN_RE = /[a-z0-9]+(?:['&\-][a-z0-9]+)*/g;
export const SENTENCE_SPLIT = /(?<=[.!?])\s+|\n+/;
export const CHUNK_SPLIT =
  /[.!?;:,()\[\]{}"“”‘|•·/\\…]+|\s[-–—]+\s|\s[-–—]|[-–—]\s/;
export const HYPHEN_JOIN = /(?<=[a-z]{3})-(?=[a-z]{3})/g;

export const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 PageStructureAnalyzer/1.0';

