/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

export const PACKAGE_MANAGERS = ['pnpm', 'yarn', 'npm', 'bun'] as const;
export const PackageManagerSchema = z.enum(PACKAGE_MANAGERS);
