import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Power, PowerOff, BellOff, Bell, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { CHANNELS, channelFor } from "@/lib/channels";
import type { AccountRec } from "@/lib/mockApi";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/dashboard/account/")({
  head: () => ({
    meta: [
      { title: "Accounts — Alert Hub" },
      { name: "description", content: "Manage your connected message accounts." },
    ],
  }),
  component: AccountsPage,
});

function accountDisplayName(a: AccountRec): string {
  return a.display_name || a.label || a.username || "Unnamed account";
}

function StatusDot({ status }: { status: AccountRec["status"] }) {
  const map = {
    active: "bg-emerald-500 text-emerald-500 status-blink",
    disconnected: "bg-muted-foreground/40 text-muted-foreground/40",
    muted: "bg-amber-400 text-amber-400",
  } as const;
  return (
    <span className={`inline-block h-2.5 w-2.5 rounded-full ${map[status]}`} aria-label={status} />
  );
}

function statusLabel(s: AccountRec["status"]) {
  return s === "active" ? "Active" : s === "muted" ? "Notifications muted" : "Disconnected";
}

export function AccountsPage() {
  const [accounts, setAccounts] = useState<AccountRec[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    try {
      const data = await api<AccountRec[]>("/accounts");
      setAccounts(data);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const action = async (a: AccountRec, op: string, msg: string) => {
    try {
      await api(`/accounts/${a.id}/${op}`, { method: "POST" });
      toast.success(msg);
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const reconnect = (a: AccountRec) => {
    if (!a.phone_number) {
      toast.error("No phone number on file for this account. Remove it and add it again.");
      return;
    }
    navigate({
      to: "/account/connect/telegram",
      search: {
        reconnect: "1",
        display_name: accountDisplayName(a),
        session_name: a.session_name,
        phone: a.phone_number,
      },
    });
  };

  const remove = async (a: AccountRec) => {
    if (!confirm(`Remove "${accountDisplayName(a)}" permanently?`)) return;
    try {
      await api(`/accounts/${a.id}`, { method: "DELETE" });
      toast.success("Account removed");
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const pick = (type: string, available: boolean) => {
    setPickerOpen(false);
    if (!available) {
      toast("Coming Soon", { description: `${type} support is on the way.` });
      return;
    }
    if (type === "telegram") navigate({ to: "/account/connect/telegram" });
  };

  return (
    <>
      <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Connected accounts</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage which message sources feed your Alert Hub.
            </p>
          </div>
          <Button onClick={() => setPickerOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" /> Add account
          </Button>
        </div>

        <ul className="mt-5 space-y-2">
          {loading && <li className="text-sm text-muted-foreground">Loading…</li>}
          {!loading && accounts.length === 0 && (
            <li className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              No accounts yet. Click{" "}
              <span className="font-medium text-foreground">Add account</span> to connect one.
            </li>
          )}
          {accounts.map((a) => {
            const ch = channelFor(a.type);
            const Icon = ch.icon;
            return (
              <li
                key={a.id}
                className="group flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4 transition-all hover:border-primary/40 hover:shadow-md animate-fade-in"
              >
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-lg bg-accent/50 ${ch.color}`}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground truncate">
                      {accountDisplayName(a)}
                    </span>
                    <span className="text-xs text-muted-foreground">· {ch.label}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <StatusDot status={a.status} />
                    <span>{statusLabel(a.status)}</span>
                    {a.phone_number && <span>· {a.phone_number}</span>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {a.status === "active" && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => action(a, "mute", "Notifications muted")}
                      >
                        <BellOff className="h-4 w-4" /> Mute
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => action(a, "disconnect", "Account disconnected")}
                      >
                        <PowerOff className="h-4 w-4" /> Disconnect
                      </Button>
                    </>
                  )}
                  {a.status === "muted" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => action(a, "unmute", "Notifications enabled")}
                    >
                      <Bell className="h-4 w-4" /> Unmute
                    </Button>
                  )}
                  {a.status === "disconnected" && (
                    <Button size="sm" variant="ghost" onClick={() => reconnect(a)}>
                      <Power className="h-4 w-4" /> Reconnect
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => remove(a)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Connect a new account</DialogTitle>
            <DialogDescription>Pick the channel you want to add.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {CHANNELS.map((c) => {
              const Icon = c.icon;
              return (
                <button
                  key={c.type}
                  onClick={() => pick(c.type, c.available)}
                  className="group relative flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4 text-center transition-all hover:border-primary/60 hover-lift"
                >
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-lg bg-accent/50 ${c.color} transition-transform group-hover:scale-110`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="text-sm font-medium">{c.label}</span>
                  {!c.available && (
                    <span className="text-[10px] rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                      Coming Soon
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
