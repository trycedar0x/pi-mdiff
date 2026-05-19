# @trycedar/pi-mdiff

0.3.0 • Public • Published 4 minutes ago

- [Readme](https://www.npmjs.com/package/@trycedar/pi-mdiff?activeTab=readme)
- [Code Beta](https://www.npmjs.com/package/@trycedar/pi-mdiff?activeTab=code)
- [6 Dependencies](https://www.npmjs.com/package/@trycedar/pi-mdiff?activeTab=dependencies)
- [0 Dependents](https://www.npmjs.com/package/@trycedar/pi-mdiff?activeTab=dependents)
- [2 Versions](https://www.npmjs.com/package/@trycedar/pi-mdiff?activeTab=versions)

# pi-mdiff

[Permalink: pi-mdiff](https://www.npmjs.com/package/@trycedar/pi-mdiff#pi-mdiff)

**Markdown-aware editing for pi coding agent. Fixes `edit` failures on `.md` files caused by line-wrap mismatches, and adds section-anchored editing so reformatting can never break your workflow.**

[![npm version](https://camo.githubusercontent.com/4a3fb2f924ff99ee65658ac90573addc2d69f9cf7188430de1387c5fa9ae8b61/68747470733a2f2f696d672e736869656c64732e696f2f6e706d2f762f70692d6d646966663f7374796c653d666c61742d737175617265)](https://www.npmjs.com/package/pi-mdiff)[![license](https://camo.githubusercontent.com/ac049ef4e7a0b7196b09add6ac2d4f180e544c0ac779c2b2ac2fd2723a209579/68747470733a2f2f696d672e736869656c64732e696f2f62616467652f6c6963656e73652d4d49542d626c75653f7374796c653d666c61742d737175617265)](https://opensource.org/licenses/MIT)[![pi-package](https://camo.githubusercontent.com/dcf5df80e23d03f114fd464e7d8c8793794111e537a85ebddf8c565521353fe2/68747470733a2f2f696d672e736869656c64732e696f2f62616467652f70692d7061636b6167652d3862356366363f7374796c653d666c61742d737175617265)](https://pi.dev/packages/pi-mdiff)

## The problem

[Permalink: The problem](https://www.npmjs.com/package/@trycedar/pi-mdiff#the-problem)

You ask pi to update a paragraph in your docs. It fails:

```
Error: cannot find matching context in docs/architecture.md
<<<<<<< SEARCH
The system uses PostgreSQL for all storage.
The schema is defined in schema.sql.
All queries go through the repository layer.
```

The file has the same content — just wrapped differently by a formatter. Pi read it as three lines, the file now has them joined into one. Exact text match fails.

**pi-mdiff fixes this silently.** The edit goes through without any retry, without any error, without the LLM ever knowing there was a problem.

## Install

[Permalink: Install](https://www.npmjs.com/package/@trycedar/pi-mdiff#install)

```
pi install npm:@trycedar/pi-mdiff
```

That is the only step. No config, no API keys.

## Try this first

[Permalink: Try this first](https://www.npmjs.com/package/@trycedar/pi-mdiff#try-this-first)

After installing, ask pi naturally:

```
Update the Architecture section of docs/README.md to mention that we moved to PostgreSQL.
```

```
Inspect docs/CONTRIBUTING.md and rewrite the Getting Started section.
```

```
Delete the "Legacy Notes" section from docs/api.md.
```

```
Add a new "Troubleshooting" paragraph after the Installation section in README.md.
```

pi will use `md_inspect` to find the right section and `md_edit` to apply the change — no fragile text matching involved.

## What this adds

[Permalink: What this adds](https://www.npmjs.com/package/@trycedar/pi-mdiff#what-this-adds)

### Transparent fix for `edit` on `.md` files

[Permalink: Transparent fix for edit on .md files](https://www.npmjs.com/package/@trycedar/pi-mdiff#transparent-fix-for-edit-on-md-files)

Every `edit` tool call on a markdown file is intercepted. The SEARCH block is normalized before matching — soft-wrapped lines are joined, extra blank lines collapsed, list bullets standardized.

**Before pi-mdiff:** formatter wraps paragraph differently → SEARCH fails → LLM retries → confusion.

**After pi-mdiff:** normalization runs silently → match found → edit applied → done.

If normalization still can't find a match, pi-mdiff applies its own fuzzy recovery and returns a success result. The LLM never sees the failure.

### `md_inspect` — see section structure before editing

[Permalink: md_inspect — see section structure before editing](https://www.npmjs.com/package/@trycedar/pi-mdiff#md_inspect--see-section-structure-before-editing)

```
md_inspect path="docs/architecture.md"
```

```
## Overview
  [0] paragraph: "This project is a web application that helps…"
## Database Layer
  [0] paragraph: "We use PostgreSQL for all persistent storage…"
  [1] paragraph: "Migrations are managed via Alembic…"
## API Layer
  [0] paragraph: "The REST API is built with Express…"
```

Shows every section heading and the blocks inside it, with 0-based indices. Call this before `md_edit` so you know exactly what to target.

### `md_edit` — section-anchored editing

[Permalink: md_edit — section-anchored editing](https://www.npmjs.com/package/@trycedar/pi-mdiff#md_edit--section-anchored-editing)

```
md_edit path="docs/architecture.md"
        operation="replace"
        section="## Database Layer"
        block_index=0
        content="We use PostgreSQL for all persistent storage.
The schema is defined in schema.sql and managed via Alembic."
```

Anchors to a heading + block index. No text matching. Formatters can reflow the entire file — this still works.

| Operation | What it does |
| --- | --- |
| `replace` | Replace the block at `block_index` with new content |
| `insert_after` | Insert a new block after `block_index` |
| `delete` | Remove the block at `block_index` |

## Common workflows

[Permalink: Common workflows](https://www.npmjs.com/package/@trycedar/pi-mdiff#common-workflows)

| Task | How to ask |
| --- | --- |
| Update a specific section | "Rewrite the Deployment section of docs/README.md to mention Docker." |
| Add a new paragraph | "Add a Troubleshooting section after Installation in README.md." |
| Delete stale content | "Remove the 'Legacy API' section from docs/api.md." |
| Bulk doc update | "Update all references to 'SQLite' to 'PostgreSQL' in docs/architecture.md." |
| Inspect before editing | "Show me the structure of CONTRIBUTING.md before we edit it." |

## What the normalizer preserves

[Permalink: What the normalizer preserves](https://www.npmjs.com/package/@trycedar/pi-mdiff#what-the-normalizer-preserves)

The normalizer only joins soft-wrapped prose lines. Everything else is left exactly as-is:

| Element | Example | Touched? |
| --- | --- | --- |
| Fenced code blocks | `````````…````````` | Never |
| YAML frontmatter | `---\ntitle: …\n---` | Never |
| Table rows | `| Col A | Col B |` | Never |
| Headings | `## Section Name` | Never |
| List items | `- item`, `  - nested` | Never |
| Blockquotes | `> quoted text` | Never |
| Horizontal rules | `---`, `***` | Never |
| Explicit line breaks | line ending with `` | Never |
| Inline code | ```code``` | Never |

## Tools

[Permalink: Tools](https://www.npmjs.com/package/@trycedar/pi-mdiff#tools)

### `md_inspect`

[Permalink: md_inspect](https://www.npmjs.com/package/@trycedar/pi-mdiff#md_inspect)

| Parameter | Description |
| --- | --- |
| `path` | Path to the markdown file |

Returns a formatted section map with block type and preview text for each block. Use this before `md_edit` to find the right `section` and `block_index`.

### `md_edit`

[Permalink: md_edit](https://www.npmjs.com/package/@trycedar/pi-mdiff#md_edit)

| Parameter | Description |
| --- | --- |
| `path` | Path to the markdown file |
| `operation` | `replace`, `insert_after`, or `delete` |
| `section` | Heading text to anchor to — case-insensitive, `##` prefix optional |
| `block_index` | 0-based index of the target block within the section |
| `content` | New block content (required for `replace` and `insert_after`) |

## How it works

[Permalink: How it works](https://www.npmjs.com/package/@trycedar/pi-mdiff#how-it-works)

**Normalization path** (fixes existing `edit` calls transparently):

```
LLM calls edit() on .md file
  → pi-mdiff intercepts tool_call
  → normalizes SEARCH block: join soft-wrapped lines, collapse blank lines
  → built-in edit runs with normalized text
  → if still fails: pi-mdiff applies fuzzy findInMarkdown(), writes file, returns success
```

**Block-anchor path** (md\_edit, most robust):

```
LLM calls md_edit()
  → parse file into mdast AST
  → find section by heading (case-insensitive)
  → locate nth block node
  → splice replacement at exact character offsets
  → write file
```

## Eval coverage

[Permalink: Eval coverage](https://www.npmjs.com/package/@trycedar/pi-mdiff#eval-coverage)

```
npm run eval   # 64 cases, 100% pass rate
```

| Category | Cases | Covers |
| --- | --- | --- |
| normalize | 20 | Tables, frontmatter, fences, lists, blockquotes, headings, setext, unicode |
| find | 10 | 2-line/3-line reflow, reverse reflow, flowmark vs 80-char, multi-paragraph, no-match |
| md\_edit | 15 | replace / insert\_after / delete, blast-radius, frontmatter, error cases |
| reflow | 9 | 3×3 format matrix — all 6 off-diagonal mismatches recover correctly |
| edge | 10 | Empty files, preamble, duplicate headings, long paragraphs, inline code |

## Development

[Permalink: Development](https://www.npmjs.com/package/@trycedar/pi-mdiff#development)

```
git clone https://github.com/trycedar0x/pi-mdiff
cd pi-mdiff && npm install
npm test          # 36 unit tests
npm run eval      # 64 scenario evals
npm run typecheck # strict TypeScript check
pi -e ./src/index.ts  # load in pi for manual testing
```

## Readme

### Keywords

- [pi-package](https://www.npmjs.com/search?q=keywords:pi-package)
- [pi-coding-agent](https://www.npmjs.com/search?q=keywords:pi-coding-agent)
- [markdown](https://www.npmjs.com/search?q=keywords:markdown)
- [diff](https://www.npmjs.com/search?q=keywords:diff)
- [edit](https://www.npmjs.com/search?q=keywords:edit)

Viewing @trycedar/pi-mdiff version 0.3.0