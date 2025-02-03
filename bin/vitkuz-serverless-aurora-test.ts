#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { VitkuzServerlessAuroraTestStack } from '../lib/vitkuz-serverless-aurora-test-stack';

const app = new cdk.App();
new VitkuzServerlessAuroraTestStack(app, 'VitkuzServerlessAuroraTestStack', {

  env: { account: '582347504313', region: 'us-east-1' },

});