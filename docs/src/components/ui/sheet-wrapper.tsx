import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import type { PropsWithChildren, ReactNode } from 'react';

export interface SheetWrapperProps extends PropsWithChildren {
    title: string;
    trigger: ReactNode;
}

export const SheetWrapper = (props: SheetWrapperProps) => {
  return (
    <Sheet modal={false}>
      <SheetTrigger><span className="information">{props.trigger}<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 11a1 1 0 0 0-1 1v4a1 1 0 0 0 2 0v-4a1 1 0 0 0-1-1Zm.38-3.92a1 1 0 0 0-.76 0 1 1 0 0 0-.33.21 1.15 1.15 0 0 0-.21.33 1 1 0 0 0 .21 1.09c.097.088.209.16.33.21A1 1 0 0 0 13 8a1.05 1.05 0 0 0-.29-.71 1 1 0 0 0-.33-.21ZM12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16.001A8 8 0 0 1 12 20Z"></path></svg></span></SheetTrigger>
      <SheetContent side='right' className="w-[35%] sm:w-[35%] !max-w-none">
        <SheetHeader>
          <SheetTitle>{props.title}</SheetTitle>
          <SheetDescription>
            {props.children}
          </SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  );
};
