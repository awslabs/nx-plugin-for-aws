/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @ts-check
import { defineConfig, passthroughImageService } from 'astro/config';

import starlight from '@astrojs/starlight';
import starlightBlog from 'starlight-blog';
import starlightLinksValidator from 'starlight-links-validator';
import starlightVideos from 'starlight-videos';

// https://astro.build/config
export default defineConfig({
  image: {
    service: passthroughImageService(),
  },
  outDir: '../dist/docs',
  integrations: [
    starlight({
      title: '@aws/nx-plugin',
      social: {
        github: 'https://github.com/withastro/starlight',
      },
      logo: {
        src: './src/assets/houston.webp',
      },
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        {
          label: 'Guides',
          items: [
            // Each item here is one entry in the navigation menu.
            { label: 'Overview', slug: 'guides/example' },
            { label: 'Tutorial', slug: 'guides/tutorial' },
          ],
        },
        {
          label: 'Reference',
          autogenerate: { directory: 'reference' },
        },
      ],
      plugins: [
        starlightLinksValidator(),
        starlightVideos(),
        starlightBlog({
          authors: {
            dimecha: {
              name: 'Adrian',
              title: 'Principal Software Engineer (AWS)',
              url: 'https://github.com/agdimech',
              picture: 'https://avatars.githubusercontent.com/u/51220968?v=4',
            },
          },
        }),
      ],
    }),
  ],
});
