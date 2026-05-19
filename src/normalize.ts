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
 * list items, etc.) intact.
 */

/** Segments of a markdown document, typed so we can normalize only prose. */
type Segment =
  | { kind: "fence"; raw: string }   // ```...``` code fences — never touched
  | { kind: "html"; raw: string }    // <!-- --> or <tag> blocks
  | { kind: "prose"; raw: string };  // everything else

/**
 * Split raw markdown into typed segments so we can apply different normalization
 * to prose vs. fenced code blocks.
 */
export function splitSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  // Match fenced code blocks (``` or ~~~, with optional lang)
  const fenceRe = /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1[ \t]*$/gm;
  let last = 0;

  for (const match of text.matchAll(fenceRe)) {
    const start = match.index!;
    if (start > last) {
      segments.push({ kind: "prose", raw: text.slice(last, start) });
    }
    segments.push({ kind: "fence", raw: match[0] });
    last = start + match[0].length;
  }

  if (last < text.length) {
    segments.push({ kind: "prose", raw: text.slice(last) });
  }

  return segments;
}

/**
 * Returns true if a line starts a structural markdown element that should
 * never be joined to an adjacent line.
 */
function isStructuralLine(l: string): boolean {
  return (
    /^#{1,6} /.test(l) ||
    /^[-*+] /.test(l) ||
    /^\d+\. /.test(l) ||
    /^>/.test(l) ||
    /^</.test(l) ||
    /^[-*_]{3,}\s*$/.test(l) ||
    /^(`{3,}|~{3,})/.test(l)
  );
}

/**
 * Normalize a prose segment for fuzzy matching:
 * - Join ALL soft-wrapped lines within a paragraph into a single line.
 *   A "soft wrap" boundary is a \n that is NOT preceded/followed by a blank
 *   line, structural element, or explicit two-space line break.
 * - Collapse 3+ blank lines → 2
 * - Normalize list bullets (-, *, + → -)
 * - Strip trailing whitespace per line
 */
export function normalizeProse(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const stripped = line.trimEnd();

    // Blank line or structural line — emit as-is, don't try to join forward
    if (stripped === "" || isStructuralLine(stripped) || line.endsWith("  ")) {
      out.push(stripped);
      i++;
      continue;
    }

    // Start of a prose run — keep joining subsequent lines until a boundary
    let joined = stripped;
    while (i + 1 < lines.length) {
      const next = lines[i + 1];
      const nextStripped = next.trimEnd();

      // Stop joining at: blank line, structural line, explicit line break
      if (
        nextStripped === "" ||
        isStructuralLine(nextStripped) ||
        next.endsWith("  ")
      ) {
        break;
      }

      // Join this next line into the current prose run
      joined += " " + nextStripped.trimStart();
      i++;
    }

    out.push(joined);
    i++;
  }

  // Collapse 3+ blank lines → 2
  const collapsed = out.join("\n").replace(/\n{3,}/g, "\n\n");

  // Normalize list bullets
  return collapsed.replace(/^[*+] /gm, "- ");
}

/**
 * Normalize a full markdown document (prose segments only, fences preserved).
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
 * 2. Whitespace-normalized match (trim each line, collapse internal spaces)
 * 3. Full prose normalization (join soft-wrapped lines)
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
    // Map the normalized index back to the original file.
    // We do this by walking both strings in parallel.
    const origRange = mapNormalizedRangeToOriginal(fileContent, normFile, normIdx, normSearch.length);
    if (origRange) {
      return { ...origRange, normalized: true };
    }
  }

  return null;
}

/**
 * Given a range [normStart, normStart+normLen) in normText, map it back to
 * the corresponding range in origText.
 *
 * We build a position map: normText[i] → origText[j] for each character.
 * This is O(n) but markdown files are small enough that it's fine.
 */
function mapNormalizedRangeToOriginal(
  origText: string,
  normText: string,
  normStart: number,
  normLen: number,
): { start: number; end: number } | null {
  // Build map: normPos → origPos
  const normToOrig: number[] = new Array(normText.length + 1).fill(-1);

  let o = 0;
  let n = 0;

  while (o < origText.length && n < normText.length) {
    const oc = origText[o];
    const nc = normText[n];

    if (oc === nc) {
      // Exact character match
      normToOrig[n] = o;
      o++;
      n++;
    } else if (/\s/.test(oc) && /\s/.test(nc)) {
      // Both are whitespace (e.g. orig='\n', norm=' ' after soft-wrap collapse)
      normToOrig[n] = o;
      o++;
      n++;
      // Consume any extra whitespace in orig that was collapsed away in norm
      while (o < origText.length && /\s/.test(origText[o]) && !/\s/.test(normText[n] ?? "")) {
        o++;
      }
    } else if (/\s/.test(oc)) {
      // Extra whitespace in orig not present in norm (e.g. double spaces)
      o++;
    } else {
      // Genuine character mismatch — give up on precise mapping
      return null;
    }
  }

  // Mark end
  normToOrig[n] = o;

  const origStart = normToOrig[normStart];
  const origEnd = normToOrig[normStart + normLen];

  if (origStart === -1 || origEnd === -1) return null;

  return { start: origStart, end: origEnd };
}
