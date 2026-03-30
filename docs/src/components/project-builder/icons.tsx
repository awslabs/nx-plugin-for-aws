/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

const iconSize = 24;

export const ReactIcon = ({ color = '#61DAFB' }: { color?: string }) => (
  <svg viewBox="-11.5 -10.232 23 20.463" width={iconSize} height={iconSize}>
    <circle r="2.05" fill={color} />
    <g stroke={color} fill="none" strokeWidth="1">
      <ellipse rx="11" ry="4.2" />
      <ellipse rx="11" ry="4.2" transform="rotate(60)" />
      <ellipse rx="11" ry="4.2" transform="rotate(120)" />
    </g>
  </svg>
);

export const TrpcIcon = ({ color = '#2596BE' }: { color?: string }) => (
  <svg viewBox="0 0 512 512" width={iconSize} height={iconSize}>
    <rect width="512" height="512" rx="150" fill="none" />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M256 48L448 160V384L256 496L64 384V160L256 48ZM120 195L256 112L392 195V361L256 444L120 361V195Z"
      fill={color}
    />
    <path d="M256 176L336 224V320L256 368L176 320V224L256 176Z" fill={color} />
  </svg>
);

export const FastApiIcon = ({ color = '#009688' }: { color?: string }) => (
  <svg viewBox="0 0 24 24" width={iconSize} height={iconSize} fill={color}>
    <path d="M12 0C5.375 0 0 5.375 0 12c0 6.627 5.375 12 12 12 6.626 0 12-5.373 12-12 0-6.625-5.373-12-12-12zm-.624 21.62v-7.528H7.19L13.203 2.38v7.528h4.029L11.376 21.62z" />
  </svg>
);

export const SmithyIcon = ({ color = '#E27152' }: { color?: string }) => (
  <svg viewBox="0 0 24 24" width={iconSize} height={iconSize} fill={color}>
    <path d="M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.18L19.28 7.5 12 10.82 4.72 7.5 12 4.18zM4 8.92l7 3.5v7.16l-7-3.5V8.92zm16 0v7.16l-7 3.5v-7.16l7-3.5z" />
  </svg>
);

export const StrandsIcon = ({ color = '#FF9900' }: { color?: string }) => (
  <svg viewBox="0 0 24 24" width={iconSize} height={iconSize} fill={color}>
    <path d="M12 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm-5 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm10 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm-5 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm0 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4z" />
    <path
      d="M12 6v4m0 4v4M7 10l3 2m4 0l3-2"
      stroke={color}
      strokeWidth="1.5"
      fill="none"
    />
  </svg>
);

export const McpIcon = ({ color = '#FF9900' }: { color?: string }) => (
  <svg viewBox="0 0 24 24" width={iconSize} height={iconSize} fill={color}>
    <path d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h16v2H4v-2z" opacity="0.4" />
    <circle cx="7" cy="7" r="2" />
    <circle cx="17" cy="12" r="2" />
    <circle cx="7" cy="17" r="2" />
    <path
      d="M9 7h6m-6 5h6m-6 5h6"
      stroke={color}
      strokeWidth="1"
      fill="none"
      opacity="0.6"
    />
  </svg>
);

export const CdkIcon = ({ color = '#FF9900' }: { color?: string }) => (
  <svg viewBox="0 0 24 24" width={iconSize} height={iconSize} fill={color}>
    <path d="M12 2L3 7v10l9 5 9-5V7l-9-5zm0 2.18l6.28 3.49L12 11.16 5.72 7.67 12 4.18zM5 9.06l6 3.34v6.52l-6-3.33V9.06zm14 0v6.53l-6 3.33v-6.52l6-3.34z" />
  </svg>
);

const ICON_MAP: Record<string, React.FC<{ color?: string }>> = {
  react: ReactIcon,
  trpc: TrpcIcon,
  fastapi: FastApiIcon,
  smithy: SmithyIcon,
  strands: StrandsIcon,
  mcp: McpIcon,
  cdk: CdkIcon,
};

export const getIcon = (
  name: string,
  color?: string,
): React.ReactElement | null => {
  const Icon = ICON_MAP[name];
  return Icon ? <Icon color={color} /> : null;
};
