import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DOMParser } from 'linkedom';
import claude from '../adapters/claude/articles.js';
import anthropic from '../adapters/anthropic/articles.js';
import detail from '../adapters/anthropic/article.js';
import openai from '../adapters/openai/articles.js';
const paragraph='A substantive first paragraph about how infrastructure supports reliable agent workflows in production.';
const parse = html => new DOMParser().parseFromString(html,'text/html');
const clock = class extends Date { static now(){return Date.parse('2026-11-06T23:00:00+08:00');} };
const render = (code,args,item) => code.replace(/\$\{\{(.+?)\}\}/g,(_,expr)=>Function('args','item','index',`return (${expr})`)(args,item,0));
const evaluate = (adapter,{args={},document=parse('<main/>'),fetch,item}={}) => vm.runInNewContext(render(adapter.pipeline.find(x=>x.evaluate).evaluate,args,item), {document,Date:clock,Intl,URL,DOMParser,AbortSignal,fetch,location:{origin:'https://claude.com',href:'https://www.anthropic.com/research/new'},setTimeout:(fn)=>setTimeout(fn,0)});
const card=(slug='featured',date='Nov 5, 2026')=>`<a class="ResourceCard" href="/resources/articles/${slug}"><span>${date}</span><h3>${slug}</h3></a>`;
const entry=(id='api',date='2026-11-04',extra={})=>({_id:id,_type:'blogPost',title:id,slug:id,date,category:{name:'Product updates'},...extra});
function claudeRun({cards=card(),pages=[{items:[entry()],total:1}],limit=20,detailStatus=200}={}) {
 let calls=[];
 const fetch=async url=>{calls.push(url);if(url.startsWith('/api/')){const page=Number(new URL(url,'https://claude.com').searchParams.get('page'));return{ok:true,json:async()=>pages[Math.min(page-1,pages.length-1)]};}return{ok:detailStatus===200,status:detailStatus,text:async()=>`<h1>Full title</h1><div class="u-rich-text-blog"><p>${paragraph}</p></div>`};};
 return evaluate(claude,{args:{days:6,limit},document:parse('<main>'+cards+'</main>'),fetch}).then(async rows=>{const worker=claude.pipeline.find(x=>x.foreach).foreach.steps[0].evaluate; const items=await Promise.all(rows.map(item=>vm.runInNewContext(render(worker,{},item),{DOMParser,URL,AbortSignal,location:{origin:'https://claude.com'},fetch})));return {items:JSON.parse(JSON.stringify(items)),calls};});
}
test('Claude merges API-excluded featured articles and deduplicates visible/API overlap',async()=>{
 const {items}=await claudeRun({cards:card()+card('api','Nov 4, 2026')});
 assert.equal(items.length,2);assert.ok(items.some(x=>x.url.endsWith('/featured')));
 assert.deepEqual(Object.keys(items[0]).sort(),Object.keys(claude.output.fields).sort());
});
test('Claude keeps listed external articles and follows API pagination',async()=>{
 const pages=[{items:[entry('external','2026-11-05',{externalUrl:'https://example.com/post',excerpt:paragraph,slug:null})],total:2},{items:[entry()],total:2}];
 const {items,calls}=await claudeRun({pages});assert.equal(items.length,3);assert.ok(items.some(x=>x.url==='https://example.com/post'));assert.equal(calls.filter(x=>x.startsWith('/api/')).length,2);assert.ok(!calls.includes('https://example.com/post'));
});
test('Claude includes Sunday, rejects a changed DOM and fails loudly on detail errors',async()=>{
 const {items}=await claudeRun({cards:card('sun','Nov 1, 2026'),pages:[{items:[entry('old','2026-10-31')],total:1}]});assert.equal(items.length,1);
 await assert.rejects(claudeRun({cards:''}),/cards missing/);
 await assert.rejects(claudeRun({detailStatus:503}),/HTTP 503/);
 await assert.rejects(claudeRun({limit:1}),/matches exceed limit/);
});
const row=(id,date='Nov 5, 2026',prefix='research')=>`<article><time>${date}</time><h3><a href="/${prefix}/${id}">${id}</a></h3></article>`;
const anthDoc=(rows,total)=>parse(`<main>01/03<div><p>${total}</p><p>ARTICLES</p></div>${rows}</main>`);
const anthRun=(doc,limit=20)=>evaluate(anthropic,{document:doc,args:{limit}});
test('Anthropic accepts new research paths and old engineering paths, deduplicates and sorts dates',async()=>{
 const items=await anthRun(anthDoc(row('old','Oct 13, 2026','engineering')+row('new')+row('new'),2));assert.equal(items.length,2);assert.equal(items[0].title,'new');
});
test('Anthropic expands See more rather than collecting only the initial page',async()=>{
 const doc=anthDoc(row('a'),3);const more=doc.createElement('button');more.textContent='See more';doc.querySelector('main').append(more);
 more.click=()=>{more.insertAdjacentHTML('beforebegin',row('b')+row('c'));more.remove();};
 assert.equal((await anthRun(doc)).length,3);
});
test('Anthropic detects empty rows, missing dates and incomplete totals',async()=>{
 await assert.rejects(anthRun(anthDoc('',27)),/no listing rows/);
 await assert.rejects(anthRun(anthDoc(row('a').replace('<time>Nov 5, 2026</time>',''),1)),/title\/date missing/);
 await assert.rejects(anthRun(anthDoc(row('a'),2)),/expected 2/);
 await assert.rejects(anthRun(anthDoc(row('a')+row('b'),2),1),/newest week exceeds/);
});
test('Anthropic summary fetch fails on HTTP/body changes instead of dropping entries',async()=>{
 const code=anthropic.pipeline[2].foreach.steps[0].evaluate;
 const run=async(ok,html)=>vm.runInNewContext(render(code,{}, {title:'new',date:'Nov 5, 2026',url:'https://www.anthropic.com/research/new'}),{DOMParser,AbortSignal,fetch:async()=>({ok,status:503,text:async()=>html})});
 const x=await run(true,`<main><h1>New</h1><p>Update notice outside body</p><div data-article-body><p>${paragraph}</p></div></main>`);assert.equal(x.summary,paragraph);assert.equal(x.rank,1);
 await assert.rejects(run(false,''),/HTTP 503/);await assert.rejects(run(true,'<h1>New</h1>'),/body missing/);
});
test('Anthropic detail preserves nested headings, fenced code and lists without repeating paragraphs',()=>{
 const doc=parse('<main><article><h1>New</h1><time datetime="2026-11-05">Nov 5, 2026</time><div data-article-body><div><h3>Mechanism</h3><p>One paragraph</p><pre>const x = 1;</pre><ul><li>Item</li></ul></div></div></article></main>');
 const [x]=evaluate(detail,{document:doc});assert.ok(x.content.includes('### Mechanism'));assert.ok(x.content.includes('```\nconst x = 1;\n```'));assert.equal(x.content.split('One paragraph').length,2);assert.ok(x.content.includes('- Item'));
 assert.throws(()=>evaluate(detail,{document:parse('<h1>Empty</h1>')}),/title, date or body missing/);
});
const rssItem=(title,date,cats=['Engineering'])=>`<item><title>${title}</title><pubDate>${date}</pubDate><link>https://openai.com/index/${title}</link><description>${paragraph}</description>${cats.map(x=>`<category>${x}</category>`).join('')}</item>`;
const rss=items=>new DOMParser().parseFromString(`<rss><channel>${items}</channel></rss>`,'text/xml');
const openRun=(doc,args={})=>evaluate(openai,{document:doc,args:{limit:20,days:6,startDate:'2026-11-01',endDate:'2026-11-07',category:'Research,Engineering',...args}});
test('OpenAI includes Sunday 00:00 Taipei, excludes next Sunday and matches any category',()=>{
 const doc=rss(rssItem('sun','Sat, 31 Oct 2026 16:00:00 GMT',['Company','Research'])+rssItem('before','Sat, 31 Oct 2026 15:59:59 GMT')+rssItem('sat','Sat, 07 Nov 2026 15:59:59 GMT')+rssItem('after','Sat, 07 Nov 2026 16:00:00 GMT'));
 const x=openRun(doc);assert.deepEqual(Array.from(x,item=>item.title),['sat','sun']);assert.equal(x[1].category,'Research');
});
test('OpenAI deduplicates repeated entries and rejects an incomplete limited date window',()=>{
 const doc=rss(rssItem('a','Mon, 02 Nov 2026 09:00:00 GMT').repeat(2));assert.equal(openRun(doc).length,1);
 assert.throws(()=>openRun(rss(rssItem('a','Mon, 02 Nov 2026 09:00:00 GMT')+rssItem('b','Mon, 02 Nov 2026 10:00:00 GMT')),{limit:1}),/matches exceed limit/);
});
test('OpenAI rejects malformed feeds, invalid/missing dates and reversed ranges',()=>{
 assert.throws(()=>openRun(parse('<h1>Access denied</h1>')),/RSS missing/);
 assert.throws(()=>openRun(rss('')),/no entries/);
 assert.throws(()=>openRun(rss(rssItem('a','invalid'))),/publication date/);
 assert.throws(()=>openRun(rss(''),{startDate:'2026-02-30'}),/invalid calendar/);
 assert.throws(()=>openRun(rss(''),{startDate:'2026-11-08'}),/must not exceed/);
 assert.throws(()=>openRun(rss(''),{endDate:''}),/provide both/);
});
test('OpenAI distinguishes a valid no-match week from a failed feed',()=>{
 assert.equal(openRun(rss(rssItem('old','Mon, 26 Oct 2026 09:00:00 GMT'))).length,0);
});

test('Claude retries a transient detail failure and reports a persistent failure with its URL',async()=>{
 const worker=claude.pipeline.find(x=>x.foreach).foreach.steps[0].evaluate;
 const item={title:'Retry',publishedDate:'November 5, 2026',category:'',url:'https://claude.com/resources/articles/retry',excerpt:''};
 let calls=0;
 const context={DOMParser,URL,AbortSignal,location:{origin:'https://claude.com'},fetch:async()=>{if(++calls===1)throw new Error('network timed out');return{ok:true,text:async()=>`<h1>Retry</h1><div class="u-rich-text-blog"><p>${paragraph}</p></div>`};}};
 const result=await vm.runInNewContext(render(worker,{},item),context);assert.equal(calls,2);assert.equal(result.summary,paragraph);
});
