import { IConstruct } from 'constructs';
import { CfnResource } from 'aws-cdk-lib';

/**
 * Suppresses a set of rules for a construct tree.
 *
 * @param construct The root construct to suppress the rule for.
 * @param ids The ids of the rules to suppress.
 * @param comment The reason for suppressing the rule
 * @param predicate A predicate function that determines whether the rule should be suppressed for the given construct or any of its descendants.
 *
 * @example
 * The following example suppresses the CKV_AWS_XXX rule for the given construct.
 * suppressRules(construct, ['CKV_AWS_XXX'], 'Not required for this use case')
 *
 * @example
 * The following example suppresses the CKV_AWS_XXX rule for the construct or any of its descendants if it is an instance of Bucket:
 * suppressRules(construct, ['CKV_AWS_XXX'], 'Not required for this use case', (construct) => construct instanceof Bucket)
 */
export const suppressRules = (
  construct: IConstruct,
  ids: string[],
  comment: string,
  predicate?: (construct: IConstruct) => boolean,
) => {
  const resources = (
    predicate ? construct.node.findAll().filter(predicate) : [construct]
  )
    .map((resource) => {
      if (CfnResource.isCfnResource(resource)) {
        return resource;
      } else return resource.node.defaultChild;
    })
    .filter((resource) => CfnResource.isCfnResource(resource));

  resources.forEach((resource) => {
    const metadata = resource.getMetadata('checkov') || {};
    metadata['skip'] = [
      ...(metadata['skip'] ?? []),
      ...ids.map((id) => ({ id, comment })),
    ];
    resource.addMetadata('checkov', metadata);
  });
};
