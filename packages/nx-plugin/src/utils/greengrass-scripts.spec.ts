/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { generateFiles } from '@nx/devkit';
import { createTree } from '@nx/devkit/testing';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const renderTemplate = (relativePath: string): string => {
  const tree = createTree();
  const sourceDir = join(
    import.meta.dirname,
    'files',
    'common',
    'scripts',
    'src',
    'greengrass',
  );
  generateFiles(tree, sourceDir, 'rendered', { esm: true });

  const renderedPath = join(
    'rendered',
    relativePath.replace(/\.template$/, ''),
  );
  const rendered = tree.read(renderedPath, 'utf-8');
  if (rendered === null) {
    throw new Error(`Template did not produce ${renderedPath}`);
  }
  return rendered;
};

const transpileTemplate = (templateFileName: string): string =>
  ts.transpileModule(renderTemplate(templateFileName), {
    compilerOptions: { module: ts.ModuleKind.ESNext },
  }).outputText;

// Unlike the plugin's own `importTypeScriptModule` (a `data:` URL import,
// which cannot resolve bare package specifiers because it has no real
// location to resolve `node_modules` against), these templates import real npm
// packages (`js-yaml`). So the module is written to a real temporary file next
// to this spec instead, which resolves against this package's own installed
// dependencies exactly as the vended copy resolves against the shared-scripts
// project's dependencies.
const importVendedModule = async <T>(templateFileName: string): Promise<T> => {
  const jsCode = transpileTemplate(templateFileName);
  const tempPath = join(
    import.meta.dirname,
    `.tmp-${templateFileName.replace(/\W/g, '-')}-${process.pid}-${Date.now()}.mjs`,
  );
  writeFileSync(tempPath, jsCode);
  try {
    return (await import(pathToFileURL(tempPath).href)) as T;
  } finally {
    unlinkSync(tempPath);
  }
};

interface RecipeUtilsModule {
  loadRecipe: (recipePath: string) => Record<string, unknown>;
  validateRecipe: (
    recipe: Record<string, unknown>,
    artifactBaseNames: readonly string[],
  ) => {
    componentName: string;
    componentVersion: string;
    recipe: Record<string, unknown>;
  };
  validateManifestArchitectures: (
    recipe: Record<string, unknown>,
    baseNameByArchitecture: Readonly<Record<string, string>>,
  ) => void;
  readResolvedRecipe: (recipesDir: string) => {
    componentName: string;
    componentVersion: string;
  };
  resolveLocalNextVersion: (
    installedVersion: string | undefined,
    candidateVersions: readonly string[],
    sentinel: 'NEXT_PATCH' | 'NEXT_MINOR' | 'NEXT_MAJOR',
  ) => string;
}

interface ZipWriterModule {
  writeZip: (
    entries: readonly { name: string; data: Buffer }[],
    outPath: string,
  ) => void;
}

/** Minimal independent ZIP reader used only to verify the vended scripts' output. */
function readZipEntries(buf: Buffer): { name: string; data: Buffer }[] {
  const entries: { name: string; data: Buffer }[] = [];
  let offset = 0;
  while (offset < buf.length && buf.readUInt32LE(offset) === 0x04034b50) {
    const method = buf.readUInt16LE(offset + 8);
    const compressedSize = buf.readUInt32LE(offset + 18);
    const uncompressedSize = buf.readUInt32LE(offset + 22);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLen + extraLen;
    const name = buf.toString('utf-8', nameStart, nameStart + nameLen);
    const compressed = buf.subarray(dataStart, dataStart + compressedSize);
    const data = method === 8 ? inflateRawSync(compressed) : compressed;
    expect(data.length).toBe(uncompressedSize);
    entries.push({ name, data });
    offset = dataStart + compressedSize;
  }
  return entries;
}

describe('greengrass recipe-utils.ts', () => {
  let loadRecipe: RecipeUtilsModule['loadRecipe'];
  let validateRecipe: RecipeUtilsModule['validateRecipe'];
  let validateManifestArchitectures: RecipeUtilsModule['validateManifestArchitectures'];
  let readResolvedRecipe: RecipeUtilsModule['readResolvedRecipe'];
  let resolveLocalNextVersion: RecipeUtilsModule['resolveLocalNextVersion'];
  let tmpDir: string;

  beforeAll(async () => {
    const mod = await importVendedModule<RecipeUtilsModule>(
      'recipe-utils.ts.template',
    );
    loadRecipe = mod.loadRecipe;
    validateRecipe = mod.validateRecipe;
    validateManifestArchitectures = mod.validateManifestArchitectures;
    readResolvedRecipe = mod.readResolvedRecipe;
    resolveLocalNextVersion = mod.resolveLocalNextVersion;
  });

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'greengrass-recipe-utils-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const validRecipe = () => ({
    RecipeFormatVersion: '2020-01-25',
    ComponentName: 'com.example.MyComponent',
    ComponentVersion: '1.0.0',
    ComponentDescription: 'A test component',
    Manifests: [
      {
        Platform: { os: 'linux' },
        Artifacts: [
          {
            Uri: 's3://BUCKET_NAME/COMPONENT_NAME/COMPONENT_VERSION/my-component.zip',
            Unarchive: 'ZIP',
          },
        ],
        Lifecycle: {
          Run: 'python3 {artifacts:decompressedPath}/my-component/main.py',
        },
      },
    ],
  });

  describe('validateRecipe', () => {
    it('should accept a valid recipe and resolve its name and version', () => {
      const recipe = validRecipe();
      const resolved = validateRecipe(recipe, ['my-component']);
      expect(resolved.componentName).toBe('com.example.MyComponent');
      expect(resolved.componentVersion).toBe('1.0.0');
    });

    it('should preserve unknown keys untouched', () => {
      const recipe = { ...validRecipe(), SomeUnknownKey: { nested: true } };
      const resolved = validateRecipe(recipe, ['my-component']);
      expect(resolved.recipe.SomeUnknownKey).toEqual({ nested: true });
    });

    it('should reject a missing ComponentName', () => {
      const recipe = validRecipe() as Record<string, unknown>;
      delete recipe.ComponentName;
      expect(() => validateRecipe(recipe, ['my-component'])).toThrow(
        /ComponentName is required/,
      );
    });

    it('should reject illegal ComponentName characters', () => {
      const recipe = { ...validRecipe(), ComponentName: 'com/example!bad' };
      expect(() => validateRecipe(recipe, ['my-component'])).toThrow(
        /may only contain letters, numbers/,
      );
    });

    it('should reject the reserved aws.greengrass. prefix', () => {
      const recipe = {
        ...validRecipe(),
        ComponentName: 'aws.greengrass.MyComponent',
      };
      expect(() => validateRecipe(recipe, ['my-component'])).toThrow(
        /reserved prefix/,
      );
    });

    it('should reject a ComponentName over 128 characters', () => {
      const recipe = { ...validRecipe(), ComponentName: 'a'.repeat(129) };
      expect(() => validateRecipe(recipe, ['my-component'])).toThrow(
        /at most 128 characters/,
      );
    });

    it('should reject a non-semver ComponentVersion', () => {
      const recipe = { ...validRecipe(), ComponentVersion: 'v1.0' };
      expect(() => validateRecipe(recipe, ['my-component'])).toThrow(
        /valid semver version/,
      );
    });

    it.each(['NEXT_PATCH', 'NEXT_MINOR', 'NEXT_MAJOR'])(
      'should accept %s as a ComponentVersion',
      (componentVersion) => {
        expect(() =>
          validateRecipe(
            { ...validRecipe(), ComponentVersion: componentVersion },
            ['my-component'],
          ),
        ).not.toThrow();
      },
    );

    it('should reject when no lifecycle script references the decompressed component dir', () => {
      const recipe = {
        ...validRecipe(),
        Manifests: [
          {
            Lifecycle: {
              Run: 'python3 {artifacts:decompressedPath}/wrong-dir/main.py',
            },
          },
        ],
      };
      expect(() => validateRecipe(recipe, ['my-component'])).toThrow(
        /Run script path must match the artifact zip base name/,
      );
    });

    it('should still reject a broken Run path when an Install step names the component dir', () => {
      // A pre-vendoring ipc=true recipe: an Install step that `cd`s into the
      // decompressed dir. It carries no trailing slash, so it cannot stand in
      // for the Run path's reference and mask a broken one - the same
      // trailing-slash rule that protects the vendored-addon shape below.
      const recipe = {
        ...validRecipe(),
        Manifests: [
          {
            Artifacts: [
              {
                Uri: 's3://BUCKET_NAME/COMPONENT_NAME/COMPONENT_VERSION/my-component.zip',
                Unarchive: 'ZIP',
              },
            ],
            Lifecycle: {
              Install:
                'cd {artifacts:decompressedPath}/my-component && npm install --omit=dev',
              Run: 'node {artifacts:decompressedPath}/wrong-dir/index.js',
            },
          },
        ],
      };
      expect(() => validateRecipe(recipe, ['my-component'])).toThrow(
        /Run script path must match the artifact zip base name/,
      );
    });

    it('should accept the vendored-addon ipc shape, whose Run still names the decompressed component dir', () => {
      const recipe = {
        ...validRecipe(),
        Manifests: [
          {
            Artifacts: [
              {
                Uri: 's3://BUCKET_NAME/COMPONENT_NAME/COMPONENT_VERSION/my-component.zip',
                Unarchive: 'ZIP',
              },
            ],
            Lifecycle: {
              Setenv: {
                AWS_CRT_NODEJS_BINARY_RELATIVE_PATH:
                  'native/aws-crt/linux-arm64-glibc/aws-crt-nodejs.node',
              },
              Run: 'node {artifacts:decompressedPath}/my-component/index.js',
            },
          },
        ],
      };
      expect(() => validateRecipe(recipe, ['my-component'])).not.toThrow();
    });

    it('should accept a top-level Lifecycle block, not only per-manifest', () => {
      const recipe = {
        ComponentName: 'com.example.MyComponent',
        ComponentVersion: '1.0.0',
        Lifecycle: {
          Run: 'python3 {artifacts:decompressedPath}/my-component/main.py',
        },
        Manifests: [
          {
            Artifacts: [
              {
                Uri: 's3://BUCKET_NAME/COMPONENT_NAME/COMPONENT_VERSION/my-component.zip',
                Unarchive: 'ZIP',
              },
            ],
          },
        ],
      };
      expect(() => validateRecipe(recipe, ['my-component'])).not.toThrow();
    });

    it('should reject a recipe declaring no artifact for the component zip', () => {
      const recipe = validRecipe() as Record<string, unknown>;
      recipe.Manifests = [
        {
          Lifecycle: {
            Run: 'python3 {artifacts:decompressedPath}/my-component/main.py',
          },
        },
      ];
      expect(() => validateRecipe(recipe, ['my-component'])).toThrow(
        /No manifest declares an artifact whose Uri ends in "\/my-component\.zip"/,
      );
    });

    it('should reject an artifact Uri whose basename is not the component zip', () => {
      const recipe = validRecipe() as Record<string, unknown>;
      recipe.Manifests = [
        {
          Artifacts: [
            {
              Uri: 's3://BUCKET_NAME/COMPONENT_NAME/COMPONENT_VERSION/renamed.zip',
            },
          ],
          Lifecycle: {
            Run: 'python3 {artifacts:decompressedPath}/my-component/main.py',
          },
        },
      ];
      expect(() => validateRecipe(recipe, ['my-component'])).toThrow(
        /No manifest declares an artifact whose Uri ends in/,
      );
    });

    it('should accept an artifact spelled URI rather than Uri', () => {
      const recipe = validRecipe() as Record<string, unknown>;
      recipe.Manifests = [
        {
          Artifacts: [
            {
              URI: 's3://BUCKET_NAME/COMPONENT_NAME/COMPONENT_VERSION/my-component.zip',
            },
          ],
          Lifecycle: {
            Run: 'python3 {artifacts:decompressedPath}/my-component/main.py',
          },
        },
      ];
      expect(() => validateRecipe(recipe, ['my-component'])).not.toThrow();
    });

    it('should collect every violation in one error', () => {
      const recipe = { ComponentName: 'aws.greengrass.bad name!' };
      let thrown: Error | undefined;
      try {
        validateRecipe(recipe, ['my-component']);
      } catch (e) {
        thrown = e as Error;
      }
      expect(thrown).toBeDefined();
      expect(thrown?.message).toMatch(/reserved prefix/);
      expect(thrown?.message).toMatch(/may only contain letters, numbers/);
      expect(thrown?.message).toMatch(/ComponentVersion is required/);
      expect(thrown?.message).toMatch(/Run script path must match/);
      expect(thrown?.message).toMatch(/No manifest declares an artifact/);
    });

    it('should accept a recipe declaring and referencing every base name', () => {
      const recipe = {
        ...validRecipe(),
        Manifests: [
          {
            Platform: { os: 'linux', architecture: 'amd64' },
            Artifacts: [
              {
                Uri: 's3://BUCKET_NAME/COMPONENT_NAME/COMPONENT_VERSION/my-component-amd64.zip',
                Unarchive: 'ZIP',
              },
            ],
            Lifecycle: {
              Run: 'python3 {artifacts:decompressedPath}/my-component-amd64/main.py',
            },
          },
          {
            Platform: { os: 'linux', architecture: 'aarch64' },
            Artifacts: [
              {
                Uri: 's3://BUCKET_NAME/COMPONENT_NAME/COMPONENT_VERSION/my-component-aarch64.zip',
                Unarchive: 'ZIP',
              },
            ],
            Lifecycle: {
              Run: 'python3 {artifacts:decompressedPath}/my-component-aarch64/main.py',
            },
          },
        ],
      };
      expect(() =>
        validateRecipe(recipe, ['my-component-amd64', 'my-component-aarch64']),
      ).not.toThrow();
    });

    it('should reject a base name no lifecycle script references', () => {
      const recipe = {
        ...validRecipe(),
        Manifests: [
          {
            Artifacts: [
              {
                Uri: 's3://BUCKET_NAME/COMPONENT_NAME/COMPONENT_VERSION/my-component-amd64.zip',
                Unarchive: 'ZIP',
              },
            ],
            Lifecycle: {
              Run: 'python3 {artifacts:decompressedPath}/my-component-amd64/main.py',
            },
          },
        ],
      };
      expect(() =>
        validateRecipe(recipe, ['my-component-amd64', 'my-component-aarch64']),
      ).toThrow(
        /No lifecycle script references "\{artifacts:decompressedPath\}\/my-component-aarch64\/"/,
      );
    });

    it('should reject a base name no manifest declares as an artifact', () => {
      const recipe = {
        ...validRecipe(),
        Manifests: [
          {
            Artifacts: [
              {
                Uri: 's3://BUCKET_NAME/COMPONENT_NAME/COMPONENT_VERSION/my-component-amd64.zip',
                Unarchive: 'ZIP',
              },
            ],
            Lifecycle: {
              Run: 'python3 {artifacts:decompressedPath}/my-component-amd64/main.py\npython3 {artifacts:decompressedPath}/my-component-aarch64/main.py',
            },
          },
        ],
      };
      expect(() =>
        validateRecipe(recipe, ['my-component-amd64', 'my-component-aarch64']),
      ).toThrow(
        /No manifest declares an artifact whose Uri ends in "\/my-component-aarch64\.zip"/,
      );
    });
  });

  describe('validateManifestArchitectures', () => {
    const BASE_NAMES = {
      amd64: 'my-component-amd64',
      aarch64: 'my-component-aarch64',
    };

    /** One manifest, with independently chosen artifact and Run base names. */
    const manifest = (
      architecture: string,
      artifactBaseName: string,
      runBaseName: string = artifactBaseName,
    ) => ({
      Platform: { os: 'linux', architecture },
      Artifacts: [
        {
          Uri: `s3://BUCKET_NAME/COMPONENT_NAME/COMPONENT_VERSION/${artifactBaseName}.zip`,
          Unarchive: 'ZIP',
        },
      ],
      Lifecycle: {
        Run: `python3 {artifacts:decompressedPath}/${runBaseName}/main.py`,
      },
    });

    it('should accept manifests each paired with their own architecture', () => {
      const recipe = {
        ...validRecipe(),
        Manifests: [
          manifest('amd64', 'my-component-amd64'),
          manifest('aarch64', 'my-component-aarch64'),
        ],
      };
      expect(() =>
        validateManifestArchitectures(recipe, BASE_NAMES),
      ).not.toThrow();
    });

    it('should reject two manifests whose artifacts and Run paths are swapped', () => {
      // Both base names are still declared and referenced somewhere, so
      // validateRecipe passes - only the per-manifest pairing catches this.
      const recipe = {
        ...validRecipe(),
        Manifests: [
          manifest('amd64', 'my-component-aarch64'),
          manifest('aarch64', 'my-component-amd64'),
        ],
      };
      expect(() =>
        validateRecipe(recipe, ['my-component-amd64', 'my-component-aarch64']),
      ).not.toThrow();

      let thrown: Error | undefined;
      try {
        validateManifestArchitectures(recipe, BASE_NAMES);
      } catch (e) {
        thrown = e as Error;
      }
      expect(thrown?.message).toMatch(
        /Manifest 1 declares "architecture: amd64", so its own artifact Uri must end in "\/my-component-amd64\.zip"/,
      );
      expect(thrown?.message).toMatch(
        /Manifest 2 declares "architecture: aarch64", so its own artifact Uri must end in "\/my-component-aarch64\.zip"/,
      );
    });

    it("should reject a manifest whose lifecycle runs another architecture's directory", () => {
      const recipe = {
        ...validRecipe(),
        Manifests: [
          manifest('amd64', 'my-component-amd64', 'my-component-aarch64'),
          manifest('aarch64', 'my-component-aarch64'),
        ],
      };
      expect(() => validateManifestArchitectures(recipe, BASE_NAMES)).toThrow(
        /Manifest 1 declares "architecture: amd64", so its lifecycle must reference "\{artifacts:decompressedPath\}\/my-component-amd64\/"/,
      );
    });

    it('should accept a manifest whose lifecycle lives at the recipe top level', () => {
      const recipe = {
        ...validRecipe(),
        Lifecycle: {
          Run: 'python3 {artifacts:decompressedPath}/my-component-amd64/main.py',
        },
        Manifests: [
          {
            Platform: { os: 'linux', architecture: 'amd64' },
            Artifacts: [
              {
                Uri: 's3://BUCKET_NAME/COMPONENT_NAME/COMPONENT_VERSION/my-component-amd64.zip',
                Unarchive: 'ZIP',
              },
            ],
          },
        ],
      };
      expect(() =>
        validateManifestArchitectures(recipe, { amd64: 'my-component-amd64' }),
      ).not.toThrow();
    });

    it('should ignore manifests this build does not target', () => {
      const recipe = {
        ...validRecipe(),
        Manifests: [
          manifest('amd64', 'my-component-amd64'),
          // A hand-added manifest for an architecture this toolchain neither
          // vendors nor names, plus one with no architecture at all.
          manifest('armv7l', 'my-component-armv7l'),
          {
            Platform: { os: 'linux' },
            Artifacts: [{ Uri: 's3://bucket/anything.zip' }],
            Lifecycle: { Run: 'python3 anything.py' },
          },
        ],
      };
      expect(() =>
        validateManifestArchitectures(recipe, { amd64: 'my-component-amd64' }),
      ).not.toThrow();
    });
  });

  describe('loadRecipe', () => {
    it('should load and parse a recipe.yaml from disk', () => {
      const recipePath = join(tmpDir, 'recipe.yaml');
      writeFileSync(
        recipePath,
        'ComponentName: com.example.MyComponent\nComponentVersion: 1.0.0\n',
      );
      const recipe = loadRecipe(recipePath);
      expect(recipe.ComponentName).toBe('com.example.MyComponent');
    });

    it('should throw a clear message when the file is missing', () => {
      expect(() => loadRecipe(join(tmpDir, 'missing.yaml'))).toThrow(
        /Cannot read recipe/,
      );
    });

    it('should throw when the document is not an object', () => {
      const recipePath = join(tmpDir, 'recipe.yaml');
      writeFileSync(recipePath, '- just\n- a\n- list\n');
      expect(() => loadRecipe(recipePath)).toThrow(
        /is not a Greengrass recipe document/,
      );
    });
  });

  describe('readResolvedRecipe', () => {
    it('should read the single resolved recipe in a directory', () => {
      writeFileSync(
        join(tmpDir, 'com.example.MyComponent-1.0.0.yaml'),
        'ComponentName: com.example.MyComponent\nComponentVersion: 1.0.0\n',
      );
      const resolved = readResolvedRecipe(tmpDir);
      expect(resolved.componentName).toBe('com.example.MyComponent');
      expect(resolved.componentVersion).toBe('1.0.0');
    });

    it('should throw when the directory does not exist', () => {
      expect(() => readResolvedRecipe(join(tmpDir, 'does-not-exist'))).toThrow(
        /run the component's "-artifact" target first/,
      );
    });

    it('should throw when more than one recipe is present', () => {
      writeFileSync(join(tmpDir, 'a-1.0.0.yaml'), 'ComponentName: a\n');
      writeFileSync(join(tmpDir, 'b-1.0.0.yaml'), 'ComponentName: b\n');
      expect(() => readResolvedRecipe(tmpDir)).toThrow(
        /Expected exactly one resolved recipe/,
      );
    });
  });

  describe('resolveLocalNextVersion', () => {
    it.each([
      [undefined, [], 'NEXT_PATCH', '1.0.0'],
      [undefined, [], 'NEXT_MINOR', '1.0.0'],
      [undefined, [], 'NEXT_MAJOR', '1.0.0'],
      ['1.4.2', [], 'NEXT_PATCH', '1.4.3'],
      ['1.4.2', [], 'NEXT_MINOR', '1.5.0'],
      ['1.4.2', [], 'NEXT_MAJOR', '2.0.0'],
      ['1.4.2', ['1.5.0', '1.4.9'], 'NEXT_PATCH', '1.5.1'],
      [undefined, ['1.4.2', '2.0.0'], 'NEXT_MINOR', '2.1.0'],
      ['1.4.2', ['1.5.0-beta.1', 'not-a-version'], 'NEXT_PATCH', '1.4.3'],
    ] as const)(
      'should resolve installed %s and candidates %j with %s to %s',
      (installedVersion, candidateVersions, sentinel, resolvedVersion) => {
        expect(
          resolveLocalNextVersion(
            installedVersion,
            candidateVersions,
            sentinel,
          ),
        ).toBe(resolvedVersion);
      },
    );

    it('should reject an installed version that is not strict M.m.p', () => {
      expect(() =>
        resolveLocalNextVersion('1.4.2-beta.1', [], 'NEXT_MINOR'),
      ).toThrow('Installed component version "1.4.2-beta.1"');
      expect(() =>
        resolveLocalNextVersion('1.4.2-beta.1', [], 'NEXT_MINOR'),
      ).toThrow('NEXT_MINOR');
    });
  });
});

describe('greengrass zip-writer.ts', () => {
  let writeZip: ZipWriterModule['writeZip'];
  let tmpDir: string;

  beforeAll(async () => {
    const mod = await importVendedModule<ZipWriterModule>(
      'zip-writer.ts.template',
    );
    writeZip = mod.writeZip;
  });

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'greengrass-zip-writer-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should round-trip multiple files with their exact contents', () => {
    const outPath = join(tmpDir, 'out.zip');
    const entries = [
      { name: 'main.py', data: Buffer.from('print("hello")\n') },
      { name: 'vendor/lib/pkg.py', data: Buffer.from('x = 1\n') },
      { name: 'binary.dat', data: Buffer.from([0, 1, 2, 255, 254, 253]) },
    ];
    writeZip(entries, outPath);

    const read = readZipEntries(readFileSync(outPath));
    expect(read.map((e) => e.name).sort()).toEqual(
      entries.map((e) => e.name).sort(),
    );
    for (const entry of entries) {
      const found = read.find((e) => e.name === entry.name);
      expect(found?.data).toEqual(entry.data);
    }
  });

  it('should use forward slashes for nested entry names', () => {
    const outPath = join(tmpDir, 'out.zip');
    writeZip([{ name: 'a/b/c.txt', data: Buffer.from('x') }], outPath);
    const [entry] = readZipEntries(readFileSync(outPath));
    expect(entry.name).toBe('a/b/c.txt');
  });

  it('should round-trip incompressible (random) data via the STORED fallback', () => {
    const outPath = join(tmpDir, 'out.zip');
    const random = Buffer.from(
      Array.from({ length: 256 }, (_, i) => (i * 97 + 13) % 256),
    );
    writeZip([{ name: 'random.bin', data: random }], outPath);
    const [entry] = readZipEntries(readFileSync(outPath));
    expect(entry.data).toEqual(random);
  });

  it('should be byte-reproducible across writes and entry orderings', () => {
    const entries = [
      { name: 'main.py', data: Buffer.from('print("hi")\n') },
      { name: 'vendor/dep.py', data: Buffer.from('VERSION = "1.0"\n') },
    ];
    const first = join(tmpDir, 'first.zip');
    const second = join(tmpDir, 'second.zip');

    writeZip(entries, first);
    writeZip([...entries].reverse(), second);

    // The archive's sha256 keys the published S3 object and is substituted
    // into the recipe, so identical content must always produce identical
    // bytes - otherwise a rebuild asks CloudFormation to replace an
    // already-published, immutable component version.
    expect(readFileSync(first).equals(readFileSync(second))).toBe(true);
  });

  it('should produce a parseable archive for an empty entry list', () => {
    const outPath = join(tmpDir, 'out.zip');
    writeZip([], outPath);
    const buf = readFileSync(outPath);
    // Just the End Of Central Directory record, with zero entries.
    expect(buf.readUInt32LE(0)).toBe(0x06054b50);
    expect(buf.readUInt16LE(10)).toBe(0);
  });

  it('should reject more than 65,535 entries before starting to build the archive', () => {
    const outPath = join(tmpDir, 'out.zip');
    const entries = new Array(65_536) as ZipEntry[];

    expect(() => writeZip(entries, outPath)).toThrow(
      'ZIP64 is not supported; this ZIP writer can store at most 65,535 entries, received 65536.',
    );
    expect(existsSync(outPath)).toBe(false);
  });
});

const multiArchRecipe = () =>
  [
    'ComponentName: com.example.MyComponent',
    'ComponentVersion: 1.0.0',
    'Manifests:',
    '  - Platform:',
    '      os: linux',
    '      architecture: amd64',
    '    Artifacts:',
    '      - Uri: s3://bucket/my-component-amd64.zip',
    '        Unarchive: ZIP',
    '    Lifecycle:',
    '      Run: python3 {artifacts:decompressedPath}/my-component-amd64/main.py',
    '  - Platform:',
    '      os: linux',
    '      architecture: aarch64',
    '    Artifacts:',
    '      - Uri: s3://bucket/my-component-aarch64.zip',
    '        Unarchive: ZIP',
    '    Lifecycle:',
    '      Run: python3 {artifacts:decompressedPath}/my-component-aarch64/main.py',
    '',
  ].join('\n');

describe('greengrass build-artifact.ts', () => {
  let tmpDir: string;
  let scriptsDir: string;
  let writeZip: ZipWriterModule['writeZip'];

  beforeAll(async () => {
    const mod = await importVendedModule<ZipWriterModule>(
      'zip-writer.ts.template',
    );
    writeZip = mod.writeZip;
  });

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'greengrass-build-artifact-'));
    scriptsDir = mkdtempSync(
      join(import.meta.dirname, '.tmp-greengrass-build-artifact-'),
    );
    writeFileSync(
      join(scriptsDir, 'recipe-utils.mjs'),
      transpileTemplate('recipe-utils.ts.template'),
    );
    writeFileSync(
      join(scriptsDir, 'zip-writer.mjs'),
      transpileTemplate('zip-writer.ts.template'),
    );
    writeFileSync(
      join(scriptsDir, 'build-artifact.mjs'),
      transpileTemplate('build-artifact.ts.template')
        .replaceAll('./recipe-utils.js', './recipe-utils.mjs')
        .replaceAll('./zip-writer.js', './zip-writer.mjs'),
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    rmSync(scriptsDir, { recursive: true, force: true });
  });

  it('should exclude staging __pycache__ files and .lock entries', () => {
    const projectRoot = join(tmpDir, 'project');
    const componentDir = join(projectRoot, 'greengrass', 'my-component');
    const distDir = join(tmpDir, 'dist');
    const vendorDir = join(distDir, 'vendor');
    mkdirSync(join(componentDir, '__pycache__'), { recursive: true });
    mkdirSync(join(vendorDir, '__pycache__'), { recursive: true });
    writeFileSync(join(componentDir, 'main.py'), 'print("hello")\n');
    writeFileSync(
      join(componentDir, 'recipe.yaml'),
      [
        'ComponentName: com.example.MyComponent',
        'ComponentVersion: 1.0.0',
        'Manifests:',
        '  - Artifacts:',
        '      - Uri: s3://bucket/my-component.zip',
        '        Unarchive: ZIP',
        '    Lifecycle:',
        '      Run: python3 {artifacts:decompressedPath}/my-component/main.py',
        '',
      ].join('\n'),
    );
    writeFileSync(join(componentDir, '.lock'), '');
    writeFileSync(
      join(componentDir, '__pycache__', 'main.pyc'),
      'source-cache',
    );
    writeFileSync(join(vendorDir, 'dependency.py'), 'VERSION = "1.0"\n');
    writeFileSync(join(vendorDir, 'requirements.txt'), 'dependency==1.0\n');
    writeFileSync(join(vendorDir, '.lock'), '');
    writeFileSync(
      join(vendorDir, '__pycache__', 'dependency.pyc'),
      'staging-cache',
    );

    const result = spawnSync(
      process.execPath,
      [
        join(scriptsDir, 'build-artifact.mjs'),
        projectRoot,
        'my-component',
        distDir,
      ],
      { encoding: 'utf-8' },
    );

    expect(result.status, result.stderr).toBe(0);
    const entries = readZipEntries(
      readFileSync(
        join(
          distDir,
          'greengrass-build',
          'artifacts',
          'com.example.MyComponent',
          '1.0.0',
          'my-component.zip',
        ),
      ),
    );
    const names = entries.map((entry) => entry.name);
    // writeZip sorts entries so the archive's bytes are reproducible.
    expect(names).toEqual(['dependency.py', 'main.py']);
    expect(names).not.toContain('__pycache__/dependency.pyc');
  });

  it('should package a package.json the user added to the component dir when no bundle-dir is given', () => {
    const projectRoot = join(tmpDir, 'project');
    const componentDir = join(projectRoot, 'greengrass', 'my-component');
    const distDir = join(tmpDir, 'dist');
    mkdirSync(componentDir, { recursive: true });
    writeFileSync(join(componentDir, 'main.py'), 'print("hello")\n');
    // Only bundle mode owns a package.json as framework metadata; without a
    // bundle-dir it is a file the user put there and the device may need.
    writeFileSync(
      join(componentDir, 'package.json'),
      '{"name":"user-authored"}',
    );
    writeFileSync(
      join(componentDir, 'recipe.yaml'),
      [
        'ComponentName: com.example.MyComponent',
        'ComponentVersion: 1.0.0',
        'Manifests:',
        '  - Artifacts:',
        '      - Uri: s3://bucket/my-component.zip',
        '        Unarchive: ZIP',
        '    Lifecycle:',
        '      Run: python3 {artifacts:decompressedPath}/my-component/main.py',
        '',
      ].join('\n'),
    );

    const result = spawnSync(
      process.execPath,
      [
        join(scriptsDir, 'build-artifact.mjs'),
        projectRoot,
        'my-component',
        distDir,
      ],
      { encoding: 'utf-8' },
    );

    expect(result.status, result.stderr).toBe(0);
    const entries = readZipEntries(
      readFileSync(
        join(
          distDir,
          'greengrass-build',
          'artifacts',
          'com.example.MyComponent',
          '1.0.0',
          'my-component.zip',
        ),
      ),
    );
    expect(entries.map((entry) => entry.name).sort()).toEqual([
      'main.py',
      'package.json',
    ]);
  });

  it('should drop the previous version from greengrass-build on rebuild after a version bump', () => {
    const projectRoot = join(tmpDir, 'project');
    const componentDir = join(projectRoot, 'greengrass', 'my-component');
    const distDir = join(tmpDir, 'dist');
    const vendorDir = join(distDir, 'vendor');
    mkdirSync(componentDir, { recursive: true });
    mkdirSync(vendorDir, { recursive: true });
    writeFileSync(join(componentDir, 'main.py'), 'print("hello")\n');
    writeFileSync(join(vendorDir, 'dependency.py'), 'VERSION = "1.0"\n');
    const recipe = (version: string) =>
      [
        'ComponentName: com.example.MyComponent',
        `ComponentVersion: ${version}`,
        'Manifests:',
        '  - Artifacts:',
        '      - Uri: s3://bucket/my-component.zip',
        '        Unarchive: ZIP',
        '    Lifecycle:',
        '      Run: python3 {artifacts:decompressedPath}/my-component/main.py',
        '',
      ].join('\n');
    const run = () =>
      spawnSync(
        process.execPath,
        [
          join(scriptsDir, 'build-artifact.mjs'),
          projectRoot,
          'my-component',
          distDir,
        ],
        { encoding: 'utf-8' },
      );

    writeFileSync(join(componentDir, 'recipe.yaml'), recipe('1.0.0'));
    expect(run().status).toBe(0);
    writeFileSync(join(componentDir, 'recipe.yaml'), recipe('1.0.1'));
    const second = run();
    expect(second.status, second.stderr).toBe(0);

    // The GreengrassComponentVersion construct requires exactly one resolved
    // recipe, so a version bump must not leave the previous build behind.
    expect(readdirSync(join(distDir, 'greengrass-build', 'recipes'))).toEqual([
      'com.example.MyComponent-1.0.1.yaml',
    ]);
    expect(
      readdirSync(
        join(
          distDir,
          'greengrass-build',
          'artifacts',
          'com.example.MyComponent',
        ),
      ),
    ).toEqual(['1.0.1']);
  });

  it('should zip a bundle directory at the archive root instead of the component source, when given', () => {
    const projectRoot = join(tmpDir, 'project');
    const componentDir = join(projectRoot, 'greengrass', 'my-component');
    const bundleDir = join(tmpDir, 'bundle');
    const distDir = join(tmpDir, 'dist');
    mkdirSync(componentDir, { recursive: true });
    mkdirSync(bundleDir, { recursive: true });
    // TypeScript source that produced the bundle - must not appear in the zip.
    writeFileSync(join(componentDir, 'main.ts'), 'console.log("source");\n');
    writeFileSync(
      join(componentDir, 'package.json'),
      '{"name":"my-component"}',
    );
    writeFileSync(join(bundleDir, 'index.js'), 'console.log("bundled");\n');
    writeFileSync(
      join(componentDir, 'recipe.yaml'),
      [
        'ComponentName: com.example.MyComponent',
        'ComponentVersion: 1.0.0',
        'Manifests:',
        '  - Artifacts:',
        '      - Uri: s3://bucket/my-component.zip',
        '        Unarchive: ZIP',
        '    Lifecycle:',
        '      Run: node {artifacts:decompressedPath}/my-component/index.js',
        '',
      ].join('\n'),
    );

    const result = spawnSync(
      process.execPath,
      [
        join(scriptsDir, 'build-artifact.mjs'),
        projectRoot,
        'my-component',
        distDir,
        bundleDir,
      ],
      { encoding: 'utf-8' },
    );

    expect(result.status, result.stderr).toBe(0);
    const entries = readZipEntries(
      readFileSync(
        join(
          distDir,
          'greengrass-build',
          'artifacts',
          'com.example.MyComponent',
          '1.0.0',
          'my-component.zip',
        ),
      ),
    );
    const names = entries.map((entry) => entry.name).sort();
    expect(names).toEqual(['index.js', 'package.json']);
    expect(names).not.toContain('main.ts');
  });

  // No TypeScript generator vends an Install lifecycle any more, so this is
  // the only bundle-mode path there is - kept as its own case for the day a
  // recipe carries a hand-written Install step build-artifact.ts must still honour.
  it('should omit package.json from a bundle-mode zip when no Install lifecycle needs it', () => {
    const projectRoot = join(tmpDir, 'project');
    const componentDir = join(projectRoot, 'greengrass', 'my-component');
    const bundleDir = join(tmpDir, 'bundle');
    const distDir = join(tmpDir, 'dist');
    mkdirSync(componentDir, { recursive: true });
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(join(bundleDir, 'index.js'), 'console.log("bundled");\n');
    writeFileSync(
      join(componentDir, 'recipe.yaml'),
      [
        'ComponentName: com.example.MyComponent',
        'ComponentVersion: 1.0.0',
        'Manifests:',
        '  - Artifacts:',
        '      - Uri: s3://bucket/my-component.zip',
        '        Unarchive: ZIP',
        '    Lifecycle:',
        '      Run: node {artifacts:decompressedPath}/my-component/index.js',
        '',
      ].join('\n'),
    );

    const result = spawnSync(
      process.execPath,
      [
        join(scriptsDir, 'build-artifact.mjs'),
        projectRoot,
        'my-component',
        distDir,
        bundleDir,
      ],
      { encoding: 'utf-8' },
    );

    expect(result.status, result.stderr).toBe(0);
    const entries = readZipEntries(
      readFileSync(
        join(
          distDir,
          'greengrass-build',
          'artifacts',
          'com.example.MyComponent',
          '1.0.0',
          'my-component.zip',
        ),
      ),
    );
    expect(entries.map((entry) => entry.name)).toEqual(['index.js']);
  });

  it('should fall back to packaging component source when the given bundle-dir does not exist', () => {
    const projectRoot = join(tmpDir, 'project');
    const componentDir = join(projectRoot, 'greengrass', 'my-component');
    const distDir = join(tmpDir, 'dist');
    mkdirSync(componentDir, { recursive: true });
    writeFileSync(join(componentDir, 'main.py'), 'print("hello")\n');
    writeFileSync(
      join(componentDir, 'recipe.yaml'),
      [
        'ComponentName: com.example.MyComponent',
        'ComponentVersion: 1.0.0',
        'Manifests:',
        '  - Artifacts:',
        '      - Uri: s3://bucket/my-component.zip',
        '        Unarchive: ZIP',
        '    Lifecycle:',
        '      Run: python3 {artifacts:decompressedPath}/my-component/main.py',
        '',
      ].join('\n'),
    );

    const result = spawnSync(
      process.execPath,
      [
        join(scriptsDir, 'build-artifact.mjs'),
        projectRoot,
        'my-component',
        distDir,
        join(tmpDir, 'does-not-exist'),
      ],
      { encoding: 'utf-8' },
    );

    expect(result.status, result.stderr).toBe(0);
    const entries = readZipEntries(
      readFileSync(
        join(
          distDir,
          'greengrass-build',
          'artifacts',
          'com.example.MyComponent',
          '1.0.0',
          'my-component.zip',
        ),
      ),
    );
    expect(entries.map((entry) => entry.name)).toEqual(['main.py']);
  });

  it("should write one zip per architecture holding only that architecture's vendored files", () => {
    const projectRoot = join(tmpDir, 'project');
    const componentDir = join(projectRoot, 'greengrass', 'my-component');
    const distDir = join(tmpDir, 'dist');
    const vendorDir = join(distDir, 'vendor');
    mkdirSync(componentDir, { recursive: true });
    mkdirSync(join(vendorDir, 'amd64'), { recursive: true });
    mkdirSync(join(vendorDir, 'aarch64'), { recursive: true });
    writeFileSync(join(componentDir, 'main.py'), 'print("hello")\n');
    writeFileSync(join(vendorDir, 'requirements.txt'), 'dependency==1.0\n');
    writeFileSync(
      join(vendorDir, 'amd64', 'dependency.py'),
      'ARCH = "amd64"\n',
    );
    writeFileSync(
      join(vendorDir, 'aarch64', 'dependency.py'),
      'ARCH = "aarch64"\n',
    );
    writeFileSync(join(componentDir, 'recipe.yaml'), multiArchRecipe());

    const result = spawnSync(
      process.execPath,
      [
        join(scriptsDir, 'build-artifact.mjs'),
        projectRoot,
        'my-component',
        distDir,
        '--platforms=amd64,aarch64',
      ],
      { encoding: 'utf-8' },
    );
    expect(result.status, result.stderr).toBe(0);

    const artifactsDir = join(
      distDir,
      'greengrass-build',
      'artifacts',
      'com.example.MyComponent',
      '1.0.0',
    );
    const amd64Entries = readZipEntries(
      readFileSync(join(artifactsDir, 'my-component-amd64.zip')),
    );
    const aarch64Entries = readZipEntries(
      readFileSync(join(artifactsDir, 'my-component-aarch64.zip')),
    );

    expect(amd64Entries.map((e) => e.name).sort()).toEqual([
      'dependency.py',
      'main.py',
    ]);
    expect(aarch64Entries.map((e) => e.name).sort()).toEqual([
      'dependency.py',
      'main.py',
    ]);
    expect(
      amd64Entries.find((e) => e.name === 'dependency.py')?.data.toString(),
    ).toBe('ARCH = "amd64"\n');
    expect(
      aarch64Entries.find((e) => e.name === 'dependency.py')?.data.toString(),
    ).toBe('ARCH = "aarch64"\n');
    // requirements.txt lives one level above every arch directory, so it is
    // excluded structurally - neither zip holds it, nor the other
    // architecture's own vendored file.
    expect(amd64Entries.map((e) => e.name)).not.toContain('requirements.txt');
    expect(aarch64Entries.map((e) => e.name)).not.toContain('requirements.txt');
  });

  it('should produce byte-identical multi-architecture zips across two runs', () => {
    const projectRoot = join(tmpDir, 'project');
    const componentDir = join(projectRoot, 'greengrass', 'my-component');
    const distDir1 = join(tmpDir, 'dist1');
    const distDir2 = join(tmpDir, 'dist2');
    mkdirSync(componentDir, { recursive: true });
    writeFileSync(join(componentDir, 'main.py'), 'print("hello")\n');
    writeFileSync(join(componentDir, 'recipe.yaml'), multiArchRecipe());

    for (const distDir of [distDir1, distDir2]) {
      mkdirSync(join(distDir, 'vendor', 'amd64'), { recursive: true });
      mkdirSync(join(distDir, 'vendor', 'aarch64'), { recursive: true });
      writeFileSync(
        join(distDir, 'vendor', 'amd64', 'dependency.py'),
        'ARCH = "amd64"\n',
      );
      writeFileSync(
        join(distDir, 'vendor', 'aarch64', 'dependency.py'),
        'ARCH = "aarch64"\n',
      );
      const result = spawnSync(
        process.execPath,
        [
          join(scriptsDir, 'build-artifact.mjs'),
          projectRoot,
          'my-component',
          distDir,
          '--platforms=amd64,aarch64',
        ],
        { encoding: 'utf-8' },
      );
      expect(result.status, result.stderr).toBe(0);
    }

    const artifactPath = (distDir: string, arch: string) =>
      join(
        distDir,
        'greengrass-build',
        'artifacts',
        'com.example.MyComponent',
        '1.0.0',
        `my-component-${arch}.zip`,
      );
    expect(
      readFileSync(artifactPath(distDir1, 'amd64')).equals(
        readFileSync(artifactPath(distDir2, 'amd64')),
      ),
    ).toBe(true);
    expect(
      readFileSync(artifactPath(distDir1, 'aarch64')).equals(
        readFileSync(artifactPath(distDir2, 'aarch64')),
      ),
    ).toBe(true);
  });

  it('should keep the single-platform zip byte-identical when --platforms is absent', () => {
    const projectRoot = join(tmpDir, 'project');
    const componentDir = join(projectRoot, 'greengrass', 'my-component');
    const distDir = join(tmpDir, 'dist');
    mkdirSync(componentDir, { recursive: true });
    const mainPyContents = 'print("hello")\n';
    writeFileSync(join(componentDir, 'main.py'), mainPyContents);
    writeFileSync(
      join(componentDir, 'recipe.yaml'),
      [
        'ComponentName: com.example.MyComponent',
        'ComponentVersion: 1.0.0',
        'Manifests:',
        '  - Artifacts:',
        '      - Uri: s3://bucket/my-component.zip',
        '        Unarchive: ZIP',
        '    Lifecycle:',
        '      Run: python3 {artifacts:decompressedPath}/my-component/main.py',
        '',
      ].join('\n'),
    );

    const result = spawnSync(
      process.execPath,
      [
        join(scriptsDir, 'build-artifact.mjs'),
        projectRoot,
        'my-component',
        distDir,
      ],
      { encoding: 'utf-8' },
    );
    expect(result.status, result.stderr).toBe(0);

    const actual = readFileSync(
      join(
        distDir,
        'greengrass-build',
        'artifacts',
        'com.example.MyComponent',
        '1.0.0',
        'my-component.zip',
      ),
    );

    // Independently reproduced with the real vended `writeZip`, never a
    // snapshot: a change that alters these bytes must be a deliberate change
    // to zip-writer.ts's own behaviour, and `-u` is not an acceptable fix for
    // a failure here.
    const expectedZipPath = join(tmpDir, 'expected.zip');
    writeZip(
      [{ name: 'main.py', data: Buffer.from(mainPyContents) }],
      expectedZipPath,
    );
    const expected = readFileSync(expectedZipPath);

    expect(actual.equals(expected)).toBe(true);
  });

  it('should refuse --platforms together with a bundle-dir', () => {
    const projectRoot = join(tmpDir, 'project');
    const bundleDir = join(tmpDir, 'bundle');
    const distDir = join(tmpDir, 'dist');
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(join(bundleDir, 'index.js'), 'console.log("bundled");\n');

    const result = spawnSync(
      process.execPath,
      [
        join(scriptsDir, 'build-artifact.mjs'),
        projectRoot,
        'my-component',
        distDir,
        bundleDir,
        '--platforms=amd64,aarch64',
      ],
      { encoding: 'utf-8' },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      '--platforms cannot be combined with a bundle-dir',
    );
  });

  it('should fail with an actionable message when a per-architecture vendor directory is missing', () => {
    const projectRoot = join(tmpDir, 'project');
    const componentDir = join(projectRoot, 'greengrass', 'my-component');
    const distDir = join(tmpDir, 'dist');
    // aarch64 vendor dir deliberately missing.
    mkdirSync(join(distDir, 'vendor', 'amd64'), { recursive: true });
    mkdirSync(componentDir, { recursive: true });
    writeFileSync(join(componentDir, 'main.py'), 'print("hello")\n');
    writeFileSync(join(componentDir, 'recipe.yaml'), multiArchRecipe());

    const result = spawnSync(
      process.execPath,
      [
        join(scriptsDir, 'build-artifact.mjs'),
        projectRoot,
        'my-component',
        distDir,
        '--platforms=amd64,aarch64',
      ],
      { encoding: 'utf-8' },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'Missing vendored dependencies for "aarch64"',
    );
    expect(result.stderr).toContain(
      'run the component\'s "-vendor" target first',
    );
  });

  it("should refuse a multi-architecture recipe whose manifests carry each other's artifact", () => {
    const projectRoot = join(tmpDir, 'project');
    const componentDir = join(projectRoot, 'greengrass', 'my-component');
    const distDir = join(tmpDir, 'dist');
    mkdirSync(join(distDir, 'vendor', 'amd64'), { recursive: true });
    mkdirSync(join(distDir, 'vendor', 'aarch64'), { recursive: true });
    mkdirSync(componentDir, { recursive: true });
    writeFileSync(join(componentDir, 'main.py'), 'print("hello")\n');
    // Every base name is declared and referenced, just under the wrong
    // manifest - which would send amd64 wheels to an aarch64 device.
    writeFileSync(
      join(componentDir, 'recipe.yaml'),
      multiArchRecipe()
        .replace('my-component-amd64.zip', 'SWAP')
        .replace('my-component-aarch64.zip', 'my-component-amd64.zip')
        .replace('SWAP', 'my-component-aarch64.zip')
        .replace('my-component-amd64/main.py', 'SWAP')
        .replace('my-component-aarch64/main.py', 'my-component-amd64/main.py')
        .replace('SWAP', 'my-component-aarch64/main.py'),
    );

    const result = spawnSync(
      process.execPath,
      [
        join(scriptsDir, 'build-artifact.mjs'),
        projectRoot,
        'my-component',
        distDir,
        '--platforms=amd64,aarch64',
      ],
      { encoding: 'utf-8' },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'Manifest 1 declares "architecture: amd64"',
    );
    expect(result.stderr).toContain(
      'Manifest 2 declares "architecture: aarch64"',
    );
    expect(existsSync(join(distDir, 'greengrass-build'))).toBe(false);
  });

  it('should accept --platforms before the positional arguments', () => {
    const projectRoot = join(tmpDir, 'project');
    const componentDir = join(projectRoot, 'greengrass', 'my-component');
    const distDir = join(tmpDir, 'dist');
    mkdirSync(join(distDir, 'vendor', 'amd64'), { recursive: true });
    mkdirSync(join(distDir, 'vendor', 'aarch64'), { recursive: true });
    mkdirSync(componentDir, { recursive: true });
    writeFileSync(join(componentDir, 'main.py'), 'print("hello")\n');
    writeFileSync(join(componentDir, 'recipe.yaml'), multiArchRecipe());

    const result = spawnSync(
      process.execPath,
      [
        join(scriptsDir, 'build-artifact.mjs'),
        '--platforms=amd64,aarch64',
        projectRoot,
        'my-component',
        distDir,
      ],
      { encoding: 'utf-8' },
    );
    expect(result.status, result.stderr).toBe(0);

    const artifactsDir = join(
      distDir,
      'greengrass-build',
      'artifacts',
      'com.example.MyComponent',
      '1.0.0',
    );
    expect(readdirSync(artifactsDir).sort()).toEqual([
      'my-component-aarch64.zip',
      'my-component-amd64.zip',
    ]);
  });
});

describe('greengrass deploy-local.ts', () => {
  const COMPONENT_NAME = 'com.example.MyComponent';
  const COMPONENT_VERSION = '1.0.0';

  let tmpDir: string;
  let scriptsDir: string;
  let greengrassRoot: string;
  let distDir: string;

  // Stands in for greengrass-cli, which only exists on a core device.
  // `deployment create` exits with the code in the `submit-status` fixture.
  // `component list` answers its Nth call with the Nth `list-<n>` fixture and
  // repeats `list-last` after those run out, so one shell script covers a
  // component whose state CHANGES between checks without a mock inside the
  // script under test.
  const writeFakeCli = (): void => {
    const binDir = join(greengrassRoot, 'bin');
    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      join(binDir, 'greengrass-cli'),
      [
        '#!/bin/sh',
        `FIXTURES="${join(greengrassRoot, 'fixtures')}"`,
        'if [ "$1" = "deployment" ]; then',
        '  echo "$*" > "$FIXTURES/deployment-args"',
        '  echo "Local deployment submitted!"',
        '  exit "$(cat "$FIXTURES/submit-status")"',
        'fi',
        'if [ "$1" = "component" ]; then',
        '  COUNT=$(cat "$FIXTURES/list-count" 2>/dev/null || echo 0)',
        '  COUNT=$((COUNT + 1))',
        '  echo "$COUNT" > "$FIXTURES/list-count"',
        '  FILE="$FIXTURES/list-$COUNT"',
        '  if [ ! -f "$FILE" ]; then FILE="$FIXTURES/list-last"; fi',
        '  cat "$FILE"',
        '  exit 0',
        'fi',
        'exit 64',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
  };

  // The script's FIRST `component list` call is its pre-submit snapshot, so
  // `listOutputs[0]` is the device state before the deployment and the rest are
  // what the poll loop sees.
  const writeFixtures = ({
    submitStatus = 0,
    listOutputs = [''],
    componentLog,
  }: {
    submitStatus?: number;
    listOutputs?: string[];
    componentLog?: string;
  }): void => {
    const fixturesDir = join(greengrassRoot, 'fixtures');
    mkdirSync(fixturesDir, { recursive: true });
    writeFileSync(join(fixturesDir, 'submit-status'), `${submitStatus}\n`);
    for (const [index, output] of listOutputs.entries()) {
      writeFileSync(join(fixturesDir, `list-${index + 1}`), output);
    }
    writeFileSync(
      join(fixturesDir, 'list-last'),
      listOutputs[listOutputs.length - 1],
    );
    if (componentLog !== undefined) {
      mkdirSync(join(greengrassRoot, 'logs'), { recursive: true });
      writeFileSync(
        join(greengrassRoot, 'logs', `${COMPONENT_NAME}.log`),
        componentLog,
      );
    }
  };

  // The shape `greengrass-cli component list` prints: one indented block per
  // component, with no documented layout.
  const listOutputFor = (version: string, state: string): string =>
    [
      'Components currently running in Greengrass:',
      'Component Name: aws.greengrass.Cli',
      '    Version: 2.18.3',
      '    State: RUNNING',
      `Component Name: ${COMPONENT_NAME}`,
      `    Version: ${version}`,
      `    State: ${state}`,
      '    Configuration: {"accessControl":{}}',
      '',
    ].join('\n');

  /** The device before this deployment: a previous version, running. */
  const PREVIOUS_VERSION_RUNNING = listOutputFor('0.9.0', 'RUNNING');

  /** A device that has never installed the component. */
  const NOTHING_INSTALLED = [
    'Components currently running in Greengrass:',
    'Component Name: aws.greengrass.Cli',
    '    Version: 2.18.3',
    '    State: RUNNING',
    '',
  ].join('\n');

  /** Replaces the 1.0.0 build the beforeEach wrote with a NEXT_PATCH one. */
  const writeSentinelBuild = (): void => {
    const recipesDir = join(distDir, 'greengrass-build', 'recipes');
    rmSync(recipesDir, { recursive: true, force: true });
    mkdirSync(recipesDir, { recursive: true });
    writeFileSync(
      join(recipesDir, `${COMPONENT_NAME}-NEXT_PATCH.yaml`),
      [
        'RecipeFormatVersion: 2020-01-25',
        `ComponentName: ${COMPONENT_NAME}`,
        'ComponentVersion: NEXT_PATCH',
        'Manifests:',
        '  - Artifacts:',
        '      - Uri: s3://BUCKET_NAME/COMPONENT_NAME/COMPONENT_VERSION/my-component.zip',
        '',
      ].join('\n'),
    );
    const artifactDir = join(
      distDir,
      'greengrass-build',
      'artifacts',
      COMPONENT_NAME,
      'NEXT_PATCH',
    );
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, 'my-component.zip'), 'zip bytes');
  };

  /** One version directory per version the nucleus has held, per store. */
  const writePackageStore = (
    store: 'artifacts' | 'artifacts-unarchived',
    versions: readonly string[],
  ): string => {
    const dir = join(greengrassRoot, 'packages', store, COMPONENT_NAME);
    for (const version of versions) {
      mkdirSync(join(dir, version), { recursive: true });
    }
    return dir;
  };

  const runDeployLocal = (
    timeoutSeconds?: number | string,
  ): ReturnType<typeof spawnSync> =>
    spawnSync(
      process.execPath,
      [join(scriptsDir, 'deploy-local.mjs'), distDir],
      {
        encoding: 'utf-8',
        env: {
          ...process.env,
          GREENGRASS_ROOT: greengrassRoot,
          ...(timeoutSeconds === undefined
            ? {}
            : {
                GREENGRASS_DEPLOY_TIMEOUT_SECONDS: String(timeoutSeconds),
              }),
        },
      },
    );

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'greengrass-deploy-local-'));
    scriptsDir = mkdtempSync(
      join(import.meta.dirname, '.tmp-greengrass-deploy-local-'),
    );
    writeFileSync(
      join(scriptsDir, 'recipe-utils.mjs'),
      transpileTemplate('recipe-utils.ts.template'),
    );
    writeFileSync(
      join(scriptsDir, 'deploy-local.mjs'),
      transpileTemplate('deploy-local.ts.template').replaceAll(
        './recipe-utils.js',
        './recipe-utils.mjs',
      ),
    );

    greengrassRoot = join(tmpDir, 'greengrass', 'v2');
    distDir = join(tmpDir, 'dist');
    const recipesDir = join(distDir, 'greengrass-build', 'recipes');
    mkdirSync(recipesDir, { recursive: true });
    writeFileSync(
      join(recipesDir, `${COMPONENT_NAME}-${COMPONENT_VERSION}.yaml`),
      [
        'RecipeFormatVersion: 2020-01-25',
        `ComponentName: ${COMPONENT_NAME}`,
        `ComponentVersion: ${COMPONENT_VERSION}`,
        'Manifests:',
        '  - Artifacts:',
        '      - Uri: s3://BUCKET_NAME/COMPONENT_NAME/COMPONENT_VERSION/my-component.zip',
        '',
      ].join('\n'),
    );
    writeFakeCli();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    rmSync(scriptsDir, { recursive: true, force: true });
  });

  it('should exit 0 once the component holds RUNNING at the version just deployed', () => {
    writeFixtures({
      listOutputs: [
        PREVIOUS_VERSION_RUNNING,
        listOutputFor(COMPONENT_VERSION, 'RUNNING'),
      ],
    });

    const result = runDeployLocal();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain(
      `${COMPONENT_NAME}=${COMPONENT_VERSION} is RUNNING`,
    );
    // The device was on 0.9.0, so the state read is unambiguously this
    // deployment's and the same-version caveat must not be printed.
    expect(result.stderr).not.toContain('already reports');
  }, 30000);

  it('should exit non-zero and print the component log tail when the component is BROKEN', () => {
    writeFixtures({
      listOutputs: [
        PREVIOUS_VERSION_RUNNING,
        listOutputFor(COMPONENT_VERSION, 'BROKEN'),
      ],
      componentLog: [
        'first log line',
        'Traceback...',
        'ValueError: nope',
        '',
      ].join('\n'),
    });

    const result = runDeployLocal();

    // A local deployment reporting success is exactly the case this catches -
    // the fake CLI exits 0 on `deployment create` here.
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `${COMPONENT_NAME}=${COMPONENT_VERSION} is BROKEN`,
    );
    expect(result.stderr).toContain('ValueError: nope');
  }, 30000);

  it('should exit non-zero when the component reaches RUNNING and then dies', () => {
    // The nucleus reports RUNNING as soon as it starts the process, so a
    // component that crashes seconds in passes any single-sample check.
    writeFixtures({
      listOutputs: [
        PREVIOUS_VERSION_RUNNING,
        listOutputFor(COMPONENT_VERSION, 'RUNNING'),
        listOutputFor(COMPONENT_VERSION, 'BROKEN'),
      ],
      componentLog: ['started', 'ConnectionRefusedError: ipc', ''].join('\n'),
    });

    const result = runDeployLocal();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `${COMPONENT_NAME}=${COMPONENT_VERSION} is BROKEN`,
    );
    expect(result.stderr).toContain('ConnectionRefusedError: ipc');
  }, 30000);

  it('should print the sudo-rs remedy when the component log carries its signature', () => {
    writeFixtures({
      listOutputs: [
        PREVIOUS_VERSION_RUNNING,
        listOutputFor(COMPONENT_VERSION, 'BROKEN'),
      ],
      componentLog: [
        "sudo: preserving the entire environment is not supported, '-E' is ignored",
        "KeyError: 'AWS_GG_NUCLEUS_DOMAIN_SOCKET_FILEPATH_FOR_COMPONENT'",
        '',
      ].join('\n'),
    });

    const result = runDeployLocal();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'sudo update-alternatives --set sudo /usr/bin/sudo.ws',
    );
    expect(result.stderr).toContain('sudo systemctl restart greengrass');
  }, 30000);

  it('should exit non-zero naming the last state when the component never settles', () => {
    writeFixtures({
      listOutputs: [
        PREVIOUS_VERSION_RUNNING,
        listOutputFor(COMPONENT_VERSION, 'STARTING'),
      ],
    });

    const result = runDeployLocal(5);

    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('did not settle within 5s');
    expect(result.stderr).toContain('last reported state STARTING');
  }, 30000);

  it('should not accept a RUNNING entry still carrying the previous version', () => {
    writeFixtures({ listOutputs: [PREVIOUS_VERSION_RUNNING] });

    const result = runDeployLocal(1);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'none (the component was not listed at this version)',
    );
  }, 30000);

  it('should warn that the state read is ambiguous when the version is already on the device', () => {
    writeFixtures({
      listOutputs: [listOutputFor(COMPONENT_VERSION, 'RUNNING')],
    });

    const result = runDeployLocal();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain(
      `This device already reports ${COMPONENT_NAME}=${COMPONENT_VERSION}`,
    );
    expect(result.stderr).toContain('bump ComponentVersion in recipe.yaml');
  }, 30000);

  it.each(['Infinity', '-5', 'soon'])(
    'should fall back to the default bound rather than honour GREENGRASS_DEPLOY_TIMEOUT_SECONDS=%s',
    (timeout) => {
      // Infinity would poll forever, a negative value would skip polling
      // altogether and report a timeout that never happened.
      writeFixtures({
        listOutputs: [
          PREVIOUS_VERSION_RUNNING,
          listOutputFor(COMPONENT_VERSION, 'BROKEN'),
        ],
      });

      const result = runDeployLocal(timeout);

      expect(result.stderr).toContain(
        `Ignoring GREENGRASS_DEPLOY_TIMEOUT_SECONDS="${timeout}"`,
      );
      expect(result.stderr).toContain('Waiting 120s instead');
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `${COMPONENT_NAME}=${COMPONENT_VERSION} is BROKEN`,
      );
    },
    30000,
  );

  it('should resolve NEXT_PATCH above the installed version and the package stores, then deploy the staged copy', () => {
    writeSentinelBuild();
    // Version directories from both stores count; a prerelease directory and
    // a plain file do not.
    const artifactsStore = writePackageStore('artifacts', [
      '1.2.0',
      '1.3.0-beta.1',
    ]);
    writePackageStore('artifacts-unarchived', ['1.2.5']);
    writeFileSync(join(artifactsStore, '9.9.9'), 'a file, not a version');
    writeFixtures({
      listOutputs: [
        PREVIOUS_VERSION_RUNNING,
        listOutputFor('1.2.6', 'RUNNING'),
      ],
    });

    const result = runDeployLocal();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain(
      'Resolved NEXT_PATCH to 1.2.6 (installed: 0.9.0; package stores: 1.2.0, 1.3.0-beta.1, 1.2.5)',
    );
    expect(result.stderr).toContain(`${COMPONENT_NAME}=1.2.6 is RUNNING`);
    expect(result.stderr).not.toContain('Skipping');

    const localDir = join(distDir, 'greengrass-build', 'local');
    expect(
      readFileSync(
        join(localDir, 'recipes', `${COMPONENT_NAME}-1.2.6.yaml`),
        'utf-8',
      ),
    ).toContain('ComponentVersion: 1.2.6');
    expect(
      existsSync(
        join(
          localDir,
          'artifacts',
          COMPONENT_NAME,
          '1.2.6',
          'my-component.zip',
        ),
      ),
    ).toBe(true);
    const deploymentArgs = readFileSync(
      join(greengrassRoot, 'fixtures', 'deployment-args'),
      'utf-8',
    );
    expect(deploymentArgs).toContain(
      `--recipeDir ${join(localDir, 'recipes')}`,
    );
    expect(deploymentArgs).toContain(
      `--artifactDir ${join(localDir, 'artifacts')}`,
    );
    expect(deploymentArgs).toContain(`--merge ${COMPONENT_NAME}=1.2.6`);
  }, 30000);

  it('should resolve NEXT_PATCH to 1.0.0 and log each missing package store when the device holds nothing', () => {
    writeSentinelBuild();
    writeFixtures({
      listOutputs: [NOTHING_INSTALLED, listOutputFor('1.0.0', 'RUNNING')],
    });

    const result = runDeployLocal();

    expect(result.status, result.stderr).toBe(0);
    for (const store of ['artifacts', 'artifacts-unarchived']) {
      expect(result.stderr).toContain(
        `Skipping ${join(greengrassRoot, 'packages', store, COMPONENT_NAME)}: `,
      );
    }
    expect(result.stderr).toContain(
      'Resolved NEXT_PATCH to 1.0.0 (installed: none; package stores: none)',
    );
    expect(result.stderr).toContain(`${COMPONENT_NAME}=1.0.0 is RUNNING`);
  }, 30000);

  it('should refuse to resolve NEXT_PATCH over an installed version that is not strict M.m.p', () => {
    writeSentinelBuild();
    writeFixtures({
      listOutputs: [listOutputFor('1.0.0-beta.1', 'RUNNING')],
    });

    const result = runDeployLocal();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Installed component version "1.0.0-beta.1" is not a strict M.m.p version, so NEXT_PATCH cannot resolve it.',
    );
    expect(result.stderr).not.toContain('Deploying');
  }, 30000);

  it('should give up rather than hang when greengrass-cli never returns', () => {
    writeFixtures({});
    // A wedged nucleus: the CLI starts and never answers. Every subprocess has
    // to be bounded, or no timeout on the poll loop can bound the target.
    writeFileSync(
      join(greengrassRoot, 'bin', 'greengrass-cli'),
      '#!/bin/sh\nexec sleep 60\n',
      { mode: 0o755 },
    );

    const startedAt = Date.now();
    const result = runDeployLocal(2);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('did not return within 2s');
    expect(Date.now() - startedAt).toBeLessThan(20000);
  }, 30000);

  it('should fail without polling when greengrass-cli rejects the deployment', () => {
    writeFixtures({
      submitStatus: 3,
      listOutputs: [listOutputFor(COMPONENT_VERSION, 'RUNNING')],
    });

    const result = runDeployLocal();

    expect(result.status).toBe(3);
    expect(result.stderr).toContain('greengrass-cli exited with 3');
    expect(result.stderr).not.toContain('Waiting up to');
  });
});
