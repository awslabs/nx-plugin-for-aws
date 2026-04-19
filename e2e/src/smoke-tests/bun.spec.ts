/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { smokeTest } from './smoke-test';

// Bun's registry/scope/cache config comes from the user-level ~/.bunfig.toml
// written in global-setup.ts — no per-project bunfig needed.
smokeTest('bun');
