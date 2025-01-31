/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { importJavaScriptModule } from './js';

describe('js utils', () => {
  describe('importJavaScriptModule', () => {
    it('should import the default javascript module export', async () => {
      expect(
        await importJavaScriptModule(`export default { foo: 'bar' }`),
      ).toEqual({ foo: 'bar' });
    });

    it('should import the full module without a default export', async () => {
      const module = await importJavaScriptModule<{
        baz: number;
        bat: string;
      }>(`
        export const baz = 42;
        export const bat = 'string';
      `);
      expect(module.baz).toBe(42);
      expect(module.bat).toBe('string');
    });
  });
});
