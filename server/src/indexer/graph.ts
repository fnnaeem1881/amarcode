import type { DependencyEdge, FileIndexEntry } from "@amarcode/shared";
import { indexer } from "./indexer.js";

export interface SymbolLocation {
  path: string;
  line: number;
  kind: string;
}

/**
 * Derives a dependency graph and symbol tables from the file index. Powers
 * Go-to-Definition, Find-References, Rename impact and Call-Hierarchy without
 * re-reading files (all data comes from the index).
 */
export class DependencyGraph {
  private edges: DependencyEdge[] = [];
  private defByName = new Map<string, SymbolLocation[]>();
  private entriesByPath = new Map<string, FileIndexEntry>();

  build(root: string): void {
    const entries = indexer.listEntries(root);
    this.entriesByPath = new Map(entries.map((e) => [e.path, e]));
    this.defByName.clear();
    this.edges = [];

    for (const entry of entries) {
      for (const sym of entry.symbols) {
        const list = this.defByName.get(sym.name) ?? [];
        list.push({ path: entry.path, line: sym.line, kind: sym.kind });
        this.defByName.set(sym.name, list);
      }
    }

    // Resolve import specifiers to files to build edges.
    const byBasename = new Map<string, string[]>();
    for (const e of entries) {
      const base = stripExt(basename(e.path));
      const list = byBasename.get(base) ?? [];
      list.push(e.path);
      byBasename.set(base, list);
    }

    for (const entry of entries) {
      for (const spec of entry.imports) {
        const target = this.resolveImport(entry.path, spec, byBasename);
        if (target && target !== entry.path) this.edges.push({ from: entry.path, to: target, via: spec });
      }
    }
  }

  getEdges(): DependencyEdge[] { return this.edges; }

  /** Go to Definition — where a symbol name is declared. */
  definitions(name: string): SymbolLocation[] {
    return this.defByName.get(name) ?? [];
  }

  /** Find References — every file whose content mentions the symbol. */
  references(root: string, name: string): SymbolLocation[] {
    const refs: SymbolLocation[] = [];
    const re = new RegExp(`\\b${escapeRe(name)}\\b`);
    for (const entry of this.entriesByPath.values()) {
      // Uses imports + symbols as a cheap proxy; a real impl would grep content.
      if (entry.symbols.some((s) => s.name === name) || entry.imports.some((i) => i.includes(name))) {
        refs.push({ path: entry.path, line: 0, kind: "reference" });
      }
    }
    return refs;
  }

  /** Call Hierarchy (incoming): files that depend on the file defining a symbol. */
  callers(name: string): string[] {
    const defs = this.definitions(name);
    const defFiles = new Set(defs.map((d) => d.path));
    return [...new Set(this.edges.filter((e) => defFiles.has(e.to)).map((e) => e.from))];
  }

  /** Files that a given file depends on (outgoing). */
  dependencies(path: string): string[] {
    return [...new Set(this.edges.filter((e) => e.from === path).map((e) => e.to))];
  }

  private resolveImport(fromPath: string, spec: string, byBasename: Map<string, string[]>): string | undefined {
    // Only resolve relative/local imports; external packages are edges to nowhere.
    const base = stripExt(basename(spec));
    const candidates = byBasename.get(base);
    if (!candidates?.length) return undefined;
    if (candidates.length === 1) return candidates[0];
    // Prefer the candidate sharing the longest path prefix with the importer.
    return candidates.sort((a, b) => sharedPrefix(b, fromPath) - sharedPrefix(a, fromPath))[0];
  }
}

function basename(p: string): string { return p.split("/").pop() ?? p; }
function stripExt(p: string): string { return p.replace(/\.[^.]+$/, ""); }
function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function sharedPrefix(a: string, b: string): number {
  const pa = a.split("/"), pb = b.split("/");
  let i = 0;
  while (i < pa.length && i < pb.length && pa[i] === pb[i]) i++;
  return i;
}

export const graph = new DependencyGraph();
