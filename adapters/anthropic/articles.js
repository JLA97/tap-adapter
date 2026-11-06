export default {
  description: 'Fetch engineering blog articles from anthropic.com with title, summary, date and link.',
  args: [
    { name: 'limit', default: 20, description: 'Maximum number of articles to return.' },
  ],
  output: {
    type: 'list',
    itemName: 'article',
    fields: {
      rank: {
        type: 'integer',
        description: 'One-based rank in the returned result set.',
      },
      title: {
        type: 'string',
        description: '文章标题。',
      },
      summary: {
        type: 'string',
        description: '内容梗概，取自文章正文首段。',
      },
      date: {
        type: 'string',
        description: '发布日期。',
        format: 'date',
      },
      url: {
        type: 'string',
        description: '原帖完整链接。',
        format: 'url',
      },
    },
  },
  columns: ['rank', 'title', 'date', 'summary', 'url'],
  pipeline: [
    {
      "navigate": "https://www.anthropic.com/engineering"
    },
    {
      "evaluate": `(async () => {
  const limit = Number(\${{ args.limit }});
  if (!Number.isInteger(limit) || limit < 0) throw new Error('Anthropic articles: limit must be a non-negative integer.');
  if (!limit) return [];
  const read = () => [...document.querySelectorAll('main article')].map(row => {
    const link = row.querySelector('h3 a[href], h2 a[href]');
    const time = row.querySelector('time');
    if (!link || !time) throw new Error('Anthropic articles: listing row title/date missing.');
    const url = new URL(link.getAttribute('href'), location.origin);
    if (url.origin !== location.origin || !/^\\/(research|engineering)\\/[^/]+\\/?$/.test(url.pathname))
      throw new Error('Anthropic articles: unexpected article URL: ' + url.href);
    const date = time.textContent.trim();
    const ts = Date.parse(date + ' 00:00:00 GMT');
    if (!/^[A-Z][a-z]{2} \\d{1,2}, \\d{4}$/.test(date) || !Number.isFinite(ts))
      throw new Error('Anthropic articles: invalid listing date: ' + date);
    return {title:link.textContent.trim(), date, url:url.href};
  });
  let rows = read();
  if (!rows.length) throw new Error('Anthropic articles: no listing rows found; cannot infer an empty week.');
  const label = [...document.querySelectorAll('main p')].find(x => x.textContent.trim().toUpperCase() === 'ARTICLES');
  const countText = label?.previousElementSibling?.textContent.trim();
  const total = countText && /^\\d+$/.test(countText) ? Number(countText) : null;
  for (let page = 0; page < 100; page++) {
    const more = [...document.querySelectorAll('main button')].find(x => /^(See|Load|Show) more$/i.test(x.textContent.trim()));
    if (!more) break;
    if (more.disabled) throw new Error('Anthropic articles: listing pagination is disabled.');
    const before = rows.length;
    more.click();
    const deadline = Date.now() + 5000;
    do {
      await new Promise(resolve => setTimeout(resolve, 100));
      rows = read();
    } while (rows.length <= before && Date.now() < deadline);
    if (rows.length <= before) throw new Error('Anthropic articles: pagination made no progress.');
    if (page === 99) throw new Error('Anthropic articles: pagination safety bound reached.');
  }
  rows = [...new Map(rows.map(row => [row.url, row])).values()]
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  if (total !== null && rows.length !== total)
    throw new Error('Anthropic articles: expected ' + total + ' articles but collected ' + rows.length + '.');
  // A cap may drop older weeks, but must never split the newest publication week.
  const week = date => { const d = new Date(date + ' 00:00:00 GMT'); return d.getTime() - d.getUTCDay() * 86400000; };
  if (rows.length > limit && week(rows[limit].date) === week(rows[0].date))
    throw new Error('Anthropic articles: newest week exceeds limit; rerun with --limit ' + rows.length + '.');
  return rows.slice(0, limit);
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
  const response = await fetch(article.url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('Anthropic articles: detail HTTP ' + response.status + ': ' + article.url);
  const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
  if (!doc.querySelector('h1')) throw new Error('Anthropic articles: detail title missing: ' + article.url);
  const body = doc.querySelector('[data-article-body], [class*="Body-module"]');
  if (!body) throw new Error('Anthropic articles: detail body missing: ' + article.url);
  const paragraphs = [...body.querySelectorAll('p')].map(p => p.textContent.trim());
  const summary = paragraphs.find(text => text.length > 80 && !/^(Published|Try Claude|Get started)/.test(text));
  if (!summary) throw new Error('Anthropic articles: detail summary missing: ' + article.url);
  return { rank: \${{ index + 1 }}, ...article, summary: summary.slice(0, 300) };
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
