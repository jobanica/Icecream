"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { signInStore, signInTeam, type LoginState } from "./actions";

export function LoginForms() {
  const [mode, setMode] = useState<"store" | "team">("store");
  const [storeState, storeAction, storePending] = useActionState<LoginState, FormData>(signInStore, {});
  const [teamState, teamAction, teamPending] = useActionState<LoginState, FormData>(signInTeam, {});

  return (
    <Card>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm font-medium">
          <button
            type="button"
            onClick={() => setMode("store")}
            className={`rounded-md py-2 ${mode === "store" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
          >
            Store
          </button>
          <button
            type="button"
            onClick={() => setMode("team")}
            className={`rounded-md py-2 ${mode === "team" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
          >
            Owner / Staff
          </button>
        </div>

        {mode === "store" ? (
          <form action={storeAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="code">Store code</Label>
              <Input
                id="code"
                name="code"
                placeholder="SS-001"
                autoCapitalize="characters"
                autoComplete="username"
                required
                className="h-12 text-lg uppercase"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pin">6-digit PIN</Label>
              <Input
                id="pin"
                name="pin"
                type="password"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                autoComplete="current-password"
                required
                className="h-12 text-center text-2xl tracking-[0.5em]"
              />
            </div>
            {storeState.error && <p className="text-sm font-medium text-destructive">{storeState.error}</p>}
            <Button type="submit" className="h-12 w-full text-base" disabled={storePending}>
              {storePending ? "Signing in…" : "Sign in"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">Forgot your PIN? Message the owner to reset it.</p>
          </form>
        ) : (
          <form action={teamAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required className="h-12" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" autoComplete="current-password" required className="h-12" />
            </div>
            {teamState.error && <p className="text-sm font-medium text-destructive">{teamState.error}</p>}
            <Button type="submit" className="h-12 w-full text-base" disabled={teamPending}>
              {teamPending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
