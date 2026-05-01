/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { smokeTest } from './smoke-test';

// Classic yarn (1.x) — whichever version is on PATH. Paired with `yarn-4.spec.ts`
// to cover both classic and berry code paths in create-nx-workspace.
smokeTest('yarn', { variant: 'yarn-classic' });
