/** A source text, and a path for debug purposes. */
export interface SrcWithPath {
  /** User friendly path */
  path?: string;
  text: string;
}

/** An offset into one of the src texts a dest text was assembled from. */
export interface SrcPosition {
  src: SrcWithPath;
  position: number;
}

/** flat per-fragment position records over all builders, in dest order.
 *  Internal to SrcMap, exported only for the _appendIndex signature. */
export interface SrcMapIndex {
  /** dest start offset per fragment */
  destStarts: number[];
  /** dest end offset per fragment */
  destEnds: number[];
  /** src start offset per fragment */
  srcStarts: number[];
  /** src text per fragment */
  srcs: SrcWithPath[];
}

/**
 * Map positions in a single dest text back to positions in the multiple
 * src texts it was assembled from.
 *
 * Most callers read only dest.text; position mapping runs on error reporting
 * paths, so the position index is built lazily from the builders' flat
 * position records on the first destToSrc() call.
 */
export class SrcMap {
  readonly dest: SrcWithPath;
  #builders: SrcMapBuilder[];
  #index: SrcMapIndex | undefined;

  constructor(dest: SrcWithPath, builders: SrcMapBuilder[] = []) {
    this.dest = dest;
    this.#builders = builders;
  }

  /** @return the source position corresponding to a provided destination position */
  destToSrc(destPos: number): SrcPosition {
    const { destStarts, destEnds, srcStarts, srcs } = this.#positionIndex();
    const last = destEnds.length - 1;

    let found = firstFragmentEndingAfter(destEnds, destPos);

    // the very end of the dest text has no following fragment to claim it, so
    // it stays with the final fragment. Otherwise an end of file diagnostic
    // (offset === dest.text.length) would lose its wesl path and position.
    if (found > last && last >= 0 && destPos === destEnds[last]) found = last;

    if (found > last || destStarts[found] > destPos) {
      return { src: this.dest, position: destPos }; // unmapped: identity
    }
    const position = srcStarts[found] + destPos - destStarts[found];
    return { src: srcs[found], position };
  }

  /** Map the exclusive end of a dest range back into the src text that the
   *  range's start mapped to. Maps the last covered position (destEnd - 1): a
   *  range end on a fragment boundary would otherwise map into the following
   *  fragment.
   *  Internal to the wesl package (underscore convention).
   *  @param start the already-mapped start of the range, from destToSrc()
   *  @return the exclusive end position in start's src text, or undefined when
   *    the end lands in a different src text (the range straddles two sources
   *    and can't be expressed as one span) */
  _destToSrcEnd(start: SrcPosition, destEnd: number): number | undefined {
    const endPos = this.destToSrc(destEnd - 1);
    const sameSrc =
      endPos.src.path === start.src.path && endPos.src.text === start.src.text;
    return sameSrc ? endPos.position + 1 : undefined;
  }

  /** build the fragment position index on first use, releasing the builders */
  #positionIndex(): SrcMapIndex {
    if (this.#index) return this.#index;
    const index: SrcMapIndex = {
      destStarts: [],
      destEnds: [],
      srcStarts: [],
      srcs: [],
    };
    let destOffset = 0;
    for (const builder of this.#builders) {
      destOffset = builder._appendIndex(index, destOffset);
    }
    this.#builders = [];
    this.#index = index;
    return index;
  }
}

/** Incrementally append to a string, recording source references as one
 *  flat src start offset per fragment (see {@link SrcMap.destToSrc}). */
export class SrcMapBuilder {
  #source: SrcWithPath;
  #fragments: string[] = [];
  #destLength = 0;
  /** guessed source position for the next unanchored fragment: just past the
   *  most recently added fragment, assuming src and dest advance in lockstep */
  #srcCursor = 0;
  /** one src start offset per fragment */
  #srcStarts: number[] = [];
  /** synthetic source text by fragment index (rare), see addSynthetic */
  #syntheticSrcs: Map<number, string> | undefined;
  /** false skips position recording: dest text only, no source mapping */
  #trackPositions: boolean;

  constructor(source: SrcWithPath, trackPositions = true) {
    this.#source = source;
    this.#trackPositions = trackPositions;
  }

  /** append a fragment to the destination string,
   *  mapped to the source text starting at srcStart */
  add(fragment: string, srcStart: number): void {
    this.#destLength += fragment.length;
    this.#fragments.push(fragment);
    this.#srcCursor = srcStart + fragment.length;
    if (this.#trackPositions) this.#srcStarts.push(srcStart);
  }

  /**
   * Append a fragment with no direct source range (keywords, punctuation,
   * indentation), mapping it just past the previously added fragment.
   */
  appendNext(fragment: string): void {
    this.add(fragment, this.#srcCursor);
  }

  /** append a fragment attributed to a synthetic source text
   *  (e.g. generated declarations with no user source).
   *
   *  The src cursor is a real-source concept, so a synthetic fragment leaves
   *  it untouched: srcStart here indexes the synthetic text, and letting it
   *  move the cursor would anchor the next appendNext/addNl glue at a
   *  synthetic offset misread as a real-module position. Glue after generated
   *  code instead anchors where the real source flow left off. Generators
   *  should emit complete fragments (their own whitespace and newlines)
   *  rather than relying on glue between synthetic fragments.
   *
   *  LATER when generated elements land: give synthetic sources an identity
   *  (a label/path plus the real-source insertion point) so diagnostics
   *  inside generated code can say where it was inserted instead of being
   *  path-less like the identity fallback. */
  addSynthetic(fragment: string, syntheticSrc: string, srcStart: number): void {
    this.#syntheticSrcs ??= new Map();
    this.#syntheticSrcs.set(this.#fragments.length, syntheticSrc);
    const cursor = this.#srcCursor;
    this.add(fragment, srcStart);
    this.#srcCursor = cursor;
  }

  /** append a synthetic newline, mapped just past the previous source location */
  addNl(): void {
    this.appendNext("\n");
  }

  /** Join builders into a SrcMap; the position index is built on first use.
   *  Don't add() to a builder after build(): the dest text is snapshotted here
   *  but positions are read lazily from the builders, so a later add() would
   *  desync the text from the position index. */
  static build(builders: SrcMapBuilder[]): SrcMap {
    const text = builders.map(b => b.#fragments.join("")).join("");
    return new SrcMap({ text }, builders);
  }

  /** append this builder's fragment records to a shared position index,
   *  with dest offsets starting at destOffset.
   *  Internal to SrcMap (underscore convention), not for external callers.
   *  @return the dest offset after this builder's text */
  _appendIndex(index: SrcMapIndex, destOffset: number): number {
    if (!this.#trackPositions) return destOffset + this.#destLength;
    const fragments = this.#fragments;
    const srcStarts = this.#srcStarts;
    const source = this.#source;
    let destStart = destOffset;
    for (let i = 0; i < fragments.length; i++) {
      const destEnd = destStart + fragments[i].length;
      const synthetic = this.#syntheticSrcs?.get(i);
      index.destStarts.push(destStart);
      index.destEnds.push(destEnd);
      index.srcStarts.push(srcStarts[i]);
      index.srcs.push(synthetic === undefined ? source : { text: synthetic });
      destStart = destEnd;
    }
    return destStart;
  }
}

/**
 * Binary search the fragment dest ranges (sorted, in dest order).
 * Fragments are half open [destStart, destEnd), so a position on a boundary
 * belongs to the fragment that starts there (e.g. an error offset at a token
 * start maps to the token, not the glue before it).
 * @return the index of the first fragment ending after destPos,
 *   or destEnds.length if no fragment ends after destPos
 */
function firstFragmentEndingAfter(destEnds: number[], destPos: number): number {
  let lo = 0;
  let hi = destEnds.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (destEnds[mid] <= destPos) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
