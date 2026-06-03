/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
declare module 'vitest' {
  export interface ProvidedContext {
    publishedVersion: string;
  }
}

// mark this file as a module so augmentation works correctly
export {};
