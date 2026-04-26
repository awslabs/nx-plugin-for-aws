/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { snakeCase, toClassName } from '../../../utils/names';
import { PRIMITIVE_TYPES, flattenModelLink, Model } from './types';
import camelCase from 'lodash.camelcase';

const toTypescriptPrimitive = (property: Model): string => {
  if (
    property.type === 'string' &&
    ['date', 'date-time'].includes(property.format ?? '')
  ) {
    return 'Date';
  } else if (property.type === 'binary') {
    return 'Blob';
  }
  return property.type;
};

/**
 * Return the typescript type for the given model
 */
export const toTypeScriptType = (property: Model): string => {
  const propertyLink = flattenModelLink(property.link);
  switch (property.export) {
    case 'enum':
    case 'generic':
      return toTypescriptPrimitive(property);
    case 'array':
      return `Array<${propertyLink && propertyLink.export !== 'enum' ? toTypeScriptType(propertyLink) : property.type}>`;
    case 'dictionary':
      return `{ [key: string]: ${propertyLink && propertyLink.export !== 'enum' ? toTypeScriptType(propertyLink) : property.type}; }`;
    case 'one-of':
    case 'any-of':
    case 'all-of':
      return toTypeScriptModelName(property.name);
    case 'reference':
    default:
      if (property.type === 'unknown') {
        return 'unknown';
      }
      if (PRIMITIVE_TYPES.has(property.type)) {
        return toTypescriptPrimitive(property);
      }
      return toTypeScriptModelName(property.type);
  }
};

export const toTypeScriptName = (name: string): string => {
  return camelCase(name);
};

const TYPESCRIPT_RESERVED_MODEL_NAMES = new Set([
  'Date',
  'Blob',
  'Object',
  'String',
  'Boolean',
  'Integer',
  'Long',
  'Float',
  'Array',
  'ReadonlyArray',
  'File',
  'Error',
  'Map',
  'Set',
  'Number',
  'Symbol',
  'BigInt',
  'Function',
  'Promise',
  'RegExp',
  'JSON',
]);

export const toTypeScriptModelName = (name: string): string => {
  const candidateName = toClassName(name);

  // Prepend underscore for any reserved model names
  return TYPESCRIPT_RESERVED_MODEL_NAMES.has(candidateName)
    ? `_${candidateName}`
    : candidateName;
};

/** Set of Python types that are built-ins and do not need forward-ref quoting. */
const PYTHON_BUILTIN_TYPES = new Set([
  'str',
  'int',
  'float',
  'bool',
  'bytes',
  'None',
  'Any',
  'datetime.date',
  'datetime.datetime',
]);

/**
 * Returns true if the given python type name is a built-in (not a user-defined
 * model).
 */
export const isPythonBuiltin = (type: string): boolean => {
  if (!type) return true;
  if (PYTHON_BUILTIN_TYPES.has(type)) return true;
  if (type.startsWith('list[') || type.startsWith('dict[')) return true;
  if (type.startsWith('Optional[') || type.startsWith('Union[')) return true;
  return false;
};

const toPythonPrimitive = (property: Model): string => {
  if (property.type === 'string' && property.format === 'date') {
    return 'datetime.date';
  } else if (property.type === 'string' && property.format === 'date-time') {
    return 'datetime.datetime';
  } else if (property.type === 'any' || property.type === 'unknown') {
    return 'Any';
  } else if (property.type === 'binary') {
    return 'bytes';
  } else if (property.type === 'null' || property.type === 'void') {
    return 'None';
  } else if (property.type === 'number') {
    if ((property as any).openapiType === 'integer') {
      return 'int';
    }

    switch (property.format) {
      case 'int32':
      case 'int64':
        return 'int';
      case 'float':
      case 'double':
      default:
        return 'float';
    }
  } else if (property.type === 'integer') {
    return 'int';
  } else if (property.type === 'boolean') {
    return 'bool';
  } else if (property.type === 'string') {
    return 'str';
  }
  // Fall-through is a user-defined model reference.  The py-client emits
  // classes using `typescriptName` (which escapes TS-reserved names like
  // `Error` → `_Error`), so references must use the same escaped form.
  return toTypeScriptModelName(property.type);
};

/**
 * Return the idiomatic Python type for a given property.
 *
 * Uses PEP-585 lower-case generics (`list[...]`, `dict[str, ...]`), fully-
 * qualified stdlib types (`datetime.date`, `datetime.datetime`), and `bytes`
 * for binary payloads.  Model references are returned as bare class names —
 * callers that emit the type inside a class body (where the class isn't yet
 * defined) should use `toPythonAnnotation` instead to get forward-ref quoting.
 */
/** Render an enum's values as a Python `Literal[...]` expression. */
const toPythonEnumLiteral = (property: Model): string => {
  const members = (property as any).enum as
    | Array<{ value: string | number | boolean | null }>
    | undefined;
  if (!members || members.length === 0) return toPythonPrimitive(property);
  const rendered = members
    .map((m) => {
      if (typeof m.value === 'string')
        return `"${m.value.replace(/"/g, '\\"')}"`;
      if (m.value === null) return 'None';
      return String(m.value);
    })
    .join(', ');
  return `Literal[${rendered}]`;
};

/**
 * Resolve the element type of a collection model.  Prefers the link's
 * already-computed `pythonType` if the link was mutated first, since
 * model mutation order isn't guaranteed to walk links before their
 * parents.
 *
 * When the element itself is an enum (anonymous or referenced) the type is
 * rendered as a `Literal[...]` so callers can't pass arbitrary values.
 */
const collectionElementType = (
  property: Model,
  link: Model | undefined,
): string => {
  if (link && link.export === 'enum') {
    return toPythonEnumLiteral(link);
  }
  if (link) {
    const precomputed = (link as any).pythonType as string | undefined;
    if (precomputed) return precomputed;
    return toPythonType(link);
  }
  // When no link is available but the collection itself carries enum members
  // (inline enum array/dict), render them as Literal too.
  if ((property as any).isEnum && (property as any).enum?.length > 0) {
    return toPythonEnumLiteral(property);
  }
  return toPythonPrimitive({ ...property, type: property.type } as Model);
};

export const toPythonType = (property: Model): string => {
  const propertyLink = flattenModelLink(property.link);
  switch (property.export) {
    case 'generic':
    case 'reference':
      return toPythonPrimitive(property);
    case 'array':
      return `list[${collectionElementType(property, propertyLink)}]`;
    case 'dictionary':
      return `dict[str, ${collectionElementType(property, propertyLink)}]`;
    case 'one-of':
    case 'any-of':
    case 'all-of':
      return toTypeScriptModelName(property.name);
    default:
      // "any"/"unknown" has export = interface — route to the primitive path
      // so they become `Any` rather than being treated as a model reference.
      if (PRIMITIVE_TYPES.has(property.type) || property.type === 'unknown') {
        return toPythonPrimitive(property);
      }
      // User-defined model reference — escape TS-reserved names so the
      // rendered type matches the emitted class (`Error` → `_Error`, etc.).
      return toTypeScriptModelName(property.type);
  }
};

/**
 * Prefix every user-defined (non-builtin) name in a python type string with
 * the given namespace (e.g. `"types_gen."`) so the caller can reference
 * model references through a single import.  Walks nested `list[...]`,
 * `dict[str, ...]`, `Optional[...]` and `Union[...]` structures.
 *
 * Example: `qualifyPythonType('list[Pet]', 'types_gen.')` → `'list[types_gen.Pet]'`.
 */
export const qualifyPythonType = (
  type: string | undefined,
  prefix: string,
): string => {
  if (!type) return 'Any';
  if (PYTHON_BUILTIN_TYPES.has(type)) return type;
  const list = /^list\[(.*)\]$/s.exec(type);
  if (list) return `list[${qualifyPythonType(list[1], prefix)}]`;
  const dict = /^dict\[str, (.*)\]$/s.exec(type);
  if (dict) return `dict[str, ${qualifyPythonType(dict[1], prefix)}]`;
  if (
    type.startsWith('Optional[') ||
    type.startsWith('Union[') ||
    type.startsWith('Literal[')
  ) {
    return type;
  }
  return `${prefix}${type}`;
};

/**
 * Same as `toPythonType`, but wraps user-defined (non-builtin) types in
 * forward-ref string quotes so they can be used inside class bodies before
 * the referenced class is defined.  Collections recursively forward-quote.
 */
export const toPythonAnnotation = (property: Model): string => {
  const render = (p: Model): string => {
    const link = flattenModelLink(p.link);
    switch (p.export) {
      case 'generic':
      case 'reference': {
        const rendered = toPythonPrimitive(p);
        return isPythonBuiltin(rendered) ? rendered : `"${rendered}"`;
      }
      case 'array': {
        const inner =
          link && link.export === 'enum'
            ? toPythonEnumLiteral(link)
            : link
              ? render(link)
              : (p as any).isEnum
                ? toPythonEnumLiteral(p)
                : toPythonPrimitive(p as Model);
        return `list[${inner}]`;
      }
      case 'dictionary': {
        const inner =
          link && link.export === 'enum'
            ? toPythonEnumLiteral(link)
            : link
              ? render(link)
              : (p as any).isEnum
                ? toPythonEnumLiteral(p)
                : toPythonPrimitive(p as Model);
        return `dict[str, ${inner}]`;
      }
      case 'one-of':
      case 'any-of':
      case 'all-of':
        return `"${toTypeScriptModelName(p.name)}"`;
      default: {
        if (p.type === 'unknown' || p.type === 'any') return 'Any';
        if (PRIMITIVE_TYPES.has(p.type)) {
          return toPythonPrimitive(p);
        }
        const escaped = toTypeScriptModelName(p.type);
        return isPythonBuiltin(escaped) ? escaped : `"${escaped}"`;
      }
    }
  };
  return render(property);
};

// @see https://github.com/OpenAPITools/openapi-generator/blob/e2a62ace74de361bef6338b7fa37da8577242aef/modules/openapi-generator/src/main/java/org/openapitools/codegen/languages/AbstractPythonCodegen.java#L106
const PYTHON_KEYWORDS = new Set([
  // @property
  'property',
  // typing keywords
  'schema',
  'base64',
  'json',
  'date',
  'float',
  // python reserved words
  'and',
  'del',
  'from',
  'not',
  'while',
  'as',
  'elif',
  'global',
  'or',
  'with',
  'assert',
  'else',
  'if',
  'pass',
  'yield',
  'break',
  'except',
  'import',
  'print',
  'class',
  'exec',
  'in',
  'raise',
  'continue',
  'finally',
  'is',
  'return',
  'def',
  'for',
  'lambda',
  'try',
  'self',
  'nonlocal',
  'None',
  'True',
  'False',
  'async',
  'await',
]);

export const toPythonName = (
  namedEntity: 'model' | 'property' | 'operation',
  name: string,
) => {
  const nameSnakeCase = snakeCase(name);

  // Check if the name is a reserved word.  Test both the raw name (reserved
  // words that overlap with TypeScript arrive with a leading `_` from
  // @hey-api/openapi-ts, which we strip before testing) and the snake-cased
  // form — snakeCase strips trailing underscores so `from_` becomes `from`
  // and would otherwise slip through.
  const rawStripped = name.startsWith('_') ? name.slice(1) : name;
  if (PYTHON_KEYWORDS.has(rawStripped) || PYTHON_KEYWORDS.has(nameSnakeCase)) {
    const nameSuffix = `_${nameSnakeCase}`;
    switch (namedEntity) {
      case 'model':
        return `model${nameSuffix}`;
      case 'operation':
        return `call${nameSuffix}`;
      case 'property':
        return `var${nameSuffix}`;
      default:
        break;
    }
  }
  return nameSnakeCase;
};
