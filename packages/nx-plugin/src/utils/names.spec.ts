/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { toClassName, toKebabCase } from './names';

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
        'src/components/user-profile'
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
});
