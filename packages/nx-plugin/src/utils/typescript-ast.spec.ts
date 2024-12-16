/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { describe, it, expect } from 'vitest';
import { writeExportDeclarations, addExportDeclarations, addDefaultImportDeclarations, addJsxComponentWrapper } from './typescript-ast';

describe('typescript-ast', () => {
  describe('writeExportDeclarations', () => {
    it('should add export declarations to an empty file', () => {
      // Arrange
      const tree = createTreeWithEmptyWorkspace();
      const filePath = 'test.ts';
      tree.write(filePath, '');
      const exports = ['./module1', './module2'];

      // Act
      writeExportDeclarations(tree, filePath, exports);

      // Assert
      const content = tree.read(filePath).toString();
      expect(content).toContain("export * from './module1'");
      expect(content).toContain("export * from './module2'");
    });

    it('should add export declarations to a file with existing content', () => {
      // Arrange
      const tree = createTreeWithEmptyWorkspace();
      const filePath = 'test.ts';
      const existingContent = 'const x = 1;\n';
      tree.write(filePath, existingContent);
      const exports = ['./module1'];

      // Act
      writeExportDeclarations(tree, filePath, exports);

      // Assert
      const content = tree.read(filePath).toString();
      expect(content).toContain("export * from './module1'");
      expect(content).toContain('const x = 1;');
    });
  });

  describe('addExportDeclarations', () => {
    it('should add export declarations to empty content', () => {
      // Arrange
      const content = '';
      const exports = ['./module1', './module2'];

      // Act
      const result = addExportDeclarations(content, exports);

      // Assert
      expect(result).toContain("export * from './module1'");
      expect(result).toContain("export * from './module2'");
    });

    it('should add export declarations before existing content', () => {
      // Arrange
      const content = 'const x = 1;\n';
      const exports = ['./module1'];

      // Act
      const result = addExportDeclarations(content, exports);

      // Assert
      expect(result).toContain("export * from './module1'");
      expect(result).toContain('const x = 1;');
      expect(result.indexOf("export * from './module1'")).toBeLessThan(result.indexOf('const x = 1;'));
    });
  });

  describe('addDefaultImportDeclarations', () => {
    it('should add default import declarations to empty content', () => {
      // Arrange
      const content = '';
      const imports = [
        { import: 'React', from: 'react' },
        { import: 'Button', from: '@aws-amplify/ui-react' }
      ];

      // Act
      const result = addDefaultImportDeclarations(content, imports);

      // Assert
      expect(result).toContain("import React from 'react'");
      expect(result).toContain("import Button from '@aws-amplify/ui-react'");
    });

    it('should add default import declarations before existing content', () => {
      // Arrange
      const content = 'const x = 1;\n';
      const imports = [{ import: 'React', from: 'react' }];

      // Act
      const result = addDefaultImportDeclarations(content, imports);

      // Assert
      expect(result).toContain("import React from 'react'");
      expect(result).toContain('const x = 1;');
      expect(result.indexOf("import React from 'react'")).toBeLessThan(result.indexOf('const x = 1;'));
    });
  });

  describe('addJsxComponentWrapper', () => {
    it('should wrap target component with parent component', () => {
      // Arrange
      const content = '<Target />';
      const targetComponent = 'Target';
      const parentComponent = 'Parent';

      // Act
      const result = addJsxComponentWrapper(content, targetComponent, parentComponent);

      // Assert
      expect(result).toBeDefined();
      expect(result).toContain('<Parent><Target /></Parent>');
    });

    it('should return undefined when target component is not found', () => {
      // Arrange
      const content = '<OtherComponent />';
      const targetComponent = 'Target';
      const parentComponent = 'Parent';

      // Act
      const result = addJsxComponentWrapper(content, targetComponent, parentComponent);

      // Assert
      expect(result).toBeUndefined();
    });

    it('should only wrap the specified target component', () => {
      // Arrange
      const content = '<div><Target /><OtherComponent /></div>';
      const targetComponent = 'Target';
      const parentComponent = 'Parent';

      // Act
      const result = addJsxComponentWrapper(content, targetComponent, parentComponent);

      // Assert
      expect(result).toBeDefined();
      expect(result).toContain('<div><Parent><Target /></Parent><OtherComponent /></div>');
    });
  });
});
