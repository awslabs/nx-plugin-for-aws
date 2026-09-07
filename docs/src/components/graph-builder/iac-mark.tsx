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
const BRANDS: Record<
  Iac,
  { name: string; label: string; light: string; dark?: string }
> = {
  cdk: {
    name: 'CDK',
    label: 'CDK Infrastructure',
    light: cdkLogo.src,
    dark: cdkLogoDark.src,
  },
  terraform: {
    name: 'Terraform',
    label: 'Terraform Infrastructure',
    light: terraformLogo.src,
  },
};

const other = (iac: Iac): Iac => (iac === 'cdk' ? 'terraform' : 'cdk');

interface Props {
  iac: Iac;
  /**
   * Given, the mark becomes a button that switches to the other provider, and
   * says so when pointed at. Left off, it just names the provider in use.
   */
  onSwitch?: (next: Iac) => void;
}

/**
 * Marks which IaC provider a diagram's commands scaffold, for the corner of a
 * diagram. Pointing at it slides the wording out of the icon's left side.
 */
export const IacMark = ({ iac, onSwitch }: Props) => {
  const brand = BRANDS[iac];
  const text = onSwitch
    ? `Click to switch to ${BRANDS[other(iac)].name}`
    : brand.label;
  const className = `gb-iac-mark${brand.dark ? ' gb-iac-mark--has-dark' : ''}${
    onSwitch ? ' gb-iac-mark--button' : ''
  }`;

  const content = (
    <>
      <span className="gb-iac-mark-label" aria-hidden="true">
        {text}
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
    </>
  );

  if (onSwitch) {
    return (
      <button
        type="button"
        className={className}
        aria-label={text}
        onClick={() => onSwitch(other(iac))}
      >
        {content}
      </button>
    );
  }

  return (
    <span className={className} role="img" aria-label={brand.label}>
      {content}
    </span>
  );
};

export default IacMark;
