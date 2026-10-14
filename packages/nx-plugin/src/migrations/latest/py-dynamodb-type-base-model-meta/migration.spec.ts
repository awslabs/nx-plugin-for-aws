/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { pyDynamoDBGenerator } from '../../../py/dynamodb/generator.js';
import { pyProjectGenerator } from '../../../py/project/generator.js';
import { resolveContainers } from '../../../utils/containers.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

vi.mock('../../../utils/containers', () => ({
  resolveContainers: vi.fn(),
}));

const BASE_PY = 'packages/my_table/proj_my_table/entities/base.py';

/** What a workspace generated before this change has in base.py. */
const rollBack = (vended: string): string =>
  vended
    .replace(
      'from pynamodb.models import MetaProtocol, Model',
      'from pynamodb.models import Model',
    )
    .replace('class Meta(MetaProtocol):', 'class Meta:');

describe('py-dynamodb-type-base-model-meta migration', () => {
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

  it('should converge a generated workspace on exactly what the generator vends today', async () => {
    await generate();
    const vended = tree.read(BASE_PY, 'utf-8') ?? '';
    expect(vended).toContain('class Meta(MetaProtocol):');
    const old = rollBack(vended);
    expect(old).not.toContain('MetaProtocol');
    tree.write(BASE_PY, old);

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
    expect(tree.read(BASE_PY, 'utf-8')).toBe(vended);
  });

  // Workspaces generated before the serve-local -> local-dev rename still read
  // the port through `_serve_local`, which is otherwise the same block.
  it('should converge a base.py from before the local-dev rename', async () => {
    await generate();
    const vended = tree.read(BASE_PY, 'utf-8') ?? '';
    const serveLocal = (content: string) =>
      content.replaceAll('_local_dev', '_serve_local');
    tree.write(BASE_PY, serveLocal(rollBack(vended)));

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
    expect(tree.read(BASE_PY, 'utf-8')).toBe(serveLocal(vended));
  });

  // The template's string literals are single-quoted; `ruff format` makes them
  // double-quoted, so a base.py that was never formatted keeps the former. The
  // migration formats what it rewrites, so it converges on the vended file.
  it('should converge a base.py whose string literals were never reformatted', async () => {
    await generate();
    const vended = tree.read(BASE_PY, 'utf-8') ?? '';
    const singleQuoted = rollBack(vended)
      .replace('"us-east-1"', "'us-east-1'")
      .replaceAll('"UNUSED"', "'UNUSED'");
    expect(singleQuoted).not.toBe(rollBack(vended));
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
    tree.write(BASE_PY, rollBack(vended));

    await migration(tree);
    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
    expect(tree.read(BASE_PY, 'utf-8')).toBe(vended);
  });

  it('should leave a customised Meta untouched and report it', async () => {
    await generate();
    const old = rollBack(tree.read(BASE_PY, 'utf-8') ?? '');
    const customised = old.replace('"us-east-1"', '"eu-west-1"');
    expect(customised).not.toBe(old);
    tree.write(BASE_PY, customised);

    const { nextSteps } = await migration(tree);

    expect(tree.read(BASE_PY, 'utf-8')).toBe(customised);
    expect(nextSteps).toHaveLength(1);
    expect(nextSteps[0]).toContain(BASE_PY);
    expect(nextSteps[0]).toContain('class Meta(MetaProtocol):');
  });

  // Rewriting only the Meta block would reference MetaProtocol without
  // importing it, so the file is left as it is and reported instead.
  it('should leave a base.py whose pynamodb.models import was edited untouched and report it', async () => {
    await generate();
    const old = rollBack(tree.read(BASE_PY, 'utf-8') ?? '');
    const editedImport = old.replace(
      'from pynamodb.models import Model\n',
      'from pynamodb.models import Model  # base of every entity\n',
    );
    expect(editedImport).not.toBe(old);
    tree.write(BASE_PY, editedImport);

    const { nextSteps } = await migration(tree);

    expect(tree.read(BASE_PY, 'utf-8')).toBe(editedImport);
    expect(nextSteps).toHaveLength(1);
    expect(nextSteps[0]).toContain(BASE_PY);
    expect(nextSteps[0]).toContain('pynamodb.models import');
    expect(nextSteps[0]).toContain('class Meta(MetaProtocol):');
  });

  describe('with two py#dynamodb projects', () => {
    const OTHER_BASE_PY =
      'packages/other_table/proj_other_table/entities/base.py';

    /** Generate both projects and roll each base.py back to the old shape. */
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
      tree.write(BASE_PY, rollBack(vended.first));
      tree.write(OTHER_BASE_PY, rollBack(vended.second));
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
    const old = rollBack(dynamodbTree.read(BASE_PY, 'utf-8') ?? '');
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
