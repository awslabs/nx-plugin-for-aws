/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { PythonVerifier } from '../../utils/test/py.spec';
import { PET_STORE_SPEC } from '../ts-client/generator.petstore.spec';
import {
  callGeneratedClient,
  callGeneratedClientAsync,
  createTree,
  generateAndRead,
} from './generator.utils.spec';

describe('openApiPyClientGenerator - petstore', () => {
  let tree: Tree;
  let verifier: PythonVerifier;

  beforeAll(() => {
    verifier = new PythonVerifier();
  });

  afterAll(async () => {
    await verifier.shutdown();
  });

  beforeEach(() => {
    tree = createTree();
  });

  it('should generate valid Python for the full petstore example', async () => {
    const { types, client, asyncClient } = await generateAndRead(
      verifier,
      tree,
      PET_STORE_SPEC,
    );
    expect(types).toMatchSnapshot('types_gen.py');
    expect(client).toMatchSnapshot('client_gen.py');
    expect(asyncClient).toMatchSnapshot('async_client_gen.py');
  });

  it('should surface tag namespaces for addPet, findPetsByStatus, deletePet', async () => {
    await generateAndRead(verifier, tree, PET_STORE_SPEC);

    const add = await callGeneratedClient(
      verifier,
      'pet.add_pet',
      { name: 'doggie', photo_urls: ['https://example.com/1.jpg'] },
      {
        json: {
          id: 1,
          name: 'doggie',
          photoUrls: ['https://example.com/1.jpg'],
        },
      },
    );
    expect(add.ok).toBe(true);
    expect(add.value).toMatchObject({ id: 1, name: 'doggie' });

    const find = await callGeneratedClient(
      verifier,
      'pet.find_pets_by_status',
      { status: 'available' },
      { json: [{ id: 1, name: 'doggie', photoUrls: [], status: 'available' }] },
    );
    expect(find.ok).toBe(true);

    const deleted = await callGeneratedClient(
      verifier,
      'pet.delete_pet',
      { pet_id: 1 },
      { status: 200 },
    );
    expect(deleted.ok).toBe(true);
  });

  it('async petstore surface matches sync', async () => {
    await generateAndRead(verifier, tree, PET_STORE_SPEC);

    const add = await callGeneratedClientAsync(
      verifier,
      'pet.add_pet',
      { name: 'fido', photo_urls: [] },
      { json: { id: 2, name: 'fido', photoUrls: [] } },
    );
    expect(add.ok).toBe(true);
    expect(add.value).toMatchObject({ id: 2, name: 'fido' });
  });
});
