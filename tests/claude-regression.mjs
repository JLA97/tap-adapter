import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DOMParser as HTMLParser } from 'linkedom';
import articles from '../adapters/claude/articles.js';
import post from '../adapters/claude/post.js';

const paragraph = 'A substantive first paragraph explaining how developers build and evaluate customer experience agents.';
const article = (id, date = '2026-10-05', externalUrl = null) => ({
  _id: id, _type: 'blogPost', title: id, slug: externalUrl ? null : id,
  date, externalUrl, category: { name: 'Best practices' },
});
const fixtureDoc = {
  querySelector: selector => selector === 'h1' ? { textContent: 'Cresta article' }
    : selector === '.text-rich-text--article, .u-rich-text-blog'
      ? { querySelectorAll: () => [{ textContent: paragraph }] } : null,
};

async function run({ pages = [{ items: [article('cresta')], total: 1 }], limit = 20, days = 6,
  now = '2026-10-09T22:00:00+08:00', listingStatus = 200, detailStatus = 200,
  doc = fixtureDoc, readListing = async payload => payload } = {}) {
  const calls = [];
  class Clock extends Date { static now() { return Date.parse(now); } }
  const code = articles.pipeline.find(step => step.evaluate).evaluate
    .replace('${{ args.limit }}', JSON.stringify(limit)).replace('${{ args.days }}', JSON.stringify(days));
  const context = {
    document: new HTMLParser().parseFromString('<main><a class="ResourceCard" href="/resources/articles/old"><span>Jan 1, 2026</span><h3>Old</h3></a></main>', 'text/html'),
    location: { origin: 'https://claude.com' }, URL, AbortSignal, TextDecoderStream,
    Date: Clock, Intl, DOMParser: class { parseFromString() { return doc; } },
    fetch: async url => {
      calls.push(url);
      if (url.startsWith('/api/')) {
        const page = Number(new URL(url, 'https://claude.com').searchParams.get('page'));
        const payload = pages[Math.min(page - 1, pages.length - 1)];
        return { ok: listingStatus === 200, status: listingStatus, json: () => readListing(payload) };
      }
      return new Response('<fixture>', { status: detailStatus });
    },
  };
  const rows = await vm.runInNewContext(code, context);
  const detail = articles.pipeline.find(step => step.foreach).foreach.steps[0].evaluate;
  const items = await Promise.all(rows.map(item => vm.runInNewContext(detail.replace('${{ JSON.stringify(item) }}', JSON.stringify(item)), context)));
  return { items: JSON.parse(JSON.stringify(items)), calls };
}

test('Cresta is included in the original Friday weekly window with complete output fields', async () => {
  const { items } = await run();
  assert.equal(items.length, 1);
  assert.equal(items[0].publishedDate, 'October 5, 2026');
  assert.equal(items[0].url, 'https://claude.com/resources/articles/cresta');
  assert.equal(items[0].summary, paragraph);
  assert.deepEqual(Object.keys(items[0]).sort(), Object.keys(articles.output.fields).sort());
});

test('pagination includes listed external posts without requesting their remote details', async () => {
  const { items, calls } = await run({ limit: 4, pages: [
    { items: [article('a', '2026-10-08'), { ...article('external', '2026-10-07', 'https://example.com/post'), excerpt: paragraph }], total: 4 },
    { items: [article('b', '2026-10-06'), article('cresta')], total: 4 },
  ] });
  assert.equal(items.length, 4);
  assert.equal(calls.filter(url => url.startsWith('/api/')).length, 2);
  assert.ok(!calls.some(url => url.includes('example.com')));
});

test('Beijing calendar cutoff includes all Sunday even at the end of Friday', async () => {
  const { items } = await run({ now: '2026-10-09T23:59:59+08:00', pages: [{
    items: [article('future', '2026-10-10'), article('sunday', '2026-10-04'), article('previous', '2026-10-03')], total: 3,
  }] });
  assert.deepEqual(items.map(item => item.url.split('/').at(-1)), ['sunday']);
});

test('valid no-match week returns empty without requesting older details', async () => {
  const { items, calls } = await run({ pages: [{ items: [article('old', '2026-09-30')], total: 1 }] });
  assert.deepEqual(items, []);
  assert.equal(calls.length, 1);
});

test('listing HTTP errors and schema changes fail instead of returning a false empty week', async () => {
  await assert.rejects(run({ listingStatus: 503 }), /listing HTTP 503/);
  await assert.rejects(run({ pages: [{ changedItems: [], total: 1 }] }), /unexpected listing schema/);
  await assert.rejects(run({ pages: [{ items: [], total: 1 }] }), /pagination ended/);
  await assert.rejects(run({ pages: [{ items: [article('bad', '2026-02-30')], total: 1 }] }), /invalid publication date/);
});

test('retries a listing body error and identifies the failing page', async () => {
  let attempts = 0;
  const failOnce = async payload => {
    if (++attempts === 1) throw new Error('listing body timed out');
    return payload;
  };
  const { items } = await run({ readListing: failOnce });
  assert.equal(items.length, 1);
  assert.equal(attempts, 2);
  await assert.rejects(run({
    readListing: async () => { throw new Error('listing body timed out'); },
  }), /listing request failed: .*page=1.*listing body timed out/);
});

test('repeated pages or changed sort order fail instead of silently truncating', async () => {
  await assert.rejects(run({ pages: [{ items: [article('a')], total: 5 }] }), /pagination repeated/);
  await assert.rejects(run({ pages: [{ items: [article('a', '2026-10-05'), article('b', '2026-10-06')], total: 2 }] }), /no longer ordered/);
});

test('article HTTP errors and missing body fail instead of being discarded', async () => {
  await assert.rejects(run({ detailStatus: 403 }), /article request failed:.*HTTP 403/);
  await assert.rejects(run({ doc: { querySelector: () => null } }), /body\/title missing/);
});

test('invalid parameters fail and zero limit avoids all network access', async () => {
  await assert.rejects(run({ days: 0 }), /positive integer/);
  await assert.rejects(run({ limit: -1 }), /non-negative integer/);
  assert.deepEqual(await run({ limit: 0 }), { items: [], calls: [] });
});

const element = (tagName, textContent, children = []) => ({ tagName, textContent, children });
function postDoc({ jsonld = true, body = true } = {}) {
  return {
    querySelector: selector => selector === 'h1' ? { textContent: 'Cresta article' } : null,
    querySelectorAll: selector => {
      if (selector === 'script[type="application/ld+json"]') return jsonld
        ? [{ textContent: JSON.stringify({ '@graph': [{ '@type': 'BlogPosting', datePublished: '2026-10-05' }] }) }] : [];
      if (selector.includes('text-caption')) return [
        { textContent: 'Category', nextElementSibling: { textContent: 'Best practices' } },
        { textContent: 'Date', nextElementSibling: { textContent: 'October 5, 2026' } },
      ];
      if (selector === '.text-rich-text--article, .u-rich-text-blog') return body ? [{ children: [
        element('P', paragraph), element('DIV', '', [element('H2', 'Evaluation'), element('P', 'Results')]),
      ] }] : [];
      return [];
    },
  };
}

test('post reads JSON-LD graph, new metadata and nested rich-text headings', () => {
  const [item] = vm.runInNewContext(post.pipeline.find(step => step.evaluate).evaluate, {
    document: postDoc(), location: { href: 'https://claude.com/resources/articles/cresta' }, Intl,
  });
  assert.equal(item.publishedDate, 'October 5, 2026');
  assert.equal(item.category, 'Best practices');
  assert.ok(item.content.includes('## Evaluation\n\nResults'));
});

test('post supports metadata labels without JSON-LD and rejects a missing body', () => {
  const context = { document: postDoc({ jsonld: false }), location: { href: 'https://claude.com/blog/cresta' }, Intl };
  const [item] = vm.runInNewContext(post.pipeline.find(step => step.evaluate).evaluate, context);
  assert.equal(item.publishedDate, 'October 5, 2026');
  context.document = postDoc({ body: false });
  assert.throws(() => vm.runInNewContext(post.pipeline.find(step => step.evaluate).evaluate, context), /could not be parsed/);
});

const worker = articles.pipeline.find(step => step.foreach).foreach.steps[0].evaluate;
const detailItem = {
  title: 'Listed title', publishedDate: 'November 13, 2026', category: '',
  url: 'https://claude.com/resources/articles/building-always-on-agents', excerpt: '',
};
function readDetail(fetch) {
  const detail = worker.replace('${{ JSON.stringify(item) }}', JSON.stringify(detailItem));
  return vm.runInNewContext(detail, {
    DOMParser: HTMLParser, URL, AbortSignal, TextDecoderStream, fetch,
    location: { origin: 'https://claude.com' },
  });
}

test('reads the complete article when the hydration payload stalls', async () => {
  const summary = 'An article with enough text to use as a summary and an em dash—split across chunks.';
  const html = '<main><article><h1>Article title</h1><div class="text-rich-text--article"><p>' +
    summary + '</p></div></article>';
  const bytes = new TextEncoder().encode(html);
  const dash = bytes.indexOf(0xe2);
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, dash + 1));
      controller.enqueue(bytes.slice(dash + 1, -4));
      controller.enqueue(bytes.slice(-4));
      // The upstream stream stays open after the article's closing tag.
    },
    cancel() { cancelled = true; },
  });
  const result = await readDetail(async () => new Response(body));
  assert.equal(result.title, 'Article title');
  assert.equal(result.summary, summary);
  assert.equal(cancelled, true);
});

test('retries a detail body error and reports persistent failure with the article URL', async () => {
  let attempts = 0;
  const failBody = async () => {
    attempts++;
    return new Response(new ReadableStream({
      pull(controller) { controller.error(new Error('body stream timed out')); },
    }));
  };
  const result = await readDetail(async () => {
    if (attempts === 0) return failBody();
    return new Response('<h1>Article title</h1><div class="u-rich-text-blog"><p>' + paragraph + '</p></div>');
  });
  assert.equal(result.summary, paragraph);
  attempts = 0;
  await assert.rejects(readDetail(failBody), /article request failed: .*building-always-on-agents: body stream timed out/);
  assert.equal(attempts, 2);
});

test('a detail stream interrupted before the closing tag fails even when the partial response contains a paragraph', async () => {
  let attempts = 0;
  const bytes = new TextEncoder().encode('<main><article><h1>Article title</h1><div class="text-rich-text--article"><p>' + paragraph + '</p>');
  await assert.rejects(readDetail(async () => {
    attempts++;
    let sent = false;
    return new Response(new ReadableStream({
      pull(controller) {
        if (sent) controller.error(new Error('incomplete response'));
        else controller.enqueue(bytes);
        sent = true;
      },
    }));
  }), /article request failed: .*building-always-on-agents: incomplete response/);
  assert.equal(attempts, 2);
});
