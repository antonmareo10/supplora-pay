// Inline stroke icons (no icon dependency). 1.6px stroke, currentColor.
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 18, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...props,
  };
}

export const IconHome = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 10.5 12 4l8 6.5V20h-5.5v-5.5h-5V20H4v-9.5Z" />
  </svg>
);
export const IconInbox = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3.5 13.5 6 5h12l2.5 8.5V19h-17v-5.5Z" />
    <path d="M3.5 13.5H8l1.5 2.5h5l1.5-2.5h4.5" />
  </svg>
);
export const IconWallet = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 7.5h14.5a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 18V7.5Z" />
    <path d="M4 7.5 15.5 4.5v3" />
    <circle cx="16" cy="13.5" r="1.2" />
  </svg>
);
export const IconMail = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3.5" y="5.5" width="17" height="13" rx="1.5" />
    <path d="m4 7 8 6 8-6" />
  </svg>
);
export const IconCart = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3.5 4.5h2.2l2 10.5h10.6l1.9-7.5H7" />
    <circle cx="9.5" cy="19" r="1.3" />
    <circle cx="17" cy="19" r="1.3" />
  </svg>
);
export const IconBook = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 4.5h11.5A2.5 2.5 0 0 1 19 7v12.5H7.5A2.5 2.5 0 0 1 5 17V4.5Z" />
    <path d="M5 17a2.5 2.5 0 0 1 2.5-2.5H19M9 8.5h6M9 11.5h4" />
  </svg>
);
export const IconUpload = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 16V4.5M7.5 9 12 4.5 16.5 9M5 19.5h14" />
  </svg>
);
export const IconSpark = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5Z" />
    <path d="M18.5 15.5c.3 1.6 1 2.3 2.5 2.5-1.5.3-2.2 1-2.5 2.5-.3-1.5-1-2.2-2.5-2.5 1.5-.2 2.2-.9 2.5-2.5Z" />
  </svg>
);
export const IconCheck = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);
export const IconAlert = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 4 2.5 20h19L12 4Z" />
    <path d="M12 10v4.5M12 17.5v.01" />
  </svg>
);
export const IconInfo = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5M12 8v.01" />
  </svg>
);
export const IconArrowUp = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);
export const IconArrowRight = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
export const IconArrowLeft = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </svg>
);
export const IconCopy = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="8" y="8" width="11" height="11" rx="2" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </svg>
);
export const IconPause = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M10 9v6M14 9v6" />
  </svg>
);
export const IconScale = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 4v16M7 20h10M5 7h14M5 7l-2.5 6a3 3 0 0 0 5 0L5 7ZM19 7l-2.5 6a3 3 0 0 0 5 0L19 7Z" />
  </svg>
);
export const IconTruck = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 6.5h11v9H3zM14 9.5h3.5l3 3v3H14" />
    <circle cx="7" cy="17.5" r="1.6" />
    <circle cx="17" cy="17.5" r="1.6" />
  </svg>
);
export const IconClock = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);
export const IconShield = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3.5 5 6v5.5c0 4.2 3 7.5 7 9 4-1.5 7-4.8 7-9V6l-7-2.5Z" />
    <path d="m9 12 2.2 2.2L15.5 10" />
  </svg>
);
export const IconExternal = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M13.5 4.5h6v6M19.5 4.5 11 13M17 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1H10" />
  </svg>
);
export const IconRefresh = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" />
  </svg>
);
export const IconDoc = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 3.5h8l4 4v13H6v-17Z" />
    <path d="M14 3.5v4h4M9 12h6M9 15.5h6" />
  </svg>
);
export const IconCard = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="5.5" width="18" height="13" rx="2" />
    <path d="M3 10h18M7 15h3" />
  </svg>
);
export const IconX = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
export const IconZoom = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2M11 8.5v5M8.5 11h5" />
  </svg>
);
export const IconMinus = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 12h12" />
  </svg>
);
export const IconPlus = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 6v12M6 12h12" />
  </svg>
);
