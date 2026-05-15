import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Send, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ConnectSearch = {
  reconnect?: string;
  display_name?: string;
  session_name?: string;
  phone?: string;
};

export function ConnectTelegramPage() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as ConnectSearch;
  const isReconnect = search.reconnect === "1";
  const [displayName, setDisplayName] = useState(search.display_name || "");
  const [sessionName, setSessionName] = useState(search.session_name || "");
  const [phone, setPhone] = useState(search.phone || "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const autoSentRef = useRef(false);

  const sendCode = async () => {
    if (!displayName || !sessionName || !phone) {
      toast.error("Fill display name, session name, and phone.");
      return;
    }
    setBusy(true);
    try {
      await api("/telegram/connect/send-code", {
        method: "POST",
        body: JSON.stringify({
          display_name: displayName,
          session_name: sessionName,
          phone_number: phone,
        }),
      });
      setStep(2);
      toast.success("Code sent. Check Telegram.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!isReconnect || autoSentRef.current) return;
    if (!displayName || !sessionName || !phone) return;
    autoSentRef.current = true;
    void sendCode();
  }, [isReconnect, displayName, sessionName, phone]);

  const verify = async () => {
    setBusy(true);
    try {
      await api("/telegram/connect/verify", {
        method: "POST",
        body: JSON.stringify({
          display_name: displayName,
          session_name: sessionName,
          phone_number: phone,
          code,
          password: password || undefined,
        }),
      });
      toast.success(isReconnect ? "Account reconnected!" : "Telegram connected!");
      navigate({ to: "/account/" });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card p-6 shadow-sm animate-scale-in">
      <Link
        to="/account/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to accounts
      </Link>

      <div className="mt-4 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400">
          <Send className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">
            {isReconnect ? "Reconnect Telegram" : "Connect Telegram"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {isReconnect && step === 1 && busy
              ? "Sending verification code…"
              : `Step ${step} of 2`}
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="tg-display-name">Display name</Label>
          <Input
            id="tg-display-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Personal"
            disabled={step === 2 || isReconnect}
          />
        </div>
        <div>
          <Label htmlFor="tg-session">Session name</Label>
          <Input
            id="tg-session"
            value={sessionName}
            onChange={(e) => setSessionName(e.target.value)}
            placeholder="my-session"
            disabled={step === 2 || isReconnect}
          />
        </div>
        <div>
          <Label htmlFor="tg-phone">Phone number</Label>
          <Input
            id="tg-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+15551234567"
            disabled={step === 2 || isReconnect}
          />
        </div>
      </div>

      {step === 2 && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 animate-fade-in">
          <div>
            <Label htmlFor="tg-code">Telegram code</Label>
            <Input
              id="tg-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="12345"
            />
          </div>
          <div>
            <Label htmlFor="tg-2fa" className="flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5" /> 2FA password (optional)
            </Label>
            <Input
              id="tg-2fa"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="mt-6 flex items-center gap-3">
        {step === 1 ? (
          <Button onClick={sendCode} disabled={busy}>
            {busy ? "Sending..." : "Send code"}
          </Button>
        ) : (
          <>
            <Button onClick={verify} disabled={busy}>
              {busy ? "Verifying..." : isReconnect ? "Verify and reconnect" : "Verify and connect"}
            </Button>
            <Button variant="outline" onClick={() => setStep(1)}>
              Back
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
