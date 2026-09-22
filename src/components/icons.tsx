import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const S = (props: IconProps) => ({
  viewBox: '0 0 24 24',
  width: 18,
  height: 18,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...props,
});

export const IconSelect = (p: IconProps) => (
  <svg {...S(p)}>
    <path d="M5 3l6.5 16 2.2-6.1L20 10.7z" />
  </svg>
);

export const IconDirectSelect = (p: IconProps) => (
  <svg {...S(p)}>
    <path d="M6 3l5.2 13 1.8-4.9L18 9.3z" />
    <path d="M12 12l-3 6" strokeDasharray="2 2" />
  </svg>
);

export const IconRectangle = (p: IconProps) => (
  <svg {...S(p)}>
    <rect x="3" y="5" width="18" height="14" rx="1" />
  </svg>
);

export const IconCircle = (p: IconProps) => (
  <svg {...S(p)}>
    <circle cx="12" cy="12" r="8" />
  </svg>
);

export const IconRing = (p: IconProps) => (
  <svg {...S(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="5" />
  </svg>
);

export const IconEllipse = (p: IconProps) => (
  <svg {...S(p)}>
    <ellipse cx="12" cy="12" rx="9" ry="6" />
  </svg>
);

export const IconLine = (p: IconProps) => (
  <svg {...S(p)}>
    <path d="M4 20L20 4" />
  </svg>
);

export const IconPen = (p: IconProps) => (
  <svg {...S(p)}>
    <path d="M12 3l4 7-4 2-4-2z" />
    <path d="M12 12v9" />
  </svg>
);

/** İzometrik küp aracı: eşkenar dörtgen taban + dikey kenarlar. */
export const IconIsoCube = (p: IconProps) => (
  <svg {...S(p)}>
    <path d="M12 3l7.5 4.3v8.6L12 20.2 4.5 15.9V7.3z" />
    <path d="M12 3l7.5 4.3L12 11.6 4.5 7.3" />
    <path d="M12 11.6v8.6" />
  </svg>
);

export const IconShapeBuilder = (p: IconProps) => (
  <svg {...S(p)}>
    <circle cx="9" cy="9" r="6" />
    <circle cx="15" cy="15" r="6" />
  </svg>
);

export const IconKnife = (p: IconProps) => (
  <svg {...S(p)}>
    <path d="M4 20L18 6" />
    <path d="M15 3l6 6-3 3-6-6z" />
  </svg>
);

export const IconHand = (p: IconProps) => (
  <svg {...S(p)}>
    <path d="M8 12V5.5a1.5 1.5 0 013 0V11" />
    <path d="M11 11V4.5a1.5 1.5 0 013 0V11" />
    <path d="M14 11V6.5a1.5 1.5 0 013 0V14a7 7 0 01-7 7h-.5a5.5 5.5 0 01-5.5-5.5V11a1.5 1.5 0 013 0v1" />
  </svg>
);

export const IconZoom = (p: IconProps) => (
  <svg {...S(p)}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="M15.5 15.5L21 21M8 10.5h5M10.5 8v5" />
  </svg>
);

export const IconEye = ({ open = true, ...p }: IconProps & { open?: boolean }) => (
  <svg {...S(p)}>
    {open ? (
      <>
        <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z" />
        <circle cx="12" cy="12" r="2.6" />
      </>
    ) : (
      <>
        <path d="M3 3l18 18" />
        <path d="M10.6 6.2A9.9 9.9 0 0112 6c6.4 0 10 6 10 6a17 17 0 01-3.2 3.7M6.2 8.1A17.7 17.7 0 002 12s3.6 6 10 6c1.5 0 2.8-.3 4-.8" />
      </>
    )}
  </svg>
);

export const IconLock = ({ locked = true, ...p }: IconProps & { locked?: boolean }) => (
  <svg {...S(p)}>
    {locked ? (
      <>
        <rect x="5" y="11" width="14" height="9" rx="1.5" />
        <path d="M8 11V8a4 4 0 018 0v3" />
      </>
    ) : (
      <>
        <rect x="5" y="11" width="14" height="9" rx="1.5" />
        <path d="M8 11V8a4 4 0 017-2.6" />
      </>
    )}
  </svg>
);

export const IconTrash = (p: IconProps) => (
  <svg {...S(p)}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
  </svg>
);

export const IconPlus = (p: IconProps) => (
  <svg {...S(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconUndo = (p: IconProps) => (
  <svg {...S(p)}>
    <path d="M9 7H5V3" />
    <path d="M5 7a9 9 0 1115 6" />
  </svg>
);

export const IconRedo = (p: IconProps) => (
  <svg {...S(p)}>
    <path d="M15 7h4V3" />
    <path d="M19 7A9 9 0 104 13" />
  </svg>
);

export const IconChevron = (p: IconProps) => (
  <svg {...S(p)}>
    <path d="M9 5l7 7-7 7" />
  </svg>
);

export const IconGrid = (p: IconProps) => (
  <svg {...S(p)}>
    <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
  </svg>
);

export const IconLayers = (p: IconProps) => (
  <svg {...S(p)}>
    <path d="M12 3l9 5-9 5-9-5z" />
    <path d="M3 13l9 5 9-5" />
  </svg>
);

export const IconExport = (p: IconProps) => (
  <svg {...S(p)}>
    <path d="M12 3v12" />
    <path d="M8 11l4 4 4-4" />
    <path d="M4 19h16" />
  </svg>
);

export const IconMonogram = (p: IconProps) => (
  <svg {...S(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 16V8m0 4h3a2 2 0 000-4H8" />
  </svg>
);

export const IconSave = (p: IconProps) => (
  <svg {...S(p)}>
    <path d="M5 3h11l3 3v15H5z" />
    <path d="M9 3v5h6V3M8 14h8v7H8z" />
  </svg>
);

export const IconOpen = (p: IconProps) => (
  <svg {...S(p)}>
    <path d="M3 6h6l2 2h10v11H3z" />
  </svg>
);

export const IconFile = (p: IconProps) => (
  <svg {...S(p)}>
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v4h4" />
  </svg>
);

export const IconConstruction = (p: IconProps) => (
  <svg {...S(p)}>
    <circle cx="12" cy="12" r="8" strokeDasharray="3 2" />
    <path d="M4 12h16M12 4v16" />
  </svg>
);

export const IconLogoView = (p: IconProps) => (
  <svg {...S(p)}>
    <circle cx="12" cy="12" r="8" />
    <path d="M9 15V9l3 4 3-4v6" />
  </svg>
);

export const IconOutline = (p: IconProps) => (
  <svg {...S(p)}>
    <circle cx="12" cy="12" r="8" strokeDasharray="2 2" />
    <circle cx="12" cy="12" r="5" />
  </svg>
);

export const IconDuplicate = (p: IconProps) => (
  <svg {...S(p)}>
    <rect x="8" y="8" width="12" height="12" rx="1" />
    <path d="M4 16V4h12" />
  </svg>
);

export const IconFit = (p: IconProps) => (
  <svg {...S(p)}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </svg>
);

export const IconFlipH = (p: IconProps) => (
  <svg {...S(p)}>
    <path d="M12 3v18" strokeDasharray="3 2" />
    <path d="M9 7L4 12l5 5zM15 7l5 5-5 5z" />
  </svg>
);

export const IconGuide = (p: IconProps) => (
  <svg {...S(p)}>
    <path d="M3 8h18M3 16h18" strokeDasharray="4 2" />
  </svg>
);

/* --------------------------------------------------- pathfinder ikonları */

export const PfUnite = () => (
  <svg viewBox="0 0 24 18">
    <path className="a" d="M2 4a4 4 0 014-4h5v14H6a4 4 0 01-4-4z" />
    <path className="b" d="M11 4a4 4 0 014-4h3a4 4 0 014 4v4a4 4 0 01-4 4h-3a4 4 0 00-4-4z" />
  </svg>
);

export const PfSubtract = () => (
  <svg viewBox="0 0 24 18">
    <path className="a" d="M2 4a4 4 0 014-4h6v14H6a4 4 0 01-4-4z" />
    <path className="outline" d="M12 4a4 4 0 014-4h2a4 4 0 014 4v4a4 4 0 01-4 4h-2a4 4 0 01-4-4z" />
  </svg>
);

export const PfIntersect = () => (
  <svg viewBox="0 0 24 18">
    <path className="outline" d="M2 4a4 4 0 014-4h5v10H6a4 4 0 01-4-4z" />
    <path className="outline" d="M12 4a4 4 0 014-4h3a4 4 0 014 4v4a4 4 0 01-4 4h-3a4 4 0 01-4-4z" />
    <path className="b" d="M9 4a4 4 0 014-4 4 4 0 014 4v4a4 4 0 01-4 4 4 4 0 01-4-4z" />
  </svg>
);

export const PfExclude = () => (
  <svg viewBox="0 0 24 18">
    <path className="a" d="M2 4a4 4 0 014-4h5v10H6a4 4 0 01-4-4z" />
    <path className="b" d="M17 14h-3a4 4 0 01-4-4V4a4 4 0 014-4h1a4 4 0 014 4z" />
    <path className="outline" d="M13 2a4 4 0 014-2h1a4 4 0 014 4v4a4 4 0 01-4 4h-2" />
  </svg>
);

export const PfDivide = () => (
  <svg viewBox="0 0 24 18">
    <path className="a" d="M2 4a4 4 0 014-4h5v14H6a4 4 0 01-4-4z" />
    <path className="b" d="M13 4a4 4 0 014-4h1a4 4 0 014 4v4a4 4 0 01-4 4h-1a4 4 0 01-4-4z" />
    <path className="outline" d="M11 0v18" stroke="currentColor" strokeWidth="1" />
  </svg>
);
