/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import cdkLogo from '@assets/logos/cdk.svg';
import cdkLogoDark from '@assets/logos/cdk-white.svg';
import terraformLogo from '@assets/logos/terraform.svg';

export type Iac = 'cdk' | 'terraform';

/**
 * Each provider's own brand artwork. Terraform's is HashiCorp purple, which
 * reads on both themes; the AWS CDK product icon ships as Squid Ink plus a white
 * variant for dark backgrounds.
 */
const BRANDS: Record<Iac, { label: string; light: string; dark?: string }> = {
  cdk: {
    label: 'CDK Infrastructure',
    light: cdkLogo.src,
    dark: cdkLogoDark.src,
  },
  terraform: { label: 'Terraform Infrastructure', light: terraformLogo.src },
};

interface Props {
  iac: Iac;
}

/**
 * Marks which IaC provider a diagram's commands scaffold, for the corner of a
 * read-only diagram. Pointing at it slides the provider's name out of the
 * icon's left side.
 */
export const IacMark = ({ iac }: Props) => {
  const brand = BRANDS[iac];
  return (
    <span
      className={`gb-iac-mark${brand.dark ? ' gb-iac-mark--has-dark' : ''}`}
      role="img"
      aria-label={`Scaffolds ${brand.label}`}
    >
      <span className="gb-iac-mark-label" aria-hidden="true">
        {brand.label}
      </span>
      <span className="gb-iac-mark-icon">
        <img
          className="gb-iac-mark-logo gb-iac-mark-logo--light"
          src={brand.light}
          alt=""
          loading="lazy"
          draggable={false}
        />
        {brand.dark && (
          <img
            className="gb-iac-mark-logo gb-iac-mark-logo--dark"
            src={brand.dark}
            alt=""
            loading="lazy"
            draggable={false}
          />
        )}
      </span>
    </span>
  );
};

export default IacMark;
