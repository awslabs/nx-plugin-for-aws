// @ts-check
import { defineConfig, passthroughImageService } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
  image: {
    service: passthroughImageService(),
  },
  integrations: [
    starlight({
      title: 'My Docs',
      social: {
        github: 'https://github.com/withastro/starlight',
      },
      sidebar: [
        {
          label: 'Guides',
          items: [
            // Each item here is one entry in the navigation menu.
            { label: 'Overview', slug: 'guides/example' },
          ],
        },
        {
          label: 'Get started',
          items: [
            // Each item here is one entry in the navigation menu.
            { label: 'Quick start', slug: 'guides/example' },
          ],
        },
        {
          label: 'Tutorials',
          items: [
            // Each item here is one entry in the navigation menu.
            { label: 'Creating a new application', slug: 'guides/example' },
            { label: 'Adding Nx plugin to your existing repo', slug: 'guides/example' },
            { label: 'Customizing your generators', slug: 'guides/example' },
            { label: 'Watch the videos', slug: 'guides/example' },
          ],
        },
        {
          label: 'Reference',
          items: [
            // Each item here is one entry in the navigation menu.
            { label: 'Introduction', slug: 'guides/example' },
            { label: 'Core concepts', slug: 'guides/example' },
            { label: 'Generators', slug: 'guides/example' },
            { label: 'Troubleshooting', slug: 'guides/example' },
          ],
        },
        {
          label: 'Contributing',
          items: [
            // Each item here is one entry in the navigation menu.
            { label: 'Reporting bugs', slug: 'guides/example' },
            { label: 'Suggesting features', slug: 'guides/example' },
            { label: 'Provide docs feedback', slug: 'guides/example' },
            { label: 'How to contribute', slug: 'guides/example' },
          ],
        },
        {
          label: 'Blog',
          items: [
            // Each item here is one entry in the navigation menu.
            { label: 'Roadmap', slug: 'guides/example' },
            { label: 'What\'s changed', slug: 'guides/example' },
          ],
        },
        {
          label: 'Tech Reference',
          autogenerate: { directory: 'reference' },
        },
      ],
    }),
  ],
});
