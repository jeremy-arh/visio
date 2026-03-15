"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Daily from "@daily-co/daily-js";
import type { DailyCall, DailyParticipant } from "@daily-co/daily-js";
import { Video, VideoOff, Mic, MicOff, PhoneOff } from "lucide-react";

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
          className="absolute inset-0 w-full h-full object-cover"
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
            isLocal ? "bg-amber-400/95 text-black" : "bg-blue-600/95 text-white"
          }`}
        >
          {isLocal ? "Participant" : "Notaire"}
        </span>
        <span className="rounded-md border border-white/20 bg-black/80 px-2 py-1 text-[11px] font-medium text-white shadow">
          {userName || "Participant"}
          {isLocal && " • Vous"}
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

export function RoomClient({
  sessionId,
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
    { id: "session-document", label: "Document à notariser", url: documentUrl ?? "", status: documentUrl ? "available" : "pending" },
    { id: "session-stamped", label: "Document tamponné", url: stampedDocumentUrl ?? "", status: stampedDocumentUrl ? "available" : "pending" },
    { id: "session-signed", label: "Document signé", url: signedDocumentUrl ?? "", status: signedDocumentUrl ? "available" : "pending" },
  ];
  const fallbackDocs: DocumentItem[] = initialDocuments?.length ? initialDocuments : baseDocs;

  const [documents, setDocuments] = useState<DocumentItem[]>(fallbackDocs);
  const router = useRouter();
  const callRef = useRef<DailyCall | null>(null);
  const [currentStatus, setCurrentStatus] = useState(status);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isAudioOn, setIsAudioOn] = useState(true);
  const [isInCall, setIsInCall] = useState(false);
  const [callItems, setCallItems] = useState<CallItem[]>([]);
  const [waitingMessage, setWaitingMessage] = useState<string | null>(null);
  const [yousignEmbedUrl, setYousignEmbedUrl] = useState<string | null>(null);
  const [yousignLoading, setYousignLoading] = useState(false);
  const [yousignError, setYousignError] = useState<string | null>(null);

  const updateParticipants = useCallback((call: DailyCall) => {
    const participants = call.participants();
    const items: CallItem[] = [];
    for (const [id, participant] of Object.entries(participants)) {
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
    const channel = supabase
      .channel(`session-room-${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notarization_sessions",
          filter: `id=eq.${sessionId}`,
        },
        async (payload) => {
          const newData = payload.new as { status: string };
          setCurrentStatus(newData.status);
          // Rafraîchir les documents si la session a été mise à jour
          const res = await fetch(`/api/session/${sessionId}/documents`);
          if (res.ok) {
            const data = await res.json();
            if (data?.documents?.length) setDocuments(data.documents);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId]);

  useEffect(() => {
    if (currentStatus === "completed") {
      router.push(`/session/${sessionId}/completed?token=${token}`);
    }
  }, [currentStatus, sessionId, token, router]);

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
    if (window.confirm("Êtes-vous sûr de vouloir quitter l'appel ?")) {
      leaveCall();
    }
  };

  useEffect(() => {
    let cancelled = false;

    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      });

    const loadYousignEmbed = async () => {
      if (!signerId) {
        setYousignEmbedUrl(null);
        setYousignError("Aucun signataire disponible.");
        setYousignLoading(false);
        return;
      }

      setYousignLoading(true);
      setYousignError(null);
      setYousignEmbedUrl(null);

      let lastError = "Lien Yousign indisponible";
      for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
          const res = await fetch(
            `/api/session/${sessionId}/yousign-embed?signerId=${encodeURIComponent(signerId)}&token=${encodeURIComponent(token)}`,
            { cache: "no-store" }
          );
          const payload = (await res.json()) as {
            embedUrl?: string;
            error?: string;
            signed?: boolean;
            message?: string;
          };

          if (res.ok && payload.signed) {
            if (!cancelled) {
              setYousignEmbedUrl(null);
              setYousignError(payload.message || "Signature deja finalisee.");
              setYousignLoading(false);
            }
            return;
          }

          if (res.ok && payload.embedUrl) {
            if (!cancelled) {
              setYousignEmbedUrl(payload.embedUrl);
              setYousignError(null);
              setYousignLoading(false);
            }
            return;
          }

          lastError = payload.error || "Lien Yousign indisponible";
        } catch {
          lastError = "Erreur de chargement Yousign";
        }

        if (attempt < 9) {
          await wait(1500);
          if (cancelled) return;
        }
      }

      if (!cancelled) {
        setYousignError(lastError);
        setYousignLoading(false);
      }
    };

    loadYousignEmbed();

    return () => {
      cancelled = true;
    };
  }, [sessionId, signerId, token]);

  return (
    <div className="relative h-[calc(100vh-2rem)] bg-muted/20 p-2 flex flex-col">
      <div className="mb-2 flex items-center gap-2 flex-shrink-0">
        <img
          src="https://jlizwheftlnhoifbqeex.supabase.co/storage/v1/object/public/assets/logo/logo-noir.svg"
          alt="MyNotary"
          className="h-[15px] w-auto"
        />
        <span className="text-[11px] text-muted-foreground">Session: {sessionId}</span>
      </div>
      <div className="grid flex-1 min-h-0 grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr_320px]">
        <Card className="min-h-0 flex flex-col">
          <CardContent className="flex-1 min-h-0 p-2 flex flex-col">
            {!dailyRoomUrl ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-muted-foreground text-center p-4">
                  La salle vidéo sera disponible lorsque le notaire aura rejoint.
                  <br />
                  <span className="text-sm">(Intégration Daily.co à configurer)</span>
                </p>
              </div>
            ) : (
              <div className="flex-1 min-h-[200px] flex flex-col gap-2 overflow-hidden">
                {waitingMessage && (
                  <p className="text-sm text-muted-foreground py-2 flex-shrink-0">{waitingMessage}</p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 flex-1 min-h-0 auto-rows-min">
                  {callItems.map((item) => (
                    <div key={item.id} className="min-w-0 aspect-video">
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

        <Card className="min-h-0 flex flex-col">
          <CardContent className="flex-1 min-h-0 p-2 flex flex-col gap-2">
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
                  {yousignError || "Lien Yousign indisponible."}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4 h-full min-h-0">
          <Card>
            <CardContent className="py-2">
              <Badge variant="secondary" className="capitalize">
                {currentStatus.replace("_", " ")}
              </Badge>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-2 space-y-2">
              {signers.map((s) => (
                <div
                  key={s.id}
                  className={`flex items-center justify-between text-sm p-2 rounded ${
                    s.id === signerId ? "bg-accent" : ""
                  }`}
                >
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
      </div>
    </div>
  );
}
