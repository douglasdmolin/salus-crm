"use client";
import type { CSSProperties, ReactNode } from "react";

type IconName =
  | "search" | "plus" | "filter" | "more" | "close" | "chat" | "phone" | "mail"
  | "building" | "calendar" | "clock" | "sparkle" | "ai" | "trend" | "trendDown"
  | "arrowRight" | "check" | "checkDouble" | "send" | "paperclip" | "smile"
  | "dashboard" | "kanban" | "settings" | "bell" | "users" | "money" | "user"
  | "chevronRight" | "chevronDown" | "tag" | "pause" | "play" | "whatsapp"
  | "fire" | "bolt" | "edit" | "archive" | "mic" | "video" | "download";

const paths: Record<IconName, ReactNode> = {
  search: <><circle cx="112" cy="112" r="80"/><line x1="168.57" y1="168.57" x2="224" y2="224"/></>,
  plus: <><line x1="40" y1="128" x2="216" y2="128"/><line x1="128" y1="40" x2="128" y2="216"/></>,
  filter: <path d="M40 56H216L152 128v80l-48-24V128Z"/>,
  more: <><circle cx="128" cy="128" r="10" fill="currentColor" stroke="none"/><circle cx="64" cy="128" r="10" fill="currentColor" stroke="none"/><circle cx="192" cy="128" r="10" fill="currentColor" stroke="none"/></>,
  close: <><line x1="200" y1="56" x2="56" y2="200"/><line x1="200" y1="200" x2="56" y2="56"/></>,
  chat: <path d="M45.39 193.23a8 8 0 0 1-7.08-11.8A95.09 95.09 0 0 0 48 136c0-48.6 40.23-88 89.33-88A87.73 87.73 0 0 1 220.17 104a87.57 87.57 0 0 1-25.16 70.78C177.58 192.22 154.17 200 128 200a95.09 95.09 0 0 1-45.43-10.31 8 8 0 0 1-5.08-1.27L45.39 193.23Z"/>,
  phone: <path d="M159.36 40H96.64a16 16 0 0 0-16 16v144a16 16 0 0 0 16 16h62.72a16 16 0 0 0 16-16V56a16 16 0 0 0-16-16Zm-31.36 168a12 12 0 1 1 12-12 12 12 0 0 1-12 12Zm32-40H96V64h64Z"/>,
  mail: <><rect x="32" y="48" width="192" height="160" rx="8"/><polyline points="224 56 128 144 32 56"/></>,
  building: <><rect x="40" y="40" width="176" height="176" rx="8"/><line x1="88" y1="72" x2="88" y2="88"/><line x1="168" y1="72" x2="168" y2="88"/><line x1="88" y1="120" x2="88" y2="136"/><line x1="168" y1="120" x2="168" y2="136"/><line x1="88" y1="168" x2="88" y2="216"/><line x1="168" y1="168" x2="168" y2="216"/></>,
  calendar: <><rect x="40" y="40" width="176" height="176" rx="8"/><line x1="176" y1="24" x2="176" y2="56"/><line x1="80" y1="24" x2="80" y2="56"/><line x1="40" y1="88" x2="216" y2="88"/></>,
  clock: <><circle cx="128" cy="128" r="96"/><polyline points="128 72 128 128 184 128"/></>,
  sparkle: <path d="M197.58 129.06 146 110l-19.06-51.58a8 8 0 0 0-15 0L93 110l-51.62 19.06a8 8 0 0 0 0 15L93 163.09l19.06 51.58a8 8 0 0 0 15 0L146 163.09l51.58-19.06a8 8 0 0 0 0-15ZM168 48h16V32a8 8 0 0 1 16 0v16h16a8 8 0 0 1 0 16h-16v16a8 8 0 0 1-16 0V64h-16a8 8 0 0 1 0-16Z"/>,
  ai: <><circle cx="128" cy="128" r="88"/><circle cx="128" cy="128" r="32"/></>,
  trend: <><polyline points="224 64 144 144 104 104 32 176"/><polyline points="224 136 224 64 152 64"/></>,
  trendDown: <><polyline points="224 192 144 112 104 152 32 80"/><polyline points="224 120 224 192 152 192"/></>,
  arrowRight: <><line x1="40" y1="128" x2="216" y2="128"/><polyline points="144 56 216 128 144 200"/></>,
  check: <polyline points="216 72 104 184 48 128"/>,
  checkDouble: <><polyline points="168 72 80 160 40 120"/><polyline points="216 72 128 160 112 144"/></>,
  send: <path d="m224 128-168 88 24-88-24-88 168 88Z"/>,
  paperclip: <path d="M209.66 122.34a8 8 0 0 1 0 11.32l-82.34 82.34a48 48 0 0 1-67.88-67.88l96-96a32 32 0 0 1 45.26 45.26l-96 96a16 16 0 0 1-22.64-22.64l72-72"/>,
  smile: <><circle cx="128" cy="128" r="96"/><circle cx="92" cy="108" r="10" fill="currentColor" stroke="none"/><circle cx="164" cy="108" r="10" fill="currentColor" stroke="none"/><path d="M169.6 152a48.08 48.08 0 0 1-83.2 0"/></>,
  dashboard: <><rect x="40" y="40" width="72" height="72" rx="4"/><rect x="144" y="40" width="72" height="72" rx="4"/><rect x="40" y="144" width="72" height="72" rx="4"/><rect x="144" y="144" width="72" height="72" rx="4"/></>,
  kanban: <><rect x="32" y="48" width="48" height="160" rx="4"/><rect x="104" y="48" width="48" height="112" rx="4"/><rect x="176" y="48" width="48" height="72" rx="4"/></>,
  settings: <><circle cx="128" cy="128" r="40"/><path d="M41.43 178.09a80 80 0 0 1-3.83-9.25L74.51 126 37.6 87.16a80 80 0 0 1 3.83-9.25l52 11.62a80.23 80.23 0 0 1 15.74-9.09L128 32h16l18.8 50.52a80.23 80.23 0 0 1 15.74 9.09l52-11.62a80 80 0 0 1 3.83 9.25L197.49 126l36.91 38.84a80 80 0 0 1-3.83 9.25l-52-11.62a80.23 80.23 0 0 1-15.74 9.09L144 224h-16l-18.8-50.52a80.23 80.23 0 0 1-15.74-9.09Z"/></>,
  bell: <><path d="M56 104a72 72 0 0 1 144 0c0 35.82 8 56 14 64H42c6-8 14-28.18 14-64Z"/><path d="M96 192a32 32 0 0 0 64 0"/></>,
  users: <><circle cx="100" cy="112" r="48"/><path d="M26 200a80 80 0 0 1 148 0"/><path d="M168 72a48 48 0 0 1 34 82"/><path d="M196 208a80 80 0 0 0-26-40"/></>,
  money: <><circle cx="128" cy="128" r="96"/><path d="M104 168h40a20 20 0 0 0 0-40h-32a20 20 0 0 1 0-40h40"/><line x1="128" y1="80" x2="128" y2="88"/><line x1="128" y1="168" x2="128" y2="176"/></>,
  user: <><circle cx="128" cy="104" r="48"/><path d="M32 216a96 96 0 0 1 192 0"/></>,
  chevronRight: <polyline points="96 48 176 128 96 208"/>,
  chevronDown: <polyline points="208 96 128 176 48 96"/>,
  tag: <><path d="M128 24 24 128l104 104 104-104V24Z"/><circle cx="180" cy="76" r="12" fill="currentColor" stroke="none"/></>,
  pause: <><rect x="152" y="40" width="52" height="176" rx="8"/><rect x="52" y="40" width="52" height="176" rx="8"/></>,
  play: <path d="m232 128-160 96V32Z"/>,
  whatsapp: <path d="M187.58 144.84l-32-16a8 8 0 0 0-8 .5l-14.69 9.8a40.55 40.55 0 0 1-16-16l9.8-14.69a8 8 0 0 0 .5-8l-16-32a8 8 0 0 0-11.1-3.24 48.08 48.08 0 0 0-23.84 41.13C76 184.61 111.39 220 155.66 220a48.08 48.08 0 0 0 41.13-23.84 8 8 0 0 0-3.21-11.32Z" fill="currentColor" stroke="none"/>,
  fire: <path d="M184.33 111.68a75.9 75.9 0 0 1 23.67 55c0 40.59-36 74.08-76 75.3a80 80 0 0 1-84-80c0-40 26-72 42-86s20-16 20-16-4 40 20 60 34 20 44 32 10 22 10 32 0 12 0 12-8-4-16-12-8-16-8-16"/>,
  bolt: <path d="m96 240 16-80-64-24L160 16l-16 80 64 24Z"/>,
  edit: <><path d="M96 216H48a8 8 0 0 1-8-8v-40l120-120 48 48-120 120Z"/><line x1="144" y1="56" x2="192" y2="104"/></>,
  archive: <><rect x="32" y="48" width="192" height="40" rx="4"/><path d="M48 88v128a8 8 0 0 0 8 8h144a8 8 0 0 0 8-8V88"/><line x1="104" y1="136" x2="152" y2="136"/></>,
  mic: <><rect x="88" y="24" width="80" height="128" rx="40"/><path d="M200 120a72 72 0 0 1-144 0"/><line x1="128" y1="192" x2="128" y2="232"/></>,
  video: <><rect x="24" y="64" width="144" height="128" rx="8"/><polygon points="168 104 232 72 232 184 168 152 168 104"/></>,
  download: <><path d="M216 144v64a8 8 0 0 1-8 8H48a8 8 0 0 1-8-8v-64"/><polyline points="86 110 128 152 170 110"/><line x1="128" y1="40" x2="128" y2="152"/></>,
};

export function Icon({
  name,
  size = 16,
  className = "",
  style = {},
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="none"
      stroke="currentColor"
      strokeWidth={16}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
    >
      {paths[name]}
    </svg>
  );
}

export function WhatsappIcon({ size = 16, style = {} }: { size?: number; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="currentColor" style={style}>
      <path d="M187.58 144.84l-32-16a8 8 0 0 0-8 .5l-14.69 9.8a40.55 40.55 0 0 1-16-16l9.8-14.69a8 8 0 0 0 .5-8l-16-32a8 8 0 0 0-11.1-3.24 48.08 48.08 0 0 0-23.84 41.13C76 184.61 111.39 220 155.66 220a48.08 48.08 0 0 0 41.13-23.84 8 8 0 0 0-3.21-11.32ZM152 168a61.62 61.62 0 0 1-61.56-61.56 32.13 32.13 0 0 1 13.27-26L115 104.83l-7.69 11.53a8 8 0 0 0-.59 7.84 56.55 56.55 0 0 0 27 27 8 8 0 0 0 7.84-.59L153.17 143l11.39 5.7A32.13 32.13 0 0 1 152 168Zm76-40A100.11 100.11 0 0 1 82.09 213.3l-35.21 11.74a12 12 0 0 1-15.18-15.18l11.74-35.21A100 100 0 1 1 228 128Zm-16 0a84 84 0 1 0-155.89 43.8 4 4 0 0 1 .37 3.05l-12.92 38.76 38.76-12.92a4 4 0 0 1 3.05.37A84 84 0 0 0 212 128Z"/>
    </svg>
  );
}
