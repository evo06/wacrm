"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MessageSquare, UsersRound } from "lucide-react";
import { LOCAL_AUTH_CLIENT_ENABLED } from "@/lib/auth/local-mode";

const localAuthEnabled = LOCAL_AUTH_CLIENT_ENABLED;

// `useSearchParams` opts the component out of static prerendering
// unless it sits under a Suspense boundary. We split the form into
// a child component so the outer page can prerender the chrome
// (background, card frame) while the form hydrates with the query
// string on the client.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const searchParams = useSearchParams();
  // Forwarded from `/join/<token>` when the visitor already has an
  // account. After a successful sign-in we send them to the join
  // page to accept rather than to /dashboard.
  const inviteToken = searchParams.get("invite");
  const t = useTranslations("LoginPage");

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (localAuthEnabled) {
      try {
        const response = await fetch("/api/auth/local/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: identifier, password }),
        });
        const result = (await response.json()) as { error?: string };
        if (!response.ok) {
          setError(result.error ?? "Não foi possível entrar.");
          setLoading(false);
          return;
        }

        router.replace("/dashboard");
        router.refresh();
        return;
      } catch {
        setError("Não foi possível acessar o serviço local.");
        setLoading(false);
        return;
      }
    }

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: identifier, password }),
      });
      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(result.error ?? "Não foi possível entrar.");
        setLoading(false);
        return;
      }
    } catch {
      setError("Não foi possível acessar o serviço de autenticação.");
      setLoading(false);
      return;
    }

    if (inviteToken) {
      window.location.assign(`/join/${encodeURIComponent(inviteToken)}`);
    } else {
      window.location.assign("/dashboard");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            {inviteToken ? (
              <UsersRound className="h-6 w-6 text-primary" />
            ) : (
              <MessageSquare className="h-6 w-6 text-primary" />
            )}
          </div>
          <CardTitle className="text-xl text-foreground">
            {localAuthEnabled
              ? "Acesso local"
              : inviteToken
                ? t('titleAccept')
                : t('titleWelcome')}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {localAuthEnabled
              ? "Entre com o usuário e a senha desta instalação."
              : inviteToken
                ? t('descAccept')
                : t('descWelcome')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action="/api/auth/login"
            method="post"
            onSubmit={handleLogin}
            className="flex flex-col gap-4"
          >
            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="identifier" className="text-muted-foreground">
                {localAuthEnabled ? "Usuário" : t('emailLabel')}
              </Label>
              <Input
                id="identifier"
                name="email"
                type={localAuthEnabled ? "text" : "email"}
                autoComplete="username"
                placeholder={localAuthEnabled ? "admin" : t('emailPlaceholder')}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-muted-foreground">
                  {t('passwordLabel')}
                </Label>
                {!localAuthEnabled ? (
                  <Link
                    href="/forgot-password"
                    className="text-sm text-primary hover:text-primary/80"
                  >
                    {t('forgotPassword')}
                  </Link>
                ) : null}
              </div>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder={t('passwordPlaceholder')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="mt-2 h-10 w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading
                ? localAuthEnabled
                  ? "Entrando..."
                  : t('signingIn')
                : localAuthEnabled
                  ? "Entrar"
                  : t('signIn')}
            </Button>
          </form>

          {!localAuthEnabled ? (
            <p className="mt-6 text-center text-sm text-muted-foreground">
              {t('noAccount')}{" "}
              <Link
                href={
                  inviteToken
                    ? `/signup?invite=${encodeURIComponent(inviteToken)}`
                    : "/signup"
                }
                className="text-primary hover:text-primary/80"
              >
                {t('createAccount')}
              </Link>
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
