#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { IacStack } from '../lib/iac-stack';

const app = new cdk.App();
new IacStack(app, 'MultiVoicedPolly');
