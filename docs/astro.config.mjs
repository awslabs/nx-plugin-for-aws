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
  site: 'https://awslabs.github.io',
  base: '/nx-plugin-for-aws',
  image: {
    service: passthroughImageService(),
  },
  outDir: '../dist/docs',
  integrations: [
    starlight({
      title: '@aws/nx-plugin',
      social: {
        github: 'https://github.com/awslabs/nx-plugin-for-aws',
      },
      defaultLocale: 'en',
      locales: {
        en: {
          label: 'English',
        },
        jp: {
          label: '日本語',
        },
        ko: {
          label: '한국인',
        },
      },
      sidebar: [
        {
          label: 'Getting Started',
          translations: {
            jp: '始めましょう',
            ko: '시작하기',
          },
          items: [
            {
              label: 'Concepts',
              link: '/get_started/concepts',
              translations: {
                jp: 'コンセプト',
                ko: '개념',
              },
            },
            {
              label: 'Quick start',
              link: '/get_started/quick-start',
              translations: {
                jp: 'クイックスタート',
                ko: '빠른 시작',
              },
            },
            {
              label: 'Tutorials',
              translations: {
                jp: 'チュートリアル',
                ko: '튜토리얼',
              },
              items: [
                {
                  label: 'AI Dungeon Game',
                  translations: {
                    jp: 'AIダンジョンゲーム',
                    ko: 'AI 던전 게임',
                  },
                  collapsed: true,
                  items: [
                    {
                      label: 'Overview',
                      translations: {
                        jp: '概要',
                        ko: '개요',
                      },
                      link: '/get_started/tutorials/dungeon-game/overview',
                    },
                    {
                      label: '1. Monorepo setup',
                      translations: {
                        jp: '1. モノレポのセットアップ',
                        ko: '1. 모노레포 설정',
                      },
                      link: '/get_started/tutorials/dungeon-game/1',
                    },
                    {
                      label: '2. Game API',
                      translations: {
                        jp: '2. ゲームAPI',
                        ko: '2. 게임 API',
                      },
                      link: '/get_started/tutorials/dungeon-game/2',
                    },
                    {
                      label: '3. Story API',
                      translations: {
                        jp: '3. ストーリーAPI',
                        ko: '3. 스토리 API',
                      },
                      link: '/get_started/tutorials/dungeon-game/3',
                    },
                    {
                      label: '4. UI',
                      link: '/get_started/tutorials/dungeon-game/4',
                    },
                    {
                      label: 'Wrap up',
                      translations: {
                        jp: 'まとめ',
                        ko: '마무리',
                      },
                      link: '/get_started/tutorials/dungeon-game/wrap-up',
                    },
                  ],
                },
                {
                  label: 'Create a generator',
                  translations: {
                    jp: 'ジェネレーターの作成',
                    ko: '제너레이터 만들기',
                  },
                  link: '/get_started/tutorials/create-generator',
                },
              ],
            },
          ],
        },
        {
          label: 'Guides',
          translations: {
            jp: 'ガイド',
            ko: '가이드',
          },
          items: [
            { label: 'ts#project', link: '/guides/typescript-project' },
            { label: 'ts#infra', link: '/guides/typescript-infrastructure' },
            { label: 'ts#trpc-api', link: '/guides/trpc' },
            {
              label: 'ts#cloudscape-website',
              link: '/guides/cloudscape-website',
            },
            {
              label: 'ts#cloudscape-website#auth',
              link: '/guides/cloudscape-website-auth',
            },
            { label: 'py#project', link: '/guides/python-project' },
            { label: 'py#fast-api', link: '/guides/fastapi' },
            {
              label: 'py#lambda-function',
              link: '/guides/python-lambda-function',
            },
            {
              label: 'api-connection',
              items: [
                {
                  label: 'Connecting APIs',
                  translations: {
                    jp: 'APIの接続',
                    ko: 'API 연결',
                  },
                  link: '/guides/api-connection',
                },
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
            {
              label: 'license',
              link: '/guides/license',
            },
          ],
        },
        {
          label: 'About',
          translations: {
            jp: '概要',
            ko: '소개',
          },
          items: [
            {
              label: 'Usage Metrics',
              translations: {
                jp: '使用状況メトリクス',
                ko: '사용 지표',
              },
              link: '/about/metrics',
            },
            {
              label: 'Documentation Translation',
              translations: {
                jp: 'ドキュメント翻訳',
                ko: '문서 번역',
              },
              link: '/about/translation',
            },
          ],
          collapsed: true,
        },
      ],
      logo: {
        dark: './src/content/docs/assets/bulb-white.svg',
        light: './src/content/docs/assets/bulb-black.svg',
      },
      customCss: ['./src/styles/custom.css', './src/styles/tailwind.css'],
      plugins: [
        starlightLinksValidator({
          errorOnLocalLinks: false,
          errorOnRelativeLinks: false,
          errorOnInvalidHashes: false, // non en locales
        }),
        starlightVideos(),
        starlightBlog({
          authors: {
            adrian: {
              name: 'Adrian',
              title: 'Principal Software Engineer (AWS)',
              url: 'https://github.com/agdimech',
              picture: 'https://avatars.githubusercontent.com/u/51220968?v=4',
            },
            jack: {
              name: 'Jack',
              title: 'Senior Prototyping Engineer (AWS)',
              url: 'https://github.com/cogwirrel',
              picture: 'https://avatars.githubusercontent.com/u/1848603?v=4',
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
