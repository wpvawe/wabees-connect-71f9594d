import { useCallback, useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faXmark,
  faChevronLeft,
  faChevronRight,
  faDownload,
  faMagnifyingGlassPlus,
  faMagnifyingGlassMinus,
  faRotate,
} from "@fortawesome/free-solid-svg-icons";

export type LightboxItem = {
  id: string;
  url: string;
  kind: "image" | "video";
  caption?: string | null;
  fileName?: string | null;
  mime?: string | null;
};

function extensionForMime(mime?: string | null): string {
  const m = (mime ?? "").toLowerCase().split(";")[0].trim();
  if (m === "image/jpeg") return "jpg";
  if (m.startsWith("image/")) return m.slice(6);
  if (m.startsWith("video/")) return m.slice(6);
  return "bin";
}

function safeFileName(name: string | null | undefined, mime: string | null | undefined, fallback: string) {
  const base = (name || fallback).replace(/[\\/:*?"<>|]+/g, "_");
  if (/\.[A-Za-z0-9]{1,8}$/.test(base) && !/\.bin$/i.test(base)) return base;
  return `${base.replace(/\.bin$/i, "")}.${extensionForMime(mime)}`;
}

function downloadUrl(url: string, fileName: string, mime?: string | null): string {
  try {
    const u = new URL(url, window.location.href);
    u.searchParams.set("download", "1");
    u.searchParams.set("filename", fileName);
    if (mime) u.searchParams.set("mime", mime);
    return u.toString();
  } catch {
    return url;
  }
}

export function MediaLightbox({
  items,
  startId,
  onClose,
}: {
  items: LightboxItem[];
  startId: string;
  onClose: () => void;
}) {
  const startIdx = Math.max(0, items.findIndex((i) => i.id === startId));
  const [idx, setIdx] = useState(startIdx === -1 ? 0 : startIdx);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  const current = items[idx];

  const next = useCallback(() => {
    setIdx((i) => Math.min(items.length - 1, i + 1));
    setZoom(1);
    setRotation(0);
  }, [items.length]);
  const prev = useCallback(() => {
    setIdx((i) => Math.max(0, i - 1));
    setZoom(1);
    setRotation(0);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(5, z + 0.25));
      else if (e.key === "-") setZoom((z) => Math.max(0.5, z - 0.25));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [next, prev, onClose]);

  if (!current) return null;

  const download = async () => {
    const fileName = safeFileName(current.fileName, current.mime, `${current.kind}-${current.id}`);
    const href = downloadUrl(current.url, fileName, current.mime);
    try {
      const res = await fetch(href, { mode: "cors" });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      window.open(href, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black/95"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      {/* Top bar */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-3 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0 text-sm">
          <p className="truncate font-medium">
            {current.fileName || (current.kind === "image" ? "Photo" : "Video")}
          </p>
          <p className="text-xs text-white/60">
            {idx + 1} / {items.length}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {current.kind === "image" && (
            <>
              <IconBtn label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
                <FontAwesomeIcon icon={faMagnifyingGlassMinus} className="h-4 w-4" />
              </IconBtn>
              <IconBtn label="Zoom in" onClick={() => setZoom((z) => Math.min(5, z + 0.25))}>
                <FontAwesomeIcon icon={faMagnifyingGlassPlus} className="h-4 w-4" />
              </IconBtn>
              <IconBtn label="Rotate" onClick={() => setRotation((r) => (r + 90) % 360)}>
                <FontAwesomeIcon icon={faRotate} className="h-4 w-4" />
              </IconBtn>
            </>
          )}
          <IconBtn label="Download" onClick={download}>
            <FontAwesomeIcon icon={faDownload} className="h-4 w-4" />
          </IconBtn>
          <IconBtn label="Close" onClick={onClose}>
            <FontAwesomeIcon icon={faXmark} className="h-5 w-5" />
          </IconBtn>
        </div>
      </div>

      {/* Stage */}
      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {idx > 0 && (
          <button
            type="button"
            onClick={prev}
            aria-label="Previous"
            className="absolute left-3 top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <FontAwesomeIcon icon={faChevronLeft} className="h-4 w-4" />
          </button>
        )}
        {idx < items.length - 1 && (
          <button
            type="button"
            onClick={next}
            aria-label="Next"
            className="absolute right-3 top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <FontAwesomeIcon icon={faChevronRight} className="h-4 w-4" />
          </button>
        )}

        {current.kind === "image" ? (
          <img
            key={current.id}
            src={current.url}
            alt={current.caption || current.fileName || "image"}
            className="max-h-full max-w-full select-none object-contain transition-transform"
            style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
            draggable={false}
          />
        ) : (
          <video
            key={current.id}
            src={current.url}
            controls
            autoPlay
            className="max-h-full max-w-full"
          />
        )}
      </div>

      {current.caption && (
        <div
          className="px-4 py-3 text-center text-sm text-white/90"
          onClick={(e) => e.stopPropagation()}
        >
          {current.caption}
        </div>
      )}
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid h-9 w-9 place-items-center rounded-full text-white hover:bg-white/15"
    >
      {children}
    </button>
  );
}