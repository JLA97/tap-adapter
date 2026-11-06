export default {
  description: 'Fetch a single blog post\'s content from simonwillison.net given its URL.',
  args: [
    { name: 'url', default: '', description: 'Full URL of the blog post, e.g. https://simonwillison.net/2026/May/9/luke-curley/' },
  ],
  output: {
    type: 'list',
    itemName: 'post',
    fields: {
      title: { type: 'string', description: 'Article title.' },
      url: { type: 'string', description: 'Canonical article URL.', format: 'url' },
      date: { type: 'string', description: 'Publication date.', format: 'date' },
      type: { type: 'string', description: 'Post type: "article" or "quote".' },
      content: { type: 'string', description: 'Full text content of the blog post.' },
      sourceUrl: { type: 'string', description: 'Quote source URL (quote posts only, empty for articles).', format: 'url', nullable: true },
      tags: { type: 'array', description: 'Tags associated with the post.' },
    },
  },
  columns: ['title', 'date', 'type', 'tags'],
  examples: [
    { description: 'Fetch a quote post', args: { url: 'https://simonwillison.net/2026/May/9/luke-curley/' } },
    { description: 'Fetch an article', args: { url: 'https://simonwillison.net/2026/May/7/xai-anthropic/' } },
  ],
  pipeline: [
    {
      "navigate": "${{ args.url }}"
    },
    {
      "evaluate": `(() => {
  const entry = document.querySelector('.entry.entryPage');
  if (!entry) throw new Error('Simon post: entry missing; check the URL or page markup.');
  const title = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || entry.querySelector('h2, h1, .beat-title')?.textContent.trim() || '';
  const date = entry.querySelector('.mobile-date, .mobile-date-eyebrow')?.textContent.trim() || '';
  const tags = [...new Set([...document.querySelectorAll('a[rel="tag"]')].map(x => x.textContent.trim().split('\\n')[0].trim()))];
  const quote = entry.querySelector('.quote');
  const sourceUrl = quote?.querySelector('blockquote')?.getAttribute('cite') || quote?.querySelector('.cite a[href]')?.href || '';
  // Dates can be the first child; release, link-blog and quote bodies are siblings.
  const copy = entry.cloneNode(true);
  for (const el of copy.querySelectorAll('.mobile-date, .mobile-date-eyebrow, .entryFooter, .edit-page-link, script, style')) el.remove();
  const heading = copy.querySelector('h2, h1');
  if (heading?.textContent.trim() === title) heading.remove();
  const content = [...copy.children].map(x => (x.innerText || x.textContent || '').trim()).filter(Boolean).join('\\n\\n');
  if (!title || !date || !content) throw new Error('Simon post: title, date or body missing: ' + location.href);
  return [{title,url:document.querySelector('link[rel="canonical"]')?.href || location.href,date,type:quote?'quote':'article',content,sourceUrl,tags}];
})()
`
    }
  ],
};
