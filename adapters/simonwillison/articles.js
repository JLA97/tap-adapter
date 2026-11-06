export default {
  description: "Fetch recent articles from Simon Willison blog feed.",
  args: [
    { name: 'days', default: 7, description: 'Number of recent days to include.' },
    { name: 'limit', default: 50, description: 'Maximum number of articles to return.' },
  ],
  output: {
    type: 'list',
    itemName: 'article',
    fields: {
      title:     { type: 'string', description: 'Article title.' },
      url:       { type: 'string', description: 'Canonical article URL.', format: 'url' },
      published: { type: 'string', description: 'Publication date and time.', format: 'iso8601' },
      summary:   { type: 'string', description: 'Article summary as plain text (HTML stripped), up to 800 chars.' },
    },
  },
  columns: ['title', 'url', 'published', 'summary'],
  pipeline: [
    {
      "navigate": "https://simonwillison.net/atom/everything/"
    },
    {
      "evaluate": `(() => {
  const days = Number(\${{ args.days }}), limit = Number(\${{ args.limit }});
  if (!Number.isInteger(days) || days < 1 || !Number.isInteger(limit) || limit < 0) throw new Error('Simon articles: invalid days or limit.');
  if (!limit) return [];
  const entries = [...document.querySelectorAll('feed entry')];
  if (!entries.length || document.querySelector('parsererror')) throw new Error('Simon articles: Atom feed missing or malformed.');
  const cutoff = Date.now() - days * 86400000;
  let oldest = Infinity;
  const results = new Map();
  for (const entry of entries) {
    const published = entry.querySelector('published')?.textContent.trim() || entry.querySelector('updated')?.textContent.trim();
    const timestamp = Date.parse(published);
    if (!Number.isFinite(timestamp)) throw new Error('Simon articles: publication date missing or invalid.');
    oldest = Math.min(oldest, timestamp);
    if (timestamp < cutoff || timestamp > Date.now()) continue;
    const title = entry.querySelector('title')?.textContent.trim();
    const href = entry.querySelector('link[rel="alternate"]')?.getAttribute('href') || entry.querySelector('link')?.getAttribute('href');
    if (!title || !href) throw new Error('Simon articles: entry title/URL missing.');
    const url = new URL(href, 'https://simonwillison.net'); url.hash = '';
    const raw = entry.querySelector('summary')?.textContent || entry.querySelector('content')?.textContent || '';
    const html = new DOMParser().parseFromString('<html><body>'+raw+'</body></html>', 'text/html');
    const summary = html.body.textContent.replace(/\\s+/g,' ').trim().slice(0,800);
    results.set(url.href,{title,url:url.href,published,summary});
  }
  if (oldest > cutoff) throw new Error('Simon articles: the finite Atom feed starts at ' + new Date(oldest).toISOString() + ' and cannot cover --days ' + days + '; use a shorter window or the site archive.');
  const items = [...results.values()].sort((a,b)=>Date.parse(b.published)-Date.parse(a.published));
  if (items.length > limit) throw new Error('Simon articles: '+items.length+' matches exceed limit; rerun with --limit '+items.length+'.');
  return items;
})()
`
    }
  ],
};
