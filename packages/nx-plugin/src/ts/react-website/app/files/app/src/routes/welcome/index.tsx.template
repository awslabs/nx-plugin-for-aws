import {
  ContentLayout,
  Header,
  SpaceBetween,
  Container,
} from '@cloudscape-design/components';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/welcome/')({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <ContentLayout header={<Header>Welcome</Header>}>
      <SpaceBetween size="l">
        <Container>Welcome to your new Cloudscape website!</Container>
      </SpaceBetween>
    </ContentLayout>
  );
}
