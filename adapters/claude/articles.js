export default {
  description: 'Fetch recent local Claude blog articles from claude.com/resources/articles within a configurable time window, with content summaries extracted from each article page.',
  args: [
    { name: 'limit', default: 10, description: 'Maximum number of articles to return.' },
    { name: 'days', default: 7, description: 'Number of Beijing calendar days to include, counting today.' },
  ],
  output: {
    type: 'list',
    itemName: 'article',
    fields: {
      title: {
        type: 'string',
        description: 'Article title.',
      },
      publishedDate: {
        type: 'string',
        description: 'Article publication date (e.g. "April 14, 2026").',
        format: 'date',
      },
      category: {
        type: 'string',
        description: 'Blog category tag (e.g. Claude Code, Agents, Product announcements).',
        nullable: true,
      },
      summary: {
        type: 'string',
        description: 'First substantive paragraph of the article body, serving as a content overview.',
      },
      url: {
        type: 'string',
        description: 'Full URL to the original article.',
        format: 'url',
      },
    },
  },
  columns: ['title', 'publishedDate', 'category', 'summary'],
  pipeline: [
    {
      "navigate": "https://claude.com/resources/articles"
    },
    {
      "evaluate": `
(async () => {
  const days = Number(\${{ args.days }});
  const limit = Number(\${{ args.limit }});
  if (!Number.isInteger(days) || days < 1 || !Number.isInteger(limit) || limit < 0) {
    throw new Error('Claude articles: days must be a positive integer and limit a non-negative integer.');
  }
  if (limit === 0) return [];

  // Date-only source fields are compared as Beijing calendar days, inclusive.
  const today = new Date(Date.now() + 8 * 3600000);
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const cutoff = end - (days - 1) * 86400000;
  const dateFormat = new Intl.DateTimeFormat('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
  const parseDate = (date) => {
    const ts = typeof date === 'string' && /^\\d{4}-\\d{2}-\\d{2}$/.test(date)
      ? Date.parse(date + 'T00:00:00Z') : NaN;
    if (!Number.isFinite(ts) || new Date(ts).toISOString().slice(0, 10) !== date) {
      throw new Error('Claude articles: invalid publication date: ' + date);
    }
    return ts;
  };

  // The site's View more control uses this public, date-ordered JSON endpoint.
  // Keep local articles: the new index also syndicates external news/dev posts.
  const selected = [];
  const seen = new Set();
  // Featured cards are excluded from the category API; merge them before filtering.
  const byUrl = new Map();
  const cards = [...document.querySelectorAll('a[class*="ResourceCard"][href]')];
  if (!cards.length) throw new Error('Claude articles: resource cards missing; listing markup changed.');
  for (const card of cards) {
    const title = card.querySelector('h3')?.textContent.trim();
    const dateText = [...card.querySelectorAll('span, time')].map(x => x.textContent.trim())
      .find(x => /^[A-Z][a-z]{2} \\d{1,2}, \\d{4}$/.test(x));
    if (!title || !dateText) throw new Error('Claude articles: card title/date missing.');
    const ts = Date.parse(dateText + ' 00:00:00 GMT');
    const url = new URL(card.getAttribute('href'), location.origin).href;
    if (!Number.isFinite(ts)) throw new Error('Claude articles: invalid card date: ' + dateText);
    if (ts >= cutoff && ts <= end) byUrl.set(url, {
      title, publishedDate: dateFormat.format(new Date(ts)), category: '', url,
      excerpt: card.querySelector('p')?.textContent.trim() || '',
    });
  }
  let loaded = 0;
  let previousDate = Infinity;
  for (let page = 1; ; page++) {
    const listingUrl = '/api/resources/category?page=' + page + '&language=en&type=articles';
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { response = await fetch(listingUrl, { signal: AbortSignal.timeout(10000) }); break; }
      catch (error) { if (attempt === 1) throw new Error('Claude articles: listing request failed: ' + listingUrl + ': ' + error.message); }
    }
    if (!response.ok) throw new Error('Claude articles: listing HTTP ' + response.status + ' on page ' + page);
    const data = await response.json();
    if (!Array.isArray(data.items) || !Number.isInteger(data.total) || data.total < 0) {
      throw new Error('Claude articles: unexpected listing schema on page ' + page);
    }
    if (data.items.length === 0) {
      if (loaded < data.total) throw new Error('Claude articles: pagination ended before reported total.');
      break;
    }
    let added = 0;
    for (const item of data.items) {
      if (!item._id || !item.title || item._type !== 'blogPost') {
        throw new Error('Claude articles: missing article identity/title or unexpected content type.');
      }
      const ts = parseDate(item.date);
      if (ts > previousDate) throw new Error('Claude articles: listing is no longer ordered by publication date.');
      previousDate = ts;
      if (seen.has(item._id)) continue;
      seen.add(item._id);
      added++;

      if (!item.externalUrl && (typeof item.slug !== 'string' || !item.slug)) {
        throw new Error('Claude articles: local article has no slug: ' + item.title);
      }
      if (ts >= cutoff && ts <= end) {
        selected.push({
          title: item.title.trim(),
          publishedDate: dateFormat.format(new Date(ts)),
          category: item.category?.name || '',
          url: item.externalUrl || 'https://claude.com/resources/articles/' + encodeURIComponent(item.slug),
          excerpt: item.excerpt || '',
        });
      }
    }
    loaded += data.items.length;
    if (!added) throw new Error('Claude articles: pagination repeated a page.');
    if (previousDate < cutoff || loaded >= data.total) break;
  }

  // Do not turn HTTP errors or changed body markup into an empty successful week.
  for (const item of selected) byUrl.set(item.url, { ...byUrl.get(item.url), ...item });
  const articles = [...byUrl.values()].sort((a, b) => Date.parse(b.publishedDate) - Date.parse(a.publishedDate));
  if (articles.length > limit) throw new Error('Claude articles: ' + articles.length + ' matches exceed limit ' + limit + '; rerun with --limit ' + articles.length + ' to avoid an incomplete date window.');
  return articles;
})()`
    },
    {
      "foreach": {
        "as": "articles",
        "concurrency": 4,
        "steps": [
          {
            "evaluate": `(async () => {
  const article = \${{ JSON.stringify(item) }};
  const {excerpt, ...fields} = article;
  if (new URL(article.url).origin !== location.origin) {
    if (!excerpt) throw new Error('Claude articles: external article summary missing: ' + article.url);
    return { ...fields, summary: excerpt.slice(0, 300) };
  }
  let response;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await fetch(article.url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      break;
    } catch (error) {
      if (attempt === 1) throw new Error('Claude articles: article request failed: ' + article.url + ': ' + error.message);
    }
  }
  const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
  const rich = doc.querySelector('.text-rich-text--article, .u-rich-text-blog');
  const title = doc.querySelector('h1')?.textContent.trim();
  if (!rich || !title) throw new Error('Claude articles: article body/title missing: ' + article.url);
  const paragraph = [...rich.querySelectorAll('p')].map(p => p.textContent.trim()).find(text =>
    text.length > 40 && !/^(Thank|Oops|Try Claude|Download|Read more)/.test(text)
    && !text.includes('submission has been received'));
  if (!paragraph) throw new Error('Claude articles: substantive paragraph missing: ' + article.url);
  return { ...fields, title, summary: paragraph.slice(0, 300) + (paragraph.length > 300 ? '...' : '') };
})()`
          }
        ]
      }
    },
    {
      "select": {
        "from": "articles"
      }
    }
  ],
};
