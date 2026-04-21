"use client";

import { useState, useRef, useEffect } from "react";
import { useAppStore } from "@/lib/store";
import { t } from "@/lib/i18n";
import ReactMarkdown from "react-markdown";
import {
  MessageSquare,
  Send,
  X,
  Loader2,
  RotateCcw,
  Sparkles,
  BrainCircuit,
  ImagePlus,
  Info,
} from "lucide-react";
import {
  processImageFile,
  extractImageFiles,
  imageUploadLimits,
  type ProcessedImage,
} from "@/lib/imageUpload";

export default function AIChatSidebar() {
  const {
    chatMessages,
    isChatLoading,
    isChatOpen,
    toggleChat,
    sendChatMessage,
    clearChat,
    marketData,
    locale,
    agentStatus,
  } = useAppStore();
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<ProcessedImage[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showVisionHint, setShowVisionHint] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const QUICK_QUESTIONS = [
    t("chat.q1", locale),
    t("chat.q2", locale),
    t("chat.q3", locale),
    t("chat.q4", locale),
    t("chat.q5", locale),
  ];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    setImageError(null);
    const room = imageUploadLimits.maxImagesPerMessage - pendingImages.length;
    if (room <= 0) {
      setImageError(t("chat.imageTooMany", locale));
      return;
    }
    const toProcess = files.slice(0, room);
    const processed: ProcessedImage[] = [];
    for (const f of toProcess) {
      if (!f.type.startsWith("image/")) {
        setImageError(t("chat.imageUnsupported", locale));
        continue;
      }
      if (f.size > imageUploadLimits.maxSingleBytes) {
        setImageError(t("chat.imageTooLarge", locale));
        continue;
      }
      try {
        processed.push(await processImageFile(f));
      } catch {
        setImageError(t("chat.imageProcessFailed", locale));
      }
    }
    if (processed.length) {
      setPendingImages((prev) => [...prev, ...processed]);
      setShowVisionHint(true);
    }
  };

  const handleSend = () => {
    const text = input.trim();
    if ((text || pendingImages.length) && !isChatLoading) {
      const imgs = pendingImages.map((p) => p.dataUrl);
      sendChatMessage(text, imgs.length ? imgs : undefined);
      setInput("");
      setPendingImages([]);
      setImageError(null);
    }
  };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    addFiles(files);
    // reset so selecting the same file twice still fires onChange
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = extractImageFiles(e.clipboardData?.items ?? null);
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = extractImageFiles(e.dataTransfer?.items ?? e.dataTransfer?.files ?? null);
    if (files.length) addFiles(files);
  };

  const removeImage = (idx: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== idx));
  };

  // Floating launcher
  if (!isChatOpen) {
    return (
      <button
        onClick={toggleChat}
        aria-label="Open AI assistant"
        className="fixed right-5 bottom-5 w-14 h-14 rounded-full flex items-center justify-center shadow-[var(--shadow-blue)] transition-all z-50 cursor-pointer hover:scale-105 active:scale-95 group overflow-hidden"
      >
        {/* Gradient core */}
        <span className="absolute inset-0 rounded-full bg-gradient-to-br from-[var(--accent)] via-[var(--accent-bright)] to-[var(--accent-violet)]" />
        {/* Rotating sweep */}
        <span
          aria-hidden
          className="absolute inset-[-40%] opacity-40 pointer-events-none"
        >
          <span className="absolute inset-0 rounded-full bg-gradient-conic from-white/0 via-white/70 to-white/0 anim-drift" />
        </span>
        {/* Pulse ring */}
        <span
          aria-hidden
          className="absolute inset-0 rounded-full ring-2 ring-[var(--accent)]/50 anim-data-pulse pointer-events-none"
        />
        <MessageSquare className="w-6 h-6 text-white relative z-10 drop-shadow" />
      </button>
    );
  }

  return (
    <div
      className="flex flex-col h-full bg-white/90 backdrop-blur-xl relative"
      onDragEnter={(e) => {
        if (e.dataTransfer?.types?.includes("Files")) {
          e.preventDefault();
          setIsDragging(true);
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes("Files")) {
          e.preventDefault();
        }
      }}
      onDragLeave={(e) => {
        // Only unset when leaving the container, not children
        if (e.currentTarget === e.target) setIsDragging(false);
      }}
      onDrop={handleDrop}
    >
      {/* Accent vertical sheen on the left edge (decorative) */}
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 w-[2px] bg-gradient-to-b from-transparent via-[var(--accent)] to-transparent opacity-30 pointer-events-none"
      />

      {/* Drag-drop overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[var(--accent-soft)]/90 border-2 border-dashed border-[var(--accent)] rounded-lg pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-[var(--accent-hot)]">
            <ImagePlus className="w-8 h-8" />
            <span className="text-sm font-semibold">{t("chat.dropImagesHere", locale)}</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--line-soft)]">
        <div className="flex items-center gap-2.5">
          <div className="relative w-8 h-8 rounded-xl bg-gradient-to-br from-[var(--accent)] via-[var(--accent-bright)] to-[var(--accent-violet)] flex items-center justify-center overflow-hidden shadow-[var(--shadow-blue)]">
            <Sparkles className="w-4 h-4 text-white relative z-10" strokeWidth={2.2} />
            <div aria-hidden className="absolute inset-0 opacity-40">
              <div className="absolute inset-[-40%] rounded-full bg-gradient-conic from-white/0 via-white/60 to-white/0 anim-drift" />
            </div>
          </div>
          <div className="leading-tight">
            <h3 className="font-bold text-[var(--text-0)] text-sm tracking-tight">
              {t("chat.title", locale)}
            </h3>
            <div className="flex items-center gap-1.5 text-[9.5px] uppercase tracking-[0.18em] text-[var(--text-2)] font-semibold mt-0.5">
              <span className="relative flex w-1.5 h-1.5">
                <span className="absolute inset-0 rounded-full bg-[var(--fin-up)] anim-data-pulse" />
                <span className="absolute inset-0 rounded-full bg-[var(--fin-up)]" />
              </span>
              <span>Live AI</span>
              {marketData && chatMessages.length > 0 && (
                <span
                  className="flex items-center gap-1 text-[var(--accent-hot)] normal-case tracking-normal"
                  title={
                    locale === "zh"
                      ? `为 ${marketData.ticker} 保存 ${chatMessages.length} 条消息`
                      : `${chatMessages.length} messages saved for ${marketData.ticker}`
                  }
                >
                  <BrainCircuit className="w-2.5 h-2.5" />
                  <span className="font-semibold">{marketData.ticker}</span>
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={clearChat}
            className="text-[var(--text-2)] hover:text-[var(--accent-hot)] transition p-1.5 rounded-lg hover:bg-[var(--bg-2)] cursor-pointer"
            title={locale === "zh" ? "\u65b0\u5bf9\u8bdd" : "New chat"}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={toggleChat}
            className="text-[var(--text-2)] hover:text-[var(--accent-hot)] transition p-1.5 rounded-lg hover:bg-[var(--bg-2)] cursor-pointer"
            aria-label="Close chat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
        {chatMessages.length === 0 && (
          <div className="text-center space-y-4 mt-4">
            {/* Decorative ambient emblem */}
            <div className="relative mx-auto w-16 h-16 mb-1">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[var(--accent-soft)] to-[rgba(109,78,224,0.18)] border border-[rgba(45,76,221,0.22)] shadow-[var(--shadow-blue)]" />
              <div className="absolute inset-0 rounded-2xl overflow-hidden">
                <div className="shimmer absolute inset-0" />
              </div>
              <Sparkles
                className="absolute inset-0 m-auto w-6 h-6 text-[var(--accent)] anim-float-slow"
                strokeWidth={1.9}
              />
            </div>

            <div className="text-sm text-[var(--text-1)] leading-relaxed max-w-xs mx-auto">
              {marketData ? (
                <span>
                  {t("chat.askAnything", locale)
                    .split("{ticker}")
                    .map((part, idx, arr) => (
                      <span key={idx}>
                        {part}
                        {idx < arr.length - 1 && (
                          <span className="text-gradient-blue font-bold">
                            {marketData.ticker}
                          </span>
                        )}
                      </span>
                    ))}
                </span>
              ) : (
                <span className="text-[var(--text-2)]">
                  {t("chat.searchFirst", locale)}
                </span>
              )}
            </div>

            {marketData && (
              <div className="space-y-2 stagger-children">
                {QUICK_QUESTIONS.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => sendChatMessage(q)}
                    className="anim-fade-up group block w-full text-left text-sm px-4 py-2.5 bg-white/70 border border-[var(--line-soft)] rounded-xl text-[var(--text-1)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent-hot)] transition-all cursor-pointer relative overflow-hidden"
                  >
                    <span className="relative z-10 font-medium">{q}</span>
                    <span
                      aria-hidden
                      className="absolute left-0 top-0 bottom-0 w-[2px] bg-[var(--accent)] scale-y-0 group-hover:scale-y-100 origin-top transition-transform duration-200"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {chatMessages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${
              msg.role === "user" ? "justify-end" : "justify-start"
            } anim-fade-up`}
          >
            <div
              className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed
              ${
                msg.role === "user"
                  ? "bg-gradient-to-br from-[var(--accent)] to-[var(--accent-violet)] text-white shadow-[var(--shadow-blue)]"
                  : "bg-white border border-[var(--line-soft)] text-[var(--text-1)] shadow-[0_2px_12px_-6px_rgba(24,39,110,0.12)]"
              }`}
            >
              {msg.role === "user" && msg.images && msg.images.length > 0 && (
                <div className="mb-2 grid grid-cols-2 gap-1.5">
                  {msg.images.map((src, idx) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={idx}
                      src={src}
                      alt={`attachment ${idx + 1}`}
                      className="rounded-lg border border-white/20 max-h-40 w-full object-cover"
                    />
                  ))}
                </div>
              )}
              {msg.role === "assistant" ? (
                <div
                  className="prose prose-sm max-w-none
                  [&_h3]:text-sm [&_h3]:font-bold [&_h3]:text-[var(--text-0)] [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:border-b [&_h3]:border-[var(--line-soft)] [&_h3]:pb-1
                  [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:text-[var(--text-0)] [&_h4]:mt-2 [&_h4]:mb-1
                  [&_p]:my-1.5 [&_p]:leading-relaxed [&_p]:text-[var(--text-1)]
                  [&_li]:my-0.5 [&_li]:text-[var(--text-1)] [&_ul]:my-1.5 [&_ol]:my-1.5 [&_ul]:pl-4 [&_ol]:pl-4
                  [&_strong]:text-[var(--text-0)] [&_strong]:font-semibold
                  [&_a]:text-[var(--accent-hot)] [&_a]:underline [&_a]:decoration-[var(--accent)]/40 [&_a]:underline-offset-2 hover:[&_a]:decoration-[var(--accent)]
                  [&_table]:w-full [&_table]:text-xs [&_table]:my-2 [&_table]:border-collapse
                  [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_th]:text-[var(--text-1)] [&_th]:bg-[var(--bg-2)] [&_th]:border-b [&_th]:border-[var(--line-soft)]
                  [&_td]:px-2 [&_td]:py-1 [&_td]:border-b [&_td]:border-[var(--line-soft)] [&_td]:text-[var(--text-1)]
                  [&_code]:text-xs [&_code]:bg-[var(--accent-soft)] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[var(--accent-hot)] [&_code]:font-mono
                  [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--accent)] [&_blockquote]:pl-3 [&_blockquote]:text-[var(--text-2)] [&_blockquote]:italic
                  [&_hr]:my-2 [&_hr]:border-[var(--line-soft)]
                "
                >
                  <ReactMarkdown>
                    {msg.content ||
                      (isChatLoading && i === chatMessages.length - 1
                        ? "..."
                        : "")}
                  </ReactMarkdown>
                </div>
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}

        {isChatLoading &&
          chatMessages.length > 0 &&
          chatMessages[chatMessages.length - 1]?.role === "user" && (
            <div className="flex justify-start">
              <div className="bg-white border border-[var(--line-soft)] rounded-2xl px-4 py-3 flex items-center gap-2 shadow-[0_2px_12px_-6px_rgba(24,39,110,0.12)]">
                <Loader2 className="w-4 h-4 text-[var(--accent)] animate-spin" />
                <span className="flex gap-1">
                  <span className="w-1 h-1 rounded-full bg-[var(--accent)] anim-data-pulse" />
                  <span
                    className="w-1 h-1 rounded-full bg-[var(--accent-bright)] anim-data-pulse"
                    style={{ animationDelay: "0.15s" }}
                  />
                  <span
                    className="w-1 h-1 rounded-full bg-[var(--accent-violet)] anim-data-pulse"
                    style={{ animationDelay: "0.3s" }}
                  />
                </span>
              </div>
            </div>
          )}

        {isChatLoading && agentStatus !== "idle" && (
          <div className="flex items-center gap-2 text-xs py-1 px-1 anim-fade-up">
            <Loader2
              className={`w-3 h-3 animate-spin flex-shrink-0 ${
                agentStatus === "verified"
                  ? "text-[var(--fin-up)]"
                  : agentStatus === "retry"
                  ? "text-amber-500"
                  : "text-[var(--accent)]"
              }`}
            />
            <span
              className={`font-semibold ${
                agentStatus === "verified"
                  ? "text-[var(--fin-up)]"
                  : agentStatus === "retry"
                  ? "text-amber-600"
                  : "text-[var(--accent-hot)]"
              }`}
            >
              {agentStatus === "researcher" && t("agent.researcher", locale)}
              {agentStatus === "analyst" && t("agent.analyst", locale)}
              {agentStatus === "verifier" && t("agent.verifier", locale)}
              {agentStatus === "verified" && t("agent.verified", locale)}
              {agentStatus === "retry" && t("agent.retry", locale)}
            </span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-5 py-3.5 border-t border-[var(--line-soft)] bg-white/60 backdrop-blur-sm">
        {/* Pending image previews */}
        {pendingImages.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pendingImages.map((img, idx) => (
              <div
                key={idx}
                className="relative w-16 h-16 rounded-lg overflow-hidden border border-[var(--line-soft)] bg-[var(--bg-2)] group"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.dataUrl}
                  alt={`pending ${idx + 1}`}
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeImage(idx)}
                  aria-label={t("chat.removeImage", locale)}
                  className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition cursor-pointer"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Inline warnings */}
        {imageError && (
          <div className="mb-2 text-[11px] text-[var(--fin-down)] flex items-center gap-1">
            <Info className="w-3 h-3" />
            <span>{imageError}</span>
          </div>
        )}
        {showVisionHint && pendingImages.length > 0 && (
          <div className="mb-2 text-[11px] text-[var(--text-2)] flex items-start gap-1 leading-snug">
            <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span>{t("chat.visionModelNote", locale)}</span>
          </div>
        )}

        <div className="flex gap-2 items-end">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFilePick}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={
              isChatLoading ||
              pendingImages.length >= imageUploadLimits.maxImagesPerMessage
            }
            aria-label={t("chat.attachImage", locale)}
            title={t("chat.attachImage", locale)}
            className="p-2.5 rounded-xl border border-[var(--line-soft)] bg-white text-[var(--text-1)] hover:text-[var(--accent-hot)] hover:border-[var(--accent)] transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ImagePlus className="w-4 h-4" />
          </button>
          <div className="relative flex-1">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={t("chat.placeholder", locale)}
              rows={1}
              className="w-full px-4 py-2.5 bg-white border border-[var(--line-soft)] rounded-xl text-[var(--text-0)] placeholder-[var(--text-2)] text-sm resize-none focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15 transition-all"
            />
          </div>
          <button
            onClick={handleSend}
            disabled={(!input.trim() && pendingImages.length === 0) || isChatLoading}
            aria-label="Send"
            className="relative px-3.5 py-2.5 rounded-xl transition-all cursor-pointer active:scale-95 disabled:cursor-not-allowed overflow-hidden group"
          >
            {/* Gradient body when enabled */}
            <span
              className={`absolute inset-0 rounded-xl transition-all ${
                (!input.trim() && pendingImages.length === 0) || isChatLoading
                  ? "bg-[var(--bg-3)]"
                  : "bg-gradient-to-br from-[var(--accent)] to-[var(--accent-violet)] shadow-[var(--shadow-blue)] group-hover:shadow-[0_14px_30px_-10px_rgba(45,76,221,0.55)] group-hover:-translate-y-px"
              }`}
            />
            <Send
              className={`relative z-10 w-4 h-4 ${
                (!input.trim() && pendingImages.length === 0) || isChatLoading
                  ? "text-[var(--text-2)]"
                  : "text-white"
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
