import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const VARIABLES = ['TMPDIR', 'TEMP', 'TMP', 'CDK_CONTEXT_JSON'];

const remove = (dir: string) => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Retried below.
  }
  return !existsSync(dir);
};

export default function setup() {
  const previous = VARIABLES.map((name) => [name, process.env[name]] as const);
  const dir = mkdtempSync(join(tmpdir(), 'cdk-test-'));
  process.env.TMPDIR = dir;
  process.env.TEMP = dir;
  process.env.TMP = dir;
  process.env.CDK_CONTEXT_JSON = JSON.stringify({
    ...JSON.parse(process.env.CDK_CONTEXT_JSON ?? '{}'),
    'aws:cdk:bundling-stacks': [],
  });

  return async () => {
    // Exiting workers may still be deleting their cdk.out here, so retry.
    const deadline = Date.now() + 2000;
    while (!remove(dir) && Date.now() < deadline) {
      await sleep(50);
    }
    if (existsSync(dir)) {
      console.warn(`Could not remove the CDK test directory ${dir}`);
    }
    for (const [name, value] of previous) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  };
}
