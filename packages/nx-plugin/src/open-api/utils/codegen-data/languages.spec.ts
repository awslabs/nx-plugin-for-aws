/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { toTypeScriptType, toPythonType, toPythonName } from './languages';
import { Model } from './types';

const createModel = (partial: Partial<Model>): Model => ({
  $refs: [],
  base: '',
  description: '',
  enum: [],
  enums: [],
  export: 'generic',
  imports: [],
  link: undefined,
  meta: { name: partial.name || '', $ref: null },
  name: partial.name || '',
  properties: [],
  type: partial.type || 'string',
  format: partial.format,
  deprecated: false,
  in: 'body',
  template: '',
  isDefinition: false,
  isNullable: false,
  isReadOnly: false,
  isRequired: false,
  ...partial,
});

describe('languages', () => {
  describe('toTypeScriptType', () => {
    it('should handle primitive types', () => {
      const model = createModel({ type: 'string', export: 'generic' });
      expect(toTypeScriptType(model)).toBe('string');
    });

    it('should handle date formats', () => {
      const dateModel = createModel({
        type: 'string',
        format: 'date',
        export: 'generic',
      });
      const dateTimeModel = createModel({
        type: 'string',
        format: 'date-time',
        export: 'generic',
      });
      expect(toTypeScriptType(dateModel)).toBe('Date');
      expect(toTypeScriptType(dateTimeModel)).toBe('Date');
    });

    it('should handle binary type', () => {
      const model = createModel({ type: 'binary', export: 'generic' });
      expect(toTypeScriptType(model)).toBe('Blob');
    });

    it('should handle array types', () => {
      const model = createModel({
        type: 'string',
        export: 'array',
        link: createModel({ type: 'string', export: 'generic' }),
      });
      expect(toTypeScriptType(model)).toBe('Array<string>');
    });

    it('should handle dictionary types', () => {
      const model = createModel({
        type: 'object',
        export: 'dictionary',
        link: createModel({ type: 'string', export: 'generic' }),
      });
      expect(toTypeScriptType(model)).toBe('{ [key: string]: string; }');
    });

    it('should handle one-of types', () => {
      const model = createModel({
        type: 'object',
        export: 'one-of',
        name: 'MyOneOf',
      });
      expect(toTypeScriptType(model)).toBe('MyOneOf');
    });
  });

  describe('toPythonType', () => {
    it('should handle primitive types', () => {
      const stringModel = createModel({ type: 'string', export: 'generic' });
      const boolModel = createModel({ type: 'boolean', export: 'generic' });
      const anyModel = createModel({ type: 'any', export: 'generic' });

      expect(toPythonType(stringModel)).toBe('str');
      expect(toPythonType(boolModel)).toBe('bool');
      expect(toPythonType(anyModel)).toBe('object');
    });

    it('should handle date formats', () => {
      const dateModel = createModel({
        type: 'string',
        format: 'date',
        export: 'generic',
      });
      const dateTimeModel = createModel({
        type: 'string',
        format: 'date-time',
        export: 'generic',
      });

      expect(toPythonType(dateModel)).toBe('date');
      expect(toPythonType(dateTimeModel)).toBe('datetime');
    });

    it('should handle number types', () => {
      const intModel = createModel({
        type: 'number',
        openapiType: 'integer',
        export: 'generic',
      } as any);
      const floatModel = createModel({
        type: 'number',
        format: 'float',
        export: 'generic',
      });
      const doubleModel = createModel({
        type: 'number',
        format: 'double',
        export: 'generic',
      });

      expect(toPythonType(intModel)).toBe('int');
      expect(toPythonType(floatModel)).toBe('float');
      expect(toPythonType(doubleModel)).toBe('float');
    });

    it('should handle array types', () => {
      const model = createModel({
        type: 'string',
        export: 'array',
        link: createModel({ type: 'string', export: 'generic' }),
      });
      expect(toPythonType(model)).toBe('List[str]');
    });

    it('should handle dictionary types', () => {
      const model = createModel({
        type: 'object',
        export: 'dictionary',
        link: createModel({ type: 'string', export: 'generic' }),
      });
      expect(toPythonType(model)).toBe('Dict[str, str]');
    });
  });

  describe('toPythonName', () => {
    it('should convert names to snake case', () => {
      expect(toPythonName('model', 'MyModel')).toBe('my_model');
      expect(toPythonName('property', 'myProperty')).toBe('my_property');
      expect(toPythonName('operation', 'getUser')).toBe('get_user');
    });

    it('should handle reserved keywords for models', () => {
      expect(toPythonName('model', 'class')).toBe('model_class');
      expect(toPythonName('model', 'import')).toBe('model_import');
    });

    it('should handle reserved keywords for properties', () => {
      expect(toPythonName('property', 'class')).toBe('var_class');
      expect(toPythonName('property', 'import')).toBe('var_import');
    });

    it('should handle reserved keywords for operations', () => {
      expect(toPythonName('operation', 'class')).toBe('call_class');
      expect(toPythonName('operation', 'import')).toBe('call_import');
    });

    it('should handle already escaped names', () => {
      expect(toPythonName('model', '_class')).toBe('model_class');
      expect(toPythonName('property', '_import')).toBe('var_import');
    });
  });
});
