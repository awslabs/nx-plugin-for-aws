/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { IacOption } from '../../../utils/iac';

export interface TsReactWebsiteAuthGeneratorSchema {
  project: string;
  allowSignup: boolean;
  cognitoDomain?: string;
  iac: IacOption;
}
