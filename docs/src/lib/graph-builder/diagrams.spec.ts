/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { DIAGRAMS } from './diagrams';
import { buildDeclaredLayout } from './infrastructure';

/**
 * A declared diagram names the tiles its connections join, so a typo would draw a
 * box with an arrow missing rather than failing anywhere.
 */
describe('declared diagrams', () => {
  it.each(Object.entries(DIAGRAMS))('should lay out %s', (_name, diagram) => {
    const layout = buildDeclaredLayout(diagram);

    expect(layout.boxes).toHaveLength(diagram.boxes.length);
    expect(layout.connections).toHaveLength(diagram.connections.length);

    for (const box of layout.boxes) {
      expect(box.resources.length).toBeGreaterThan(0);
      // Everything fits inside the extent the diagram reports.
      expect(box.x + box.width).toBeLessThanOrEqual(layout.width);
      expect(box.y + box.height).toBeLessThanOrEqual(layout.height);
    }

    // Boxes sit on a grid sized to their contents, so none can overlap.
    for (const box of layout.boxes) {
      for (const other of layout.boxes) {
        if (box === other) continue;
        const overlaps =
          box.x < other.x + other.width &&
          other.x < box.x + box.width &&
          box.y < other.y + other.height &&
          other.y < box.y + box.height;
        expect(overlaps).toBe(false);
      }
    }
  });

  it('should draw runtime configuration reaching both of its readers', () => {
    const layout = buildDeclaredLayout(DIAGRAMS['runtime-config']);
    const named = layout.boxes.flatMap((box) =>
      box.resources.map((resource) => `${box.id}:${resource.id}`),
    );

    expect(named).toContain('appconfig:connection');
    // The website reads the deployed file; a Lambda or agent reads AppConfig.
    expect(named).toContain('website:json');
    expect(named).toContain('server:compute');
  });
});
