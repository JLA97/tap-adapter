import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import{DOMParser}from'linkedom';
import simonPost from '../adapters/simonwillison/post.js';import simonList from '../adapters/simonwillison/articles.js';import baoyuPost from '../adapters/baoyu/article.js';import baoyuList from '../adapters/baoyu/articles.js';import hot from '../adapters/reddit/hot.js';import thread from '../adapters/reddit/thread.js';import wechat from '../adapters/wechat/article.js';import x from '../adapters/x/tweet.js';import openai from '../adapters/openai/article.js';import claude from '../adapters/claude/post.js';
const html=s=>new DOMParser().parseFromString('<html><body>'+s+'</body></html>','text/html');
const compile=(a,args={})=>a.pipeline.find(x=>x.evaluate).evaluate.replace(/\$\{\{(.+?)\}\}/g,(_,expr)=>Function('args',`return (${expr})`)(args));
const Clock=class extends Date{static now(){return Date.parse('2026-11-06T22:00:00+08:00');}};
function run(a,{source='',args={},fetch,document=html(source),Date:DateClass=Clock}={}){return vm.runInNewContext(compile(a,args),{document,DOMParser,URL,Intl,Date:DateClass,AbortSignal,fetch,location:{href:'https://baoyu.io/',origin:'https://baoyu.io'},window:{location:{href:'https://example.com/'},scrollTo(){},scrollBy(){},innerHeight:1000},setTimeout:fn=>setTimeout(fn,0)});}
test('Simon release content is read after its leading date rather than returning empty',()=>{
 const [p]=run(simonPost,{source:'<meta property="og:title" content="Release: plugin"><div class="entry entryPage"><p class="mobile-date-eyebrow">4th November 2026</p><div class="beat"><div>Release: plugin</div><p>Important bug fix details.</p></div><div class="entryFooter">Footer noise</div></div>'});assert.ok(p.content.includes('Important bug fix'));assert.ok(!p.content.includes('Footer noise'));
});
test('Simon quotes and normal article paragraphs are retained; missing bodies fail',()=>{
 const [p]=run(simonPost,{source:'<meta property="og:title" content="Quote"><div class="entry entryPage"><p class="mobile-date">5th November 2026</p><div class="quote"><blockquote cite="https://example.com">A useful quotation.</blockquote><p class="cite">Author</p></div></div>'});assert.equal(p.type,'quote');assert.equal(p.sourceUrl,'https://example.com');assert.ok(p.content.includes('A useful quotation'));
 assert.throws(()=>run(simonPost),/entry missing/);
});
test('Simon finite feed detects insufficient history and decodes summary entities',()=>{
 const item=(id,date)=>`<entry><title>${id}</title><published>${date}</published><link rel="alternate" href="https://simonwillison.net/${id}/"/><summary>&lt;p&gt;Fish &amp;amp; chips&lt;/p&gt;</summary></entry>`;
 const document=new DOMParser().parseFromString('<feed>'+item('new','2026-11-05T00:00:00Z')+item('old','2026-10-20T00:00:00Z')+'</feed>','text/xml');
 const items=run(simonList,{document,args:{days:7,limit:50}});assert.equal(items.length,1);assert.equal(items[0].summary,'Fish & chips');
 assert.throws(()=>run(simonList,{document,args:{days:30,limit:50}}),/cannot cover/);assert.throws(()=>run(simonList,{args:{days:7,limit:50}}),/feed missing/);
});
const card=(id,date)=>`<article><h2>${id}</h2><p>Summary for ${id}</p><p>${date}</p><a href="blog/${id}"></a></article>`;
test('Baoyu follows next pages, preserves dates and includes the full first calendar day',async()=>{
 const source=card('first','November 6, 2026')+'<a aria-label="Go to next page" href="?page=2">Next</a>';
 const items=await run(baoyuList,{source,args:{days:6,limit:20},fetch:async()=>({ok:true,text:async()=>card('sunday','November 1, 2026')+card('old','October 31, 2026')})});assert.deepEqual(Array.from(items,p=>p.title),['first','sunday']);assert.equal(items[1].url,'https://baoyu.io/blog/sunday');
});
test('Baoyu distinguishes a quiet week from broken cards, capped windows and failed pagination',async()=>{
 assert.equal((await run(baoyuList,{source:card('old','October 20, 2026'),args:{days:7,limit:20}})).length,0);
 await assert.rejects(run(baoyuList,{args:{days:7,limit:20}}),/cards missing/);
 await assert.rejects(run(baoyuList,{source:card('a','November 6, 2026')+card('b','November 5, 2026'),args:{days:7,limit:1}}),/exceeds limit/);
 await assert.rejects(run(baoyuList,{source:card('a','November 6, 2026')+'<a rel="next" href="?page=2">Next</a>',args:{days:7,limit:20},fetch:async()=>({ok:false,status:503})}),/HTTP 503/);
});
test('Baoyu article reads non-X original sources and author values from labelled metadata',()=>{
 const [p]=run(baoyuPost,{source:'<article><a>Back</a><div><time datetime="2026-09-02"></time><time datetime="2026-09-02"></time><h1>Translation</h1><div><span>原文：</span><a href="https://claude.com/blog/original">Original title</a></div><div><span>作者：</span><div>Claude</div></div></div><div class="prose"><p>Complete body.</p></div></article>'});assert.equal(p.sourceUrl,'https://claude.com/blog/original');assert.equal(p.sourceTitle,'Original title');assert.equal(p.author,'Claude');assert.equal(p.translatedDate,'2026-09-02');assert.throws(()=>run(baoyuPost),/title\/body missing/);
});
const post=(id,title='Post')=>`<shreddit-post id="${id}" permalink="/r/test/comments/${id}/title/" post-title="${title}" author="someone" score="12" comment-count="4"><shreddit-post-text-body>Body</shreddit-post-text-body></shreddit-post>`;
test('Reddit hot produces integer rank/score/comment values and can paginate beyond six pages',async()=>{
 let calls=0;const rows=await run(hot,{source:'<shreddit-feed></shreddit-feed>',args:{subreddit:'test',limit:8},fetch:async()=>{calls++;return{ok:true,text:async()=>post('p'+calls)+(calls<8?`<faceplate-partial slot="load-after" src="/svc/shreddit/community-more-posts/hot/?page=${calls+1}"></faceplate-partial>`:'')};}});assert.equal(rows.length,8);assert.equal(calls,8);assert.equal(rows[0].rank,1);assert.equal(rows[0].score,12);assert.equal(rows[0].comments,4);
});
test('Reddit hot catches repeated cursors and treats zero limit as zero',async()=>{
 assert.equal((await run(hot,{args:{subreddit:'test',limit:0}})).length,0);
 await assert.rejects(run(hot,{source:'<shreddit-feed></shreddit-feed>',args:{subreddit:'test',limit:5},fetch:async()=>({ok:true,text:async()=>post('p')+'<faceplate-partial slot="load-after" src="/svc/shreddit/community-more-posts/hot/?name=test"></faceplate-partial>'})}),/repeated pagination/);
});
const threadPayload=[{data:{children:[{data:{id:'abc',title:'Thread',subreddit:'test',score:3}}]}},{data:{children:[{kind:'t1',data:{id:'c',body:'Comment'}}]}}];
test('Reddit thread respects zero comments and rejects malformed comment listings',async()=>{
 const args={url:'https://www.reddit.com/r/test/comments/abc/title/',commentLimit:0,depth:0};let url;
 const [p]=await run(thread,{args,fetch:async u=>{url=u;return{ok:true,json:async()=>threadPayload};}});assert.equal(p.comments.length,0);assert.ok(url.includes('depth=0'));
 await assert.rejects(run(thread,{args,fetch:async()=>({ok:true,json:async()=>threadPayload.slice(0,1)})}),/did not contain a post/);
});
test('WeChat removed/empty articles fail instead of returning successful empty content',async()=>{
 await assert.rejects(run(wechat),/body missing/);
 await assert.rejects(run(wechat,{source:'<h1 id="activity-name">Title</h1><div id="js_content"></div>'}),/body is empty/);
 const [p]=await run(wechat,{source:'<h1 id="activity-name">Title</h1><span id="js_name">Account</span><div id="js_content">Full body</div>'});assert.equal(p.bodyText,'Full body');
});
test('OpenAI detail retains list items, code blocks and table cells; broken pages fail',()=>{
 const [p]=run(openai,{source:'<main><time datetime="2026-10-23">Related article</time><h1>Article</h1><p class="text-meta">November 2, 2026</p><a href="/news/engineering/">Engineering</a><div data-toc-content><p>Intro</p><ul><li>Unique list detail</li></ul><pre>const a = 1;</pre><table><tr><td>Important cell</td></tr></table></div></main>'});assert.equal(p.date,'November 2, 2026');assert.ok(p.content.includes('- Unique list detail'));assert.ok(p.content.includes('```\nconst a = 1;\n```'));assert.ok(p.content.includes('| Important cell |'));assert.throws(()=>run(openai),/main content missing/);
});
test('Claude detail retains pre/code content rather than recursing into an empty code leaf',()=>{
 const [p]=run(claude,{source:'<h1>Article</h1><script type="application/ld+json">{"@type":"Article","datePublished":"2026-11-02"}</script><div class="u-rich-text-blog"><p>Intro</p><pre><code>uniqueCode()</code></pre></div>'});assert.ok(p.content.includes('```\nuniqueCode()\n```'));
});
test('X refuses to replace a requested missing post with another rendered tweet',async()=>{
 const source='<article data-testid="tweet"><a href="/someone/status/999"><time>Now</time></a></article>';
 await assert.rejects(run(x,{source,args:{url:'https://x.com/someone/status/123'}}),/requested post missing/);
});
test('X Article missing view fails explicitly rather than silently returning no content',async()=>{
 await assert.rejects(run(x,{args:{url:'https://x.com/person/article/123'}}),/reading view missing/);
});

test('X uses the main timestamp permalink instead of a quoted post and does not invent reply parents',async()=>{
 const source='<article data-testid="tweet"><a href="/quoted/status/999">Quoted post</a><div data-testid="User-Name"><div>Display</div><div>@person</div></div><a href="/person/status/123"><time>Now</time></a><div data-testid="tweetText">Requested body</div></article><article data-testid="tweet"><div data-testid="User-Name"><div>Reply</div><div>@reply</div></div><a href="/reply/status/456"><time>Now</time></a><div data-testid="tweetText">Rendered reply</div></article>';
 const [p]=await run(x,{source,args:{url:'https://x.com/person/status/123'},fetch:async()=>({ok:false})});assert.equal(p.tweetId,'123');assert.equal(p.text,'Requested body');assert.equal(p.comments.length,1);assert.equal(p.comments[0].inReplyToTweetId,'');assert.equal(p.comments[0].replyDepth,0);
});
