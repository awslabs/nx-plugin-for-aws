/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { logger, type Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { injectRdsCaBundleIntoDockerfile } from './utils.js';

const DOCKERFILE = 'packages/svc/src/my-agent/Dockerfile';

const COMMENT_LINE =
  '# Node trusts only its bundled CA store unless it is given extra certificates.';
const ENV_LINE =
  'ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/rds-bundle.crt';
const CURL_LINE =
  '    curl -fsSL "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem" \\';

/** The CA step the connection generators wrote before they set the ENV. */
const OLD_VENDED_STEP = [
  'RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \\',
  '    rm -rf /var/lib/apt/lists/* && \\',
  CURL_LINE,
  '    -o /usr/local/share/ca-certificates/rds-bundle.crt && \\',
  '    update-ca-certificates',
].join('\n');

/** A vended ts#agent Dockerfile: one build stage, one EXPOSE. */
const vendedDockerfile = `FROM public.ecr.aws/docker/library/node:lts-slim

WORKDIR /app

COPY index.js /app

EXPOSE 8080

CMD [ "node", "index.js" ]
`;

/** Two build stages, each with its own EXPOSE line. */
const multiStageDockerfile = `FROM public.ecr.aws/docker/library/node:lts-slim AS builder

WORKDIR /build

COPY . /build

EXPOSE 3000

RUN npm run build

FROM public.ecr.aws/docker/library/node:lts-slim

WORKDIR /app

COPY --from=builder /build/index.js /app

EXPOSE 8080

CMD [ "node", "index.js" ]
`;

const count = (content: string, text: string) => content.split(text).length - 1;

describe('injectRdsCaBundleIntoDockerfile', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  const write = (content: string) => tree.write(DOCKERFILE, content);
  const read = () => tree.read(DOCKERFILE, 'utf-8') ?? '';
  const inject = () => injectRdsCaBundleIntoDockerfile(tree, DOCKERFILE);

  it('adds the step and the ENV before EXPOSE in a fresh Dockerfile', () => {
    write(vendedDockerfile);

    inject();

    const content = read();
    expect(count(content, ENV_LINE)).toBe(1);
    expect(content).toContain(`${COMMENT_LINE}\n${ENV_LINE}\n`);
    expect(content.indexOf(ENV_LINE)).toBeGreaterThan(
      content.indexOf('update-ca-certificates\n'),
    );
    expect(content.indexOf(ENV_LINE)).toBeLessThan(
      content.indexOf('EXPOSE 8080'),
    );
  });

  it('changes nothing on a second run', () => {
    write(vendedDockerfile);

    inject();
    const first = read();
    inject();

    expect(read()).toBe(first);
    expect(count(first, ENV_LINE)).toBe(1);
    expect(count(first, CURL_LINE)).toBe(1);
  });

  it('adds the ENV to a Dockerfile that has the old step', () => {
    write(vendedDockerfile.replace('EXPOSE', `${OLD_VENDED_STEP}\n\nEXPOSE`));

    inject();

    const content = read();
    expect(count(content, ENV_LINE)).toBe(1);
    expect(count(content, CURL_LINE)).toBe(1);
    expect(content).toContain(
      `    update-ca-certificates\n${COMMENT_LINE}\n${ENV_LINE}\n`,
    );
  });

  it('keeps a NODE_EXTRA_CA_CERTS the user set and adds only the step', () => {
    write(
      vendedDockerfile.replace(
        'EXPOSE',
        'ENV NODE_EXTRA_CA_CERTS=/custom.pem\n\nEXPOSE',
      ),
    );

    inject();

    const content = read();
    expect(content).toContain('ENV NODE_EXTRA_CA_CERTS=/custom.pem');
    expect(count(content, 'NODE_EXTRA_CA_CERTS')).toBe(1);
    expect(count(content, CURL_LINE)).toBe(1);
  });

  it.each([
    ['legacy ENV form', 'ENV NODE_EXTRA_CA_CERTS /custom.pem'],
    ['multi-pair ENV', 'ENV OTHER=value NODE_EXTRA_CA_CERTS=/custom.pem'],
  ])('treats an %s as set by the user', (_name, envLine) => {
    write(vendedDockerfile.replace('EXPOSE', `${envLine}\n\nEXPOSE`));

    inject();

    const content = read();
    expect(content).toContain(envLine);
    expect(count(content, 'NODE_EXTRA_CA_CERTS')).toBe(1);
    expect(count(content, CURL_LINE)).toBe(1);
  });

  it.each([
    ['a comment mentioning it', '# TODO: set NODE_EXTRA_CA_CERTS one day'],
    ['a bare ARG', 'ARG NODE_EXTRA_CA_CERTS'],
    ['a differently named variable', 'ENV MY_NODE_EXTRA_CA_CERTS=/custom.pem'],
  ])('sets NODE_EXTRA_CA_CERTS despite %s', (_name, line) => {
    write(vendedDockerfile.replace('EXPOSE', `${line}\n\nEXPOSE`));

    inject();

    const content = read();
    expect(content).toContain(line);
    expect(count(content, ENV_LINE)).toBe(1);
  });

  it('leaves a Dockerfile whose last stage has no EXPOSE unchanged', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const noExpose = vendedDockerfile.replace('EXPOSE 8080\n\n', '');
    write(noExpose);

    inject();

    expect(read()).toBe(noExpose);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(DOCKERFILE));
    warn.mockRestore();
  });

  it('adds the step to the last stage of a multi-stage Dockerfile', () => {
    write(multiStageDockerfile);

    inject();

    const content = read();
    expect(count(content, CURL_LINE)).toBe(1);
    expect(count(content, ENV_LINE)).toBe(1);
    // The step belongs to the stage that runs, after the second FROM.
    expect(content.indexOf(CURL_LINE)).toBeGreaterThan(
      content.lastIndexOf('FROM public.ecr.aws/docker/library/node:lts-slim\n'),
    );
    expect(content.indexOf(ENV_LINE)).toBeLessThan(
      content.indexOf('EXPOSE 8080'),
    );
    expect(content.indexOf('EXPOSE 3000')).toBeLessThan(
      content.indexOf(CURL_LINE),
    );
  });

  it('leaves a multi-stage Dockerfile whose last stage has no EXPOSE unchanged', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const noFinalExpose = multiStageDockerfile.replace('EXPOSE 8080\n\n', '');
    write(noFinalExpose);

    inject();

    expect(read()).toBe(noFinalExpose);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(DOCKERFILE));
    warn.mockRestore();
  });

  it('keeps CRLF line endings', () => {
    write(vendedDockerfile.replace(/\n/g, '\r\n'));

    inject();

    const content = read();
    expect(count(content, ENV_LINE)).toBe(1);
    expect(count(content, '\n')).toBe(count(content, '\r\n'));
    expect(content.replace(/\r\n/g, '\n')).toBe(
      (() => {
        const unix = createTreeWithEmptyWorkspace();
        unix.write(DOCKERFILE, vendedDockerfile);
        injectRdsCaBundleIntoDockerfile(unix, DOCKERFILE);
        return unix.read(DOCKERFILE, 'utf-8') ?? '';
      })(),
    );
  });

  it('adds the ENV to a CRLF Dockerfile that has the old step', () => {
    write(
      vendedDockerfile
        .replace('EXPOSE', `${OLD_VENDED_STEP}\n\nEXPOSE`)
        .replace(/\n/g, '\r\n'),
    );

    inject();

    const content = read();
    expect(count(content, ENV_LINE)).toBe(1);
    expect(count(content, CURL_LINE)).toBe(1);
    expect(count(content, '\n')).toBe(count(content, '\r\n'));
  });

  it('does nothing when the Dockerfile does not exist', () => {
    inject();

    expect(tree.exists(DOCKERFILE)).toBe(false);
  });
});
