/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { applyTabsFilter } from './tabs-filter';

describe('applyTabsFilter', () => {
  const source = `before
<Tabs syncKey="http-rest">
<TabItem label="REST API" _filter={{ computeType: 'Rest' }}>
REST-body
</TabItem>
<TabItem label="HTTP API" _filter={{ computeType: 'Http' }}>
HTTP-body
</TabItem>
</Tabs>
after`;

  it('inlines the single matching TabItem body when options match one tab', () => {
    const out = applyTabsFilter(source, { computeType: 'Rest' });
    expect(out).toContain('REST-body');
    expect(out).not.toContain('HTTP-body');
    expect(out).not.toContain('<Tabs');
    expect(out).not.toContain('<TabItem');
  });

  it('keeps both TabItems untouched when the relevant option is not supplied', () => {
    const out = applyTabsFilter(source, { auth: 'IAM' });
    expect(out).toContain('REST-body');
    expect(out).toContain('HTTP-body');
    expect(out).toContain('<Tabs syncKey="http-rest">');
    // The _filter prop itself should be stripped to keep MDX clean.
    expect(out).not.toContain('_filter=');
  });

  it('drops tabs entirely when options match none of the filtered items', () => {
    const text = `<Tabs>
<TabItem label="A" _filter={{ key: 'x' }}>
A
</TabItem>
<TabItem label="B" _filter={{ key: 'y' }}>
B
</TabItem>
</Tabs>`;
    const out = applyTabsFilter(text, { key: 'z' });
    expect(out.trim()).toBe('');
  });

  it('leaves Tabs groups with no _filter hints untouched', () => {
    const text = `<Tabs><TabItem label="A">body</TabItem></Tabs>`;
    const out = applyTabsFilter(text, { computeType: 'Rest' });
    expect(out).toBe(text);
  });

  it('strips _filter props even without options supplied', () => {
    const out = applyTabsFilter(source);
    expect(out).not.toContain('_filter=');
    expect(out).toContain('REST-body');
    expect(out).toContain('HTTP-body');
  });

  it('keeps multiple matching TabItems when predicate allows several', () => {
    const text = `<Tabs>
<TabItem label="Rest" _filter={{ computeType: 'Rest' }}>
rest
</TabItem>
<TabItem label="Http" _filter={{ computeType: 'Http' }}>
http
</TabItem>
<TabItem label="Any">
any
</TabItem>
</Tabs>`;
    // auth supplied but computeType not — neither filtered tab matches,
    // so the group is dropped.
    const out = applyTabsFilter(text, { auth: 'IAM' });
    expect(out).toContain('<Tabs');
  });
});
