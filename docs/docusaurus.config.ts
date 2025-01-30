/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Config } from '@docusaurus/types';
import { themes } from 'prism-react-renderer';
const lightCodeTheme = themes.github;
const darkCodeTheme = themes.dracula;

const config: Config = {
  title: 'PACE Nx Plugin',
  tagline: 'Alpha Release - give it a try and tell us your feedback!',
  url: 'https://your-docusaurus-test-site.com',
  baseUrl: '/',
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
  //favicon: 'img/favicon.ico',
  organizationName: 'apj-pace', // Usually your GitHub org/user name.
  projectName: 'pace-nx-plugin', // Usually your repo name.
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'ja', 'ko'],
  },
  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          // Please change this to your repo.
          editUrl: 'https://github.com/facebook/docusaurus/edit/main/website/',
        },
        blog: {
          showReadingTime: true,
          // Please change this to your repo.
          // editUrl:
          //   'https://github.com/facebook/docusaurus/edit/main/website/blog/',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      },
    ],
  ],

  themeConfig: {
    navbar: {
      title: 'PACE Nx Plugin',
      // logo: {
      //   alt: 'My Site Logo',
      //   src: 'img/logo.svg',
      // },
      items: [
        {
          type: 'localeDropdown',
          position: 'right',
        },
        {
          type: 'doc',
          docId: 'intro',
          position: 'left',
          label: 'Tutorial',
        },
        { to: '/blog', label: 'Blog', position: 'left' },
        {
          href: 'https://gitlab.aws.dev/apj-pace/PDKNxPlugin',
          label: 'GitLab',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Tutorial',
              to: '/docs/intro',
            },
          ],
        },
        {
          title: 'Contribute',
          items: [
            {
              label: 'GitLab Repo',
              href: 'https://gitlab.aws.dev/apj-pace/PDKNxPlugin',
            },
          ],
        },
        {
          title: 'Feedback & Support',
          items: [
            {
              label: 'Reach out on Slack',
              href: 'https://amzn-aws.slack.com/archives/C07QJ6URR1P/',
            },
          ],
        },
      ],
      copyright: `Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.`,
    },
    prism: {
      theme: lightCodeTheme,
      darkTheme: darkCodeTheme,
      additionalLanguages: ['typescript'],
    },
  },
};

export default config;
