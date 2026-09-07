/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * An AWS service icon, served from `public/icons/aws` — the same artwork the
 * guides' architecture diagrams use. These are public assets rather than bundled
 * imports so a blueprint can name one as a string, without every icon in the set
 * having to be imported whether or not a diagram uses it.
 */
const base = import.meta.env.BASE_URL.replace(/\/$/, '');

interface Props {
  icon: string;
  alt: string;
}

export const AwsIcon = ({ icon, alt }: Props) => (
  <img
    className="gb-aws-icon"
    src={`${base}/icons/aws/${icon}.svg`}
    alt={alt}
    loading="lazy"
    draggable={false}
  />
);
