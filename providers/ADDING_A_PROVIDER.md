# Adding a provider

Every provider is a single `.mjs` file in `providers/`. Files starting with `_`
are shared modules and are not providers. The provider contract below is
**normative**: the scanner, the portal validators and the test suite rely on it,
and the suite rejects providers that break it.

## The contract

A provider file must default-export a plain object:

```js
export default {
  id: 'string',            // lowercase, unique identifier
  hosts: ['example.com'],  // literal hosts this provider owns
  keyword: undefined,      // optional: (url) => bool, host/suffix matcher
  detect: (entry) => ...,  // -> { url } | null, from a portal entry
  fetch: async (entry, ctx) => [...],  // -> postings (array)
  assertEntryAllowed: undefined,       // optional guard for dynamic hosts
};
```

### `id`
Short, lowercase, unique across `providers/`. Used by `integration: <id>` in
portals config and in scan history columns.

### `hosts` / `keyword`
The registry uses these to find a provider for a portal `url`.
- `hosts`: literal hostnames that map 1:1 to this provider
  (`'boards-api.greenhouse.io'`).
- `keyword(url)`: a function returning truthy when a URL belongs to the
  provider. Use it for dynamic hosts (e.g. any `*.myworkdayjobs.com`) with an
  **anchored, bounded suffix** — `url.endsWith('myworkdayjobs.com')` is not
  enough; use `hostOf(url)` and match the full host against the exact domain or
  `.<domain>`.

### `detect(entry)`
Given one portal entry, return the seed URL object `{ url }` to fetch, or `null`
to skip the entry. Constructed URLs are always `https://`. Prefer
`ctx`-independent pure URL construction — never fetch here.

### `fetch(entry, ctx)`
Return an array of postings. **This is the only place network access happens
and it must go through `ctx`** — never call the global `fetch`. Network calls
must pass `{ redirect: 'error' }` unless you are intentionally reading a
`Location` header in `manual` mode; redirects are **never** followed
automatically.

A posting is a plain object with at most:

| field            | meaning                                              |
| ---------------- | ---------------------------------------------------- |
| `title`          | job title (string; required, else the posting is dropped) |
| `url`            | directly viewable job URL (string; required)         |
| `company`        | hiring company                                      |
| `location`       | job location text                                   |
| `description`    | description / body text                             |
| `postedAt`       | publication timestamp text                          |
| `externalId`     | provider-native identifier                          |

Survive malformed responses: if the payload does not look like you expect,
return `[]` instead of throwing. Field helpers live in `providers/_util.mjs`
(`arrayOf`, `text`, `firstPresent`, `hostOf`, `hostMatchesSuffix`).

### `assertEntryAllowed(entry)` (for dynamic hosts, recommended)
When one provider covers many customer hosts (iCIMS, Workday, Jobvite), do not
accept arbitrary URLs. Validate `entry.url` with an anchored allowlist:
`hostMatchesSuffix(entry.url, ['icims.com'])`, and throw (the scan records an
error and skips the entry) when it does not match. This keeps the scanner from
ever fetching a host the provider author did not intend.

## Never

- Call global `fetch`, `http`, `https`, or `net` directly in a provider.
- Follow redirects (no `redirect: 'follow'`).
- Build URLs from raw user input without `encodeURIComponent`.
- Throw on malformed boards; return `[]`.

## Checklist

1. File named after `id` (`ashby.mjs` for id `ashby`).
2. Default-export the spec object.
3. `id` unique; verify with `npm run check:providers`.
4. All network via `ctx.fetchJson / ctx.fetchText / ctx.fetchResponse` with
   `redirect: 'error'`, or guarded manual redirect reads.
5. Malformed responses degrades to `[]`.
6. Matching uses bounded anchors for dynamic hosts; `assertEntryAllowed`
   enforces the allowlist.
7. Add a fixture-driven test under `tests/` using a recorder context that
   proves every `ctx` call carried `redirect: 'error'`.
8. `npm run lint`, `npm test`, and `npm run check:providers` all pass.