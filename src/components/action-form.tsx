"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";

export type ActionResult = { ok?: string; error?: string; at?: number };

/**
 * <form> bound to a server action returning {ok|error}. Shows a toast with the
 * result and (optionally) resets the form on success.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
}: {
  action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.error) toast.error(state.error, { duration: 8000 });
    else if (state.ok) {
      toast.success(state.ok);
      if (resetOnSuccess) ref.current?.reset();
    }
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className} aria-busy={pending}>
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
    </form>
  );
}
