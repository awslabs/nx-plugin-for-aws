/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// A py#rdb database exposes the same construct members and module outputs as a
// ts#rdb one, so the printed code is the same.
export {
  cdkRdbContainerWiring,
  dataStoreNames,
  rdbContainerWiringMessage,
  terraformRdbContainerWiring,
} from '../../../ts/rdb/container-connection/wiring.js';
