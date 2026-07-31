'use client';

import { useTransition } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Closing is not destructive — submissions and marks survive it — so there is
 * no confirmation dialog. Reopening is a one-click undo once it ships.
 */
export function CloseAssignmentButton({
  action,
}: {
  action: () => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={() => startTransition(() => action())}
    >
      {pending ? 'Closing…' : 'Close assignment'}
    </Button>
  );
}
