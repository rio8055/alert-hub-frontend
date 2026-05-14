import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ungzip } from "pako";
import {
  SendHorizontal,
  Phone,
  Search,
  MoreVertical,
  Menu,
  Paperclip,
  ArrowLeft,
  Image as ImageIcon,
  FileText,
  Music2,
  Video,
  Sticker,
  Check,
  CheckCheck,
  Reply,
  Copy,
  Pin,
  Download,
  SquareCheckBig,
  Trash2,
  Pencil,
  X,
  Circle,
  CheckCircle2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { toast } from "sonner";
import { api, resolveBackendMediaUrl } from "@/lib/api";
import type { AccountRec } from "@/lib/mockApi";
import { accountDisplayName, avatarTone, telegramStyleInitials } from "@/lib/accountVisual";
import { AccountAvatar, ConnectedAccountAvatar } from "@/components/AccountAvatar";
import { channelFor } from "@/lib/channels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/dashboard/chat")({
  head: () => ({
    meta: [
      { title: "Chat — Alert Hub" },
      { name: "description", content: "Chat with connected accounts in channel-specific layouts." },
    ],
  }),
  component: ChatPage,
});

interface NotificationItem {
  id: number | string;
  account_id?: number;
  telegram_account_id?: number;
  chat_id?: number | null;
  sender_id?: string | null;
  sender_avatar_url?: string | null;
  sender?: string | null;
  sender_name?: string | null;
  source?: string | null;
  chat_name?: string | null;
  message?: string | null;
  message_text?: string | null;
  is_outgoing?: boolean;
  peer_read?: boolean;
  is_read: boolean;
  message_time?: string | null;
  message_at?: string | null;
  edited_at?: string | null;
  external_message_id_int?: number | null;
  reply_to_external_message_id_int?: number | null;
  created_at?: string | null;
}

interface NotificationsResp {
  items: NotificationItem[];
}

interface ChatThread {
  id: string;
  accountId: number;
  accountKey: string;
  personName: string;
  chatName: string;
  preview: string;
  unread: number;
  lastAt: string | null;
}

interface OutgoingMessage {
  id: string;
  threadId: string;
  personName: string;
  chatName: string;
  text: string;
  createdAt: string;
}

interface ChatMessageItem {
  id: string;
  from: "me" | "them";
  text: string;
  createdAt: string | null;
  peerRead: boolean;
  avatarUrl: string | null;
  notificationId: number | null;
  externalMessageId: number | null;
  replyToExternalMessageId: number | null;
  editedAt: string | null;
}

interface MediaGalleryItem {
  url: string;
  kind: "sticker" | "image" | "video";
}

function TgsSticker({
  url,
  className,
}: {
  url: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let animation: { destroy: () => void } | null = null;
    const load = async () => {
      try {
        const { default: lottie } = await import("lottie-web");
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to load sticker");
        const buf = await res.arrayBuffer();
        const jsonText = ungzip(new Uint8Array(buf), { to: "string" }) as string;
        const data = JSON.parse(jsonText);
        if (!active || !containerRef.current) return;
        animation = lottie.loadAnimation({
          container: containerRef.current,
          renderer: "svg",
          loop: true,
          autoplay: true,
          animationData: data,
        });
      } catch {
        if (active) setFailed(true);
      }
    };
    load();
    return () => {
      active = false;
      animation?.destroy();
    };
  }, [url]);

  if (failed) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-background/70 px-3 py-2">
        <Sticker className="h-4 w-4" />
        <span className="text-sm">Sticker</span>
      </div>
    );
  }
  return <div ref={containerRef} className={className || "h-40 w-40"} />;
}

const OUTBOX_KEY = "alerthub_chat_outbox_v1";
const DISMISSED_THREADS_KEY = "alerthub_chat_dismissed_threads_v1";
const CHAT_SELECTED_SENDER_KEY = "alerthub_chat_selected_sender_v1";
const CHAT_SELECTED_THREAD_KEY = "alerthub_chat_selected_thread_v1";
const CHAT_PINNED_MESSAGES_KEY = "alerthub_chat_pinned_messages_v1";
const CHAT_MUTED_THREADS_KEY = "alerthub_chat_muted_threads_v1";
const CHAT_PINNED_THREADS_ORDER_KEY = "alerthub_chat_pinned_threads_order_v1";

function msgTime(n: NotificationItem): string | null {
  return n.message_time || n.message_at || n.created_at || null;
}

function senderName(n: NotificationItem): string {
  return n.sender || n.sender_name || "Unknown sender";
}

function jstTime(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function jstDayToken(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const month = parts.find((p) => p.type === "month")?.value || "00";
  const day = parts.find((p) => p.type === "day")?.value || "00";
  return `${month}:${day}`;
}

function peerTypeOf(n: NotificationItem | undefined): "user" | "bot" | "channel" | "group" {
  if (!n) return "user";
  const s = `${n.sender || n.sender_name || ""}`.toLowerCase();
  const c = `${n.chat_name || ""}`.toLowerCase();
  if (!c || c === "direct message") return "user";
  if (s.includes("bot") || c.includes("bot")) return "bot";
  if (c.includes("channel") || c.startsWith("#")) return "channel";
  // Telegram: private chats use a positive chat/user id; groups/supergroups use negative ids (-100…).
  // Treating any chat_id as "group" broke DMs after sending (outgoing rows include chat_id).
  const cid = n.chat_id;
  if (cid != null && cid < 0 && c) return "group";
  return "user";
}

function buildThreadKey(n: NotificationItem): string {
  if (n.chat_id != null) return `chat:${n.chat_id}`;
  const sender = (n.sender_id || n.sender || n.sender_name || "").trim();
  return sender ? `sender:${sender}` : "sender:unknown";
}

/** Same peer (chat/sender) can exist on multiple linked accounts; always scope by notification account. */
function notificationMatchesThread(n: NotificationItem, thread: ChatThread): boolean {
  const accId = n.account_id ?? n.telegram_account_id;
  if (accId !== thread.accountId) return false;
  const threadId = `${thread.accountKey}::${buildThreadKey(n)}`;
  return threadId === thread.id;
}

function messageBody(n: NotificationItem): string {
  return n.message || n.message_text || "(no content)";
}

function messagePreview(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("sticker")) return "Sticker";
  const links = extractUrls(text);
  if (links.length === 0) return text;
  if (isGifLikeMedia(links[0], text)) return "GIF";
  const kind = mediaKindFromUrl(links[0]);
  if (kind === "sticker") return "Sticker";
  if (kind === "image") return "Image";
  if (kind === "video") return "Video";
  if (kind === "audio") return "Audio";
  return "File";
}

function safeLocalStorageGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function accountIdentity(a: AccountRec): string {
  return a.username || String(a.id);
}

function classifyMessage(
  text: string,
): "sticker" | "image" | "video" | "audio" | "file" | "emoji" | "text" {
  const t = text.trim();
  if (!t) return "text";
  if (t.toLowerCase() === "sticker") return "sticker";
  if (t.toLowerCase() === "photo") return "image";
  if (t.toLowerCase().includes("video")) return "video";
  if (t.toLowerCase().includes("audio") || t.toLowerCase().includes("voice")) return "audio";
  if (t.toLowerCase().startsWith("file")) return "file";
  if (/^[\p{Extended_Pictographic}\p{Emoji_Presentation}\s]+$/u.test(t)) return "emoji";
  return "text";
}

function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s]+/gi);
  if (!matches) return [];
  return Array.from(new Set(matches));
}

function mediaKindFromUrl(url: string): "sticker" | "image" | "video" | "audio" | "file" {
  const clean = url.split("?")[0].toLowerCase();
  if (/\.(webp|tgs)$/.test(clean)) return "sticker";
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(clean)) return "image";
  if (/\.(mp4|webm|mov|m4v)$/.test(clean)) return "video";
  if (/\.(mp3|wav|ogg|m4a|aac|flac)$/.test(clean)) return "audio";
  return "file";
}

function isGifLikeMedia(url: string, text?: string): boolean {
  const clean = url.split("?")[0].toLowerCase();
  if (/\.gif$/.test(clean)) return true;
  if (/\.(mp4|webm|mov|m4v)$/.test(clean) && /gif/.test(clean)) return true;
  if ((text || "").toLowerCase().includes("gif") && /\.(mp4|webm|mov|m4v)$/.test(clean)) return true;
  return false;
}

function isAnimatedStickerUrl(url: string): boolean {
  return /\.tgs(\?|$)/i.test(url);
}

export function ChatPage() {
  const [accounts, setAccounts] = useState<AccountRec[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string>("");
  const [senderId, setSenderId] = useState<string>("");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [outgoing, setOutgoing] = useState<OutgoingMessage[]>([]);
  const [dismissedThreadIds, setDismissedThreadIds] = useState<string[]>([]);
  const [pinnedMessageByThread, setPinnedMessageByThread] = useState<Record<string, string>>({});
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [replyToMessage, setReplyToMessage] = useState<ChatMessageItem | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessageItem | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    message: ChatMessageItem;
  } | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{
    message: ChatMessageItem;
    alsoDeleteForPeer: boolean;
  } | null>(null);
  const [mutedThreadIds, setMutedThreadIds] = useState<string[]>([]);
  const [pinnedThreadOrder, setPinnedThreadOrder] = useState<string[]>([]);
  const [threadListMenu, setThreadListMenu] = useState<{
    x: number;
    y: number;
    thread: ChatThread;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "chat">("list");
  const [mediaViewer, setMediaViewer] = useState<
    {
      items: MediaGalleryItem[];
      index: number;
      scale: number;
      offsetX: number;
      offsetY: number;
    } | null
  >(null);
  const [isDraggingMedia, setIsDraggingMedia] = useState(false);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const draftInputRef = useRef<HTMLInputElement | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const longPressTimerRef = useRef<number | null>(null);

  const reconcileSenderAfterAccounts = (accData: AccountRec[]) => {
    setSenderId((prev) => {
      if (accData.length === 0) return "";
      if (prev && accData.some((a) => String(a.id) === prev)) return prev;
      const stored = safeLocalStorageGet<string>(CHAT_SELECTED_SENDER_KEY, "");
      if (stored && accData.some((a) => String(a.id) === stored)) return stored;
      return accData.length > 0 ? String(accData[0].id) : "";
    });
  };

  const refreshLinkedAccounts = async () => {
    try {
      const accData = await api<AccountRec[]>("/accounts");
      setAccounts(accData);
      reconcileSenderAfterAccounts(accData);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    setOutgoing(safeLocalStorageGet<OutgoingMessage[]>(OUTBOX_KEY, []));
    setDismissedThreadIds(safeLocalStorageGet<string[]>(DISMISSED_THREADS_KEY, []));
    setPinnedMessageByThread(safeLocalStorageGet<Record<string, string>>(CHAT_PINNED_MESSAGES_KEY, {}));
    setMutedThreadIds(safeLocalStorageGet<string[]>(CHAT_MUTED_THREADS_KEY, []));
    setPinnedThreadOrder(safeLocalStorageGet<string[]>(CHAT_PINNED_THREADS_ORDER_KEY, []));
    setSenderId(safeLocalStorageGet<string>(CHAT_SELECTED_SENDER_KEY, ""));
    setSelectedThreadId(safeLocalStorageGet<string>(CHAT_SELECTED_THREAD_KEY, ""));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadChat = async () => {
      setLoading(true);
      try {
        const [notifResp, accData] = await Promise.all([
          api<NotificationsResp>(
            "/notifications?page=1&page_size=250&include_outgoing=true&for_chat=true",
          ),
          api<AccountRec[]>("/accounts"),
        ]);
        if (cancelled) return;
        setNotifications(notifResp.items || []);
        setAccounts(accData);
        reconcileSenderAfterAccounts(accData);
        setError(null);
      } catch (e: unknown) {
        if (!cancelled) setError(errorMessage(e, "Failed to load chat messages"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadChat();
    const id = window.setInterval(() => void loadChat(), 6000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(outgoing));
  }, [outgoing]);

  useEffect(() => {
    localStorage.setItem(DISMISSED_THREADS_KEY, JSON.stringify(dismissedThreadIds));
  }, [dismissedThreadIds]);
  useEffect(() => {
    localStorage.setItem(CHAT_PINNED_MESSAGES_KEY, JSON.stringify(pinnedMessageByThread));
  }, [pinnedMessageByThread]);
  useEffect(() => {
    localStorage.setItem(CHAT_SELECTED_SENDER_KEY, JSON.stringify(senderId));
  }, [senderId]);
  useEffect(() => {
    localStorage.setItem(CHAT_SELECTED_THREAD_KEY, JSON.stringify(selectedThreadId));
  }, [selectedThreadId]);
  useEffect(() => {
    localStorage.setItem(CHAT_MUTED_THREADS_KEY, JSON.stringify(mutedThreadIds));
  }, [mutedThreadIds]);
  useEffect(() => {
    localStorage.setItem(CHAT_PINNED_THREADS_ORDER_KEY, JSON.stringify(pinnedThreadOrder));
  }, [pinnedThreadOrder]);

  const sender = useMemo(
    () => accounts.find((a) => String(a.id) === senderId),
    [accounts, senderId],
  );
  const threads = useMemo<ChatThread[]>(() => {
    if (!sender) return [];
    const grouped = new Map<
      string,
      { items: NotificationItem[]; personName: string; chatName: string }
    >();
    notifications
      .filter((n) => (n.account_id ?? n.telegram_account_id) === sender.id)
      .forEach((n) => {
        const personName = senderName(n);
        const chatName = n.chat_name || "Direct message";
        const threadKey = buildThreadKey(n);
        const threadId = `${accountIdentity(sender)}::${threadKey}`;
        const existing = grouped.get(threadId);
        if (existing) {
          existing.items.push(n);
        } else {
          grouped.set(threadId, { items: [n], personName, chatName });
        }
      });

    outgoing
      .filter((m) => m.threadId.startsWith(`${accountIdentity(sender)}::`))
      .forEach((m) => {
        if (!grouped.has(m.threadId)) {
          grouped.set(m.threadId, {
            items: [],
            personName: m.personName || "Unknown",
            chatName: m.chatName || "Direct message",
          });
        }
      });

    return Array.from(grouped.entries())
      .map(([id, info]) => {
        const incomingLast =
          info.items
            .map((n) => msgTime(n))
            .filter((v): v is string => !!v)
            .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;
        const outLast =
          outgoing
            .filter((m) => m.threadId === id)
            .map((m) => m.createdAt)
            .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;
        const lastAt =
          [incomingLast, outLast]
            .filter((v): v is string => !!v)
            .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;

        const latestIncoming = info.items
          .slice()
          .sort(
            (a, b) => new Date(msgTime(b) || 0).getTime() - new Date(msgTime(a) || 0).getTime(),
          )[0];
        const latestOut = outgoing
          .filter((m) => m.threadId === id)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        const latestText =
          latestOut &&
          (!latestIncoming ||
            new Date(latestOut.createdAt) >= new Date(msgTime(latestIncoming) || 0))
            ? `You: ${latestOut.text}`
            : latestIncoming
              ? messagePreview(messageBody(latestIncoming))
              : "No messages yet";

        const rawUnread = info.items.filter((n) => !n.is_read).length;
        return {
          id,
          accountId: sender.id,
          accountKey: accountIdentity(sender),
          personName: info.personName,
          chatName: info.chatName,
          preview: latestText,
          unread: mutedThreadIds.includes(id) ? 0 : rawUnread,
          lastAt,
        };
      })
      .filter((t) => !dismissedThreadIds.includes(t.id))
      .sort((a, b) => {
        const ia = pinnedThreadOrder.indexOf(a.id);
        const ib = pinnedThreadOrder.indexOf(b.id);
        const aPinned = ia >= 0;
        const bPinned = ib >= 0;
        if (aPinned && bPinned) return ia - ib;
        if (aPinned && !bPinned) return -1;
        if (!aPinned && bPinned) return 1;
        return new Date(b.lastAt || 0).getTime() - new Date(a.lastAt || 0).getTime();
      });
  }, [dismissedThreadIds, mutedThreadIds, notifications, outgoing, pinnedThreadOrder, sender]);
  const filteredThreads = useMemo(
    () =>
      threads.filter((t) =>
        `${t.personName} ${t.chatName}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [threads, query],
  );
  const selectedThread = useMemo(
    () => filteredThreads.find((t) => t.id === selectedThreadId) || filteredThreads[0],
    [filteredThreads, selectedThreadId],
  );
  useEffect(() => {
    if (filteredThreads.length === 0) {
      setSelectedThreadId("");
      return;
    }
    const stillExists = filteredThreads.some((t) => t.id === selectedThreadId);
    if (!stillExists) setSelectedThreadId(filteredThreads[0].id);
  }, [filteredThreads, selectedThreadId]);
  useEffect(() => {
    if (selectedThreadId) setMobileView("chat");
  }, [selectedThreadId]);
  useEffect(() => {
    setReplyToMessage(null);
    setEditingMessage(null);
    setSelectedMessageIds([]);
    setContextMenu(null);
    setThreadListMenu(null);
  }, [selectedThread?.id]);
  useEffect(() => {
    const onWindowClick = () => {
      setContextMenu(null);
      setThreadListMenu(null);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenu(null);
        setThreadListMenu(null);
      }
    };
    window.addEventListener("click", onWindowClick);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("click", onWindowClick);
      window.removeEventListener("keydown", onEsc);
    };
  }, []);

  const canSend = !!sender && sender.status === "active";
  const selectedMessages = useMemo<ChatMessageItem[]>(() => {
    if (!selectedThread) return [];
    const incoming = notifications
      .filter((n) => notificationMatchesThread(n, selectedThread))
      .map((n) => ({
        id: `in-${n.id}`,
        from: n.is_outgoing ? ("me" as const) : ("them" as const),
        text: messageBody(n),
        createdAt: msgTime(n),
        peerRead: !!n.peer_read,
        avatarUrl: resolveBackendMediaUrl(n.sender_avatar_url) || null,
        notificationId: Number(n.id),
        externalMessageId: n.external_message_id_int ?? null,
        replyToExternalMessageId: n.reply_to_external_message_id_int ?? null,
        editedAt: n.edited_at || null,
      }));
    const out = outgoing
      .filter((m) => m.threadId === selectedThread.id)
      .map((m) => ({
        id: `out-${m.id}`,
        from: "me" as const,
        text: m.text,
        createdAt: m.createdAt,
        peerRead: false,
        avatarUrl: null,
        notificationId: null,
        externalMessageId: null,
        replyToExternalMessageId: null,
        editedAt: null,
      }));
    return [...incoming, ...out].sort(
      (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime(),
    );
  }, [notifications, outgoing, selectedThread]);
  const selectedThreadChatId = useMemo(() => {
    if (!selectedThread) return null;
    const match = notifications.find(
      (n) => notificationMatchesThread(n, selectedThread) && n.chat_id != null,
    );
    return match?.chat_id ?? null;
  }, [notifications, selectedThread]);
  const selectedThreadType = useMemo(() => {
    if (!selectedThread) return "user";
    const inThread = notifications.filter((n) => notificationMatchesThread(n, selectedThread));
    const incoming = inThread.find((n) => !n.is_outgoing);
    return peerTypeOf(incoming ?? inThread[0]);
  }, [notifications, selectedThread]);
  const mediaGallery = useMemo<MediaGalleryItem[]>(() => {
    const out: MediaGalleryItem[] = [];
    const seen = new Set<string>();
    for (const m of selectedMessages) {
      const links = extractUrls(m.text);
      for (const link of links) {
        const kind = mediaKindFromUrl(link);
        if (kind !== "image" && kind !== "video" && kind !== "sticker") continue;
        const resolved = resolveBackendMediaUrl(link);
        const key = `${kind}:${resolved}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ url: resolved, kind });
      }
    }
    return out;
  }, [selectedMessages]);
  const selectedMessagesByExternalId = useMemo(() => {
    const map = new Map<number, ChatMessageItem>();
    for (const message of selectedMessages) {
      if (message.externalMessageId != null) {
        map.set(message.externalMessageId, message);
      }
    }
    return map;
  }, [selectedMessages]);
  const openMediaViewer = (url: string, kind: "sticker" | "image" | "video") => {
    const idx = mediaGallery.findIndex((m) => m.url === url && m.kind === kind);
    setMediaViewer({
      items: mediaGallery,
      index: idx >= 0 ? idx : 0,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
  };
  useEffect(() => {
    if (!mediaViewer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMediaViewer(null);
        return;
      }
      if (e.key === "ArrowRight" && mediaViewer.items.length > 0) {
        setMediaViewer((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            index: (prev.index + 1) % prev.items.length,
            scale: 1,
            offsetX: 0,
            offsetY: 0,
          };
        });
      }
      if (e.key === "ArrowLeft" && mediaViewer.items.length > 0) {
        setMediaViewer((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            index: (prev.index - 1 + prev.items.length) % prev.items.length,
            scale: 1,
            offsetX: 0,
            offsetY: 0,
          };
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mediaViewer]);
  useEffect(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [selectedThreadId, selectedMessages.length]);

  const markSelectedAsRead = async (silent = false) => {
    if (!selectedThread) return;
    const unread = notifications.filter(
      (n) => notificationMatchesThread(n, selectedThread) && !n.is_read,
    );
    if (unread.length === 0) return;
    try {
      await Promise.all(unread.map((n) => api(`/notifications/${n.id}/read`, { method: "POST" })));
      if (sender?.type === "telegram") {
        await api("/telegram/messages/read", {
          method: "POST",
          body: JSON.stringify({
            account_id: selectedThread.accountId,
            chat_id: selectedThreadChatId,
            peer: selectedThread.personName,
          }),
        });
      }
      setNotifications((prev) =>
        prev.map((n) => (unread.some((u) => u.id === n.id) ? { ...n, is_read: true } : n)),
      );
      if (!silent) toast.success("Marked as read");
    } catch (e: unknown) {
      if (!silent) toast.error(errorMessage(e, "Failed to mark read"));
      void refreshLinkedAccounts();
    }
  };

  useEffect(() => {
    if (!selectedThread) return;
    void markSelectedAsRead(true);
  }, [selectedThread?.id, notifications, sender?.type]);

  const clearThreadHistory = () => {
    if (!selectedThread) return;
    setOutgoing((prev) => prev.filter((m) => m.threadId !== selectedThread.id));
    toast("Sent message history cleared for this thread");
  };

  const dismissThread = () => {
    if (!selectedThread) return;
    setDismissedThreadIds((prev) => Array.from(new Set([...prev, selectedThread.id])));
    toast("Thread removed from chat list");
  };

  const pinThreadToTop = (thread: ChatThread) => {
    setPinnedThreadOrder((prev) => {
      const rest = prev.filter((id) => id !== thread.id);
      return [thread.id, ...rest];
    });
    toast.success("Pinned to top");
  };

  const unpinThreadFromTop = (thread: ChatThread) => {
    setPinnedThreadOrder((prev) => prev.filter((id) => id !== thread.id));
    toast.success("Unpinned from top");
  };

  const deleteChatThread = (thread: ChatThread) => {
    setDismissedThreadIds((prev) => Array.from(new Set([...prev, thread.id])));
    setOutgoing((prev) => prev.filter((m) => m.threadId !== thread.id));
    setPinnedThreadOrder((prev) => prev.filter((id) => id !== thread.id));
    setMutedThreadIds((prev) => prev.filter((id) => id !== thread.id));
    setPinnedMessageByThread((prev) => {
      const next = { ...prev };
      delete next[thread.id];
      return next;
    });
    toast.success("Chat deleted");
  };

  const toggleMuteThread = (thread: ChatThread) => {
    const muted = mutedThreadIds.includes(thread.id);
    setMutedThreadIds((prev) =>
      muted ? prev.filter((id) => id !== thread.id) : [...prev, thread.id],
    );
    toast.success(muted ? "Chat unmuted" : "Chat muted");
  };

  const selectMessage = (messageId: string) => {
    setSelectedMessageIds((prev) =>
      prev.includes(messageId) ? prev.filter((id) => id !== messageId) : [...prev, messageId],
    );
  };
  const selectionMode = selectedMessageIds.length > 0;
  const clearLongPress = () => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const copyMessage = async (msg: ChatMessageItem) => {
    try {
      await navigator.clipboard.writeText(msg.text);
      toast.success("Message copied");
    } catch {
      toast.error("Failed to copy message");
    }
  };

  const downloadMessage = (msg: ChatMessageItem) => {
    const firstUrl = extractUrls(msg.text)[0];
    if (firstUrl) {
      const link = document.createElement("a");
      link.href = resolveBackendMediaUrl(firstUrl);
      link.target = "_blank";
      link.rel = "noreferrer";
      link.download = "";
      link.click();
      return;
    }
    const blob = new Blob([msg.text], { type: "text/plain;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `message-${msg.id}.txt`;
    link.click();
    URL.revokeObjectURL(href);
  };

  const pinMessage = async (msg: ChatMessageItem) => {
    if (!selectedThread || !sender) return;
    if (sender.type === "telegram" && msg.externalMessageId != null) {
      try {
        await api("/telegram/messages/pin", {
          method: "POST",
          body: JSON.stringify({
            account_id: selectedThread.accountId,
            chat_id: selectedThreadChatId,
            peer: selectedThread.personName,
            message_id: msg.externalMessageId,
          }),
        });
      } catch (e: unknown) {
        toast.error(errorMessage(e, "Failed to pin message"));
        void refreshLinkedAccounts();
        return;
      }
    }
    setPinnedMessageByThread((prev) => ({ ...prev, [selectedThread.id]: msg.id }));
    toast.success("Message pinned");
  };

  const deleteMessage = async (msg: ChatMessageItem, revoke = true) => {
    if (!selectedThread || !sender) return;
    try {
      if (sender.type === "telegram" && msg.externalMessageId != null) {
        await api("/telegram/messages/delete", {
          method: "POST",
          body: JSON.stringify({
            account_id: selectedThread.accountId,
            chat_id: selectedThreadChatId,
            peer: selectedThread.personName,
            message_id: msg.externalMessageId,
            revoke,
          }),
        });
      }
      if (msg.notificationId != null) {
        await api("/notifications/delete-selected", {
          method: "POST",
          body: JSON.stringify({ ids: [msg.notificationId] }),
        });
      } else if (msg.id.startsWith("out-")) {
        const outId = msg.id.replace("out-", "");
        setOutgoing((prev) => prev.filter((item) => item.id !== outId));
      }
      setNotifications((prev) => prev.filter((n) => Number(n.id) !== msg.notificationId));
      setSelectedMessageIds((prev) => prev.filter((id) => id !== msg.id));
      toast.success("Message deleted");
    } catch (e: unknown) {
      toast.error(errorMessage(e, "Failed to delete message"));
      void refreshLinkedAccounts();
    }
  };

  const beginEditMessage = (msg: ChatMessageItem) => {
    if (msg.from !== "me") {
      toast.error("Only your messages can be edited");
      return;
    }
    if (msg.externalMessageId == null) {
      toast.error("Message is not synced yet");
      return;
    }
    setEditingMessage(msg);
    setReplyToMessage(null);
    setDraft(msg.text);
  };

  return (
    <section
      className="grid h-full min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-none border-y border-border bg-card shadow-sm md:rounded-none md:border-x-0"
      onContextMenu={(e) => {
        const el = e.target as HTMLElement;
        if (el.closest("[data-chat-custom-context='true']")) return;
        if (el.closest("input, textarea, [contenteditable='true']")) return;
        e.preventDefault();
      }}
    >
      {mediaViewer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onContextMenu={(e) => e.preventDefault()}
          onClick={() => setMediaViewer(null)}
          onWheel={(e) => {
            const current = mediaViewer.items[mediaViewer.index];
            if (!current || (current.kind !== "image" && current.kind !== "sticker")) return;
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            setMediaViewer((prev) => {
              if (!prev) return prev;
              const nextScale = Math.min(4, Math.max(1, Number((prev.scale + delta).toFixed(2))));
              return { ...prev, scale: nextScale };
            });
          }}
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded-md bg-black/40 px-2 py-1 text-sm text-white"
            onClick={() => setMediaViewer(null)}
          >
            Close
          </button>
          <div
            className="max-h-[92vh] max-w-[92vw] select-none"
            onClick={(e) => e.stopPropagation()}
            onMouseMove={(e) => {
              if (!isDraggingMedia || !dragStartRef.current) return;
              const dx = e.clientX - dragStartRef.current.x;
              const dy = e.clientY - dragStartRef.current.y;
              setMediaViewer((prev) =>
                prev
                  ? {
                      ...prev,
                      offsetX: dragStartRef.current!.ox + dx,
                      offsetY: dragStartRef.current!.oy + dy,
                    }
                  : prev,
              );
            }}
            onMouseUp={() => {
              setIsDraggingMedia(false);
              dragStartRef.current = null;
            }}
            onMouseLeave={() => {
              setIsDraggingMedia(false);
              dragStartRef.current = null;
            }}
          >
            {(mediaViewer.items[mediaViewer.index]?.kind === "image" ||
              mediaViewer.items[mediaViewer.index]?.kind === "sticker") && (
              <img
                src={mediaViewer.items[mediaViewer.index].url}
                alt="Preview"
                className="max-h-[92vh] max-w-[92vw] cursor-grab object-contain"
                style={{
                  transform: `translate(${mediaViewer.offsetX}px, ${mediaViewer.offsetY}px) scale(${mediaViewer.scale})`,
                  transformOrigin: "center center",
                }}
                onMouseDown={(e) => {
                  if (mediaViewer.scale <= 1) return;
                  setIsDraggingMedia(true);
                  dragStartRef.current = {
                    x: e.clientX,
                    y: e.clientY,
                    ox: mediaViewer.offsetX,
                    oy: mediaViewer.offsetY,
                  };
                }}
              />
            )}
            {mediaViewer.items[mediaViewer.index]?.kind === "video" && (
              <video
                src={mediaViewer.items[mediaViewer.index].url}
                controls
                autoPlay
                className="max-h-[92vh] max-w-[92vw] rounded-lg object-contain"
              />
            )}
            {mediaViewer.items.length > 1 && (
              <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-3 py-1 text-xs text-white">
                {mediaViewer.index + 1} / {mediaViewer.items.length}
              </div>
            )}
          </div>
        </div>
      )}
      <div className="border-b border-border bg-background px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          {accounts.map((a) => {
            const ch = channelFor(a.type);
            const Icon = ch.icon;
            const active = String(a.id) === senderId;
            return (
              <button
                key={a.id}
                onClick={() => setSenderId(String(a.id))}
                className={`flex items-center gap-2 rounded-md border px-3 py-1.5 transition-colors ${
                  active
                    ? "border-primary/40 bg-primary/10"
                    : "border-border bg-muted/20 hover:bg-muted/40"
                }`}
              >
                <span className={`relative flex h-7 w-7 items-center justify-center ${ch.color}`}>
                  <AccountAvatar account={a} sizeClassName="h-7 w-7" />
                  <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-background ring-1 ring-border/50">
                    <Icon className="h-2.5 w-2.5" />
                  </span>
                </span>
                <span className="text-sm font-medium">{accountDisplayName(a)}</span>
              </button>
            );
          })}
          {accounts.length === 0 && (
            <div className="text-sm text-muted-foreground">No connected accounts.</div>
          )}
        </div>
      </div>

      <div className="grid min-h-0 grid-cols-1 overflow-hidden md:grid-cols-[320px_1fr]">
        <aside
          className={`min-h-0 border-r border-border bg-muted/20 ${
            mobileView === "chat" ? "hidden md:flex md:flex-col" : "flex flex-col"
          }`}
        >
          <div className="border-b border-border p-3">
            <div className="mb-2 flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost">
                    <Menu className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => toast("Unread filter selected")}>
                    Unread chats
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => toast("Muted filter selected")}>
                    Muted chats
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => toast("Chat settings opened")}>
                    Chat settings
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Search people or chats"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2 [scrollbar-color:rgba(148,163,184,0.45)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-500/40 [&::-webkit-scrollbar-thumb:hover]:bg-slate-400/55 [&::-webkit-scrollbar-track]:bg-transparent">
            <div className="space-y-1">
              {error && <div className="rounded-md p-2 text-xs text-destructive">{error}</div>}
              {filteredThreads.length === 0 && (
                <div className="rounded-md p-4 text-sm text-muted-foreground">
                  No chat people found for this account.
                </div>
              )}
              {filteredThreads.map((thread) => {
                const active = thread.id === selectedThread?.id;
                const avatarName = thread.personName || thread.chatName;
                const isPinned = pinnedThreadOrder.includes(thread.id);
                const isMuted = mutedThreadIds.includes(thread.id);
                const threadAvatarRaw = notifications.find(
                  (n) => notificationMatchesThread(n, thread) && !!n.sender_avatar_url,
                )?.sender_avatar_url;
                const threadAvatar = resolveBackendMediaUrl(threadAvatarRaw);
                return (
                  <button
                    key={thread.id}
                    type="button"
                    data-chat-custom-context="true"
                    onClick={() => {
                      setSelectedThreadId(thread.id);
                      setMobileView("chat");
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setThreadListMenu({ x: e.clientX, y: e.clientY, thread });
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                      active ? "bg-accent" : "hover:bg-accent/60"
                    } ${isMuted ? "opacity-80" : ""}`}
                  >
                    <div
                      className="relative flex h-10 w-10 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                      style={{ backgroundColor: avatarTone(avatarName) }}
                    >
                      {threadAvatar ? (
                        <img
                          src={threadAvatar}
                          alt={avatarName}
                          className="h-full w-full rounded-full object-cover"
                        />
                      ) : (
                        telegramStyleInitials(avatarName)
                      )}
                      {isMuted && (
                        <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-background ring-1 ring-border">
                          <VolumeX className="h-2.5 w-2.5 text-muted-foreground" />
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {isPinned && (
                          <Pin className="mr-1 inline-block h-3.5 w-3.5 shrink-0 align-text-bottom text-primary" />
                        )}
                        {thread.personName}
                        {thread.unread > 0 && (
                          <span className="ml-2 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
                            {thread.unread}
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{thread.preview}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <div
          className={`flex h-full min-h-0 flex-col overflow-hidden bg-[linear-gradient(180deg,rgba(40,120,180,0.04),transparent)] ${
            mobileView === "list" ? "hidden md:flex" : "flex"
          }`}
        >
          {!selectedThread && (
            <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
              Select a person from the left list to start chatting.
            </div>
          )}

          {selectedThread && (
            <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
              <header className="flex items-center justify-between border-b border-border bg-background/90 px-4 py-3 backdrop-blur">
                <div className="flex items-center gap-3">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="md:hidden"
                    onClick={() => setMobileView("list")}
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <div
                    className="relative flex h-10 w-10 items-center justify-center rounded-full text-xs font-semibold text-white"
                    style={{ backgroundColor: avatarTone(selectedThread.personName) }}
                  >
                    {(() => {
                      const avatarFromNotif = resolveBackendMediaUrl(
                        notifications.find(
                          (n) =>
                            notificationMatchesThread(n, selectedThread) && !!n.sender_avatar_url,
                        )?.sender_avatar_url,
                      );
                      return avatarFromNotif ? (
                        <img
                          src={avatarFromNotif}
                          alt={selectedThread.personName}
                          className="h-full w-full rounded-full object-cover"
                        />
                      ) : (
                        telegramStyleInitials(selectedThread.personName)
                      );
                    })()}
                  </div>
                  <div className="flex items-center gap-2">
                    {selectionMode ? (
                      <p className="text-sm font-semibold">{selectedMessageIds.length} selected</p>
                    ) : (
                      <div>
                        <p className="text-sm font-medium">{selectedThread.personName}</p>
                        <p className="text-xs text-muted-foreground">{selectedThreadType}</p>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {selectionMode ? (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setSelectedMessageIds([])}
                        title="Cancel selection"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive"
                        title="Delete selected"
                        onClick={async () => {
                          const targets = selectedMessages.filter((m) =>
                            selectedMessageIds.includes(m.id),
                          );
                          for (const msg of targets) {
                            // eslint-disable-next-line no-await-in-loop
                            await deleteMessage(msg, true);
                          }
                          setSelectedMessageIds([]);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="ghost" size="icon">
                        <Search className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon">
                        <Phone className="h-4 w-4" />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => void markSelectedAsRead()}>
                            Mark as read
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => toast("Pinned chats are coming soon")}>
                            Pin chat
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={clearThreadHistory}>
                            Clear sent history
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={dismissThread} className="text-destructive">
                            Hide chat
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  )}
                </div>
              </header>
              {pinnedMessageByThread[selectedThread.id] && (
                <div className="border-b border-border bg-amber-50/60 px-4 py-2 text-xs dark:bg-amber-900/10">
                  <span className="font-medium">Pinned:</span>{" "}
                  {selectedMessages.find((m) => m.id === pinnedMessageByThread[selectedThread.id])?.text ||
                    "Message"}
                </div>
              )}

              <div
                ref={messagesViewportRef}
                className="h-full min-h-0 overflow-y-auto p-4 [scrollbar-color:rgba(148,163,184,0.45)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-500/40 [&::-webkit-scrollbar-thumb:hover]:bg-slate-400/55 [&::-webkit-scrollbar-track]:bg-transparent"
              >
                <div className="flex min-h-full flex-col justify-end gap-2 pb-4">
                  {selectedMessages.length === 0 && (
                    <div className="rounded-md p-3 text-sm text-muted-foreground">
                      No messages in this conversation yet.
                    </div>
                  )}
                  {(() => {
                    let lastDay = "";
                    return selectedMessages.map((m) => {
                      const repliedMessage =
                        m.replyToExternalMessageId != null
                          ? selectedMessagesByExternalId.get(m.replyToExternalMessageId) || null
                          : null;
                      const dayToken = jstDayToken(m.createdAt);
                      const showDay = !!dayToken && dayToken !== lastDay;
                      if (showDay) lastDay = dayToken;
                      const links = extractUrls(m.text);
                      const primaryMediaKind = links.length > 0 ? mediaKindFromUrl(links[0]) : null;
                      const textWithoutUrls = m.text.replace(/https?:\/\/[^\s]+/gi, "").trim();
                      const isGenericMediaLabel = /^(photo|image|video file|video note|audio file|voice message|file|media message|sticker|gif)$/i.test(
                        textWithoutUrls,
                      );
                      const hasCaption = textWithoutUrls.length > 0 && !isGenericMediaLabel;
                      const isMediaBubble = links.length > 0;
                      const isMediaOnly = isMediaBubble && !hasCaption;
                      return (
                        <Fragment key={m.id}>
                          {showDay && (
                            <div className="flex justify-center py-1">
                              <span className="rounded-full border border-border/70 bg-background/90 px-3 py-1 text-[10px] font-medium tracking-wide text-muted-foreground shadow-sm backdrop-blur">
                                {dayToken}
                              </span>
                            </div>
                          )}
                          <div className={`flex ${m.from === "me" ? "justify-end" : "justify-start"}`}>
                            <div
                              className={`flex items-end gap-2 ${m.from === "me" ? "flex-row-reverse" : "flex-row"}`}
                            >
                              {selectionMode && (
                                <button
                                  type="button"
                                  className="mb-1 shrink-0 text-primary"
                                  onClick={() => selectMessage(m.id)}
                                  aria-label="Toggle message selection"
                                >
                                  {selectedMessageIds.includes(m.id) ? (
                                    <CheckCircle2 className="h-5 w-5" />
                                  ) : (
                                    <Circle className="h-5 w-5 text-muted-foreground" />
                                  )}
                                </button>
                              )}
                              <div
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                                style={{
                                  backgroundColor: avatarTone(
                                    m.from === "me" ? "You" : selectedThread.personName,
                                  ),
                                }}
                              >
                                {m.from === "me" ? (
                                  sender ? (
                                    <AccountAvatar
                                      account={sender}
                                      sizeClassName="h-7 w-7"
                                      textClassName="text-[10px]"
                                    />
                                  ) : (
                                    <span className="flex h-full w-full items-center justify-center rounded-full bg-[#229ED9] text-white">
                                      <SendHorizontal className="h-3.5 w-3.5" />
                                    </span>
                                  )
                                ) : (
                                  <ConnectedAccountAvatar
                                    avatarUrl={m.avatarUrl}
                                    displayName={selectedThread.personName}
                                    sizeClassName="h-7 w-7"
                                    textClassName="text-[10px]"
                                  />
                                )}
                              </div>
                              <div
                                data-chat-custom-context="true"
                                className={`max-w-[70%] rounded-2xl text-sm shadow-sm ${
                                  isMediaOnly
                                    ? "overflow-hidden p-0"
                                    : "px-3 py-2"
                                } ${isMediaBubble ? "relative" : ""} ${
                                  selectedMessageIds.includes(m.id) ? "ring-2 ring-primary/60" : ""
                                } ${
                                  m.from === "me"
                                    ? `rounded-br-md ${isMediaOnly ? "bg-transparent text-white shadow-none" : "bg-sky-500 text-white"}`
                                    : `rounded-bl-md ${isMediaOnly ? "bg-transparent text-foreground shadow-none" : "border border-border/80 bg-background/95 text-foreground"}`
                                }`}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  setContextMenu({
                                    x: e.clientX,
                                    y: e.clientY,
                                    message: m,
                                  });
                                }}
                                onClick={() => {
                                  if (selectionMode) selectMessage(m.id);
                                }}
                                onTouchStart={() => {
                                  clearLongPress();
                                  longPressTimerRef.current = window.setTimeout(() => {
                                    selectMessage(m.id);
                                  }, 450);
                                }}
                                onTouchEnd={clearLongPress}
                                onTouchMove={clearLongPress}
                                onTouchCancel={clearLongPress}
                              >
                                {(() => {
                                  const kind = classifyMessage(m.text);
                                  if (links.length > 0) {
                                    return (
                                      <div className={hasCaption ? "space-y-2" : ""}>
                                        {repliedMessage && (
                                          <div
                                            className={`mx-1 mt-1 rounded-md border-l-2 px-2 py-1 text-xs ${
                                              m.from === "me"
                                                ? "border-white/70 bg-white/15 text-white/90"
                                                : "border-primary/70 bg-primary/10 text-foreground"
                                            }`}
                                          >
                                            <p className="line-clamp-2">
                                              {repliedMessage.text || "(original message)"}
                                            </p>
                                          </div>
                                        )}
                                        {links.map((link) => {
                                          const mediaUrl = resolveBackendMediaUrl(link);
                                          const gifLike = isGifLikeMedia(link, m.text);
                                          if (gifLike) {
                                            return (
                                              <div key={link} className="relative">
                                                <video
                                                  src={mediaUrl}
                                                  autoPlay
                                                  loop
                                                  muted
                                                  playsInline
                                                  controls
                                                  className="max-h-80 w-full rounded-lg"
                                                />
                                              </div>
                                            );
                                          }
                                          const mediaKind = mediaKindFromUrl(link);
                                          if (mediaKind === "sticker") {
                                            return (
                                              <div key={link} className="relative">
                                                {isAnimatedStickerUrl(link) ? (
                                                  <div className="rounded-lg bg-background/20 p-1">
                                                    <TgsSticker url={mediaUrl} className="h-40 w-40" />
                                                  </div>
                                                ) : (
                                                  <button
                                                    type="button"
                                                    onClick={(e) => {
                                                      if (selectionMode) {
                                                        e.preventDefault();
                                                        selectMessage(m.id);
                                                        return;
                                                      }
                                                      openMediaViewer(mediaUrl, "sticker");
                                                    }}
                                                    className="block"
                                                  >
                                                    <img
                                                      src={mediaUrl}
                                                      alt="Sticker"
                                                      className="max-h-64 w-auto rounded-lg object-contain"
                                                      onError={(e) => {
                                                        const el = e.currentTarget;
                                                        el.style.display = "none";
                                                      }}
                                                    />
                                                  </button>
                                                )}
                                              </div>
                                            );
                                          }
                                          if (mediaKind === "image") {
                                            return (
                                              <div key={link} className="relative">
                                                <button
                                                  type="button"
                                                  onClick={(e) => {
                                                    if (selectionMode) {
                                                      e.preventDefault();
                                                      selectMessage(m.id);
                                                      return;
                                                    }
                                                    openMediaViewer(mediaUrl, "image");
                                                  }}
                                                  className="block"
                                                >
                                                  <img
                                                    src={mediaUrl}
                                                    alt="Shared media"
                                                    className="max-h-80 w-full rounded-lg object-cover"
                                                  />
                                                </button>
                                              </div>
                                            );
                                          }
                                          if (mediaKind === "video") {
                                            return (
                                              <div key={link} className="relative">
                                                <button
                                                  type="button"
                                                  onClick={(e) => {
                                                    if (selectionMode) {
                                                      e.preventDefault();
                                                      selectMessage(m.id);
                                                      return;
                                                    }
                                                    openMediaViewer(mediaUrl, "video");
                                                  }}
                                                  className="block w-full"
                                                >
                                                  <video
                                                    src={mediaUrl}
                                                    muted
                                                    playsInline
                                                    className="max-h-80 w-full rounded-lg"
                                                  />
                                                </button>
                                              </div>
                                            );
                                          }
                                          if (mediaKind === "audio") {
                                            return (
                                              <div key={link} className="space-y-2">
                                                <audio src={mediaUrl} controls className="w-full" />
                                              </div>
                                            );
                                          }
                                          return (
                                            <div key={link} className="flex items-center gap-2">
                                              <FileText className="h-4 w-4" />
                                              <a
                                                href={mediaUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                className={`break-all text-xs underline ${m.from === "me" ? "text-white/90" : "text-primary"}`}
                                                onClick={(e) => {
                                                  if (selectionMode) {
                                                    e.preventDefault();
                                                    selectMessage(m.id);
                                                  }
                                                }}
                                              >
                                                Download file
                                              </a>
                                            </div>
                                          );
                                        })}
                                        {hasCaption && (
                                          <div className="px-1 pb-1">
                                            <span>{textWithoutUrls}</span>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  }
                                  if (kind === "emoji")
                                    return <p className="text-2xl leading-8">{m.text}</p>;
                                  return (
                                    <div className="space-y-1">
                                      {repliedMessage && (
                                        <div
                                          className={`rounded-md border-l-2 px-2 py-1 text-xs ${
                                            m.from === "me"
                                              ? "border-white/70 bg-white/15 text-white/90"
                                              : "border-primary/70 bg-primary/10 text-foreground"
                                          }`}
                                        >
                                          <p className="line-clamp-2">
                                            {repliedMessage.text || "(original message)"}
                                          </p>
                                        </div>
                                      )}
                                      {kind === "sticker" ? (
                                        <div className="flex items-center gap-2">
                                          <Sticker className="h-4 w-4" />
                                          <span>Sticker</span>
                                        </div>
                                      ) : kind === "image" ? (
                                        <div className="flex items-center gap-2">
                                          <ImageIcon className="h-4 w-4" />
                                          <span>Photo</span>
                                        </div>
                                      ) : kind === "video" ? (
                                        <div className="flex items-center gap-2">
                                          <Video className="h-4 w-4" />
                                          <span>{m.text}</span>
                                        </div>
                                      ) : kind === "audio" ? (
                                        <div className="flex items-center gap-2">
                                          <Music2 className="h-4 w-4" />
                                          <span>{m.text}</span>
                                        </div>
                                      ) : kind === "file" ? (
                                        <div className="flex items-center gap-2">
                                          <FileText className="h-4 w-4" />
                                          <span>{m.text}</span>
                                        </div>
                                      ) : (
                                        <span>{m.text}</span>
                                      )}
                                    </div>
                                  );
                                })()}
                                {m.createdAt && (
                                  <div
                                    className={`${isMediaBubble && (primaryMediaKind === "image" || primaryMediaKind === "video") ? "absolute bottom-2 right-2 rounded-md bg-black/45 px-1.5 py-0.5" : "mt-1 flex items-center justify-end"} flex items-center gap-1 text-[11px] ${m.from === "me" ? "text-white/85" : "text-muted-foreground"}`}
                                  >
                                    {m.editedAt && <span>(edited)</span>}
                                    <span>{jstTime(m.createdAt)}</span>
                                    {m.from === "me" && (
                                      <span className="inline-flex items-center">
                                        {m.peerRead ? (
                                          <CheckCheck className="h-3.5 w-3.5" />
                                        ) : (
                                          <Check className="h-3.5 w-3.5" />
                                        )}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </Fragment>
                      );
                    });
                  })()}
                </div>
              </div>

              <footer className="border-t border-border bg-background p-3">
                {replyToMessage && !editingMessage && (
                  <div className="mb-2 flex items-center justify-between rounded-md border border-border/70 bg-muted/40 px-3 py-1.5 text-xs">
                    <span className="truncate">
                      Replying to: {replyToMessage.text.slice(0, 120)}
                    </span>
                    <button type="button" onClick={() => setReplyToMessage(null)}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                {editingMessage && (
                  <div className="mb-2 flex items-center justify-between rounded-md border border-border/70 bg-muted/40 px-3 py-1.5 text-xs">
                    <span className="truncate">Editing message</span>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingMessage(null);
                        setDraft("");
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                {selectionMode && (
                  <div className="mb-2 flex items-center justify-between rounded-md border border-border/70 bg-muted/40 px-3 py-1.5 text-xs">
                    <span>{selectedMessageIds.length} selected</span>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        className="text-muted-foreground"
                        onClick={() => setSelectedMessageIds([])}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="text-destructive"
                        onClick={async () => {
                          const targets = selectedMessages.filter((m) =>
                            selectedMessageIds.includes(m.id),
                          );
                          for (const msg of targets) {
                            // eslint-disable-next-line no-await-in-loop
                            await deleteMessage(msg, true);
                          }
                          setSelectedMessageIds([]);
                        }}
                      >
                        Delete selected
                      </button>
                    </div>
                  </div>
                )}
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!selectedThread || !canSend || sending) return;
                    if (!draft.trim() && !selectedFile) return;
                    const text = draft.trim();
                    if (editingMessage) {
                      if (!editingMessage.externalMessageId) {
                        toast.error("Message cannot be edited");
                        return;
                      }
                      setSending(true);
                      try {
                        await api("/telegram/messages/edit", {
                          method: "POST",
                          body: JSON.stringify({
                            account_id: selectedThread.accountId,
                            chat_id: selectedThreadChatId,
                            peer: selectedThread.personName,
                            message_id: editingMessage.externalMessageId,
                            message_text: text,
                          }),
                        });
                        setNotifications((prev) =>
                          prev.map((n) =>
                            Number(n.id) === editingMessage.notificationId
                              ? {
                                  ...n,
                                  message: text,
                                  message_text: text,
                                  edited_at: new Date().toISOString(),
                                }
                              : n,
                          ),
                        );
                        setDraft("");
                        setEditingMessage(null);
                        toast.success("Message edited");
                      } catch (err: unknown) {
                        toast.error(errorMessage(err, "Failed to edit message"));
                        void refreshLinkedAccounts();
                      } finally {
                        setSending(false);
                      }
                      return;
                    }
                    const tempId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
                    setSending(true);
                    const sendText = text;
                    if (!selectedFile && text) {
                      setOutgoing((prev) => [
                        ...prev,
                        {
                          id: tempId,
                          threadId: selectedThread.id,
                          personName: selectedThread.personName,
                          chatName: selectedThread.chatName,
                          text: text,
                          createdAt: new Date().toISOString(),
                        },
                      ]);
                    }
                    setDraft("");
                    try {
                      if (selectedFile) {
                        const fd = new FormData();
                        fd.append("account_id", String(selectedThread.accountId));
                        if (selectedThreadChatId != null) fd.append("chat_id", String(selectedThreadChatId));
                        fd.append("peer", selectedThread.personName);
                        if (text) fd.append("caption", text);
                        fd.append("media", selectedFile);
                        await api("/telegram/messages/send-media", {
                          method: "POST",
                          body: fd,
                        });
                      } else {
                        await api("/telegram/messages/send", {
                          method: "POST",
                          body: JSON.stringify({
                            account_id: selectedThread.accountId,
                            chat_id: selectedThreadChatId,
                            peer: selectedThread.personName,
                            message_text: sendText,
                            reply_to_message_id: replyToMessage?.externalMessageId ?? null,
                          }),
                        });
                      }
                      setOutgoing((prev) => prev.filter((m) => m.id !== tempId));
                      setReplyToMessage(null);
                      setSelectedFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                      const data = await api<NotificationsResp>(
                        "/notifications?page=1&page_size=250&include_outgoing=true&for_chat=true",
                      );
                      setNotifications(data.items || []);
                    } catch (e: unknown) {
                      setOutgoing((prev) => prev.filter((m) => m.id !== tempId));
                      toast.error(errorMessage(e, "Failed to send message"));
                      void refreshLinkedAccounts();
                    } finally {
                      setSending(false);
                    }
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip className="h-4 w-4" />
                  </Button>
                  <Input
                    ref={draftInputRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={
                      canSend
                        ? `Message ${selectedThread.personName}...`
                        : "Reconnect this account to send messages"
                    }
                    className="rounded-full"
                    disabled={!canSend || sending}
                  />
                  <Button
                    type="submit"
                    disabled={(!draft.trim() && !selectedFile) || !canSend || sending}
                    className="rounded-full"
                  >
                    <SendHorizontal className="h-4 w-4" />
                  </Button>
                </form>
                {selectedFile && (
                  <div className="mt-2 flex items-center justify-between rounded-md border border-border/70 bg-muted/30 px-3 py-1.5 text-xs">
                    <span className="truncate">Attached: {selectedFile.name}</span>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setSelectedFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </footer>
            </div>
          )}
        </div>
      </div>
      {contextMenu &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed z-50 min-w-44 rounded-md border border-border bg-popover p-1 text-sm shadow-lg"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
              onClick={() => {
                setReplyToMessage(contextMenu.message);
                setEditingMessage(null);
                setContextMenu(null);
                window.setTimeout(() => draftInputRef.current?.focus(), 0);
              }}
            >
              <Reply className="h-4 w-4" /> Reply
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
              onClick={() => {
                void copyMessage(contextMenu.message);
                setContextMenu(null);
              }}
            >
              <Copy className="h-4 w-4" /> Copy
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
              onClick={() => {
                void pinMessage(contextMenu.message);
                setContextMenu(null);
              }}
            >
              <Pin className="h-4 w-4" /> Pin
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
              onClick={() => {
                downloadMessage(contextMenu.message);
                setContextMenu(null);
              }}
            >
              <Download className="h-4 w-4" /> Download
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
              onClick={() => {
                selectMessage(contextMenu.message.id);
                setContextMenu(null);
              }}
            >
              <SquareCheckBig className="h-4 w-4" /> Select
            </button>
            {contextMenu.message.from === "me" && (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
                onClick={() => {
                  beginEditMessage(contextMenu.message);
                  setContextMenu(null);
                }}
              >
                <Pencil className="h-4 w-4" /> Edit
              </button>
            )}
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-destructive hover:bg-accent"
              onClick={() => {
                setDeleteDialog({
                  message: contextMenu.message,
                  alsoDeleteForPeer: true,
                });
                setContextMenu(null);
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          </div>,
          document.body,
        )}
      {threadListMenu &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed z-50 min-w-44 rounded-md border border-border bg-popover p-1 text-sm shadow-lg"
            style={{ left: threadListMenu.x, top: threadListMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
              onClick={() => {
                const t = threadListMenu.thread;
                setThreadListMenu(null);
                toggleMuteThread(t);
              }}
            >
              {mutedThreadIds.includes(threadListMenu.thread.id) ? (
                <>
                  <Volume2 className="h-4 w-4" /> Unmute
                </>
              ) : (
                <>
                  <VolumeX className="h-4 w-4" /> Mute
                </>
              )}
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
              onClick={() => {
                const t = threadListMenu.thread;
                setThreadListMenu(null);
                if (pinnedThreadOrder.includes(t.id)) unpinThreadFromTop(t);
                else pinThreadToTop(t);
              }}
            >
              <Pin className="h-4 w-4" />{" "}
              {pinnedThreadOrder.includes(threadListMenu.thread.id)
                ? "Unpin from top"
                : "Pin to top"}
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-destructive hover:bg-accent"
              onClick={() => {
                const t = threadListMenu.thread;
                setThreadListMenu(null);
                deleteChatThread(t);
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete chat
            </button>
          </div>,
          document.body,
        )}
      {deleteDialog &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-sm rounded-xl border border-border bg-card p-4 shadow-xl">
              <p className="text-base font-medium">Do you want to delete this message?</p>
              {sender?.type === "telegram" && deleteDialog.message.externalMessageId != null && (
                <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={deleteDialog.alsoDeleteForPeer}
                    onChange={(e) =>
                      setDeleteDialog((prev) =>
                        prev
                          ? { ...prev, alsoDeleteForPeer: e.target.checked }
                          : prev,
                      )
                    }
                  />
                  <span>Also delete for {selectedThread?.personName || "recipient"}?</span>
                </label>
              )}
              <div className="mt-5 flex items-center justify-end gap-4">
                <button
                  type="button"
                  className="text-muted-foreground"
                  onClick={() => setDeleteDialog(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="font-semibold text-cyan-600"
                  onClick={async () => {
                    const pending = deleteDialog;
                    setDeleteDialog(null);
                    await deleteMessage(
                      pending.message,
                      sender?.type === "telegram" && pending.message.externalMessageId != null
                        ? pending.alsoDeleteForPeer
                        : true,
                    );
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </section>
  );
}
