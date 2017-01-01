#!/usr/bin/env python

from common import ComposeFile
import os
import sys

if len(sys.argv) < 2:
  print("Please pass the composer file as the first argument")
  exit(1)

# Load the services from the input docker-compose.yml file.
# TODO: run parallel builds.
compose_file = ComposeFile(sys.argv[1])

# Iterate over all services to find redis service
delete_services = []
redis_service = ""
for service_name, service in compose_file.services.items():
    if 'redis' not in service['image']:
        delete_services.append(service_name)
    else:
        redis_service = service_name

# Delete all other services
for service_name in delete_services:
    del compose_file.services[service_name]

# Modify redis service
# Add outgoing redis port
if('ports' not in compose_file.services[redis_service]):
    compose_file.services[redis_service]['ports'] = []

if "REDIS_PORT" not in os.environ:
    redis_port = 6379
else:
    redis_port = os.environ["REDIS_PORT"]
if "REDIS_EXTERNAL_PORT" not in os.environ:
    redis_external = 32770
else:
    redis_external = os.environ["REDIS_EXTERNAL_PORT"]
compose_file.services[redis_service]['ports'].append("{}:{}".format(redis_external, redis_port))

# Write the new docker-compose.yml file.
print("Writing Redis composer back to the file")

compose_file.save(sys.argv[1])