/** A number that is a Python float; plain JS numbers are Python ints. */
export class PyFloat {
  readonly value: number;

  constructor(value: number) {
    this.value = value;
  }
}

export type TaggedValue =
  | null
  | boolean
  | number
  | PyFloat
  | string
  | TaggedValue[]
  | { [key: string]: TaggedValue };

export class JsonConstantError extends Error {
  readonly constant: string;

  constructor(constant: string) {
    super(`JSON contains the non-finite value ${constant}`);
    this.constant = constant;
  }
}

export class JsonSyntaxError extends Error {}

export function numberValue(value: number | PyFloat): number {
  return value instanceof PyFloat ? value.value : value;
}

export function isPyFloat(value: unknown): value is PyFloat {
  return value instanceof PyFloat;
}

export function taggedNumber(value: number, float: boolean): number | PyFloat {
  return float ? new PyFloat(value) : value;
}

export function isTaggedNumber(value: unknown): value is number | PyFloat {
  return typeof value === "number" || value instanceof PyFloat;
}

export function untag(value: TaggedValue): unknown {
  if (value instanceof PyFloat) {
    return value.value;
  }
  if (Array.isArray(value)) {
    return value.map(untag);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, untag(item)]));
  }
  return value;
}

export function cloneTagged(value: TaggedValue): TaggedValue {
  if (value instanceof PyFloat) {
    return new PyFloat(value.value);
  }
  if (Array.isArray(value)) {
    return value.map(cloneTagged);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneTagged(item)]));
  }
  return value;
}

export function pyNumberText(value: number | PyFloat): string {
  if (value instanceof PyFloat) {
    return pyFloatRepr(value.value);
  }
  if (!Number.isInteger(value)) {
    throw new Error(`internal: Python int carries the non-integer value ${value}`);
  }
  return String(value);
}

/** CPython repr(float): shortest round-trip digits in Python's notation. */
export function pyFloatRepr(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`cannot repr the non-finite float ${value}`);
  }
  const sign = value < 0 || Object.is(value, -0) ? "-" : "";
  const magnitude = Math.abs(value);
  if (magnitude === 0) {
    return `${sign}0.0`;
  }
  // toExponential() with no argument yields the shortest round-tripping digits.
  const exponential = magnitude.toExponential();
  const match = /^(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(exponential);
  if (match === null) {
    throw new Error(`unexpected exponential form ${exponential}`);
  }
  const digits = match[1] + (match[2] ?? "");
  const exponent = Number(match[3]);
  if (exponent >= -4 && exponent < 16) {
    if (exponent >= digits.length - 1) {
      return `${sign}${digits}${"0".repeat(exponent - (digits.length - 1))}.0`;
    }
    if (exponent >= 0) {
      return `${sign}${digits.slice(0, exponent + 1)}.${digits.slice(exponent + 1)}`;
    }
    return `${sign}0.${"0".repeat(-exponent - 1)}${digits}`;
  }
  const mantissa = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits[0];
  const exponentSign = exponent < 0 ? "-" : "+";
  const exponentDigits = String(Math.abs(exponent)).padStart(2, "0");
  return `${sign}${mantissa}e${exponentSign}${exponentDigits}`;
}

// JSON.stringify already emits Python's ensure_ascii escapes below U+0080.
function pyStringLiteral(text: string): string {
  return JSON.stringify(text).replace(
    /[\u0080-\uffff]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

export function pyDumps(value: TaggedValue, options: { indent?: number } = {}): string {
  const indent = options.indent;
  const dump = (node: TaggedValue, depth: number): string => {
    if (node === null) {
      return "null";
    }
    if (typeof node === "boolean") {
      return node ? "true" : "false";
    }
    if (typeof node === "string") {
      return pyStringLiteral(node);
    }
    if (isTaggedNumber(node)) {
      const numeric = numberValue(node);
      if (!Number.isFinite(numeric)) {
        throw new Error(`out of range float value ${numeric} is not JSON compliant`);
      }
      return node instanceof PyFloat ? pyFloatRepr(numeric) : pyNumberText(node);
    }
    if (Array.isArray(node)) {
      if (node.length === 0) {
        return "[]";
      }
      const items = node.map((item) => dump(item, depth + 1));
      if (indent === undefined) {
        return `[${items.join(",")}]`;
      }
      const pad = " ".repeat(indent * (depth + 1));
      return `[\n${items.map((item) => pad + item).join(",\n")}\n${" ".repeat(indent * depth)}]`;
    }
    const entries = Object.entries(node);
    if (entries.length === 0) {
      return "{}";
    }
    const keySeparator = indent === undefined ? ":" : ": ";
    const rendered = entries.map(
      ([key, item]) => `${pyStringLiteral(key)}${keySeparator}${dump(item, depth + 1)}`,
    );
    if (indent === undefined) {
      return `{${rendered.join(",")}}`;
    }
    const pad = " ".repeat(indent * (depth + 1));
    return `{\n${rendered.map((item) => pad + item).join(",\n")}\n${" ".repeat(indent * depth)}}`;
  };
  return dump(value, 0);
}

export function parseTaggedJson(text: string): TaggedValue {
  let position = 0;

  const fail = (message: string): never => {
    throw new JsonSyntaxError(`${message} at position ${position}`);
  };

  const skipWhitespace = (): void => {
    while (position < text.length && " \t\n\r".includes(text[position])) {
      position += 1;
    }
  };

  const literal = (token: string): void => {
    if (text.startsWith(token, position)) {
      position += token.length;
      return;
    }
    fail(`expected ${token}`);
  };

  const parseString = (): string => {
    const start = position;
    position += 1;
    while (position < text.length) {
      const character = text[position];
      if (character === "\\") {
        position += 2;
        continue;
      }
      if (character === '"') {
        position += 1;
        try {
          return JSON.parse(text.slice(start, position)) as string;
        } catch {
          fail("invalid string escape");
        }
      }
      position += 1;
    }
    return fail("unterminated string");
  };

  const parseNumber = (): number | PyFloat => {
    const match = /^-?(?:0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(position));
    if (match === null || match[0] === "" || match[0] === "-") {
      return fail("invalid number");
    }
    const lexeme = match[0];
    position += lexeme.length;
    const float = match[1] !== undefined || match[2] !== undefined;
    const numeric = Number(lexeme);
    return float ? new PyFloat(numeric) : numeric;
  };

  const parseValue = (): TaggedValue => {
    skipWhitespace();
    if (position >= text.length) {
      return fail("unexpected end of input");
    }
    const character = text[position];
    if (character === "{") {
      position += 1;
      const result: { [key: string]: TaggedValue } = {};
      skipWhitespace();
      if (text[position] === "}") {
        position += 1;
        return result;
      }
      for (;;) {
        skipWhitespace();
        if (text[position] !== '"') {
          fail("expected object key");
        }
        const key = parseString();
        skipWhitespace();
        literal(":");
        result[key] = parseValue();
        skipWhitespace();
        if (text[position] === ",") {
          position += 1;
          continue;
        }
        literal("}");
        return result;
      }
    }
    if (character === "[") {
      position += 1;
      const result: TaggedValue[] = [];
      skipWhitespace();
      if (text[position] === "]") {
        position += 1;
        return result;
      }
      for (;;) {
        result.push(parseValue());
        skipWhitespace();
        if (text[position] === ",") {
          position += 1;
          continue;
        }
        literal("]");
        return result;
      }
    }
    if (character === '"') {
      return parseString();
    }
    if (character === "t") {
      literal("true");
      return true;
    }
    if (character === "f") {
      literal("false");
      return false;
    }
    if (character === "n") {
      literal("null");
      return null;
    }
    for (const constant of ["NaN", "Infinity", "-Infinity"]) {
      if (text.startsWith(constant, position)) {
        throw new JsonConstantError(constant);
      }
    }
    return parseNumber();
  };

  const result = parseValue();
  skipWhitespace();
  if (position !== text.length) {
    fail("trailing characters");
  }
  return result;
}
