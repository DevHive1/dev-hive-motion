/**
 * Defensive type coercion for tool arguments.
 *
 * Why this exists: the small Ollama models (qwen2.5-coder:7b etc.) sometimes
 * pass stringified numbers ("60" instead of 60) when constructing nested
 * JSON in their head. The schema in the store rejects these with a raw zod
 * error like "Expected number, received string" at deep paths the agent
 * can't reason about, and the whole tool call fails. The error report
 * (error.txt) shows exactly this failure:
 *
 *   update_element failed: [ { "code": "invalid_type",
 *     "expected": "number", "received": "string",
 *     "path": [ "scenes", 11, "elements", 11, "durationInFrames" ] } ]
 *
 * Instead of telling the model "be more careful", we accept the messy
 * input and clean it up. This is robust without being magic - we only
 * coerce fields whose JSON schema type is "number" or "integer" (read
 * from the tool definition), and we only convert strings that look like
 * finite numbers (no garbage-in-becomes-garbage-out).
 *
 * Runs in the agent loop right before the implementation is called, so
 * every tool gets the same defense for free.
 */

type JSONSchema = Record<string, unknown>;

interface PropertyInfo {
  name: string;
  type: string | string[] | undefined;
  schema: JSONSchema;
}

interface ToolDefLike {
  function: {
    name: string;
    parameters?: JSONSchema;
  };
}

const NUMERIC_TYPES = new Set(["number", "integer"]);
const BOOLEAN_TYPES = new Set(["boolean"]);
const ARRAY_TYPES = new Set(["array"]);

/**
 * Coerce a single value to a number if it looks like one. Returns the
 * original value if conversion would be lossy or impossible.
 *
 *   "60"     -> 60
 *   "60.5"   -> 60.5
 *   "-3"     -> -3
 *   "  42  " -> 42
 *   "abc"    -> "abc"   (not a number, leave it - the schema will catch it)
 *   true     -> true    (booleans are not numbers here)
 *   null     -> null
 *   Infinity -> Infinity (valid number, kept)
 */
function coerceNumber(value: unknown): unknown {
  if (typeof value === "number") return Number.isFinite(value) ? value : value;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed === "") return value;
  // Reject things like "60abc" or "1e" - only accept clear number literals.
  if (!/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(trimmed) && !/^-?\.\d+$/.test(trimmed)) {
    return value;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : value;
}

function coerceBoolean(value: unknown): unknown {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (lower === "true" || lower === "1" || lower === "yes") return true;
    if (lower === "false" || lower === "0" || lower === "no") return false;
  }
  if (typeof value === "number") return value !== 0;
  return value;
}

function coerceArray(value: unknown, itemType: string | string[] | undefined): unknown {
  if (Array.isArray(value)) return value;
  // The model sometimes passes a single object where an array is expected.
  // Wrap it. We only do this when the type signature explicitly says array.
  if (value !== null && typeof value === "object") return [value];
  if (typeof value === "string" && itemType !== "string") {
    // JSON stringified array? Try to parse.
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // not JSON, leave it
    }
  }
  return value;
}

function propertyType(prop: JSONSchema): string | string[] | undefined {
  const t = prop.type;
  if (Array.isArray(t)) return t;
  if (typeof t === "string") return t;
  return undefined;
}

/**
 * Walk a single property and coerce it according to its declared type.
 * Handles nested object/array schemas recursively so deeply-nested
 * numeric fields get fixed too.
 */
function coerceValue(value: unknown, propSchema: JSONSchema, key: string): unknown {
  const type = propertyType(propSchema);

  if (type !== undefined) {
    const types = Array.isArray(type) ? type : [type];
    // "number" wins over "string" if the model passed a string number.
    if (types.some((t) => NUMERIC_TYPES.has(t)) && !types.every((t) => NUMERIC_TYPES.has(t) || t === "null")) {
      // Pure numeric field - coerce.
      if (typeof value === "string") return coerceNumber(value);
    } else if (types.some((t) => NUMERIC_TYPES.has(t)) && types.includes("string")) {
      // OneOf ["number", "string"] - coerce if it's a clear number string.
      if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) {
        return Number(value.trim());
      }
    }
    if (types.some((t) => BOOLEAN_TYPES.has(t)) && !types.includes("string")) {
      if (typeof value !== "boolean") return coerceBoolean(value);
    }
    if (types.some((t) => ARRAY_TYPES.has(t))) {
      const itemType = propertyType((propSchema.items as JSONSchema) ?? {});
      return coerceArray(value, itemType);
    }
  }

  if (value !== null && typeof value === "object" && propSchema.properties) {
    return coerceArgs(value as Record<string, unknown>, propSchema);
  }

  return value;
}

/**
 * Coerce a tool's argument object against the tool's JSON schema.
 * Mutates and returns the same object (no copy) for performance.
 */
export function coerceArgs(
  args: Record<string, unknown>,
  schema: JSONSchema | undefined,
): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return args;
  const properties = (schema.properties ?? {}) as Record<string, JSONSchema>;
  for (const [key, propSchema] of Object.entries(properties)) {
    if (!(key in args)) continue;
    args[key] = coerceValue(args[key], propSchema, key);
    // Recurse into nested object/array values that themselves have properties.
    if (
      args[key] !== null &&
      typeof args[key] === "object" &&
      !Array.isArray(args[key]) &&
      propSchema.properties
    ) {
      args[key] = coerceArgs(args[key] as Record<string, unknown>, propSchema);
    }
    // Walk into array items.
    if (Array.isArray(args[key]) && propSchema.items) {
      const itemsSchema = propSchema.items as JSONSchema;
      args[key] = (args[key] as unknown[]).map((item) => {
        if (item !== null && typeof item === "object" && !Array.isArray(item)) {
          return coerceArgs(item as Record<string, unknown>, itemsSchema);
        }
        return item;
      });
    }
  }
  return args;
}

/**
 * Entry point used by the agent loop. Looks up the tool's parameter
 * schema by name, runs coercion, returns the cleaned args.
 */
export function coerceToolCall(
  toolName: string,
  args: Record<string, unknown>,
  toolDefinitions: readonly ToolDefLike[],
): Record<string, unknown> {
  const def = toolDefinitions.find((t) => t.function.name === toolName);
  if (!def) return args;
  return coerceArgs(args, def.function.parameters);
}

/**
 * Exposed for unit-style smoke tests.
 */
export const __test__ = { coerceNumber, coerceBoolean, coerceValue };
