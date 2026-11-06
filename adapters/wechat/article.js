export default {
  description: 'Extract article metadata and body content from a WeChat Official Account article URL.',
  args: [
    {
      name: 'url',
      default: 'https://mp.weixin.qq.com/s/GhTOhZO_zj8NfR1vPmPVww',
      description: 'Full WeChat article URL from mp.weixin.qq.com, such as https://mp.weixin.qq.com/s/GhTOhZO_zj8NfR1vPmPVww.',
    },
  ],
  output: {
    type: 'list',
    itemName: 'article',
    fields: {
      title: {
        type: 'string',
        description: 'Article title shown on the WeChat article page.',
      },
      author: {
        type: 'string',
        description: 'WeChat Official Account display name.',
        nullable: true,
      },
      url: {
        type: 'string',
        description: 'Canonical article URL.',
        format: 'url',
      },
      bodyText: {
        type: 'string',
        description: 'Full rendered article body text.',
      },
    },
  },
  columns: ['title', 'author', 'url', 'bodyText'],
  examples: [
    { description: 'Fetch a WeChat article by URL', args: { url: 'https://mp.weixin.qq.com/s/GhTOhZO_zj8NfR1vPmPVww' } },
  ],
  pipeline: [
    {
      "navigate": "${{ args.url }}"
    },
    {
      "evaluate": `(async () => {
        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
        window.scrollTo(0, document.body.scrollHeight);
        await sleep(800);
        window.scrollTo(0, 0);
        await sleep(200);

        const text = selector => document.querySelector(selector)?.textContent?.trim() || '';
        const attr = (selector, name) => document.querySelector(selector)?.getAttribute(name) || '';
        const clean = value => (value || '')
          .replace(/\\u00a0/g, ' ')
          .replace(/[ \\t]+\\n/g, '\\n')
          .replace(/\\n{3,}/g, '\\n\\n')
          .trim();

        const content = document.querySelector('#js_content, .rich_media_content');
        if (!content) throw new Error('WeChat article: body missing; the article may be removed or require verification: ' + location.href);

        const title = text('#activity-name') || attr('meta[property="og:title"]', 'content') || document.title.replace(/\\s*$/, '');
        const canonical = document.querySelector('link[rel="canonical"]')?.href || window.location.href;

        const bodyText = clean(content.innerText || content.textContent || '');
        if (!title || !bodyText) throw new Error('WeChat article: title or rendered body is empty: ' + location.href);
        return [{
          title,
          author: text('#js_name'),
          url: canonical,
          bodyText,
        }];
      })()`
    }
  ],
};
