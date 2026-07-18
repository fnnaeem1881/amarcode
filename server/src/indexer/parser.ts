import type { CodeSymbol } from "@amarcode/shared";

/**
 * Pluggable symbol parser. The default implementation is regex-based so the
 * project installs with zero native dependencies. To use Tree-sitter or an
 * LSP, implement `SymbolParser` and register it in `pickParser` — nothing
 * else in the codebase changes.
 */
export interface ParseResult {
  imports: string[];
  exports: string[];
  symbols: CodeSymbol[];
}

export interface SymbolParser {
  supports(language: string): boolean;
  parse(source: string, language: string): ParseResult;
}

export function languageForPath(p: string): string {
  const ext = p.slice(p.lastIndexOf(".")).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript",
    ".mjs": "JavaScript", ".cjs": "JavaScript", ".vue": "Vue",
    ".php": "PHP", ".py": "Python", ".go": "Go", ".rs": "Rust",
    ".dart": "Dart", ".java": "Java", ".cs": "C#", ".rb": "Ruby",
    ".json": "JSON", ".yaml": "YAML", ".yml": "YAML", ".md": "Markdown",
    ".sql": "SQL", ".sh": "Shell",
  };
  return map[ext] ?? "Unknown";
}

/** Default regex parser — good enough for retrieval-quality symbol indexing. */
class RegexParser implements SymbolParser {
  supports(): boolean { return true; }

  parse(src: string, language: string): ParseResult {
    const imports = new Set<string>();
    const exports = new Set<string>();
    const symbols: CodeSymbol[] = [];
    const lines = src.split(/\r?\n/);

    const push = (name: string, kind: CodeSymbol["kind"], line: number) => {
      if (name) symbols.push({ name, kind, line: line + 1 });
    };

    lines.forEach((line, i) => {
      // Imports (JS/TS, PHP use, Python import, Go import, Dart)
      let m: RegExpMatchArray | null;
      if ((m = line.match(/import\s+.*?from\s+['"]([^'"]+)['"]/))) imports.add(m[1]);
      else if ((m = line.match(/require\(\s*['"]([^'"]+)['"]\s*\)/))) imports.add(m[1]);
      else if ((m = line.match(/^\s*use\s+([\w\\]+)/))) imports.add(m[1]);
      else if ((m = line.match(/^\s*from\s+([\w.]+)\s+import/))) imports.add(m[1]);
      else if ((m = line.match(/^\s*import\s+['"]([^'"]+)['"]/))) imports.add(m[1]);

      // Exports
      if ((m = line.match(/export\s+(?:default\s+)?(?:class|function|const|interface|type|enum)\s+(\w+)/))) exports.add(m[1]);
      if ((m = line.match(/export\s*\{\s*([^}]+)\}/))) m[1].split(",").forEach((s) => exports.add(s.trim().split(/\s+as\s+/)[0]));

      // Symbols
      if ((m = line.match(/(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/))) push(m[1], classKind(m[1]), i);
      if ((m = line.match(/interface\s+(\w+)/))) push(m[1], "interface", i);
      if ((m = line.match(/(?:export\s+)?(?:type)\s+(\w+)\s*=/))) push(m[1], "type", i);
      if ((m = line.match(/enum\s+(\w+)/))) push(m[1], "enum", i);
      if ((m = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/))) push(m[1], "function", i);
      if ((m = line.match(/(?:public|private|protected)\s+(?:static\s+)?function\s+(\w+)/))) push(m[1], "method", i); // PHP
      if ((m = line.match(/def\s+(\w+)\s*\(/))) push(m[1], "function", i); // Python
      if ((m = line.match(/func\s+(?:\([^)]*\)\s*)?(\w+)\s*\(/))) push(m[1], "function", i); // Go

      // Routes (Laravel / Express / NestJS decorators)
      if ((m = line.match(/Route::(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/))) push(`${m[1].toUpperCase()} ${m[2]}`, "route", i);
      if ((m = line.match(/\b(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/))) push(`${m[1].toUpperCase()} ${m[2]}`, "route", i);
      if ((m = line.match(/@(Get|Post|Put|Patch|Delete)\s*\(\s*['"]?([^'")]*)/))) push(`${m[1].toUpperCase()} ${m[2] || "/"}`, "route", i);

      // React function components
      if (language === "TypeScript" || language === "JavaScript") {
        if ((m = line.match(/(?:export\s+)?(?:const|function)\s+([A-Z]\w+)\s*(?:[:=]|\()/))) push(m[1], "component", i);
      }
    });

    return { imports: [...imports], exports: [...exports], symbols: dedupe(symbols) };
  }
}

function classKind(name: string): CodeSymbol["kind"] {
  if (/Controller$/.test(name)) return "controller";
  if (/Service$/.test(name)) return "service";
  if (/Repository$/.test(name)) return "repository";
  if (/Model$/.test(name)) return "model";
  return "class";
}

function dedupe(symbols: CodeSymbol[]): CodeSymbol[] {
  const seen = new Set<string>();
  return symbols.filter((s) => {
    const k = `${s.kind}:${s.name}:${s.line}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const parsers: SymbolParser[] = [new RegexParser()];

export function pickParser(language: string): SymbolParser {
  return parsers.find((p) => p.supports(language)) ?? parsers[0];
}
