/**
 * Minimal parser for Valve's VDF ("KeyValues") text format — used by
 * Steam's `libraryfolders.vdf` and per-game `appmanifest_*.acf` files.
 * A simple, very stable format (unchanged for well over a decade):
 * quoted "key" "value" pairs, with { } for nesting, no arrays.
 *
 * UNVERIFIED against a real file — built from the well-documented
 * public format spec, not tested against actual Steam output (no
 * Windows machine or real Steam install available in this environment).
 * Low risk regardless: the format is simple and hasn't changed in a
 * very long time, but worth a real check on first use.
 */

export type VdfValue = string | VdfObject;
export interface VdfObject {
  [key: string]: VdfValue;
}

export function parseVdf(text: string): VdfObject {
  const tokens = tokenize(text);
  let pos = 0;

  function peek(): string | undefined {
    return tokens[pos];
  }
  function next(): string {
    const t = tokens[pos];
    pos++;
    if (t === undefined) throw new Error("Unexpected end of VDF input");
    return t;
  }

  function parseObject(): VdfObject {
    const obj: VdfObject = {};
    while (true) {
      const tok = peek();
      if (tok === undefined) break;
      if (tok === "}") {
        next();
        break;
      }
      const key = next();
      const valueTok = peek();
      if (valueTok === "{") {
        next();
        obj[key] = parseObject();
      } else if (valueTok === undefined) {
        break; // malformed trailing key with no value — stop rather than throw
      } else {
        obj[key] = next();
      }
    }
    return obj;
  }

  return parseObject();
}

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      let value = "";
      while (j < text.length && text[j] !== '"') {
        if (text[j] === "\\" && j + 1 < text.length) {
          value += text[j + 1];
          j += 2;
        } else {
          value += text[j];
          j += 1;
        }
      }
      tokens.push(value);
      i = j + 1;
    } else if (c === "{" || c === "}") {
      tokens.push(c);
      i += 1;
    } else if (/\s/.test(c)) {
      i += 1;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
    } else {
      let j = i;
      while (j < text.length && !/\s/.test(text[j]) && text[j] !== "{" && text[j] !== "}") j += 1;
      tokens.push(text.slice(i, j));
      i = j;
    }
  }
  return tokens;
}

/** Convenience for the common "object whose values are all sub-objects
 * with a shared key" shape used by libraryfolders.vdf's numbered
 * entries ("0", "1", "2"...) — returns just those sub-objects' values
 * for the given key, skipping anything that isn't shaped as expected
 * rather than throwing. */
export function collectNestedStrings(obj: VdfObject, key: string): string[] {
  const results: string[] = [];
  for (const value of Object.values(obj)) {
    if (typeof value === "object" && typeof value[key] === "string") {
      results.push(value[key] as string);
    }
  }
  return results;
}
