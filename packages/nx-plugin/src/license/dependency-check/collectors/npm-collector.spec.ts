/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  collectNpmDependencies,
  resolveFileReferencedLicense,
} from './npm-collector.js';

const MIT_TEXT = `MIT License

Copyright (c) 2026 Example

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction.`;

const APACHE_TEXT = `                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION`;

describe('npm collector', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'npm-collect-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const writeLicenseFile = (contents: string): string => {
    const path = join(dir, 'LICENSE');
    writeFileSync(path, contents);
    return path;
  };

  /** Write a package into `dir`'s node_modules, plus a root package.json. */
  const writePackage = (
    name: string,
    version: string,
    license: string,
    licenseFileContents?: string,
  ): void => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'root', version: '1.0.0', private: true }),
    );
    const packageDir = join(dir, 'node_modules', name);
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({ name, version, license }),
    );
    if (licenseFileContents !== undefined) {
      writeFileSync(join(packageDir, 'LICENSE'), licenseFileContents);
    }
  };

  describe('resolveFileReferencedLicense', () => {
    it('leaves a license that names no file alone', () => {
      const path = writeLicenseFile(MIT_TEXT);
      expect(resolveFileReferencedLicense('Apache-2.0', path)).toBe(
        'Apache-2.0',
      );
      expect(resolveFileReferencedLicense('', path)).toBe('');
    });

    it('detects the license from the file a SEE LICENSE IN declaration names', () => {
      const path = writeLicenseFile(MIT_TEXT);
      expect(resolveFileReferencedLicense('SEE LICENSE IN LICENSE', path)).toBe(
        'MIT*',
      );
    });

    it('detects the license from the file license-checker reports as Custom:', () => {
      const path = writeLicenseFile(APACHE_TEXT);
      expect(resolveFileReferencedLicense('Custom: LICENSE', path)).toBe(
        'Apache-2.0*',
      );
    });

    it('keeps the reference when no license file was located', () => {
      expect(resolveFileReferencedLicense('Custom: LICENSE', undefined)).toBe(
        'Custom: LICENSE',
      );
    });

    it('keeps the reference when the file cannot be read', () => {
      expect(
        resolveFileReferencedLicense(
          'Custom: LICENSE',
          join(dir, 'does-not-exist'),
        ),
      ).toBe('Custom: LICENSE');
    });

    it('keeps the reference when the file names no recognisable license', () => {
      const path = writeLicenseFile('');
      expect(resolveFileReferencedLicense('Custom: LICENSE', path)).toBe(
        'Custom: LICENSE',
      );
    });

    it('reports an explicitly unlicensed file rather than keeping the reference', () => {
      const path = writeLicenseFile('This package is UNLICENSED.');
      expect(resolveFileReferencedLicense('Custom: LICENSE', path)).toBe(
        'UNLICENSED',
      );
    });
  });

  describe('collectNpmDependencies', () => {
    it('returns no dependencies when there is no node_modules', async () => {
      expect(await collectNpmDependencies({ start: dir })).toEqual([]);
    });

    it('resolves a SEE LICENSE IN package to the license its file grants', async () => {
      writePackage(
        'licensed-by-file',
        '2.8.0',
        'SEE LICENSE IN LICENSE',
        [
          'The project is licensed under the Apache License, Version 2.0.',
          '',
          APACHE_TEXT,
        ].join('\n'),
      );

      const result = await collectNpmDependencies({ start: dir });
      expect(result).toEqual([
        expect.objectContaining({
          name: 'licensed-by-file',
          version: '2.8.0',
          rawLicense: 'Apache-2.0*',
        }),
      ]);
    });

    it('reports a declared SPDX license unchanged', async () => {
      writePackage('declared', '1.0.0', 'MIT', MIT_TEXT);

      const result = await collectNpmDependencies({ start: dir });
      expect(result).toEqual([
        expect.objectContaining({ name: 'declared', rawLicense: 'MIT' }),
      ]);
    });
  });
});
