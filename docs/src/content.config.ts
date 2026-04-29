/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { defineCollection, z } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { blogSchema } from 'starlight-blog/schema';
import { videosSchema } from 'starlight-videos/schemas';

const whenValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number(), z.boolean()])),
]);

const optionFilterSchema = z.object({
  generator: z.string().optional(),
  /**
   * Predicate identifying the option combination this guide page applies to.
   * Same semantics as `<OptionFilter when={{…}}>` — multiple keys are ANDed,
   * array values ORed within a key. Consumed by the MCP `generator-guide`
   * tool at runtime to pick which variant page(s) to return for a given
   * `options` selection.
   */
  when: z.record(z.string(), whenValueSchema).optional(),
});

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: (context) =>
        blogSchema(context).and(videosSchema).and(optionFilterSchema),
    }),
  }),
};
