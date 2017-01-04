#!/usr/bin/env python3

import os
import boto3
from botocore.client import Config

# Ensure necessary ENV resources are loaded
kms_alias_target = os.environ.get("KMS_ALIAS")
if not kms_alias_target:
  print("Please set KMS_ALIAS variable")
  exit(1)

env_file = os.environ.get("ENV_FILE")
if not env_file:
  print("Please set ENV_FILE variable")
  exit(1)

env_bucket = os.environ.get("ENV_BUCKET")
if not env_bucket:
  print("Please set ENV_BUCKET variable")
  exit(1)

# Create a new S3 client
s3 = boto3.client('s3', config=Config(signature_version='s3v4'))

# Create a new KMS client
kms = boto3.client('kms')

# Get a list of KMS aliases
aliases = kms.list_aliases()['Aliases']

key_id = None
for alias in aliases:
  if alias['AliasName'] == kms_alias_target:
    key_id = alias['TargetKeyId']

if not key_id:
  print("Could not find the given KMS_ALIAS")
  exit(1)

data = open(env_file, 'rb')
s3.put_object(Bucket=env_bucket, Key='.env', \
  Body=data, ServerSideEncryption='aws:kms', SSEKMSKeyId=key_id)

print("Pushed production environment variables")