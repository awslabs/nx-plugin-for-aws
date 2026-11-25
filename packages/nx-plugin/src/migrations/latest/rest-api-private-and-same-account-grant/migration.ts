/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
} from '@nx/devkit';
import {
  addDestructuredImport,
  applyGritQL,
  insertViaGritQL,
  matchGritQL,
} from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../../../utils/shared-constructs-constants.js';
import {
  REST_API_SAME_ACCOUNT_GRANT,
  type VendedShape,
} from '../../../utils/vended-shapes.js';

/**
 * A vended REST API construct accepted only its integrations and enableWaf,
 * so it could not be made private, and its grantInvokeAccess named the grantee
 * in the API's resource policy as well as in the grantee's own policy. With a
 * callback URL naming the API, that made a dependency cycle. It now accepts an
 * endpoint configuration and resource policy, and names a grantee in the
 * resource policy only when it is in another account.
 *
 * Guardrails: GritQL checks for the shape this construct was generated with,
 * and makes the edits. A construct that has diverged is reported through
 * `nextSteps` and left alone, and a migrated one no longer matches, so the
 * migration is idempotent. Only REST API constructs are touched: the props edit
 * needs the REST construct's enableWaf, and the grant edit its resource policy.
 */
/** A REST API construct's endpointConfiguration and policy props */
const REST_API_PRIVATE_PROPS: VendedShape = {
  current: "`ApiGatewayRestApiProps['endpointConfiguration']`",
  old: ['`enableWaf`'],
};

const PROPS_EDITS: { rewrite: string; text?: string }[] = [
  {
    rewrite:
      '`Aspects.of(this).add(new AddCorsPreflightAspect($origins));` => `Aspects.of(this).add(new AddCorsPreflightAspect($origins));\n__GRIT_INSERT_PLACEHOLDER__`',
    text: `// A resource policy takes effect only in a new deployment, so the deployment's ID
// covers it, as it stands at synth
this.api.latestDeployment?.addToLogicalId({
  policy: (this.api.node.defaultChild as CfnRestApi).policy,
});`,
  },
  {
    rewrite:
      '`enableWaf?: boolean` => `enableWaf?: boolean;\n__GRIT_INSERT_PLACEHOLDER__`',
    text: `/**
 * The API's endpoint type, for example PRIVATE with the VPC endpoints that may reach it.
 *
 * @default a regional endpoint
 */
endpointConfiguration?: ApiGatewayRestApiProps['endpointConfiguration'];
/**
 * A resource policy that replaces the default one, for example to admit only calls
 * through a VPC endpoint.
 */
policy?: ApiGatewayRestApiProps['policy']`,
  },
];

const GRANT_EDITS: { rewrite: string; text?: string }[] = [
  {
    // Both statements are rewritten in place, so the comments above them stay put
    rewrite:
      '`{ $statements }` where { $statements <: some `this.api.addToResourcePolicy($statement);` as $resource, $statements <: some `Grant.addToPrincipal($grant);` as $principal, $resource => `const grant = Grant.addToPrincipal($grant);`, $principal => `__GRIT_INSERT_PLACEHOLDER__` }',
    text: `// The principal's own policy is enough when it is known to be in this account: the
// same account, or the same unresolved account token as this stack's. A principal whose
// policy cannot be changed, or whose account may differ (another token, say from a
// parameter), also needs the resource policy.
const { principalAccount } = grantee.grantPrincipal;
const stackAccount = Stack.of(this).account;
const sameAccount =
  !!principalAccount &&
  (principalAccount === stackAccount ||
    Token.compareStrings(principalAccount, stackAccount) ===
      TokenComparison.SAME);
if (!grant.success || !sameAccount) {
  this.api.addToResourcePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      principals: [grantee.grantPrincipal],
      actions: ['execute-api:Invoke'],
      resources: ['execute-api:/*'],
    }),
  );
}`,
  },
];

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const apisDir = joinPathFragments(
    PACKAGES_DIR,
    SHARED_CONSTRUCTS_DIR,
    'src',
    'app',
    'apis',
  );
  const restApis = tree.exists(apisDir)
    ? tree
        .children(apisDir)
        .map((file) => joinPathFragments(apisDir, file))
        .filter((path) =>
          /from '\.\.\/\.\.\/core\/api\/rest-api(\.js)?'/.test(
            tree.read(path, 'utf-8') ?? '',
          ),
        )
    : [];
  const diverged = (path: string) =>
    `${path} has changed since it was generated, so it was left alone. To put it behind a Verified Access door it needs endpointConfiguration and policy props, and its grantInvokeAccess should name a same-account grantee only in the grantee's own policy.`;

  // A construct is migrated whole or not at all
  const isIam = (path: string) =>
    (tree.read(path, 'utf-8') ?? '').includes('grantInvokeAccess(');
  const groups = [
    {
      paths: restApis.filter(isIam),
      shape: {
        current: REST_API_SAME_ACCOUNT_GRANT.current,
        old: [
          ...REST_API_PRIVATE_PROPS.old,
          ...REST_API_SAME_ACCOUNT_GRANT.old,
        ],
      },
      edits: [...PROPS_EDITS, ...GRANT_EDITS],
      imports: ['Stack', 'Token', 'TokenComparison'],
    },
    {
      paths: restApis.filter((path) => !isIam(path)),
      shape: REST_API_PRIVATE_PROPS,
      edits: PROPS_EDITS,
      imports: [],
    },
  ];
  const nextSteps: string[] = [];
  for (const { paths, shape, edits, imports } of groups) {
    for (const path of paths) {
      if (await matchGritQL(tree, path, shape.current)) {
        continue;
      }
      const original = tree.read(path, 'utf-8') ?? '';
      let applied = true;
      for (const pattern of shape.old) {
        applied &&= await matchGritQL(tree, path, pattern);
      }
      for (const { rewrite, text } of edits) {
        applied &&=
          text === undefined
            ? await applyGritQL(tree, path, rewrite)
            : await insertViaGritQL(tree, path, rewrite, text);
      }
      if (!applied) {
        // Left as it was, rather than half migrated
        tree.write(path, original);
        nextSteps.push(diverged(path));
        continue;
      }
      // An import the edits could not place, as in a file whose imports were
      // rearranged, is added where the import helper puts it
      await addDestructuredImport(
        tree,
        path,
        ['CfnRestApi', 'RestApiProps as ApiGatewayRestApiProps'],
        'aws-cdk-lib/aws-apigateway',
      );
      if (imports.length > 0) {
        await addDestructuredImport(tree, path, imports, 'aws-cdk-lib');
      }
    }
  }
  await formatFilesInSubtree(tree);
  return { nextSteps };
}
