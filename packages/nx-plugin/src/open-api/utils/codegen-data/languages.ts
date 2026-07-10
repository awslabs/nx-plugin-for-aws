/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { camelCase, snakeCase, toClassName } from '../../../utils/names';
import { type Model, PRIMITIVE_TYPES } from './types';

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

// A nullable tuple member renders as a union with null.
const memberType = (rendered: string, member: Model): string =>
  member.isNullable && member.type !== 'null' ? `${rendered} | null` : rendered;

export const toTypeScriptType = (property: Model): string => {
  // A discriminated subtype's discriminator property renders as its literal
  // tag, making the union a true (narrowable) tagged union.
  if (property.discriminatorValue) {
    return property.discriminatorValue;
  }
  const link = property.link;
  // Enum links serialise as their primitive; use the model's own type instead.
  const valueType = () =>
    link && link.export !== 'enum' ? toTypeScriptType(link) : property.type;
  switch (property.export) {
    case 'enum':
    case 'generic':
      return toTypescriptPrimitive(property);
    case 'array':
      return `Array<${valueType()}>`;
    case 'tuple':
      return `[${property.properties
        .map((member) => memberType(toTypeScriptType(member), member))
        .join(', ')}]`;
    case 'dictionary':
      return `{ [key: string]: ${valueType()}; }`;
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
  // A name of only non-identifier characters (e.g. "_") camelCases to an empty
  // string; fall back to an underscore so the emitted property stays valid.
  return camelCase(name) || (name ?? '').replace(/[^a-zA-Z0-9]/g, '_') || '_';
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

/** Python types that are built-ins and do not need forward-ref quoting. */
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
 * Names that the generated `types_gen.py` and client modules import or define
 * at module scope. A user-defined schema named `Field`, `Optional`, etc.
 * would shadow these imports and either break forward-ref resolution
 * (`Optional["Field"]` resolves to `pydantic.Field` without escaping) or
 * silently produce invalid runtime types.
 *
 * Keep this aligned with the imports at the top of:
 *  - open-api/py-client/files/shared/types_gen.py.template
 *  - open-api/py-client/files/sync/client_gen.py.template
 *  - open-api/py-client/files/async/async_client_gen.py.template
 */
const PYTHON_RESERVED_MODEL_NAMES = new Set([
  // typing module
  'Annotated',
  'Any',
  'Literal',
  'Never',
  'Optional',
  'TypedDict',
  'Union',
  // pydantic
  'BaseModel',
  'ConfigDict',
  'Field',
  'TypeAdapter',
  // stdlib modules referenced in templates
  'Iterator',
  'AsyncIterator',
  // typing/python builtins that would also shadow primitives
  'None',
  'True',
  'False',
  'Type',
  // namespace import in client_gen.py — never let a user model collide
  'types_gen',
  // base exception we emit
  'ApiError',
]);

/**
 * Return the Python class name for a model. Starts from the TypeScript
 * escape (which already handles TS-reserved names like `Error` → `_Error`)
 * and additionally escapes names that would shadow imports in the generated
 * Python files.
 */
export const toPythonClassName = (name: string): string => {
  const tsName = toTypeScriptModelName(name);
  return PYTHON_RESERVED_MODEL_NAMES.has(tsName) ? `_${tsName}` : tsName;
};

/**
 * Returns true if the given python type name is a built-in (not a user-defined
 * model).
 */
export const isPythonBuiltin = (type: string): boolean => {
  if (!type) return true;
  if (PYTHON_BUILTIN_TYPES.has(type)) return true;
  if (type.startsWith('list[') || type.startsWith('dict[')) return true;
  if (type.startsWith('Optional[') || type.startsWith('Union[')) return true;
  if (type.startsWith('Literal[')) return true;
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
    if (property.openapiType === 'integer') {
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
  // Fall-through is a user-defined model reference. The py-client emits
  // classes using `pythonClassName`, so references use the same escaped form.
  return toPythonClassName(property.type);
};

/** Render an enum's values as a Python `Literal[...]` expression. */
const toPythonEnumLiteral = (property: Model): string => {
  const members = property.enum;
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
 * A discriminated subtype's discriminator property renders as its literal
 * tag(s). `discriminatorValue` is stored as rendered TypeScript literals
 * (e.g. `"cat" | "kitten"`); translate to `Literal["cat", "kitten"]`.
 */
const toPythonDiscriminatorLiteral = (discriminatorValue: string): string =>
  `Literal[${discriminatorValue.split(' | ').join(', ')}]`;

/**
 * Resolve the element type of a collection model. When the element is an
 * enum (anonymous or referenced) the type is rendered as a `Literal[...]`
 * so callers can't pass arbitrary values.
 */
const collectionElementType = (property: Model, link: Model | undefined) => {
  if (link && link.export === 'enum') {
    return toPythonEnumLiteral(link);
  }
  if (link) {
    return toPythonType(link);
  }
  // When no link is available but the collection itself carries enum members
  // (inline enum array/dict), render them as Literal too.
  if (property.isEnum && property.enum.length > 0) {
    return toPythonEnumLiteral(property);
  }
  return toPythonPrimitive(property);
};

/**
 * Return the idiomatic Python type for a given property.
 *
 * Uses PEP-585 lower-case generics (`list[...]`, `dict[str, ...]`), fully-
 * qualified stdlib types (`datetime.date`, `datetime.datetime`), `bytes` for
 * binary payloads, and `Literal[...]` for enums. Model references are
 * returned as bare class names — callers that emit the type inside a class
 * body (where the class isn't yet defined) should use `toPythonAnnotation`
 * instead to get forward-ref quoting.
 */
export const toPythonType = (property: Model): string => {
  if (property.discriminatorValue) {
    return toPythonDiscriminatorLiteral(property.discriminatorValue);
  }
  const link = property.link ?? undefined;
  switch (property.export) {
    case 'enum':
      return toPythonEnumLiteral(property);
    case 'generic':
    case 'reference':
      return toPythonPrimitive(property);
    case 'array':
      return `list[${collectionElementType(property, link)}]`;
    case 'tuple':
      return `tuple[${property.properties
        .map((member) => toPythonType(member))
        .join(', ')}]`;
    case 'dictionary':
      return `dict[str, ${collectionElementType(property, link)}]`;
    case 'one-of':
    case 'any-of':
    case 'all-of':
      return toPythonClassName(property.name);
    default:
      // "any"/"unknown" has export = interface — route to the primitive path
      // so they become `Any` rather than being treated as a model reference.
      if (PRIMITIVE_TYPES.has(property.type) || property.type === 'unknown') {
        return toPythonPrimitive(property);
      }
      return toPythonClassName(property.type);
  }
};

/**
 * Prefix every user-defined (non-builtin) name in a python type string with
 * the given namespace (e.g. `"types_gen."`) so the caller can reference
 * model references through a single import. Walks nested `list[...]` and
 * `dict[str, ...]` structures.
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
 * the referenced class is defined. Collections recursively forward-quote.
 */
export const toPythonAnnotation = (property: Model): string => {
  const render = (p: Model): string => {
    if (p.discriminatorValue) {
      return toPythonDiscriminatorLiteral(p.discriminatorValue);
    }
    const link = p.link ?? undefined;
    const collectionElement = () =>
      link && link.export === 'enum'
        ? toPythonEnumLiteral(link)
        : link
          ? render(link)
          : p.isEnum && p.enum.length > 0
            ? toPythonEnumLiteral(p)
            : toPythonPrimitive(p);
    switch (p.export) {
      case 'enum':
        return toPythonEnumLiteral(p);
      case 'generic':
      case 'reference': {
        const rendered = toPythonPrimitive(p);
        return isPythonBuiltin(rendered) ? rendered : `"${rendered}"`;
      }
      case 'array':
        return `list[${collectionElement()}]`;
      case 'dictionary':
        return `dict[str, ${collectionElement()}]`;
      case 'one-of':
      case 'any-of':
      case 'all-of':
        return `"${toPythonClassName(p.name)}"`;
      default: {
        if (PRIMITIVE_TYPES.has(p.type) || p.type === 'unknown') {
          return toPythonPrimitive(p);
        }
        const escaped = toPythonClassName(p.type);
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

  // Names overlapping a TypeScript reserved word carry a leading `_`; strip it
  // before testing against the Python keyword set. Also test the snake-cased
  // form — snakeCase strips trailing underscores, so `from_` becomes `from`
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
