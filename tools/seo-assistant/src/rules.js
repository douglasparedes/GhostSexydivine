// Deterministic SEO checks for Ghost posts and pages. Pure functions so the
// engine is unit-testable without a Ghost connection or an AI key.

export const SEVERITIES = ['error', 'warning', 'info'];

const SCORE_COST = { error: 15, warning: 7, info: 2 };

function finding(rule, severity, message, field = null, current = null) {
  return { rule, severity, message, field, current };
}

export function stripHtml(html) {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function wordCount(html) {
  const text = stripHtml(html);
  if (!text) {
    return 0;
  }
  return text.split(' ').length;
}

export function headingCounts(html) {
  const counts = { h1: 0, h2: 0, h3: 0 };
  const source = String(html ?? '');
  for (const level of Object.keys(counts)) {
    const matches = source.match(new RegExp(`<${level}[\\s>]`, 'gi'));
    counts[level] = matches ? matches.length : 0;
  }
  return counts;
}

export function imagesWithoutAlt(html) {
  const source = String(html ?? '');
  const tags = source.match(/<img\b[^>]*>/gi) ?? [];
  return tags.filter((tag) => !/\balt\s*=\s*("[^"]*"|'[^']*')/i.test(tag)).length;
}

function hostOf(url) {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

export function linkCounts(html, siteUrl) {
  const source = String(html ?? '');
  const siteHost = siteUrl ? hostOf(siteUrl) : null;
  let internal = 0;
  let external = 0;
  const pattern = /<a\b[^>]*?\bhref\s*=\s*("[^"]*"|'[^']*')/gi;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const href = match[1].slice(1, -1).trim();
    if (href.startsWith('#') || href.startsWith('mailto:') || href === '') {
      continue;
    }
    if (href.startsWith('/') && !href.startsWith('//')) {
      internal += 1;
      continue;
    }
    const hrefHost = hostOf(href);
    if (!hrefHost) {
      continue;
    }
    if (siteHost && hrefHost === siteHost) {
      internal += 1;
    } else {
      external += 1;
    }
  }
  return { internal, external };
}

export function analyzeResource(resource, siteUrl = null) {
  const findings = [];
  const published = resource.status === 'published';
  const html = resource.html ?? '';
  const words = wordCount(html);
  const headings = headingCounts(html);
  const missingAlt = imagesWithoutAlt(html);
  const links = linkCounts(html, siteUrl);

  const title = (resource.title ?? '').trim();
  if (title.length === 0) {
    findings.push(
      finding('title-missing', 'error', 'The post has no title.', 'title', resource.title ?? null),
    );
  } else if (title.length < 15 || title.length > 70) {
    findings.push(
      finding(
        'title-length',
        'warning',
        `Title is ${title.length} characters; aim for 15-70.`,
        'title',
        title,
      ),
    );
  }

  const metaTitle = (resource.meta_title ?? '').trim();
  if (!metaTitle) {
    findings.push(
      finding(
        'meta-title-missing',
        'warning',
        'No custom meta title; search results fall back to the post title.',
        'meta_title',
        null,
      ),
    );
  } else if (metaTitle.length < 30 || metaTitle.length > 60) {
    findings.push(
      finding(
        'meta-title-length',
        'warning',
        `Meta title is ${metaTitle.length} characters; aim for 30-60.`,
        'meta_title',
        metaTitle,
      ),
    );
  }

  const metaDescription = (resource.meta_description ?? '').trim();
  if (!metaDescription) {
    findings.push(
      finding(
        'meta-description-missing',
        'warning',
        'No meta description; search results show an uncontrolled snippet.',
        'meta_description',
        null,
      ),
    );
  } else if (metaDescription.length < 120 || metaDescription.length > 158) {
    findings.push(
      finding(
        'meta-description-length',
        'warning',
        `Meta description is ${metaDescription.length} characters; aim for 120-158.`,
        'meta_description',
        metaDescription,
      ),
    );
  }

  const slug = resource.slug ?? '';
  if (slug.length > 75) {
    findings.push(
      finding(
        'slug-length',
        'warning',
        `Slug is ${slug.length} characters; shorter slugs perform better.`,
        'slug',
        slug,
      ),
    );
  } else if (/[A-Z_\s]/.test(slug)) {
    findings.push(
      finding(
        'slug-format',
        'warning',
        'Slug should be lowercase with hyphens only.',
        'slug',
        slug,
      ),
    );
  } else if (/^\d+$/.test(slug)) {
    findings.push(
      finding('slug-numeric', 'warning', 'Numeric-only slugs carry no keywords.', 'slug', slug),
    );
  }

  const excerpt = (resource.custom_excerpt ?? resource.excerpt ?? '').trim();
  if (!excerpt) {
    findings.push(
      finding(
        'excerpt-missing',
        'warning',
        'No excerpt; set a custom excerpt for cards and feeds.',
        'custom_excerpt',
        null,
      ),
    );
  }

  if (!resource.feature_image) {
    findings.push(
      finding(
        'feature-image-missing',
        'warning',
        'No feature image; cards and social shares look empty.',
        'feature_image',
        null,
      ),
    );
  } else if (!(resource.feature_image_alt ?? '').trim()) {
    findings.push(
      finding(
        'feature-image-alt-missing',
        'warning',
        'Feature image has no alt text for accessibility and image search.',
        'feature_image_alt',
        null,
      ),
    );
  }

  const tags = resource.tags ?? [];
  if (tags.length === 0) {
    findings.push(
      finding(
        'tags-missing',
        'warning',
        'No tags; add 1-5 relevant tags for discovery.',
        'tags',
        [],
      ),
    );
  } else if (tags.length > 5) {
    findings.push(
      finding(
        'tags-many',
        'info',
        `${tags.length} tags is a lot; consider keeping the 5 most relevant.`,
        'tags',
        tags.map((tag) => tag.name),
      ),
    );
  }

  if (headings.h1 > 1) {
    findings.push(
      finding(
        'h1-multiple',
        'error',
        `Body contains ${headings.h1} H1 headings; keep at most one (the title already serves as H1).`,
        null,
        headings.h1,
      ),
    );
  } else if (headings.h1 === 1) {
    findings.push(
      finding(
        'h1-in-body',
        'warning',
        'Body contains an H1; prefer H2 sections since the title is already the H1.',
        null,
        1,
      ),
    );
  }

  if (published && words < 300) {
    findings.push(
      finding(
        'thin-content',
        'warning',
        `Only ${words} words; thin pages rarely rank. Consider expanding past 300.`,
        null,
        words,
      ),
    );
  }

  if (missingAlt > 0) {
    findings.push(
      finding(
        'images-alt-missing',
        'warning',
        `${missingAlt} inline image(s) lack alt text.`,
        null,
        missingAlt,
      ),
    );
  }

  if (published && words > 500 && links.internal === 0) {
    findings.push(
      finding(
        'no-internal-links',
        'info',
        'Longer post with no internal links; link to related posts.',
        null,
        0,
      ),
    );
  }

  const canonical = (resource.canonical_url ?? '').trim();
  if (canonical && siteUrl) {
    const canonicalHost = hostOf(canonical);
    const ownHost = hostOf(siteUrl);
    if (canonicalHost && ownHost && canonicalHost !== ownHost) {
      findings.push(
        finding(
          'canonical-external',
          'info',
          'Canonical URL points off-site; make sure that is intentional.',
          'canonical_url',
          canonical,
        ),
      );
    }
  }

  const injected = `${resource.codeinjection_head ?? ''}${resource.codeinjection_foot ?? ''}`;
  if (injected.length > 2000) {
    findings.push(
      finding(
        'code-injection-heavy',
        'info',
        `Code injection is ${injected.length} characters; heavy snippets slow pages and complicate SEO.`,
        null,
        injected.length,
      ),
    );
  }

  if (!resource.og_image || !resource.twitter_image) {
    findings.push(
      finding(
        'social-image-missing',
        'info',
        'No dedicated social image; shares fall back to the feature image.',
        'og_image',
        resource.og_image ?? null,
      ),
    );
  }

  if (published && resource.updated_at) {
    const ageDays = (Date.now() - new Date(resource.updated_at).getTime()) / (24 * 60 * 60 * 1000);
    if (ageDays > 365) {
      findings.push(
        finding(
          'content-stale',
          'info',
          'Not updated in over a year; a refresh pass can recover rankings.',
          null,
          resource.updated_at,
        ),
      );
    }
  }

  let score = 100;
  for (const item of findings) {
    score -= SCORE_COST[item.severity] ?? 0;
  }
  score = Math.max(0, Math.min(100, score));

  return {
    score,
    findings,
    stats: { words, headings, missingAlt, links, tags: tags.length },
  };
}
