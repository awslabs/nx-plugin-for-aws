/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { parse, stringify } from '@iarna/toml';
import { UVPyprojectToml } from '@nxlv/python/src/provider/uv/types';
import { addDependenciesToPyProjectToml } from './py';
import { IPyDepVersion } from './versions';

describe('addDependenciesToPyProjectToml', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('should add dependencies to an empty pyproject.toml', () => {
    // Setup: Create a basic pyproject.toml
    const initialToml = {
      project: {
        name: 'test-project',
        version: '0.1.0',
        dependencies: [],
      },
    };
    tree.write('test-project/pyproject.toml', stringify(initialToml));

    // Act: Add dependencies
    const deps: IPyDepVersion[] = ['fastapi', 'mangum'];
    addDependenciesToPyProjectToml(tree, 'test-project', deps);

    // Assert: Verify dependencies were added
    const updatedToml = parse(
      tree.read('test-project/pyproject.toml', 'utf-8'),
    ) as UVPyprojectToml;

    expect(updatedToml.project.dependencies).toContain('fastapi~=0.116.1');
    expect(updatedToml.project.dependencies).toContain('mangum~=0.19.0');
    expect(updatedToml.project.dependencies).toHaveLength(2);
  });

  it('should add dependencies to existing dependencies without duplicates', () => {
    // Setup: Create pyproject.toml with existing dependencies
    const initialToml = {
      project: {
        name: 'test-project',
        version: '0.1.0',
        dependencies: ['requests>=2.25.0', 'pydantic~=2.0.0'],
      },
    };
    tree.write('test-project/pyproject.toml', stringify(initialToml));

    // Act: Add new dependencies
    const deps: IPyDepVersion[] = ['fastapi', 'mangum'];
    addDependenciesToPyProjectToml(tree, 'test-project', deps);

    // Assert: Verify all dependencies are present
    const updatedToml = parse(
      tree.read('test-project/pyproject.toml', 'utf-8'),
    ) as UVPyprojectToml;

    expect(updatedToml.project.dependencies).toContain('requests>=2.25.0');
    expect(updatedToml.project.dependencies).toContain('pydantic~=2.0.0');
    expect(updatedToml.project.dependencies).toContain('fastapi~=0.116.1');
    expect(updatedToml.project.dependencies).toContain('mangum~=0.19.0');
    expect(updatedToml.project.dependencies).toHaveLength(4);
  });

  it('should replace existing dependencies with same name', () => {
    // Setup: Create pyproject.toml with existing fastapi dependency
    const initialToml = {
      project: {
        name: 'test-project',
        version: '0.1.0',
        dependencies: ['fastapi>=0.100.0', 'requests>=2.25.0'],
      },
    };
    tree.write('test-project/pyproject.toml', stringify(initialToml));

    // Act: Add fastapi dependency (should replace existing)
    const deps: IPyDepVersion[] = ['fastapi'];
    addDependenciesToPyProjectToml(tree, 'test-project', deps);

    // Assert: Verify fastapi was replaced and requests remains
    const updatedToml = parse(
      tree.read('test-project/pyproject.toml', 'utf-8'),
    ) as UVPyprojectToml;

    expect(updatedToml.project.dependencies).toContain('fastapi~=0.116.1');
    expect(updatedToml.project.dependencies).toContain('requests>=2.25.0');
    expect(updatedToml.project.dependencies).toHaveLength(2);

    // Ensure old fastapi version is not present
    expect(updatedToml.project.dependencies).not.toContain('fastapi>=0.100.0');
  });

  it('should handle pyproject.toml without existing dependencies array', () => {
    // Setup: Create pyproject.toml without dependencies array
    const initialToml = {
      project: {
        name: 'test-project',
        version: '0.1.0',
      },
    };
    tree.write('test-project/pyproject.toml', stringify(initialToml));

    // Act: Add dependencies
    const deps: IPyDepVersion[] = ['fastapi', 'mangum'];
    addDependenciesToPyProjectToml(tree, 'test-project', deps);

    // Assert: Verify dependencies were added
    const updatedToml = parse(
      tree.read('test-project/pyproject.toml', 'utf-8'),
    ) as UVPyprojectToml;

    expect(updatedToml.project.dependencies).toContain('fastapi~=0.116.1');
    expect(updatedToml.project.dependencies).toContain('mangum~=0.19.0');
    expect(updatedToml.project.dependencies).toHaveLength(2);
  });

  it('should handle complex dependency specifications', () => {
    // Setup: Create pyproject.toml with complex existing dependencies
    const initialToml = {
      project: {
        name: 'test-project',
        version: '0.1.0',
        dependencies: [
          'fastapi[all]>=0.100.0',
          'requests[security]>=2.25.0',
          'pydantic>=2.0.0,<3.0.0',
        ],
      },
    };
    tree.write('test-project/pyproject.toml', stringify(initialToml));

    // Act: Add fastapi dependency (should replace complex existing one)
    const deps: IPyDepVersion[] = ['fastapi'];
    addDependenciesToPyProjectToml(tree, 'test-project', deps);

    // Assert: Verify fastapi was replaced while others remain
    const updatedToml = parse(
      tree.read('test-project/pyproject.toml', 'utf-8'),
    ) as UVPyprojectToml;

    expect(updatedToml.project.dependencies).toContain('fastapi~=0.116.1');
    expect(updatedToml.project.dependencies).toContain(
      'requests[security]>=2.25.0',
    );
    expect(updatedToml.project.dependencies).toContain(
      'pydantic>=2.0.0,<3.0.0',
    );
    expect(updatedToml.project.dependencies).toHaveLength(3);

    // Ensure old fastapi version is not present
    expect(updatedToml.project.dependencies).not.toContain(
      'fastapi[all]>=0.100.0',
    );
  });

  it('should handle multiple dependencies with some replacements', () => {
    // Setup: Create pyproject.toml with mixed existing dependencies
    const initialToml = {
      project: {
        name: 'test-project',
        version: '0.1.0',
        dependencies: [
          'fastapi>=0.100.0',
          'requests>=2.25.0',
          'aws-lambda-powertools>=2.0.0',
        ],
      },
    };
    tree.write('test-project/pyproject.toml', stringify(initialToml));

    // Act: Add dependencies (some new, some replacements)
    const deps: IPyDepVersion[] = [
      'fastapi',
      'mangum',
      'aws-lambda-powertools',
    ];
    addDependenciesToPyProjectToml(tree, 'test-project', deps);

    // Assert: Verify correct dependencies are present
    const updatedToml = parse(
      tree.read('test-project/pyproject.toml', 'utf-8'),
    ) as UVPyprojectToml;

    expect(updatedToml.project.dependencies).toContain('fastapi~=0.116.1');
    expect(updatedToml.project.dependencies).toContain('mangum~=0.19.0');
    expect(updatedToml.project.dependencies).toContain(
      'aws-lambda-powertools~=3.19.0',
    );
    expect(updatedToml.project.dependencies).toContain('requests>=2.25.0');
    expect(updatedToml.project.dependencies).toHaveLength(4);

    // Ensure old versions are not present
    expect(updatedToml.project.dependencies).not.toContain('fastapi>=0.100.0');
    expect(updatedToml.project.dependencies).not.toContain(
      'aws-lambda-powertools>=2.0.0',
    );
  });

  it('should handle empty dependencies array', () => {
    // Setup: Create pyproject.toml with existing dependencies
    const initialToml = {
      project: {
        name: 'test-project',
        version: '0.1.0',
        dependencies: ['requests>=2.25.0'],
      },
    };
    tree.write('test-project/pyproject.toml', stringify(initialToml));

    // Act: Add empty dependencies array
    const deps: IPyDepVersion[] = [];
    addDependenciesToPyProjectToml(tree, 'test-project', deps);

    // Assert: Verify existing dependencies remain unchanged
    const updatedToml = parse(
      tree.read('test-project/pyproject.toml', 'utf-8'),
    ) as UVPyprojectToml;

    expect(updatedToml.project.dependencies).toContain('requests>=2.25.0');
    expect(updatedToml.project.dependencies).toHaveLength(1);
  });

  it('should preserve other pyproject.toml sections', () => {
    // Setup: Create comprehensive pyproject.toml
    const initialToml = {
      project: {
        name: 'test-project',
        version: '0.1.0',
        description: 'A test project',
        authors: [{ name: 'Test Author', email: 'test@example.com' }],
        dependencies: ['requests>=2.25.0'],
      },
      'dependency-groups': {
        dev: ['pytest>=7.0.0', 'black>=22.0.0'],
      },
      tool: {
        pytest: {
          testpaths: ['tests'],
        },
      },
    };
    tree.write('test-project/pyproject.toml', stringify(initialToml));

    // Act: Add dependencies
    const deps: IPyDepVersion[] = ['fastapi'];
    addDependenciesToPyProjectToml(tree, 'test-project', deps);

    // Assert: Verify other sections are preserved
    const updatedToml = parse(
      tree.read('test-project/pyproject.toml', 'utf-8'),
    ) as UVPyprojectToml;

    expect(updatedToml.project.name).toBe('test-project');
    expect((updatedToml as any).project.description).toBe('A test project');
    expect((updatedToml as any).project.authors).toEqual([
      { name: 'Test Author', email: 'test@example.com' },
    ]);
    expect(updatedToml['dependency-groups']?.dev).toContain('pytest>=7.0.0');
    expect(updatedToml['dependency-groups']?.dev).toContain('black>=22.0.0');
    expect((updatedToml as any).tool?.pytest?.testpaths).toEqual(['tests']);

    // And verify dependencies were updated
    expect(updatedToml.project.dependencies).toContain('fastapi~=0.116.1');
    expect(updatedToml.project.dependencies).toContain('requests>=2.25.0');
  });

  it('should handle nested project directory paths', () => {
    // Setup: Create pyproject.toml in nested directory
    const initialToml = {
      project: {
        name: 'nested-project',
        version: '0.1.0',
        dependencies: [],
      },
    };
    tree.write('apps/nested/path/pyproject.toml', stringify(initialToml));

    // Act: Add dependencies to nested project
    const deps: IPyDepVersion[] = ['fastapi', 'mangum'];
    addDependenciesToPyProjectToml(tree, 'apps/nested/path', deps);

    // Assert: Verify dependencies were added to correct file
    const updatedToml = parse(
      tree.read('apps/nested/path/pyproject.toml', 'utf-8'),
    ) as UVPyprojectToml;

    expect(updatedToml.project.dependencies).toContain('fastapi~=0.116.1');
    expect(updatedToml.project.dependencies).toContain('mangum~=0.19.0');
    expect(updatedToml.project.dependencies).toHaveLength(2);
  });

  it('should handle URL dependencies without replacing them', () => {
    // Setup: Create pyproject.toml with URL dependencies
    const initialToml = {
      project: {
        name: 'test-project',
        version: '0.1.0',
        dependencies: [
          'pip@https://github.com/pypa/pip/archive/22.0.2.zip',
          'requests @ git+https://github.com/psf/requests.git@main',
          'fastapi>=0.100.0',
          'pydantic @ https://files.pythonhosted.org/packages/pydantic-2.0.0.tar.gz',
        ],
      },
    };
    tree.write('test-project/pyproject.toml', stringify(initialToml));

    // Act: Add fastapi dependency (should replace only the ProjectName requirement)
    const deps: IPyDepVersion[] = ['fastapi'];
    addDependenciesToPyProjectToml(tree, 'test-project', deps);

    // Assert: Verify URL dependencies are preserved, only ProjectName fastapi is replaced
    const updatedToml = parse(
      tree.read('test-project/pyproject.toml', 'utf-8'),
    ) as UVPyprojectToml;

    // URL dependencies should be preserved
    expect(updatedToml.project.dependencies).toContain(
      'pip@https://github.com/pypa/pip/archive/22.0.2.zip',
    );
    expect(updatedToml.project.dependencies).toContain(
      'requests @ git+https://github.com/psf/requests.git@main',
    );
    expect(updatedToml.project.dependencies).toContain(
      'pydantic @ https://files.pythonhosted.org/packages/pydantic-2.0.0.tar.gz',
    );

    // ProjectName fastapi should be replaced with versioned one
    expect(updatedToml.project.dependencies).toContain('fastapi~=0.116.1');
    expect(updatedToml.project.dependencies).not.toContain('fastapi>=0.100.0');

    expect(updatedToml.project.dependencies).toHaveLength(4);
  });
});
