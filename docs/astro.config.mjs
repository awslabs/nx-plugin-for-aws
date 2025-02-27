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
        src: './src/content/docs/assets/houston.webp',
      },
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Concepts', link: '/get_started/concepts' },
            { label: 'Quick start', link: '/get_started/quick-start' },
            {
              label: 'Tutorial: AI Dungeon Game',
              link: '/get_started/tutorial-ai-dungeon-game',
            },
            {
              label: 'Tutorial: Usage in a existing project',
              link: '/get_started/tutorial-existing-project',
            },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'TypeScript', link: '/guides/typescript-project' },
            { label: 'tRPC', link: '/guides/trpc' },
            { label: 'FastAPI', link: '/guides/fastapi' },
            {
              label: 'API Connection',
              items: [
                { label: 'Connecting APIs', link: '/guides/api-connection' },
                {
                  label: 'React → FastAPI',
                  link: '/guides/api-connection/react-fastapi',
                },
                {
                  label: 'React → tRPC',
                  link: '/guides/api-connection/react-trpc',
                },
              ],
            },
            { label: 'License', link: '/guides/license' },
          ],
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
