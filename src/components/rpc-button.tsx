"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/format";
import { Button } from "@/components/ui/button";

/** Calls a Supabase RPC as the signed-in user, toasts the result, refreshes the page. */
export function RpcButton({
  fn,
  args,
  children,
  success = "Saved",
  confirm,
  variant,
  className,
  disabled,
}: {
  fn: string;
  args: Record<string, unknown>;
  children: React.ReactNode;
  success?: string;
  confirm?: string;
  variant?: "default" | "outline" | "secondary" | "destructive" | "ghost";
  className?: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant={variant}
      className={className}
      disabled={busy || disabled}
      onClick={async () => {
        if (confirm && !window.confirm(confirm)) return;
        setBusy(true);
        const { error } = await createClient().rpc(fn, args);
        setBusy(false);
        if (error) toast.error(errorMessage(error), { duration: 8000 });
        else {
          toast.success(success);
          router.refresh();
        }
      }}
    >
      {busy && <Loader2 className="animate-spin" />}
      {children}
    </Button>
  );
}
