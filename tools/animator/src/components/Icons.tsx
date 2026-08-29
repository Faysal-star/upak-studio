// Hand-drawn inline SVG icon set — 18px, 1.5px stroke, consistent geometry.

import type { SVGProps } from "react";

function I({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconPencil = () => (
  <I>
    <path d="M3.5 14.5 4 11.8 12.3 3.5a1.3 1.3 0 0 1 1.9 0l.3.3a1.3 1.3 0 0 1 0 1.9L6.2 14 3.5 14.5Z" />
    <path d="M11.2 4.6l2.2 2.2" />
  </I>
);

export const IconEraser = () => (
  <I>
    <path d="M6.7 14h7.8" />
    <path d="M3.6 11.2a1.5 1.5 0 0 1 0-2.1l5.5-5.5a1.5 1.5 0 0 1 2.1 0l3.2 3.2a1.5 1.5 0 0 1 0 2.1L10 13.3a1.7 1.7 0 0 1-2.4 0l-4-2.1Z" />
    <path d="M6.4 5.9l5.7 5.7" />
  </I>
);

export const IconLine = () => (
  <I>
    <path d="M3.5 14.5 14.5 3.5" />
    <circle cx="3.5" cy="14.5" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="14.5" cy="3.5" r="1.2" fill="currentColor" stroke="none" />
  </I>
);

export const IconRect = () => (
  <I>
    <rect x="3.5" y="4.5" width="11" height="9" rx="0.5" />
  </I>
);

export const IconEllipse = () => (
  <I>
    <ellipse cx="9" cy="9" rx="5.7" ry="4.4" />
  </I>
);

export const IconFill = () => (
  <I>
    <path d="M7.6 2.8l6 6-4.4 4.4a1.6 1.6 0 0 1-2.3 0L4 10.3a1.6 1.6 0 0 1 0-2.3l3.6-3.6Z" />
    <path d="M5.9 4.5 7.6 2.8" />
    <path d="M14.6 11.6s1.1 1.4 1.1 2.3a1.1 1.1 0 0 1-2.2 0c0-.9 1.1-2.3 1.1-2.3Z" fill="currentColor" stroke="none" />
  </I>
);

export const IconPicker = () => (
  <I>
    <path d="M10.8 4.9l2.3 2.3-6.5 6.5-2.8.5.5-2.8 6.5-6.5Z" />
    <path d="M10.2 4.3l1.5-1.5a1.63 1.63 0 0 1 2.3 0l1.2 1.2a1.63 1.63 0 0 1 0 2.3l-1.5 1.5" />
  </I>
);

export const IconMove = () => (
  <I>
    <path d="M9 2.5v13M2.5 9h13" />
    <path d="M9 2.5 7.2 4.3M9 2.5l1.8 1.8M9 15.5l-1.8-1.8M9 15.5l1.8-1.8M2.5 9l1.8-1.8M2.5 9l1.8 1.8M15.5 9l-1.8-1.8M15.5 9l-1.8 1.8" />
  </I>
);

export const IconSelect = () => (
  <I>
    <path d="M3.5 5.5v-2h2M8 3.5h2M12.5 3.5h2v2M14.5 8v2M14.5 12.5v2h-2M10 14.5H8M5.5 14.5h-2v-2M3.5 10V8" />
  </I>
);

export const IconText = () => (
  <I>
    <path d="M4 5.5v-2h10v2M9 3.5v11M7 14.5h4" />
  </I>
);

export const IconGrid = () => (
  <I>
    <rect x="3.5" y="3.5" width="11" height="11" />
    <path d="M7.2 3.5v11M10.8 3.5v11M3.5 7.2h11M3.5 10.8h11" strokeWidth={1} />
  </I>
);

export const IconOnion = () => (
  <I>
    <rect x="2.8" y="5.2" width="9" height="9" opacity={0.45} />
    <rect x="6.2" y="2.8" width="9" height="9" />
  </I>
);

export const IconImport = () => (
  <I>
    <path d="M9 2.8v7.4M9 10.2 6.2 7.4M9 10.2l2.8-2.8" />
    <path d="M3.5 11.5v2a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-2" />
  </I>
);

export const IconExport = () => (
  <I>
    <path d="M9 10.2V2.8M9 2.8 6.2 5.6M9 2.8l2.8 2.8" />
    <path d="M3.5 11.5v2a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-2" />
  </I>
);

export const IconSend = () => (
  <I>
    <path d="M15 3 8.2 9.8M15 3 10.6 15l-2.4-5.2L3 7.4 15 3Z" />
  </I>
);

export const IconPlay = () => (
  <I>
    <path d="M6 3.8v10.4L14 9 6 3.8Z" fill="currentColor" stroke="none" />
  </I>
);

export const IconPause = () => (
  <I>
    <path d="M5.5 4v10M12.5 4v10" strokeWidth={2.4} />
  </I>
);

export const IconEyeOpen = () => (
  <I>
    <path d="M2.5 9s2.4-4 6.5-4 6.5 4 6.5 4-2.4 4-6.5 4-6.5-4-6.5-4Z" />
    <circle cx="9" cy="9" r="1.8" />
  </I>
);

export const IconEyeClosed = () => (
  <I>
    <path d="M3.5 10.5c1.4 1.4 3.2 2.5 5.5 2.5s4.1-1.1 5.5-2.5" />
    <path d="M9 13v2M5.2 12.4l-1 1.7M12.8 12.4l1 1.7" />
  </I>
);

export const IconTrash = () => (
  <I>
    <path d="M4 5.5h10M7 5.5v-1a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" />
    <path d="M5.2 5.5 6 14.2a1 1 0 0 0 1 .8h4a1 1 0 0 0 1-.8l.8-8.7" />
    <path d="M7.8 8v4M10.2 8v4" />
  </I>
);

export const IconDuplicate = () => (
  <I>
    <rect x="6" y="6" width="8.5" height="8.5" rx="1" />
    <path d="M4 11.5H3.5A1.5 1.5 0 0 1 2 10V4.5A1.5 1.5 0 0 1 3.5 3H10a1.5 1.5 0 0 1 1.5 1.5" />
  </I>
);

export const IconUp = () => (
  <I>
    <path d="M9 14V4M9 4 5 8M9 4l4 4" />
  </I>
);

export const IconDown = () => (
  <I>
    <path d="M9 4v10M9 14l-4-4M9 14l4-4" />
  </I>
);

export const IconStamp = () => (
  <I>
    <path d="M7 3.5h4l-.7 4h2.2a1.5 1.5 0 0 1 1.5 1.5v2H4V9a1.5 1.5 0 0 1 1.5-1.5h2.2L7 3.5Z" />
    <path d="M4 13.5h10" />
  </I>
);

export const IconPlus = () => (
  <I>
    <path d="M9 3.8v10.4M3.8 9h10.4" />
  </I>
);

export const IconDiamond = ({ filled = false }: { filled?: boolean }) => (
  <svg width={11} height={11} viewBox="0 0 11 11">
    <path
      d="M5.5 0.8 10.2 5.5 5.5 10.2 0.8 5.5Z"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.2}
    />
  </svg>
);

export const IconHelp = () => (
  <I>
    <circle cx="9" cy="9" r="6.5" />
    <path d="M7.2 7.2A1.9 1.9 0 0 1 9 5.8c1 0 1.9.7 1.9 1.7 0 1.2-1.9 1.4-1.9 2.7" />
    <circle cx="9" cy="12.5" r="0.7" fill="currentColor" stroke="none" />
  </I>
);

export const IconChip = () => (
  <I>
    <rect x="4.5" y="4.5" width="9" height="9" rx="1.5" />
    <path d="M7 4.5V2.5M11 4.5V2.5M7 15.5v-2M11 15.5v-2M4.5 7H2.5M4.5 11H2.5M15.5 7h-2M15.5 11h-2" />
  </I>
);

export const IconChevron = ({ open }: { open: boolean }) => (
  <svg
    width={12}
    height={12}
    viewBox="0 0 12 12"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.12s" }}
  >
    <path d="M4.5 2.5 8 6l-3.5 3.5" />
  </svg>
);

export const IconClose = () => (
  <I>
    <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
  </I>
);
