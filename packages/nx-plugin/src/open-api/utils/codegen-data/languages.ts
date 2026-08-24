/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { camelCase, snakeCase, toClassName } from '../../../utils/names.js';
import { type Model, PRIMITIVE_TYPES, type PythonType } from './types.js';

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
 * Names that the generated `types.py` and client modules import or define
 * at module scope. A user-defined schema named `Field`, `Optional`, etc.
 * would shadow these imports and either break forward-ref resolution
 * (`Optional["Field"]` resolves to `pydantic.Field` without escaping) or
 * silently produce invalid runtime types.
 *
 * Keep this aligned with the imports at the top of:
 *  - open-api/py-client/files/shared/types.py.template
 *  - open-api/py-client/files/client/__clientModuleName__.py.template
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
  // namespace import in client.py — never let a user model collide
  'types',
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
 * Whether the rendered name is a Python built-in rather than a reference to a
 * generated class. Only bare names reach here — a structured type is described
 * by {@link PythonType} instead of being matched on its spelling.
 */
const isPythonBuiltinName = (name: string): boolean =>
  !name || PYTHON_BUILTIN_TYPES.has(name);

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

/**
 * Render a value as a Python literal expression: a quoted string with anything
 * that would break out of the quotes escaped, `None` for null, and the bare
 * value for numbers.
 */
export const toPythonLiteral = (value: unknown): string => {
  if (typeof value === 'string') {
    // Backslash first, so the escapes added below aren't escaped again.
    const escaped = value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    return `"${escaped}"`;
  }
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  return String(value);
};

/**
 * A discriminated subtype's tag values. `discriminatorValue` is stored as
 * rendered TypeScript literals (e.g. `"cat" | "kitten"`), which are already in
 * Python's literal spelling.
 */
const pythonDiscriminatorValues = (discriminatorValue: string): string[] =>
  discriminatorValue.split(' | ');

/** An enum's members as Python literal expressions. */
const pythonEnumValues = (property: Model): string[] =>
  (property.enum ?? []).map((member) => toPythonLiteral(member.value));

/**
 * The Python type of a collection's element. An enum element (anonymous or
 * referenced) becomes a `Literal[...]` so callers can't pass a value outside
 * the set.
 */
const pythonCollectionElementType = (
  property: Model,
  link: Model | undefined,
): PythonType => {
  if (link?.export === 'enum') {
    return { kind: 'literal', values: pythonEnumValues(link) };
  }
  if (link) {
    return toPythonTypeTree(link);
  }
  // No link, but the collection itself carries the enum members (an inline
  // enum array or dictionary).
  if (property.isEnum && property.enum.length > 0) {
    return { kind: 'literal', values: pythonEnumValues(property) };
  }
  return pythonPrimitiveType(property);
};

/** A primitive or model reference as a structured type. */
const pythonPrimitiveType = (property: Model): PythonType => {
  const name = toPythonPrimitive(property);
  return isPythonBuiltinName(name)
    ? { kind: 'builtin', name }
    : { kind: 'reference', name };
};

/**
 * The Python type of a property, as a tree.
 *
 * This is the single place a model's Python type is derived. Consumers that
 * need to know what a type is — a collection, a class reference, a literal —
 * inspect the tree rather than the rendered string, and render it with
 * {@link renderPythonType} when they need source text.
 */
export const toPythonTypeTree = (property: Model): PythonType => {
  if (property.discriminatorValue) {
    return {
      kind: 'literal',
      values: pythonDiscriminatorValues(property.discriminatorValue),
    };
  }
  const link = property.link ?? undefined;
  switch (property.export) {
    case 'enum':
      return property.enum?.length
        ? { kind: 'literal', values: pythonEnumValues(property) }
        : pythonPrimitiveType(property);
    case 'generic':
    case 'reference':
      return pythonPrimitiveType(property);
    case 'array':
      return {
        kind: 'list',
        element: pythonCollectionElementType(property, link),
      };
    case 'tuple':
      return {
        kind: 'tuple',
        members: property.properties.map((member) => toPythonTypeTree(member)),
      };
    case 'dictionary':
      return {
        kind: 'dict',
        value: pythonCollectionElementType(property, link),
      };
    case 'one-of':
    case 'any-of':
    case 'all-of':
      return { kind: 'reference', name: toPythonClassName(property.name) };
    default: {
      // "any"/"unknown" has export = interface — route to the primitive path so
      // they become `Any` rather than being treated as a model reference.
      if (PRIMITIVE_TYPES.has(property.type) || property.type === 'unknown') {
        return pythonPrimitiveType(property);
      }
      const name = toPythonClassName(property.type);
      return isPythonBuiltinName(name)
        ? { kind: 'builtin', name }
        : { kind: 'reference', name };
    }
  }
};

/** How a reference to a generated class is spelled where it is rendered. */
export interface RenderPythonTypeOptions {
  /**
   * Namespace prefix for a class reference, e.g. `"types."` from a client
   * module that imports the types module wholesale.
   */
  readonly prefix?: string;
  /**
   * Wrap a class reference in quotes, for use inside a class body before the
   * referenced class is defined. pydantic resolves these lazily.
   */
  readonly forwardRef?: boolean;
}

/** Render a structured Python type as source text. */
export const renderPythonType = (
  type: PythonType,
  options: RenderPythonTypeOptions = {},
): string => {
  const render = (t: PythonType): string => {
    switch (t.kind) {
      case 'builtin':
        return t.name;
      case 'reference': {
        const qualified = `${options.prefix ?? ''}${t.name}`;
        return options.forwardRef ? `"${qualified}"` : qualified;
      }
      case 'literal':
        return `Literal[${t.values.join(', ')}]`;
      case 'list':
        return `list[${render(t.element)}]`;
      case 'dict':
        return `dict[str, ${render(t.value)}]`;
      case 'tuple':
        return `tuple[${t.members.map(render).join(', ')}]`;
      case 'optional': {
        // PEP 604, which is what the ruff rules generated Python projects vend
        // (`UP045`) require, and what every other Python template here emits.
        const inner = render(t.inner);
        return inner === 'None' ? inner : `${inner} | None`;
      }
    }
  };
  return render(type);
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
export const toPythonType = (property: Model): string =>
  renderPythonType(toPythonTypeTree(property));

/**
 * Render a type with every class reference prefixed with the given namespace,
 * so a client module can reach the types module through a single import.
 */
export const qualifyPythonType = (
  type: PythonType | undefined,
  prefix: string,
): string => (type ? renderPythonType(type, { prefix }) : 'Any');

/**
 * Same as `toPythonType`, but wraps class references in forward-ref quotes so
 * they can be used inside a class body before the class is defined.
 */
export const toPythonAnnotation = (property: Model): string =>
  renderPythonType(toPythonTypeTree(property), { forwardRef: true });

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

/**
 * Names pydantic reserves on a `BaseModel`. A field called `model_dump` or
 * `model_config` would either shadow the method callers rely on or replace the
 * `ConfigDict` the generated class sets, so they are escaped like a keyword.
 *
 * `model_` is pydantic's protected namespace, so anything in it is escaped
 * rather than only the members that exist today.
 */
const isPydanticReservedName = (name: string): boolean =>
  name.startsWith('model_') || name === 'model_fields' || name === 'schema';

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
  const isPydanticReserved =
    namedEntity === 'property' &&
    (isPydanticReservedName(rawStripped) ||
      isPydanticReservedName(nameSnakeCase));
  if (
    isPydanticReserved ||
    PYTHON_KEYWORDS.has(rawStripped) ||
    PYTHON_KEYWORDS.has(nameSnakeCase)
  ) {
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
