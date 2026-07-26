import { useEffect, useState } from "react";
import { readableInk } from "../../lib/color";
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
 * The student's LeetCode portrait inside a team-coloured ring.
 *
 * Falls back to the first character of their real name on the team colour when
 * LeetCode has no avatar for them — and also when it has one that fails to
 * load, because a broken-image glyph on a projector is worse than an initial.
 *
 * The ring is an outset shadow so it never changes layout size, and it is
 * doubled with the page ground so two portraits can sit shoulder to shoulder
 * without their rings bleeding into one another.
 */
export default function Avatar({ nickname, avatarUrl, color, size, profileFor }: Props) {
  const [broken, setBroken] = useState(false);

  // A fresh URL deserves a fresh attempt; profiles arrive after the first paint.
  useEffect(() => setBroken(false), [avatarUrl]);

  const showImage = Boolean(avatarUrl) && !broken;

  const portrait = (
    <span
      className="inline-block shrink-0 overflow-hidden rounded-full bg-ink-800"
      style={{
        width: size,
        height: size,
        boxShadow: `0 0 0 2px ${color}, 0 0 0 3px #0E1113`,
      }}
    >
      {showImage ? (
        <img
          src={avatarUrl as string}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
        />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center font-display font-bold"
          style={{
            background: color,
            color: readableInk(color),
            fontSize: Math.round(size * 0.52),
          }}
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
