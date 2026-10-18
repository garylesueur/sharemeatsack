/* oxlint-disable jsx-a11y/media-has-caption -- Originals have no supplied caption contract; do not invent a caption track. */
"use client";
import { useEffect, useRef, useState } from "react";
import { type ReadUrl } from "@/lib/file-access";
import { type ViewFile } from "@/lib/file-view";

export function MediaPreview({
  file,
  source,
  fail,
  renew,
  audio = false,
}: {
  file: ViewFile;
  source: ReadUrl;
  fail: (message: string) => void;
  renew: () => Promise<unknown>;
  audio?: boolean;
}) {
  const media = useRef<HTMLMediaElement | null>(null);
  const position = useRef({ time: 0, playing: false });
  const [duration, setDuration] = useState<number | null>(null);
  const progress = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function disarm() {
    clearTimeout(progress.current);
  }
  function arm() {
    disarm();
    progress.current = setTimeout(
      () => fail("Playback stopped making progress. Try again or download the original."),
      30_000,
    );
  }
  useEffect(() => {
    const element = media.current;
    if (!element) return;
    element.src = source.url;
    // Playback is initiated only by the person. Renewal preserves their position.
    const loaded = () => {
      clearTimeout(progress.current);
      if (Number.isFinite(element.duration)) setDuration(element.duration);
      if (position.current.time > 0)
        element.currentTime = Math.min(
          position.current.time,
          element.duration || position.current.time,
        );
      if (position.current.playing) void element.play().catch(() => {});
    };
    element.addEventListener("loadedmetadata", loaded);
    element.load();
    progress.current = setTimeout(
      () => fail("Media metadata could not be loaded. Try again or download the original."),
      30_000,
    );
    return () => {
      clearTimeout(progress.current);
      element.removeEventListener("loadedmetadata", loaded);
      const resume = position.current.playing;
      element.pause();
      position.current.playing = resume;
      element.removeAttribute("src");
      element.load();
    };
  }, [source, fail]);
  const events = {
    controls: true,
    preload: "metadata" as const,
    src: source.url,
    "aria-label": `Play ${file.name}`,
    onLoadStart: arm,
    onProgress: () => {
      if (media.current && media.current.readyState < 3) arm();
      else disarm();
    },
    onCanPlay: disarm,
    onPlaying: disarm,
    onWaiting: arm,
    onStalled: arm,
    onSeeked: disarm,
    onError: () => {
      disarm();
      const element = media.current;
      if (!element) return;
      position.current = { time: element.currentTime, playing: position.current.playing };
      if (
        element.error?.code === 2 ||
        (element.error?.code !== 3 && Date.parse(source.expiresAt) <= Date.now())
      )
        void renew();
      else
        fail("This media format or codec cannot be played by this browser. Download the original.");
    },
    onTimeUpdate: () => {
      disarm();
      const element = media.current;
      if (element && element.readyState >= 1)
        position.current = { time: element.currentTime, playing: !element.paused };
    },
    onPause: () => {
      disarm();
      if (!media.current?.error) position.current.playing = false;
    },
    onPlay: () => {
      position.current.playing = true;
    },
  };
  return (
    <div className="mt-6 min-w-0 rounded-xl border border-border bg-card p-3 sm:p-5">
      {/* User-supplied captions are not part of the transfer contract. */}
      {audio ? (
        <audio
          ref={(element) => {
            media.current = element;
          }}
          {...events}
          className="w-full"
        />
      ) : (
        <video
          ref={(element) => {
            media.current = element;
          }}
          {...events}
          playsInline
          className="mx-auto max-h-[70vh] w-full rounded-lg bg-black"
        />
      )}
      {duration !== null ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Duration {Math.floor(duration / 60)}:{String(Math.floor(duration % 60)).padStart(2, "0")}
        </p>
      ) : null}
    </div>
  );
}
