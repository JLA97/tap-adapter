export default {
  description: 'Fetch article content (title, date, body) from an Anthropic engineering/research blog URL.',
  args: [
    { name: 'url', description: 'Full URL of the Anthropic blog article (e.g. https://www.anthropic.com/engineering/managed-agents).' },
  ],
  examples: [
    { description: 'Fetch an engineering article', args: { url: 'https://www.anthropic.com/engineering/managed-agents' } },
  ],
  output: {
    type: 'list',
    itemName: 'article',
    fields: {
      title: {
        type: 'string',
        description: 'Article title.',
      },
      date: {
        type: 'string',
        description: 'Publication date, e.g. "Published Apr 08, 2026".',
      },
      content: {
        type: 'string',
        description: 'Full article body in markdown format (headings as ##, code blocks fenced).',
      },
      url: {
        type: 'string',
        description: 'Canonical article URL.',
        format: 'url',
      },
    },
  },
  columns: ['title', 'date', 'url'],
  pipeline: [
    {
      "navigate": "${{ args.url }}"
    },
    {
      "evaluate": `(() => {
  const title = document.querySelector('h1')?.textContent.trim();
  const time = document.querySelector('main time');
  const date = time?.textContent.trim() || document.querySelector('[class*="HeroEngineering"][class*="date"]')?.textContent.trim().replace(/^Published\\s+/, '');
  const body = document.querySelector('[data-article-body], [class*="Body-module"]');
  if (!title || !date || !body || !Number.isFinite(Date.parse(date)))
    throw new Error('Anthropic article: title, date or body missing: ' + location.href);
  const parts = [];
  const visit = element => {
    const tag = element.tagName;
    const text = element.textContent.trim();
    if (/^H[2-6]$/.test(tag)) { if (text) parts.push('#'.repeat(Number(tag[1])) + ' ' + text); }
    else if (tag === 'PRE') { if (text) parts.push(String.fromCharCode(96).repeat(3) + '\\n' + text + '\\n' + String.fromCharCode(96).repeat(3)); }
    else if (tag === 'P') { if (text) parts.push(text); }
    else if (tag === 'UL' || tag === 'OL') {
      parts.push([...element.children].filter(x => x.tagName === 'LI').map((li,i) => (tag === 'OL' ? (i+1) + '. ' : '- ') + li.textContent.trim()).join('\\n'));
    } else if (tag === 'BLOCKQUOTE') { if (text) parts.push(text.split('\\n').map(line => '> ' + line).join('\\n')); }
    else if (tag === 'TABLE') {
      for (const row of element.querySelectorAll('tr')) parts.push('| ' + [...row.querySelectorAll('th,td')].map(cell => cell.textContent.trim()).join(' | ') + ' |');
    } else if (!['SCRIPT','STYLE','NAV','ASIDE'].includes(tag)) {
      for (const child of element.children) visit(child);
    }
  };
  for (const child of body.children) visit(child);
  const content = parts.filter(Boolean).join('\\n\\n');
  if (!content) throw new Error('Anthropic article: empty body: ' + location.href);
  return [{title,date,content,url:document.querySelector('link[rel="canonical"]')?.href || location.href}];
})()`
    }
  ],
};
