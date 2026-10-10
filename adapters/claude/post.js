export default {
  description: 'Fetch full content of a single claude.com blog article given its URL.',
  args: [
    { name: 'url', default: '', description: 'Full URL of the blog article, e.g. https://claude.com/blog/new-in-claude-managed-agents' },
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
        description: 'Publication date (e.g. "May 6, 2026").',
        format: 'date',
      },
      category: {
        type: 'string',
        description: 'Blog category tag (e.g. Product announcements, Claude Code).',
        nullable: true,
      },
      content: {
        type: 'string',
        description: 'Full article body text with headings preserved as ## heading lines.',
      },
      url: {
        type: 'string',
        description: 'Canonical article URL.',
        format: 'url',
      },
    },
  },
  columns: ['title', 'publishedDate', 'category', 'content'],
  examples: [
    { description: 'Fetch a managed agents blog post', args: { url: 'https://claude.com/blog/new-in-claude-managed-agents' } },
    { description: 'Fetch a Claude Code blog post', args: { url: 'https://claude.com/blog/claude-code-best-practices' } },
  ],
  pipeline: [
    { navigate: '${{ args.url }}' },
    { evaluate: `
(() => {
  const title = document.querySelector('h1')?.textContent.trim() || '';
  const nodes = [];
  const collect = (value) => {
    if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') {
      nodes.push(value);
      if (value['@graph']) collect(value['@graph']);
    }
  };
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { collect(JSON.parse(script.textContent)); } catch { /* Try other metadata blocks. */ }
  }
  const metadata = nodes.find(n => [n['@type']].flat().some(t => t === 'BlogPosting' || t === 'Article'));
  const dateText = metadata?.datePublished;
  let publishedDate = '';
  if (dateText) {
    const date = new Date(dateText);
    if (!Number.isFinite(date.getTime())) throw new Error('Claude post: invalid datePublished.');
    publishedDate = new Intl.DateTimeFormat('en-US', {
      month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    }).format(date);
  }
  // Semantic caption/value pairs support both old Webflow and new resource pages.
  let category = '';
  for (const label of document.querySelectorAll('header .text-caption, .hero_blog_post_details_item .u-text-style-caption')) {
    const value = label.nextElementSibling?.textContent.trim() || '';
    if (label.textContent.trim() === 'Category') category = value;
    if (!publishedDate && label.textContent.trim() === 'Date') publishedDate = value;
  }
  if (!category) category = document.querySelector('a[href*="/blog/category/"]')?.textContent.trim() || '';

  const richTexts = [...document.querySelectorAll('.text-rich-text--article, .u-rich-text-blog')];
  const parts = [];
  const visit = (element) => {
    const tag = element.tagName;
    const text = element.textContent.trim();
    if (/^H[2-4]$/.test(tag)) {
      if (text) parts.push('#'.repeat(Number(tag[1])) + ' ' + text);
    } else if (tag === 'P') {
      if (text) parts.push(text);
    } else if (tag === 'UL' || tag === 'OL') {
      parts.push([...element.querySelectorAll('li')].map(li => '- ' + li.textContent.trim()).join('\\n'));
    } else if (tag === 'BLOCKQUOTE') {
      if (text) parts.push('> ' + text);
    } else if (tag === 'TABLE') {
      for (const row of element.querySelectorAll('tr')) {
        parts.push('| ' + [...row.querySelectorAll('th,td')].map(cell => cell.textContent.trim()).join(' | ') + ' |');
      }
    } else {
      // New rich text wraps tables and some text blocks in layout divs.
      for (const child of element.children) visit(child);
    }
  };
  for (const richText of richTexts) for (const child of richText.children) visit(child);
  const content = parts.filter(Boolean).join('\\n\\n');
  if (!title || !publishedDate || !content) {
    throw new Error('Claude post: article title, publication date, or body could not be parsed: ' + location.href);
  }
  return [{ title, publishedDate, category, content, url: location.href }];
})()
    ` },
  ],
};
