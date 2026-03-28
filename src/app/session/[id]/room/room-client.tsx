"use client";

import { useEffect, useRef, useState, useCallback, type ElementType } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
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
  UserPen,
  FileSearch,
  Loader2,
  CircleAlert,
  PenLine,
  X,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Users,
  ScrollText,
  Files,
  ScreenShare,
  ScreenShareOff,
  Monitor,
} from "lucide-react";
import { useToast } from "@/components/ui/toast-provider";
import { MY_NOTARY_LOGO_SRC } from "@/lib/brand";
import { playRoomOpenChime } from "@/lib/room-open-chime";
import { broadcastSigningFlowStarted, broadcastSignerSigned } from "@/lib/broadcast-signing-flow";

// ─── Interfaces ───────────────────────────────────────────────────────────────

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
  isScreenShare?: boolean;
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

type SignaturePlacement = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

const PLACEMENT_SIG_W = 200;
const PLACEMENT_SIG_H = 100;

// ─── Notification sound ───────────────────────────────────────────────────────

function playNotificationSound() {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
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
    playNote(880, now, 0.3);
    playNote(1047, now + 0.15, 0.3);
    playNote(1319, now + 0.3, 0.5);
  } catch {
    /* Audio non disponible */
  }
}

// ─── VideoTile ────────────────────────────────────────────────────────────────

function VideoTile({
  videoTrack,
  audioTrack,
  userName,
  isLocal,
  role,
  isScreenShare = false,
}: {
  id: string;
  videoTrack: MediaStreamTrack | undefined;
  audioTrack: MediaStreamTrack | undefined;
  userName: string;
  isLocal: boolean;
  role: "notary" | "signer";
  isScreenShare?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const videoEl = videoRef.current;
    if (videoEl && videoTrack) {
      videoEl.srcObject = new MediaStream([videoTrack]);
    }
    return () => {
      if (videoEl) videoEl.srcObject = null;
    };
  }, [videoTrack]);

  useEffect(() => {
    const audioEl = audioRef.current;
    if (audioEl && audioTrack && !isLocal) {
      audioEl.srcObject = new MediaStream([audioTrack]);
    }
    return () => {
      if (audioEl) audioEl.srcObject = null;
    };
  }, [audioTrack, isLocal]);

  const displayName = userName?.trim() || "Participant";

  if (isScreenShare) {
    return (
      <div className="relative h-full w-full bg-[#0e0f11] rounded-xl overflow-hidden border border-white/[0.06]">
        {videoTrack ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={isLocal}
            className="absolute inset-0 w-full h-full object-contain bg-[#0e0f11]"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <Monitor className="h-10 w-10 text-white/20" />
          </div>
        )}
        <div className="absolute bottom-3 left-0 right-0 flex justify-center px-4 pointer-events-none">
          <span className="flex items-center justify-center gap-1.5 rounded-full bg-black/55 backdrop-blur-sm px-3 py-1.5 text-[11px] text-white/80 shadow text-center max-w-[min(100%,28rem)]">
            <Monitor className="h-3 w-3 shrink-0 text-white/60" aria-hidden />
            <span>{displayName} is sharing their screen</span>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-[#1a1b1e] rounded-xl overflow-hidden">
      {videoTrack ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className="absolute inset-0 w-full h-full object-contain bg-[#1a1b1e]"
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/40">
          <div className="w-16 h-16 rounded-full bg-white/[0.08] flex items-center justify-center">
            <span className="text-2xl font-semibold text-white/50">
              {displayName?.charAt(0)?.toUpperCase() || "?"}
            </span>
          </div>
          <span className="text-sm text-white/40">{displayName}</span>
          <span className="text-xs text-white/25">Camera off</span>
        </div>
      )}
      {audioTrack && !isLocal && <audio ref={audioRef} autoPlay playsInline />}
      <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between gap-2">
        <span className="rounded-md border border-white/15 bg-black/70 px-2 py-1 text-[11px] font-medium text-white/90 shadow truncate max-w-[70%]">
          {displayName}
          {isLocal && " • You"}
        </span>
        <span
          className={`rounded-md px-2 py-1 text-[11px] font-semibold shadow shrink-0 ${
            role === "notary"
              ? "bg-blue-600/90 text-white"
              : "bg-amber-500/90 text-black"
          }`}
        >
          {role === "notary" ? "Notary" : "Signer"}
        </span>
      </div>
    </div>
  );
}

// ─── Audit labels ─────────────────────────────────────────────────────────────

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
  video_screen_share_started: "Screen share started",
  video_screen_share_stopped: "Screen share stopped",
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

// ─── Dark audit list (side panel) ────────────────────────────────────────────

function DarkAuditList({ events }: { events: AuditEvent[] }) {
  const list = [...events].reverse().slice(0, 60);

  if (list.length === 0) {
    return (
      <p className="text-xs text-white/25 text-center py-8">
        No events recorded.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {list.map((event) => (
        <div
          key={event.id}
          className="px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.05]"
        >
          <p className="text-[12px] text-white/65 font-medium leading-snug">
            {AUDIT_LABELS[event.event_type] ?? event.event_type}
          </p>
          <p className="text-[10px] text-white/30 mt-0.5">
            {new Date(event.created_at).toLocaleString("en-US", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
            {event.actor_name ? ` · ${event.actor_name}` : ""}
          </p>
          {event.document_label && (
            <p className="text-[10px] text-white/20 italic truncate mt-0.5">
              {event.document_label.replace(/\.[^/.]+$/, "")}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Bottom control button ────────────────────────────────────────────────────

function RoomControlBtn({
  icon: Icon,
  label,
  onClick,
  active = true,
  danger = false,
  disabled = false,
}: {
  icon: ElementType;
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`flex flex-col items-center gap-1 min-w-[64px] px-4 py-2.5 rounded-xl transition-colors disabled:opacity-30 disabled:cursor-not-allowed select-none ${
        danger
          ? "bg-red-600/90 hover:bg-red-500 active:bg-red-700 text-white"
          : active
          ? "bg-white/[0.1] hover:bg-white/[0.16] active:bg-white/[0.06] text-white"
          : "bg-white/[0.05] hover:bg-white/[0.09] text-white/45"
      }`}
    >
      <Icon className="h-5 w-5" />
      <span className="text-[10px] font-medium tracking-wide">{label}</span>
    </button>
  );
}

// ─── LeaveWarningModal ────────────────────────────────────────────────────────

function LeaveWarningModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-[#1c1f24] border border-white/[0.1] rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-6 flex flex-col gap-4">
          {/* Icon */}
          <div className="w-12 h-12 rounded-2xl bg-red-500/15 border border-red-500/20 flex items-center justify-center shrink-0 mx-auto">
            <PhoneOff className="h-6 w-6 text-red-400" />
          </div>

          {/* Title */}
          <div className="text-center space-y-1.5">
            <h3 className="text-[15px] font-semibold text-white">
              The session is not over
            </h3>
            <p className="text-xs text-white/40 leading-relaxed">
              Only the notary can close the session. If you leave before the process is complete, <span className="text-white/60 font-medium">the session cannot be rescheduled</span> and <span className="text-white/60 font-medium">no refund will be issued</span>.
            </p>
            <p className="text-xs text-amber-400/80 leading-relaxed pt-1">
              Please wait for the notary to close the session.
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="w-full py-2.5 px-4 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] active:bg-[#1e40af] text-white text-sm font-medium transition-colors"
            >
              Stay in session
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="w-full py-2.5 px-4 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] active:bg-white/[0.03] text-red-400/80 hover:text-red-400 text-sm font-medium transition-colors"
            >
              Leave anyway
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── PlacementPicker ──────────────────────────────────────────────────────────

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
  const pdfDimsRef = useRef<{ width: number; height: number }>({
    width: 595,
    height: 842,
  });
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
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
        const pdf = await pdfjsLib.getDocument({
          url: documentUrl,
          isEvalSupported: false,
        }).promise;
        if (cancelled) return;
        setTotalPages(pdf.numPages);
        const pdfPage = await pdf.getPage(Math.min(page, pdf.numPages));
        if (cancelled) return;
        const viewport1 = pdfPage.getViewport({ scale: 1 });
        pdfDimsRef.current = {
          width: viewport1.width,
          height: viewport1.height,
        };
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

    return () => {
      cancelled = true;
    };
  }, [documentUrl, page]);

  const canvasToPdf = (cx: number, cy: number) => {
    const scale = renderScaleRef.current;
    return { x: cx / scale, y: cy / scale };
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
      top: Math.max(0, Math.min(cy - h / 2, maxY - h)),
      width: w,
      height: h,
    };
  };

  const handleConfirm = () => {
    if (!placedPx) return;
    const { x: pdfX, y: pdfY } = canvasToPdf(placedPx.x, placedPx.y);
    const dims = pdfDimsRef.current;
    const x = Math.round(
      Math.max(0, Math.min(pdfX - PLACEMENT_SIG_W / 2, dims.width - PLACEMENT_SIG_W))
    );
    const y = Math.round(
      Math.max(0, Math.min(pdfY - PLACEMENT_SIG_H / 2, dims.height - PLACEMENT_SIG_H))
    );
    onConfirm({ page, x, y, width: PLACEMENT_SIG_W, height: PLACEMENT_SIG_H });
  };

  const changePage = (delta: number) => {
    setPage((p) => Math.max(1, Math.min(totalPages, p + delta)));
    setPlacedPx(null);
    setHoverPx(null);
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-2xl flex flex-col gap-3 p-5 w-full max-w-2xl max-h-[90vh]">
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
            : "Preview unavailable — you can still confirm placement."}
          {placedPx ? " Click again to reposition." : ""}
        </p>
        <div className="flex items-center gap-2 text-sm shrink-0">
          <span className="font-medium">Page:</span>
          <button
            onClick={() => changePage(-1)}
            disabled={page <= 1}
            className="p-1 rounded border hover:bg-muted disabled:opacity-40 transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="w-10 text-center font-semibold">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => changePage(1)}
            disabled={page >= totalPages}
            className="p-1 rounded border hover:bg-muted disabled:opacity-40 transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
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

// ─── RoomClient ───────────────────────────────────────────────────────────────

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
    {
      id: "session-document",
      label: "Document to notarize",
      url: documentUrl ?? "",
      status: documentUrl ? "available" : "pending",
    },
    {
      id: "session-stamped",
      label: "Stamped document",
      url: stampedDocumentUrl ?? "",
      status: stampedDocumentUrl ? "available" : "pending",
    },
    {
      id: "session-signed",
      label: "Signed document",
      url: signedDocumentUrl ?? "",
      status: signedDocumentUrl ? "available" : "pending",
    },
  ];
  const fallbackDocs: DocumentItem[] = initialDocuments?.length
    ? initialDocuments
    : baseDocs;

  // ── State ─────────────────────────────────────────────────────────────────
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
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [cloudRecordingActive, setCloudRecordingActive] = useState(false);
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
  const [expectedActorRole, setExpectedActorRole] = useState<
    "signer" | "notary" | null
  >(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [workflowDocs, setWorkflowDocs] = useState<
    Array<{ id: string; label: string; document_order: number; status: string }>
  >([]);
  const [placementConfirmed, setPlacementConfirmed] =
    useState<SignaturePlacement | null>(null);
  const [showPlacementPicker, setShowPlacementPicker] = useState(false);
  const [startingSigning, setStartingSigning] = useState(false);
  const resetOnNextYousignCallRef = useRef(false);
  /** Évite double finalisation (postMessage + poll). Réinitialisé à chaque nouvel embed. */
  const signingEmbedFinalizeLockRef = useRef(false);
  const prevSignersRef = useRef<Signer[]>(signers);
  const prevFlowStatusRef = useRef<string | null>(null);
  const prevSessionStatusRef = useRef<string | null>(null);
  const prevDocumentIdRef = useRef<string | null>(null);
  const syncSigningStateRef = useRef<() => Promise<void>>(
    () => Promise.resolve()
  );
  const realtimeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  // Side panel
  const [activePanel, setActivePanel] = useState<
    "signers" | "documents" | "audit" | null
  >(null);

  // Leave warning modal
  const [showLeaveModal, setShowLeaveModal] = useState(false);

  // ── Participants ───────────────────────────────────────────────────────────
  const updateParticipants = useCallback((call: DailyCall) => {
    const participants = call.participants();
    const items: CallItem[] = [];
    for (const [, participant] of Object.entries(participants)) {
      const userName = participant.user_name ?? "";
      if (userName === "Recording" || userName === "Enregistrement") continue;
      // Daily identifie chaque connexion par session_id ; ne pas filtrer par user_name
      // (sinon on masque des pairs + leurs pistes screenVideo après un sync complet).
      const pid = participant.local ? "local" : participant.session_id;
      const videoTrack =
        participant.tracks.video?.track ??
        participant.tracks.video?.persistentTrack;
      const audioTrack = participant.tracks.audio?.persistentTrack;
      items.push({ id: pid, participant, videoTrack, audioTrack });
      const screenVideoTrack =
        participant.tracks.screenVideo?.track ??
        participant.tracks.screenVideo?.persistentTrack;
      if (screenVideoTrack) {
        items.push({
          id: `${pid}-screen`,
          participant,
          videoTrack: screenVideoTrack,
          audioTrack: undefined,
          isScreenShare: true,
        });
      }
    }
    const localScreenTrack =
      participants.local?.tracks?.screenVideo?.track ??
      participants.local?.tracks?.screenVideo?.persistentTrack;
    setIsSharingScreen(!!localScreenTrack);
    setCallItems(items);
  }, []);

  // ── Documents fetch ────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`/api/session/${sessionId}/documents`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.documents?.length) setDocuments(data.documents);
      })
      .catch(() => {});
  }, [sessionId]);

  // ── Supabase Realtime — source unique de vérité, zéro polling ─────────────
  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const triggerSync = () => {
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
      realtimeDebounceRef.current = setTimeout(
        () => syncSigningStateRef.current(),
        50
      );
    };

    const setup = async () => {
      const { data: docs } = await supabase
        .from("session_documents")
        .select("id")
        .eq("session_id", sessionId);
      const docIds = (docs ?? []).map((d: { id: string }) => d.id);

      channel = supabase.channel(`session-room-${sessionId}`);

      // ── Session status + room URL
      channel.on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notarization_sessions",
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          const newData = payload.new as {
            status: string;
            daily_room_url?: string | null;
            signing_flow_status?: string;
          };
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
          triggerSync();
        }
      );

      // ── Signer status changes (signed_at, kyc_status)
      channel.on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "session_signers",
          filter: `session_id=eq.${sessionId}`,
        },
        triggerSync
      );

      // ── Document status changes
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "session_documents",
          filter: `session_id=eq.${sessionId}`,
        },
        triggerSync
      );

      // ── Signature events par document
      for (const docId of docIds) {
        channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "session_document_signatures",
            filter: `session_document_id=eq.${docId}`,
          },
          triggerSync
        );
      }

      // ── Audit trail : append direct sans re-fetch
      channel.on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "audit_trail",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          const ev = payload.new as AuditEvent;
          setAuditEvents((prev) => [...prev, ev]);
        }
      );

      // ── Broadcast notaire : début du signing flow
      channel.on("broadcast", { event: "signing_flow_started" }, () => {
        syncSigningStateRef.current();
      });

      // ── Broadcast : un signataire vient de signer → passer au suivant instantanément
      channel.on("broadcast", { event: "signer_signed" }, () => {
        syncSigningStateRef.current();
      });

      channel.subscribe();
    };

    setup();

    return () => {
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
      if (channel) supabase.removeChannel(channel);
    };
  }, [sessionId, toast]);

  // ── Redirect on completion ─────────────────────────────────────────────────
  useEffect(() => {
    if (currentStatus === "completed") {
      router.replace(`/session/${sessionId}/completed?token=${token}`);
    }
  }, [currentStatus, sessionId, token, router]);

  // ── Reset YouSign on document change ───────────────────────────────────────
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

  // ── Auto-open placement picker ─────────────────────────────────────────────
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

  // ── Signing state poll ─────────────────────────────────────────────────────
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
            [...payload.documents].sort(
              (a, b) => a.document_order - b.document_order
            )
          );
        }
        setWorkflowLabel(
          payload.currentDocument
            ? `Document ${payload.currentDocument.document_order + 1}: ${payload.currentDocument.label}`
            : null
        );
        if (payload.signingFlowStatus)
          setSigningFlowStatus(payload.signingFlowStatus);

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
            setExpectedActorText(
              "The notary has closed the session. Thank you for participating."
            );
          } else if (payload.signingFlowStatus === "completed") {
            setExpectedActorText(
              "All documents are signed. Stay on the video call — only the notary can end the session."
            );
          } else {
            setExpectedActorText(
              "No signature is required from you right now. Follow the notary's instructions."
            );
          }
        }

        if (payload.signatures?.length) {
          const prev = prevSignersRef.current as unknown as Array<{
            id: string;
            signed_at?: string | null;
          }>;
          for (const sig of payload.signatures) {
            if (!sig.signed_at) continue;
            const prevSig = prev.find((s) => s.id === sig.id);
            if (!prevSig || prevSig.signed_at) continue;
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

        const prevFlow = prevFlowStatusRef.current;
        if (
          payload.signingFlowStatus === "completed" &&
          prevFlow &&
          prevFlow !== "completed"
        ) {
          if (payload.sessionStatus === "completed") {
            toast.success("Session ended", {
              description: "The notary has closed the session.",
              duration: 8000,
            });
          } else {
            toast.info("All signatures complete", {
              description:
                "Waiting for the notary to close the session. Do not leave the call.",
              duration: 10000,
            });
          }
        }
        if (payload.signingFlowStatus)
          prevFlowStatusRef.current = payload.signingFlowStatus;

        const prevSess = prevSessionStatusRef.current;
        if (
          payload.sessionStatus === "completed" &&
          prevSess != null &&
          prevSess !== "completed"
        ) {
          const flowJustCompletedThisPoll =
            payload.signingFlowStatus === "completed" &&
            prevFlow != null &&
            prevFlow !== "completed";
          if (!flowJustCompletedThisPoll) {
            toast.success("Session ended", {
              description: "The notary has closed the session.",
              duration: 8000,
            });
          }
        }
        if (payload.sessionStatus)
          prevSessionStatusRef.current = payload.sessionStatus;

        if (payload.signatures?.length) {
          setSignerRows((prev) =>
            prev.map((s) => {
              const sig = payload.signatures!.find(
                (x: {
                  session_signer_id?: string | null;
                  role: string;
                }) => x.role === "signer" && x.session_signer_id === s.id
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
          const auditPayload = (await auditRes.json()) as {
            events?: AuditEvent[];
          };
          if (!cancelled && auditPayload.events)
            setAuditEvents(auditPayload.events);
        }
      } catch {
        /* silencieux */
      }
    };

    syncSigningStateRef.current = syncSigningState;
    // Chargement initial unique — Realtime prend le relais ensuite
    syncSigningState();
    fetchAudit();

    // Resync quand l'onglet redevient visible (après mise en veille, alt-tab, etc.)
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        syncSigningStateRef.current();
        fetchAudit();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [sessionId, signerId, token, isNotary, toast]);

  useEffect(() => {
    if (yousignEmbedUrl) signingEmbedFinalizeLockRef.current = false;
  }, [yousignEmbedUrl]);

  const finalizeSigningEmbedClosed = useCallback(() => {
    if (signingEmbedFinalizeLockRef.current) return;
    signingEmbedFinalizeLockRef.current = true;
    setYousignEmbedUrl(null);
    setYousignError(null);
    setPlacementConfirmed(null);
    broadcastSignerSigned(createClient(), sessionId, signerId);
    void syncSigningStateRef.current();
    router.refresh();
  }, [sessionId, signerId, router]);

  // ── YouSign embed : secours si le postMessage YouSign n'est pas reçu ───────
  useEffect(() => {
    if (!yousignEmbedUrl || !placementConfirmed || !isMyTurnToSign) return;
    let cancelled = false;
    const params = new URLSearchParams({
      token,
      signerId,
      page: String(placementConfirmed.page),
      x: String(placementConfirmed.x),
      y: String(placementConfirmed.y),
      width: String(placementConfirmed.width),
      height: String(placementConfirmed.height),
    });

    const tick = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(
          `/api/session/${sessionId}/yousign-embed?${params}`,
          { cache: "no-store" }
        );
        const payload = (await res.json()) as { signed?: boolean };
        if (cancelled) return;
        if (payload.signed) finalizeSigningEmbedClosed();
      } catch {
        /* bruit réseau transitoire */
      }
    };

    const id = setInterval(tick, 4000);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [
    yousignEmbedUrl,
    placementConfirmed,
    isMyTurnToSign,
    sessionId,
    signerId,
    token,
    finalizeSigningEmbedClosed,
  ]);

  // ── YouSign embed loader ───────────────────────────────────────────────────
  useEffect(() => {
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
          setYousignEmbedUrl((prev) => prev || url);
          setYousignError(null);
          return;
        }

        if (
          res.status === 429 ||
          (payload as { rateLimited?: boolean }).rateLimited
        ) {
          const waitSeconds = 30;
          setYousignError(
            `YouSign API rate limit. Retrying in ${waitSeconds}s…`
          );
          setRateLimitRetryIn(waitSeconds);
          if (rateLimitTimerRef.current)
            clearInterval(rateLimitTimerRef.current);
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
              s.id === signerId
                ? { ...s, signed_at: new Date().toISOString() }
                : s
            )
          );
          const docsRes = await fetch(`/api/session/${sessionId}/documents`);
          if (docsRes.ok) {
            const docsPayload = await docsRes.json();
            if (docsPayload?.documents?.length)
              setDocuments(docsPayload.documents);
          }
          router.refresh();
          return;
        }

        setYousignError(
          payload.error || payload.message || "YouSign link unavailable"
        );
      } catch {
        if (!cancelled) setYousignError("YouSign loading error");
      } finally {
        if (!cancelled) setYousignLoading(false);
      }
    };

    // Chargement unique — le postMessage YouSign gère la suite
    loadYousignEmbed();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, signerId, token, isMyTurnToSign, placementConfirmed]);

  // ── YouSign postMessage ────────────────────────────────────────────────────
  // Doc : https://developers.yousign.com/docs/iframe-advanced
  // Payload officiel : { type: "yousign", event: "success" | "signature.done", ... }
  useEffect(() => {
    if (!yousignEmbedUrl) return;

    const handleYousignMessage = async (event: MessageEvent) => {
      let raw: unknown = event.data;
      if (typeof raw === "string") {
        try {
          raw = JSON.parse(raw);
        } catch {
          return;
        }
      }
      if (!raw || typeof raw !== "object") return;

      const payload = raw as Record<string, unknown>;
      const msgType =
        typeof payload.type === "string" ? payload.type : "";
      const msgEvent =
        typeof payload.event === "string" ? payload.event : "";
      const nameStr =
        typeof payload.name === "string" ? payload.name : "";
      const actionStr =
        typeof payload.action === "string" ? payload.action : "";

      const isOfficialYousignDone =
        msgType === "yousign" &&
        (msgEvent === "success" || msgEvent === "signature.done");

      const typeFallback = msgType || nameStr || actionStr;
      const typeLC = typeFallback.toLowerCase();
      const eventLC = msgEvent.toLowerCase();

      const isSignedEvent =
        isOfficialYousignDone ||
        typeFallback === "yousign:signer:signed" ||
        typeFallback === "yousign:signed" ||
        typeFallback === "signer.signed" ||
        typeFallback === "signer:signed" ||
        typeFallback === "signed" ||
        typeFallback === "sign:success" ||
        typeFallback === "yousign:signature:done" ||
        typeFallback === "yousign:signer:done" ||
        typeFallback === "yousign:signer:certificate:sent" ||
        (typeLC.includes("signed") &&
          !typeLC.includes("unsigned") &&
          msgType !== "yousign");

      if (!isSignedEvent) return;

      console.log("[CLIENT] YouSign postMessage signed event:", raw);

      setSignerRows((prev) =>
        prev.map((s) =>
          s.id === signerId
            ? { ...s, signed_at: new Date().toISOString() }
            : s
        )
      );

      try {
        const res = await fetch(`/api/session/${sessionId}/sign-in-app`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, signerId }),
          cache: "no-store",
        });
        if (!res.ok) {
          console.warn("[CLIENT] sign-in-app:", res.status, await res.text());
          signingEmbedFinalizeLockRef.current = false;
          void syncSigningStateRef.current();
          return;
        }
        finalizeSigningEmbedClosed();
      } catch {
        signingEmbedFinalizeLockRef.current = false;
        void syncSigningStateRef.current();
      }
    };

    window.addEventListener("message", handleYousignMessage);
    return () => window.removeEventListener("message", handleYousignMessage);
  }, [
    yousignEmbedUrl,
    signerId,
    sessionId,
    token,
    finalizeSigningEmbedClosed,
  ]);

  // ── Daily.co ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!liveRoomUrl) return;

    let cancelled = false;
    joinChimePlayedRef.current = false;
    const roomUrl = liveRoomUrl.startsWith("http")
      ? liveRoomUrl
      : `https://${liveRoomUrl}`;
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
      if (signerId && !joinChimePlayedRef.current) {
        joinChimePlayedRef.current = true;
        playRoomOpenChime();
      }
      fetch(`/api/session/${sessionId}/audit-event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          eventType: "video_joined",
          metadata: { daily_room_url: roomUrl },
        }),
      }).catch(() => {});
    });

    call.on("participant-joined", handleParticipantsChange);
    call.on("participant-updated", handleParticipantsChange);
    call.on("participant-left", handleParticipantsChange);

    call.on("recording-started", () => {
      if (!cancelled) setCloudRecordingActive(true);
    });
    call.on("recording-stopped", () => {
      if (!cancelled) setCloudRecordingActive(false);
    });
    call.on("recording-error", () => {
      if (!cancelled) setCloudRecordingActive(false);
    });

    // Screen share: use evt.type === "screenVideo" and evt.track directly —
    // no timing issues, no guessing which track type it is.
    call.on("track-started", (evt) => {
      if (cancelled) return;
      if (evt.type === "screenVideo" && evt.participant) {
        const p = evt.participant;
        const pId = p.local ? "local" : p.session_id;
        setCallItems((prev) => [
          ...prev.filter((item) => item.id !== `${pId}-screen`),
          { id: `${pId}-screen`, participant: p, videoTrack: evt.track, audioTrack: undefined, isScreenShare: true },
        ]);
        if (p.local) setIsSharingScreen(true);
      } else {
        updateParticipants(call);
      }
    });

    call.on("track-stopped", (evt) => {
      if (cancelled) return;
      if (evt.type === "screenVideo" && evt.participant) {
        const p = evt.participant;
        const pId = p.local ? "local" : p.session_id;
        setCallItems((prev) => prev.filter((item) => item.id !== `${pId}-screen`));
        if (p.local) setIsSharingScreen(false);
      } else {
        updateParticipants(call);
      }
    });

    call.on("left-meeting", () => {
      if (!cancelled) {
        setIsInCall(false);
        setCallItems([]);
        setCloudRecordingActive(false);
        fetch(`/api/session/${sessionId}/audit-event`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            eventType: "video_left",
            metadata: { daily_room_url: roomUrl },
          }),
        }).catch(() => {});
      }
    });

    call.on("waiting-participant-added", () => {
      if (!cancelled) setWaitingMessage("Waiting for other participants");
    });

    call.join({ userName: signerName }).catch((err) => {
      if (!cancelled)
        setWaitingMessage(`Connection error: ${err?.message || "Unknown"}`);
    });

    return () => {
      cancelled = true;
      callRef.current = null;
      call.leave().then(() => call.destroy());
    };
  }, [liveRoomUrl, updateParticipants, signerId, signers, sessionId, token]);

  // ── Control handlers ───────────────────────────────────────────────────────
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

  const logScreenShareAudit = (
    eventType: "video_screen_share_started" | "video_screen_share_stopped"
  ) => {
    const local = callRef.current?.participants()
      .local as DailyParticipant | undefined;
    fetch(`/api/session/${sessionId}/audit-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        eventType,
        metadata: { daily_user_name: local?.user_name ?? null },
      }),
    }).catch(() => {});
  };

  const toggleScreenShare = async () => {
    if (!callRef.current || !isInCall) return;
    if (isSharingScreen) {
      callRef.current.stopScreenShare();
      logScreenShareAudit("video_screen_share_stopped");
    } else {
      try {
        await callRef.current.startScreenShare();
        logScreenShareAudit("video_screen_share_started");
      } catch {
        // User cancelled the browser prompt
      }
    }
  };

  const leaveCall = () => {
    if (callRef.current) {
      callRef.current.leave();
      router.push(`/session/${sessionId}?token=${token}`);
    }
  };

  const handleLeaveCall = () => {
    setShowLeaveModal(true);
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

  // ── Derived state ──────────────────────────────────────────────────────────
  const showSigningOverlay =
    (isNotary && signingFlowStatus === "idle") || isMyTurnToSign;
  const sessionDone = currentStatus === "completed";
  const allSigsDone = signingFlowStatus === "completed" && !sessionDone;
  const showStatusPill =
    !showSigningOverlay &&
    !sessionDone &&
    !allSigsDone &&
    signingFlowStatus !== null &&
    signingFlowStatus !== "idle";

  // ── Session terminée — écran de redirection immédiat (couvre la room) ──────
  if (sessionDone && !isNotary) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-[#111213]">
        <div className="flex flex-col items-center gap-5 text-center max-w-sm px-6">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center">
            <BadgeCheck className="h-7 w-7 text-emerald-400" />
          </div>
          <div className="space-y-2">
            <h2 className="text-[16px] font-semibold text-white">
              Session closed
            </h2>
            <p className="text-sm text-white/40 leading-relaxed">
              The notary has closed this session. You are being redirected to your summary page…
            </p>
          </div>
          <Loader2 className="h-5 w-5 text-white/25 animate-spin" />
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Leave warning modal */}
      {showLeaveModal && (
        <LeaveWarningModal
          onConfirm={() => {
            setShowLeaveModal(false);
            leaveCall();
          }}
          onCancel={() => setShowLeaveModal(false)}
        />
      )}

      {/* Placement Picker — fixed fullscreen modal */}
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

      {/* ── ROOM LAYOUT ── */}
      <div className="flex flex-col h-screen bg-[#111213] overflow-hidden">

        {/* ── TOP BAR ── */}
        <header className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-4 h-[52px] shrink-0 bg-[#0c0d0f]/95 border-b border-white/[0.07] z-20 backdrop-blur-sm">
          <div className="flex items-center gap-3 min-w-0 justify-self-start">
            <Image
              src={MY_NOTARY_LOGO_SRC}
              alt="MyNotary"
              width={120}
              height={20}
              unoptimized
              className="h-5 w-auto brightness-0 invert opacity-75 shrink-0"
            />
            {workflowLabel && (
              <span className="text-[11px] text-white/35 border-l border-white/[0.12] pl-3 truncate hidden sm:block">
                {workflowLabel}
              </span>
            )}
          </div>

          <div className="flex justify-center min-w-0 max-w-[min(100vw-10rem,28rem)] justify-self-center px-1">
            {showStatusPill && expectedActorText && (
              <div
                className="flex items-center gap-2 px-3 py-1.5 bg-black/70 backdrop-blur-sm rounded-full border border-white/[0.1] text-[11px] text-white/70 pointer-events-none min-w-0 w-full max-w-full"
                role="status"
                aria-live="polite"
              >
                <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-400" />
                </span>
                <span className="truncate text-center">{expectedActorText}</span>
              </div>
            )}
            {allSigsDone && (
              <div
                className="flex items-center gap-2 px-3 py-1.5 bg-emerald-950/80 backdrop-blur-sm rounded-full border border-emerald-500/20 text-[11px] text-emerald-300 pointer-events-none min-w-0 w-full max-w-full"
                role="status"
                aria-live="polite"
              >
                <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                <span className="truncate text-center">
                  All signatures complete — waiting for the notary to close the
                  session
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-0.5 shrink-0 justify-self-end">
            {cloudRecordingActive && (
              <div
                className="flex items-center gap-2 mr-1.5 pr-2.5 border-r border-white/[0.1]"
                title="Recording in progress"
                role="status"
                aria-live="polite"
                aria-label="Recording in progress"
              >
                <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                </span>
                <span className="text-[11px] font-medium text-red-400/95 whitespace-nowrap max-sm:sr-only">
                  Recording in progress
                </span>
              </div>
            )}
            {(
              [
                { id: "signers", Icon: Users, label: "Signers" },
                { id: "documents", Icon: Files, label: "Documents" },
                { id: "audit", Icon: ScrollText, label: "Audit trail" },
              ] as Array<{
                id: "signers" | "documents" | "audit";
                Icon: ElementType;
                label: string;
              }>
            ).map(({ id, Icon, label }) => (
              <button
                key={id}
                type="button"
                onClick={() =>
                  setActivePanel((p) => (p === id ? null : id))
                }
                title={label}
                aria-label={label}
                className={`flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${
                  activePanel === id
                    ? "bg-white/[0.14] text-white"
                    : "text-white/40 hover:text-white/80 hover:bg-white/[0.08]"
                }`}
              >
                <Icon className="h-[18px] w-[18px]" />
              </button>
            ))}
          </div>
        </header>

        {/* ── MAIN CONTENT ── */}
        <div className="flex-1 relative overflow-hidden">

          {/* Video tiles */}
          <div
            className={`absolute inset-0 p-2 transition-[right] duration-300 ease-in-out ${
              activePanel ? "right-[320px]" : "right-0"
            }`}
          >
            {!liveRoomUrl ? (
              <div className="h-full flex items-center justify-center">
                <p className="text-white/25 text-sm select-none">
                  Waiting for the notary to join…
                </p>
              </div>
            ) : callItems.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-2">
                <Loader2 className="h-6 w-6 text-white/25 animate-spin" />
                <p className="text-white/25 text-xs">Connecting to video…</p>
              </div>
            ) : (
              <div
                className="h-full grid gap-2"
                style={{
                  gridTemplateColumns:
                    callItems.length <= 2
                      ? `repeat(${callItems.length}, 1fr)`
                      : "repeat(2, 1fr)",
                  gridTemplateRows:
                    callItems.length <= 2
                      ? "1fr"
                      : `repeat(${Math.ceil(callItems.length / 2)}, 1fr)`,
                }}
              >
                {callItems.map((item) => {
                  const remoteIsKnownSigner =
                    !item.participant.local &&
                    signerRows.some(
                      (s) =>
                        s.name.trim().toLowerCase() ===
                        (item.participant.user_name ?? "").trim().toLowerCase()
                    );
                  const tileRole: "signer" | "notary" = item.participant.local
                    ? "signer"
                    : remoteIsKnownSigner
                    ? "signer"
                    : "notary";
                  return (
                    <div
                      key={item.id}
                      className="min-w-0 min-h-0 overflow-hidden rounded-xl"
                    >
                      <VideoTile
                        id={item.id}
                        videoTrack={item.videoTrack}
                        audioTrack={item.audioTrack}
                        userName={item.participant.user_name}
                        isLocal={item.participant.local}
                        role={tileRole}
                        isScreenShare={item.isScreenShare}
                      />
                    </div>
                  );
                })}
              </div>
            )}

            {/* Connection / waiting message */}
            {waitingMessage && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-black/60 backdrop-blur-sm rounded-full text-xs text-white/50 pointer-events-none whitespace-nowrap">
                {waitingMessage}
              </div>
            )}
          </div>

          {/* ── SIDE PANEL ── */}
          <div
            className={`absolute right-0 top-0 bottom-0 w-[320px] bg-[#15161a] border-l border-white/[0.07] z-20 flex flex-col overflow-hidden transition-transform duration-300 ease-in-out ${
              activePanel ? "translate-x-0" : "translate-x-full"
            }`}
          >
            {activePanel && (
              <>
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.07] shrink-0">
                  <h3 className="text-[13px] font-semibold text-white/70">
                    {activePanel === "signers"
                      ? "Signers"
                      : activePanel === "documents"
                      ? "Documents"
                      : "Audit trail"}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setActivePanel(null)}
                    className="text-white/30 hover:text-white/70 transition-colors p-1 rounded-md hover:bg-white/[0.07]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                  {/* Signers panel */}
                  {activePanel === "signers" && (
                    <>
                      {signerRows.map((s) => (
                        <div
                          key={s.id}
                          className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.05]"
                        >
                          <span className="text-sm text-white/65 truncate pr-3">
                            {s.name}
                          </span>
                          {s.signed_at ? (
                            <Badge
                              variant="success"
                              className="shrink-0 text-[11px]"
                            >
                              Signed
                            </Badge>
                          ) : s.kyc_status === "approved" ? (
                            <Badge
                              variant="warning"
                              className="shrink-0 text-[11px]"
                            >
                              Pending
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="shrink-0 text-[11px] border-white/20 text-white/35"
                            >
                              KYC
                            </Badge>
                          )}
                        </div>
                      ))}
                      {signerRows.length === 0 && (
                        <p className="text-xs text-white/25 text-center py-6">
                          No signers
                        </p>
                      )}
                    </>
                  )}

                  {/* Documents panel */}
                  {activePanel === "documents" && (
                    <>
                      {workflowDocs.length > 0
                        ? workflowDocs.map((doc) => {
                            const isCurrent = doc.id === currentDocumentId;
                            let statusLabel = "Upcoming";
                            let statusCls = "text-white/25";
                            if (
                              signingFlowStatus === "idle" &&
                              doc.status !== "completed" &&
                              doc.status !== "cancelled"
                            ) {
                              statusLabel = "Not started";
                              statusCls = "text-white/25";
                            } else if (doc.status === "completed") {
                              statusLabel = "Signed ✓";
                              statusCls = "text-emerald-400";
                            } else if (doc.status === "cancelled") {
                              statusLabel = "Cancelled";
                              statusCls = "text-red-400";
                            } else if (
                              isCurrent &&
                              expectedActorRole === "notary"
                            ) {
                              statusLabel = "Notary's turn";
                              statusCls = "text-blue-400";
                            } else if (
                              isCurrent &&
                              expectedActorRole === "signer"
                            ) {
                              statusLabel = isMyTurnToSign
                                ? "Your turn ✍"
                                : "Signer's turn";
                              statusCls = isMyTurnToSign
                                ? "text-amber-300 font-semibold"
                                : "text-amber-400";
                            } else if (isCurrent) {
                              statusLabel = "In progress";
                              statusCls = "text-sky-400";
                            }
                            return (
                              <div
                                key={doc.id}
                                className={`flex flex-col gap-1.5 rounded-lg px-3 py-2.5 border ${
                                  isCurrent
                                    ? "bg-white/[0.06] border-white/[0.1]"
                                    : "bg-white/[0.03] border-white/[0.05]"
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <span className="text-xs text-white/65 font-medium leading-snug truncate">
                                    {`Doc ${doc.document_order + 1} – ${doc.label.replace(/\.[^/.]+$/, "")}`}
                                  </span>
                                  <a
                                    href={`/api/session/${sessionId}/document?documentId=${doc.id}&token=${token}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="shrink-0 p-1 rounded hover:bg-white/10 transition-colors"
                                  >
                                    <ExternalLink className="h-3 w-3 text-white/25" />
                                  </a>
                                </div>
                                <span className={`text-[11px] ${statusCls}`}>
                                  {statusLabel}
                                </span>
                              </div>
                            );
                          })
                        : documents
                            .filter((d) => d.source === "submission")
                            .map((doc) => (
                              <div
                                key={doc.id}
                                className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.05]"
                              >
                                <span className="text-xs text-white/60 truncate">
                                  {doc.label.replace(/\.[^/.]+$/, "")}
                                </span>
                                <span className="text-[11px] text-white/25 shrink-0 ml-2">
                                  Pending
                                </span>
                              </div>
                            ))}
                      {workflowDocs.length === 0 &&
                        documents.filter((d) => d.source === "submission")
                          .length === 0 && (
                          <p className="text-xs text-white/25 text-center py-6">
                            No documents
                          </p>
                        )}
                    </>
                  )}

                  {/* Audit panel */}
                  {activePanel === "audit" && (
                    <DarkAuditList events={auditEvents} />
                  )}
                </div>
              </>
            )}
          </div>

          {/* ── SIGNING CENTER OVERLAY ── */}
          {showSigningOverlay && (
            <div className="absolute inset-0 z-30">
              {yousignEmbedUrl ? (
                /* YouSign iframe — centered card over video */
                <div className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-[2px] p-4 sm:p-6">
                  <div
                    className="w-full bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
                    style={{
                      maxWidth: "920px",
                      height: "100%",
                      maxHeight: "820px",
                    }}
                  >
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-white shrink-0">
                      <div className="flex items-center gap-2">
                        <PenLine className="h-4 w-4 text-blue-600 shrink-0" />
                        <span className="text-sm font-medium text-gray-700">
                          Secure electronic signature
                        </span>
                        {currentDocumentName && (
                          <span className="text-gray-400 text-xs hidden sm:inline">
                            ·{" "}
                            {currentDocumentName.replace(/\.[^/.]+$/, "")}
                          </span>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs h-7 text-gray-400 hover:text-gray-700 shrink-0"
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
                    <iframe
                      src={yousignEmbedUrl}
                      title="Signature YouSign"
                      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                      referrerPolicy="strict-origin-when-cross-origin"
                      className="flex-1 w-full border-0"
                    />
                  </div>
                </div>
              ) : (
                /* Status card — centered with dark overlay */
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-[3px]">
                  <div className="w-full max-w-sm mx-4 bg-[#1c1f24] border border-white/[0.1] rounded-2xl shadow-2xl overflow-hidden">
                    {isNotary && signingFlowStatus === "idle" ? (
                      /* Notary: Start signing */
                      <div className="p-8 flex flex-col items-center gap-5 text-center">
                        <div className="w-14 h-14 rounded-2xl bg-[#2563eb]/15 border border-[#2563eb]/20 flex items-center justify-center">
                          <FileSearch className="h-7 w-7 text-[#60a5fa]" />
                        </div>
                        <div className="space-y-2">
                          <h3 className="text-[15px] font-semibold text-white">
                            Signing not started
                          </h3>
                          <p className="text-sm text-white/40 leading-relaxed">
                            Explain the deeds to the signers first. When ready,
                            start the signing flow.
                          </p>
                        </div>
                        <Button
                          size="lg"
                          className="w-full bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-medium border-0 shadow-md"
                          onClick={handleStartSigning}
                          disabled={startingSigning}
                        >
                          {startingSigning ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Starting…
                            </>
                          ) : (
                            "Start signing →"
                          )}
                        </Button>
                        <button
                          type="button"
                          onClick={() => syncSigningStateRef.current()}
                          className="text-white/20 hover:text-white/40 transition-colors"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : isMyTurnToSign && !placementConfirmed ? (
                      /* Signer: Place signature */
                      <div className="p-8 flex flex-col items-center gap-5 text-center">
                        <div className="w-14 h-14 rounded-2xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center">
                          <UserPen className="h-7 w-7 text-amber-400" />
                        </div>
                        <div className="space-y-2">
                          <h3 className="text-[15px] font-semibold text-white">
                            Place your signature
                          </h3>
                          <p className="text-sm text-white/40 leading-relaxed">
                            Choose where your signature goes on the document
                            before signing.
                          </p>
                        </div>
                        <Button
                          size="lg"
                          className="w-full bg-[#2563eb] hover:bg-[#1d4ed8] text-white border-0 shadow-md"
                          onClick={() => setShowPlacementPicker(true)}
                          disabled={!currentDocumentId}
                        >
                          Place my signature →
                        </Button>
                      </div>
                    ) : yousignLoading ||
                      (placementConfirmed &&
                        !yousignEmbedUrl &&
                        !yousignError) ? (
                      /* Loading */
                      <div className="p-8 flex flex-col items-center gap-5 text-center">
                        <div className="w-14 h-14 rounded-2xl bg-[#2563eb]/15 border border-[#2563eb]/20 flex items-center justify-center">
                          <Loader2 className="h-7 w-7 text-[#60a5fa] animate-spin" />
                        </div>
                        <div className="space-y-2">
                          <h3 className="text-[15px] font-semibold text-white">
                            Preparing your signature
                          </h3>
                          <p className="text-sm text-white/40">
                            Opening the secure YouSign workspace…
                          </p>
                        </div>
                      </div>
                    ) : (
                      /* Error / rate limit */
                      <div className="p-8 flex flex-col items-center gap-5 text-center">
                        <div className="w-14 h-14 rounded-2xl bg-red-500/15 border border-red-500/20 flex items-center justify-center">
                          <CircleAlert className="h-7 w-7 text-red-400" />
                        </div>
                        <div className="space-y-2">
                          <h3 className="text-[15px] font-semibold text-white">
                            Signature unavailable
                          </h3>
                          <p className="text-sm text-white/40">
                            {rateLimitRetryIn > 0
                              ? `YouSign rate limit — retry in ${rateLimitRetryIn}s`
                              : yousignError ||
                                "YouSign signing link unavailable."}
                          </p>
                        </div>
                        <div className="flex gap-2 w-full">
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 border-white/15 text-white/70 hover:bg-white/[0.08] hover:text-white bg-transparent"
                            onClick={() => syncSigningStateRef.current()}
                          >
                            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                            Refresh
                          </Button>
                          {(yousignError || rateLimitRetryIn > 0) && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1 border-white/15 text-white/70 hover:bg-white/[0.08] hover:text-white bg-transparent"
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
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── BOTTOM CONTROLS ── */}
        <footer className="flex items-center justify-center gap-2 py-3 px-6 bg-[#0c0d0f]/95 border-t border-white/[0.07] shrink-0 z-20 backdrop-blur-sm">
          <RoomControlBtn
            icon={isVideoOn ? Video : VideoOff}
            label={isVideoOn ? "Camera" : "Camera off"}
            onClick={toggleVideo}
            active={isVideoOn}
            disabled={!isInCall}
          />
          <RoomControlBtn
            icon={isAudioOn ? Mic : MicOff}
            label={isAudioOn ? "Mic" : "Muted"}
            onClick={toggleAudio}
            active={isAudioOn}
            disabled={!isInCall}
          />
          <RoomControlBtn
            icon={isSharingScreen ? ScreenShareOff : ScreenShare}
            label={isSharingScreen ? "Stop share" : "Share screen"}
            onClick={toggleScreenShare}
            active={isSharingScreen}
            disabled={!isInCall}
          />
          <RoomControlBtn
            icon={PhoneOff}
            label="Leave"
            onClick={handleLeaveCall}
            danger
          />
        </footer>
      </div>
    </>
  );
}
