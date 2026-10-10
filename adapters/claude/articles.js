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
    { navigate: 'https://claude.com/resources/articles' },
    { evaluate: `
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
  let loaded = 0;
  let previousDate = Infinity;
  for (let page = 1; ; page++) {
    const response = await fetch('/api/resources/category?page=' + page + '&language=en&type=articles');
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
      if (item.externalUrl) continue;
      if (typeof item.slug !== 'string' || !item.slug) {
        throw new Error('Claude articles: local article has no slug: ' + item.title);
      }
      if (ts >= cutoff && ts <= end) {
        selected.push({
          title: item.title.trim(),
          publishedDate: dateFormat.format(new Date(ts)),
          category: item.category?.name || '',
          url: 'https://claude.com/resources/articles/' + encodeURIComponent(item.slug),
        });
      }
    }
    loaded += data.items.length;
    if (!added) throw new Error('Claude articles: pagination repeated a page.');
    if (selected.length >= limit || previousDate < cutoff || loaded >= data.total) break;
  }

  // Do not turn HTTP errors or changed body markup into an empty successful week.
  const result = [];
  const articles = selected.slice(0, limit);
  for (let offset = 0; offset < articles.length; offset += 4) {
    const batch = await Promise.all(articles.slice(offset, offset + 4).map(async (article) => {
      const response = await fetch(article.url);
      if (!response.ok) throw new Error('Claude articles: article HTTP ' + response.status + ': ' + article.url);
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      const rich = doc.querySelector('.text-rich-text--article, .u-rich-text-blog');
      const title = doc.querySelector('h1')?.textContent.trim();
      if (!rich || !title) throw new Error('Claude articles: article body/title missing: ' + article.url);
      const paragraph = [...rich.querySelectorAll('p')].map(p => p.textContent.trim()).find(text =>
        text.length > 40 && !/^(Thank|Oops|Try Claude|Download|Read more)/.test(text)
        && !text.includes('submission has been received'));
      if (!paragraph) throw new Error('Claude articles: substantive paragraph missing: ' + article.url);
      return { ...article, title, summary: paragraph.slice(0, 300) + (paragraph.length > 300 ? '...' : '') };
    }));
    result.push(...batch);
  }
  return result;
})()
    ` },
  ],
};
