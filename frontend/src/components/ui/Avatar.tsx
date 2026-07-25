import { profileUrl } from "../../lib/leetcode";

interface Props {
  nickname: string;
  avatarUrl: string | null;
  color: string;
  size: number;
  /** LeetCode handle. When given, the portrait links to that public profile. */
  profileFor?: string | null;
}

/**
 * Round portrait carrying a team-coloured ring.
 *
 * The ring is an outset shadow so it never changes layout size, and it is
 * doubled with the page ground so two markers can sit shoulder to shoulder on
 * a percentile track without their rings bleeding into one another.
 */
export default function Avatar({ nickname, avatarUrl, color, size, profileFor }: Props) {
  const portrait = (
    <span
      className="inline-block shrink-0 overflow-hidden rounded-full bg-ink-800"
      style={{
        width: size,
        height: size,
        boxShadow: `0 0 0 2px ${color}, 0 0 0 3px #0E1113`,
      }}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center font-display font-bold"
          style={{ background: color, color: "#0E1113", fontSize: Math.round(size * 0.52) }}
        >
          {nickname.slice(0, 1)}
        </span>
      )}
    </span>
  );

  if (!profileFor) return portrait;

  return (
    <a
      href={profileUrl(profileFor)}
      target="_blank"
      rel="noopener noreferrer"
      title={`看 ${nickname} 的 LeetCode 個人頁`}
      className="inline-flex rounded-full transition-opacity hover:opacity-80"
    >
      {portrait}
    </a>
  );
}
