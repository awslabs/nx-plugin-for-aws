import { Stage, StageProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ApplicationStack } from '../stacks/application-stack.js';

/**
 * Defines a collection of CDK Stacks which make up your application
 */
export class ApplicationStage extends Stage {
  constructor(scope: Construct, id: string, props?: StageProps) {
    super(scope, id, props);

    new ApplicationStack(this, 'Application', {
      crossRegionReferences: true,
    });
  }
}
