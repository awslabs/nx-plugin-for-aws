/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Runs the downloadable tutorial setup script against a fake `aws` binary that
 * records every invocation. The checks cover the behaviours a live run cannot
 * exercise safely: identity binding, refusal to adopt or resume, tolerance for
 * exactly the absent objects during cleanup, and the shape of the remote
 * install command.
 */

const SCRIPT = resolve(__dirname, '../../public/greengrass/setup-tutorial.sh');
const ACCOUNT = '123456789012';
const REGION = 'us-east-1';
const PREFIX = 'gg-test';
const CERT_ARN = `arn:aws:iot:${REGION}:${ACCOUNT}:cert/abc123`;

/**
 * The fake CLI. Every call is appended to FAKE_AWS_LOG as
 * `<service> <operation> <remaining args>`. Marker files under FAKE_AWS_DIR
 * change the canned answers.
 */
const FAKE_AWS = [
  '#!/usr/bin/env bash',
  'set -u',
  'service=""; op=""; rest=()',
  'i=1',
  'while (( i <= $# )); do',
  '  arg="${!i}"',
  '  case "$arg" in',
  '    --profile|--region) i=$((i + 2)); continue ;;',
  '  esac',
  '  if [[ -z "$service" ]]; then service="$arg"',
  '  elif [[ -z "$op" ]]; then op="$arg"',
  '  else rest+=("$arg"); fi',
  '  i=$((i + 1))',
  'done',
  'printf \'%s %s %s\\n\' "$service" "$op" "${rest[*]:-}" >>"$FAKE_AWS_LOG"',
  'fail() { printf \'An error occurred (%s) when calling the %s operation: %s\\n\' "$1" "$op" "$2" >&2; exit 254; }',
  'arg_after() { local j; for ((j = 0; j < ${#rest[@]}; j++)); do if [[ "${rest[$j]}" == "$1" ]]; then printf \'%s\' "${rest[$((j + 1))]}"; return; fi; done; }',
  'marker() { [[ -f "$FAKE_AWS_DIR/$1" ]]; }',
  'answer() { if marker "$1"; then cat "$FAKE_AWS_DIR/$1"; else printf \'%s\\n\' "$2"; fi; }',
  'if marker "fail.$service.$op"; then fail "$(cat "$FAKE_AWS_DIR/fail.$service.$op")" injected; fi',
  'if marker "notfound.$service.$op"; then fail "$(cat "$FAKE_AWS_DIR/notfound.$service.$op")" missing; fi',
  'case "$service $op" in',
  '  "sts get-caller-identity") printf \'%s\\tarn:aws:sts::%s:assumed-role/Admin/me\\n\' "${FAKE_AWS_ACCOUNT:-123456789012}" "${FAKE_AWS_ACCOUNT:-123456789012}" ;;',
  '  "ec2 describe-images") printf \'%s\\t%s\\tubuntu/images/hvm-ssd-gp3/ubuntu-resolute-26.04-amd64-server-20260604\\n\' "${FAKE_AWS_AMI_OWNER:-099720109477}" "${FAKE_AWS_AMI_ARCH:-x86_64}" ;;',
  '  "iam get-instance-profile") printf \'arn:aws:iam::123456789012:instance-profile/%s\\n\' "$(arg_after --instance-profile-name)" ;;',
  '  "iot describe-thing-group") if marker exists.thing-group; then printf \'existing\\n\'; else fail ResourceNotFoundException "no group"; fi ;;',
  '  "iot describe-thing") fail ResourceNotFoundException "no thing" ;;',
  '  "iot describe-role-alias") fail ResourceNotFoundException "no alias" ;;',
  '  "iot get-policy") fail ResourceNotFoundException "no policy" ;;',
  '  "iam get-role") fail NoSuchEntity "no role" ;;',
  '  "iam get-policy") fail NoSuchEntity "no policy" ;;',
  '  "iot create-thing-group") printf \'arn:aws:iot:us-east-1:123456789012:thinggroup/%s\\n\' "$(arg_after --thing-group-name)" ;;',
  '  "iot create-policy") printf \'%s\' "$(arg_after --policy-document)" >"$FAKE_AWS_DIR/iot-policy.$(arg_after --policy-name).json" ;;',
  '  "iam create-policy") printf \'%s\' "$(arg_after --policy-document)" >"$FAKE_AWS_DIR/iam-policy.$(arg_after --policy-name).json" ;;',
  '  "ec2 run-instances") printf \'i-0123456789abcdef0\\n\' ;;',
  '  "ec2 describe-instances") answer instance-state running ;;',
  '  "ssm describe-instance-information") printf \'Online\\n\' ;;',
  '  "ssm send-command") src="$(arg_after --parameters)"; cp "${src#file://}" "$FAKE_AWS_DIR/ssm-parameters.json"; printf \'cmd-1\\n\' ;;',
  '  "ssm get-command-invocation") answer ssm-status Success ;;',
  '  "iot list-thing-principals") answer principals None ;;',
  '  "iot list-attached-policies") answer attached-policies None ;;',
  '  "iot list-targets-for-policy") printf \'None\\n\' ;;',
  '  "iam list-attached-role-policies") answer attached-role-policies None ;;',
  '  "iam list-role-policies") answer inline-policies None ;;',
  '  "iam list-policy-versions") printf \'None\\n\' ;;',
  '  "greengrassv2 get-core-device") printf \'HEALTHY\\n\' ;;',
  '  *) ;;',
  'esac',
  'exit 0',
].join('\n');

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  log: string[];
}

interface Sandbox {
  dir: string;
  fakeDir: string;
  stateFile: string;
  run: (args: string[], env?: Record<string, string>) => RunResult;
  writeState: (overrides?: Record<string, string>) => void;
  marker: (name: string, content?: string) => void;
}

const createSandbox = (): Sandbox => {
  const dir = mkdtempSync(join(tmpdir(), 'greengrass-tutorial-setup-'));
  const bin = join(dir, 'bin');
  const fakeDir = join(dir, 'fake');
  mkdirSync(bin);
  mkdirSync(fakeDir);
  writeFileSync(join(bin, 'aws'), FAKE_AWS);
  chmodSync(join(bin, 'aws'), 0o755);
  const log = join(dir, 'aws.log');
  const stateFile = join(dir, '.greengrass-tutorial.env');

  return {
    dir,
    fakeDir,
    stateFile,
    run: (args, env = {}) => {
      const result = spawnSync('bash', [SCRIPT, ...args], {
        cwd: dir,
        encoding: 'utf-8',
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          FAKE_AWS_LOG: log,
          FAKE_AWS_DIR: fakeDir,
          GREENGRASS_TUTORIAL_POLL_SECONDS: '0',
          ...env,
        },
      });
      return {
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        log: existsSync(log)
          ? readFileSync(log, 'utf-8').trim().split('\n').filter(Boolean)
          : [],
      };
    },
    writeState: (overrides = {}) => {
      const values: Record<string, string> = {
        TUTORIAL_ACCOUNT_ID: ACCOUNT,
        TUTORIAL_PARTITION: 'aws',
        TUTORIAL_REGION: REGION,
        TUTORIAL_PREFIX: PREFIX,
        TUTORIAL_SETUP_STATE: 'complete',
        TUTORIAL_THING_NAME: `${PREFIX}-core`,
        TUTORIAL_THING_GROUP_NAME: `${PREFIX}-group`,
        TUTORIAL_THING_GROUP_ARN: `arn:aws:iot:${REGION}:${ACCOUNT}:thinggroup/${PREFIX}-group`,
        TUTORIAL_TOKEN_EXCHANGE_ROLE_NAME: `${PREFIX}-token-exchange`,
        TUTORIAL_TOKEN_EXCHANGE_ROLE_ARN: `arn:aws:iam::${ACCOUNT}:role/${PREFIX}-token-exchange`,
        TUTORIAL_ROLE_ALIAS: `${PREFIX}-alias`,
        TUTORIAL_DEVICE_POLICY_NAME: `${PREFIX}-device-policy`,
        TUTORIAL_INSTANCE_ID: '',
        TUTORIAL_CERTIFICATE_ARN: '',
        TUTORIAL_MQTT_TOPIC: 'tutorial/greengrass/heartbeat',
        TUTORIAL_CREATED_GROUP: '0',
        TUTORIAL_CREATED_THING: '0',
        TUTORIAL_CREATED_ROLE: '0',
        TUTORIAL_CREATED_ACCESS_POLICY: '0',
        TUTORIAL_CREATED_ALIAS: '0',
        TUTORIAL_CREATED_DEVICE_POLICY: '0',
        TUTORIAL_CREATED_INSTANCE: '0',
        ...overrides,
      };
      writeFileSync(
        stateFile,
        Object.entries(values)
          .map(([key, value]) => `export ${key}=${value}`)
          .join('\n')
          .concat('\n'),
      );
    },
    marker: (name, content = '') => writeFileSync(join(fakeDir, name), content),
  };
};

const common = [
  '--profile',
  'tutorial',
  '--region',
  REGION,
  '--prefix',
  PREFIX,
];
const setupArgs = [
  'setup',
  ...common,
  '--ami-id',
  'ami-0123456789abcdef0',
  '--instance-profile',
  'gg-test-ssm',
];
const cleanupArgs = ['cleanup', ...common];

const indexOf = (log: string[], prefix: string) =>
  log.findIndex((line) => line.startsWith(prefix));
const has = (log: string[], prefix: string) => indexOf(log, prefix) >= 0;

const readState = (sandbox: Sandbox): Record<string, string> =>
  Object.fromEntries(
    readFileSync(sandbox.stateFile, 'utf-8')
      .split('\n')
      .filter((line) => line.startsWith('export '))
      .map((line) => {
        const [key, ...value] = line.slice('export '.length).split('=');
        return [key, value.join('=')];
      }),
  );

describe.skipIf(process.platform === 'win32')(
  'greengrass tutorial setup script',
  () => {
    let sandbox: Sandbox;

    beforeEach(() => {
      sandbox = createSandbox();
    });

    afterEach(() => {
      rmSync(sandbox.dir, { recursive: true, force: true });
    });

    it('parses with bash', () => {
      const result = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf-8' });
      expect(result.status).toBe(0);
    });

    it('refuses cleanup when the state file belongs to another account', () => {
      sandbox.writeState({
        TUTORIAL_ACCOUNT_ID: '111111111111',
        TUTORIAL_CREATED_GROUP: '1',
        TUTORIAL_CREATED_THING: '1',
      });

      const result = sandbox.run(cleanupArgs);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('identity mismatch');
      expect(result.log).toEqual([
        expect.stringMatching(/^sts get-caller-identity/),
      ]);
      expect(existsSync(sandbox.stateFile)).toBe(true);
    });

    it('refuses cleanup without a state file', () => {
      const result = sandbox.run(cleanupArgs);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('refusing to guess');
      expect(result.log.filter((line) => !line.startsWith('sts '))).toEqual([]);
    });

    it('cleans up a partial setup and tolerates objects that are already gone', () => {
      sandbox.writeState({
        TUTORIAL_SETUP_STATE: 'resources',
        TUTORIAL_CREATED_GROUP: '1',
        TUTORIAL_CREATED_THING: '1',
      });
      sandbox.marker(
        'notfound.iot.delete-thing-group',
        'ResourceNotFoundException',
      );

      const result = sandbox.run(cleanupArgs);

      expect(result.status, result.stderr).toBe(0);
      expect(has(result.log, 'iot list-thing-principals')).toBe(true);
      expect(has(result.log, 'iot remove-thing-from-thing-group')).toBe(true);
      expect(has(result.log, 'iot delete-thing ')).toBe(true);
      expect(has(result.log, 'iot delete-thing-group')).toBe(true);
      expect(result.stderr).toContain(`Thing group ${PREFIX}-group: absent`);
      // Nothing the state file does not record.
      expect(has(result.log, 'ec2 terminate-instances')).toBe(false);
      expect(has(result.log, 'iam ')).toBe(false);
      expect(has(result.log, 'iot delete-role-alias')).toBe(false);
      expect(has(result.log, 'iot delete-policy')).toBe(false);
      expect(existsSync(sandbox.stateFile)).toBe(false);
    });

    it('stops cleanup on an unexpected error and keeps the state file', () => {
      sandbox.writeState({
        TUTORIAL_SETUP_STATE: 'resources',
        TUTORIAL_CREATED_GROUP: '1',
        TUTORIAL_CREATED_THING: '1',
      });
      sandbox.marker('fail.iot.delete-thing', 'AccessDeniedException');

      const result = sandbox.run(cleanupArgs);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('AccessDeniedException');
      expect(result.stderr).toContain('cleanup stopped at');
      expect(has(result.log, 'iot delete-thing-group')).toBe(false);
      expect(existsSync(sandbox.stateFile)).toBe(true);
    });

    it('removes the installer-created certificate, its policies and the role grants in order', () => {
      sandbox.writeState({
        TUTORIAL_INSTANCE_ID: 'i-0123456789abcdef0',
        TUTORIAL_CREATED_GROUP: '1',
        TUTORIAL_CREATED_THING: '1',
        TUTORIAL_CREATED_ROLE: '1',
        TUTORIAL_CREATED_ACCESS_POLICY: '1',
        TUTORIAL_CREATED_ALIAS: '1',
        TUTORIAL_CREATED_DEVICE_POLICY: '1',
        TUTORIAL_CREATED_INSTANCE: '1',
      });
      sandbox.marker('principals', `${CERT_ARN}\n`);
      sandbox.marker(
        'attached-policies',
        `${PREFIX}-device-policy\tGreengrassTESCertificatePolicy${PREFIX}-alias\n`,
      );
      sandbox.marker(
        'attached-role-policies',
        `arn:aws:iam::${ACCOUNT}:policy/${PREFIX}-token-exchangeAccess\n`,
      );
      sandbox.marker('inline-policies', 'TokenExchangeRolePolicyABC\n');

      const result = sandbox.run(cleanupArgs);

      expect(result.status, result.stderr).toBe(0);
      const { log } = result;
      const terminate = indexOf(
        log,
        'ec2 terminate-instances --instance-ids i-0123456789abcdef0',
      );
      const detachDevicePolicy = indexOf(
        log,
        `iot detach-policy --policy-name ${PREFIX}-device-policy --target ${CERT_ARN}`,
      );
      const detachTesPolicy = indexOf(
        log,
        `iot detach-policy --policy-name GreengrassTESCertificatePolicy${PREFIX}-alias --target ${CERT_ARN}`,
      );
      const detachPrincipal = indexOf(log, 'iot detach-thing-principal');
      const deactivate = indexOf(
        log,
        'iot update-certificate --certificate-id abc123 --new-status INACTIVE',
      );
      const deleteCertificate = indexOf(
        log,
        'iot delete-certificate --certificate-id abc123 --force-delete',
      );
      const deleteCoreDevice = indexOf(
        log,
        `greengrassv2 delete-core-device --core-device-thing-name ${PREFIX}-core`,
      );
      const deleteThing = indexOf(log, 'iot delete-thing ');
      const deleteGroup = indexOf(log, 'iot delete-thing-group');
      const deleteDevicePolicy = indexOf(
        log,
        `iot delete-policy --policy-name ${PREFIX}-device-policy`,
      );
      const deleteTesPolicy = indexOf(
        log,
        `iot delete-policy --policy-name GreengrassTESCertificatePolicy${PREFIX}-alias`,
      );
      const deleteAlias = indexOf(
        log,
        `iot delete-role-alias --role-alias ${PREFIX}-alias`,
      );
      const detachRolePolicy = indexOf(log, 'iam detach-role-policy');
      const deleteInline = indexOf(
        log,
        `iam delete-role-policy --role-name ${PREFIX}-token-exchange --policy-name TokenExchangeRolePolicyABC`,
      );
      const deleteRole = indexOf(
        log,
        `iam delete-role --role-name ${PREFIX}-token-exchange`,
      );
      const deleteAccessPolicy = indexOf(
        log,
        `iam delete-policy --policy-arn arn:aws:iam::${ACCOUNT}:policy/${PREFIX}-token-exchangeAccess`,
      );

      for (const index of [
        terminate,
        detachDevicePolicy,
        detachTesPolicy,
        detachPrincipal,
        deactivate,
        deleteCertificate,
        deleteCoreDevice,
        deleteThing,
        deleteGroup,
        deleteDevicePolicy,
        deleteTesPolicy,
        deleteAlias,
        detachRolePolicy,
        deleteInline,
        deleteRole,
        deleteAccessPolicy,
      ]) {
        expect(index, log.join('\n')).toBeGreaterThanOrEqual(0);
      }
      expect(terminate).toBeLessThan(detachDevicePolicy);
      expect(detachTesPolicy).toBeLessThan(detachPrincipal);
      expect(detachPrincipal).toBeLessThan(deactivate);
      expect(deactivate).toBeLessThan(deleteCertificate);
      expect(deleteCertificate).toBeLessThan(deleteCoreDevice);
      expect(deleteCoreDevice).toBeLessThan(deleteThing);
      expect(deleteThing).toBeLessThan(deleteGroup);
      expect(deleteDevicePolicy).toBeLessThan(deleteAlias);
      expect(deleteTesPolicy).toBeLessThan(deleteAlias);
      expect(detachRolePolicy).toBeLessThan(deleteRole);
      expect(deleteInline).toBeLessThan(deleteRole);
      expect(deleteRole).toBeLessThan(deleteAccessPolicy);
      expect(existsSync(sandbox.stateFile)).toBe(false);
    });

    it('refuses to resume an incomplete setup even when the instance is running', () => {
      sandbox.writeState({
        TUTORIAL_SETUP_STATE: 'installing',
        TUTORIAL_INSTANCE_ID: 'i-0123456789abcdef0',
        TUTORIAL_CREATED_GROUP: '1',
        TUTORIAL_CREATED_THING: '1',
        TUTORIAL_CREATED_INSTANCE: '1',
      });

      const result = sandbox.run(setupArgs);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("stopped at state 'installing'");
      expect(result.stderr).toContain('Run cleanup');
      expect(has(result.log, 'ec2 run-instances')).toBe(false);
      expect(has(result.log, 'ssm send-command')).toBe(false);
    });

    it('reports a completed setup without changing anything', () => {
      sandbox.writeState({
        TUTORIAL_SETUP_STATE: 'complete',
        TUTORIAL_INSTANCE_ID: 'i-0123456789abcdef0',
        TUTORIAL_CREATED_INSTANCE: '1',
      });

      const result = sandbox.run(setupArgs);

      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toContain('already completed');
      expect(
        result.log.filter(
          (line) => !/^(sts|ec2 describe-instances)/.test(line),
        ),
      ).toEqual([]);
    });

    it('rejects an AMI that is not the Canonical Ubuntu 26.04 x86_64 image', () => {
      const wrongOwner = sandbox.run(setupArgs, {
        FAKE_AWS_AMI_OWNER: '137112412989',
      });
      expect(wrongOwner.status).toBe(1);
      expect(wrongOwner.stderr).toContain('not Canonical');

      const wrongArchitecture = sandbox.run(setupArgs, {
        FAKE_AWS_AMI_ARCH: 'arm64',
      });
      expect(wrongArchitecture.status).toBe(1);
      expect(wrongArchitecture.stderr).toContain('linux-amd64');

      expect(has(wrongArchitecture.log, 'iot create-thing-group')).toBe(false);
      expect(existsSync(sandbox.stateFile)).toBe(false);
    });

    it('refuses to adopt an existing thing group before creating anything', () => {
      sandbox.marker('exists.thing-group');

      const result = sandbox.run(setupArgs);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `refusing to adopt the existing thing group ${PREFIX}-group`,
      );
      expect(
        result.log.some((line) =>
          /\b(create|run-instances|send-command)/.test(line),
        ),
      ).toBe(false);
      expect(existsSync(sandbox.stateFile)).toBe(false);
    });

    it('creates resources in order, installs through a shebang script without secrets, and records a complete state', () => {
      sandbox.marker('principals', `${CERT_ARN}\n`);

      const result = sandbox.run(setupArgs);

      expect(result.status, result.stderr).toBe(0);
      const { log } = result;
      const order = [
        'iot create-thing-group',
        'iot create-thing ',
        'iot add-thing-to-thing-group',
        'iam create-role',
        `iam create-policy --policy-name ${PREFIX}-token-exchangeAccess`,
        'iam attach-role-policy',
        'iot create-role-alias',
        `iot create-policy --policy-name ${PREFIX}-device-policy`,
        'ec2 run-instances',
        'ec2 wait instance-running',
        'ssm describe-instance-information',
        'ssm send-command',
        'ssm get-command-invocation',
        'iot list-thing-principals',
        'greengrassv2 get-core-device',
      ].map((prefix) => indexOf(log, prefix));
      for (const index of order) {
        expect(index, log.join('\n')).toBeGreaterThanOrEqual(0);
      }
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(
        log.find((line) => line.startsWith('ec2 run-instances')),
      ).toContain('HttpTokens=required');

      // The remote install command.
      const parameters = JSON.parse(
        readFileSync(join(sandbox.fakeDir, 'ssm-parameters.json'), 'utf-8'),
      );
      expect(parameters.executionTimeout).toEqual(['1800']);
      expect(parameters.commands[0]).toBe('#!/bin/bash');
      const remote = parameters.commands.join('\n');
      expect(remote).toContain('set -euo pipefail');
      expect(remote).toContain('security-credentials/');
      expect(remote).toContain('openjdk-21-jre-headless unzip python3.14 sudo');
      expect(remote).toContain(
        'update-alternatives --set sudo /usr/bin/sudo.ws',
      );
      expect(remote).toContain(
        'https://d2s8p88vqu9w66.cloudfront.net/releases/greengrass-2.18.3.zip',
      );
      expect(remote).toContain(
        '/tmp/greengrass-installer/lib/Greengrass.jar --version',
      );
      expect(remote).toContain(
        `--aws-region ${REGION} --thing-name ${PREFIX}-core --thing-group-name ${PREFIX}-group --thing-policy-name ${PREFIX}-device-policy --tes-role-name ${PREFIX}-token-exchange --tes-role-alias-name ${PREFIX}-alias --component-default-user ggc_user:ggc_group --provision true --setup-system-service true`,
      );
      expect(remote).not.toContain('--deploy-dev-tools');
      // `sudo-ws` is not an Ubuntu package; the `sudo` package owns sudo.ws.
      expect(remote).not.toContain('sudo-ws');
      expect(remote).not.toMatch(
        /AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|BEGIN (RSA )?PRIVATE KEY/,
      );

      // The device policy: the official minimal core device policy plus the
      // tutorial topic.
      const devicePolicy = JSON.parse(
        readFileSync(
          join(sandbox.fakeDir, `iot-policy.${PREFIX}-device-policy.json`),
          'utf-8',
        ),
      );
      const document = JSON.stringify(devicePolicy);
      for (const fragment of [
        `client/${PREFIX}-core*`,
        `$aws/things/${PREFIX}-core/greengrass/health/json`,
        `$aws/things/${PREFIX}-core/greengrassv2/health/json`,
        `$aws/things/${PREFIX}-core/jobs/*`,
        `topicfilter/$aws/things/${PREFIX}-core/shadow/*`,
        'topic/tutorial/greengrass/heartbeat',
        `rolealias/${PREFIX}-alias`,
        'greengrass:GetComponentVersionArtifact',
        'greengrass:ResolveComponentCandidates',
        'greengrass:GetDeploymentConfiguration',
        'greengrass:ListThingGroupsForCoreDevice',
      ]) {
        expect(document).toContain(fragment);
      }
      expect(document).not.toContain('greengrass:*');

      const accessPolicy = JSON.parse(
        readFileSync(
          join(
            sandbox.fakeDir,
            `iam-policy.${PREFIX}-token-exchangeAccess.json`,
          ),
          'utf-8',
        ),
      );
      expect(accessPolicy.Statement[0].Action).toEqual([
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
        'logs:DescribeLogStreams',
        's3:GetBucketLocation',
      ]);

      // The state file.
      expect(statSync(sandbox.stateFile).mode & 0o777).toBe(0o600);
      const state = readState(sandbox);
      expect(state.TUTORIAL_SETUP_STATE).toBe('complete');
      expect(state.TUTORIAL_ACCOUNT_ID).toBe(ACCOUNT);
      expect(state.TUTORIAL_REGION).toBe(REGION);
      expect(state.TUTORIAL_INSTANCE_ID).toBe('i-0123456789abcdef0');
      expect(state.TUTORIAL_CERTIFICATE_ARN).toBe(CERT_ARN);
      expect(state.TUTORIAL_THING_GROUP_ARN).toBe(
        `arn:aws:iot:${REGION}:${ACCOUNT}:thinggroup/${PREFIX}-group`,
      );
      expect(state.TUTORIAL_TOKEN_EXCHANGE_ROLE_ARN).toBe(
        `arn:aws:iam::${ACCOUNT}:role/${PREFIX}-token-exchange`,
      );
      for (const key of [
        'TUTORIAL_CREATED_GROUP',
        'TUTORIAL_CREATED_THING',
        'TUTORIAL_CREATED_ROLE',
        'TUTORIAL_CREATED_ACCESS_POLICY',
        'TUTORIAL_CREATED_ALIAS',
        'TUTORIAL_CREATED_DEVICE_POLICY',
        'TUTORIAL_CREATED_INSTANCE',
      ]) {
        expect(state[key], key).toBe('1');
      }
    });

    it('leaves an installing state when the install command fails, so a rerun refuses', () => {
      sandbox.marker('ssm-status', 'Failed\n');

      const result = sandbox.run(setupArgs);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('ended with status Failed');
      expect(readState(sandbox).TUTORIAL_SETUP_STATE).toBe('installing');
      expect(readState(sandbox).TUTORIAL_CREATED_INSTANCE).toBe('1');

      const rerun = sandbox.run(setupArgs);
      expect(rerun.status).toBe(1);
      expect(rerun.stderr).toContain("stopped at state 'installing'");
    });
  },
);
