export default {
  description: 'Extract article metadata and body text from a baoyu.io blog URL.',
  args: [
    { name: 'url', default: '', description: 'Full URL of the baoyu.io article, e.g. https://baoyu.io/translations/2026-05-10/slug' },
  ],
  output: {
    type: 'list',
    itemName: 'article',
    fields: {
      title: {
        type: 'string',
        description: 'Article title.',
      },
      author: {
        type: 'string',
        description: 'Original article author.',
      },
      publishedDate: {
        type: 'string',
        description: 'Publish date on baoyu.io.',
        format: 'date',
      },
      translatedDate: {
        type: 'string',
        description: 'Original translation date.',
        format: 'date',
      },
      sourceUrl: {
        type: 'string',
        description: 'Original source URL (usually X/Twitter).',
        format: 'url',
      },
      sourceTitle: {
        type: 'string',
        description: 'Original article title.',
      },
      bodyText: {
        type: 'string',
        description: 'Full article body text.',
      },
    },
  },
  columns: ['title', 'author', 'publishedDate', 'sourceTitle', 'bodyText'],
  pipeline: [
    {
      "navigate": "${{ args.url }}"
    },
    {
      "evaluate": `(() => {
  const article = document.querySelector('article'), heading = article?.querySelector('h1');
  const prose = article?.querySelector('.prose');
  if (!heading || !prose) throw new Error('Baoyu article: title/body missing: '+location.href);
  const header = heading.parentElement;
  const times = header.querySelectorAll('time');
  const publishedDate = times[0]?.getAttribute('datetime') || article.querySelector('time')?.getAttribute('datetime') || '';
  const translatedDate = times[1]?.getAttribute('datetime') || '';
  const sourceRow = [...header.querySelectorAll('span')].find(x=>/^(原文|Original)([：:]|$)/i.test(x.textContent.trim()))?.parentElement;
  const sourceLink = sourceRow?.querySelector('a[href]');
  const authorLabel = [...header.querySelectorAll('span')].find(x=>/^(作者|Author)[：:]?$/i.test(x.textContent.trim()));
  const author = authorLabel?.nextElementSibling?.textContent.trim() || '';
  const bodyText = (prose.innerText || prose.textContent || '').trim();
  if (!publishedDate || !Number.isFinite(Date.parse(publishedDate)) || !bodyText) throw new Error('Baoyu article: publication date/body invalid: '+location.href);
  return [{title:heading.textContent.trim(),author,publishedDate,translatedDate,sourceUrl:sourceLink?.href||'',sourceTitle:sourceLink?.textContent.trim()||'',bodyText}];
})()
`
    }
  ],
  examples: [
    { description: 'Fetch an article by URL', args: { url: 'https://baoyu.io/translations/2026-05-10/championswimmer-2051807284691612099' } },
  ],
};
