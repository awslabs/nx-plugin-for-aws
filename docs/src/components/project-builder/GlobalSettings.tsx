/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { GlobalSettings as GlobalSettingsType } from './types';

interface GlobalSettingsProps {
  settings: GlobalSettingsType;
  onChange: (settings: GlobalSettingsType) => void;
}

const selectStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: '4px',
  border: '1px solid var(--sl-color-gray-5)',
  background: 'var(--sl-color-bg)',
  color: 'var(--sl-color-white)',
  fontSize: '12px',
};

const inputStyle: React.CSSProperties = {
  ...selectStyle,
  width: '140px',
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  color: 'var(--sl-color-gray-2)',
  fontSize: '12px',
};

const GlobalSettings: React.FC<GlobalSettingsProps> = ({
  settings,
  onChange,
}) => {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        padding: '8px 12px',
        background: 'var(--sl-color-bg-nav)',
        borderBottom: '1px solid var(--sl-color-gray-5)',
        flexWrap: 'wrap',
      }}
    >
      <label style={labelStyle}>
        Workspace
        <input
          value={settings.workspaceName}
          onChange={(e) =>
            onChange({ ...settings, workspaceName: e.target.value })
          }
          style={inputStyle}
          placeholder="my-project"
        />
      </label>

      <label style={labelStyle}>
        Package Manager
        <select
          value={settings.packageManager}
          onChange={(e) =>
            onChange({ ...settings, packageManager: e.target.value as any })
          }
          style={selectStyle}
        >
          <option value="pnpm">pnpm</option>
          <option value="npm">npm</option>
          <option value="yarn">yarn</option>
          <option value="bun">bun</option>
        </select>
      </label>

      <label style={labelStyle}>
        IaC Provider
        <select
          value={settings.iacProvider}
          onChange={(e) =>
            onChange({ ...settings, iacProvider: e.target.value as any })
          }
          style={selectStyle}
        >
          <option value="CDK">AWS CDK</option>
          <option value="Terraform">Terraform</option>
        </select>
      </label>
    </div>
  );
};

export default GlobalSettings;
