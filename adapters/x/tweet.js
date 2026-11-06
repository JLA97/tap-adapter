export default {
  description: 'Fetch the rendered main post or X Article body and the first 10 visible comments from an X status or article page using the logged-in browser session.',
  args: [
    {
      name: 'url',
      default: 'https://x.com/trq212/article/2052809885763747935',
      description: 'X status or article URL to fetch, such as https://x.com/user/status/123 or https://x.com/user/article/123.',
    },
  ],
  output: {
    type: 'list',
    itemName: 'article',
    fields: {
      tweetId: {
        type: 'string',
        description: 'X tweet ID for the main post or article.',
        format: 'id',
        source: 'status URL in rendered X links',
        examples: ['2052809885763747935'],
      },
      authorName: {
        type: 'string',
        description: 'Display name of the main post author.',
        source: 'rendered author display name',
        nullable: true,
        examples: ['Thariq'],
      },
      authorHandle: {
        type: 'string',
        description: 'X handle of the main post author without the @ prefix.',
        source: 'rendered @handle',
        nullable: true,
        examples: ['trq212'],
      },
      title: {
        type: 'string',
        description: 'Article title when the main post is an X Article; empty for an ordinary post.',
        source: 'rendered article heading',
        nullable: true,
        examples: ['Using Claude Code: The Unreasonable Effectiveness of HTML'],
      },
      text: {
        type: 'string',
        description: 'Main post text or rendered X Article body text.',
        source: 'rendered article body / tweet text',
        examples: ['Markdown has become the dominant file format used by agents to communicate with us.'],
      },
      url: {
        type: 'string',
        description: 'Canonical X status URL for the main post or article.',
        format: 'url',
        source: 'rendered status URL',
      },
      comments: {
        type: 'array',
        description: 'First 10 visible reply comments under the main post, each with author, handle, text, URL, and reply relationship metadata.',
        items: {
          type: 'object',
          properties: {
            tweetId: {
              type: 'string',
              description: 'X tweet ID for this comment.',
              format: 'id',
            },
            authorName: {
              type: 'string',
              description: 'Display name of the comment author.',
            },
            authorHandle: {
              type: 'string',
              description: 'X handle of the comment author without the @ prefix.',
            },
            text: {
              type: 'string',
              description: 'Rendered comment text.',
            },
            url: {
              type: 'string',
              description: 'Canonical X status URL for this comment.',
              format: 'url',
            },
            inReplyToTweetId: {
              type: 'string',
              description: 'X tweet ID that this comment directly replies to.',
              format: 'id',
            },
            inReplyToAuthorHandle: {
              type: 'string',
              description: 'X handle of the account that this comment directly replies to, without the @ prefix.',
            },
            replyDepth: {
              type: 'integer',
              description: 'Reply depth relative to the main post: 1 means direct reply to the main post, 2 means reply to another comment.',
            },
          },
        },
        source: 'rendered reply tweet articles',
        nullable: true,
        examples: [[{ authorHandle: 'DanIsBuilding', inReplyToTweetId: '2052925157606568217', replyDepth: 1, text: 'Great summary.' }]],
      },
    },
  },
  columns: ['authorHandle', 'title', 'text', 'comments', 'url'],
  pipeline: [
    {
      "navigate": "${{ args.url }}"
    },
    {
      "evaluate": `(async () => {
        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
        const requestedUrl = \${{ JSON.stringify(args.url) }};
        if (!/^https:\\/\\/(?:www\\.)?(?:x|twitter)\\.com\\/[^/]+\\/(?:status|article)\\/\\d+/.test(requestedUrl)) throw new Error('X: expected a status or article URL.');
        const clean = value => (value || '').replace(/\\u00a0/g, ' ').replace(/[ \\t]+\\n/g, '\\n').trim();
        const linesOf = value => clean(value).split('\\n').map(line => line.trim()).filter(Boolean);
        const isCount = value => /^(\\d+(?:\\.\\d+)?[KMB]?|\\d+(?:,\\d{3})*)(\\s+(Views|replies|reposts|Likes|Bookmarks))?$/i.test(value);
        const isChromeLine = value => /^(To view keyboard shortcuts|View keyboard shortcuts|See new posts|Conversation|Post your reply|Reply|Relevant|View quotes|Want to publish your own Article\\?|Upgrade to Premium|Show more|Quote|Following|Follow|Exit)$/.test(value);
        const statusId = href => (href || '').match(/\\/status\\/(\\d+)/)?.[1] || '';
        const parseUser = article => {
          const lines = linesOf(article.querySelector('[data-testid="User-Name"]')?.innerText || '');
          const handleLine = lines.find(line => /^@[A-Za-z0-9_]{1,15}$/.test(line));
          const handleIndex = handleLine ? lines.indexOf(handleLine) : -1;
          return {
            authorName: handleIndex > 0 ? lines[handleIndex - 1] : '',
            authorHandle: handleLine ? handleLine.slice(1) : '',
          };
        };
        const articleStatusId = article => {
          const timestampLink = article.querySelector('a[href*="/status/"] time')?.closest('a');
          if (timestampLink) return statusId(timestampLink.getAttribute('href'));

          const hrefs = [...article.querySelectorAll('a[href*="/status/"]')].map(a => a.href || a.getAttribute('href') || '');
          const direct = hrefs.map(statusId).find(Boolean);
          return direct || '';
        };
        const canonicalUrl = (handle, id, fallback) => id && handle ? 'https://x.com/' + handle + '/status/' + id : fallback;
        const commentText = article => {
          const tweetTexts = [...article.querySelectorAll('[data-testid="tweetText"]')].map(el => clean(el.innerText)).filter(Boolean);
          if (tweetTexts.length) return tweetTexts[0];
          const lines = linesOf(article.innerText);
          const handleIndex = lines.findIndex(line => /^@[A-Za-z0-9_]{1,15}$/.test(line));
          if (handleIndex < 0) return '';
          let cursor = handleIndex + 1;
          while (lines[cursor] === '·' || /^\\d+[smhd]$/.test(lines[cursor] || '') || isChromeLine(lines[cursor] || '')) cursor++;
          return clean(lines.slice(cursor).filter(line => !isCount(line) && !isChromeLine(line)).join('\\n'));
        };
        const collectComments = (requestedId, commentsById) => {
          [...document.querySelectorAll('article[data-testid="tweet"]')].forEach(article => {
            const id = articleStatusId(article);
            if (!id || id === requestedId || commentsById.has(id)) return;
            const user = parseUser(article);
            const text = commentText(article);
            if (!text || !user.authorHandle) return;
            commentsById.set(id, {
              tweetId: id,
              authorName: user.authorName,
              authorHandle: user.authorHandle,
              text,
              url: canonicalUrl(user.authorHandle, id, ''),
              inReplyToTweetId: '',
              inReplyToAuthorHandle: '',
              replyDepth: 0, // Rendered reply order does not establish a direct parent.
            });
          });
        };
        const fetchCommentsFromApi = async tweetId => {
          try {
            const variables = {
              focalTweetId: tweetId,
              with_rux_injections: false,
              rankingMode: 'Relevance',
              includePromotedContent: true,
              withCommunity: true,
              withQuickPromoteEligibilityTweetFields: true,
              withBirdwatchNotes: true,
              withVoice: true,
            };
            const features = {
              rweb_video_screen_enabled: false,
              rweb_cashtags_enabled: true,
              profile_label_improvements_pcf_label_in_post_enabled: true,
              responsive_web_profile_redirect_enabled: false,
              rweb_tipjar_consumption_enabled: false,
              verified_phone_label_enabled: false,
              creator_subscriptions_tweet_preview_api_enabled: true,
              responsive_web_graphql_timeline_navigation_enabled: true,
              responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
              premium_content_api_read_enabled: false,
              communities_web_enable_tweet_community_results_fetch: true,
              c9s_tweet_anatomy_moderator_badge_enabled: true,
              responsive_web_grok_analyze_button_fetch_trends_enabled: false,
              responsive_web_grok_analyze_post_followups_enabled: true,
              rweb_cashtags_composer_attachment_enabled: true,
              responsive_web_jetfuel_frame: true,
              responsive_web_grok_share_attachment_enabled: true,
              responsive_web_grok_annotations_enabled: true,
              articles_preview_enabled: true,
              responsive_web_edit_tweet_api_enabled: true,
              graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
              view_counts_everywhere_api_enabled: true,
              longform_notetweets_consumption_enabled: true,
              responsive_web_twitter_article_tweet_consumption_enabled: true,
              content_disclosure_indicator_enabled: true,
              content_disclosure_ai_generated_indicator_enabled: true,
              responsive_web_grok_show_grok_translated_post: true,
              responsive_web_grok_analysis_button_from_backend: true,
              post_ctas_fetch_enabled: true,
              freedom_of_speech_not_reach_fetch_enabled: true,
              standardized_nudges_misinfo: true,
              tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
              longform_notetweets_rich_text_read_enabled: true,
              longform_notetweets_inline_media_enabled: false,
              responsive_web_grok_image_annotation_enabled: true,
              responsive_web_grok_imagine_annotation_enabled: true,
              responsive_web_grok_community_note_auto_translation_is_enabled: true,
              responsive_web_enhance_cards_enabled: false,
            };
            const fieldToggles = {
              withArticleRichContentState: true,
              withArticlePlainText: false,
              withArticleSummaryText: true,
              withArticleVoiceOver: true,
              withGrokAnalyze: false,
              withDisallowedReplyControls: false,
            };
            const apiUrl = 'https://x.com/i/api/graphql/_i0BBmP_dK_ZLFa2Y-ei9Q/TweetDetail?variables=' +
              encodeURIComponent(JSON.stringify(variables)) +
              '&features=' + encodeURIComponent(JSON.stringify(features)) +
              '&fieldToggles=' + encodeURIComponent(JSON.stringify(fieldToggles));
            const ct0 = document.cookie.match(/(?:^|; )ct0=([^;]+)/)?.[1] || '';
            const response = await fetch(apiUrl, {
              signal: AbortSignal.timeout(8000),
              credentials: 'include',
              headers: {
                authorization: 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
                'x-csrf-token': decodeURIComponent(ct0),
                'x-twitter-active-user': 'yes',
                'x-twitter-auth-type': 'OAuth2Session',
                'x-twitter-client-language': 'en',
              },
            });
            if (!response.ok) return [];
            const json = await response.json();
            const entries = json?.data?.threaded_conversation_with_injections_v2?.instructions
              ?.flatMap(instruction => instruction.entries || []) || [];
            const comments = [];
            const addTweet = tweet => {
              const result = tweet?.tweet_results?.result;
              const id = result?.rest_id;
              const user = result?.core?.user_results?.result?.core;
              const legacy = result?.legacy || {};
              const rawText = result?.legacy?.full_text || result?.note_tweet?.note_tweet_results?.result?.text || '';
              const text = clean(rawText.replace(/^(@[A-Za-z0-9_]{1,15}\\s+)+/, ''));
              if (!id || id === tweetId || !user?.screen_name || !text || comments.some(comment => comment.tweetId === id)) return;
              const inReplyToTweetId = legacy.in_reply_to_status_id_str || '';
              comments.push({
                tweetId: id,
                authorName: user.name || '',
                authorHandle: user.screen_name,
                text,
                url: canonicalUrl(user.screen_name, id, ''),
                inReplyToTweetId,
                inReplyToAuthorHandle: legacy.in_reply_to_screen_name || '',
                replyDepth: !inReplyToTweetId ? 0 : inReplyToTweetId === tweetId ? 1 : 2,
              });
            };
            entries.forEach(entry => {
              if (entry?.content?.itemContent) addTweet(entry.content.itemContent);
              (entry?.content?.items || []).forEach(item => addTweet(item?.item?.itemContent));
            });
            return comments.slice(0, 10);
          } catch {
            return [];
          }
        };

        const isArticle = /\\/article\\//.test(requestedUrl);
        // article URL 用 /article/<id>，status URL 用 /status/<id>；statusId 只认 /status/，这里兼容两种
        const requestedId = statusId(requestedUrl) || (requestedUrl.match(/\\/article\\/(\\d+)/) || [])[1] || '';

        if (isArticle) {
          // ===== Article 分支：article 本体不在 <article> 标签里，用专用 testid 提取 =====
          for (let i = 0; i < 24; i++) {
            if (document.querySelector('[data-testid="twitterArticleReadView"]') &&
                document.querySelector('[data-testid="twitter-article-title"]')) break;
            await sleep(500);
          }
          const readView = document.querySelector('[data-testid="twitterArticleReadView"]');
          if (!readView) throw new Error('X Article: reading view missing; check login, availability or page markup.');

          const title = clean(readView.querySelector('[data-testid="twitter-article-title"]')?.innerText || '');

          // 作者 handle：UserAvatar-Container-<handle>
          const authorAvatar = readView.querySelector('[data-testid^="UserAvatar-Container-"]');
          const authorHandle = authorAvatar?.getAttribute('data-testid')
            .replace('UserAvatar-Container-', '') || '';

          // 嵌入推文（article 本体正文里引用的推文）必须从正文和作者查找中剔除
          const embedded = [...readView.querySelectorAll('article[data-testid="tweet"], [data-testid="simpleTweet"]')];
          const embeddedSet = new Set(embedded);
          const inEmbedded = el => { let p = el; while (p) { if (embeddedSet.has(p)) return true; p = p.parentElement; } return false; };

          // 作者名：用 handle 反查 a[href="/<handle>"]，排除嵌入推文，取非 @handle 文本
          const authorName = authorHandle
            ? [...readView.querySelectorAll('a[href="/' + authorHandle + '"]')]
                .filter(a => !inEmbedded(a))
                .map(a => clean(a.innerText))
                .find(t => t && t !== '@' + authorHandle) || ''
            : '';

          // 正文：richView 文本剔除嵌入推文
          const richView = readView.querySelector('[data-testid="longformRichTextComponent"]') ||
                           readView.querySelector('[data-testid="twitterArticleRichTextView"]');
          let bodyText = richView?.innerText || '';
          embedded.forEach(el => { bodyText = bodyText.replace(el.innerText, ''); });
          bodyText = clean(bodyText.replace(/\\n{3,}/g, '\\n\\n'));

          if (!title || !bodyText) throw new Error('X Article: title/body missing or still loading.');
          const tweetId = requestedId;
          const url = canonicalUrl(authorHandle, tweetId, requestedUrl);
          const apiComments = await fetchCommentsFromApi(tweetId);

          return [{
            tweetId,
            authorName,
            authorHandle,
            title,
            text: bodyText,
            url,
            comments: apiComments.slice(0, 10),
          }];
        }

        // ===== Status 分支（原有逻辑）=====
        for (let i = 0; i < 24; i++) {
          const text = document.body.innerText || '';
          if ([...document.querySelectorAll('article[data-testid="tweet"]')].some(article => articleStatusId(article) === requestedId)) break;
          await sleep(500);
        }

        let mainArticle = [...document.querySelectorAll('article[data-testid="tweet"]')]
          .find(article => articleStatusId(article) === requestedId);
        if (!mainArticle) throw new Error('X post: requested post missing; refusing to substitute an unrelated post.');

        const mainUser = parseUser(mainArticle);
        const mainTweetTexts = [...mainArticle.querySelectorAll('[data-testid="tweetText"]')].map(el => clean(el.innerText)).filter(Boolean);
        const lines = linesOf(mainArticle.innerText);
        const handleIndex = lines.findIndex(line => /^@[A-Za-z0-9_]{1,15}$/.test(line));
        if (handleIndex < 1) throw new Error('X post: author metadata missing.');

        const authorHandle = mainUser.authorHandle || lines[handleIndex].slice(1);
        const authorName = mainUser.authorName || lines[handleIndex - 1];
        let cursor = handleIndex + 1;
        while (lines[cursor] === '·' || /^\\d+[smhd]$/.test(lines[cursor] || '') || isChromeLine(lines[cursor] || '')) cursor++;

        const title = mainTweetTexts.length ? '' : (lines[cursor] && !isCount(lines[cursor]) && !isChromeLine(lines[cursor]) ? lines[cursor++] : '');
        while (isCount(lines[cursor] || '') || isChromeLine(lines[cursor] || '')) cursor++;

        const stopIndex = lines.findIndex((line, index) => index > cursor && (
          line === 'Want to publish your own Article?' ||
          /^\\d{1,2}:\\d{2}\\s+[AP]M\\s+·/.test(line) ||
          line === 'Post your reply'
        ));
        const bodyLines = lines.slice(cursor, stopIndex > cursor ? stopIndex : undefined)
          .filter(line => !isChromeLine(line));
        const tweetId = articleStatusId(mainArticle) || requestedId;
        const url = canonicalUrl(authorHandle, tweetId, requestedUrl);
        const apiComments = await fetchCommentsFromApi(tweetId);
        const commentsById = new Map();
        if (!apiComments.length) {
          collectComments(tweetId, commentsById);
          const commentLoadDeadline = Date.now() + 7000;
          for (let i = 0; i < 40 && commentsById.size < 10 && Date.now() < commentLoadDeadline; i++) {
            window.scrollBy(0, Math.max(900, Math.floor(window.innerHeight * 0.85)));
            await sleep(350);
            collectComments(tweetId, commentsById);
          }
        }

        const mainText = mainTweetTexts.length ? clean(mainTweetTexts.join('\\n')) : clean(bodyLines.join('\\n'));
        if (!mainText) throw new Error('X post: requested post body missing.');
        return [{
          tweetId,
          authorName,
          authorHandle,
          title,
          text: mainText,
          url,
          comments: apiComments.length ? apiComments : [...commentsById.values()].slice(0, 10),
        }];
      })()`
    }
  ],
};
