#!/bin/sh
set -ex




if [ -z $1 ] ; then
    echo "USER:IP parameter required!" && exit 1;
fi
if [ -z $2 ] ; then
    echo "SERVER_HOME_PATH parameter required!" && exit 1;
fi



USER_AT_IP=$1
SERVER_HOME_PATH=$2
BRANCH=${3:-"develop"}

if [ "$BRANCH" = "master" ]; then
    ENVIRONMENT="production"
    FOLDER_NAME="futures-keepers"
else
    FOLDER_NAME="futures-keepers-staging"
    ENVIRONMENT="staging"
fi

join_path() {
    echo "${1:+$1/}$2" | sed 's#//#/#g'
}

FULL_SERVER_PATH=$(join_path $SERVER_HOME_PATH $FOLDER_NAME)

echo "Creating folder if not exists"
ssh "$USER_AT_IP" mkdir -p "$FULL_SERVER_PATH"

echo "Uploading files"
rsync --exclude 'node_modules' --exclude 'build' --exclude 'coverage' --exclude 'cache' -e "ssh" -Pav "$PWD/" "$USER_AT_IP":"$FULL_SERVER_PATH"

echo "Installing deps, transpiling typescript"
ssh "$USER_AT_IP" "cd $FOLDER_NAME;npm i;npm run build"

if [ "$ENVIRONMENT" = "production" ]; then
    echo "Starting mainnet keeper"
    ssh "$USER_AT_IP" "cd $FOLDER_NAME;npm run start-mainnet"
else
    echo "Starting goerli keeper"
    ssh "$USER_AT_IP" "cd $FOLDER_NAME;npm run start-goerli"
fi

if [ "$ENVIRONMENT" = "production" ]; then
    echo "Starting prometheus scraper"
    ssh "$USER_AT_IP" "cd $FOLDER_NAME/prometheus; docker-compose --env-file ./.env up -d"
else
    echo "ENVIRONMENT is $ENVIRONMENT, skipping prometheus and removing prometheus code"
    ssh "$USER_AT_IP" "cd $FOLDER_NAME; rm -r prometheus"
    
fi


