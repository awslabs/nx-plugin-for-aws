import { ComponentProps, FC, PropsWithChildren, useState } from 'react';
import {
  QueryClient,
  QueryClientProvider as QueryClientProviderInner,
} from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

type QueryClientProviderProps = PropsWithChildren & {
  client?: QueryClient;
  devtoolsOptions?: Omit<ComponentProps<typeof ReactQueryDevtools>, 'client'>;
  disableDevtools?: boolean;
};

export const QueryClientProvider: FC<QueryClientProviderProps> = ({
  children,
  client = new QueryClient(),
  disableDevtools = false,
  devtoolsOptions,
}) => {
  const [queryClient] = useState(client);
  return (
    <QueryClientProviderInner client={queryClient}>
      {children}
      {!disableDevtools && (
        <ReactQueryDevtools client={queryClient} {...devtoolsOptions} />
      )}
    </QueryClientProviderInner>
  );
};

export default QueryClientProvider;
