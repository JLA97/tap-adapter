export default {
  description: 'Fetch OpenAI news articles from the OpenAI news feed, defaulting to the Engineering category.',
  args: [
    { name: 'category', default: 'Engineering', description: 'Category filter, comma-separated (e.g., "Research,Engineering").' },
    { name: 'days', default: 7, description: 'Days to look back when no date range specified.' },
    { name: 'startDate', default: '', description: 'Start date YYYY-MM-DD. Provide both startDate and endDate to override days.' },
    { name: 'endDate', default: '', description: 'End date YYYY-MM-DD. Provide both startDate and endDate to override days.' },
    { name: 'limit', default: 20, description: 'Maximum number of items to return.' },
  ],
  output: {
    type: 'list',
    itemName: 'article',
    fields: {
      title: {
        type: 'string',
        description: 'Article title.',
      },
      publishDate: {
        type: 'string',
        description: 'Article publication date.',
        format: 'date',
      },
      url: {
        type: 'string',
        description: 'Original article URL.',
        format: 'url',
      },
      summary: {
        type: 'string',
        description: 'Article summary.',
      },
      category: {
        type: 'string',
        description: 'Article category (e.g., Engineering, Research).',
      },
    },
  },
  columns: ['title', 'publishDate', 'category', 'url', 'summary'],
  pipeline: [
    {
      "navigate": "https://openai.com/news/rss.xml"
    },
    {
      "evaluate": `(() => {
  const limit = Number(\${{ args.limit }});
  const days = Number(\${{ args.days }});
  const categories = \${{ JSON.stringify(args.category) }}.split(',').map(s => s.trim());
  const startText = \${{ JSON.stringify(args.startDate) }};
  const endText = \${{ JSON.stringify(args.endDate) }};
  if (!Number.isInteger(limit) || limit < 0) throw new Error('OpenAI articles: limit must be a non-negative integer.');
  if (!limit) return [];
  if (Boolean(startText) !== Boolean(endText)) throw new Error('OpenAI articles: provide both startDate and endDate.');
  const dateValue = value => {
    const timestamp = Date.parse(value + 'T00:00:00Z');
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(value) || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0,10) !== value)
      throw new Error('OpenAI articles: invalid calendar date: ' + value);
    return timestamp;
  };
  // User-facing calendar ranges use Beijing/Taipei UTC+8, including all Sunday.
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0,10);
  if (!startText && (!Number.isInteger(days) || days < 1)) throw new Error('OpenAI articles: days must be a positive integer.');
  const start = startText ? dateValue(startText) - 8 * 3600000 : dateValue(today) - (days - 1) * 86400000 - 8 * 3600000;
  const end = (endText ? dateValue(endText) : dateValue(today)) + 86400000 - 8 * 3600000;
  if (start >= end) throw new Error('OpenAI articles: startDate must not exceed endDate.');
  const feed = document.querySelector('rss channel');
  if (!feed || document.querySelector('parsererror')) throw new Error('OpenAI articles: RSS missing or malformed; cannot infer no articles.');
  const source = [...feed.querySelectorAll('item')];
  if (!source.length) throw new Error('OpenAI articles: RSS contains no entries.');
  const matches = new Map();
  for (const item of source) {
    const cats = [...item.querySelectorAll('category')].map(c => c.textContent.trim());
    const category = cats.find(cat => categories.includes(cat));
    if (!category) continue;
    const publishDate = item.querySelector('pubDate')?.textContent.trim();
    const ts = Date.parse(publishDate);
    if (!Number.isFinite(ts)) throw new Error('OpenAI articles: invalid publication date.');
    if (ts < start || ts >= end) continue;
    const title = item.querySelector('title')?.textContent.trim();
    const url = item.querySelector('link')?.textContent.trim();
    if (!title || !url || !/^https:\\/\\/openai.com\\//.test(url)) throw new Error('OpenAI articles: entry title/URL missing or invalid.');
    const summary = item.querySelector('description')?.textContent.trim() || '';
    matches.set(url.replace(/\\/$/, ''), {title,publishDate,url,summary,category});
  }
  const results = [...matches.values()].sort((a,b) => Date.parse(b.publishDate) - Date.parse(a.publishDate));
  if (results.length > limit) throw new Error('OpenAI articles: ' + results.length + ' matches exceed limit ' + limit + '; rerun with --limit ' + results.length + ' to avoid an incomplete date window.');
  return results;
})()`
    }
  ],
};
