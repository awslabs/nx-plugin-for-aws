import {
  ContentLayout,
  Header,
  SpaceBetween,
  Container,
} from '@cloudscape-design/components';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <ContentLayout header={<Header>Welcome</Header>}>
      <SpaceBetween size="l">
        <Container>Welcome to your new React website!</Container>
      </SpaceBetween>
    </ContentLayout>
  );
}
