export default {
  description: 'Fetch a Reddit post body and the first top-level comments with their nested replies from Reddit using the browser session.',
  args: [
    {
      name: 'url',
      required: true,
      description: 'Full Reddit post URL, for example https://www.reddit.com/r/codex/comments/1t7r2us/claude_code_is_not_on_the_same_level_as_codex/.',
    },
    {
      name: 'commentLimit',
      default: 20,
      description: 'Maximum number of top-level comments to return. Nested replies under those comments are included when present in Reddit JSON.',
    },
    {
      name: 'depth',
      default: 10,
      description: 'Maximum comment nesting depth requested from Reddit JSON.',
    },
  ],
  output: {
    type: 'list',
    itemName: 'thread',
    fields: {
      postId: {
        type: 'string',
        description: 'Reddit base36 post ID.',
        format: 'id',
        source: '[0].data.children[0].data.id',
      },
      subreddit: {
        type: 'string',
        description: 'Subreddit name without the r/ prefix.',
        source: '[0].data.children[0].data.subreddit',
      },
      title: {
        type: 'string',
        description: 'Post title.',
        source: '[0].data.children[0].data.title',
      },
      author: {
        type: 'string',
        description: 'Post author username.',
        source: '[0].data.children[0].data.author',
      },
      selftext: {
        type: 'string',
        description: 'Markdown body text of the Reddit post. Empty for link posts or deleted content.',
        nullable: true,
        source: '[0].data.children[0].data.selftext',
      },
      score: {
        type: 'integer',
        description: 'Post score.',
        unit: 'points',
        source: '[0].data.children[0].data.score',
      },
      upvoteRatio: {
        type: 'number',
        description: 'Post upvote ratio from 0 to 1.',
        source: '[0].data.children[0].data.upvote_ratio',
      },
      commentCount: {
        type: 'integer',
        description: 'Total number of comments reported by Reddit for the post.',
        unit: 'comments',
        source: '[0].data.children[0].data.num_comments',
      },
      createdUtc: {
        type: 'integer',
        description: 'Post creation time as Unix seconds in UTC.',
        format: 'unix-seconds',
        source: '[0].data.children[0].data.created_utc',
      },
      url: {
        type: 'string',
        description: 'Canonical Reddit post URL.',
        format: 'url',
        source: '[0].data.children[0].data.permalink',
      },
      comments: {
        type: 'array',
        description: 'First top-level comments, each including nested replies returned by Reddit JSON. Reddit "more" placeholders are omitted.',
        source: '[1].data.children[]',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Reddit base36 comment ID.', format: 'id' },
            parentId: { type: 'string', description: 'Reddit parent fullname for the comment.', format: 'id' },
            author: { type: 'string', description: 'Comment author username.' },
            body: { type: 'string', description: 'Markdown body text of the comment.' },
            score: { type: 'integer', description: 'Comment score.', unit: 'points' },
            createdUtc: { type: 'integer', description: 'Comment creation time as Unix seconds in UTC.', format: 'unix-seconds' },
            permalink: { type: 'string', description: 'Reddit URL path for the comment.', format: 'url' },
            depth: { type: 'integer', description: 'Comment depth reported by Reddit; top-level comments are depth 0.', unit: 'levels' },
            replies: { type: 'array', description: 'Nested reply comments recursively returned by Reddit JSON.' },
          },
        },
      },
    },
  },
  columns: ['title', 'author', 'score', 'commentCount', 'selftext', 'comments', 'url'],
  examples: [
    {
      description: 'Fetch the first 20 top-level comments and nested replies from a Reddit thread.',
      args: {
        url: 'https://www.reddit.com/r/codex/comments/1t7r2us/claude_code_is_not_on_the_same_level_as_codex/',
      },
    },
    {
      description: 'Fetch only the first 3 top-level comments.',
      args: {
        url: 'https://www.reddit.com/r/codex/comments/1t7r2us/claude_code_is_not_on_the_same_level_as_codex/',
        commentLimit: 3,
      },
    },
  ],
  pipeline: [
    {
      "navigate": "https://www.reddit.com"
    },
    {
      "evaluate": `(async () => {
        const inputUrl = \${{ JSON.stringify(args.url) }}.trim();
        const commentLimit = Number(\${{ args.commentLimit }});
        const depth = Number(\${{ args.depth }});
        if (!Number.isInteger(commentLimit) || commentLimit < 0 || !Number.isInteger(depth) || depth < 0) throw new Error('Reddit thread: invalid commentLimit/depth.');
        if (!/^https:\\/\\/(?:www\\.|old\\.|new\\.)?reddit\\.com\\/r\\/[^/]+\\/comments\\/[^/]+/.test(inputUrl)) throw new Error('Reddit thread: expected a Reddit post URL.');
        const requestLimit = Math.max(commentLimit * 10, 100);
        const cleanInput = inputUrl.split('?')[0].split('#')[0].replace(/\\/+$/, '').replace(/\\.json$/, '');
        const jsonUrl = cleanInput + '/.json?limit=' + encodeURIComponent(requestLimit) + '&depth=' + encodeURIComponent(depth);

        const response = await fetch(jsonUrl, {
          signal: AbortSignal.timeout(12000),
          credentials: 'include',
          headers: {
            Accept: 'application/json',
            'User-Agent': 'tap-reddit-thread/1.0',
          },
        });
        if (!response.ok) {
          throw new Error('Reddit thread JSON request failed: HTTP ' + response.status + ' for ' + jsonUrl);
        }

        const payload = await response.json();
        const post = payload?.[0]?.data?.children?.[0]?.data;
        if (!post?.id || !post?.title || !Array.isArray(payload?.[1]?.data?.children)) {
          throw new Error('Reddit thread JSON did not contain a post at [0].data.children[0].data.');
        }

        const normalizePermalink = value => {
          if (!value) return '';
          return value.startsWith('http') ? value : 'https://www.reddit.com' + value;
        };

        const toComment = child => {
          if (!child || child.kind !== 't1' || !child.data) return null;
          const comment = child.data;
          const replyChildren = Array.isArray(comment.replies?.data?.children)
            ? comment.replies.data.children
            : [];

          return {
            id: comment.id || '',
            parentId: comment.parent_id || '',
            author: comment.author || '',
            body: comment.body || '',
            score: Number(comment.score || 0),
            createdUtc: Number(comment.created_utc || 0),
            permalink: normalizePermalink(comment.permalink || ''),
            depth: Number(comment.depth || 0),
            replies: replyChildren.map(toComment).filter(Boolean),
          };
        };

        const comments = (payload?.[1]?.data?.children || [])
          .filter(child => child?.kind === 't1')
          .slice(0, commentLimit)
          .map(toComment)
          .filter(Boolean);

        return [{
          postId: post.id || '',
          subreddit: post.subreddit || '',
          title: post.title || '',
          author: post.author || '',
          selftext: post.selftext || '',
          score: Number(post.score || 0),
          upvoteRatio: Number(post.upvote_ratio || 0),
          commentCount: Number(post.num_comments || 0),
          createdUtc: Number(post.created_utc || 0),
          url: normalizePermalink(post.permalink || inputUrl),
          comments,
        }];
      })()`
    },
    {
      "limit": 1
    }
  ],
};
