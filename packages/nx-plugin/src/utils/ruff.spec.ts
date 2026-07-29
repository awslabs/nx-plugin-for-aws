/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';
import { RUFF_WASM_VERSION, ruffFixAndFormat } from './ruff';
import { PY_VERSIONS } from './versions';

const require = createRequire(import.meta.url);

/** The rule selection generated Python projects configure. */
const GENERATED_LINT = { select: ['E', 'F', 'UP', 'B', 'SIM', 'I'] };

describe('ruff wasm version', () => {
  it('should match the ruff pinned for generated projects', () => {
    // Generated files are formatted here but checked by the project's `format`
    // target, which runs the `PY_VERSIONS` ruff. A drift between the two would
    // make generated files fail `ruff format --check` on a formatting change,
    // so the two pins must be bumped together.
    expect(`==${RUFF_WASM_VERSION}`).toBe(PY_VERSIONS.ruff);
  });

  it('should report the version the wasm package declares', () => {
    // Guards against the package version and the ruff build inside it diverging.
    const { version } = require('@astral-sh/ruff-wasm-nodejs/package.json');
    expect(version).toBe(RUFF_WASM_VERSION);
  });
});

describe('ruffFixAndFormat', () => {
  it('should format to ruff style', () => {
    expect(
      ruffFixAndFormat("def  f( a,b ):\n  return {'x':1}\n", 'main.py', {}),
    ).toBe('def f(a, b):\n    return {"x": 1}\n');
  });

  it('should sort imports', () => {
    expect(
      ruffFixAndFormat('import sys\nimport os\nx = os, sys\n', 'main.py', {
        lint: { 'extend-select': ['I'] },
      }),
    ).toBe('import os\nimport sys\n\nx = os, sys\n');
  });

  it('should remove an unused import', () => {
    expect(ruffFixAndFormat('import os\nx = 1\n', 'main.py', {})).toBe(
      'x = 1\n',
    );
  });

  it('should split a multi-import statement', () => {
    expect(
      ruffFixAndFormat('import os, sys\nx = os, sys\n', 'main.py', {
        lint: GENERATED_LINT,
      }),
    ).toBe('import os\nimport sys\n\nx = os, sys\n');
  });

  it('should re-lint after fixing so a fix that exposes another is applied', () => {
    // Removing the duplicate `os` leaves the remaining imports unsorted, which
    // is only reported once the first fix has been applied.
    expect(
      ruffFixAndFormat(
        'import sys\nimport os\nimport os\nx = os, sys\n',
        'main.py',
        { lint: GENERATED_LINT },
      ),
    ).toBe('import os\nimport sys\n\nx = os, sys\n');
  });

  it("should keep an __init__.py's imports, which ruff treats as re-exports", () => {
    // Ruff reports an unused import in an `__init__.py` with no fix, because
    // removing it would drop the package's public API. The WASM bindings lint
    // under a placeholder filename and cannot see this, so the real name has to
    // be accounted for.
    expect(
      ruffFixAndFormat(
        'from .b import beta\nfrom .a import alpha\n',
        'packages/my_lib/my_lib/__init__.py',
        { lint: GENERATED_LINT },
      ),
    ).toBe('from .a import alpha\nfrom .b import beta\n');
  });

  it('should still remove an unused import outside an __init__.py', () => {
    expect(
      ruffFixAndFormat('from .a import alpha\n', 'main.py', {
        lint: GENERATED_LINT,
      }),
    ).toBe('');
  });

  it.each([
    ['a mutable default argument (B006)', 'def f(a=[]):\n    return a\n'],
    [
      'an if/else assignment (SIM108)',
      'x = 1\nif x:\n    y = 1\nelse:\n    y = 2\n',
    ],
    ['a truth comparison (E712)', 'x = 1\nif x == True:\n    pass\n'],
  ])('should not apply the unsafe fix for %s', (_name, source) => {
    // `ruff check --fix` withholds unsafe fixes, so applying them here would
    // rewrite code the user's own `lint --configuration=fix` leaves alone.
    expect(ruffFixAndFormat(source, 'main.py', { lint: GENERATED_LINT })).toBe(
      source,
    );
  });

  it.each([
    [
      'super() call (UP008)',
      'class A:\n    def f(self):\n        super(A, self).f()\n',
    ],
    ['redundant open mode (UP015)', 'open("f", "r")\n'],
    [
      'a dict keys() lookup (SIM118)',
      'd = {}\nif "a" in d.keys():\n    pass\n',
    ],
  ])('should not fix %s, which templates avoid', (_name, source) => {
    // Fixing is scoped to the import hygiene that generation itself introduces
    // (merging imports into an existing file). Templates are authored free of
    // other violations, so widening the scope would only add rules whose
    // applicability this would have to track as ruff evolves.
    expect(ruffFixAndFormat(source, 'main.py', { lint: GENERATED_LINT })).toBe(
      source,
    );
  });

  it('should honour line-length', () => {
    const source =
      'def compute(first_value, second_value, third_value, fourth_value, fifth_value, sixth_val):\n    return first_value\n';
    expect(ruffFixAndFormat(source, 'main.py', { 'line-length': 120 })).toBe(
      source,
    );
    expect(ruffFixAndFormat(source, 'main.py', { 'line-length': 88 })).not.toBe(
      source,
    );
  });

  it('should honour target-version', () => {
    // py314 drops the parentheses from a multi-exception `except`
    const source =
      'def f():\n    try:\n        pass\n    except (ValueError, KeyError):\n        pass\n';
    expect(
      ruffFixAndFormat(source, 'main.py', { 'target-version': 'py314' }),
    ).toContain('except ValueError, KeyError:');
    expect(
      ruffFixAndFormat(source, 'main.py', { 'target-version': 'py312' }),
    ).toContain('except (ValueError, KeyError):');
  });

  it('should honour known-first-party when grouping imports', () => {
    expect(
      ruffFixAndFormat(
        'import boto3\nfrom my_lib.core import helper\nx = boto3, helper\n',
        'main.py',
        {
          lint: {
            'extend-select': ['I'],
            isort: { 'known-first-party': ['my_lib'] },
          },
        },
      ),
    ).toBe(
      'import boto3\n\nfrom my_lib.core import helper\n\nx = boto3, helper\n',
    );
  });

  it('should respect a noqa directive', () => {
    const source = 'import os  # noqa: F401\n';
    expect(ruffFixAndFormat(source, 'main.py', {})).toBe(source);
  });

  it('should leave content with a syntax error untouched', () => {
    const source = 'def f(:\n';
    expect(ruffFixAndFormat(source, 'main.py', {})).toBe(source);
  });

  it('should handle empty content', () => {
    expect(ruffFixAndFormat('', 'main.py', {})).toBe('');
  });

  it('should locate edits correctly in content with astral characters', () => {
    // Positions are requested in UTF-16 so they index the string directly; a
    // byte- or codepoint-based reading would mislocate the edit.
    expect(
      ruffFixAndFormat('x = "🎉é"\nimport os\n', 'main.py', {
        lint: GENERATED_LINT,
      }),
    ).toBe('x = "🎉é"\n');
  });
});
