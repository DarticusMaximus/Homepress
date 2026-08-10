"use client";

import { useEffect, useActionState } from "react";
import { useRouter } from "next/navigation";
import { loginAction, type LoginState } from "./actions";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function LoginPage() {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<LoginState, FormData>(loginAction, {
    error: null,
  });

  useEffect(() => {
    if (state?.success) {
      router.replace("/");
    }
  }, [state, router]);

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Log in</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={formAction} noValidate className="flex flex-col gap-4">
            {state?.error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                disabled={isPending}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                disabled={isPending}
              />
            </div>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Signing in…" : "Log in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
