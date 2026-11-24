/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { logger } from '@nx/devkit';
import { describe, expect, it, vi } from 'vitest';
import { stubHostArch } from '../test.js';
import {
  containerBuildPlatform,
  containerPythonPlatform,
  hostArchitecture,
  recordedContainerArchitecture,
  resolveContainerArchitecture,
  vendedArchitectureFiles,
  warnArchitectureSwitchIsPartial,
  warnIfArchitectureNeedsEmulation,
} from './container-constructs.js';

/**
 * Stands in for the architecture of the machine the generator runs on, so both
 * branches are covered wherever the tests themselves run. Getting this wrong
 * silently builds images no one's machine can run.
 */
const onArch = <T>(arch: string, run: () => T): T => {
  const restore = stubHostArch(arch);
  try {
    return run();
  } finally {
    restore();
  }
};

describe('hostArchitecture', () => {
  it('should read ARM64 from an arm64 host', () => {
    expect(onArch('arm64', hostArchitecture)).toBe('ARM64');
  });

  it.each(['x64', 'ia32', 'ppc64', 's390x'])(
    'should read X86_64 from a %s host, the only other architecture Fargate runs',
    (arch) => {
      expect(onArch(arch, hostArchitecture)).toBe('X86_64');
    },
  );
});

describe('containerBuildPlatform', () => {
  it('should build linux/arm64 for ARM64', () => {
    expect(containerBuildPlatform('ARM64')).toBe('linux/arm64');
  });

  it('should build linux/amd64 for X86_64', () => {
    expect(containerBuildPlatform('X86_64')).toBe('linux/amd64');
  });
});

describe('containerPythonPlatform', () => {
  it('should resolve aarch64 wheels for ARM64', () => {
    expect(containerPythonPlatform('ARM64')).toBe('aarch64-manylinux_2_28');
  });

  it('should resolve x86_64 wheels for X86_64', () => {
    expect(containerPythonPlatform('X86_64')).toBe('x86_64-manylinux_2_28');
  });
});

describe('recordedContainerArchitecture', () => {
  it('should be undefined for a component this run is creating', () => {
    expect(recordedContainerArchitecture(undefined)).toBeUndefined();
  });

  it('should read the recorded architecture', () => {
    expect(recordedContainerArchitecture({ architecture: 'X86_64' })).toBe(
      'X86_64',
    );
  });

  // The vended code of a component generated before this option existed is
  // ARM64 whatever machine it was generated on.
  it('should be ARM64 for a component recorded without an architecture', () => {
    expect(recordedContainerArchitecture({})).toBe('ARM64');
  });
});

describe('resolveContainerArchitecture', () => {
  it('should use the host architecture for a new component', () => {
    expect(onArch('arm64', () => resolveContainerArchitecture())).toBe('ARM64');
    expect(onArch('x64', () => resolveContainerArchitecture())).toBe('X86_64');
  });

  it('should let an explicitly requested architecture win over the host', () => {
    expect(onArch('x64', () => resolveContainerArchitecture('ARM64'))).toBe(
      'ARM64',
    );
    expect(onArch('arm64', () => resolveContainerArchitecture('X86_64'))).toBe(
      'X86_64',
    );
  });

  it('should keep the architecture a previous run recorded', () => {
    expect(
      onArch('x64', () =>
        resolveContainerArchitecture(undefined, { architecture: 'ARM64' }),
      ),
    ).toBe('ARM64');
    expect(
      onArch('arm64', () =>
        resolveContainerArchitecture(undefined, { architecture: 'X86_64' }),
      ),
    ).toBe('X86_64');
  });

  it('should let an explicitly requested architecture win over a recorded one', () => {
    expect(
      resolveContainerArchitecture('X86_64', { architecture: 'ARM64' }),
    ).toBe('X86_64');
  });

  // The vended code of a component generated before this option existed is
  // ARM64 whatever machine it was generated on, so a re-run must not move it.
  it('should keep ARM64 for a component recorded without an architecture', () => {
    expect(
      onArch('x64', () => resolveContainerArchitecture(undefined, {})),
    ).toBe('ARM64');
  });
});

describe('warnIfArchitectureNeedsEmulation', () => {
  it('should warn naming both architectures and both fixes', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      onArch('x64', () => warnIfArchitectureNeedsEmulation('ARM64'));

      expect(warn).toHaveBeenCalledTimes(1);
      const message = warn.mock.calls[0][0] as string;
      expect(message).toContain('ARM64');
      expect(message).toContain('X86_64');
      expect(message).toContain('exec format error');
      expect(message).toContain(
        'docker run --privileged --rm tonistiigi/binfmt --install arm64',
      );
      expect(message).toContain('--architecture=X86_64');
    } finally {
      warn.mockRestore();
    }
  });

  it('should name the amd64 emulator on an arm64 host', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      onArch('arm64', () => warnIfArchitectureNeedsEmulation('X86_64'));

      const message = warn.mock.calls[0][0] as string;
      expect(message).toContain(
        'docker run --privileged --rm tonistiigi/binfmt --install amd64',
      );
      expect(message).toContain('--architecture=ARM64');
    } finally {
      warn.mockRestore();
    }
  });

  it('should stay quiet when the image is built for the host', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      onArch('x64', () => warnIfArchitectureNeedsEmulation('X86_64'));
      onArch('arm64', () => warnIfArchitectureNeedsEmulation('ARM64'));

      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('vendedArchitectureFiles', () => {
  it('should name the CDK service subclass and the line to change', () => {
    expect(vendedArchitectureFiles('orders', 'cdk', 'X86_64')).toEqual([
      {
        path: 'packages/common/constructs/src/app/services/orders.ts',
        change: "set architecture: 'X86_64'",
      },
    ]);
  });

  it('should name the Terraform app module and the variable to change', () => {
    expect(vendedArchitectureFiles('orders', 'terraform', 'ARM64')).toEqual([
      {
        path: 'packages/common/terraform/src/app/services/orders/orders.tf',
        change:
          'set cpu_architecture = "ARM64" in its module "ecs_service" block',
      },
    ]);
  });

  it('should name nothing for a service with no vended infrastructure', () => {
    expect(vendedArchitectureFiles('orders', undefined, 'ARM64')).toEqual([]);
  });
});

describe('warnArchitectureSwitchIsPartial', () => {
  const warned = (
    options: Parameters<typeof warnArchitectureSwitchIsPartial>[0],
  ): string => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      warnArchitectureSwitchIsPartial(options);
      expect(warn).toHaveBeenCalledTimes(1);
      return warn.mock.calls[0][0] as string;
    } finally {
      warn.mockRestore();
    }
  };

  it('should name both architectures and the file the generator did not change', () => {
    const message = warned({
      from: 'ARM64',
      to: 'X86_64',
      unchangedFiles: vendedArchitectureFiles('orders', 'cdk', 'X86_64'),
    });

    expect(message).toContain('generated for ARM64 and is now set to X86_64');
    expect(message).toContain('still deploys ARM64');
    expect(message).toContain(
      "packages/common/constructs/src/app/services/orders.ts: set architecture: 'X86_64'",
    );
    expect(message).not.toContain('bundle-');
  });

  it('should name the stale bundle target when one is left behind', () => {
    const message = warned({
      from: 'ARM64',
      to: 'X86_64',
      unchangedFiles: [],
      staleBundleTarget: 'bundle-arm',
    });

    expect(message).toContain('bundle-arm');
    expect(message).toContain('Remove it once nothing else uses it');
  });

  it('should still say what happened when no infrastructure was vended', () => {
    const message = warned({
      from: 'X86_64',
      to: 'ARM64',
      unchangedFiles: [],
    });

    expect(message).toContain('generated for X86_64 and is now set to ARM64');
    expect(message).toContain('then redeploy');
  });
});
