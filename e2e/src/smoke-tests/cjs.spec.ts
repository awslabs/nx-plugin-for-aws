/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { smokeTest } from './smoke-test';

// Exercises the full generator matrix against a CommonJS workspace
// (`--module=cjs`), mirroring the default (ESM) smoke tests. Uses pnpm as a
// representative package manager.
smokeTest('pnpm', { variant: 'cjs', module: 'cjs' });
