import { describe, expect, it } from 'vitest';
import { analyzeHtml } from '../analyzer';
import { isPublicIp, validateSafeUrl } from '../safe-fetch';

describe('Page Structure Analyzer - Regression Suite', () => {
  it('analyses synthetic running-shoes HTML with exact expected structure and scores', () => {
    const html = `<!doctype html>
<html lang="en"><head><title>Best Running Shoes for Flat Feet | Shop</title>
<meta name="description" content="Find the best running shoes for flat feet, with arch support and stability."></head>
<body><header><nav><a href="/">Home</a> <a href="/shoes">Shoes</a></nav></header>
<main><h1>Best running shoes for flat feet</h1>
<p>Flat feet need running shoes with arch support. Stability running shoes help flat feet runners avoid overpronation.</p>
<h2>Why arch support matters</h2>
<p>Arch support reduces strain. Good arch support in running shoes keeps flat feet stable and prevents overpronation on long runs.</p>
<h3>Signs you need more support</h3>
<p>Knee pain, shin splints and uneven wear on running shoes are common signs that flat feet need more arch support.</p>
<h2>Our top stability shoes</h2>
<p>Stability shoes with <strong>motion control</strong> are ideal. These stability shoes offer arch support and cushioning for runners with flat feet.</p>
<img src="a.jpg" alt="Stability running shoes for flat feet"><img src="b.jpg">
<h2>Contact us</h2><p>Call us.</p>
<h2>Related posts</h2><p>Trail running shoes for beginners and other running shoes guides.</p>
</main><footer>Copyright 2026 Shop. Privacy policy.</footer></body></html>`;

    const res = analyzeHtml(
      html,
      'https://shop.example.com/running-shoes-flat-feet'
    );
    expect(res.main_topic).toEqual({ id: 'flat feet', keyword: 'flat feet' });
    expect(res.meta.word_count).toBe(79);
    expect(res.meta.images).toBe(2);
    expect(res.meta.images_missing_alt).toBe(1);
    expect(res.keywords.slice(0, 4).map((k) => k.id)).toEqual([
      'flat feet',
      'running shoe',
      'best running shoe',
      'arch support',
    ]);
    // Utility heading "Related posts" is excluded from section report
    expect(res.sections.map((s) => s.heading)).toEqual([
      'Best Running Shoes for Flat Feet | Shop',
      'Best running shoes for flat feet',
      'Why arch support matters',
      'Signs you need more support',
      'Our top stability shoes',
      'Contact us',
    ]);
    expect(res.clusters.map((c) => c.id)).toEqual(['c0', 'c1', 'c_other']);
  });
});

describe('SSRF Protection - safeFetch URL and IP validation', () => {
  it('blocks private, loopback, link-local, CGNAT, and IPv6 local addresses', () => {
    expect(isPublicIp('127.0.0.1')).toBe(false);
    expect(isPublicIp('10.0.0.1')).toBe(false);
    expect(isPublicIp('172.16.5.4')).toBe(false);
    expect(isPublicIp('192.168.1.1')).toBe(false);
    expect(isPublicIp('169.254.169.254')).toBe(false);
    expect(isPublicIp('100.64.0.1')).toBe(false);
    expect(isPublicIp('0.0.0.0')).toBe(false);
    expect(isPublicIp('::1')).toBe(false);
    expect(isPublicIp('::')).toBe(false);
    expect(isPublicIp('fc00::1')).toBe(false);
    expect(isPublicIp('fe80::1')).toBe(false);
    expect(isPublicIp('::ffff:127.0.0.1')).toBe(false);
    expect(isPublicIp('::ffff:169.254.169.254')).toBe(false);
    expect(isPublicIp('93.184.216.34')).toBe(true);
  });

  it('rejects dangerous URLs before network access', async () => {
    const blockedUrls = [
      'http://127.0.0.1/',
      'http://localhost:8765/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://0.0.0.0/',
      'http://10.0.0.1/',
      'http://192.168.1.1/',
      'http://172.16.0.1/',
      'http://2130706433/',
      'http://0x7f000001/',
      'http://0177.0.0.1/',
      'file:///etc/passwd',
      'http://user:pass@example.com/',
      'http://example.com:8080/',
      'http://internal.local/',
    ];

    for (const u of blockedUrls) {
      await expect(
        validateSafeUrl(u, async () => [{ address: '93.184.216.34', family: 4 }])
      ).rejects.toThrow();
    }
  });

  it('rejects public hostnames that resolve to private IPs (DNS rebinding)', async () => {
    await expect(
      validateSafeUrl('https://evil.example.com/', async () => [
        { address: '169.254.169.254', family: 4 },
      ])
    ).rejects.toThrow(/private|loopback|reserved/i);
  });
});
