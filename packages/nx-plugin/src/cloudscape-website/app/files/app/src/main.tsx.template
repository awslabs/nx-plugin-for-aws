import React from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '@cloudscape-design/components/i18n';
import messages from '@cloudscape-design/components/i18n/messages/all.en';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

import '@cloudscape-design/global-styles/index.css';

const router = createRouter({ routeTree });

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById('root');
root &&
  createRoot(root).render(
    <React.StrictMode>
      <I18nProvider locale="en" messages={[messages]}>
        <RouterProvider router={router} />
      </I18nProvider>
    </React.StrictMode>,
  );
