/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { pyFastApiProjectGenerator } from '../../../py/fast-api/generator.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const REST_API_CONSTRUCT =
  'packages/common/constructs/src/core/api/rest-api.ts';
const HTTP_API_CONSTRUCT =
  'packages/common/constructs/src/core/api/http-api.ts';
const REST_API_MODULE =
  'packages/common/terraform/src/app/apis/rest-api/rest-api.tf';
const HTTP_API_MODULE =
  'packages/common/terraform/src/app/apis/http-api/http-api.tf';

/** Rewrite each file in the tree, failing if a rewrite changes nothing. */
const rewrite = (
  tree: Tree,
  file: string,
  replacements: [RegExp | string, string][],
) => {
  let contents = tree.read(file, 'utf-8')!;
  for (const [from, to] of replacements) {
    const next = contents.replace(from, to);
    expect(next, `${file}: ${from}`).not.toEqual(contents);
    contents = next;
  }
  tree.write(file, contents);
};

/**
 * Generate a REST and an HTTP API with today's generators, then strip what
 * this migration adds, leaving the shape the generators produced before it.
 */
const generatePreviousShape = async (
  tree: Tree,
  iac: 'cdk' | 'terraform',
): Promise<Record<string, string>> => {
  for (const [name, infra] of [
    ['rest-api', 'rest-lambda'],
    ['http-api', 'http-lambda'],
  ] as const) {
    await pyFastApiProjectGenerator(tree, {
      name,
      directory: 'apps',
      infra,
      auth: 'iam',
      iac,
    } as Parameters<typeof pyFastApiProjectGenerator>[1]);
  }

  const files =
    iac === 'cdk'
      ? [REST_API_CONSTRUCT, HTTP_API_CONSTRUCT]
      : [REST_API_MODULE, HTTP_API_MODULE];
  const generated = Object.fromEntries(
    files.map((f) => [f, tree.read(f, 'utf-8')!]),
  );

  if (iac === 'cdk') {
    const domainOutputs = (condition: string): [RegExp, string] => [
      new RegExp(
        `\\n\\n\\s*// Target for the custom domain's DNS record\\n\\s*if \\(${condition}\\) \\{[\\s\\S]*?\\n    \\}\\n`,
      ),
      '\n',
    ];
    rewrite(tree, REST_API_CONSTRUCT, [
      [/\n\s*domainName,/, ''],
      [/\n\s*domainName,/, ''],
      [
        /\[apiName\]: domainName[\s\S]*?: this\.api\.url!/,
        '[apiName]: this.api.url!',
      ],
      domainOutputs('domainName'),
      ['import { CfnOutput, ', 'import { '],
    ]);
    rewrite(tree, HTTP_API_CONSTRUCT, [
      [/\n\s*defaultDomainMapping,/, ''],
      [/\n\s*domainMapping: defaultDomainMapping,/, ''],
      [
        /\[apiName\]: defaultDomainMapping[\s\S]*?: this\.defaultStage\.url!/,
        '[apiName]: this.defaultStage.url!',
      ],
      domainOutputs('defaultDomainMapping'),
      [
        /\n\s*\/\*\*\n\s*\* Custom domain mapped to the API's default stage[\s\S]*?\};/,
        '',
      ],
      [
        "extends Omit<_HttpApiProps, 'defaultDomainMapping'>",
        'extends _HttpApiProps',
      ],
      [/\n\s*DomainMappingOptions,\n\s*IDomainName,/, ''],
    ]);
  } else {
    const common: [RegExp, string][] = [
      [
        /\n# Custom Domain Configuration\n[\s\S]*?variable "acm_certificate_arn" \{[\s\S]*?\n\}\n/,
        '',
      ],
      [
        /\n# Custom domain for the API[\s\S]*?\nlocals \{\n {2}api_url = [^\n]*\n\}\n/,
        '',
      ],
      [
        /\noutput "api_url" \{[\s\S]*?output "custom_domain_hosted_zone_id" \{[\s\S]*?\n\}\n/,
        '',
      ],
    ];
    rewrite(tree, REST_API_MODULE, [
      ...common,
      [
        '"RestApi" = local.api_url',
        '"RestApi" = "${aws_api_gateway_stage.api_stage.invoke_url}/"',
      ],
    ]);
    rewrite(tree, HTTP_API_MODULE, [
      ...common,
      [
        '"HttpApi" = local.api_url',
        '"HttpApi" = module.http_api.stage_invoke_url',
      ],
    ]);
  }

  for (const f of files) {
    expect(tree.read(f, 'utf-8')).not.toMatch(
      /custom_domain|domainName\.|defaultDomainMapping|DomainNameAlias/,
    );
  }
  return generated;
};

describe('api-custom-domain-runtime-config migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should do nothing when no APIs are vended', async () => {
    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);
  });

  it.each(['cdk', 'terraform'] as const)(
    'should bring the %s REST and HTTP APIs to the generated shape',
    async (iac) => {
      const generated = await generatePreviousShape(tree, iac);

      const result = await migration(tree);

      expect(result.nextSteps).toEqual([]);
      for (const [file, contents] of Object.entries(generated)) {
        expect(tree.read(file, 'utf-8'), file).toEqual(contents);
      }
    },
  );

  it.each(['cdk', 'terraform'] as const)(
    'should be idempotent for %s',
    async (iac) => {
      const generated = await generatePreviousShape(tree, iac);

      await migration(tree);
      const result = await migration(tree);

      expect(result.nextSteps).toEqual([]);
      for (const [file, contents] of Object.entries(generated)) {
        expect(tree.read(file, 'utf-8'), file).toEqual(contents);
      }
    },
  );

  it('should skip and report CDK constructs that have diverged', async () => {
    await generatePreviousShape(tree, 'cdk');
    rewrite(tree, REST_API_CONSTRUCT, [
      ['[apiName]: this.api.url!', '[apiName]: `${this.api.url}v1/`'],
    ]);
    rewrite(tree, HTTP_API_CONSTRUCT, [
      ['[apiName]: this.defaultStage.url!', '[apiName]: this.url!'],
    ]);
    const before = {
      rest: tree.read(REST_API_CONSTRUCT, 'utf-8'),
      http: tree.read(HTTP_API_CONSTRUCT, 'utf-8'),
    };

    const result = await migration(tree);

    expect(tree.read(REST_API_CONSTRUCT, 'utf-8')).toEqual(before.rest);
    expect(tree.read(HTTP_API_CONSTRUCT, 'utf-8')).toEqual(before.http);
    expect(result.nextSteps).toHaveLength(2);
    expect(result.nextSteps[0]).toContain(REST_API_CONSTRUCT);
    expect(result.nextSteps[1]).toContain(HTTP_API_CONSTRUCT);
  });

  it('should migrate a REST construct that already has its own CfnOutput', async () => {
    await generatePreviousShape(tree, 'cdk');
    rewrite(tree, REST_API_CONSTRUCT, [
      ['import { IAspect, ', 'import { CfnOutput, IAspect, '],
      [
        '    // Register the API URL',
        "    new CfnOutput(this, 'ApiId', { value: this.api.restApiId });\n\n    // Register the API URL",
      ],
    ]);

    const result = await migration(tree);

    const contents = tree.read(REST_API_CONSTRUCT, 'utf-8')!;
    expect(result.nextSteps).toEqual([]);
    expect(contents).toContain('[apiName]: domainName');
    expect(contents).toContain('`${apiName}DomainNameAlias`');
    expect(contents.match(/CfnOutput,/g)).toHaveLength(1);
  });

  it.each([
    ['REST', REST_API_CONSTRUCT],
    ['HTTP', HTTP_API_CONSTRUCT],
  ])(
    'should leave a %s construct with an existing DNS alias output untouched',
    async (_, file) => {
      await generatePreviousShape(tree, 'cdk');
      rewrite(tree, file, [
        [
          '    // Register the API URL',
          "    new CfnOutput(this, `${apiName}DomainNameAlias`, { value: 'x' });\n\n    // Register the API URL",
        ],
      ]);
      const before = tree.read(file, 'utf-8');

      const result = await migration(tree);

      expect(tree.read(file, 'utf-8')).toEqual(before);
      expect(result.nextSteps).toHaveLength(1);
      expect(result.nextSteps[0]).toContain(file);
    },
  );

  it('should keep additional base interfaces of HttpApiProps', async () => {
    const generated = await generatePreviousShape(tree, 'cdk');
    const withExtraBase = (contents: string) =>
      contents.replace(
        /extends (Omit<_HttpApiProps, 'defaultDomainMapping'>|_HttpApiProps) \{/,
        'extends $1, ExtraProps {',
      );
    tree.write(
      HTTP_API_CONSTRUCT,
      withExtraBase(tree.read(HTTP_API_CONSTRUCT, 'utf-8')!),
    );

    const result = await migration(tree);

    // Compared ignoring whitespace, since formatting wraps the longer clause.
    const normalise = (contents: string) => contents.replace(/\s+/g, ' ');
    expect(result.nextSteps).toEqual([]);
    expect(normalise(tree.read(HTTP_API_CONSTRUCT, 'utf-8')!)).toEqual(
      normalise(withExtraBase(generated[HTTP_API_CONSTRUCT])),
    );
  });

  it('should add the domain mapping to a stage without shorthand throttle', async () => {
    const generated = await generatePreviousShape(tree, 'cdk');
    const explicitThrottle = (contents: string) =>
      contents.replace(
        /(new HttpStage\(this, 'DefaultStage', \{[\s\S]*?)\bthrottle,/,
        '$1throttle: throttle,',
      );
    tree.write(
      HTTP_API_CONSTRUCT,
      explicitThrottle(tree.read(HTTP_API_CONSTRUCT, 'utf-8')!),
    );

    const result = await migration(tree);

    expect(result.nextSteps).toEqual([]);
    expect(tree.read(HTTP_API_CONSTRUCT, 'utf-8')).toEqual(
      explicitThrottle(generated[HTTP_API_CONSTRUCT]),
    );
  });

  it('should leave the HTTP construct untouched when the stage has diverged', async () => {
    await generatePreviousShape(tree, 'cdk');
    rewrite(tree, HTTP_API_CONSTRUCT, [
      ['httpApi: this.api,', 'httpApi: this.api as HttpApi,'],
    ]);
    const before = tree.read(HTTP_API_CONSTRUCT, 'utf-8');

    const result = await migration(tree);

    expect(tree.read(HTTP_API_CONSTRUCT, 'utf-8')).toEqual(before);
    expect(result.nextSteps).toHaveLength(1);
    expect(result.nextSteps[0]).toContain(HTTP_API_CONSTRUCT);
  });

  it('should leave a customised REST runtime config URL untouched', async () => {
    await generatePreviousShape(tree, 'terraform');
    rewrite(tree, REST_API_MODULE, [
      [
        '"${aws_api_gateway_stage.api_stage.invoke_url}/"',
        '"${aws_api_gateway_stage.api_stage.invoke_url}/v1/"',
      ],
    ]);
    const before = tree.read(REST_API_MODULE, 'utf-8');

    const result = await migration(tree);

    expect(tree.read(REST_API_MODULE, 'utf-8')).toEqual(before);
    expect(result.nextSteps).toHaveLength(1);
    expect(result.nextSteps[0]).toContain(REST_API_MODULE);
  });

  it.each([
    [
      'an existing local.api_url',
      'locals {\n  api_url = "https://example.com/"\n}\n',
    ],
    [
      'only a custom_domain_name variable',
      'variable "custom_domain_name" {\n  type    = string\n  default = null\n}\n',
    ],
    ['an existing api_url output', 'output "api_url" {\n  value = "x"\n}\n'],
  ])(
    'should leave a Terraform module declaring %s untouched',
    async (_, declaration) => {
      await generatePreviousShape(tree, 'terraform');
      tree.write(
        HTTP_API_MODULE,
        `${tree.read(HTTP_API_MODULE, 'utf-8')}\n${declaration}`,
      );
      const before = tree.read(HTTP_API_MODULE, 'utf-8');

      const result = await migration(tree);

      expect(tree.read(HTTP_API_MODULE, 'utf-8')).toEqual(before);
      expect(result.nextSteps).toHaveLength(1);
      expect(result.nextSteps[0]).toContain(HTTP_API_MODULE);
    },
  );

  it.each([
    ['locals.tf', 'locals {\n  api_url = "https://example.com/"\n}\n'],
    [
      'outputs.tf',
      'output "custom_domain_hosted_zone_id" {\n  value = "x"\n}\n',
    ],
  ])(
    'should leave a Terraform module untouched when a sibling %s declares a colliding name',
    async (sibling, declaration) => {
      await generatePreviousShape(tree, 'terraform');
      const siblingFile = HTTP_API_MODULE.replace(/[^/]+$/, sibling);
      tree.write(siblingFile, declaration);
      const before = tree.read(HTTP_API_MODULE, 'utf-8');

      const result = await migration(tree);

      expect(tree.read(HTTP_API_MODULE, 'utf-8')).toEqual(before);
      expect(tree.read(siblingFile, 'utf-8')).toEqual(declaration);
      expect(result.nextSteps).toHaveLength(1);
      expect(result.nextSteps[0]).toContain(HTTP_API_MODULE);
    },
  );

  it('should skip and report a Terraform module that has diverged', async () => {
    await generatePreviousShape(tree, 'terraform');
    rewrite(tree, HTTP_API_MODULE, [
      [
        '"HttpApi" = module.http_api.stage_invoke_url',
        '"HttpApi" = "https://api.example.com/"',
      ],
    ]);
    const before = tree.read(HTTP_API_MODULE, 'utf-8');

    const result = await migration(tree);

    expect(tree.read(HTTP_API_MODULE, 'utf-8')).toEqual(before);
    expect(tree.read(REST_API_MODULE, 'utf-8')).toContain(
      'variable "custom_domain_name"',
    );
    expect(result.nextSteps).toHaveLength(1);
    expect(result.nextSteps[0]).toContain(HTTP_API_MODULE);
  });
});
