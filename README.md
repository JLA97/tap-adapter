# tap-adapter

TAP adapter pack.

## Install

```bash
tap adapter install github:<owner>/tap-adapter
```


## Claude adapters

`tap claude articles --limit 20 --days 7` fetches local Claude articles from
the public paginated resource index. The old `/blog` routes redirect to
`/resources/articles`; external syndicated links in that index are excluded.
`days` includes today and the preceding Beijing calendar days. Summaries are
extracted from article bodies. HTTP errors, schema changes, and incomplete
pagination fail the command rather than masquerading as an empty week.

`tap claude post --url <article-url>` supports both redirected legacy URLs and
new resource URLs, using publication metadata and the current rich-text body.

Run adapter regressions with:

```bash
node --test tests/claude-regression.mjs
```
