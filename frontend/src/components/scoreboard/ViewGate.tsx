import { useState } from "react";

interface Props {
  error: string | null;
  onSubmit: (password: string) => void;
}

/**
 * Password prompt in front of the public board.
 *
 * Deliberately says nothing about the session: an unlocked board is a projector
 * feed of everyone's work, so the page before it should give away neither the
 * roster nor the problem set.
 */
export default function ViewGate({ error, onSubmit }: Props) {
  const [value, setValue] = useState("");

  return (
    <div className="flex h-screen w-screen items-center justify-center px-6">
      <form
        className="w-full max-w-[360px] border border-ink-700 bg-ink-900 p-8"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
      >
        <div className="font-display text-[22px] font-bold leading-none tracking-label">
          LEETCOARD
        </div>
        <div className="mt-1 font-mono text-[9px] tracking-label text-paper-faint">課堂練習</div>

        <label
          htmlFor="view-password"
          className="mt-8 block font-mono text-[10px] tracking-label text-paper-dim"
        >
          觀看密碼
        </label>
        <input
          id="view-password"
          type="password"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="向老師索取"
          className="mt-2 w-full rounded-sm border border-ink-700 bg-ink-950 px-3 py-2 font-mono text-[13px] outline-none focus:border-paper"
        />
        {error && <p className="mt-3 text-[12px] text-paper-dim">{error}</p>}
        <button
          type="submit"
          className="mt-6 w-full rounded-sm bg-paper py-2.5 font-display text-[15px] font-bold tracking-wide text-ink-950 hover:brightness-95"
        >
          進入
        </button>
      </form>
    </div>
  );
}
