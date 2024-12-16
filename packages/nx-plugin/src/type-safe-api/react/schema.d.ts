/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
export interface TypeSafeApiReactGeneratorSchema {
  /**
   * The name of the project to add the React integration to
   */
  frontendProject: string;

  /**
   * The name of the Type Safe API generated react hooks library project
   */
  hooksLibraryProject: string;

  /**
   * Authentication strategy
   */
  auth: 'IAM' | 'None';
}
