import * as cdk from 'aws-cdk-lib';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export class VitkuzServerlessAuroraTestStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create Lambda layer
    const layer = new lambda.LayerVersion(this, 'ReplicateLayer', {
      code: lambda.Code.fromAsset('./scripts/lambda-layer.zip'),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      description: 'Dependencies',
    });

    // Retrieve the default VPC
    const vpc = ec2.Vpc.fromLookup(this, 'DefaultVPC', { isDefault: true });

    // Create a Security Group allowing public access on port 5432
    const securityGroup = new ec2.SecurityGroup(this, 'PublicSG', {
      vpc,
      description: 'Allow public access to PostgreSQL',
      allowAllOutbound: true,
    });

    securityGroup.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(5432),
        'Allow public access to PostgreSQL'
    );

    // Store database credentials securely in Secrets Manager
    const dbSecret = new secretsmanager.Secret(this, 'DBSecret', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'postgres' }),
        generateStringKey: 'password',
        excludeCharacters: '/@"\'\\',
      },
    });

    // Create Aurora Serverless v2 PostgreSQL cluster
    const cluster = new rds.DatabaseCluster(this, 'AuroraCluster', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_2,
      }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC }, // ✅ Allow public subnets (DEV ONLY)
      securityGroups: [securityGroup], // Assign security group at the cluster level
      writer: rds.ClusterInstance.serverlessV2('WriterInstance', {
        publiclyAccessible: true,
      }),
      credentials: rds.Credentials.fromSecret(dbSecret),
      defaultDatabaseName: 'devdb',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Auto delete for development
    });

    // Create a Security Group for the Lambda Function
    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc,
      description: 'Security group for Lambda function',
      allowAllOutbound: true,
    });

    // Define the Lambda function
    const dbLambda = new lambda.Function(this, 'DBLambdaFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      code: lambda.Code.fromAsset('lambda'), // Ensure your Lambda code is located in the 'lambda' directory
      handler: 'index.handler',
      layers: [layer],
      // vpc,
      // allowPublicSubnet: true, // ✅ Allow Lambda to access public subnets (DEV ONLY)
      timeout: cdk.Duration.seconds(900),
      // securityGroups: [lambdaSecurityGroup],
      environment: {
        DB_SECRET_ARN: dbSecret.secretArn,
        DB_HOST: cluster.clusterEndpoint.hostname,
        DEPLOY_TIME: `${Date.now()}`,
      },
    });

    // Grant the Lambda function permissions to read the secret
    dbSecret.grantRead(dbLambda);

    // Output database endpoint & credentials
    new cdk.CfnOutput(this, 'DBEndpoint', {
      value: cluster.clusterEndpoint.hostname,
    });

    new cdk.CfnOutput(this, 'DBSecretArn', {
      value: dbSecret.secretArn,
    });

    new cdk.CfnOutput(this, 'FunctionName', {
      value: dbLambda.functionName,
    });
  }
}
