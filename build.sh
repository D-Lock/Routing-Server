#!/bin/sh
set -e

# Login to docker hub registry
docker login -u="$DOCKER_USERNAME" -p="$DOCKER_PASSWORD"

ORIGINAL_COMPOSE=$COMPOSE_FILE_PATH/$COMPOSE_FILE_NAME
export COMPOSE_FILE=$ORIGINAL_COMPOSE
# Since ECS cannot build, it only uses images
python build/build-tag-push.py

# For fixing YAML scripts made using PyYAML
sh build/fixup-yaml.sh

# Deploy Redis separately for ambassador
mkdir -p $REDIS_BUILD_PATH
export COMPOSE_FILE=$REDIS_BUILD_PATH/$REDIS_BUILD_FILE
cp $ORIGINAL_COMPOSE $COMPOSE_FILE
python build/extract-redis.py $COMPOSE_FILE
sh build/fixup-yaml.sh

# Launch ECS Redis instance
ecs-cli configure --cluster $ECS_CLUSTER_NAME
ecs-cli compose --file $REDIS_BUILD_PATH/$REDIS_BUILD_FILE --project-name $REDIS_PROJECT_NAME up

# Take the IP address of the Redis instance
REDIS_ADDRESS=$(ecs-cli ps | sed -sn 2p | awk '{print $3}')
REDIS_INSTANCE_IP=$(echo $REDIS_ADDRESS | cut -d : -f 1)
REDIS_INSTANCE_PORT=$(echo $REDIS_ADDRESS | cut -d : -f 2 | cut -d \- -f 1)

echo "The Redis instance is running at $REDIS_INSTANCE_IP:$REDIS_INSTANCE_PORT";

# Create the server instance script
export COMPOSE_FILE=$SERVER_BUILD_PATH/$SERVER_BUILD_FILE
cp $ORIGINAL_COMPOSE $COMPOSE_FILE
python build/extract-server.py $COMPOSE_FILE $AMBASSADOR_IMAGE $REDIS_INSTANCE_IP $REDIS_INSTANCE_PORT

# Start the new server
ecs-cli compose --file $SERVER_BUILD_PATH/$SERVER_BUILD_FILE --project-name $SERVER_PROJECT_NAME up
ecs-cli scale --capability-iam --size $SERVER_SCALE