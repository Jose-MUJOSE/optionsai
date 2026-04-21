"use client";

/**
 * AnimatedBackground — soft, premium ambient layer for the light theme.
 * A slow-drifting multi-point radial gradient + a fine paper grid.
 * No particles on white — keeps the canvas editorial, not busy.
 */
export default function AnimatedBackground() {
  return (
    <>
      {/* Slow-drifting soft gradient blobs */}
      <div
        aria-hidden
        className="fixed inset-0 -z-20 pointer-events-none anim-drift"
        style={{
          background:
            "radial-gradient(900px 520px at 12% -6%, rgba(45,76,221,0.07), transparent 60%)," +
            "radial-gradient(820px 480px at 96% 8%, rgba(109,78,224,0.06), transparent 60%)," +
            "radial-gradient(720px 420px at 40% 120%, rgba(13,159,138,0.05), transparent 70%)," +
            "radial-gradient(600px 360px at 85% 90%, rgba(217,119,6,0.03), transparent 70%)",
        }}
      />
      {/* Fine paper grid */}
      <div
        aria-hidden
        className="fixed inset-0 -z-10 pointer-events-none grid-paper opacity-[0.7]"
      />
      {/* Top highlight sheen */}
      <div
        aria-hidden
        className="fixed inset-x-0 top-0 h-32 -z-10 pointer-events-none"
        style={{
          background: "linear-gradient(180deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 100%)",
        }}
      />
    </>
  );
}
