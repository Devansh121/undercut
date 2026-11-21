/**
 * A small schema kit for untrusted JSON. Every check inspects values with `typeof`,
 * `Array.isArray` and own keys only: nothing is coerced (no `String(x)`, no template
 * interpolation of client values, no `==`), so a value like `{ toString: null }`
 * cannot throw. Objects are strict: unknown fields are rejected.
 */

export type Checked<T> = { ok: true; value: T } | { ok: false; detail: string };
export type Check<T> = (value: unknown, path: string) => Checked<T>;

const okv = <T>(value: T): Checked<T> => ({ ok: true, value });
const bad = (path: string, what: string): { ok: false; detail: string } => ({
  ok: false,
  detail: `${path} ${what}`,
});

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** An integer in [min, max]. */
export const int =
  (min: number, max: number): Check<number> =>
  (v, path) =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
      ? okv(v)
      : bad(path, `must be an integer from ${min} to ${max}`);

/** A finite number in [min, max]. */
export const num =
  (min: number, max: number): Check<number> =>
  (v, path) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
      ? okv(v)
      : bad(path, `must be a number from ${min} to ${max}`);

export const bool: Check<boolean> = (v, path) =>
  typeof v === 'boolean' ? okv(v) : bad(path, 'must be true or false');

/** A string of at most `maxLength` UTF-16 units, optionally matching `pattern`. */
export const str =
  (maxLength: number, pattern?: RegExp): Check<string> =>
  (v, path) => {
    if (typeof v !== 'string') return bad(path, 'must be a string');
    if (v.length > maxLength) return bad(path, `is longer than ${maxLength} characters`);
    if (pattern && !pattern.test(v)) return bad(path, 'has an invalid format');
    return okv(v);
  };

export const oneOf =
  <T extends string>(values: readonly T[]): Check<T> =>
  (v, path) =>
    typeof v === 'string' && (values as readonly string[]).includes(v)
      ? okv(v as T)
      : bad(path, `must be one of ${values.join(', ')}`);

export const arrayOf =
  <T>(item: Check<T>, maxLength: number, minLength = 0): Check<T[]> =>
  (v, path) => {
    if (!Array.isArray(v)) return bad(path, 'must be an array');
    if (v.length > maxLength || v.length < minLength) {
      return bad(path, `must have ${minLength} to ${maxLength} items`);
    }
    const out: T[] = [];
    for (let i = 0; i < v.length; i++) {
      const r = item(v[i], `${path}[${i}]`);
      if (!r.ok) return r;
      out.push(r.value);
    }
    return okv(out);
  };

type Shape = Record<string, Check<unknown>>;
type Out<S extends Shape> = { [K in keyof S]: S[K] extends Check<infer T> ? T : never };
type Optional<S extends Shape> = {
  [K in keyof S]?: S[K] extends Check<infer T> ? T : never;
};

/**
 * A strict object: every `required` key must be present, `optional` keys may be, and
 * nothing else is allowed. `__proto__` from JSON is an own key and is rejected like any
 * other unknown field.
 */
export function object<R extends Shape, O extends Shape = Record<never, never>>(
  required: R,
  optional?: O,
): Check<Out<R> & Optional<O>> {
  return (v, path) => {
    if (!isPlainObject(v)) return bad(path, 'must be an object');
    for (const key of Object.keys(v)) {
      if (!Object.hasOwn(required, key) && !(optional && Object.hasOwn(optional, key))) {
        return bad(path, `has an unknown field ${JSON.stringify(key.slice(0, 32))}`);
      }
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(required)) {
      if (!Object.hasOwn(v, key)) return bad(path, `is missing ${key}`);
      const r = (required[key] as Check<unknown>)(v[key], `${path}.${key}`);
      if (!r.ok) return r;
      out[key] = r.value;
    }
    if (optional) {
      for (const key of Object.keys(optional)) {
        if (!Object.hasOwn(v, key)) continue;
        const r = (optional[key] as Check<unknown>)(v[key], `${path}.${key}`);
        if (!r.ok) return r;
        out[key] = r.value;
      }
    }
    return okv(out as Out<R> & Optional<O>);
  };
}
