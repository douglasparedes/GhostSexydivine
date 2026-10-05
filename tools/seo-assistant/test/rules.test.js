import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeResource,
  headingCounts,
  imagesWithoutAlt,
  linkCounts,
  stripHtml,
  wordCount,
} from '../src/rules.js';
import { validateFix, WRITABLE_FIELDS } from '../src/ghost.js';

function basePost(overrides = {}) {
  return {
    id: 'post-1',
    title: 'A Perfectly Optimized Post Title Here Now',
    slug: 'perfectly-optimized-post',
    custom_excerpt: 'A concise custom excerpt describing this post for cards and feeds.',
    feature_image: 'https://example.com/image.jpg',
    feature_image_alt: 'Descriptive alt text',
    meta_title: 'Perfectly Optimized Post Title Here (55 chars long ok)',
    meta_description:
      'This reference post demonstrates ideal Ghost SEO: a focused title, a meta description sized for results, relevant tags and clear headings.',
    canonical_url: null,
    codeinjection_head: null,
    codeinjection_foot: null,
    og_image: 'https://example.com/og.jpg',
    twitter_image: 'https://example.com/tw.jpg',
    status: 'published',
    updated_at: new Date().toISOString(),
    tags: [{ name: 'News' }, { name: 'SEO' }],
    html: `<h2>Introduction</h2><p>${'word '.repeat(400)}</p><a href="/other-post">related</a><img src="a.jpg" alt="text">`,
    ...overrides,
  };
}

describe('stripHtml and wordCount', () => {
  it('counts words ignoring markup', () => {
    assert.equal(wordCount('<h2>Hi</h2><p>one two three</p>'), 4);
  });

  it('returns zero for empty input', () => {
    assert.equal(wordCount(null), 0);
    assert.equal(stripHtml(undefined), '');
  });
});

describe('headingCounts', () => {
  it('counts each level', () => {
    assert.deepEqual(headingCounts('<h1>a</h1><h2>b</h2><h2>c</h2>'), { h1: 1, h2: 2, h3: 0 });
  });
});

describe('imagesWithoutAlt', () => {
  it('flags images missing alt attributes', () => {
    assert.equal(imagesWithoutAlt('<img src="a.jpg"><img src="b.jpg" alt="b">'), 1);
  });
});

describe('linkCounts', () => {
  it('separates internal and external links', () => {
    const html =
      '<a href="/local">a</a><a href="https://example.com/x">b</a><a href="https://other.test/y">c</a><a href="#frag">d</a>';
    assert.deepEqual(linkCounts(html, 'https://example.com'), { internal: 2, external: 1 });
  });
});

describe('analyzeResource', () => {
  it('scores a healthy post at 100 with no findings', () => {
    const result = analyzeResource(basePost());
    assert.equal(result.score, 100);
    assert.deepEqual(result.findings, []);
  });

  it('flags missing meta fields, images, tags, and thin content', () => {
    const result = analyzeResource(
      basePost({
        meta_title: null,
        meta_description: null,
        feature_image: null,
        tags: [],
        html: '<p>short</p>',
      }),
    );
    const rules = result.findings.map((finding) => finding.rule);
    assert.ok(rules.includes('meta-title-missing'));
    assert.ok(rules.includes('meta-description-missing'));
    assert.ok(rules.includes('feature-image-missing'));
    assert.ok(rules.includes('tags-missing'));
    assert.ok(rules.includes('thin-content'));
    assert.ok(result.score < 100);
  });

  it('errors on multiple body H1s', () => {
    const result = analyzeResource(basePost({ html: '<h1>a</h1><h1>b</h1><p>text</p>' }));
    const h1 = result.findings.find((finding) => finding.rule === 'h1-multiple');
    assert.equal(h1?.severity, 'error');
  });

  it('warns on bad slugs', () => {
    const long = analyzeResource(basePost({ slug: 'x'.repeat(80) }));
    assert.ok(long.findings.some((finding) => finding.rule === 'slug-length'));
    const upper = analyzeResource(basePost({ slug: 'Bad_Slug Here' }));
    assert.ok(upper.findings.some((finding) => finding.rule === 'slug-format'));
  });

  it('clamps the score at zero for pathological input', () => {
    const result = analyzeResource(
      basePost({
        title: '',
        meta_title: 'x'.repeat(200),
        meta_description: null,
        slug: '9'.repeat(90),
        custom_excerpt: null,
        excerpt: null,
        feature_image: null,
        tags: [],
        html: '<h1>a</h1><h1>b</h1><img src="x.jpg">',
        codeinjection_head: 'x'.repeat(5000),
        og_image: null,
        twitter_image: null,
      }),
    );
    assert.ok(result.score >= 0);
  });
});

describe('approval whitelist', () => {
  it('allows meta fields and tags', () => {
    assert.ok(WRITABLE_FIELDS.has('meta_title'));
    assert.ok(WRITABLE_FIELDS.has('tags'));
  });

  it('rejects slugs, ids, and content bodies', () => {
    assert.throws(() => validateFix('slug'), /not writable/);
    assert.throws(() => validateFix('html'), /not writable/);
    assert.throws(() => validateFix('id'), /not writable/);
  });
});
