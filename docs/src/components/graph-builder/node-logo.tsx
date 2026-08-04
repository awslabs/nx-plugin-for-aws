/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import a2aLogo from '@assets/logos/a2a.svg';
import agentcoreLogo from '@assets/logos/agentcore.svg';
import auroraLogo from '@assets/logos/aurora.svg';
import copilotkitLogo from '@assets/logos/copilotkit.png';
import dynamodbLogo from '@assets/logos/dynamodb.svg';
import fastapiLogo from '@assets/logos/fastapi.svg';
import mcpLogo from '@assets/logos/mcp.svg';
import pythonLogo from '@assets/logos/python.svg';
import reactLogo from '@assets/logos/react.svg';
import smithyLogo from '@assets/logos/smithy.svg';
import strandsLogo from '@assets/logos/strands.svg';
import trpcLogo from '@assets/logos/trpc.svg';
import typescriptLogo from '@assets/logos/typescript.svg';

/**
 * Logo artwork for graph nodes, resolved through Astro's asset pipeline. React
 * islands can't use `astro:assets`, so each import yields metadata whose `src`
 * is used directly.
 */
const LOGOS: Record<string, { src: string }> = {
  a2a: a2aLogo,
  agentcore: agentcoreLogo,
  aurora: auroraLogo,
  copilotkit: copilotkitLogo,
  dynamodb: dynamodbLogo,
  fastapi: fastapiLogo,
  mcp: mcpLogo,
  python: pythonLogo,
  react: reactLogo,
  smithy: smithyLogo,
  strands: strandsLogo,
  trpc: trpcLogo,
  typescript: typescriptLogo,
};

interface Props {
  logo: string;
  badge?: string;
  alt: string;
}

export const NodeLogo = ({ logo, badge, alt }: Props) => {
  const src = LOGOS[logo] ?? LOGOS.typescript;
  const badgeSrc = badge ? LOGOS[badge] : undefined;
  return (
    <span className={`gb-logo gb-logo--${logo}`}>
      <img src={src.src} alt={alt} loading="lazy" draggable={false} />
      {badgeSrc && (
        <span className="gb-logo-badge">
          <img src={badgeSrc.src} alt="" loading="lazy" draggable={false} />
        </span>
      )}
    </span>
  );
};
