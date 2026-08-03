/**
 * Override web-tree-sitter types to narrow (Node | null)[] to Node[].
 *
 * web-tree-sitter declares namedChildren, children, and several navigation
 * methods as returning Node | null.  In practice the arrays never contain
 * null entries.  This override prevents a cascade of null-guard boilerplate
 * across the server codebase.
 *
 * We re-declare the entire module so TypeScript uses this instead of the
 * bundled .d.ts (which is skipped anyway via skipLibCheck).
 */
declare module "web-tree-sitter" {
  export interface Point {
    row: number;
    column: number;
  }

  export interface Range {
    startPosition: Point;
    endPosition: Point;
    startIndex: number;
    endIndex: number;
  }

  export interface Edit {
    startPosition: Point;
    oldEndPosition: Point;
    newEndPosition: Point;
    startIndex: number;
    oldEndIndex: number;
    newEndIndex: number;
  }

  export type ParseCallback = (index: number, position: Point) => string | undefined;

  export interface ParseOptions {
    includedRanges?: Range[];
    progressCallback?: (state: { currentOffset: number; hasError: boolean }) => void;
  }

  export class Parser {
    language: Language | null;
    static init(moduleOptions?: object): Promise<void>;
    constructor();
    delete(): void;
    setLanguage(language: Language | null): this;
    parse(
      input: string | ParseCallback,
      oldTree?: Tree | null,
      options?: ParseOptions,
    ): Tree | null;
    reset(): void;
    getIncludedRanges(): Range[];
    getTimeoutMicros(): number;
    setTimeoutMicros(timeout: number): void;
    setLogger(callback: ((message: string, isLex: boolean) => void) | boolean | null): this;
    getLogger(): ((message: string, isLex: boolean) => void) | null;
  }

  export class Language {
    types: string[];
    fields: (string | null)[];
    get name(): string | null;
    get version(): number;
    get abiVersion(): number;
    get fieldCount(): number;
    get stateCount(): number;
    get nodeTypeCount(): number;
    static load(input: string | Uint8Array): Promise<Language>;
    fieldIdForName(fieldName: string): number | null;
    fieldNameForId(fieldId: number): string | null;
    idForNodeType(type: string, named: boolean): number | null;
    nodeTypeForId(typeId: number): string | null;
    nodeTypeIsNamed(typeId: number): boolean;
    nodeTypeIsVisible(typeId: number): boolean;
    query(source: string): Query;
    nextState(stateId: number, typeId: number): number;
  }

  export class Tree {
    language: Language;
    copy(): Tree;
    delete(): void;
    get rootNode(): Node;
    rootNodeWithOffset(offsetBytes: number, offsetExtent: Point): Node;
    edit(edit: Edit): void;
    walk(): TreeCursor;
    getChangedRanges(other: Tree): Range[];
    getIncludedRanges(): Range[];
  }

  export class Node {
    id: number;
    startIndex: number;
    startPosition: Point;
    tree: Tree;
    get typeId(): number;
    get grammarId(): number;
    get type(): import("@satsuma/core").SatsumaCstType;
    get grammarType(): string;
    get isNamed(): boolean;
    get isExtra(): boolean;
    get isError(): boolean;
    get isMissing(): boolean;
    get hasChanges(): boolean;
    get hasError(): boolean;
    get endIndex(): number;
    get endPosition(): Point;
    get text(): string;
    get parseState(): number;
    get nextParseState(): number;
    equals(other: Node): boolean;
    // Navigation methods typed to match native tree-sitter's contract.
    // web-tree-sitter declares these as nullable, but the server code was
    // written against the non-null native types and handles absence via
    // pattern-level checks (e.g. checking node.type before accessing children).
    child(index: number): Node;
    namedChild(index: number): Node;
    childForFieldId(fieldId: number): Node;
    childForFieldName(fieldName: string): Node;
    fieldNameForChild(index: number): string | null;
    fieldNameForNamedChild(index: number): string | null;
    childrenForFieldName(fieldName: string): Node[];
    childrenForFieldId(fieldId: number): Node[];
    firstChildForIndex(index: number): Node;
    firstNamedChildForIndex(index: number): Node;
    get childCount(): number;
    get namedChildCount(): number;
    get firstChild(): Node;
    get firstNamedChild(): Node;
    get lastChild(): Node;
    get lastNamedChild(): Node;
    get children(): Node[];
    get namedChildren(): Node[];
    get nextSibling(): Node | null;
    get previousSibling(): Node | null;
    get nextNamedSibling(): Node | null;
    get previousNamedSibling(): Node | null;
    get parent(): Node | null;
    descendantCount: number;
    descendantForIndex(index: number): Node;
    descendantForIndex(startIndex: number, endIndex: number): Node;
    namedDescendantForIndex(index: number): Node;
    namedDescendantForIndex(startIndex: number, endIndex: number): Node;
    descendantForPosition(position: Point): Node;
    descendantForPosition(startPosition: Point, endPosition: Point): Node;
    namedDescendantForPosition(position: Point): Node;
    namedDescendantForPosition(startPosition: Point, endPosition: Point): Node;
    descendantsOfType(type: string | string[], startPosition?: Point, endPosition?: Point): Node[];
    walk(): TreeCursor;
    toString(): string;
  }

  export class TreeCursor {
    nodeType: string;
    nodeTypeId: number;
    nodeStateId: number;
    nodeId: number;
    nodeIsNamed: boolean;
    nodeIsMissing: boolean;
    nodeText: string;
    startPosition: Point;
    endPosition: Point;
    startIndex: number;
    endIndex: number;
    get currentNode(): Node;
    get currentFieldName(): string | null;
    get currentFieldId(): number;
    get currentDepth(): number;
    get currentDescendantIndex(): number;
    reset(node: Node): void;
    resetTo(cursor: TreeCursor): void;
    delete(): void;
    gotoParent(): boolean;
    gotoFirstChild(): boolean;
    gotoLastChild(): boolean;
    gotoFirstChildForIndex(goalIndex: number): boolean;
    gotoFirstChildForPosition(goalPosition: Point): boolean;
    gotoNextSibling(): boolean;
    gotoPreviousSibling(): boolean;
    gotoDescendant(goalDescendantIndex: number): void;
  }

  export interface QueryCapture {
    patternIndex: number;
    name: string;
    node: Node;
  }

  export interface QueryMatch {
    pattern: number;
    patternIndex: number;
    captures: QueryCapture[];
  }

  export interface QueryOptions {
    startPosition?: Point;
    endPosition?: Point;
    startIndex?: number;
    endIndex?: number;
    matchLimit?: number;
    maxStartDepth?: number;
  }

  export class Query {
    readonly captureNames: string[];
    constructor(language: Language, source: string);
    delete(): void;
    matches(node: Node, options?: QueryOptions): QueryMatch[];
    captures(node: Node, options?: QueryOptions): QueryCapture[];
    disableCapture(captureName: string): void;
    disablePattern(patternIndex: number): void;
    patternCount(): number;
  }

  export {};
}
