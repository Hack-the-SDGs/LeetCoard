interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
  busy?: boolean;
  label: string;
}

/**
 * The live switch the teacher uses to open a problem.
 *
 * Deliberately physical: a track and a knob that travels, so a glance at the
 * dashboard reads as a row of switches rather than a row of checkboxes.
 */
export default function Switch({ checked, onChange, busy, label }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={busy}
      onClick={() => onChange(!checked)}
      className="relative h-[18px] w-9 shrink-0 border transition-colors duration-200 ease-instrument disabled:opacity-40"
      style={{
        borderColor: checked ? "#F2EFE9" : "#363E44",
        background: checked ? "#F2EFE9" : "transparent",
      }}
    >
      <span
        className="absolute top-[2px] block h-[12px] w-[12px] transition-transform duration-200 ease-instrument"
        style={{
          left: 2,
          transform: `translateX(${checked ? 18 : 0}px)`,
          background: checked ? "#0E1113" : "#5C646A",
        }}
      />
    </button>
  );
}
