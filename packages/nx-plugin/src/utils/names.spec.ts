/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { toClassName, toKebabCase, toDotNotation } from './names';

describe('names utils', () => {
  describe('toClassName', () => {
    it('should convert basic strings to PascalCase', () => {
      expect(toClassName('hello world')).toBe('HelloWorld');
      expect(toClassName('my-component')).toBe('MyComponent');
      expect(toClassName('user_profile')).toBe('UserProfile');
    });

    it('should handle strings starting with numbers', () => {
      expect(toClassName('123hello')).toBe('_123hello');
      expect(toClassName('1st-place')).toBe('_1stPlace');
    });

    it('should handle empty or undefined input', () => {
      expect(toClassName('')).toBe('');
      expect(toClassName(undefined)).toBe(undefined);
    });

    it('should handle multiple consecutive separators', () => {
      expect(toClassName('hello__world')).toBe('HelloWorld');
      expect(toClassName('hello--world')).toBe('HelloWorld');
      expect(toClassName('hello  world')).toBe('HelloWorld');
    });
  });

  describe('toKebabCase', () => {
    it('should convert basic strings to kebab-case', () => {
      expect(toKebabCase('HelloWorld')).toBe('hello-world');
      expect(toKebabCase('myComponent')).toBe('my-component');
      expect(toKebabCase('UserProfile')).toBe('user-profile');
    });

    it('should preserve path separators', () => {
      expect(toKebabCase('src/components/UserProfile')).toBe(
        'src/components/user-profile',
      );
      expect(toKebabCase('pages/HomePage/index')).toBe('pages/home-page/index');
    });

    it('should handle empty or undefined input', () => {
      expect(toKebabCase('')).toBe('');
      expect(toKebabCase(undefined)).toBe(undefined);
    });

    it('should handle multiple consecutive separators', () => {
      expect(toKebabCase('hello__world')).toBe('hello-world');
      expect(toKebabCase('hello--world')).toBe('hello-world');
      expect(toKebabCase('hello  world')).toBe('hello-world');
    });
  });

  describe('toDotNotation', () => {
    it('should convert a string to a dot notation string', () => {
      expect(toDotNotation('lambda_handler/my_handler')).toBe(
        'lambda_handler.my_handler',
      );
    });

    it('should handle empty or undefined input', () => {
      expect(toDotNotation('')).toBe('');
      expect(toDotNotation(undefined)).toBe(undefined);
    });

    it('should handle multiple consecutive separators', () => {
      expect(toDotNotation('lambda_handler//my_handler')).toBe(
        'lambda_handler.my_handler',
      );
    });

    it('should handle .py extension', () => {
      expect(toDotNotation('lambda_handler/my_handler.py')).toBe(
        'lambda_handler.my_handler',
      );
    });

    it('should handle leading and trailing slashes', () => {
      expect(toDotNotation('/lambda_handler/my_handler/')).toBe(
        'lambda_handler.my_handler',
      );
    });

    it('should handle any file extensions', () => {
      expect(toDotNotation('lambda_handler/my_handler.ts')).toBe(
        'lambda_handler.my_handler',
      );

      expect(toDotNotation('lambda_handler/my_handler.toml')).toBe(
        'lambda_handler.my_handler',
      );

      expect(toDotNotation('lambda_handler/my_handler.json')).toBe(
        'lambda_handler.my_handler',
      );

      expect(toDotNotation('lambda_handler/my_handler.yaml')).toBe(
        'lambda_handler.my_handler',
      );
    });
  });
});
