// In-memory mock backend with multi-channel accounts.
export interface AccountRec {
  id: number;
  type: "telegram" | "whatsapp" | "gmail" | "linkedin" | "discord";
  label?: string;
  display_name: string;
  username?: string;
  session_name: string;
  avatar_url?: string;
  phone_number?: string;
  status: "active" | "disconnected" | "muted";
}

interface Notification {
  id: number;
  account_id?: number;
  sender: string;
  sender_id?: string;
  sender_avatar_url?: string;
  chat_id?: number;
  source: string;
  chat_name: string;
  message: string;
  edited_at?: string;
  external_message_id_int?: number;
  reply_to_external_message_id_int?: number;
  is_outgoing: boolean;
  peer_read: boolean;
  is_read: boolean;
  message_time: string;
  created_at: string;
}

interface DB {
  users: Record<string, string>;
  profiles: Record<string, { name: string; avatar_url?: string }>;
  accounts: AccountRec[];
  notifications: Notification[];
  pendingCodes: Record<string, true>;
  pushEnabled: boolean;
  nextId: number;
}

const KEY = "alerthub_mockdb_v3";

const SAMPLE_SENDERS = [
  "Alice Chen",
  "Bob Martinez",
  "Server Bot",
  "Mom",
  "DevOps Alerts",
  "Sarah Kim",
  "GitHub",
  "Unknown sender",
];
const SAMPLE_CHATS = ["#general", "Direct message", "Family", "alerts-prod", "team-eng"];
const SAMPLE_MSGS = [
  "Hey, are we still meeting at 3pm?",
  "Build #482 succeeded on main.",
  "Don't forget to pick up groceries.",
  "Database CPU above 85% for 5 minutes.",
  "PR #1204 has been approved and merged.",
  "Reminder: stand-up in 10 minutes.",
  "Backup completed successfully.",
  "New login from a new device. Was this you?",
  "Lunch tomorrow?",
  "Deploy to staging finished. Check it out.",
];

function normalizeAccount(rec: Partial<AccountRec>, idx: number): AccountRec {
  const displayName = rec.display_name || rec.label || `Telegram ${idx + 1}`;
  const username = rec.username || undefined;
  const sessionName = rec.session_name || username || `telegram_${idx + 1}`;
  return {
    id: rec.id ?? idx + 1,
    type: rec.type || "telegram",
    label: rec.label || displayName,
    display_name: displayName,
    username,
    session_name: sessionName,
    avatar_url: rec.avatar_url ?? "",
    phone_number: rec.phone_number,
    status: rec.status || "active",
  };
}

function loadDB(): DB {
  if (typeof window === "undefined") {
    return {
      users: {},
      profiles: {},
      accounts: [],
      notifications: [],
      pendingCodes: {},
      pushEnabled: false,
      nextId: 1,
    };
  }
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DB>;
      const parsedAccounts = (parsed.accounts || []).map((a, idx) => normalizeAccount(a, idx));
      return {
        users: parsed.users || {},
        profiles: parsed.profiles || {},
        accounts: parsedAccounts,
        notifications: parsed.notifications || [],
        pendingCodes: parsed.pendingCodes || {},
        pushEnabled: !!parsed.pushEnabled,
        nextId: parsed.nextId || 1,
      };
    }
  } catch {
    // ignore malformed local cache and recreate mock DB
  }
  const db: DB = {
    users: { "dev@test.com": "test123!@#" },
    profiles: {
      "dev@test.com": { name: "Developer", avatar_url: "" },
    },
    accounts: [
      {
        id: 1,
        type: "telegram",
        label: "Personal",
        display_name: "Personal",
        username: "personal_account",
        session_name: "personal",
        phone_number: "+15551234567",
        status: "active",
      },
    ],
    notifications: seedNotifications(),
    pendingCodes: {},
    pushEnabled: false,
    nextId: 100,
  };
  saveDB(db);
  return db;
}

function saveDB(db: DB) {
  if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(db));
}

function seedNotifications(): Notification[] {
  const now = Date.now();
  const out: Notification[] = [];
  for (let i = 0; i < 24; i++) {
    const t = new Date(now - i * 1000 * 60 * (5 + Math.random() * 90)).toISOString();
    out.push({
      id: 1000 + i,
      account_id: 1,
      sender: SAMPLE_SENDERS[i % SAMPLE_SENDERS.length],
      sender_id: `user_${i % SAMPLE_SENDERS.length}`,
      sender_avatar_url: `https://i.pravatar.cc/96?img=${(i % 50) + 1}`,
      chat_id: 5000 + (i % SAMPLE_CHATS.length),
      source: "telegram",
      chat_name: SAMPLE_CHATS[i % SAMPLE_CHATS.length],
      message: SAMPLE_MSGS[i % SAMPLE_MSGS.length],
      external_message_id_int: 1000 + i,
      is_outgoing: false,
      peer_read: false,
      is_read: i > 6,
      message_time: t,
      created_at: t,
    });
  }
  return out;
}

const db = loadDB();
function commit() {
  saveDB(db);
}

function token(email: string, kind: "a" | "r") {
  return `mock.${kind}.${btoa(email)}.${Date.now()}`;
}
function emailFromToken(t: string | null | undefined): string | null {
  if (!t || !t.startsWith("mock.")) return null;
  try {
    return atob(t.split(".")[2]);
  } catch {
    return null;
  }
}
function delay<T>(v: T, ms = 200): Promise<T> {
  return new Promise((res) => setTimeout(() => res(v), ms));
}
function ok<T>(data: T) {
  return { status: 200, json: data };
}
function err(status: number, detail: string) {
  return { status, json: { detail } };
}

let lastInject = Date.now();
function maybeInjectNew() {
  const now = Date.now();
  if (now - lastInject < 12_000) return;
  const activeAccts = db.accounts.filter((a) => a.status === "active");
  if (activeAccts.length === 0) return;
  if (Math.random() < 0.5) {
    lastInject = now;
    const t = new Date().toISOString();
    const acct = activeAccts[Math.floor(Math.random() * activeAccts.length)];
    db.notifications.unshift({
      id: db.nextId++,
      account_id: acct.id,
      sender: SAMPLE_SENDERS[Math.floor(Math.random() * SAMPLE_SENDERS.length)],
      sender_id: `user_${Math.floor(Math.random() * SAMPLE_SENDERS.length)}`,
      sender_avatar_url: `https://i.pravatar.cc/96?img=${Math.floor(Math.random() * 50) + 1}`,
      chat_id: 5000 + Math.floor(Math.random() * SAMPLE_CHATS.length),
      source: acct.type,
      chat_name: SAMPLE_CHATS[Math.floor(Math.random() * SAMPLE_CHATS.length)],
      message: SAMPLE_MSGS[Math.floor(Math.random() * SAMPLE_MSGS.length)],
      is_outgoing: false,
      peer_read: false,
      is_read: false,
      message_time: t,
      created_at: t,
    });
    commit();
  }
}

export interface MockResponse {
  status: number;
  json: unknown;
}

export function handleMock(
  method: string,
  path: string,
  body: any,
  authHeader?: string | null,
): Promise<MockResponse> {
  const M = method.toUpperCase();

  if (path === "/auth/register" && M === "POST") {
    const { name, email, password } = body || {};
    if (!name || !email || !password) return delay(err(400, "Name, email, and password required"));
    if (db.users[email]) return delay(err(409, "User already exists"));
    db.users[email] = password;
    commit();
    db.profiles[email] = { name, avatar_url: "" };
    return delay(
      ok({
        access_token: token(email, "a"),
        refresh_token: token(email, "r"),
        token_type: "bearer",
      }),
    );
  }
  if (path === "/auth/login" && M === "POST") {
    const { email, password } = body || {};
    if (!db.users[email] || db.users[email] !== password)
      return delay(err(401, "Authentication failed"));
    return delay(
      ok({
        access_token: token(email, "a"),
        refresh_token: token(email, "r"),
        token_type: "bearer",
      }),
    );
  }
  if (path === "/auth/refresh" && M === "POST") {
    const e = emailFromToken(body?.refresh_token);
    if (!e || !db.users[e]) return delay(err(401, "Invalid refresh token"));
    return delay(
      ok({ access_token: token(e, "a"), refresh_token: token(e, "r"), token_type: "bearer" }),
    );
  }

  const bearer = authHeader?.replace(/^Bearer\s+/i, "");
  const email = emailFromToken(bearer);
  if (!email || !db.users[email]) {
    if (path === "/push/public-key" && M === "GET") return delay(ok({ public_key: "" }));
    return delay(err(401, "Unauthorized"));
  }

  // ---- Me ----
  if (path === "/me" && M === "GET") {
    const profile = db.profiles[email] || { name: "User", avatar_url: "" };
    return delay(ok({ email, name: profile.name, avatar_url: profile.avatar_url || "" }));
  }
  if (path === "/me/email" && M === "PUT") {
    const { new_email, password } = body || {};
    if (db.users[email] !== password) return delay(err(401, "Wrong password"));
    if (!new_email) return delay(err(400, "Email required"));
    if (db.users[new_email] && new_email !== email) return delay(err(409, "Email taken"));
    const pw = db.users[email];
    const profile = db.profiles[email];
    delete db.users[email];
    db.users[new_email] = pw;
    if (profile) {
      delete db.profiles[email];
      db.profiles[new_email] = profile;
    }
    commit();
    return delay(ok({ access_token: token(new_email, "a"), refresh_token: token(new_email, "r") }));
  }
  if (path === "/me/password" && M === "PUT") {
    const { current_password, new_password } = body || {};
    if (db.users[email] !== current_password) return delay(err(401, "Wrong password"));
    if (!new_password || new_password.length < 6) return delay(err(400, "Password too short"));
    db.users[email] = new_password;
    commit();
    return delay(ok({ ok: true }));
  }

  // ---- Notifications ----
  if (path.startsWith("/notifications/unread-count") && M === "GET") {
    maybeInjectNew();
    const mutedIds = new Set(db.accounts.filter((a) => a.status !== "active").map((a) => a.id));
    const count = db.notifications.filter(
      (n) => !n.is_read && !mutedIds.has(n.account_id ?? -1),
    ).length;
    return delay(ok({ count }));
  }
  if (path.startsWith("/notifications") && M === "GET") {
    maybeInjectNew();
    const url = new URL("http://x" + path);
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const page_size = parseInt(url.searchParams.get("page_size") || "20", 10);
    const q = (url.searchParams.get("q") || "").toLowerCase();
    const isReadParam = url.searchParams.get("is_read");
    const includeOutgoing = url.searchParams.get("include_outgoing") === "true";
    const forChat = url.searchParams.get("for_chat") === "true";
    const mutedIds = new Set(db.accounts.filter((a) => a.status === "muted").map((a) => a.id));
    let filtered = db.notifications.slice();
    if (!forChat) filtered = filtered.filter((n) => !mutedIds.has(n.account_id ?? -1));
    if (!includeOutgoing) filtered = filtered.filter((n) => !n.is_outgoing);
    if (q)
      filtered = filtered.filter(
        (n) => n.message.toLowerCase().includes(q) || n.sender.toLowerCase().includes(q),
      );
    if (isReadParam === "true") filtered = filtered.filter((n) => n.is_read);
    if (isReadParam === "false") filtered = filtered.filter((n) => !n.is_read);
    const total = filtered.length;
    const items = filtered.slice((page - 1) * page_size, page * page_size);
    return delay(ok({ items, total, page, page_size }));
  }
  const readMatch = path.match(/^\/notifications\/(\d+)\/read$/);
  if (readMatch && M === "POST") {
    const id = parseInt(readMatch[1], 10);
    const n = db.notifications.find((x) => x.id === id);
    if (n) n.is_read = true;
    commit();
    return delay(ok({ ok: true }));
  }
  if (path === "/notifications/read-all" && M === "POST") {
    db.notifications = db.notifications.map((n) => ({ ...n, is_read: true }));
    commit();
    return delay(ok({ ok: true }));
  }
  if (path === "/notifications/delete-selected" && M === "POST") {
    const ids = Array.isArray(body?.ids)
      ? new Set((body.ids as number[]).map((x) => Number(x)))
      : new Set<number>();
    const before = db.notifications.length;
    db.notifications = db.notifications.filter((n) => !ids.has(n.id));
    const deleted = before - db.notifications.length;
    commit();
    return delay(ok({ ok: true, deleted }));
  }
  if (path === "/notifications/history" && M === "DELETE") {
    const deleted = db.notifications.length;
    db.notifications = [];
    commit();
    return delay(ok({ ok: true, deleted }));
  }

  // ---- Accounts (multi-channel) ----
  if (path === "/accounts" && M === "GET") return delay(ok(db.accounts));
  const acctMatch = path.match(/^\/accounts\/(\d+)(?:\/(\w+))?$/);
  if (acctMatch) {
    const id = parseInt(acctMatch[1], 10);
    const action = acctMatch[2];
    const a = db.accounts.find((x) => x.id === id);
    if (!a) return delay(err(404, "Account not found"));
    if (M === "DELETE" && !action) {
      db.accounts = db.accounts.filter((x) => x.id !== id);
      commit();
      return delay(ok({ ok: true }));
    }
    if (M === "POST" && action === "disconnect") {
      a.status = "disconnected";
      commit();
      return delay(ok(a));
    }
    if (M === "POST" && action === "reconnect") {
      if (!a.phone_number) return delay(err(400, "Phone number required to reconnect"));
      db.pendingCodes[a.session_name] = true;
      commit();
      return delay(ok({ ok: true }));
    }
    if (M === "POST" && action === "mute") {
      a.status = "muted";
      commit();
      return delay(ok(a));
    }
    if (M === "POST" && action === "unmute") {
      a.status = "active";
      commit();
      return delay(ok(a));
    }
  }

  // ---- Telegram connect wizard ----
  if (path === "/telegram/connect/send-code" && M === "POST") {
    if (!body?.display_name || !body?.session_name || !body?.phone_number) {
      return delay(err(400, "Missing fields"));
    }
    db.pendingCodes[body.session_name] = true;
    commit();
    return delay(ok({ ok: true, hint: "Mock: any code works (use 00000 to simulate 2FA)" }));
  }
  if (path === "/telegram/connect/verify" && M === "POST") {
    if (!db.pendingCodes[body.session_name]) return delay(err(400, "Send code first"));
    if (!body.code) return delay(err(400, "Code required"));
    if (body.code === "00000" && !body.password) return delay(err(401, "2FA password required"));
    const existing = db.accounts.find((x) => x.session_name === body.session_name);
    const a: AccountRec = existing
      ? {
          ...existing,
          label: body.display_name,
          display_name: body.display_name,
          phone_number: body.phone_number,
          status: "active",
        }
      : {
          id: db.nextId++,
          type: "telegram",
          label: body.display_name,
          display_name: body.display_name,
          username: body.username ? String(body.username) : undefined,
          session_name: body.session_name,
          phone_number: body.phone_number,
          status: "active",
        };
    if (!existing) db.accounts.push(a);
    else Object.assign(existing, a);
    delete db.pendingCodes[body.session_name];
    commit();
    return delay(ok({ ok: true, account: a }));
  }

  if (path === "/telegram/messages/send" && M === "POST") {
    const account = db.accounts.find((a) => a.id === Number(body?.account_id));
    if (!account) return delay(err(404, "Account not found"));
    if (account.status !== "active") return delay(err(400, "Account disconnected"));
    const text = String(body?.message_text || "").trim();
    if (!text) return delay(err(400, "Message is required"));
    const chatName = String(body?.peer || body?.chat_name || "Direct message");
    const now = new Date().toISOString();
    db.notifications.unshift({
      id: db.nextId++,
      account_id: account.id,
      sender: chatName,
      sender_id: String(body?.peer || chatName),
      sender_avatar_url: `https://i.pravatar.cc/96?u=${encodeURIComponent(String(body?.peer || chatName))}`,
      chat_id: body?.chat_id ? Number(body.chat_id) : undefined,
      source: account.type,
      chat_name: chatName,
      message: text,
      external_message_id_int: db.nextId + 10000,
      reply_to_external_message_id_int: body?.reply_to_message_id
        ? Number(body.reply_to_message_id)
        : undefined,
      is_outgoing: true,
      peer_read: Math.random() > 0.5,
      is_read: true,
      message_time: now,
      created_at: now,
    });
    commit();
    return delay(ok({ ok: true }));
  }
  if (path === "/telegram/messages/edit" && M === "POST") {
    const target = db.notifications.find(
      (n) =>
        n.account_id === Number(body?.account_id) &&
        n.external_message_id_int === Number(body?.message_id) &&
        n.is_outgoing,
    );
    if (!target) return delay(err(404, "Message not found"));
    const text = String(body?.message_text || "").trim();
    if (!text) return delay(err(400, "Message is required"));
    target.message = text;
    target.edited_at = new Date().toISOString();
    commit();
    return delay(ok({ ok: true }));
  }
  if (path === "/telegram/messages/delete" && M === "POST") {
    const before = db.notifications.length;
    db.notifications = db.notifications.filter(
      (n) =>
        !(
          n.account_id === Number(body?.account_id) &&
          n.external_message_id_int === Number(body?.message_id)
        ),
    );
    const deleted = before - db.notifications.length;
    commit();
    return delay(ok({ ok: true, deleted: deleted > 0 }));
  }
  if (path === "/telegram/messages/pin" && M === "POST") {
    return delay(ok({ ok: true }));
  }
  if (path === "/telegram/messages/read" && M === "POST") {
    const accountId = Number(body?.account_id);
    const chatId = body?.chat_id != null ? Number(body.chat_id) : null;
    const peer = String(body?.peer || "").trim();
    const unread = db.notifications.filter(
      (n) =>
        !n.is_read &&
        !n.is_outgoing &&
        n.account_id === accountId &&
        (chatId != null
          ? n.chat_id === chatId
          : peer
            ? (n.sender_id || n.sender || n.chat_name || "").toLowerCase() === peer.toLowerCase()
            : false),
    );
    for (const n of unread) n.is_read = true;
    commit();
    return delay(ok({ ok: true, marked: unread.length }));
  }

  // ---- Push ----
  if (path === "/push/public-key" && M === "GET") return delay(ok({ public_key: "" }));
  if (path === "/push/state" && M === "GET") return delay(ok({ enabled: db.pushEnabled }));
  if (path === "/push/state" && M === "PUT") {
    db.pushEnabled = !!body?.enabled;
    commit();
    return delay(ok({ enabled: db.pushEnabled }));
  }
  if (path === "/push/subscribe" && M === "POST") return delay(ok({ ok: true }));
  if (path === "/push/unsubscribe" && M === "POST") return delay(ok({ ok: true, removed: 1 }));
  if (path === "/push/test" && M === "POST") return delay(ok({ ok: true }));

  return delay(err(404, `Mock: ${M} ${path} not implemented`));
}
