export default {
  description: "Fetch recent Chinese-language articles from baoyu.io.",
  args: [
    { name: 'days', default: 7, description: 'Number of recent days to include.' },
    { name: 'limit', default: 20, description: 'Maximum number of articles to return.' },
  ],
  output: {
    type: 'list',
    itemName: 'article',
    fields: {
      title: {
        type: 'string',
        description: '文章标题',
      },
      url: {
        type: 'string',
        description: '文章原贴链接',
        format: 'url',
      },
      summary: {
        type: 'string',
        description: '文章梗概/摘要',
      },
      date: {
        type: 'string',
        description: '发布日期',
        format: 'date',
      },
    },
  },
  columns: ['title', 'url', 'summary', 'date'],
  pipeline: [
    {
      "navigate": "https://baoyu.io/"
    },
    {
      "evaluate": `(async () => {
  const days = Number(\${{ args.days }}), limit = Number(\${{ args.limit }});
  if (!Number.isInteger(days) || days < 1 || !Number.isInteger(limit) || limit < 0) throw new Error('Baoyu articles: invalid days or limit.');
  if (!limit) return [];
  const today = new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  const end = Date.parse(today+'T00:00:00Z');
  const cutoff = end-(days-1)*86400000;
  const seenPages = new Set(), results = new Map();
  let doc = document, pageUrl = location.href, previous = Infinity;
  for (let page=0;page<100;page++) {
    if (seenPages.has(pageUrl)) throw new Error('Baoyu articles: repeated pagination URL: '+pageUrl);
    seenPages.add(pageUrl);
    const rows = [...doc.querySelectorAll('article')];
    if (!rows.length) throw new Error('Baoyu articles: article cards missing; cannot infer no articles.');
    let added=0;
    for (const row of rows) {
      const title = row.querySelector('h2')?.textContent.trim(), link = row.querySelector('a[href]');
      const paragraphs = [...row.querySelectorAll('p')].map(x=>x.textContent.trim());
      const date = row.querySelector('time')?.getAttribute('datetime') || paragraphs.find(x=>/^[A-Z][a-z]+ \\d{1,2}, \\d{4}$/.test(x));
      const timestamp = /^\\d{4}-\\d{2}-\\d{2}$/.test(date) ? Date.parse(date+'T00:00:00Z') : Date.parse(date+' 00:00:00 GMT');
      if (!title || !link || !Number.isFinite(timestamp)) throw new Error('Baoyu articles: card title, date or URL missing.');
      if (timestamp>previous) throw new Error('Baoyu articles: listing is not ordered by publication date.');
      previous=timestamp;
      if (timestamp<cutoff || timestamp>end) continue;
      const url = new URL(link.getAttribute('href'), pageUrl).href;
      if (!results.has(url)) added++;
      results.set(url,{title,url,summary:paragraphs.find(x=>x!==date)||'',date});
      if (results.size>limit) throw new Error('Baoyu articles: date window exceeds limit '+limit+'; rerun with a larger --limit to avoid omissions.');
    }
    const next = doc.querySelector('a[rel="next"], a[aria-label="Go to next page"]');
    if (!next || previous<cutoff) return [...results.values()];
    const nextUrl = new URL(next.getAttribute('href'),pageUrl);
    if (nextUrl.origin!==location.origin) throw new Error('Baoyu articles: unexpected next-page origin.');
    if (!added && page>0 && previous>=cutoff) throw new Error('Baoyu articles: pagination made no progress.');
    const response=await fetch(nextUrl.href,{signal:AbortSignal.timeout(10000)});
    if (!response.ok) throw new Error('Baoyu articles: page HTTP '+response.status+': '+nextUrl.href);
    doc=new DOMParser().parseFromString(await response.text(),'text/html');pageUrl=nextUrl.href;
  }
  throw new Error('Baoyu articles: pagination safety bound reached before the date window was complete.');
})()
`
    }
  ],
};
