/** Project scanning, metadata and indexing contracts. */

export type FrameworkId =
  | "laravel"
  | "node"
  | "deno"
  | "react"
  | "nextjs"
  | "vue"
  | "flutter"
  | "expo"
  | "nestjs"
  | "express"
  | "go"
  | "python"
  | "java"
  | "dotnet"
  | "rust"
  | "unknown";

export interface ProjectMetadata {
  root: string;
  name: string;
  framework: FrameworkId;
  language: string;
  packageManager?: string;
  dependencies: Record<string, string>;
  devDependencies?: Record<string, string>;
  database?: string;
  usesDocker: boolean;
  testFramework?: string;
  /** Marker files that were detected during the scan. */
  markers: string[];
  scannedAt: string;
}

export type SymbolKind =
  | "class"
  | "function"
  | "method"
  | "interface"
  | "route"
  | "controller"
  | "model"
  | "service"
  | "repository"
  | "migration"
  | "component"
  | "enum"
  | "type";

export interface CodeSymbol {
  name: string;
  kind: SymbolKind;
  line: number;
}

export interface FileIndexEntry {
  path: string;          // relative to project root, POSIX separators
  absPath: string;
  language: string;
  size: number;
  hash: string;          // content hash for incremental indexing
  imports: string[];
  exports: string[];
  symbols: CodeSymbol[];
  /** Importance score (0..1) used by context ranking. */
  importance: number;
  indexedAt: string;
}

export interface DependencyEdge {
  from: string; // file path
  to: string;   // file path
  via: string;  // the import specifier that created the edge
}

export interface IndexStats {
  totalFiles: number;
  indexedFiles: number;
  skippedFiles: number;
  totalSymbols: number;
  embeddedChunks: number;
  status: "idle" | "scanning" | "indexing" | "embedding" | "ready" | "error";
  message?: string;
}
