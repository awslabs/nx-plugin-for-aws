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
  redirects: {
    '/': '/nx-plugin-for-aws/en',
  },
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
          label: '한국어',
        },
        fr: {
          label: 'Français',
        },
        it: {
          label: 'Italiano',
        },
        es: {
          label: 'Español',
        },
        pt: {
          label: 'Português',
        },
        zh: {
          label: '中文',
        },
      },
      sidebar: [
        {
          label: 'Getting Started',
          translations: {
            jp: '始めましょう',
            ko: '시작하기',
            fr: 'Commencer',
            it: 'Iniziare',
            es: 'Comenzar',
            pt: 'Começar',
            zh: '开始使用',
          },
          items: [
            {
              label: 'Concepts',
              link: '/get_started/concepts',
              translations: {
                jp: 'コンセプト',
                ko: '개념',
                fr: 'Concepts',
                it: 'Concetti',
                es: 'Conceptos',
                pt: 'Conceitos',
                zh: '概念',
              },
            },
            {
              label: 'Quick start',
              link: '/get_started/quick-start',
              translations: {
                jp: 'クイックスタート',
                ko: '빠른 시작',
                fr: 'Démarrage rapide',
                it: 'Avvio rapido',
                es: 'Inicio rápido',
                pt: 'Início rápido',
                zh: '快速开始',
              },
            },
            {
              label: 'Tutorials',
              translations: {
                jp: 'チュートリアル',
                ko: '튜토리얼',
                fr: 'Tutoriels',
                it: 'Tutorial',
                es: 'Tutoriales',
                pt: 'Tutoriais',
                zh: '教程',
              },
              items: [
                {
                  label: 'AI Dungeon Game',
                  translations: {
                    jp: 'AIダンジョンゲーム',
                    ko: 'AI 던전 게임',
                    fr: 'Jeu de donjon IA',
                    it: 'Gioco del dungeon AI',
                    es: 'Juego de mazmorra IA',
                    pt: 'Jogo de masmorra IA',
                    zh: 'AI 地下城游戏',
                  },
                  collapsed: true,
                  items: [
                    {
                      label: 'Overview',
                      translations: {
                        jp: '概要',
                        ko: '개요',
                        fr: 'Aperçu',
                        it: 'Panoramica',
                        es: 'Visión general',
                        pt: 'Visão geral',
                        zh: '概述',
                      },
                      link: '/get_started/tutorials/dungeon-game/overview',
                    },
                    {
                      label: '1. Monorepo setup',
                      translations: {
                        jp: '1. モノレポのセットアップ',
                        ko: '1. 모노레포 설정',
                        fr: '1. Configuration du monorepo',
                        it: '1. Configurazione monorepo',
                        es: '1. Configuración de monorepo',
                        pt: '1. Configuração do monorepo',
                        zh: '1. Monorepo 设置',
                      },
                      link: '/get_started/tutorials/dungeon-game/1',
                    },
                    {
                      label: '2. Game API',
                      translations: {
                        jp: '2. ゲームAPI',
                        ko: '2. 게임 API',
                        fr: '2. API du jeu',
                        it: '2. API del gioco',
                        es: '2. API del juego',
                        pt: '2. API do jogo',
                        zh: '2. 游戏 API',
                      },
                      link: '/get_started/tutorials/dungeon-game/2',
                    },
                    {
                      label: '3. Story API',
                      translations: {
                        jp: '3. ストーリーAPI',
                        ko: '3. 스토리 API',
                        fr: "3. API d'histoire",
                        it: '3. API della storia',
                        es: '3. API de historia',
                        pt: '3. API de história',
                        zh: '3. 故事 API',
                      },
                      link: '/get_started/tutorials/dungeon-game/3',
                    },
                    {
                      label: '4. UI',
                      translations: {
                        jp: '4. UI',
                        ko: '4. UI',
                        fr: '4. UI',
                        it: '4. UI',
                        es: '4. UI',
                        pt: '4. UI',
                        zh: '4. UI',
                      },
                      link: '/get_started/tutorials/dungeon-game/4',
                    },
                    {
                      label: 'Wrap up',
                      translations: {
                        jp: 'まとめ',
                        ko: '마무리',
                        fr: 'Conclusion',
                        it: 'Conclusione',
                        es: 'Conclusión',
                        pt: 'Conclusão',
                        zh: '总结',
                      },
                      link: '/get_started/tutorials/dungeon-game/wrap-up',
                    },
                  ],
                },
                {
                  label: 'Contribute a generator',
                  translations: {
                    jp: 'ジェネレーターを貢献',
                    ko: '제너레이터 기여',
                    fr: 'Contribuer un générateur',
                    it: 'Contribuire un generatore',
                    es: 'Contribuir un generador',
                    pt: 'Contribuir um gerador',
                    zh: '贡献生成器',
                  },
                  link: '/get_started/tutorials/contribute-generator',
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
            fr: 'Guides',
            it: 'Guide',
            es: 'Guías',
            pt: 'Guias',
            zh: '指南',
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
            { label: 'ts#nx-generator', link: '/guides/nx-generator' },
            { label: 'ts#mcp-server', link: '/guides/ts-mcp-server' },
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
                    fr: 'Connexion des API',
                    it: 'Connessione delle API',
                    es: 'Conexión de API',
                    pt: 'Conexão de APIs',
                    zh: '连接 API',
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
            fr: 'À propos',
            it: 'Informazioni',
            es: 'Acerca de',
            pt: 'Sobre',
            zh: '关于',
          },
          items: [
            {
              label: 'Usage Metrics',
              translations: {
                jp: '使用状況メトリクス',
                ko: '사용 지표',
                fr: "Métriques d'utilisation",
                it: 'Metriche di utilizzo',
                es: 'Métricas de uso',
                pt: 'Métricas de uso',
                zh: '使用指标',
              },
              link: '/about/metrics',
            },
            {
              label: 'Documentation Translation',
              translations: {
                jp: 'ドキュメント翻訳',
                ko: '문서 번역',
                fr: 'Traduction de la documentation',
                it: 'Traduzione della documentazione',
                es: 'Traducción de la documentación',
                pt: 'Tradução da documentação',
                zh: '文档翻译',
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
