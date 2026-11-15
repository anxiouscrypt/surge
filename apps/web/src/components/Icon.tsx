import type { CSSProperties } from "react";
const paths = {
  bolt: "m13 2-9 12h7l-1 8L21 9h-8l1-7Z",
  layers: "m12 3 10 6-10 6L2 9l10-6Zm-9 11 9 5 9-5M3 18l9 5 9-5",
  pin: "M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0ZM12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  close: "m6 6 12 12M6 18 18 6",
  target: "M12 2v4m0 12v4M2 12h4m12 0h4M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z",
  globe:
    "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z",
  phone:
    "M8 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-4l-5-2-2 2a14 14 0 0 1-6-6l2-2-2-5Z",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2",
  signal: "M4 17v3m5-8v8m5-13v13m5-18v18",
  fire: "M12 2c2 6-5 7-2 11 3-1 4-4 4-6 5 4 7 7 5 11s-10 6-14 1S7 7 12 2Z",
  chevron: "m9 5 7 7-7 7",
  search: "M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0Zm-1 5 6 6",
  check: "m5 12 4 4L19 6",
  alert: "m12 3 10 18H2L12 3Zm0 5v6m0 3v1",
  medical: "M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3Z",
  car: "m5 5-3 8v6h3v-3h14v3h3v-6l-3-8H5Zm-3 8h20M6 5h12M6 13v2m12-2v2",
  wave: "M2 12h3l3-7 4 14 4-14 3 7h3",
  shield: "m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Z",
  minus: "M5 12h14",
  plus: "M5 12h14M12 5v14",
  camera: "M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Zm8 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5 11a7 7 0 0 0 14 0M12 18v3",
  message: "M4 5h16v11H9l-5 4V5Z",
  send: "M3 11 21 3l-8 18-2-8-8-2Z",
  battery: "M3 8h15v8H3V8Zm15 3h3v2h-3",
  users: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 10a7 7 0 0 1 14 0M17 4a4 4 0 0 1 0 7m2 3a6 6 0 0 1 3 7",
  headset: "M4 15v-3a8 8 0 0 1 16 0v3M4 15h3v5H4v-5Zm13 0h3v5h-3v-5Z",
  hospital: "M4 21V5h16v16M9 21v-4h6v4M12 8v5m-2.5-2.5h5",
  volume: "M4 9h4l5-4v14l-5-4H4V9Zm13 0a4 4 0 0 1 0 6",
  mute: "M4 9h4l5-4v14l-5-4H4V9Zm13 1 5 5m0-5-5 5",
} as const;
export type IconName = keyof typeof paths;
export function Icon({
  name,
  size = 18,
  style,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
