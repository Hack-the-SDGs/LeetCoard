import { useState } from "react";

interface Props {
  error: string | null;
  onSubmit: (token: string) => void;
}

export default function Login({ error, onSubmit }: Props) {
  const [value, setValue] = useState("");

  return (
    <div className="flex h-screen w-screen items-center justify-center px-6">
      <form
        className="w-full max-w-[380px] border border-ink-700 bg-ink-900 p-8"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
      >
        <div className="font-display text-[22px] font-bold leading-none tracking-label">
          LEETCOARD
        </div>
        <div className="mt-1 font-mono text-[9px] tracking-label text-paper-faint">控制台</div>

        <label htmlFor="admin-token" className="mt-8 block font-mono text-[10px] tracking-label text-paper-dim">
          管理員 TOKEN
        </label>
        <input
          id="admin-token"
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder=".env 裡的 ADMIN_TOKEN"
          className="mt-2 w-full rounded-sm border border-ink-700 bg-ink-950 px-3 py-2 font-mono text-[13px] outline-none focus:border-paper"
        />
        {error && <p className="mt-3 text-[12px] text-paper-dim">{error}</p>}
        <button
          type="submit"
          className="mt-6 w-full rounded-sm bg-paper py-2.5 font-display text-[15px] font-bold tracking-wide text-ink-950 hover:brightness-95"
        >
          登入
        </button>
      </form>
    </div>
  );
}
