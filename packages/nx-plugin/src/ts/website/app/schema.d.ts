/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { IacOption } from '../../../utils/iac';
import { UxOption } from '../../react-website/app/generator';

export type WebsiteFramework = 'react';
export type WebsiteInfraOption = 'cloudfront-s3' | 'none';

export interface TsWebsiteGeneratorSchema {
  name: string;
  framework?: WebsiteFramework;
  directory?: string;
  subDirectory?: string;
  skipInstall?: boolean;
  tanstackRouter?: boolean;
  tailwind?: boolean;
  ux?: UxOption;
  infra?: WebsiteInfraOption;
  iac: IacOption;
}
