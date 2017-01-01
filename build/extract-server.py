#!/usr/bin/env python

from common import ComposeFile
import os
import sys

if len(sys.argv) < 5:
  print('''
    Usage: python extract-server.py
      docker-compose.latest.yml
      ambassador-image:tag
      redis-instance-ip
      redis-instance-port
  ''')
  exit(1)

# Load the services from the input docker-compose.yml file.
# TODO: run parallel builds.
compose_file = ComposeFile(sys.argv[1])

# Iterate over all services to find redis service
for service_name, service in compose_file.services.items():
    if 'redis' in service['image']:
        redis_service = service_name

# Modify redis service
# Make into ambassador
compose_file.services[redis_service]['image'] = sys.argv[2]

if "REDIS_PORT" not in os.environ:
    redis_port = 6379
else:
    redis_port = os.environ["REDIS_PORT"]
command = "{} {} {}".format(redis_port, sys.argv[3], sys.argv[4])
compose_file.services[redis_service]['command'] = command

# Write the new docker-compose.yml file.
print("Writing Routing-Server composer back to the file")

compose_file.save(sys.argv[1])