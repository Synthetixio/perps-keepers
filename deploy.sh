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

join_path() {
    echo "${1:+$1/}$2" | sed 's#//#/#g'
}

FULL_SERVER_PATH=$(join_path $SERVER_HOME_PATH perps-keepers)

echo "Creating folder if not exists"
ssh "$USER_AT_IP" mkdir -p "$FULL_SERVER_PATH"

echo "Uploading files"
rsync \
    --exclude 'node_modules' \
    --exclude 'build' \
    --exclude 'coverage' \
    --exclude 'cache' \
    --exclude 'git' \
    -e "ssh" -Pav "$PWD/" "$USER_AT_IP":"$FULL_SERVER_PATH"

echo "Installing deps, transpiling typescript"
ssh "$USER_AT_IP" "cd perps-keepers;npm i;npm run build"

echo "Starting mainnet keeper"
ssh "$USER_AT_IP" "cd perps-keepers;npm run start:mainnet"
