import * as cdk from '@aws-cdk/core';
import * as efs from '@aws-cdk/aws-efs';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as lambda from '@aws-cdk/aws-lambda';
import * as s3 from '@aws-cdk/aws-s3';
import { Duration } from '@aws-cdk/core';
import * as iam from '@aws-cdk/aws-iam';
import { Effect } from '@aws-cdk/aws-iam/lib/policy-statement';

const BUCKET_NAME_PREFIX = 'multi-voiced-polly';

export class IacStack extends cdk.Stack {
  private readonly appName: string;

  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.appName = id;

    const vpc = this.createVpc();

    const fs = this.createFileSystem(vpc);

    const accessPoint = this.createAccessPoint(fs);

    const inputBucket = new s3.Bucket(this, `${this.appName}InputBucket`, {
      encryption: s3.BucketEncryption.S3_MANAGED,
      bucketName: `${BUCKET_NAME_PREFIX}-input-${this.account}-${this.region}`
    });

    const outputBucket = new s3.Bucket(this, `${this.appName}OutputBucket`, {
      encryption: s3.BucketEncryption.S3_MANAGED,
      bucketName: `${BUCKET_NAME_PREFIX}-output-${this.account}-${this.region}`
    });

    this.createLambda(vpc, accessPoint, inputBucket.bucketName, outputBucket.bucketName);
  }

  private createLambda = (vpc: ec2.IVpc, accessPoint: efs.IAccessPoint, inputBucket: string, outputBucket: string)
      : lambda.DockerImageFunction => {
    const dockerfile = '../lambda';

    const multiVoicedPollyLambda = new lambda.DockerImageFunction(this, `${this.appName}LambdaFunction`, {
      code: lambda.DockerImageCode.fromImageAsset(dockerfile),
      functionName: 'multiVoicedPolly',
      memorySize: 256,
      vpc: vpc,
      vpcSubnets: vpc.selectSubnets({
        subnets: vpc.privateSubnets
      }),
      filesystem: lambda.FileSystem.fromEfsAccessPoint(accessPoint, '/mnt/fs'),
      timeout: Duration.seconds(900),
    });

    multiVoicedPollyLambda.role?.attachInlinePolicy(
        new iam.Policy(this, `${this.appName}LambdaPolicy`, {
          statements: this.getMultiVoicedPollyLambdaPolicyStatements(),
        }),
    );

    multiVoicedPollyLambda.addEnvironment('INPUT_BUCKET', inputBucket);
    multiVoicedPollyLambda.addEnvironment('OUTPUT_BUCKET', outputBucket);

    return multiVoicedPollyLambda;
  }

  private createVpc = (): ec2.Vpc => {
    return new ec2.Vpc(this, `${this.appName}Vpc`, {
      maxAzs: 1,
    });
  }

  private createFileSystem = (vpc: ec2.Vpc): efs.FileSystem => {
    return new efs.FileSystem(this, `${this.appName}FileSystem`, {
      vpc,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });
  }

  private createAccessPoint = (fs: efs.FileSystem): efs.IAccessPoint => {
    return fs.addAccessPoint(`${this.appName}AccessPoint`,{
      createAcl: {
        ownerGid: '0',
        ownerUid: '0',
        permissions: '0777'
      },
      path:'/',
      posixUser: {
        gid: '0',
        uid: '0'
      }
    });
  }

  private getMultiVoicedPollyLambdaPolicyStatements = (): Array<iam.PolicyStatement> => {
    const statements: Array<iam.PolicyStatement> = [];

    const listInputObjectsPolicy = new iam.PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['s3:ListObjectsV2'],
      resources: [`arn:aws:s3:::${BUCKET_NAME_PREFIX}-input-${this.account}-${this.region}/*`],
    });

    statements.push(listInputObjectsPolicy);

    const listOutputObjectsPolicy = new iam.PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['s3:ListObjectsV2'],
      resources: [`arn:aws:s3:::${BUCKET_NAME_PREFIX}-output-${this.account}-${this.region}/*`],
    });

    statements.push(listOutputObjectsPolicy);

    const deleteInputObjectsPolicy = new iam.PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['s3:DeleteObjects'],
      resources: [`arn:aws:s3:::${BUCKET_NAME_PREFIX}-input-${this.account}-${this.region}/*`],
    });

    statements.push(deleteInputObjectsPolicy);

    const deleteOutputObjectsPolicy = new iam.PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['s3:DeleteObjects'],
      resources: [`arn:aws:s3:::${BUCKET_NAME_PREFIX}-output-${this.account}-${this.region}/*`],
    });

    statements.push(deleteOutputObjectsPolicy);

    const getInputObjectPolicy = new iam.PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['s3:GetObject'],
      resources: [`arn:aws:s3:::${BUCKET_NAME_PREFIX}-input-${this.account}-${this.region}/*`],
    });

    statements.push(getInputObjectPolicy);

    const getOutputObjectPolicy = new iam.PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['s3:GetObject'],
      resources: [`arn:aws:s3:::${BUCKET_NAME_PREFIX}-output-${this.account}-${this.region}/*`],
    });

    statements.push(getOutputObjectPolicy);

    const listOutputBucketPolicy = new iam.PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['s3:ListBucket'],
      resources: [`arn:aws:s3:::${BUCKET_NAME_PREFIX}-output-${this.account}-${this.region}`],
    });

    statements.push(listOutputBucketPolicy);

    const listInputBucketPolicy = new iam.PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['s3:ListBucket'],
      resources: [`arn:aws:s3:::${BUCKET_NAME_PREFIX}-input-${this.account}-${this.region}`],
    });

    statements.push(listInputBucketPolicy);

    const putObjectPolicy = new iam.PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['s3:PutObject'],
      resources: [`arn:aws:s3:::${BUCKET_NAME_PREFIX}-output-${this.account}-${this.region}/*`],
    });

    statements.push(putObjectPolicy);

    const pollyStartSpeechSynthesisTaskPolicy = new iam.PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['polly:StartSpeechSynthesisTask'],
      resources: [`*`],
    });

    statements.push(pollyStartSpeechSynthesisTaskPolicy);

    const pollyGetSpeechSynthesisTaskPolicy = new iam.PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['polly:GetSpeechSynthesisTask'],
      resources: [`*`],
    });

    statements.push(pollyGetSpeechSynthesisTaskPolicy);

    return statements;
  }
}
