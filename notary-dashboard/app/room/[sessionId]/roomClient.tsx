"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Daily from "@daily-co/daily-js";
import type { DailyCall, DailyParticipant } from "@daily-co/daily-js";
import { Video, VideoOff, Mic, MicOff, PhoneOff } from "lucide-react";

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

interface SigningStateResponse {
  sessionStatus?: string;
  signingFlowStatus?: string;
  currentDocument?: {
    id: string;
    label: string;
    document_order: number;
    status: string;
  } | null;
  expectedActor?: {
    role: "signer" | "notary";
    sessionSignerId?: string | null;
    signerName?: string | null;
    notaryId?: string | null;
  } | null;
}

function VideoTile({
  id,
  videoTrack,
  audioTrack,
  userName,
  isLocal,
}: {
  id: string;
  videoTrack: MediaStreamTrack | undefined;
  audioTrack: MediaStreamTrack | undefined;
  userName: string;
  isLocal: boolean;
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

  return (
    <div className="relative w-full h-full min-h-[140px] bg-muted rounded-lg overflow-hidden flex items-center justify-center">
      {videoTrack ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className="absolute inset-0 w-full h-full object-contain bg-black"
        />
      ) : (
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <div className="w-16 h-16 rounded-full bg-muted-foreground/20 flex items-center justify-center">
            <span className="text-2xl font-semibold">
              {userName?.charAt(0)?.toUpperCase() || "?"}
            </span>
          </div>
          <span className="text-sm">{userName || "Participant"}</span>
          <span className="text-xs">Caméra désactivée</span>
        </div>
      )}
      {audioTrack && !isLocal && <audio ref={audioRef} autoPlay playsInline />}
      <div className="absolute bottom-2 left-2 flex items-center gap-2">
        <span
          className={`rounded-md px-2 py-1 text-[11px] font-semibold shadow ${
            isLocal ? "bg-blue-600/95 text-white" : "bg-amber-400/95 text-black"
          }`}
        >
          {isLocal ? "Notaire" : "Participant"}
        </span>
        <span className="rounded-md border border-white/20 bg-black/80 px-2 py-1 text-[11px] font-medium text-white shadow">
          {userName || "Participant"}
          {isLocal && " • Vous"}
        </span>
      </div>
    </div>
  );
}

export function NotaryRoomClient({
  sessionId,
  initialStatus,
  initialRoomUrl,
  signers,
  initialDocuments,
}: {
  sessionId: string;
  initialStatus: string;
  initialRoomUrl: string | null;
  signers: Signer[];
  initialDocuments: DocumentItem[];
}) {
  const [documents, setDocuments] = useState<DocumentItem[]>(
    initialDocuments?.length ? initialDocuments : []
  );
  const callRef = useRef<DailyCall | null>(null);
  const [currentStatus, setCurrentStatus] = useState(initialStatus);
  const [dailyRoomUrl, setDailyRoomUrl] = useState(initialRoomUrl);
  const [starting, setStarting] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isAudioOn, setIsAudioOn] = useState(true);
  const [isInCall, setIsInCall] = useState(false);
  const [callItems, setCallItems] = useState<CallItem[]>([]);
  const [waitingMessage, setWaitingMessage] = useState<string | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [yousignEmbedUrl, setYousignEmbedUrl] = useState<string | null>(null);
  const [yousignLoading, setYousignLoading] = useState(false);
  const [yousignError, setYousignError] = useState<string | null>(null);
  const [workflowLabel, setWorkflowLabel] = useState<string | null>(null);
  const [expectedActorText, setExpectedActorText] = useState<string | null>(null);

  const updateParticipants = useCallback((call: DailyCall) => {
    const participants = call.participants();
    const items: CallItem[] = [];
    for (const [id, participant] of Object.entries(participants)) {
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
    const call = Daily.createCallObject({
      url: roomUrl,
      subscribeToTracksAutomatically: true,
      allowMultipleCallInstances: true,
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
    });
    call.on("participant-joined", handleParticipantsChange);
    call.on("participant-updated", handleParticipantsChange);
    call.on("participant-left", handleParticipantsChange);
    call.on("left-meeting", () => {
      if (!cancelled) {
        setIsInCall(false);
        setCallItems([]);
      }
    });
    call.on("waiting-participant-added", () => {
      if (!cancelled) setWaitingMessage("En attente d'autres participants");
    });

    call.join().catch((err) => {
      if (!cancelled) setWaitingMessage(`Erreur de connexion: ${err?.message || "Inconnue"}`);
    });

    return () => {
      cancelled = true;
      callRef.current = null;
      call.leave().then(() => call.destroy());
    };
  }, [dailyRoomUrl, updateParticipants]);

  const startVisio = async () => {
    setStarting(true);
    setWaitingMessage(null);
    try {
      const res = await fetch(`/api/session/${sessionId}/daily-room`, { method: "POST" });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setWaitingMessage(data.error || "Impossible de démarrer la visio");
        return;
      }
      setDailyRoomUrl(data.url);
      setCurrentStatus("in_session");
    } catch {
      setWaitingMessage("Erreur réseau");
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
    if (window.confirm("Êtes-vous sûr de vouloir quitter l'appel ?")) {
      leaveCall();
    }
  };

  const kycReady = signers.length > 0 && signers.every((s) => s.kyc_status === "approved");
  const availableDocuments = documents.filter((d) => d.status === "available" && !!d.url);
  const selectedDocument =
    availableDocuments.find((d) => d.id === selectedDocumentId) ?? availableDocuments[0] ?? null;
  const videoRowsClass = "flex flex-col gap-3 flex-1 min-h-0 h-full";

  useEffect(() => {
    if (!selectedDocumentId && availableDocuments.length) {
      setSelectedDocumentId(availableDocuments[0].id);
    }
  }, [availableDocuments, selectedDocumentId]);

  useEffect(() => {
    const loadYousignEmbed = async () => {
      setYousignLoading(true);
      setYousignError(null);
      setYousignEmbedUrl(null);

      try {
        const res = await fetch(
          `/api/session/${sessionId}/yousign-embed`,
          { cache: "no-store" }
        );
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

        if (res.ok && payload.embedUrl) {
          setYousignEmbedUrl(payload.embedUrl);
          setYousignError(null);
          if (payload.documentLabel && typeof payload.documentOrder === "number") {
            setWorkflowLabel(`Document ${payload.documentOrder + 1}: ${payload.documentLabel}`);
          }
          return;
        }

        if (payload.completed) {
          setYousignError(payload.message || "Tous les documents sont signés.");
          return;
        }

        if (payload.waiting) {
          setYousignError(payload.message || "En attente de la prochaine étape.");
          return;
        }

        if (payload.signed) {
          setYousignError(payload.message || "Signature notaire finalisée.");
          return;
        }

        setYousignError(payload.error || payload.message || "Lien Yousign indisponible");
      } catch {
        setYousignError("Erreur de chargement Yousign");
      } finally {
        setYousignLoading(false);
      }
    };

    loadYousignEmbed();
    const interval = setInterval(loadYousignEmbed, 5000);
    return () => clearInterval(interval);
  }, [sessionId]);

  useEffect(() => {
    const syncSigningState = async () => {
      try {
        const res = await fetch(`/api/session/${sessionId}/signing-state`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const payload = (await res.json()) as SigningStateResponse;
        if (payload.sessionStatus) setCurrentStatus(payload.sessionStatus);
        setWorkflowLabel(
          payload.currentDocument
            ? `Document ${payload.currentDocument.document_order + 1}: ${payload.currentDocument.label}`
            : null
        );
        if (payload.expectedActor?.role === "signer") {
          setExpectedActorText(
            payload.expectedActor.signerName
              ? `En attente de la signature de ${payload.expectedActor.signerName}.`
              : "En attente de la signature des signataires."
          );
        } else if (payload.expectedActor?.role === "notary") {
          setExpectedActorText("C'est votre tour: signez et apposez le tampon.");
        } else {
          setExpectedActorText(null);
        }
      } catch {
        // Ignore polling failures
      }
    };

    syncSigningState();
    const interval = setInterval(syncSigningState, 4000);
    return () => clearInterval(interval);
  }, [sessionId]);

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-[calc(100vh-2rem)]">
      <div className="w-full lg:w-80 flex-shrink-0 flex flex-col gap-4 h-full min-h-0 lg:order-1">
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

        <Card>
          <CardHeader className="py-2">
            <h2 className="text-lg font-semibold">Statut</h2>
          </CardHeader>
          <CardContent className="py-2">
            <Badge variant="secondary" className="capitalize">
              {currentStatus.replace(/_/g, " ")}
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-2">
            <h2 className="text-lg font-semibold">Signataires</h2>
          </CardHeader>
          <CardContent className="py-2 space-y-2">
            {signers.map((s) => (
              <div key={s.id} className="flex items-center justify-between text-sm p-2 rounded">
                <span>{s.name}</span>
                {s.signed_at ? (
                  <Badge variant="success">Signé</Badge>
                ) : s.kyc_status === "approved" ? (
                  <Badge variant="warning">En attente</Badge>
                ) : (
                  <Badge variant="outline">KYC</Badge>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-2">
            <h2 className="text-lg font-semibold">Statut des documents</h2>
          </CardHeader>
          <CardContent className="py-2 space-y-2">
            {documents.length > 0 ? (
              documents.map((doc) => (
                <div
                  key={`status-${doc.id}`}
                  className="flex items-center justify-between text-sm p-2 rounded"
                >
                  <span className="truncate pr-2">{doc.label}</span>
                  {doc.status === "available" ? (
                    <Badge variant="success">Disponible</Badge>
                  ) : (
                    <Badge variant="secondary">En attente</Badge>
                  )}
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Aucun document</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-muted-foreground">
              Signature Yousign : l&apos;embed s&apos;affichera lorsque ce sera
              votre tour de signer.
            </p>
          </CardContent>
        </Card>

        {dailyRoomUrl && isInCall && (
          <div className="mt-auto sticky bottom-0 bg-background/95 backdrop-blur-sm pt-2 border-t">
            <div className="flex items-center justify-center gap-3 py-2">
              <Button
                variant={isVideoOn ? "outline" : "destructive"}
                size="icon"
                onClick={toggleVideo}
                title={isVideoOn ? "Désactiver la caméra" : "Activer la caméra"}
                className="h-12 w-12 rounded-full"
              >
                {isVideoOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
              </Button>
              <Button
                variant={isAudioOn ? "outline" : "destructive"}
                size="icon"
                onClick={toggleAudio}
                title={isAudioOn ? "Couper le micro" : "Activer le micro"}
                className="h-12 w-12 rounded-full"
              >
                {isAudioOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
              </Button>
              <Button
                variant="destructive"
                size="icon"
                onClick={handleLeaveCall}
                title="Quitter l'appel"
                className="h-12 w-12 rounded-full"
              >
                <PhoneOff className="h-5 w-5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col lg:flex-row gap-4 min-h-0 min-w-0 lg:order-2">
        <Card className="flex-1 min-h-0 flex flex-col min-w-0">
          <CardContent className="flex-1 min-h-0 p-4 flex flex-col">
            {!dailyRoomUrl ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-4">
                <p className="text-muted-foreground text-center p-4">
                  {kycReady
                    ? "Tous les signataires ont validé leur identité."
                    : "En attente : tous les signataires doivent valider leur identité (KYC)."}
                </p>
                {kycReady && (
                  <Button onClick={startVisio} disabled={starting}>
                    {starting ? "Démarrage..." : "Démarrer la visio"}
                  </Button>
                )}
                {waitingMessage && <p className="text-sm text-destructive">{waitingMessage}</p>}
              </div>
            ) : (
              <div className="flex-1 min-h-[200px] flex flex-col gap-2 overflow-hidden">
                {waitingMessage && (
                  <p className="text-sm text-muted-foreground py-2 flex-shrink-0">{waitingMessage}</p>
                )}
                <div className={videoRowsClass}>
                  {callItems.map((item) => (
                    <div key={item.id} className="min-w-0 min-h-0 flex-1">
                      <VideoTile
                        id={item.id}
                        videoTrack={item.videoTrack}
                        audioTrack={item.audioTrack}
                        userName={item.participant.user_name}
                        isLocal={item.participant.local}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="w-full lg:w-[42rem] lg:min-w-[42rem] flex-shrink-0 flex flex-col">
          <CardContent className="flex-1 min-h-0 py-2 px-2 flex flex-col gap-2 overflow-hidden">
            {availableDocuments.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {availableDocuments.map((doc) => (
                  <Button
                    key={doc.id}
                    size="sm"
                    variant={selectedDocument?.id === doc.id ? "default" : "secondary"}
                    onClick={() => setSelectedDocumentId(doc.id)}
                    className="max-w-full"
                  >
                    <span className="truncate max-w-[220px]">{doc.label}</span>
                  </Button>
                ))}
              </div>
            )}
            <div className="flex-1 min-h-0 rounded-md border bg-muted/20 overflow-hidden">
              {yousignLoading ? (
                <div className="w-full h-full min-h-[420px] flex items-center justify-center text-sm text-muted-foreground">
                  Chargement de la signature Yousign...
                </div>
              ) : yousignEmbedUrl ? (
                <iframe
                  src={yousignEmbedUrl}
                  title="Yousign Signature"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                  referrerPolicy="strict-origin-when-cross-origin"
                  className="w-full h-full min-h-[420px]"
                />
              ) : (
                <div className="w-full h-full min-h-[420px] flex items-center justify-center p-4 text-sm text-muted-foreground text-center">
                  {yousignError || expectedActorText || "Lien de signature Yousign indisponible."}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
