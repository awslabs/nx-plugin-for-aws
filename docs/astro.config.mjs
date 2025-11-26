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
import * as fs from 'fs';

/**
 * Load Smithy syntax highlighting
 */
const smithySyntax = () => ({
  ...JSON.parse(
    fs.readFileSync('./src/syntax/smithy/smithy.tmLanguage.json', 'utf-8'),
  ),
  name: 'smithy',
});

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
  markdown: {
    shikiConfig: {
      langs: [smithySyntax()],
    },
  },
  integrations: [
    starlight({
      title: '@aws/nx-plugin',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/awslabs/nx-plugin-for-aws',
        },
      ],
      head: [
        {
          tag: 'meta',
          attrs: {
            property: 'og:image',
            content: '/nx-plugin-for-aws/favicon.svg',
          },
        },
      ],
      components: {
        PageSidebar: './src/components/page-sidebar.astro',
      },
      tableOfContents: {
        minHeadingLevel: 2,
        maxHeadingLevel: 4,
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
        vi: {
          label: 'Tiếng Việt',
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
            vi: 'Bắt đầu',
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
                vi: 'Khái niệm',
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
                vi: 'Bắt đầu nhanh',
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
                vi: 'Hướng dẫn',
              },
              items: [
                {
                  label: 'Agentic AI Dungeon Game',
                  translations: {
                    jp: 'エージェント型AIダンジョンゲーム',
                    ko: '에이전트 AI 던전 게임',
                    fr: 'Jeu de donjon IA agentique',
                    it: 'Gioco del dungeon con IA agente',
                    es: 'Juego de mazmorra con IA agéntica',
                    pt: 'Jogo de masmorra com IA agêntica',
                    zh: '智能体 AI 地下城游戏',
                    vi: 'Trò chơi hầm ngục AI tác nhân',
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
                        vi: 'Tổng quan',
                      },
                      link: '/get_started/tutorials/dungeon-game/overview',
                    },
                    {
                      label: '1. Set up a monorepo',
                      translations: {
                        jp: '1. モノレポのセットアップ',
                        ko: '1. 모노레포 설정',
                        fr: '1. Configuration du monorepo',
                        it: '1. Configurazione monorepo',
                        es: '1. Configuración de monorepo',
                        pt: '1. Configuração do monorepo',
                        zh: '1. Monorepo 设置',
                        vi: '1. Thiết lập monorepo',
                      },
                      link: '/get_started/tutorials/dungeon-game/1',
                    },
                    {
                      label:'2. Implement the Game API and Inventory MCP server',
                      translations: {
                        jp: '2. ゲームAPIとインベントリMCP',
                        ko: '2. 게임 API 및 인벤토리 MCP',
                        fr: "2. API du jeu et MCP d'inventaire",
                        it: '2. API del gioco e MCP inventario',
                        es: '2. API del juego y MCP de inventario',
                        pt: '2. API do jogo e MCP de inventário',
                        zh: '2. 游戏 API 和库存 MCP',
                        vi: '2. Triển khai API trò chơi và máy chủ MCP kho đồ',
                      },
                      link: '/get_started/tutorials/dungeon-game/2',
                    },
                    {
                      label: '3. Implement the Story Agent',
                      translations: {
                        jp: '3. ストーリーエージェント',
                        ko: '3. 스토리 에이전트',
                        fr: "3. Agent d'histoire",
                        it: '3. Agente della storia',
                        es: '3. Agente de historia',
                        pt: '3. Agente de história',
                        zh: '3. 故事智能体',
                        vi: '3. Triển khai tác nhân câu chuyện',
                      },
                      link: '/get_started/tutorials/dungeon-game/3',
                    },
                    {
                      label: '4. Build the UI',
                      translations: {
                        jp: '4. UI',
                        ko: '4. UI',
                        fr: '4. UI',
                        it: '4. UI',
                        es: '4. UI',
                        pt: '4. UI',
                        zh: '4. UI',
                        vi: '4. Xây dựng giao diện',
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
                        vi: 'Kết thúc',
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
                    vi: 'Đóng góp trình tạo',
                  },
                  link: '/get_started/tutorials/contribute-generator',
                },
              ],
            },
            {
              label: 'Building with AI',
              link: '/get_started/building-with-ai',
              translations: {
                jp: 'AIでの構築',
                ko: 'AI로 구축하기',
                fr: "Construire avec l'IA",
                it: "Costruire con l'IA",
                es: 'Construyendo con IA',
                pt: 'Construindo com IA',
                zh: '使用 AI 构建',
                vi: 'Xây dựng với AI',
              },
            },
          ],
        },
        {
          label: 'Generator guides',
          translations: {
            jp: 'ガイド',
            ko: '가이드',
            fr: 'Guides',
            it: 'Guide',
            es: 'Guías',
            pt: 'Guias',
            zh: '指南',
            vi: 'Hướng dẫn trình tạo',
          },
          items: [
            { label: 'ts#project', link: '/guides/typescript-project' },
            { label: 'ts#infra', link: '/guides/typescript-infrastructure' },
            { label: 'ts#trpc-api', link: '/guides/trpc' },
            { label: 'ts#smithy-api', link: '/guides/ts-smithy-api' },
            {
              label: 'ts#react-website',
              link: '/guides/react-website',
            },
            {
              label: 'ts#react-website#auth',
              link: '/guides/react-website-auth',
            },
            { label: 'ts#lambda-function', link: '/guides/ts-lambda-function' },
            { label: 'ts#nx-plugin', link: '/guides/ts-nx-plugin' },
            { label: 'ts#nx-generator', link: '/guides/nx-generator' },
            { label: 'ts#mcp-server', link: '/guides/ts-mcp-server' },
            { label: 'py#project', link: '/guides/python-project' },
            { label: 'py#fast-api', link: '/guides/fastapi' },
            {
              label: 'py#lambda-function',
              link: '/guides/python-lambda-function',
            },
            { label: 'py#mcp-server', link: '/guides/py-mcp-server' },
            { label: 'py#strands-agent', link: '/guides/py-strands-agent' },
            { label: 'terraform#project', link: '/guides/terraform-project' },
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
                    vi: 'Kết nối API',
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
                {
                  label: 'React → Smithy',
                  link: '/guides/api-connection/react-smithy',
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
          label: 'Troubleshooting',
          translations: {
            jp: 'トラブルシューティング',
            ko: '문제 해결',
            fr: 'Dépannage',
            it: 'Risoluzione dei problemi',
            es: 'Solución de problemas',
            pt: 'Solução de problemas',
            zh: '故障排除',
            vi: 'Khắc phục sự cố',
          },
          items: [
            {
              label: 'Nx',
              translations: {
                jp: 'Nx',
                ko: 'Nx',
                fr: 'Nx',
                it: 'Nx',
                es: 'Nx',
                pt: 'Nx',
                zh: 'Nx',
                vi: 'Nx',
              },
              link: '/troubleshooting/nx',
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
            vi: 'Giới thiệu',
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
                vi: 'Số liệu sử dụng',
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
                vi: 'Dịch tài liệu',
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
    ssr: {
      // https://github.com/withastro/astro/issues/14117
      noExternal: ['zod'],
    },
  },
});
