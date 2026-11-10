/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { pyDynamoDBGenerator } from '../../../py/dynamodb/generator.js';
import { pyProjectGenerator } from '../../../py/project/generator.js';
import { resolveContainers } from '../../../utils/containers.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import { importMigration } from '../../../utils/test-migration.js';
import migration from './migration.js';

vi.mock('../../../utils/containers', () => ({
  resolveContainers: vi.fn(),
}));

const BASE_PY = 'packages/my_table/proj_my_table/entities/base.py';

/** What a workspace generated or migrated by 1.0.8 has in base.py. */
const nestedProtocol = (vended: string): string =>
  vended
    .replace('class _Meta(MetaProtocol):', 'class Meta(MetaProtocol):')
    .replace('\n    Meta: MetaProtocol = _Meta\n', '');

/** What a workspace generated before 1.0.8 has in base.py. */
const untyped = (vended: string): string =>
  nestedProtocol(vended)
    .replace(
      'from pynamodb.models import MetaProtocol, Model',
      'from pynamodb.models import Model',
    )
    .replace('class Meta(MetaProtocol):', 'class Meta:');

describe('py-dynamodb-bind-base-model-meta migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    vi.mocked(resolveContainers).mockResolvedValue('docker');
  });

  const generate = () =>
    pyDynamoDBGenerator(tree, {
      name: 'MyTable',
      directory: 'packages',
      infra: 'none',
    });

  it('should converge a 1.0.8 base.py on exactly what the generator vends today', async () => {
    await generate();
    const vended = tree.read(BASE_PY, 'utf-8') ?? '';
    const old = nestedProtocol(vended);
    expect(old).toContain('    class Meta(MetaProtocol):\n');
    expect(old).not.toContain('_Meta');
    tree.write(BASE_PY, old);

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
    expect(tree.read(BASE_PY, 'utf-8')).toBe(vended);
  });

  // Workspaces generated before the serve-local -> local-dev rename still read
  // the port through `_serve_local`, which is otherwise the same block.
  it('should converge a 1.0.8 base.py from before the local-dev rename', async () => {
    await generate();
    const vended = tree.read(BASE_PY, 'utf-8') ?? '';
    const serveLocal = (content: string) =>
      content.replaceAll('_local_dev', '_serve_local');
    tree.write(BASE_PY, serveLocal(nestedProtocol(vended)));

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
    expect(tree.read(BASE_PY, 'utf-8')).toBe(serveLocal(vended));
  });

  it('should converge a 1.0.8 base.py whose string literals were never reformatted', async () => {
    await generate();
    const vended = tree.read(BASE_PY, 'utf-8') ?? '';
    const singleQuoted = nestedProtocol(vended)
      .replace('"us-east-1"', "'us-east-1'")
      .replaceAll('"UNUSED"', "'UNUSED'");
    expect(singleQuoted).not.toBe(nestedProtocol(vended));
    tree.write(BASE_PY, singleQuoted);

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
    expect(tree.read(BASE_PY, 'utf-8')).toBe(vended);
  });

  it('should leave a freshly generated workspace unchanged', async () => {
    await generate();
    const vended = tree.read(BASE_PY, 'utf-8');

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
    expect(tree.read(BASE_PY, 'utf-8')).toBe(vended);
  });

  it('should be idempotent', async () => {
    await generate();
    const vended = tree.read(BASE_PY, 'utf-8') ?? '';
    tree.write(BASE_PY, nestedProtocol(vended));

    await migration(tree);
    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
    expect(tree.read(BASE_PY, 'utf-8')).toBe(vended);
  });

  // That shape belongs to py-dynamodb-type-base-model-meta, which runs first.
  it('should leave a base.py from before 1.0.8 to the migration that types it', async () => {
    await generate();
    const old = untyped(tree.read(BASE_PY, 'utf-8') ?? '');
    expect(old).toContain('    class Meta:\n');
    expect(old).not.toContain('MetaProtocol');
    tree.write(BASE_PY, old);

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
    expect(tree.read(BASE_PY, 'utf-8')).toBe(old);
  });

  it('should converge a base.py from before 1.0.8 when run after the migration that types it', async () => {
    await generate();
    const vended = tree.read(BASE_PY, 'utf-8') ?? '';
    tree.write(BASE_PY, untyped(vended));

    const typeBaseModelMeta = await importMigration(
      'py-dynamodb-type-base-model-meta',
    );
    await typeBaseModelMeta(tree);
    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
    expect(tree.read(BASE_PY, 'utf-8')).toBe(vended);
  });

  it('should leave a customised Meta untouched and report it', async () => {
    await generate();
    const old = nestedProtocol(tree.read(BASE_PY, 'utf-8') ?? '');
    const customised = old.replace('"us-east-1"', '"eu-west-1"');
    expect(customised).not.toBe(old);
    tree.write(BASE_PY, customised);

    const { nextSteps } = await migration(tree);

    expect(tree.read(BASE_PY, 'utf-8')).toBe(customised);
    expect(nextSteps).toHaveLength(1);
    expect(nextSteps[0]).toContain(BASE_PY);
    expect(nextSteps[0]).toContain('Meta: MetaProtocol = _Meta');
  });

  // Rewriting only the Meta block would reference MetaProtocol where the
  // import may no longer provide it, so the file is reported instead.
  it('should leave a base.py whose pynamodb.models import was edited untouched and report it', async () => {
    await generate();
    const old = nestedProtocol(tree.read(BASE_PY, 'utf-8') ?? '');
    const editedImport = old.replace(
      'from pynamodb.models import MetaProtocol, Model\n',
      'from pynamodb.models import MetaProtocol, Model  # base of every entity\n',
    );
    expect(editedImport).not.toBe(old);
    tree.write(BASE_PY, editedImport);

    const { nextSteps } = await migration(tree);

    expect(tree.read(BASE_PY, 'utf-8')).toBe(editedImport);
    expect(nextSteps).toHaveLength(1);
    expect(nextSteps[0]).toContain(BASE_PY);
    expect(nextSteps[0]).toContain('pynamodb.models import');
  });

  describe('with two py#dynamodb projects', () => {
    const OTHER_BASE_PY =
      'packages/other_table/proj_other_table/entities/base.py';

    /** Generate both projects and roll each base.py back to the 1.0.8 shape. */
    const generateBoth = async () => {
      await generate();
      await pyDynamoDBGenerator(tree, {
        name: 'OtherTable',
        directory: 'packages',
        infra: 'none',
      });
      const vended = {
        first: tree.read(BASE_PY, 'utf-8') ?? '',
        second: tree.read(OTHER_BASE_PY, 'utf-8') ?? '',
      };
      tree.write(BASE_PY, nestedProtocol(vended.first));
      tree.write(OTHER_BASE_PY, nestedProtocol(vended.second));
      return vended;
    };

    it('should migrate both', async () => {
      const vended = await generateBoth();

      const { nextSteps } = await migration(tree);

      expect(nextSteps).toEqual([]);
      expect(tree.read(BASE_PY, 'utf-8')).toBe(vended.first);
      expect(tree.read(OTHER_BASE_PY, 'utf-8')).toBe(vended.second);
    });

    it('should report a diverged second project and still migrate the first', async () => {
      const vended = await generateBoth();
      const old = tree.read(OTHER_BASE_PY, 'utf-8') ?? '';
      const customised = old.replace('"us-east-1"', '"eu-west-1"');
      expect(customised).not.toBe(old);
      tree.write(OTHER_BASE_PY, customised);

      const { nextSteps } = await migration(tree);

      expect(tree.read(BASE_PY, 'utf-8')).toBe(vended.first);
      expect(tree.read(OTHER_BASE_PY, 'utf-8')).toBe(customised);
      expect(nextSteps).toHaveLength(1);
      expect(nextSteps[0]).toContain(OTHER_BASE_PY);
    });
  });

  it('should leave a workspace without py#dynamodb unchanged', async () => {
    // The same path and content as a py#dynamodb project, in a plain py#project.
    const dynamodbTree = createTreeUsingTsSolutionSetup();
    await pyDynamoDBGenerator(dynamodbTree, {
      name: 'MyTable',
      directory: 'packages',
      infra: 'none',
    });
    const old = nestedProtocol(dynamodbTree.read(BASE_PY, 'utf-8') ?? '');
    await pyProjectGenerator(tree, {
      name: 'MyTable',
      directory: 'packages',
      type: 'library',
    });
    tree.write(BASE_PY, old);

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
    expect(tree.read(BASE_PY, 'utf-8')).toBe(old);
  });

  it('should skip a py#dynamodb project whose base.py was deleted', async () => {
    await generate();
    tree.delete(BASE_PY);

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
    expect(tree.exists(BASE_PY)).toBe(false);
  });
});
