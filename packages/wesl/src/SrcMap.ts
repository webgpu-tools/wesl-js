/** A source map file, and a path for debug purposes. */
export interface SrcWithPath {
  /** User friendly path */
  path?: string;
  text: string;
}

export interface SrcMapEntry {
  src: SrcWithPath;
  srcStart: number;
  srcEnd: number;
  destStart: number;
  destEnd: number;
}

export interface SrcPosition {
  src: SrcWithPath;
  position: number;
}

/** map text ranges in multiple src texts to a single dest text */
export class SrcMap {
  entries: SrcMapEntry[];
  dest: SrcWithPath;

  constructor(dest: SrcWithPath, entries: SrcMapEntry[] = []) {
    this.dest = dest;
    this.entries = entries;
  }

  /** add a new mapping from src to dest ranges (must be non-overlapping in destination) */
  addEntries(newEntries: SrcMapEntry[]): void {
    this.entries.push(...newEntries);
  }

  /** given positions in the dest string, return corresponding positions in the src strings */
  mapPositions(...positions: number[]): SrcPosition[] {
    return positions.map(p => this.destToSrc(p));
  }

  /** internally compress adjacent entries where possible */
  compact(): void {
    if (!this.entries.length) return;
    let prev = this.entries[0];
    const newEntries: SrcMapEntry[] = [prev];

    for (let i = 1; i < this.entries.length; i++) {
      const e = this.entries[i];
      if (
        e.src.path === prev.src.path &&
        e.src.text === prev.src.text &&
        prev.destEnd === e.destStart &&
        prev.srcEnd === e.srcStart &&
        prev.srcEnd - prev.srcStart === prev.destEnd - prev.destStart
      ) {
        // combine adjacent range entries into one
        prev.destEnd = e.destEnd;
        prev.srcEnd = e.srcEnd;
      } else {
        newEntries.push(e);
        prev = e;
      }
    }
    this.entries = newEntries;
  }

  /** sort in destination order */
  sort(): void {
    this.entries.sort((a, b) => a.destStart - b.destStart);
  }

  /**
   * This SrcMap's destination is a src for the other srcmap,
   * so combine the two and return the result.
   */
  merge(other: SrcMap): SrcMap {
    if (other === this) return this;

    const mappedEntries = other.entries.filter(
      e => e.src.path === this.dest.path && e.src.text === this.dest.text,
    );
    if (mappedEntries.length === 0) {
      console.log("other source map does not link to this one");
      return other;
    }
    sortSrc(mappedEntries);
    const newEntries = mappedEntries.map(e => {
      const { src, position: srcStart } = this.destToSrc(e.srcStart);
      const { src: endSrc, position: srcEnd } = this.destToSrc(e.srcEnd);
      if (endSrc !== src) throw new Error("NYI, need to split");
      const newEntry: SrcMapEntry = {
        src,
        srcStart,
        srcEnd,
        destStart: e.destStart,
        destEnd: e.destEnd,
      };
      return newEntry;
    });

    const otherSources = other.entries.filter(
      e => e.src.path !== this.dest.path || e.src.text !== this.dest.text,
    );

    const newMap = new SrcMap(other.dest, [...otherSources, ...newEntries]);
    newMap.sort();
    return newMap;
  }

  /** @return the source position corresponding to a provided destination position */
  destToSrc(destPos: number): SrcPosition {
    const entry = this.entries.find(
      e => e.destStart <= destPos && e.destEnd >= destPos,
    );
    if (!entry) {
      return { src: this.dest, position: destPos };
    }
    return {
      src: entry.src,
      position: entry.srcStart + destPos - entry.destStart,
    };
  }
}

/** Incrementally append to a string, tracking source references */
export class SrcMapBuilder {
  #fragments: string[] = [];
  #destLength = 0;
  #entries: SrcMapEntry[] = [];
  source: SrcWithPath;

  constructor(source: SrcWithPath) {
    this.source = source;
  }

  /** append a string fragment to the destination string */
  add(fragment: string, srcStart: number, srcEnd: number): void {
    const destStart = this.#destLength;
    this.#destLength += fragment.length;
    const destEnd = this.#destLength;

    this.#fragments.push(fragment);
    this.#entries.push({
      src: this.source,
      srcStart,
      srcEnd,
      destStart,
      destEnd,
    });
  }

  /**
   * Append a fragment to the destination string,
   * mapping source to the previous,
   * and guessing that the source fragment is just as long as the dest fragment.
   */
  appendNext(fragment: string): void {
    const lastEnd = this.#entries.at(-1)?.destEnd ?? 0;
    this.add(fragment, lastEnd, lastEnd + fragment.length);
  }

  addSynthetic(
    fragment: string,
    syntheticSource: string,
    srcStart: number,
    srcEnd: number,
  ): void {
    const destStart = this.#destLength;
    this.#destLength += fragment.length;
    const destEnd = this.#destLength;

    this.#fragments.push(fragment);
    this.#entries.push({
      src: { text: syntheticSource },
      srcStart,
      srcEnd,
      destStart,
      destEnd,
    });
  }

  /** append a synthetic newline, mapped to previous source location */
  addNl(): void {
    const lastEntry = this.#entries.at(-1) ?? { srcStart: 0, srcEnd: 0 };
    const { srcStart, srcEnd } = lastEntry;
    this.add("\n", srcStart, srcEnd);
  }

  /** return a SrcMap */
  static build(builders: SrcMapBuilder[]): SrcMap {
    const map = new SrcMap(
      { text: builders.map(b => b.#fragments.join("")).join("") },
      builders.flatMap(b => b.#entries),
    );
    map.compact();
    return map;
  }
}

/** sort entries in place by src start position */
function sortSrc(entries: SrcMapEntry[]): void {
  entries.sort((a, b) => a.srcStart - b.srcStart);
}
