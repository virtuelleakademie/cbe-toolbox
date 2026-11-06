export class StrictJsonError extends Error {
  constructor(
    readonly reason: "syntax" | "duplicate-key",
    readonly path: string
  ) {
    super(`${reason}:${path}`);
    this.name = "StrictJsonError";
  }
}

class Parser {
  private at = 0;

  constructor(private readonly raw: string) {}

  parse(): unknown {
    const value = this.value("$");
    this.whitespace();
    if (this.at !== this.raw.length) this.syntax("$");
    return value;
  }

  private whitespace(): void {
    while (this.at < this.raw.length && /[\t\n\r ]/u.test(this.raw[this.at]!)) this.at += 1;
  }

  private syntax(path: string): never {
    throw new StrictJsonError("syntax", path);
  }

  private value(path: string): unknown {
    this.whitespace();
    const char = this.raw[this.at];
    if (char === "{") return this.object(path);
    if (char === "[") return this.array(path);
    if (char === '"') return this.string(path);
    if (char === "t" && this.raw.slice(this.at, this.at + 4) === "true") {
      this.at += 4;
      return true;
    }
    if (char === "f" && this.raw.slice(this.at, this.at + 5) === "false") {
      this.at += 5;
      return false;
    }
    if (char === "n" && this.raw.slice(this.at, this.at + 4) === "null") {
      this.at += 4;
      return null;
    }
    return this.number(path);
  }

  private object(path: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const keys = new Set<string>();
    this.at += 1;
    this.whitespace();
    if (this.raw[this.at] === "}") {
      this.at += 1;
      return out;
    }
    for (;;) {
      this.whitespace();
      if (this.raw[this.at] !== '"') this.syntax(path);
      const key = this.string(path);
      if (keys.has(key)) throw new StrictJsonError("duplicate-key", `${path}.${key}`);
      keys.add(key);
      this.whitespace();
      if (this.raw[this.at] !== ":") this.syntax(`${path}.${key}`);
      this.at += 1;
      out[key] = this.value(`${path}.${key}`);
      this.whitespace();
      if (this.raw[this.at] === "}") {
        this.at += 1;
        return out;
      }
      if (this.raw[this.at] !== ",") this.syntax(path);
      this.at += 1;
    }
  }

  private array(path: string): unknown[] {
    const out: unknown[] = [];
    this.at += 1;
    this.whitespace();
    if (this.raw[this.at] === "]") {
      this.at += 1;
      return out;
    }
    for (;;) {
      out.push(this.value(`${path}[${out.length}]`));
      this.whitespace();
      if (this.raw[this.at] === "]") {
        this.at += 1;
        return out;
      }
      if (this.raw[this.at] !== ",") this.syntax(path);
      this.at += 1;
    }
  }

  private string(path: string): string {
    const start = this.at;
    this.at += 1;
    while (this.at < this.raw.length) {
      const char = this.raw[this.at];
      if (char === '"') {
        this.at += 1;
        try {
          return JSON.parse(this.raw.slice(start, this.at)) as string;
        } catch {
          this.syntax(path);
        }
      }
      if (char === "\\") {
        this.at += 1;
        const escaped = this.raw[this.at];
        if (escaped === "u") {
          const hex = this.raw.slice(this.at + 1, this.at + 5);
          if (!/^[a-fA-F0-9]{4}$/u.test(hex)) this.syntax(path);
          this.at += 5;
          continue;
        }
        if (!escaped || !'"\\/bfnrt'.includes(escaped)) this.syntax(path);
        this.at += 1;
        continue;
      }
      if (!char || char.charCodeAt(0) < 0x20) this.syntax(path);
      this.at += 1;
    }
    this.syntax(path);
  }

  private number(path: string): number {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(this.raw.slice(this.at));
    if (!match) this.syntax(path);
    this.at += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) this.syntax(path);
    return value;
  }
}

export function parseStrictJson(raw: string): unknown {
  return new Parser(raw).parse();
}
