"use client";

import { useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Daily from "@daily-co/daily-js";
import type { DailyCall, DailyParticipant } from "@daily-co/daily-js";
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  PhoneOff,
  RefreshCw,
  BadgeCheck,
  Stamp,
  UserPen,
  FileSearch,
  Loader2,
  CircleAlert,
  PenLine,
  PartyPopper,
  X,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { useToast } from "@/components/ui/toast-provider";
import { MY_NOTARY_LOGO_SRC } from "@/lib/brand";
import { playRoomOpenChime } from "@/lib/room-open-chime";
import { broadcastSigningFlowStarted } from "@/lib/broadcast-signing-flow";

interface Signer {
  id: string;
  name: string;
  order: number;
  kyc_status: string;
  signed_at: string | null;
}

interface CallItem {
  id: string;
  participant: DailyParticipant;
  videoTrack: MediaStreamTrack | undefined;
  audioTrack: MediaStreamTrack | undefined;
}

function VideoTile({
  id,
  videoTrack,
  audioTrack,
  userName,
  isLocal,
  role,
}: {
  id: string;
  videoTrack: MediaStreamTrack | undefined;
  audioTrack: MediaStreamTrack | undefined;
  userName: string;
  isLocal: boolean;
  role: "notary" | "signer";
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (videoRef.current && videoTrack) {
      videoRef.current.srcObject = new MediaStream([videoTrack]);
    }
    return () => {
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [videoTrack]);

  useEffect(() => {
    if (audioRef.current && audioTrack && !isLocal) {
      audioRef.current.srcObject = new MediaStream([audioTrack]);
    }
    return () => {
      if (audioRef.current) audioRef.current.srcObject = null;
    };
  }, [audioTrack, isLocal]);

  const displayName = userName?.trim() || "Participant";
  return (
    <div className="relative h-full w-full min-h-0 max-h-full bg-muted rounded-lg overflow-hidden">
      {videoTrack ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <div className="w-16 h-16 rounded-full bg-muted-foreground/20 flex items-center justify-center">
            <span className="text-2xl font-semibold">
              {displayName?.charAt(0)?.toUpperCase() || "?"}
            </span>
          </div>
          <span className="text-sm">{displayName}</span>
          <span className="text-xs">Camera off</span>
        </div>
      )}
      {audioTrack && !isLocal && <audio ref={audioRef} autoPlay playsInline />}
      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2">
        <span className="rounded-md border border-white/20 bg-black/80 px-2 py-1 text-[11px] font-medium text-white shadow">
          {displayName}
          {isLocal && " • You"}
        </span>
        <span
          className={`rounded-md px-2 py-1 text-[11px] font-semibold shadow shrink-0 ${
            role === "notary" ? "bg-blue-600/95 text-white" : "bg-amber-500/95 text-black"
          }`}
        >
          {role === "notary" ? "Notary" : "Signer"}
        </span>
      </div>
    </div>
  );
}

interface DocumentItem {
  id: string;
  label: string;
  url: string;
  status: "available" | "pending";
  source?: "session" | "veriff" | "submission";
}

interface AuditEvent {
  id: string;
  event_type: string;
  actor_type: string | null;
  actor_name: string | null;
  actor_email: string | null;
  document_label: string | null;
  metadata: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

type SignerStatusVariant =
  | "completed"
  /** Toutes les signatures sont faites, mais le notaire n'a pas encore clôturé la session */
  | "signatures-done"
  | "wait-notary"
  | "wait-signer"
  | "idle"
  | "loading-yousign"
  | "error-yousign";

const STATUS_ICON_CLASS = "h-[4.5rem] w-[4.5rem] shrink-0 opacity-90";

function SignerStatusGlyph({ variant }: { variant: SignerStatusVariant }) {
  switch (variant) {
    case "completed":
      return <PartyPopper className={STATUS_ICON_CLASS} aria-hidden />;
    case "signatures-done":
      return <BadgeCheck className={STATUS_ICON_CLASS} aria-hidden />;
    case "wait-notary":
      return <Stamp className={STATUS_ICON_CLASS} aria-hidden />;
    case "wait-signer":
      return <UserPen className={STATUS_ICON_CLASS} aria-hidden />;
    case "idle":
      return <FileSearch className={STATUS_ICON_CLASS} aria-hidden />;
    case "loading-yousign":
      return <Loader2 className={`${STATUS_ICON_CLASS} animate-spin`} aria-hidden />;
    case "error-yousign":
    default:
      return <CircleAlert className={STATUS_ICON_CLASS} aria-hidden />;
  }
}

function SignerWorkflowStatusPanel({
  variant,
  title,
  description,
  onRefresh,
  children,
}: {
  variant: SignerStatusVariant;
  title: string;
  description: string;
  onRefresh: () => void;
  children?: ReactNode;
}) {
  const tone =
    variant === "completed"
      ? "text-emerald-600"
      : variant === "signatures-done"
        ? "text-teal-600"
        : variant === "error-yousign"
          ? "text-destructive"
          : variant === "loading-yousign"
            ? "text-primary"
            : variant === "wait-notary" || variant === "wait-signer"
              ? "text-amber-600"
              : "text-muted-foreground";

  return (
    <div className="flex flex-col h-full min-h-[420px]">
      <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8 text-center">
        <div
          className={`rounded-2xl border bg-card p-8 shadow-sm max-w-md w-full flex flex-col items-center gap-4 ${tone}`}
        >
          <SignerStatusGlyph variant={variant} />
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-foreground">{title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
          </div>
          {children ? <div className="pt-2 w-full flex justify-center">{children}</div> : null}
        </div>
      </div>
      <div className="flex-shrink-0 flex items-center justify-center gap-2 border-t py-3 px-4 bg-muted/30">
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" title="Refresh status" onClick={onRefresh}>
          <RefreshCw className="h-4 w-4" />
        </Button>
        <span className="text-xs text-muted-foreground">Refresh status</span>
      </div>
    </div>
  );
}

function playNotificationSound() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const playNote = (freq: number, t: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.25, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.start(t);
      osc.stop(t + dur);
    };
    const now = ctx.currentTime;
    playNote(880,  now,        0.3);
    playNote(1047, now + 0.15, 0.3);
    playNote(1319, now + 0.3,  0.5);
  } catch { /* Audio non disponible */ }
}

const AUDIT_LABELS: Record<string, string> = {
  session_created: "Session created",
  session_started: "Session started",
  session_completed: "Session completed",
  session_cancelled: "Session cancelled",
  kyc_started: "KYC started",
  kyc_approved: "KYC approved",
  kyc_declined: "KYC declined",
  kyc_resubmission_requested: "KYC — resubmission requested",
  video_room_created: "Video room created",
  video_joined: "Joined video",
  video_left: "Left video",
  video_recording_started: "Recording started",
  video_recording_stopped: "Recording stopped",
  signing_flow_started: "Signing flow started",
  signing_flow_advanced: "Signing step advanced",
  signer_invited: "Signer invited",
  signer_signed: "Signer signed (YouSign)",
  signer_signed_inapp: "Signer signed (in-app)",
  notary_invited: "Notary invited",
  notary_joined: "Notary joined",
  notary_signed: "Notary signed",
  document_completed: "Document completed",
  yousign_request_created: "YouSign request created",
  yousign_embed_opened: "YouSign embed opened",
  signing_error: "Signing error",
  kyc_error: "KYC error",
};

function AuditTimeline({ events }: { events: AuditEvent[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLLIElement>(null);
  const prevCountRef = useRef(0);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (events.length > prevCountRef.current) {
      const incoming = events.slice(prevCountRef.current).map((e) => e.id);
      setNewIds(new Set(incoming));
      const t = setTimeout(() => setNewIds(new Set()), 700);
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      prevCountRef.current = events.length;
      return () => clearTimeout(t);
    }
    prevCountRef.current = events.length;
  }, [events]);

  const lastId = events[events.length - 1]?.id ?? null;

  return (
    <>
      <style>{`
        @keyframes audit-in {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .audit-new { animation: audit-in 0.4s cubic-bezier(.22,.61,.36,1) both; }
        .audit-scroll::-webkit-scrollbar { display: none; }
        .audit-scroll { scrollbar-width: none; -ms-overflow-style: none; }
      `}</style>

      <Card className="bg-white border-gray-200">
        <CardHeader className="py-3 pb-0 shrink-0">
          <h2 className="text-base font-semibold tracking-tight">Audit trail</h2>
        </CardHeader>
        <div className="relative">
          <div
            ref={scrollRef}
            className="audit-scroll overflow-y-auto px-4 pt-3 pb-10"
            style={{ maxHeight: "300px" }}
          >
            {events.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No events recorded.</p>
            ) : (
              <ol className="relative ml-[7px]">
                <span className="absolute left-0 top-[6px] bottom-0 w-px bg-border" aria-hidden />
                {events.map((event, i) => {
                  const isLast = event.id === lastId;
                  const isNew = newIds.has(event.id);
                  const isPast = !isLast;
                  const isLastItem = i === events.length - 1;
                  return (
                    <li
                      key={event.id}
                      ref={isLastItem ? bottomRef : undefined}
                      className={`relative pl-5 pb-4 last:pb-2 ${isNew ? "audit-new" : ""}`}
                    >
                      {isLast ? (
                        <span className="absolute left-[-5px] top-[3px] flex h-[11px] w-[11px]">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                          <span className="relative inline-flex h-[11px] w-[11px] rounded-full bg-emerald-500 ring-2 ring-emerald-200" />
                        </span>
                      ) : (
                        <span className={`absolute left-[-5px] top-[3px] h-[11px] w-[11px] rounded-full ring-2 ${isPast ? "bg-muted-foreground/30 ring-muted/40" : "bg-gray-300 ring-gray-100"}`} />
                      )}
                      <time className={`block text-[10px] tabular-nums mb-0.5 leading-none ${isPast ? "text-muted-foreground/50" : "text-muted-foreground"}`}>
                        {new Date(event.created_at).toLocaleString("en-US", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </time>
                      <p className={`text-xs font-semibold leading-snug ${isPast ? "text-muted-foreground/70" : "text-foreground"}`}>
                        {AUDIT_LABELS[event.event_type] ?? event.event_type}
                      </p>
                      {(event.actor_name || event.actor_email) && (
                        <p className="text-[11px] text-muted-foreground/60 truncate mt-0.5">
                          {event.actor_name ?? ""}{event.actor_name && event.actor_email ? " · " : ""}{event.actor_email ?? ""}
                        </p>
                      )}
                      {event.document_label && (
                        <p className="text-[11px] text-muted-foreground/50 italic truncate">{event.document_label.replace(/\.[^/.]+$/, "")}</p>
                      )}
                      {event.ip_address && (
                        <p className="text-[10px] font-mono text-muted-foreground/40 truncate mt-0.5">{event.ip_address}</p>
                      )}
                      {event.user_agent && (
                        <p className="text-[10px] text-muted-foreground/30 truncate" title={event.user_agent}>
                          {event.user_agent.slice(0, 55)}{event.user_agent.length > 55 ? "…" : ""}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
          {events.length > 0 && (
            <div
              className="pointer-events-none absolute bottom-0 left-0 right-0 h-12 rounded-b-xl"
              style={{ background: "linear-gradient(to bottom, transparent, hsl(var(--card)) 90%)" }}
            />
          )}
        </div>
      </Card>
    </>
  );
}

// ─── Placement Picker ────────────────────────────────────────────────────────

type SignaturePlacement = { page: number; x: number; y: number; width: number; height: number };

const PLACEMENT_SIG_W = 200;
const PLACEMENT_SIG_H = 100;

function PlacementPicker({
  documentUrl,
  signerLabel = "Votre signature",
  onConfirm,
  onCancel,
}: {
  documentUrl: string | null;
  signerLabel?: string;
  onConfirm: (p: SignaturePlacement) => void;
  onCancel: () => void;
}) {
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [hoverPx, setHoverPx] = useState<{ x: number; y: number } | null>(null);
  const [placedPx, setPlacedPx] = useState<{ x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfDimsRef = useRef<{ width: number; height: number }>({ width: 595, height: 842 });
  const renderScaleRef = useRef(1);
  const [isRendering, setIsRendering] = useState(false);

  useEffect(() => {
    if (!documentUrl) return;
    let cancelled = false;
    setIsRendering(true);
    setHoverPx(null);
    setPlacedPx(null);

    (async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

        const pdf = await pdfjsLib.getDocument({ url: documentUrl, isEvalSupported: false }).promise;
        if (cancelled) return;
        setTotalPages(pdf.numPages);

        const pdfPage = await pdf.getPage(Math.min(page, pdf.numPages));
        if (cancelled) return;

        const viewport1 = pdfPage.getViewport({ scale: 1 });
        pdfDimsRef.current = { width: viewport1.width, height: viewport1.height };

        const containerW = containerRef.current?.offsetWidth ?? 600;
        const scale = containerW / viewport1.width;
        renderScaleRef.current = scale;

        const viewport = pdfPage.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);

        await pdfPage.render({ canvasContext: ctx, viewport }).promise;
        if (!cancelled) setIsRendering(false);
      } catch (err) {
        console.error("[PlacementPicker] PDF render error:", err);
        if (!cancelled) setIsRendering(false);
      }
    })();

    return () => { cancelled = true; };
  }, [documentUrl, page]);

  // Coordonnées canvas → points YouSign (origine haut-gauche, y vers le bas)
  const canvasToPdf = (cx: number, cy: number) => {
    const scale = renderScaleRef.current;
    return {
      x: cx / scale,
      y: cy / scale, // YouSign v3 : y depuis le HAUT (pas d'inversion)
    };
  };

  const getCanvasPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(e.clientX - rect.left, rect.width)),
      y: Math.max(0, Math.min(e.clientY - rect.top, rect.height)),
    };
  };

  const sigBoxStyle = (cx: number, cy: number) => {
    const scale = renderScaleRef.current;
    const w = PLACEMENT_SIG_W * scale;
    const h = PLACEMENT_SIG_H * scale;
    const dims = pdfDimsRef.current;
    const maxX = dims.width * scale;
    const maxY = dims.height * scale;
    return {
      left: Math.max(0, Math.min(cx - w / 2, maxX - w)),
      top:  Math.max(0, Math.min(cy - h / 2, maxY - h)),
      width: w,
      height: h,
    };
  };

  const handleConfirm = () => {
    if (!placedPx) return;
    const { x: pdfX, y: pdfY } = canvasToPdf(placedPx.x, placedPx.y);
    const dims = pdfDimsRef.current;
    const x = Math.round(Math.max(0, Math.min(pdfX - PLACEMENT_SIG_W / 2, dims.width  - PLACEMENT_SIG_W)));
    const y = Math.round(Math.max(0, Math.min(pdfY - PLACEMENT_SIG_H / 2, dims.height - PLACEMENT_SIG_H)));
    onConfirm({ page, x, y, width: PLACEMENT_SIG_W, height: PLACEMENT_SIG_H });
  };

  const changePage = (delta: number) => {
    setPage(p => Math.max(1, Math.min(totalPages, p + delta)));
    setPlacedPx(null);
    setHoverPx(null);
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-2xl flex flex-col gap-3 p-5 w-full max-w-2xl max-h-[90vh]">
        <div className="flex items-center justify-between shrink-0">
          <h2 className="text-lg font-bold">Place your signature</h2>
          <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-muted-foreground shrink-0">
          {documentUrl
            ? "Click on the document to choose where your signature goes."
            : "Preview unavailable — you can still confirm placement."}
          {placedPx ? " Click again to reposition." : ""}
        </p>

        <div className="flex items-center gap-2 text-sm shrink-0">
          <span className="font-medium">Page:</span>
          <button onClick={() => changePage(-1)} disabled={page <= 1}
            className="p-1 rounded border hover:bg-muted disabled:opacity-40 transition-colors">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="w-10 text-center font-semibold">{page} / {totalPages}</span>
          <button onClick={() => changePage(1)} disabled={page >= totalPages}
            className="p-1 rounded border hover:bg-muted disabled:opacity-40 transition-colors">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div ref={containerRef} className="flex-1 overflow-y-auto overflow-x-hidden rounded-lg border bg-muted/10 min-h-0">
          {isRendering && (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}
          <div className="relative inline-block w-full">
            <canvas
              ref={canvasRef}
              className={`block w-full cursor-crosshair ${isRendering ? "invisible" : ""}`}
              onMouseMove={(e) => setHoverPx(getCanvasPos(e))}
              onMouseLeave={() => setHoverPx(null)}
              onClick={(e) => setPlacedPx(getCanvasPos(e))}
            />
            {hoverPx && !placedPx && !isRendering && (
              <div className="absolute border-2 border-dashed border-blue-500 bg-blue-100/40 rounded flex items-center justify-center pointer-events-none"
                style={{ position: "absolute", ...sigBoxStyle(hoverPx.x, hoverPx.y) }}>
                <span className="text-[10px] font-semibold text-blue-700 whitespace-nowrap px-1">✍ {signerLabel}</span>
              </div>
            )}
            {placedPx && !isRendering && (
              <div className="absolute border-2 border-green-600 bg-green-100/70 rounded flex items-center justify-center pointer-events-none shadow-sm"
                style={{ position: "absolute", ...sigBoxStyle(placedPx.x, placedPx.y) }}>
                <span className="text-[10px] font-semibold text-green-800 whitespace-nowrap px-1">✍ {signerLabel}</span>
              </div>
            )}
            {!documentUrl && !isRendering && (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
                Preview unavailable
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3 justify-end pt-1 shrink-0">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={!placedPx || isRendering}>
            Confirm and sign →
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface SigningStateResponse {
  sessionStatus?: string;
  signingFlowStatus?: string;
  currentDocument?: {
    id: string;
    label: string;
    document_order: number;
    status: string;
    source_url?: string | null;
  } | null;
  documents?: Array<{
    id: string;
    label: string;
    document_order: number;
    status: string;
  }>;
  expectedActor?: {
    role: "signer" | "notary";
    sessionSignerId?: string | null;
    signerName?: string | null;
    notaryId?: string | null;
  } | null;
  signatures?: Array<{
    id: string;
    role: "signer" | "notary";
    session_signer_id?: string | null;
    signed_at?: string | null;
    signerName?: string | null;
  }>;
}

export function RoomClient({
  sessionId,
  isNotary,
  signerId,
  status,
  dailyRoomUrl,
  documentUrl,
  stampedDocumentUrl,
  signedDocumentUrl,
  signers,
  token,
  initialDocuments,
}: {
  sessionId: string;
  isNotary: boolean;
  signerId: string;
  status: string;
  dailyRoomUrl: string | null;
  documentUrl: string | null;
  stampedDocumentUrl?: string | null;
  signedDocumentUrl?: string | null;
  signers: Signer[];
  token: string;
  initialDocuments?: DocumentItem[];
}) {
  const baseDocs: DocumentItem[] = [
    { id: "session-document", label: "Document to notarize", url: documentUrl ?? "", status: documentUrl ? "available" : "pending" },
    { id: "session-stamped", label: "Stamped document", url: stampedDocumentUrl ?? "", status: stampedDocumentUrl ? "available" : "pending" },
    { id: "session-signed", label: "Signed document", url: signedDocumentUrl ?? "", status: signedDocumentUrl ? "available" : "pending" },
  ];
  const fallbackDocs: DocumentItem[] = initialDocuments?.length ? initialDocuments : baseDocs;

  const [documents, setDocuments] = useState<DocumentItem[]>(fallbackDocs);
  const [signerRows, setSignerRows] = useState<Signer[]>(signers);
  const router = useRouter();
  const toast = useToast();
  const callRef = useRef<DailyCall | null>(null);
  const joinChimePlayedRef = useRef(false);
  const [currentStatus, setCurrentStatus] = useState(status);
  const [liveRoomUrl, setLiveRoomUrl] = useState<string | null>(dailyRoomUrl);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isAudioOn, setIsAudioOn] = useState(true);
  const [isInCall, setIsInCall] = useState(false);
  const [callItems, setCallItems] = useState<CallItem[]>([]);
  const [waitingMessage, setWaitingMessage] = useState<string | null>(null);
  const [workflowLabel, setWorkflowLabel] = useState<string | null>(null);
  const [expectedActorText, setExpectedActorText] = useState<string | null>(null);
  const [currentDocumentId, setCurrentDocumentId] = useState<string | null>(null);
  const [currentDocumentName, setCurrentDocumentName] = useState<string | null>(null);
  const [currentDocumentUrl, setCurrentDocumentUrl] = useState<string | null>(null);
  const [yousignEmbedUrl, setYousignEmbedUrl] = useState<string | null>(null);
  const [yousignLoading, setYousignLoading] = useState(false);
  const [yousignError, setYousignError] = useState<string | null>(null);
  const [rateLimitRetryIn, setRateLimitRetryIn] = useState<number>(0);
  const rateLimitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isMyTurnToSign, setIsMyTurnToSign] = useState(false);
  const [signingFlowStatus, setSigningFlowStatus] = useState<string | null>(null);
  const [expectedActorRole, setExpectedActorRole] = useState<"signer" | "notary" | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [workflowDocs, setWorkflowDocs] = useState<Array<{ id: string; label: string; document_order: number; status: string }>>([]);
  const [placementConfirmed, setPlacementConfirmed] = useState<SignaturePlacement | null>(null);
  const [showPlacementPicker, setShowPlacementPicker] = useState(false);
  const [startingSigning, setStartingSigning] = useState(false);
  // Vrai si le signataire a repositionné → forcer reset YouSign au prochain appel
  const resetOnNextYousignCallRef = useRef(false);
  const prevSignersRef = useRef<Signer[]>(signers);
  const prevFlowStatusRef = useRef<string | null>(null);
  const prevSessionStatusRef = useRef<string | null>(null);
  const prevDocumentIdRef = useRef<string | null>(null);
  const syncSigningStateRef = useRef<() => Promise<void>>(() => Promise.resolve());
  // Debounce des callbacks Supabase pour éviter la boucle de feedback
  const realtimeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateParticipants = useCallback((call: DailyCall) => {
    const participants = call.participants();
    const items: CallItem[] = [];
    const seenRemote = new Set<string>();
    const localUserName = (call.participants().local as DailyParticipant | undefined)?.user_name ?? "";
    for (const [id, participant] of Object.entries(participants)) {
      const userName = participant.user_name ?? "";
      if (userName === "Recording" || userName === "Enregistrement") continue;
      // Exclure les fantômes : participant distant avec le même nom que le local (reconnexion)
      if (!participant.local && userName && localUserName && userName.trim() === localUserName.trim()) continue;
      if (!participant.local) {
        const key = (userName || id).trim().toLowerCase();
        if (seenRemote.has(key)) continue;
        seenRemote.add(key);
      }
      const videoTrack = participant.tracks.video?.track ?? participant.tracks.video?.persistentTrack;
      const audioTrack = participant.tracks.audio?.persistentTrack;
      items.push({
        id,
        participant,
        videoTrack,
        audioTrack,
      });
    }
    setCallItems(items);
  }, []);

  useEffect(() => {
    fetch(`/api/session/${sessionId}/documents`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.documents?.length) {
          setDocuments(data.documents);
        }
      })
      .catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const triggerSync = () => {
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
      // Debounce minimal : évite les appels en rafale si plusieurs colonnes changent
      // simultanément sur le même row, mais reste quasi-instantané.
      realtimeDebounceRef.current = setTimeout(() => syncSigningStateRef.current(), 50);
    };

    const setup = async () => {
      // Récupérer les IDs des documents de la session pour filtrer session_document_signatures.
      // Supabase Realtime n'accepte pas les sous-requêtes dans les filtres → on passe les IDs en dur.
      const { data: docs } = await supabase
        .from("session_documents")
        .select("id")
        .eq("session_id", sessionId);
      const docIds = (docs ?? []).map((d: { id: string }) => d.id);

      channel = supabase.channel(`session-room-${sessionId}`);

      channel.on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notarization_sessions",
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          const newData = payload.new as { status: string; daily_room_url?: string | null; signing_flow_status?: string };
          setCurrentStatus(newData.status);
          if (newData.daily_room_url) {
            setLiveRoomUrl((prev) => {
              if (!prev && newData.daily_room_url) {
                playNotificationSound();
                toast.info("The notary has joined the session", {
                  description: "Video will start shortly",
                  duration: 6000,
                });
              }
              return newData.daily_room_url ?? prev;
            });
          }
          // Déclencher un sync lorsque le workflow avance (changement de signing_flow_status ou status).
          // La boucle est évitée car advanceSigningWorkflow ne réécrit que si les valeurs changent réellement.
          triggerSync();
        }
      );

      // Écouter les signatures via les IDs de documents récupérés (filtre valide pour Realtime).
      for (const docId of docIds) {
        channel.on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "session_document_signatures",
            filter: `session_document_id=eq.${docId}`,
          },
          triggerSync
        );
      }

      // Instant when notary clicks "Start signing" (Broadcast bypasses postgres realtime / RLS delays).
      channel.on("broadcast", { event: "signing_flow_started" }, () => {
        syncSigningStateRef.current();
      });

      channel.subscribe();
    };

    setup();

    return () => {
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
      if (channel) supabase.removeChannel(channel);
    };
  }, [sessionId]);

  // La page « terminée » uniquement après clôture explicite par le notaire (status DB = completed).
  // signing_flow_status === "completed" signifie seulement « plus de document à signer », pas fin de session.
  useEffect(() => {
    if (currentStatus === "completed") {
      router.push(`/session/${sessionId}/completed?token=${token}`);
    }
  }, [currentStatus, sessionId, token, router]);

  // Quand le document courant change → réinitialiser tout l'état YouSign + placement
  useEffect(() => {
    if (
      currentDocumentId !== null &&
      prevDocumentIdRef.current !== null &&
      prevDocumentIdRef.current !== currentDocumentId
    ) {
      setYousignEmbedUrl(null);
      setYousignError(null);
      setYousignLoading(false);
      setPlacementConfirmed(null);
      setShowPlacementPicker(false);
    }
    prevDocumentIdRef.current = currentDocumentId;
  }, [currentDocumentId]);

  // Ouvrir le placement seulement quand le notaire a démarré le flux (pas en idle)
  useEffect(() => {
    if (
      isMyTurnToSign &&
      signingFlowStatus &&
      signingFlowStatus !== "idle" &&
      !yousignEmbedUrl &&
      !placementConfirmed &&
      !showPlacementPicker
    ) {
      setShowPlacementPicker(true);
    }
  }, [
    isMyTurnToSign,
    signingFlowStatus,
    yousignEmbedUrl,
    placementConfirmed,
    showPlacementPicker,
  ]);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const syncSigningState = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await fetch(
          `/api/session/${sessionId}/signing-state?token=${encodeURIComponent(token)}`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const payload = (await res.json()) as SigningStateResponse;
        if (cancelled) return;
        if (payload.sessionStatus) setCurrentStatus(payload.sessionStatus);
        setCurrentDocumentId(payload.currentDocument?.id ?? null);
        setCurrentDocumentName(payload.currentDocument?.label ?? null);
        setCurrentDocumentUrl(payload.currentDocument?.source_url ?? null);
        if (payload.documents?.length) {
          setWorkflowDocs(
            [...payload.documents].sort((a, b) => a.document_order - b.document_order)
          );
        }
        setWorkflowLabel(
          payload.currentDocument
            ? `Document ${payload.currentDocument.document_order + 1}: ${payload.currentDocument.label}`
            : null
        );
        if (payload.signingFlowStatus) {
          setSigningFlowStatus(payload.signingFlowStatus);
        }
        if (payload.signingFlowStatus === "idle") {
          setExpectedActorRole(null);
          setIsMyTurnToSign(false);
          setExpectedActorText(
            isNotary
              ? "Start signing when you have explained the documents. Nothing is recorded until you click below."
              : "The notary must start the signing flow from their room and explain what you are signing — e-signing stays disabled until then."
          );
        } else if (payload.expectedActor?.role === "signer") {
          setExpectedActorRole("signer");
          if (payload.expectedActor.sessionSignerId === signerId) {
            setIsMyTurnToSign(true);
            setExpectedActorText("It's your turn to sign.");
          } else {
            setIsMyTurnToSign(false);
            setExpectedActorText(
              payload.expectedActor.signerName
                ? `Waiting for ${payload.expectedActor.signerName} to sign.`
                : "Waiting for another signer to sign."
            );
          }
        } else if (payload.expectedActor?.role === "notary") {
          setExpectedActorRole("notary");
          setIsMyTurnToSign(false);
          setExpectedActorText("Waiting for the notary to sign and stamp.");
        } else {
          setExpectedActorRole(null);
          setIsMyTurnToSign(false);
          if (payload.sessionStatus === "completed") {
            setExpectedActorText("The notary has closed the session. Thank you for participating.");
          } else if (payload.signingFlowStatus === "completed") {
            setExpectedActorText(
              "All documents are signed. Stay on the video call — only the notary can end the session."
            );
          } else {
            setExpectedActorText(
              "No signature is required from you right now. Follow the notary’s instructions."
            );
          }
        }

        // Toasts sur les nouvelles signatures
        if (payload.signatures?.length) {
          const prev = prevSignersRef.current as unknown as Array<{ id: string; signed_at?: string | null }>;
          for (const sig of payload.signatures) {
            if (!sig.signed_at) continue;
            const prevSig = prev.find((s) => s.id === sig.id);
            if (!prevSig || prevSig.signed_at) continue; // déjà signé ou inconnu
            if (sig.role === "notary") {
              toast.success("The notary has signed", { duration: 6000 });
            } else if (sig.session_signer_id === signerId) {
              toast.success("You have signed successfully!", { duration: 5000 });
            } else if (sig.signerName) {
              toast.success(`${sig.signerName} signed`, { duration: 5000 });
            }
          }
          prevSignersRef.current = payload.signatures as unknown as Signer[];
        }
        // Toasts : ne confond pas « flux de signature terminé » et « session clôturée par le notaire ».
        const prevFlow = prevFlowStatusRef.current;
        if (payload.signingFlowStatus === "completed" && prevFlow && prevFlow !== "completed") {
          if (payload.sessionStatus === "completed") {
            toast.success("Session ended", {
              description: "The notary has closed the session.",
              duration: 8000,
            });
          } else {
            toast.info("All signatures complete", {
              description: "Waiting for the notary to close the session. Do not leave the call.",
              duration: 10000,
            });
          }
        }
        if (payload.signingFlowStatus) prevFlowStatusRef.current = payload.signingFlowStatus;

        const prevSess = prevSessionStatusRef.current;
        if (
          payload.sessionStatus === "completed" &&
          prevSess != null &&
          prevSess !== "completed"
        ) {
          const flowJustCompletedThisPoll =
            payload.signingFlowStatus === "completed" && prevFlow != null && prevFlow !== "completed";
          if (!flowJustCompletedThisPoll) {
            toast.success("Session ended", {
              description: "The notary has closed the session.",
              duration: 8000,
            });
          }
        }
        if (payload.sessionStatus) prevSessionStatusRef.current = payload.sessionStatus;

        // Mettre à jour signerRows (signed_at) depuis les signatures
        if (payload.signatures?.length) {
          setSignerRows((prev) =>
            prev.map((s) => {
              const sig = payload.signatures!.find(
                (x: { session_signer_id?: string | null; role: string }) =>
                  x.role === "signer" && x.session_signer_id === s.id
              );
              return sig?.signed_at ? { ...s, signed_at: sig.signed_at } : s;
            })
          );
        }

      } catch {
        // Ignore transient polling errors
      } finally {
        inFlight = false;
      }
    };

    const fetchAudit = async () => {
      if (cancelled) return;
      try {
        const auditRes = await fetch(
          `/api/session/${sessionId}/audit?token=${encodeURIComponent(token)}`,
          { cache: "no-store" }
        );
        if (auditRes.ok) {
          const auditPayload = await auditRes.json() as { events?: AuditEvent[] };
          if (!cancelled && auditPayload.events) setAuditEvents(auditPayload.events);
        }
      } catch { /* silencieux */ }
    };

    syncSigningStateRef.current = syncSigningState;
    syncSigningState();
    fetchAudit();

    // Fast poll while waiting for notary to start; slower once the flow is active (realtime + broadcast handle most updates).
    const pollMs =
      signingFlowStatus === "idle" || signingFlowStatus === null ? 2500 : 30000;
    const interval = setInterval(syncSigningState, pollMs);
    // Audit trail rafraîchi toutes les 60s (faible priorité)
    const auditInterval = setInterval(fetchAudit, 60000);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        syncSigningStateRef.current();
        fetchAudit();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      clearInterval(interval);
      clearInterval(auditInterval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [sessionId, signerId, token, isNotary, signingFlowStatus]);

  useEffect(() => {
    // Attendre que le signataire ait positionné sa signature avant de charger YouSign
    if (!isMyTurnToSign || !signerId || !placementConfirmed) return;

    let cancelled = false;
    const loadYousignEmbed = async () => {
      setYousignLoading(true);
      setYousignError(null);
      try {
        const params = new URLSearchParams({
          token,
          signerId,
          page: String(placementConfirmed.page),
          x: String(placementConfirmed.x),
          y: String(placementConfirmed.y),
          width: String(placementConfirmed.width),
          height: String(placementConfirmed.height),
        });
        // Si repositionnement : passer reset=true UNE seule fois
        if (resetOnNextYousignCallRef.current) {
          params.set("reset", "true");
          resetOnNextYousignCallRef.current = false;
        }
        const res = await fetch(
          `/api/session/${sessionId}/yousign-embed?${params}`,
          { cache: "no-store" }
        );
        const payload = (await res.json()) as {
          embedUrl?: string;
          signingUrl?: string;
          error?: string;
          message?: string;
          signed?: boolean;
          waiting?: boolean;
          completed?: boolean;
        };

        if (cancelled) return;

        if (res.ok && (payload.embedUrl || payload.signingUrl)) {
          const url = payload.embedUrl || payload.signingUrl || null;
          // prev || url : une fois l'URL obtenue, on ne la remplace pas à chaque poll
          // pour éviter que l'iframe ne recharge (le reset sur changement de document
          // est géré par l'effet dédié sur currentDocumentId).
          setYousignEmbedUrl((prev) => prev || url);
          setYousignError(null);
          return;
        }

        // Rate limit YouSign : décompte et retry automatique
        if (res.status === 429 || (payload as { rateLimited?: boolean }).rateLimited) {
          const waitSeconds = 30;
          setYousignError(`YouSign API rate limit. Retrying in ${waitSeconds}s…`);
          setRateLimitRetryIn(waitSeconds);
          if (rateLimitTimerRef.current) clearInterval(rateLimitTimerRef.current);
          rateLimitTimerRef.current = setInterval(() => {
            setRateLimitRetryIn((prev) => {
              if (prev <= 1) {
                clearInterval(rateLimitTimerRef.current!);
                rateLimitTimerRef.current = null;
                setYousignError(null);
                return 0;
              }
              return prev - 1;
            });
          }, 1000);
          return;
        }

        if (payload.completed) {
          setYousignError(payload.message || "All documents are signed.");
          setYousignEmbedUrl(null);
          return;
        }

        if (payload.waiting) {
          setYousignError(payload.message || "Waiting for the next step.");
          setYousignEmbedUrl(null);
          return;
        }

        if (payload.signed) {
          setYousignEmbedUrl(null);
          setSignerRows((prev) =>
            prev.map((s) =>
              s.id === signerId ? { ...s, signed_at: new Date().toISOString() } : s
            )
          );
          const docsRes = await fetch(`/api/session/${sessionId}/documents`);
          if (docsRes.ok) {
            const docsPayload = await docsRes.json();
            if (docsPayload?.documents?.length) setDocuments(docsPayload.documents);
          }
          router.refresh();
          return;
        }

        setYousignError(payload.error || payload.message || "YouSign link unavailable");
      } catch {
        if (!cancelled) setYousignError("YouSign loading error");
      } finally {
        if (!cancelled) setYousignLoading(false);
      }
    };

    loadYousignEmbed();
    // Polling yousign-embed toutes les 60s pour détecter la signature dans l'iframe.
    // Un intervalle court sature l'API YouSign (429). Supabase realtime + postMessage
    // gèrent les événements immédiats.
    const interval = setInterval(loadYousignEmbed, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, signerId, token, isMyTurnToSign, placementConfirmed]);

  // ── Écoute des événements postMessage de l'iframe YouSign ────────────────
  // YouSign envoie un message quand le signataire a terminé → on démonte l'iframe
  // IMMÉDIATEMENT pour ne jamais afficher l'écran de téléchargement.
  useEffect(() => {
    if (!yousignEmbedUrl) return;

    const handleYousignMessage = async (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;

      // YouSign v3 peut envoyer plusieurs formats / noms d'événements
      const type: string = data.type ?? data.name ?? data.event ?? data.action ?? "";
      const typeLC = type.toLowerCase();

      // Capturer TOUS les événements qui signalent une fin (signature ou upload ou complet)
      const isSignedEvent =
        type === "yousign:signer:signed" ||
        type === "yousign:signed" ||
        type === "signer.signed" ||
        type === "signer:signed" ||
        type === "signed" ||
        type === "sign:success" ||
        type === "yousign:signature:done" ||
        type === "yousign:signer:done" ||
        type === "yousign:signer:certificate:sent" ||
        typeLC.includes("signed") ||
        typeLC.includes("completed") ||
        typeLC.includes("done");

      if (!isSignedEvent) return;

      console.log("[CLIENT] YouSign postMessage signed event:", data);

      // Mise à jour immédiate de l'UI
      setYousignEmbedUrl(null);
      setYousignError(null);
      setSignerRows((prev) =>
        prev.map((s) =>
          s.id === signerId ? { ...s, signed_at: new Date().toISOString() } : s
        )
      );

      // Confirmer côté serveur via l'endpoint dédié (sans re-vérifier YouSign API).
      // Cet appel est non-bloquant : la mise à jour UI est déjà faite ci-dessus.
      // La mise à jour DB déclenchera le realtime sur signer 2 quasi-instantanément.
      fetch(`/api/session/${sessionId}/sign-in-app`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, signerId }),
        cache: "no-store",
      })
        .then(() => {
          syncSigningStateRef.current();
          router.refresh();
        })
        .catch(() => {
          syncSigningStateRef.current();
        });
    };

    window.addEventListener("message", handleYousignMessage);
    return () => window.removeEventListener("message", handleYousignMessage);
  }, [yousignEmbedUrl, signerId, sessionId, token, router]);
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!liveRoomUrl) return;

    let cancelled = false;
    joinChimePlayedRef.current = false;
    const roomUrl = liveRoomUrl.startsWith("http") ? liveRoomUrl : `https://${liveRoomUrl}`;

    const signerName = signers.find((s) => s.id === signerId)?.name ?? "Signer";
    const call = Daily.createCallObject({
      url: roomUrl,
      subscribeToTracksAutomatically: true,
      allowMultipleCallInstances: true,
      userName: signerName,
    });

    callRef.current = call;

    const handleParticipantsChange = () => {
      if (!cancelled) updateParticipants(call);
    };

    call.on("joined-meeting", () => {
      if (cancelled) return;
      setIsInCall(true);
      setIsVideoOn(call.localVideo());
      setIsAudioOn(call.localAudio());
      setWaitingMessage(null);
      handleParticipantsChange();
      // Notification sonore une fois à l’entrée en room (signataires uniquement)
      if (signerId && !joinChimePlayedRef.current) {
        joinChimePlayedRef.current = true;
        playRoomOpenChime();
      }
      // Audit: signer a rejoint la vidéo
      fetch(`/api/session/${sessionId}/audit-event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, eventType: "video_joined", metadata: { daily_room_url: roomUrl } }),
      }).catch(() => {});
    });

    call.on("participant-joined", handleParticipantsChange);
    call.on("participant-updated", handleParticipantsChange);
    call.on("participant-left", handleParticipantsChange);

    call.on("left-meeting", () => {
      if (!cancelled) {
        setIsInCall(false);
        setCallItems([]);
        // Audit: signer a quitté la vidéo
        fetch(`/api/session/${sessionId}/audit-event`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, eventType: "video_left", metadata: { daily_room_url: roomUrl } }),
        }).catch(() => {});
      }
    });

    call.on("waiting-participant-added", () => {
      if (!cancelled) setWaitingMessage("Waiting for other participants");
    });

    call.join({ userName: signerName }).catch((err) => {
      if (!cancelled) setWaitingMessage(`Connection error: ${err?.message || "Unknown"}`);
    });

    return () => {
      cancelled = true;
      callRef.current = null;
      call.leave().then(() => call.destroy());
    };
  }, [liveRoomUrl, updateParticipants, signerId, signers]);

  const toggleVideo = () => {
    if (callRef.current) {
      const next = !callRef.current.localVideo();
      callRef.current.setLocalVideo(next);
      setIsVideoOn(next);
    }
  };

  const toggleAudio = () => {
    if (callRef.current) {
      const next = !callRef.current.localAudio();
      callRef.current.setLocalAudio(next);
      setIsAudioOn(next);
    }
  };

  const leaveCall = () => {
    if (callRef.current) {
      callRef.current.leave();
      router.push(`/session/${sessionId}?token=${token}`);
    }
  };

  const handleLeaveCall = () => {
    if (window.confirm("Leave the call?")) {
      leaveCall();
    }
  };

  const handleStartSigning = async () => {
    setStartingSigning(true);
    try {
      const res = await fetch(`/api/session/${sessionId}/start-signing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error || "Could not start signing");
        return;
      }
      broadcastSigningFlowStarted(createClient(), sessionId);
      await syncSigningStateRef.current();
    } finally {
      setStartingSigning(false);
    }
  };

  const videoRowsClass =
    "grid gap-3 flex-1 min-h-0 w-full auto-rows-[minmax(0,1fr)] items-stretch";

  return (
    <>
    {/* Modal de positionnement de signature */}
    {showPlacementPicker && (
      <PlacementPicker
        documentUrl={
          currentDocumentId
            ? `/api/session/${sessionId}/document?documentId=${currentDocumentId}&token=${token}`
            : null
        }
        signerLabel="Your signature"
        onConfirm={(p) => {
          setPlacementConfirmed(p);
          setShowPlacementPicker(false);
        }}
        onCancel={() => setShowPlacementPicker(false)}
      />
    )}

    <div className="flex flex-col lg:flex-row gap-4 h-[calc(100vh-2rem)]">

      {/* ── Sidebar gauche ── */}
      <div className="w-full lg:w-80 flex-shrink-0 flex flex-col h-full min-h-0 lg:order-1">
        {/* Zone scrollable */}
        <div className="flex-1 overflow-y-auto flex flex-col gap-4 min-h-0 pb-2">
          <div className="px-1">
            <img
              src={MY_NOTARY_LOGO_SRC}
              alt="MyNotary"
              className="h-6 w-auto"
            />
            {workflowLabel && (
              <p className="mt-1 text-xs text-muted-foreground">{workflowLabel}</p>
            )}
          </div>

          <Card className="bg-white border-gray-200">
            <CardHeader className="py-2">
              <h2 className="text-lg font-semibold">Signers</h2>
            </CardHeader>
            <CardContent className="py-2 space-y-2">
              {signerRows.map((s) => (
                <div key={s.id} className="flex items-center justify-between text-sm p-2 rounded">
                  <span className="truncate pr-2">{s.name}</span>
                  {s.signed_at ? (
                    <Badge variant="success">Signed</Badge>
                  ) : s.kyc_status === "approved" ? (
                    <Badge variant="warning">Pending</Badge>
                  ) : (
                    <Badge variant="outline">KYC</Badge>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="bg-white border-gray-200">
            <CardHeader className="py-2">
              <h2 className="text-lg font-semibold">Documents</h2>
            </CardHeader>
            <CardContent className="py-2 space-y-2">
              {workflowDocs.length > 0 ? (
                workflowDocs.map((doc) => {
                  const isCurrent = doc.id === currentDocumentId;
                  let statusLabel: string;
                  let statusCls: string;

                  if (signingFlowStatus === "idle" && doc.status !== "completed" && doc.status !== "cancelled") {
                    statusLabel = "Not started";
                    statusCls = "bg-muted text-muted-foreground";
                  } else if (doc.status === "completed") {
                    statusLabel = "Signed ✓";
                    statusCls = "bg-green-100 text-green-700";
                  } else if (doc.status === "cancelled") {
                    statusLabel = "Cancelled";
                    statusCls = "bg-red-100 text-red-700";
                  } else if (doc.status === "pending_notary" || (isCurrent && expectedActorRole === "notary")) {
                    statusLabel = "Notary’s turn to sign";
                    statusCls = "bg-blue-100 text-blue-700";
                  } else if (isCurrent && expectedActorRole === "signer") {
                    if (isMyTurnToSign) {
                      statusLabel = "Your turn to sign";
                      statusCls = "bg-amber-100 text-amber-700 font-semibold";
                    } else {
                      const m = expectedActorText?.match(/^Waiting for (.+?) to sign\.$/);
                      const raw = m?.[1] ?? "";
                      statusLabel =
                        raw === "another signer"
                          ? "Another signer’s turn"
                          : raw
                            ? `${raw} — to sign`
                            : "Signer’s turn";
                      statusCls = "bg-amber-50 text-amber-600";
                    }
                  } else if (isCurrent) {
                    statusLabel = "In progress";
                    statusCls = "bg-sky-100 text-sky-700";
                  } else {
                    statusLabel = "Upcoming";
                    statusCls = "bg-muted text-muted-foreground";
                  }

                  return (
                    <div key={doc.id} className={`flex flex-col gap-1 rounded-md px-2 py-1.5 ${isCurrent ? "bg-muted/40 ring-1 ring-muted" : ""}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{`Doc ${doc.document_order + 1} – ${doc.label.replace(/\.[^/.]+$/, "")}`}</span>
                        <a
                          href={`/api/session/${sessionId}/document?documentId=${doc.id}&token=${token}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 p-1 rounded hover:bg-muted transition-colors"
                          title="Open in new tab"
                        >
                          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                        </a>
                      </div>
                      <span className={`self-start text-xs px-2 py-0.5 rounded-full ${statusCls}`}>
                        {statusLabel}
                      </span>
                    </div>
                  );
                })
              ) : documents.filter((d) => d.source === "submission").length > 0 ? (
                documents.filter((d) => d.source === "submission").map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between text-sm py-1">
                    <span className="truncate pr-2 font-medium text-sm">{doc.label.replace(/\.[^/.]+$/, "")}</span>
                    <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      Pending
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No documents</p>
              )}
            </CardContent>
          </Card>

          <AuditTimeline events={auditEvents} />
        </div>

        {/* Contrôles vidéo — toujours collés en bas */}
        {liveRoomUrl && isInCall && (
          <div className="flex-shrink-0 bg-white border-t border-gray-200 pt-2">
            <div className="flex items-center justify-center gap-3 py-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleVideo}
                title={isVideoOn ? "Turn camera off" : "Turn camera on"}
                className="h-12 w-12 rounded-full bg-black hover:bg-black/80 text-white"
              >
                {isVideoOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleAudio}
                title={isAudioOn ? "Mute microphone" : "Unmute microphone"}
                className="h-12 w-12 rounded-full bg-black hover:bg-black/80 text-white"
              >
                {isAudioOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleLeaveCall}
                title="Leave call"
                className="h-12 w-12 rounded-full bg-red-600 hover:bg-red-700 text-white"
              >
                <PhoneOff className="h-5 w-5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Zone principale : vidéo + yousign côte à côte ── */}
      <div className="flex-1 flex flex-col lg:flex-row gap-4 min-h-0 min-w-0 lg:order-2">
        <Card className="flex-1 min-h-0 flex flex-col min-w-0 bg-white border-gray-200">
          <CardContent className="flex-1 min-h-0 p-4 flex flex-col">
            {!liveRoomUrl ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-muted-foreground text-center p-4">
                  Video will be available once the notary has joined.
                </p>
              </div>
            ) : (
              <div className="flex-1 min-h-[200px] flex flex-col gap-2 overflow-hidden">
                {waitingMessage && (
                  <p className="text-sm text-muted-foreground py-2 flex-shrink-0">{waitingMessage}</p>
                )}
                <div
                  className={videoRowsClass}
                  style={{
                    gridTemplateColumns: callItems.length <= 2 ? `repeat(${callItems.length}, 1fr)` : "repeat(2, 1fr)",
                    gridTemplateRows: callItems.length <= 2 ? "1fr" : `repeat(${Math.ceil(callItems.length / 2)}, 1fr)`,
                  }}
                >
                  {callItems.map((item) => {
                    const remoteIsKnownSigner = !item.participant.local && signerRows.some(
                      (s) => s.name.trim().toLowerCase() === (item.participant.user_name ?? "").trim().toLowerCase()
                    );
                    const tileRole: "signer" | "notary" = item.participant.local
                      ? "signer"
                      : remoteIsKnownSigner
                        ? "signer"
                        : "notary";
                    return (
                      <div key={item.id} className="min-w-0 min-h-0 h-full w-full overflow-hidden">
                        <VideoTile
                          id={item.id}
                          videoTrack={item.videoTrack}
                          audioTrack={item.audioTrack}
                          userName={item.participant.user_name}
                          isLocal={item.participant.local}
                          role={tileRole}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="w-full lg:w-[42rem] lg:min-w-[42rem] flex-shrink-0 flex flex-col bg-white border-gray-200">
          <CardContent className="flex-1 min-h-0 py-2 px-2 flex flex-col gap-2 overflow-hidden">
            <div className="flex-1 min-h-0 rounded-md border bg-muted/20 overflow-hidden flex flex-col">
              {isNotary && signingFlowStatus === "idle" ? (
                <SignerWorkflowStatusPanel
                  variant="idle"
                  title="Signing not started"
                  description="Explain the deeds to the signers first. When you are ready, start the flow — only then can they place their signature in YouSign."
                  onRefresh={() => syncSigningStateRef.current()}
                >
                  <Button
                    type="button"
                    size="lg"
                    className="min-w-[260px] border border-[#2563eb] bg-[#2563eb] text-white hover:bg-[#2563eb]/90 shadow-sm"
                    onClick={handleStartSigning}
                    disabled={startingSigning}
                  >
                    {startingSigning ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Starting…
                      </>
                    ) : (
                      <>Start signing →</>
                    )}
                  </Button>
                </SignerWorkflowStatusPanel>
              ) : isMyTurnToSign ? (
                !placementConfirmed ? (
                  /* Tour du signataire mais placement pas encore choisi */
                  <SignerWorkflowStatusPanel
                    variant="loading-yousign"
                    title="Place your signature"
                    description="Choose where your signature goes on the document before signing."
                    onRefresh={() => syncSigningStateRef.current()}
                  >
                    <Button
                      type="button"
                      size="lg"
                      className="min-w-[260px] border border-[#2563eb] bg-[#2563eb] text-white hover:bg-[#2563eb]/90 shadow-sm"
                      onClick={() => setShowPlacementPicker(true)}
                      disabled={!currentDocumentId}
                    >
                      Place my signature →
                    </Button>
                  </SignerWorkflowStatusPanel>
                ) : yousignEmbedUrl ? (
                  <>
                    <div className="flex-1 min-h-0 flex flex-col relative">
                      <iframe
                        src={yousignEmbedUrl}
                        title="Signature Yousign"
                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                        referrerPolicy="strict-origin-when-cross-origin"
                        className="w-full flex-1 min-h-[380px] border-0 bg-background"
                      />
                    </div>
                    <div className="flex-shrink-0 flex items-center justify-between gap-2 border-t py-2 px-3 bg-muted/30">
                      <div className="flex items-center gap-2">
                        <PenLine className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                        <span className="text-xs text-muted-foreground">Secure electronic signature (YouSign)</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs h-7"
                        onClick={() => {
                          resetOnNextYousignCallRef.current = true;
                          setYousignEmbedUrl(null);
                          setPlacementConfirmed(null);
                          setShowPlacementPicker(true);
                        }}
                      >
                        Reposition
                      </Button>
                    </div>
                  </>
                ) : yousignLoading ? (
                  <SignerWorkflowStatusPanel
                    variant="loading-yousign"
                    title="Preparing your signature"
                    description="Opening the secure YouSign workspace…"
                    onRefresh={() => syncSigningStateRef.current()}
                  />
                ) : (
                  <SignerWorkflowStatusPanel
                    variant="error-yousign"
                    title="Signature unavailable"
                    description={
                      rateLimitRetryIn > 0
                        ? `YouSign API rate limit — retry in ${rateLimitRetryIn}s`
                        : yousignError || "YouSign signing link unavailable."
                    }
                    onRefresh={() => syncSigningStateRef.current()}
                  >
                    {(yousignError || rateLimitRetryIn > 0) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (rateLimitTimerRef.current) {
                            clearInterval(rateLimitTimerRef.current);
                            rateLimitTimerRef.current = null;
                          }
                          setRateLimitRetryIn(0);
                          setYousignError(null);
                        }}
                      >
                        Try again
                      </Button>
                    )}
                  </SignerWorkflowStatusPanel>
                )
              ) : (() => {
                  const sessionClosedByNotary = currentStatus === "completed";
                  const allSignaturesDone =
                    signingFlowStatus === "completed" && !sessionClosedByNotary;
                  let variant: SignerStatusVariant = "idle";
                  let title = "Session status";
                  let description =
                    expectedActorText ||
                    "No signature is required from you at the moment.";

                  if (sessionClosedByNotary) {
                    variant = "completed";
                    title = "Session ended";
                    description =
                      expectedActorText ||
                      "The notary has closed the session. Thank you for using mynotary.";
                  } else if (allSignaturesDone) {
                    variant = "signatures-done";
                    title = "All signatures complete";
                    description =
                      expectedActorText ||
                      "All documents are signed. The video call stays open — please wait until the notary officially ends the session.";
                  } else if (expectedActorRole === "notary") {
                    variant = "wait-notary";
                    title = "Waiting for the notary";
                    description = expectedActorText || "The notary must sign and apply their stamp.";
                  } else if (expectedActorRole === "signer") {
                    variant = "wait-signer";
                    title = "Waiting for a signer";
                    description =
                      expectedActorText || "Another signer still needs to sign.";
                  } else if (signingFlowStatus === "idle") {
                    variant = "idle";
                    title = "Signing not available yet";
                    description =
                      expectedActorText ||
                      "The notary must explain the document and start the signing flow before you can sign.";
                  } else {
                    variant = "idle";
                    title = "No action required";
                    description =
                      expectedActorText ||
                      "Follow the notary’s instructions. For security the document is not shown here — only in YouSign when it is your turn to sign.";
                  }

                  return (
                    <SignerWorkflowStatusPanel
                      variant={variant}
                      title={title}
                      description={description}
                      onRefresh={() => syncSigningStateRef.current()}
                    />
                  );
                })()}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
    </>
  );
}
