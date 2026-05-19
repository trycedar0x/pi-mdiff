# pi-mdiff

**Markdown-aware editing for pi coding agent. Fixes `edit` failures on `.md` files caused by line-wrap mismatches, and adds section-anchored editing so reformatting can never break your workflow.**

[![npm version](https://img.shields.io/npm/v/pi-mdiff?style=flat-square)](https://www.npmjs.com/package/pi-mdiff)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](https://opensource.org/licenses/MIT)
[![pi-package](https://img.shields.io/badge/pi-package-8b5cf6?style=flat-square)](https://pi.dev/packages/pi-mdiff)

## The problem

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

```bash
pi install npm:@trycedar0x/pi-mdiff
```

That is the only step. No config, no API keys.

## Try this first

After installing, ask pi naturally:

```text
Update the Architecture section of docs/README.md to mention that we moved to PostgreSQL.
```

```text
Inspect docs/CONTRIBUTING.md and rewrite the Getting Started section.
```

```text
Delete the "Legacy Notes" section from docs/api.md.
```

```text
Add a new "Troubleshooting" paragraph after the Installation section in README.md.
```

pi will use `md_inspect` to find the right section and `md_edit` to apply the change — no fragile text matching involved.

## What this adds

### Transparent fix for `edit` on `.md` files

Every `edit` tool call on a markdown file is intercepted. The SEARCH block is normalized before matching — soft-wrapped lines are joined, extra blank lines collapsed, list bullets standardized.

**Before pi-mdiff:** formatter wraps paragraph differently → SEARCH fails → LLM retries → confusion.

**After pi-mdiff:** normalization runs silently → match found → edit applied → done.

If normalization still can't find a match, pi-mdiff applies its own fuzzy recovery and returns a success result. The LLM never sees the failure.

### `md_inspect` — see section structure before editing

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
|---|---|
| `replace` | Replace the block at `block_index` with new content |
| `insert_after` | Insert a new block after `block_index` |
| `delete` | Remove the block at `block_index` |

## Common workflows

| Task | How to ask |
|---|---|
| Update a specific section | "Rewrite the Deployment section of docs/README.md to mention Docker." |
| Add a new paragraph | "Add a Troubleshooting section after Installation in README.md." |
| Delete stale content | "Remove the 'Legacy API' section from docs/api.md." |
| Bulk doc update | "Update all references to 'SQLite' to 'PostgreSQL' in docs/architecture.md." |
| Inspect before editing | "Show me the structure of CONTRIBUTING.md before we edit it." |

## What the normalizer preserves

The normalizer only joins soft-wrapped prose lines. Everything else is left exactly as-is:

| Element | Example | Touched? |
|---|---|---|
| Fenced code blocks | ` ``` `…` ``` ` | Never |
| YAML frontmatter | `---\ntitle: …\n---` | Never |
| Table rows | `\| Col A \| Col B \|` | Never |
| Headings | `## Section Name` | Never |
| List items | `- item`, `  - nested` | Never |
| Blockquotes | `> quoted text` | Never |
| Horizontal rules | `---`, `***` | Never |
| Explicit line breaks | line ending with `  ` | Never |
| Inline code | `` `code` `` | Never |

## Tools

### `md_inspect`

| Parameter | Description |
|---|---|
| `path` | Path to the markdown file |

Returns a formatted section map with block type and preview text for each block. Use this before `md_edit` to find the right `section` and `block_index`.

### `md_edit`

| Parameter | Description |
|---|---|
| `path` | Path to the markdown file |
| `operation` | `replace`, `insert_after`, or `delete` |
| `section` | Heading text to anchor to — case-insensitive, `##` prefix optional |
| `block_index` | 0-based index of the target block within the section |
| `content` | New block content (required for `replace` and `insert_after`) |

## How it works

**Normalization path** (fixes existing `edit` calls transparently):

```
LLM calls edit() on .md file
  → pi-mdiff intercepts tool_call
  → normalizes SEARCH block: join soft-wrapped lines, collapse blank lines
  → built-in edit runs with normalized text
  → if still fails: pi-mdiff applies fuzzy findInMarkdown(), writes file, returns success
```

**Block-anchor path** (md_edit, most robust):

```
LLM calls md_edit()
  → parse file into mdast AST
  → find section by heading (case-insensitive)
  → locate nth block node
  → splice replacement at exact character offsets
  → write file
```

## Eval coverage

```bash
npm run eval   # 64 cases, 100% pass rate
```

| Category | Cases | Covers |
|---|---|---|
| normalize | 20 | Tables, frontmatter, fences, lists, blockquotes, headings, setext, unicode |
| find | 10 | 2-line/3-line reflow, reverse reflow, flowmark vs 80-char, multi-paragraph, no-match |
| md_edit | 15 | replace / insert_after / delete, blast-radius, frontmatter, error cases |
| reflow | 9 | 3×3 format matrix — all 6 off-diagonal mismatches recover correctly |
| edge | 10 | Empty files, preamble, duplicate headings, long paragraphs, inline code |

## Development

```bash
git clone https://github.com/trycedar0x/pi-mdiff
cd pi-mdiff && npm install
npm test          # 36 unit tests
npm run eval      # 64 scenario evals
npm run typecheck # strict TypeScript check
pi -e ./src/index.ts  # load in pi for manual testing
```
