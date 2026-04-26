import {
  CopilotChat as CopilotChatBase,
  CopilotSidebar as CopilotSidebarBase,
  CopilotPopup as CopilotPopupBase,
  CopilotChatView,
  type CopilotChatProps,
  type CopilotSidebarProps,
  type CopilotPopupProps,
} from '@copilotkit/react-core/v2';
import { ShadcnAssistantMessage } from './ShadcnAssistantMessage';
import { ShadcnUserMessage } from './ShadcnUserMessage';
import { ShadcnChatInput } from './ShadcnChatInput';
import { ShadcnCursor } from './ShadcnCursor';
import './copilot.css';

const NoopFeather: typeof CopilotChatView.Feather = () => null;

export const shadcnCopilotTheme = {
  messageView: {
    assistantMessage: ShadcnAssistantMessage,
    userMessage: ShadcnUserMessage,
    cursor: ShadcnCursor,
    className: 'flex flex-col gap-3 px-4 py-6',
  },
  input: ShadcnChatInput,
  scrollView: { feather: NoopFeather },
} as const;

export const CopilotChat = (props: CopilotChatProps) => (
  <CopilotChatBase {...shadcnCopilotTheme} {...props} />
);

export const CopilotSidebar = (props: CopilotSidebarProps) => (
  <CopilotSidebarBase {...shadcnCopilotTheme} {...props} />
);

export const CopilotPopup = (props: CopilotPopupProps) => (
  <CopilotPopupBase {...shadcnCopilotTheme} {...props} />
);

export {
  ShadcnAssistantMessage,
  ShadcnUserMessage,
  ShadcnChatInput,
  ShadcnCursor,
};
