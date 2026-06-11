import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Base({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/** The Pawlog mark: solid paw print. */
export function PawIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <ellipse cx="7" cy="8.4" rx="1.7" ry="2.1" />
      <ellipse cx="10.4" cy="5.9" rx="1.7" ry="2.1" />
      <ellipse cx="13.6" cy="5.9" rx="1.7" ry="2.1" />
      <ellipse cx="17" cy="8.4" rx="1.7" ry="2.1" />
      <path d="M12 11.2c2.9 0 5.2 2 5.2 4.4 0 2.1-1.7 3.4-5.2 3.4s-5.2-1.3-5.2-3.4c0-2.4 2.3-4.4 5.2-4.4Z" />
    </svg>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4.5 11 12 4.5 19.5 11v8a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19Z" />
      <path d="M9.5 20.5v-5.5h5v5.5" />
    </Base>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" />
      <circle cx="8.5" cy="14" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="12" cy="14" r="0.9" fill="currentColor" stroke="none" />
    </Base>
  );
}

export function ListIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M9 6.5h11M9 12h11M9 17.5h11" />
      <circle cx="4.8" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="4.8" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="4.8" cy="17.5" r="1.1" fill="currentColor" stroke="none" />
    </Base>
  );
}

export function HeartIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 20s-7.5-4.8-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.2 12 20 12 20Z" />
    </Base>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 5v14M5 12h14" />
    </Base>
  );
}

export function GearIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18" />
    </Base>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />
    </Base>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
    </Base>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </Base>
  );
}

export function ArrowUpIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </Base>
  );
}

export function ArrowDownIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 5v14M6 13l6 6 6-6" />
    </Base>
  );
}

export function XIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Base>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Base>
  );
}

export function CameraIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2L9 5h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5Z" />
      <circle cx="12" cy="13" r="3.2" />
    </Base>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M5 7h14M9.5 7V4.5h5V7M7 7l1 13h8l1-13M10 11v5M14 11v5" />
    </Base>
  );
}

export function PencilIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M14.5 5 19 9.5 8.5 20H4v-4.5Z" />
      <path d="m12.5 7 4.5 4.5" />
    </Base>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15.5 15.5 5 5" />
    </Base>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 4v11M7.5 11 12 15.5 16.5 11M4.5 19.5h15" />
    </Base>
  );
}

export function SproutIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 20v-7" />
      <path d="M12 13c0-3.5 2.5-6 6.5-6 0 3.5-2.5 6-6.5 6ZM12 11C12 8 10 6 6.5 6c0 3 2 5 5.5 5Z" />
    </Base>
  );
}

export function DogIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M7 5.5C5 6 4 8 4 10.5c0 1 .5 1.8 1.5 2L6 15c.5 2.8 2.8 4.5 6 4.5s5.5-1.7 6-4.5l.5-2.5c1-.2 1.5-1 1.5-2C20 8 19 6 17 5.5 15.7 4.5 14 4 12 4s-3.7.5-5 1.5Z" />
      <circle cx="9.3" cy="11" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="14.7" cy="11" r="0.9" fill="currentColor" stroke="none" />
      <path d="M10.8 15h2.4l-1.2 1.3Z" fill="currentColor" stroke="none" />
    </Base>
  );
}

export function CatIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M5.5 10 5 4.5 9.3 7a7.6 7.6 0 0 1 5.4 0L19 4.5 18.5 10c.2.6.3 1.2.3 1.8 0 3.8-3 6.4-6.8 6.4s-6.8-2.6-6.8-6.4c0-.6.1-1.2.3-1.8Z" />
      <circle cx="9.3" cy="11.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="14.7" cy="11.5" r="0.9" fill="currentColor" stroke="none" />
      <path d="M2.5 12.5h2.8M2.8 15l2.6-.8M21.5 12.5h-2.8M21.2 15l-2.6-.8" />
    </Base>
  );
}

export function ShareIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 3.5v11" />
      <path d="m8.5 6.5 3.5-3.5 3.5 3.5" />
      <path d="M8 10.5H6.5A1.5 1.5 0 0 0 5 12v7a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-7a1.5 1.5 0 0 0-1.5-1.5H16" />
    </Base>
  );
}
