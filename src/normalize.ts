/**
 * Markdown normalization for SEARCH block matching.
 *
 * The core problem: standard SEARCH/REPLACE blocks use exact text matching.
 * Markdown prose is line-wrapped by formatters (flowmark, prettier, etc.), so the
 * same paragraph can live on 1 or 8 physical lines depending on who last touched the
 * file. This causes SEARCH to fail even when the content is correct.
 *
 * Solution: normalize both the SEARCH block and the file content to a canonical form
 * before comparing. The canonical form collapses soft line-breaks inside paragraphs,
 * leaving only structurally meaningful newlines (blank lines, fenced code, headings,
 * list items, tables, frontmatter, etc.) intact.
 */

/** Segments of a markdown document, typed so we can normalize only prose. */
type Segment =
  | { kind: "fence"; raw: string }       // ```...``` or ~~~...~~~ — never touched
  | { kind: "frontmatter"; raw: string } // ---...--- YAML frontmatter — never touched
  | { kind: "prose"; raw: string };      // everything else

/**
 * Split raw markdown into typed segments so we can apply normalization only to prose.
 * Order matters: frontmatter must be checked before fences (both use ---).
 */
export function splitSegments(text: string): Segment[] {
  const segments: Segment[] = [];

  // YAML frontmatter: only valid at the very start of the file
  let rest = text;
  let offset = 0;
  const fmMatch = text.match(/^---\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*\n/);
  if (fmMatch) {
    segments.push({ kind: "frontmatter", raw: fmMatch[0] });
    offset = fmMatch[0].length;
    rest = text.slice(offset);
  }

  // Fenced code blocks (``` or ~~~, with optional lang) within the remaining text
  const fenceRe = /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1[ \t]*$/gm;
  let last = 0;

  for (const match of rest.matchAll(fenceRe)) {
    const start = match.index!;
    if (start > last) {
      segments.push({ kind: "prose", raw: rest.slice(last, start) });
    }
    segments.push({ kind: "fence", raw: match[0] });
    last = start + match[0].length;
  }

  if (last < rest.length) {
    segments.push({ kind: "prose", raw: rest.slice(last) });
  }

  return segments;
}

/**
 * Returns true if a line must never be joined with the next line.
 * Covers: headings, list items (including indented), blockquotes, HTML,
 * horizontal rules, table rows, and fences.
 */
function isStructuralLine(l: string): boolean {
  const t = l.trimEnd();
  return (
    t === "" ||
    /^#{1,6} /.test(t) ||          // ATX headings
    /^\s*[-*+] /.test(t) ||        // unordered list items (any indent)
    /^\s*\d+\. /.test(t) ||        // ordered list items (any indent)
    /^\s*\d+\) /.test(t) ||        // ordered list with ) delimiter
    /^>/.test(t) ||                 // blockquotes
    /^</.test(t) ||                 // HTML blocks / inline HTML
    /^[-*_]{3,}\s*$/.test(t) ||    // horizontal rules
    /^(`{3,}|~{3,})/.test(t) ||   // fences
    /^\|/.test(t) ||               // table rows and separator lines
    /^={3,}\s*$/.test(t) ||        // setext heading underline (===)
    /^-{3,}\s*$/.test(t)           // setext heading underline (---) or front matter
  );
}

/**
 * Normalize a prose segment for soft-wrap-aware matching:
 * - Join ALL soft-wrapped lines within a paragraph into a single line.
 *   A "soft wrap" is a \n that is not followed by a structural element.
 * - Collapse 3+ blank lines → 2
 * - Normalize list bullets (* and + → -)
 * - Strip trailing whitespace per line
 *
 * Structural lines (headings, list items, blockquotes, table rows, etc.)
 * are always emitted as-is without joining.
 */
export function normalizeProse(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const stripped = line.trimEnd();
    // Preserve explicit markdown line break (two trailing spaces)
    const hasExplicitBreak = line.endsWith("  ");
    const emitted = hasExplicitBreak ? stripped + "  " : stripped;

    // Structural or blank line — emit as-is, never join forward
    if (stripped === "" || isStructuralLine(stripped) || hasExplicitBreak) {
      out.push(emitted);
      i++;
      continue;
    }

    // Start of a prose run — greedily join subsequent lines until a boundary
    let joined = stripped;
    while (i + 1 < lines.length) {
      const next = lines[i + 1];
      const nextStripped = next.trimEnd();

      // Stop at blank line, structural element, or explicit line break
      if (nextStripped === "" || isStructuralLine(nextStripped) || next.endsWith("  ")) {
        break;
      }

      joined += " " + nextStripped.trimStart();
      i++;
    }

    out.push(joined);
    i++;
  }

  // Collapse 3+ blank lines → 2
  const collapsed = out.join("\n").replace(/\n{3,}/g, "\n\n");

  // Normalize unordered list bullets (* + → -)
  // Only at start of line after optional whitespace indent
  return collapsed.replace(/^(\s*)[*+] /gm, "$1- ");
}

/**
 * Normalize a full markdown document (prose segments only; fences and
 * frontmatter are preserved exactly).
 */
export function normalizeMarkdown(text: string): string {
  const segments = splitSegments(text);
  return segments
    .map((seg) => (seg.kind === "prose" ? normalizeProse(seg.raw) : seg.raw))
    .join("");
}

/**
 * Try to find `searchText` inside `fileContent` using progressive matching:
 *
 * 1. Exact match (standard behavior)
 * 2. Normalized match (join soft-wrapped lines, collapse blank lines)
 *
 * Returns the matched region as { start, end } byte offsets in `fileContent`,
 * or null if no match found.
 */
export function findInMarkdown(
  fileContent: string,
  searchText: string,
): { start: number; end: number; normalized: boolean } | null {
  // 1. Exact match
  const exactIdx = fileContent.indexOf(searchText);
  if (exactIdx !== -1) {
    return { start: exactIdx, end: exactIdx + searchText.length, normalized: false };
  }

  // 2. Normalize both and find
  const normFile = normalizeMarkdown(fileContent);
  const normSearch = normalizeMarkdown(searchText);

  const normIdx = normFile.indexOf(normSearch);
  if (normIdx !== -1) {
    const origRange = mapNormalizedRangeToOriginal(fileContent, normFile, normIdx, normSearch.length);
    if (origRange) {
      return { ...origRange, normalized: true };
    }
  }

  return null;
}

/**
 * Map a range [normStart, normStart+normLen) in normText back to the
 * corresponding byte range in origText by walking both strings in parallel.
 *
 * Handles the key case where a soft-wrap \n in origText was collapsed to a
 * single space in normText.
 */
function mapNormalizedRangeToOriginal(
  origText: string,
  normText: string,
  normStart: number,
  normLen: number,
): { start: number; end: number } | null {
  const normToOrig: number[] = new Array(normText.length + 1).fill(-1);

  let o = 0;
  let n = 0;

  while (o < origText.length && n < normText.length) {
    const oc = origText[o];
    const nc = normText[n];

    if (oc === nc) {
      normToOrig[n] = o;
      o++;
      n++;
    } else if (/\s/.test(oc) && /\s/.test(nc)) {
      // Both whitespace — correspond (e.g. orig='\n', norm=' ' after soft-wrap)
      normToOrig[n] = o;
      o++;
      n++;
      // Consume any additional whitespace in orig that was collapsed in norm
      while (o < origText.length && /\s/.test(origText[o]) && !/\s/.test(normText[n] ?? "")) {
        o++;
      }
    } else if (/\s/.test(oc)) {
      // Extra whitespace in orig not present in norm
      o++;
    } else {
      // Genuine mismatch — give up
      return null;
    }
  }

  normToOrig[n] = o;

  const origStart = normToOrig[normStart];
  const origEnd = normToOrig[normStart + normLen];

  if (origStart === -1 || origEnd === -1) return null;

  return { start: origStart, end: origEnd };
}
