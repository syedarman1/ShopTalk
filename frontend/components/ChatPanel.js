"use client";
import { cn } from "../lib/utils";

export default function ChatPanel({ chat, questions, runQuestion }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-1 pb-3 text-sm text-muted-foreground">
        <span className="text-base">📱</span> iMessage · Poke
      </div>

      <div className="flex-1 space-y-2 overflow-auto px-1">
        {chat.length === 0 && (
          <p className="text-xs text-muted-foreground">Starting demo…</p>
        )}
        {chat.map((m) => (
          <div
            key={m.id}
            className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[80%] rounded-2xl px-3 py-2 text-[13px] leading-snug animate-flash-in",
                m.role === "user"
                  ? "rounded-br-sm bg-sky-500 text-white"
                  : "rounded-bl-sm bg-muted text-foreground"
              )}
            >
              {m.text}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 px-1">
        <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">Try ▸</p>
        <div className="flex flex-wrap gap-2">
          {questions.map((q) => (
            <button
              key={q.id}
              onClick={() => runQuestion(q.id)}
              className="rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground/90 hover:bg-muted"
            >
              {q.question}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
