export default {
  description: 'Fetch hot posts from a Reddit subreddit using Reddit page HTML with the logged-in browser session.',
  args: [
    { name: 'subreddit', required: true, description: 'Subreddit name without the r/ prefix.' },
    { name: 'limit', default: 30, description: 'Maximum number of posts to return.' },
  ],
  output: {
    type: 'list',
    itemName: 'post',
    fields: {
      rank: {
        type: 'integer',
        description: 'One-based rank among posts parsed from the page.',
        source: 'derived from DOM order',
        examples: [1],
      },
      title: {
        type: 'string',
        description: 'Post title.',
        source: 'shreddit-post[post-title]',
      },
      score: {
        type: 'integer',
        description: 'Post score.',
        unit: 'points',
        source: 'shreddit-post[score]',
      },
      comments: {
        type: 'integer',
        description: 'Comment count.',
        unit: 'comments',
        source: 'shreddit-post[comment-count]',
      },
      author: {
        type: 'string',
        description: 'Post author username.',
        source: 'shreddit-post[author]',
      },
      selftext: {
        type: 'string',
        description: 'Post body text preview when visible in the feed.',
        source: 'shreddit-post shreddit-post-text-body',
        nullable: true,
      },
      url: {
        type: 'string',
        description: 'Original Reddit post URL.',
        format: 'url',
        source: 'shreddit-post[permalink]',
      },
    },
  },
  columns: ['rank', 'title', 'score', 'comments', 'author', 'selftext', 'url'],
  pipeline: [
    {
      "navigate": "https://www.reddit.com/r/${{ args.subreddit }}/hot/"
    },
    {
      "evaluate": `(async () => {
        const requestedLimit = Number(\${{ args.limit }});
        if (!Number.isInteger(requestedLimit) || requestedLimit < 0) throw new Error('Reddit hot: invalid limit.');
        if (!requestedLimit) return [];
        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

        for (let i = 0; i < 20 && !document.querySelector('shreddit-feed, shreddit-post'); i += 1) {
          const bodyText = document.body?.innerText || '';
          if (bodyText.includes("You've been blocked by network security")) {
            throw new Error('Reddit rendered a network security block page. Open the TAP browser with "tap browser start", log in to Reddit, then retry.');
          }
          await sleep(500);
        }

        const normalizeText = text => (text || '').replace(/\\s+/g, ' ').trim();
        const toPost = post => {
          const permalink = post.getAttribute('permalink') || '';
          const body = normalizeText(
            post.querySelector('shreddit-post-text-body')?.innerText
            || post.querySelector('[slot="text-body"]')?.innerText
            || ''
          );
          return {
            title: post.getAttribute('post-title') || '',
            score: Number(post.getAttribute('score') || 0),
            comments: Number(post.getAttribute('comment-count') || 0),
            author: post.getAttribute('author') || '',
            selftext: body.slice(0, 150),
            url: permalink.startsWith('http') ? permalink : 'https://www.reddit.com' + permalink,
          };
        };

        const subreddit = '\${{ args.subreddit }}'.replace(/^r\\//i, '').trim();
        let nextUrl = '/svc/shreddit/community-more-posts/hot/?name=' + encodeURIComponent(subreddit);
        const seen = new Set();
        const results = [];

        const visitedPages = new Set();
        for (let page = 0; page < 100 && nextUrl && results.length < requestedLimit; page += 1) {
          if (visitedPages.has(nextUrl)) throw new Error('Reddit hot: repeated pagination cursor.');
          visitedPages.add(nextUrl);
          const before = results.length;
          const response = await fetch(nextUrl, {
            signal: AbortSignal.timeout(12000),
            credentials: 'include',
            headers: { Accept: 'text/html' },
          });
          const html = await response.text();
          if (!response.ok || html.includes("You've been blocked by network security")) {
            throw new Error('Reddit hot page request failed: HTTP ' + response.status + '. Open the TAP browser with "tap browser start", log in to Reddit, then retry.');
          }

          const doc = new DOMParser().parseFromString(html, 'text/html');
          for (const post of doc.querySelectorAll('shreddit-post')) {
            const id = post.getAttribute('id') || post.getAttribute('permalink') || post.getAttribute('post-title');
            if (!id || seen.has(id)) continue;
            seen.add(id);
            results.push(toPost(post));
            if (results.length >= requestedLimit) break;
          }

          if (!doc.querySelector('shreddit-post') && (page === 0 || doc.querySelector('faceplate-partial[slot="load-after"]'))) throw new Error('Reddit hot: partial page contained no posts; cannot infer an empty feed.');
          if (results.length === before) throw new Error('Reddit hot: pagination made no progress.');
          nextUrl = doc.querySelector('faceplate-partial[slot="load-after"][src*="community-more-posts"]')?.getAttribute('src') || '';
        }

        if (!results.length) {
          throw new Error('No reddit posts found in the page HTML. Confirm the subreddit page loaded and the browser session is logged in.');
        }

        if (nextUrl && results.length < requestedLimit) throw new Error('Reddit hot: pagination safety bound reached before limit.');
        return results.map((post, index) => ({rank:index + 1, ...post}));
      })()`
    }
  ],
};
