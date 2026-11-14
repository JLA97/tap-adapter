# tap-adapter

TAP adapter pack.

## Install

```bash
tap adapter install github:<owner>/tap-adapter
```

## Blog collection

- `tap claude articles --limit 20 --days 7` merges the resource page's featured
  cards with the public paginated category API. Featured posts are absent from
  that API, so the API alone is not a complete article list. Listed external
  links are retained with their source excerpts; local summaries come from
  article bodies. `days` counts Beijing calendar days including today.
- `tap anthropic articles` reads dated rows from the Engineering listing,
  expands all See more pages, validates the displayed total, deduplicates URLs,
  and sorts by publication date before applying `limit`. Both `/research/` and
  legacy `/engineering/` article paths are accepted. Its default limit is 20;
  use `--limit 30` or a larger value to retrieve older history. A limit that
  would truncate the newest publication week raises an error.
- `tap openai articles --category "Research,Engineering" --startDate YYYY-MM-DD
  --endDate YYYY-MM-DD --format json` reads the official news RSS directly,
  checks all category tags and deduplicates articles. Date ranges include
  whole Beijing/Taipei calendar days (UTC+8); the end day is inclusive.

Claude and OpenAI date-window queries fail with a suggested larger `--limit`
if matches exceed the cap, instead of silently returning an incomplete week.
Malformed pages/feeds, missing publication metadata, incomplete pagination,
and article retrieval errors fail the command rather than masquerading as an
empty week. Claude retries listing and detail requests once, including failures
while reading the response body. On resource pages, the adapter reads through
the closing article tag and extracts the summary without waiting for the rest
of the page. List and individual detail extraction run in separate pipeline
steps.

`tap claude post --url <article-url>` supports redirected legacy URLs and new
resource URLs. `tap anthropic article --url <article-url>` supports the current
semantic article body and date as well as the legacy body markup; it raises an
error if extraction fails rather than returning an empty successful article.

## Regression tests

```bash
npm ci
npm test
```

The fixture suite covers API-excluded featured posts, listed external posts,
pagination, research-path migration, changed markup, malformed feeds, HTTP
failures, retries, multi-category feeds, duplicate entries, limits and UTC+8
week boundaries. It does not make live network requests.


## Other adapter maintenance (2026-11-06)

- Simon's post reader supports standard articles, quotations, link-blog entries
  and releases even when the date is the first child. Atom summaries decode
  HTML entities. A feed that does not reach the requested date window raises
  a coverage error; use a shorter window or the site archive rather than
  treating a finite feed as complete history.
- Baoyu follows next-page links until the requested Beijing calendar-day
  window is complete, checks publication order and raises an error if a limit
  would truncate that window. Translation metadata recognises non-X original
  sources and labelled author values without relying on child positions.
- Reddit hot returns numeric ranks/scores/comment counts, detects repeated or
  stalled pagination and supports more than six pages. Thread extraction
  honours zero comment/depth values and rejects malformed comment listings.
  Nested Reddit `more` placeholders remain outside the documented contract.
- X preserves the installed Article reader in source control, matches ordinary
  posts by their own timestamp permalink and refuses unrelated post fallback.
  DOM-only reply parents are left empty with `replyDepth: 0` when the direct
  relationship cannot be established. Missing X/WeChat bodies raise an error;
  optional comments are still best effort and may contain fewer than ten.
- OpenAI/Claude detail extraction preserves code blocks; OpenAI also preserves
  list and table text. OpenAI publication metadata is read before related
  articles' timestamps, preventing a recommendation date from replacing the
  requested article's date.
