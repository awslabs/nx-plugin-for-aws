/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { IacOption } from '../../../utils/iac';
import { UxOption } from './generator';

export interface TsReactWebsiteGeneratorSchema {
  name: string;
  directory?: string;
  subDirectory?: string;
  skipInstall?: boolean;
  enableTanstackRouter?: boolean;
  enableTailwind?: boolean;
  ux?: UxOption;
  iac: IacOption;
}
