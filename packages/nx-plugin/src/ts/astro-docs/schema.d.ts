/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
export interface TsAstroDocsGeneratorSchema {
  /**
   * The name of the docs project. Defaults to 'docs'.
   */
  name: string;
  /**
   * The parent directory the docs project is placed in. Defaults to '.' (workspace root).
   */
  directory?: string;
  /**
   * The sub directory the docs project is placed in. Defaults to the kebab-case project name.
   */
  subDirectory?: string;
  /**
   * Opt out of the automated documentation translation pipeline.
   */
  noTranslation?: boolean;
  /**
   * Opt out of the starlight-blog plugin and sample blog post.
   */
  noBlog?: boolean;
  /**
   * Skip installing dependencies after the generator runs.
   */
  skipInstall?: boolean;
}
