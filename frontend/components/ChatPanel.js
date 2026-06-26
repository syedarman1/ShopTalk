"use client";
import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "../lib/utils";
import TypingIndicator from "./TypingIndicator";

export default function ChatPanel({ chat, typing, questions, runQuestion }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length, typing]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-1 pb-3 text-sm text-muted-foreground">
        <span className="text-base">📱</span> iMessage · Poke
      </div>

      <motion.div ref={scrollRef} layoutScroll className="flex-1 space-y-2 overflow-auto px-1">
        {chat.length === 0 && !typing && (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
            👋 Tap a question below to ask Northwind Supply Co.
          </div>
        )}
        <AnimatePresence initial={false}>
          {chat.map((m) => (
            <motion.div
              key={m.id}
              layout
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 32 }}
              className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-3 py-2 text-[13px] leading-snug",
                  m.role === "user"
                    ? "rounded-br-sm bg-sky-500 text-white"
                    : "rounded-bl-sm bg-muted text-foreground"
                )}
              >
                {m.text}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        <AnimatePresence>{typing && <TypingIndicator key="typing" />}</AnimatePresence>
      </motion.div>

      <div className="mt-3 px-1">
        <div className="mb-2 flex flex-wrap gap-2">
          {questions.map((q) => (
            <button
              key={q.id}
              onClick={() => runQuestion(q.id)}
              className="rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground/90 hover:bg-muted hover:border-shopify/50 hover:text-shopify-light"
            >
              {q.question}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2">
          <span className="flex-1 text-sm text-muted-foreground">Message…</span>
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-500 text-xs text-white">↑</span>
        </div>
      </div>
    </div>
  );
}
