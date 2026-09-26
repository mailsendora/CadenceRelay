import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { saveAuthTokens } from "@/lib/auth-client";

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();

  useEffect(() => {
    void (async () => {
      const bridgeToken = new URLSearchParams(window.location.search).get("token");
      if (bridgeToken) {
        const base = ((import.meta.env as Record<string, string | undefined>).VITE_API_BASE_URL ?? "").replace(/\/$/, "");
        const response = await fetch(`${base}/api/auth/sendora-exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: bridgeToken }), credentials: "include" });
        if (!response.ok) throw new Error("WhatsApp sign-in bridge failed");
        const data = await response.json() as { accessToken: string; refreshToken: string; workspaceId: string };
        saveAuthTokens(data.accessToken, data.refreshToken);
        navigate(`/${data.workspaceId}/dashboard`, { replace: true });
        return;
      }
      await refresh();
      navigate("/", { replace: true });
    })().catch(() => navigate("/sign-in", { replace: true }));
  }, [navigate, refresh]);

  return (
    <div className="flex h-screen items-center justify-center text-muted-foreground">
      Signing you in…
    </div>
  );
}
