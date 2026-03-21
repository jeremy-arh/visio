"use client";

import { useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { CompleteSessionDialog } from "@/components/complete-session-dialog";
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
  X,
  ChevronLeft,
  ChevronRight,
  PenLine,
  Loader2,
  ExternalLink,
  RefreshCw,
  BadgeCheck,
  Stamp,
  UserPen,
  FileSearch,
  CircleAlert,
  PartyPopper,
} from "lucide-react";
import { useToast } from "@/components/ui/toast-provider";
import { createClient } from "@/lib/supabase-browser";
import { broadcastSigningFlowStarted } from "@/lib/broadcast-signing-flow";

interface Signer {
  id: string;
  name: string;
  email: string;
  kyc_status: string;
  signed_at: string | null;
}

interface CallItem {
  id: string;
  participant: DailyParticipant;
  videoTrack: MediaStreamTrack | undefined;
  audioTrack: MediaStreamTrack | undefined;
}

interface DocumentItem {
  id: string;
  label: string;
  url: string;
  status: "available" | "pending";
  source?: "session" | "submission";
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
  documents?: Array<{ id: string; label: string; document_order: number; source_url?: string | null; status: string }>;
  signers?: Signer[];
  expectedActor?: {
    role: "signer" | "notary";
    sessionSignerId?: string | null;
    signerName?: string | null;
    notaryId?: string | null;
  } | null;
}

type SignerStatusVariant =
  | "completed"
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

/** Same status panel as the signer room for consistent UI. */
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

// ─── Audit Timeline ──────────────────────────────────────────────────────────

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
      // Scroll fluide vers le dernier événement
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
                {/* Ligne verticale */}
                <span
                  className="absolute left-0 top-[6px] bottom-0 w-px bg-border"
                  aria-hidden
                />

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
                      {/* Dot */}
                      {isLast ? (
                        /* Dot actif — vert avec halo pulse */
                        <span className="absolute left-[-5px] top-[3px] flex h-[11px] w-[11px]">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                          <span className="relative inline-flex h-[11px] w-[11px] rounded-full bg-emerald-500 ring-2 ring-emerald-200" />
                        </span>
                      ) : (
                        /* Dot passé — gris */
                        <span
                          className={`absolute left-[-5px] top-[3px] h-[11px] w-[11px] rounded-full ring-2 ${
                            isPast ? "bg-muted-foreground/30 ring-muted/40" : "bg-gray-300 ring-gray-100"
                          }`}
                        />
                      )}

                      {/* Heure */}
                      <time className={`block text-[10px] tabular-nums mb-0.5 leading-none ${isPast ? "text-muted-foreground/50" : "text-muted-foreground"}`}>
                        {new Date(event.created_at).toLocaleString("en-US", {
                          day: "2-digit", month: "2-digit",
                          hour: "2-digit", minute: "2-digit", second: "2-digit",
                        })}
                      </time>

                      {/* Label */}
                      <p className={`text-xs font-semibold leading-snug ${isPast ? "text-muted-foreground/70" : "text-foreground"}`}>
                        {AUDIT_LABELS[event.event_type] ?? event.event_type}
                      </p>

                      {/* Acteur */}
                      {(event.actor_name || event.actor_email) && (
                        <p className="text-[11px] text-muted-foreground/60 truncate mt-0.5">
                          {event.actor_name ?? ""}{event.actor_name && event.actor_email ? " · " : ""}{event.actor_email ?? ""}
                        </p>
                      )}

                      {/* Document */}
                      {event.document_label && (
                        <p className="text-[11px] text-muted-foreground/50 italic truncate">
                          {event.document_label.replace(/\.[^/.]+$/, "")}
                        </p>
                      )}

                      {/* IP */}
                      {event.ip_address && (
                        <p className="text-[10px] font-mono text-muted-foreground/40 truncate mt-0.5">
                          {event.ip_address}
                        </p>
                      )}

                      {/* User-Agent */}
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

          {/* Fondu bas */}
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

const SIG_W = 200;
const SIG_H = 100;

function PlacementPicker({
  documentUrl,
  signerLabel = "Notary seal",
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
  // pdfDims = dimensions de la page en points PDF (espace YouSign)
  const pdfDimsRef = useRef<{ width: number; height: number }>({ width: 595, height: 842 });
  // renderScale = pixels canvas / points PDF
  const renderScaleRef = useRef(1);
  const [isRendering, setIsRendering] = useState(false);

  // Rendu de la page PDF sur le canvas via pdf.js
  useEffect(() => {
    if (!documentUrl) return;
    let cancelled = false;
    setIsRendering(true);
    setHoverPx(null);
    setPlacedPx(null);

    (async () => {
      try {
        // Import dynamique — client uniquement
        const pdfjsLib = await import("pdfjs-dist");
        // Utiliser le worker depuis CDN pour éviter les problèmes de bundling Next.js
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (pdfjsLib as any).GlobalWorkerOptions.workerSrc =
          `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

        const pdf = await pdfjsLib.getDocument({ url: documentUrl, isEvalSupported: false }).promise;
        if (cancelled) return;
        setTotalPages(pdf.numPages);

        const pdfPage = await pdf.getPage(Math.min(page, pdf.numPages));
        if (cancelled) return;

        const viewport1 = pdfPage.getViewport({ scale: 1 });
        pdfDimsRef.current = { width: viewport1.width, height: viewport1.height };

        // Adapter à la largeur du conteneur
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
    const w = SIG_W * scale;
    const h = SIG_H * scale;
    const dims = pdfDimsRef.current;
    const maxX = dims.width * scale;
    const maxY = dims.height * scale;
    const left = Math.max(0, Math.min(cx - w / 2, maxX - w));
    const top  = Math.max(0, Math.min(cy - h / 2, maxY - h));
    return { left, top, width: w, height: h };
  };

  const handleConfirm = () => {
    if (!placedPx) return;
    const { x: pdfX, y: pdfY } = canvasToPdf(placedPx.x, placedPx.y);
    const dims = pdfDimsRef.current;
    const x = Math.round(Math.max(0, Math.min(pdfX - SIG_W / 2, dims.width  - SIG_W)));
    const y = Math.round(Math.max(0, Math.min(pdfY - SIG_H / 2, dims.height - SIG_H)));
    onConfirm({ page, x, y, width: SIG_W, height: SIG_H });
  };

  const changePage = (delta: number) => {
    setPage(p => Math.max(1, Math.min(totalPages, p + delta)));
    setPlacedPx(null);
    setHoverPx(null);
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-2xl flex flex-col gap-3 p-5 w-full max-w-2xl max-h-[90vh]">
        {/* En-tête */}
        <div className="flex items-center justify-between shrink-0">
          <h2 className="text-lg font-bold">Place your signature</h2>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-muted-foreground shrink-0">
          {documentUrl
            ? "Click on the document to choose where your signature goes."
            : "Pick a page and click to place your signature."}
          {placedPx ? " Click again to reposition." : ""}
        </p>

        {/* Sélecteur de page */}
        <div className="flex items-center gap-2 text-sm shrink-0">
          <span className="font-medium">Page:</span>
          <button
            onClick={() => changePage(-1)}
            disabled={page <= 1}
            className="p-1 rounded border hover:bg-muted disabled:opacity-40 transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="w-10 text-center font-semibold">{page} / {totalPages}</span>
          <button
            onClick={() => changePage(1)}
            disabled={page >= totalPages}
            className="p-1 rounded border hover:bg-muted disabled:opacity-40 transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Canvas PDF — scrollable */}
        <div
          ref={containerRef}
          className="flex-1 overflow-y-auto overflow-x-hidden rounded-lg border bg-muted/10 min-h-0"
        >
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
            {/* Fantôme au survol */}
            {hoverPx && !placedPx && !isRendering && (
              <div
                className="absolute border-2 border-dashed border-blue-500 bg-blue-100/40 rounded flex items-center justify-center pointer-events-none"
                style={{ position: "absolute", ...sigBoxStyle(hoverPx.x, hoverPx.y) }}
              >
                <span className="text-[10px] font-semibold text-blue-700 whitespace-nowrap px-1">
                  ✍ {signerLabel}
                </span>
              </div>
            )}
            {/* Position confirmée */}
            {placedPx && !isRendering && (
              <div
                className="absolute border-2 border-green-600 bg-green-100/70 rounded flex items-center justify-center pointer-events-none shadow-sm"
                style={{ position: "absolute", ...sigBoxStyle(placedPx.x, placedPx.y) }}
              >
                <span className="text-[10px] font-semibold text-green-800 whitespace-nowrap px-1">
                  ✍ {signerLabel}
                </span>
              </div>
            )}
            {!documentUrl && !isRendering && (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
                Preview unavailable
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 justify-end pt-1 shrink-0">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!placedPx || isRendering}>
            Confirm and sign →
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function NotaryRoomClient({
  sessionId,
  initialStatus,
  initialRoomUrl,
  signers: initialSigners,
  initialDocuments,
  notaryName = "Notary",
  isRecordingView = false,
  recordingToken,
}: {
  sessionId: string;
  initialStatus: string;
  initialRoomUrl: string | null;
  signers: Signer[];
  initialDocuments: DocumentItem[];
  notaryName?: string;
  isRecordingView?: boolean;
  recordingToken?: string;
}) {
  const [signers, setSigners] = useState<Signer[]>(initialSigners);
  const [documents, setDocuments] = useState<DocumentItem[]>(
    initialDocuments?.length ? initialDocuments : []
  );
  const toast = useToast();
  const callRef = useRef<DailyCall | null>(null);
  const [currentStatus, setCurrentStatus] = useState(initialStatus);
  const [dailyRoomUrl, setDailyRoomUrl] = useState(initialRoomUrl);
  const [starting, setStarting] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isAudioOn, setIsAudioOn] = useState(true);
  const [isInCall, setIsInCall] = useState(false);
  const [callItems, setCallItems] = useState<CallItem[]>([]);
  const [waitingMessage, setWaitingMessage] = useState<string | null>(null);
  const [yousignEmbedUrl, setYousignEmbedUrl] = useState<string | null>(null);
  const [yousignLoading, setYousignLoading] = useState(false);
  const [yousignError, setYousignError] = useState<string | null>(null);
  const [rateLimitRetryIn, setRateLimitRetryIn] = useState<number>(0);
  const rateLimitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [workflowLabel, setWorkflowLabel] = useState<string | null>(null);
  const [expectedActorText, setExpectedActorText] = useState<string | null>(null);
  const [signingFlowStatus, setSigningFlowStatus] = useState<string | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const prevSignersRef = useRef<Signer[]>(initialSigners);
  const prevFlowStatusRef = useRef<string | null>(null);
  const prevDocumentIdRef = useRef<string | null>(null);
  const [placementConfirmed, setPlacementConfirmed] = useState<SignaturePlacement | null>(null);
  const [showPlacementPicker, setShowPlacementPicker] = useState(false);
  const [startingSigningFlow, setStartingSigningFlow] = useState(false);
  // Vrai si le notaire a repositionné → forcer reset YouSign au prochain appel
  const resetOnNextYousignCallRef = useRef(false);
  const [currentDocSourceUrl, setCurrentDocSourceUrl] = useState<string | null>(null);
  const [currentDocumentId, setCurrentDocumentId] = useState<string | null>(null);
  const [workflowDocs, setWorkflowDocs] = useState<Array<{ id: string; label: string; document_order: number; status: string }>>([]);

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
      items.push({ id, participant, videoTrack, audioTrack });
    }
    setCallItems(items);
  }, []);

  useEffect(() => {
    if (!dailyRoomUrl) return;
    let cancelled = false;
    const roomUrl = dailyRoomUrl.startsWith("http") ? dailyRoomUrl : `https://${dailyRoomUrl}`;
    console.log("[CLIENT] Creating Daily call object. roomUrl:", roomUrl, "isRecordingView:", isRecordingView);
    const call = Daily.createCallObject({
      url: roomUrl,
      subscribeToTracksAutomatically: true,
      allowMultipleCallInstances: true,
      ...(isRecordingView
        ? { userName: "Recording", startVideoOff: true, startAudioOff: true }
        : { userName: notaryName }),
    });
    callRef.current = call;

    const handleParticipantsChange = () => {
      if (!cancelled) updateParticipants(call);
    };

    call.on("joined-meeting", () => {
      console.log("[CLIENT] Daily: joined-meeting");
      if (cancelled) return;
      setIsInCall(true);
      setIsVideoOn(call.localVideo());
      setIsAudioOn(call.localAudio());
      setWaitingMessage(null);
      handleParticipantsChange();
      // Audit: notaire a rejoint la vidéo
      fetch(`/api/session/${sessionId}/audit-event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventType: "video_joined", metadata: { daily_room_url: roomUrl } }),
      }).catch(() => {});
      try {
        call.startRecording?.({ type: "cloud" });
        fetch(`/api/session/${sessionId}/audit-event`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventType: "video_recording_started", metadata: { type: "cloud" } }),
        }).catch(() => {});
      } catch {
        // Enregistrement Daily cloud non disponible
      }
    });
    call.on("participant-joined", handleParticipantsChange);
    call.on("participant-updated", handleParticipantsChange);
    call.on("participant-left", handleParticipantsChange);
    call.on("left-meeting", () => {
      if (!cancelled) {
        setIsInCall(false);
        setCallItems([]);
        // Audit: notaire a quitté la vidéo
        fetch(`/api/session/${sessionId}/audit-event`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventType: "video_left", metadata: { daily_room_url: roomUrl } }),
        }).catch(() => {});
      }
    });
    call.on("waiting-participant-added", () => {
      if (!cancelled) setWaitingMessage("Waiting for other participants");
    });

    console.log("[CLIENT] Daily: calling join()...");
    const joinOpts = isRecordingView
      ? { userName: "Recording", startVideoOff: true, startAudioOff: true }
      : { userName: notaryName };
    call.join(joinOpts).then(() => {
      console.log("[CLIENT] Daily: join() resolved");
    }).catch((err) => {
      console.error("[CLIENT] Daily: join() error:", err?.message ?? err);
      if (!cancelled) setWaitingMessage(`Connection error: ${err?.message || "Unknown"}`);
    });

    return () => {
      cancelled = true;
      callRef.current = null;
      call.leave().then(() => call.destroy());
    };
  }, [dailyRoomUrl, updateParticipants, isRecordingView, notaryName]);

  const startVisio = async () => {
    setStarting(true);
    setWaitingMessage(null);

    try {
      const res = await fetch(`/api/session/${sessionId}/daily-room`, { method: "POST" });
      const data = (await res.json()) as { url?: string; error?: string };
      console.log("[CLIENT] daily-room response:", res.status, JSON.stringify(data));
      if (!res.ok || !data.url) {
        console.warn("[CLIENT] ✗ daily-room failed:", data.error);
        setWaitingMessage(data.error || "Could not start video");
        return;
      }
      console.log("[CLIENT] ✓ daily-room url:", data.url);
      setDailyRoomUrl(data.url);
      setCurrentStatus("in_session");
    } catch (err) {
      console.error("[CLIENT] ✗ startVisio network error:", err);
      setWaitingMessage("Network error");
    } finally {
      setStarting(false);
    }
  };

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
      setIsInCall(false);
    }
  };

  const handleLeaveCall = () => {
    if (window.confirm("Leave the call?")) {
      leaveCall();
    }
  };

  const kycReady = signers.length > 0 && signers.every((s) => s.kyc_status === "approved");
  const videoRowsClass =
    "grid gap-3 flex-1 min-h-0 w-full auto-rows-[minmax(0,1fr)] items-stretch";

  const isNotaryTurn = expectedActorText?.includes("It's your turn") ?? false;

  // Quand le document courant change → réinitialiser tout l'état YouSign + placement
  // (le notaire doit repositionner sa signature pour chaque nouveau document)
  useEffect(() => {
    if (
      currentDocumentId !== null &&
      prevDocumentIdRef.current !== null &&
      prevDocumentIdRef.current !== currentDocumentId
    ) {
      setYousignEmbedUrl(null);
      setPlacementConfirmed(null);
      setYousignError(null);
      setYousignLoading(false);
    }
    prevDocumentIdRef.current = currentDocumentId;
  }, [currentDocumentId]);

  // Ouvrir automatiquement le picker quand c'est le tour du notaire (pas tant que le flux est en idle).
  useEffect(() => {
    if (
      isNotaryTurn &&
      signingFlowStatus &&
      signingFlowStatus !== "idle" &&
      !yousignEmbedUrl &&
      !placementConfirmed &&
      !showPlacementPicker
    ) {
      setShowPlacementPicker(true);
    }
  }, [isNotaryTurn, signingFlowStatus, yousignEmbedUrl, placementConfirmed, showPlacementPicker]);

  // L'embed YouSign ne se charge qu'une fois que le notaire a confirmé l'emplacement
  // de sa signature via le PlacementPicker.
  useEffect(() => {
    if (!placementConfirmed) return;

    let cancelled = false;
    const loadYousignEmbed = async () => {
      setYousignLoading(true);
      setYousignError(null);

      try {
        const params = new URLSearchParams({
          page: String(placementConfirmed.page),
          x: String(placementConfirmed.x),
          y: String(placementConfirmed.y),
          width: String(placementConfirmed.width),
          height: String(placementConfirmed.height),
        });
        // Si repositionnement : passer reset=true UNE seule fois pour forcer la
        // réinitialisation de la requête YouSign avec les nouvelles coordonnées.
        if (resetOnNextYousignCallRef.current) {
          params.set("reset", "true");
          resetOnNextYousignCallRef.current = false;
        }
        const url = `/api/session/${sessionId}/yousign-embed?${params}`;
        console.log("[CLIENT] loadYousignEmbed → GET", url);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 45000);
        const res = await fetch(url, { cache: "no-store", signal: controller.signal });
        clearTimeout(timeoutId);
        const payload = (await res.json()) as {
          embedUrl?: string;
          error?: string;
          message?: string;
          signed?: boolean;
          waiting?: boolean;
          completed?: boolean;
          documentLabel?: string;
          documentOrder?: number;
        };
        console.log("[CLIENT] yousign-embed response:", res.status, JSON.stringify(payload));

        if (cancelled) return;
        if (res.ok && payload.embedUrl) {
          console.log("[CLIENT] ✓ embedUrl received:", payload.embedUrl);
          setYousignEmbedUrl((prev) => prev || payload.embedUrl || null);
          setYousignError(null);
          if (payload.documentLabel && typeof payload.documentOrder === "number") {
            setWorkflowLabel(`Document ${payload.documentOrder + 1}: ${payload.documentLabel}`);
          }
          return;
        }

        if (payload.completed) {
          console.log("[CLIENT] All documents signed (completed)");
          setYousignError(null);
          setYousignEmbedUrl(null);
          setPlacementConfirmed(null);
          void syncSigningState();
          return;
        }

        if (payload.waiting) {
          console.log("[CLIENT] Waiting for next step:", payload.message);
          setYousignError(payload.message || "Waiting for the next step.");
          setYousignEmbedUrl(null);
          return;
        }

        if (payload.signed) {
          console.log("[CLIENT] Notary signature finalized:", payload.message);
          setYousignError(null);
          setYousignEmbedUrl(null);
          void syncSigningState();
          return;
        }

        // Rate limit YouSign : décompte et retry automatique
        if (res.status === 429 || (payload as { rateLimited?: boolean }).rateLimited) {
          const waitSeconds = 30;
          console.warn("[CLIENT] 429 rate limit → retry in", waitSeconds, "s");
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

        console.warn("[CLIENT] ✗ yousign-embed error:", payload.error ?? payload.message ?? "(no error field)");
        setYousignError(payload.error || payload.message || "YouSign link unavailable");
      } catch (err) {
        console.error("[CLIENT] ✗ loadYousignEmbed exception:", err);
        if (!cancelled) {
          const msg = err instanceof Error && err.name === "AbortError"
            ? "Loading took too long. Try again."
            : "YouSign loading error";
          setYousignError(msg);
        }
      } finally {
        if (!cancelled) setYousignLoading(false);
      }
    };

    loadYousignEmbed();
    // Continuer à poller pour détecter la fin de signature.
    // yousignEmbedUrl est ABSENT des deps : l'inclure déclencherait une re-exécution de l'effet
    // à chaque mise à jour de l'URL (→ iframe qui recharge en boucle).
    const interval = setInterval(loadYousignEmbed, 20000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, placementConfirmed]);

  // ── Écoute des événements postMessage de l'iframe YouSign (notaire) ──────
  // Même liste élargie que côté signataire : démonte l'iframe immédiatement
  // pour ne jamais afficher l'écran de téléchargement.
  useEffect(() => {
    if (!yousignEmbedUrl) return;

    const handleYousignMessage = async (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;

      const type: string = data.type ?? data.name ?? data.event ?? data.action ?? "";
      const typeLC = type.toLowerCase();

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

      console.log("[CLIENT-NOTAIRE] YouSign postMessage signed event:", data);

      // Mise à jour immédiate : vider l'embed et relancer le workflow
      setYousignEmbedUrl(null);
      setPlacementConfirmed(null);

      // Confirmer côté serveur
      if (placementConfirmed) {
        try {
          const params = new URLSearchParams({
            page: String(placementConfirmed.page),
            x: String(placementConfirmed.x),
            y: String(placementConfirmed.y),
            width: String(placementConfirmed.width),
            height: String(placementConfirmed.height),
          });
          await fetch(`/api/session/${sessionId}/yousign-embed?${params}`, { cache: "no-store" });
        } catch { /* silencieux */ }
      }
    };

    window.addEventListener("message", handleYousignMessage);
    return () => window.removeEventListener("message", handleYousignMessage);
  }, [yousignEmbedUrl, placementConfirmed, sessionId]);
  // ─────────────────────────────────────────────────────────────────────────

  const syncInFlightRef = useRef(false);
  const lastAuditFetchRef = useRef(0);
  const [docIds, setDocIds] = useState<string[]>([]);
  const [sessionNotFound, setSessionNotFound] = useState(false);

  const syncSigningState = useCallback(async () => {
    if (syncInFlightRef.current) return;
    syncInFlightRef.current = true;
    try {
      const tokenParam = recordingToken ? `?recordingToken=${encodeURIComponent(recordingToken)}` : "";
      const res = await fetch(`/api/session/${sessionId}/signing-state${tokenParam}`, {
        cache: "no-store",
      });
      if (res.status === 404) {
        setSessionNotFound(true);
        return;
      }
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.warn("[CLIENT] signing-state non-OK:", res.status, errText);
        return;
      }
      setSessionNotFound(false);
      const payload = (await res.json()) as SigningStateResponse;
      if (payload.sessionStatus) setCurrentStatus(payload.sessionStatus);

      if (payload.documents?.length) {
        const ids = payload.documents.map((d) => d.id);
        setDocIds((prev) =>
          prev.length === ids.length && prev.every((id, i) => id === ids[i]) ? prev : ids
        );
        setDocuments(
          payload.documents.map((d) => ({
            id: d.id,
            label: d.label,
            url: d.source_url || "",
            status: d.status === "completed" ? "available" : d.source_url ? "available" : "pending",
          }))
        );
        setWorkflowDocs(
          [...payload.documents].sort((a, b) => a.document_order - b.document_order)
        );
      }

      if (payload.signers?.length) {
        const prev = prevSignersRef.current;
        for (const signer of payload.signers) {
          const prevSigner = prev.find((s) => s.id === signer.id);
          if (signer.signed_at && !prevSigner?.signed_at) {
            toast.success(`${signer.name} signed`, { duration: 5000 });
          }
        }
        prevSignersRef.current = payload.signers;
        setSigners(payload.signers);
      }

      if (payload.signingFlowStatus) {
        const prevFlow = prevFlowStatusRef.current;
        if (prevFlow && prevFlow !== payload.signingFlowStatus) {
          if (payload.signingFlowStatus === "completed") {
            toast.success("Session finalized", {
              description: "All documents have been signed.",
              duration: 8000,
            });
          } else if (payload.signingFlowStatus === "pending_notary") {
            toast.info("All signers have signed — it's your turn!", {
              duration: 6000,
            });
          }
        }
        prevFlowStatusRef.current = payload.signingFlowStatus;
        setSigningFlowStatus(payload.signingFlowStatus);
        if (payload.signingFlowStatus === "completed") {
          setYousignError(null);
          setYousignEmbedUrl(null);
          setPlacementConfirmed(null);
        }
      }
      setWorkflowLabel(
        payload.currentDocument
          ? `Document ${payload.currentDocument.document_order + 1}: ${payload.currentDocument.label}`
          : null
      );
      if (payload.currentDocument?.source_url) {
        setCurrentDocSourceUrl(payload.currentDocument.source_url);
        setCurrentDocumentId(payload.currentDocument.id ?? null);
      } else if (payload.signingFlowStatus === "completed" && payload.documents?.length) {
        const lastDoc = payload.documents[payload.documents.length - 1] as { id?: string; signed_document_url?: string | null; source_url?: string | null };
        setCurrentDocSourceUrl(lastDoc.signed_document_url || lastDoc.source_url || null);
        setCurrentDocumentId(lastDoc.id ?? null);
      }
      if (payload.signingFlowStatus === "idle") {
        setExpectedActorText(
          "Explain to signers what they are signing, then use Start signing when ready — e-signing stays disabled until you do."
        );
      } else if (payload.expectedActor?.role === "signer") {
        const actorText = payload.expectedActor.signerName
          ? `Waiting for ${payload.expectedActor.signerName} to sign.`
          : "Waiting for signers to sign.";
        setExpectedActorText(actorText);
      } else if (payload.expectedActor?.role === "notary") {
        setExpectedActorText("It's your turn: sign and apply your stamp.");
      } else {
        setExpectedActorText(null);
      }

      try {
        const now = Date.now();
        if (now - lastAuditFetchRef.current >= 15000) {
          lastAuditFetchRef.current = now;
          const auditTokenParam = recordingToken ? `?recordingToken=${encodeURIComponent(recordingToken)}` : "";
          const auditRes = await fetch(`/api/session/${sessionId}/audit${auditTokenParam}`, { cache: "no-store" });
          if (auditRes.ok) {
            const auditPayload = await auditRes.json() as { events?: AuditEvent[] };
            if (auditPayload.events) setAuditEvents(auditPayload.events);
          }
        }
      } catch (auditErr) {
        console.warn("[CLIENT] audit fetch error:", auditErr);
      }
    } catch (err) {
      console.error("[CLIENT] syncSigningState exception:", err);
    } finally {
      syncInFlightRef.current = false;
    }
  }, [sessionId, recordingToken, toast]);

  const handleStartSigningFlow = async () => {
    setStartingSigningFlow(true);
    try {
      const res = await fetch(`/api/session/${sessionId}/start-signing`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error || "Could not start signing");
        return;
      }
      broadcastSigningFlowStarted(createClient(), sessionId);
      await syncSigningState();
    } finally {
      setStartingSigningFlow(false);
    }
  };

  // Premier chargement
  useEffect(() => {
    syncSigningState();
  }, [syncSigningState]);

  // Realtime Supabase : abonnements aux changements (remplace le polling pour la vue notaire)
  // Debounce pour éviter des syncs en rafale (chaque event déclenchait un sync complet)
  const debouncedSyncRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedRefetch = useCallback(() => {
    if (debouncedSyncRef.current) clearTimeout(debouncedSyncRef.current);
    debouncedSyncRef.current = setTimeout(() => {
      debouncedSyncRef.current = null;
      syncSigningState();
    }, 400);
  }, [syncSigningState]);

  useEffect(() => {
    if (isRecordingView || sessionNotFound) return;
    const supabase = createClient();
    const channelName = `signing-session-${sessionId}`;

    const subs: Array<{ table: string; filter?: string }> = [
      { table: "notarization_sessions", filter: `id=eq.${sessionId}` },
      { table: "session_documents", filter: `session_id=eq.${sessionId}` },
      { table: "session_signers", filter: `session_id=eq.${sessionId}` },
      { table: "audit_trail", filter: `session_id=eq.${sessionId}` },
    ];
    if (docIds.length > 0) {
      subs.push({
        table: "session_document_signatures",
        filter: `session_document_id=in.(${docIds.join(",")})`,
      });
    }

    let channel = supabase.channel(channelName);
    for (const { table, filter } of subs) {
      channel = channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          ...(filter && { filter }),
        },
        debouncedRefetch
      );
    }
    channel.subscribe();

    return () => {
      if (debouncedSyncRef.current) clearTimeout(debouncedSyncRef.current);
      supabase.removeChannel(channel);
    };
  }, [sessionId, debouncedRefetch, isRecordingView, sessionNotFound, docIds]);

  // Fallback polling pour la vue enregistrement (Realtime peut être limité par RLS)
  // Arrêt si session introuvable (404) pour éviter de saturer le serveur
  useEffect(() => {
    if (!isRecordingView || sessionNotFound) return;
    const interval = setInterval(syncSigningState, 10000);
    return () => clearInterval(interval);
  }, [isRecordingView, sessionNotFound, syncSigningState]);

  return (
    <>
    {/* Modal de positionnement de signature */}
    {showPlacementPicker && (
      <PlacementPicker
        documentUrl={
          currentDocSourceUrl && /supabase\.co\/storage/.test(currentDocSourceUrl)
            ? currentDocumentId
              ? `/api/session/${sessionId}/document?documentId=${currentDocumentId}`
              : `/api/session/${sessionId}/document?url=${encodeURIComponent(btoa(encodeURIComponent(currentDocSourceUrl)))}`
            : currentDocSourceUrl
        }
        onConfirm={(p) => {
          setPlacementConfirmed(p);
          setShowPlacementPicker(false);
        }}
        onCancel={() => setShowPlacementPicker(false)}
      />
    )}
    {sessionNotFound ? (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 p-8">
        <p className="text-lg font-medium text-muted-foreground">Session not found</p>
        <p className="text-sm text-muted-foreground text-center max-w-md">
          This session does not exist or was removed. Polling has been stopped.
        </p>
      </div>
    ) : (
    <div className="flex flex-col lg:flex-row gap-4 h-[calc(100vh-2rem)]">
      <div className="w-full lg:w-80 flex-shrink-0 flex flex-col h-full min-h-0 lg:order-1">
        {/* Zone scrollable */}
        <div className="flex-1 overflow-y-auto flex flex-col gap-4 min-h-0 pb-2">
          <div className="px-1">
            <img
              src="https://jlizwheftlnhoifbqeex.supabase.co/storage/v1/object/public/assets/logo/logo-noir.svg"
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
              {signers.map((s) => (
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
                  } else if (doc.status === "pending_notary" || (isCurrent && isNotaryTurn)) {
                    statusLabel = "Your turn to sign";
                    statusCls = "bg-blue-100 text-blue-700 font-semibold";
                  } else if (isCurrent && expectedActorText) {
                    // Signataire dont c'est le tour
                    const m = expectedActorText.match(/^Waiting for (.+?) to sign\.$/);
                    const name = m?.[1] ?? "";
                    statusLabel =
                      name === "signers"
                        ? "Signers — to sign"
                        : name
                          ? `${name} — to sign`
                          : "Signer’s turn";
                    statusCls = "bg-amber-50 text-amber-600";
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
                        <span className="truncate text-sm font-medium">
                          {`Doc ${doc.document_order + 1} – ${doc.label.replace(/\.[^/.]+$/, "")}`}
                        </span>
                        <a
                          href={`/api/session/${sessionId}/document?documentId=${doc.id}`}
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
        {dailyRoomUrl && isInCall && (
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

      <div className="flex-1 flex flex-col lg:flex-row gap-4 min-h-0 min-w-0 lg:order-2">
        <Card className="flex-1 min-h-0 flex flex-col min-w-0 bg-white border-gray-200">
          <CardContent className="flex-1 min-h-0 p-4 flex flex-col">
            {!dailyRoomUrl ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-4">
                <p className="text-muted-foreground text-center p-4">
                  {kycReady
                    ? "All signers have completed identity verification."
                    : "Waiting: all signers must complete identity verification (KYC)."}
                </p>
                {kycReady && (
                  <Button onClick={startVisio} disabled={starting}>
                    {starting ? "Starting…" : "Start video"}
                  </Button>
                )}
                {waitingMessage && <p className="text-sm text-destructive">{waitingMessage}</p>}
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
                  {callItems.map((item) => (
                    <div key={item.id} className="min-w-0 min-h-0 h-full w-full overflow-hidden">
                      <VideoTile
                        id={item.id}
                        videoTrack={item.videoTrack}
                        audioTrack={item.audioTrack}
                        userName={item.participant.user_name}
                        isLocal={item.participant.local}
                        role={item.participant.local ? "notary" : "signer"}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="w-full lg:w-[42rem] lg:min-w-[42rem] flex-shrink-0 flex flex-col bg-white border-gray-200">
          <CardContent className="flex-1 min-h-0 py-2 px-2 flex flex-col gap-2 overflow-hidden">
            <div className="flex-1 min-h-0 rounded-md border bg-muted/20 overflow-hidden flex flex-col">
              {signingFlowStatus === "completed" ? (
                <SignerWorkflowStatusPanel
                  variant="signatures-done"
                  title="All documents signed"
                  description="The signing workflow is complete. End the session when you are finished with the video call."
                  onRefresh={() => syncSigningState()}
                >
                  <CompleteSessionDialog
                    sessionId={sessionId}
                    onComplete={() => setCurrentStatus("completed")}
                    className="min-w-[260px] border border-[#2563eb] bg-[#2563eb] text-white hover:bg-[#2563eb]/90 shadow-sm"
                  />
                </SignerWorkflowStatusPanel>
              ) : signingFlowStatus === "idle" ? (
                <SignerWorkflowStatusPanel
                  variant="idle"
                  title="Explain before signing"
                  description="Signers cannot e-sign until you start the flow. Explain the document, then click below to allow electronic signature."
                  onRefresh={() => syncSigningState()}
                >
                  <Button
                    type="button"
                    size="lg"
                    className="min-w-[260px] border border-[#2563eb] bg-[#2563eb] text-white hover:bg-[#2563eb]/90 shadow-sm"
                    onClick={handleStartSigningFlow}
                    disabled={startingSigningFlow}
                  >
                    {startingSigningFlow ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Starting…
                      </>
                    ) : (
                      <>Start signing →</>
                    )}
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
                      <span className="text-xs text-muted-foreground">
                        Secure electronic signature (YouSign)
                      </span>
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
                  onRefresh={() => syncSigningState()}
                />
              ) : isNotaryTurn && !placementConfirmed ? (
                <SignerWorkflowStatusPanel
                  variant="loading-yousign"
                  title="Place your signature"
                  description="Choose where your signature goes on the document before signing."
                  onRefresh={() => syncSigningState()}
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
              ) : yousignError || rateLimitRetryIn > 0 ? (
                <SignerWorkflowStatusPanel
                  variant="error-yousign"
                  title="Signature unavailable"
                  description={
                    rateLimitRetryIn > 0
                      ? `YouSign API rate limit — retry in ${rateLimitRetryIn}s`
                      : yousignError || "YouSign signing link unavailable."
                  }
                  onRefresh={() => syncSigningState()}
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
                        setPlacementConfirmed(null);
                        setShowPlacementPicker(true);
                      }}
                    >
                      Try again
                    </Button>
                  )}
                </SignerWorkflowStatusPanel>
              ) : (
                <SignerWorkflowStatusPanel
                  variant="idle"
                  title="Signing status"
                  description={expectedActorText || "Waiting for the next signing step."}
                  onRefresh={() => syncSigningState()}
                />
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
    )}
  </>
  );
}
