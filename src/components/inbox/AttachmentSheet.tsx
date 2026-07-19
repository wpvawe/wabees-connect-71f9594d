import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faImage, faVideo, faFile, faMusic, faXmark } from "@fortawesome/free-solid-svg-icons";
import { toast } from "sonner";

export type AttachKind = "image" | "video" | "document" | "audio";

// WhatsApp Cloud API supported document types (Meta docs).
// Anything else must be blocked before we upload — Meta returns (#100).
const DOC_ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt," +
  "application/pdf,application/msword," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  "application/vnd.ms-excel," +
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet," +
  "application/vnd.ms-powerpoint," +
  "application/vnd.openxmlformats-officedocument.presentationml.presentation," +
  "text/plain";

const BLOCKED_DOC_EXTS = new Set([
  "zip", "rar", "7z", "tar", "gz", "apk", "exe", "dmg", "iso", "csv", "rtf",
]);

function isDocumentAllowed(file: File): boolean {
  const name = file.name.toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  if (BLOCKED_DOC_EXTS.has(ext)) return false;
  return true;
}

/**
 * WhatsApp-style attachment bottom sheet matching the Flutter app's
 * _showAttachmentOptions — separate tiles per media kind so the OS file
 * picker filters correctly.
 */
export function AttachmentSheet({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (file: File, kind: AttachKind, caption?: string) => void;
}) {
  const [pending, setPending] = useState<{ file: File; kind: AttachKind } | null>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);

  // ESC closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function handleFile(kind: AttachKind, file: File | undefined) {
    if (!file) return;
    if (kind === "document" && !isDocumentAllowed(file)) {
      toast.error(
        "WhatsApp does not allow this file type. Supported: PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, TXT.",
      );
      onClose();
      return;
    }
    // Image / video get an optional caption preview. Doc & audio send directly.
    if (kind === "image" || kind === "video") {
      setPending({ file, kind });
    } else {
      onPick(file, kind);
      onClose();
    }
  }

  if (!open && !pending) return null;

  return (
    <>
      {/* Sheet */}
      {open && !pending && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center" onClick={onClose}>
          <div
            className="w-full max-w-md rounded-t-2xl border border-border bg-card p-4 pb-6 shadow-xl md:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold">Attach File</p>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"
              >
                <FontAwesomeIcon icon={faXmark} className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <AttachTile
                icon={faImage}
                label="Image"
                color="bg-purple-500"
                onClick={() => imageRef.current?.click()}
              />
              <AttachTile
                icon={faVideo}
                label="Video"
                color="bg-red-500"
                onClick={() => videoRef.current?.click()}
              />
              <AttachTile
                icon={faFile}
                label="Document"
                color="bg-blue-500"
                onClick={() => docRef.current?.click()}
              />
              <AttachTile
                icon={faMusic}
                label="Audio"
                color="bg-orange-500"
                onClick={() => audioRef.current?.click()}
              />
            </div>
            <input
              ref={imageRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                handleFile("image", f);
              }}
            />
            <input
              ref={videoRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                handleFile("video", f);
              }}
            />
            <input
              ref={docRef}
              type="file"
              accept={DOC_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                handleFile("document", f);
              }}
            />
            <input
              ref={audioRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                handleFile("audio", f);
              }}
            />
          </div>
        </div>
      )}

      {pending && (pending.kind === "image" || pending.kind === "video") && (
        <CaptionDialog
          file={pending.file}
          kind={pending.kind}
          onCancel={() => setPending(null)}
          onSend={(cap) => {
            onPick(pending.file, pending.kind, cap);
            setPending(null);
            onClose();
          }}
        />
      )}
    </>
  );
}

function AttachTile({
  icon,
  label,
  color,
  onClick,
}: {
  icon: import("@fortawesome/fontawesome-svg-core").IconDefinition;
  label: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 rounded-lg p-2 hover:bg-muted"
    >
      <span className={`grid h-14 w-14 place-items-center rounded-full text-white shadow-sm ${color}`}>
        <FontAwesomeIcon icon={icon} className="h-5 w-5" />
      </span>
      <span className="text-[11px] font-medium">{label}</span>
    </button>
  );
}

function CaptionDialog({
  file,
  kind,
  onCancel,
  onSend,
}: {
  file: File;
  kind: "image" | "video";
  onCancel: () => void;
  onSend: (caption: string) => void;
}) {
  const [caption, setCaption] = useState("");
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="grid max-h-[60vh] place-items-center bg-black">
          {url && kind === "image" ? (
            <img src={url} alt="preview" className="max-h-[60vh] w-auto object-contain" />
          ) : url ? (
            <video src={url} className="max-h-[60vh] w-full" controls playsInline />
          ) : null}
        </div>
        <div className="flex items-end gap-2 p-3">
          <input
            autoFocus
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Add a caption (optional)"
            onKeyDown={(e) => {
              if (e.key === "Enter") onSend(caption);
              if (e.key === "Escape") onCancel();
            }}
            className="flex-1 rounded-full border border-input bg-background px-4 py-2 text-sm outline-none ring-ring focus-visible:ring-2"
          />
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSend(caption)}
            className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}