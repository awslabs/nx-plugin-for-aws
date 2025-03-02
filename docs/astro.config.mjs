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

import tailwindcss from '@tailwindcss/vite';

import react from '@astrojs/react';

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
        dark: './src/content/docs/assets/bulb-white.svg',
        light: './src/content/docs/assets/bulb-black.svg',
      },
      customCss: ['./src/styles/custom.css', './src/styles/tailwind.css'],
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
            { label: 'ts#project', link: '/guides/typescript-project' },
            { label: 'ts#infra', link: '/guides/typescript-infrastructure' },
            { label: 'ts#trpc-api', link: '/guides/trpc' },
            { label: 'ts#cloudscape-website', link: '/guides/cloudscape-website' },
            { label: 'ts#cloudscape-website#auth', link: '/guides/cloudscape-website-auth' },
            { label: 'py#project', link: '/guides/python-project' },
            { label: 'py#fast-api', link: '/guides/fastapi' },
            {
              label: 'api-connection',
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
            { label: 'license', link: '/guides/license' },
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
    react(),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
