/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { IacProviderOption } from '../../../utils/iac';
import { UxProviderOption } from '../../react-website/app/generator';

export type WebsiteFramework = 'React';

export interface TsWebsiteGeneratorSchema {
  name: string;
  framework?: WebsiteFramework;
  directory?: string;
  subDirectory?: string;
  skipInstall?: boolean;
  enableTanstackRouter?: boolean;
  enableTailwind?: boolean;
  uxProvider?: UxProviderOption;
  iacProvider: IacProviderOption;
}
