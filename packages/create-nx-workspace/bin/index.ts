#!/usr/bin/env node
/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createNxWorkspace } from '../src/create-nx-workspace';

const args = process.argv.slice(2);
process.exit(createNxWorkspace(args));
