/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { smithyCliCommand } from './smithy';
import { SMITHY_VERSIONS, TS_VERSIONS } from './versions';

describe('smithyCliCommand', () => {
  it('should resolve the pinned cli through mise', () => {
    expect(smithyCliCommand()).toBe(
      `npx -y mise@${TS_VERSIONS.mise} exec smithy@${SMITHY_VERSIONS.cli} -- smithy`,
    );
  });

  /**
   * Both versions must stay greppable by the version sync, which moves them
   * forward by matching them in the generated command.
   */
  it('should pin both versions so the version sync can move them', () => {
    const command = smithyCliCommand();

    expect(command).toContain(`mise@${TS_VERSIONS.mise}`);
    expect(command).toContain(`smithy@${SMITHY_VERSIONS.cli}`);
  });
});
