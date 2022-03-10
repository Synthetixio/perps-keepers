PATH_TO_PRIVATE_KEY=$1
USER_AT_IP=$2
SERVER_PATH=$3
CURRENT=`pwd`
LOCAL_FOLDER_NAME=`basename "$CURRENT"`


confirm() {
    # call with a prompt string or use a default
    read -r -p "${1:-Are .env files updated? [y/N]} " response
    case "$response" in
        [yY][eE][sS]|[yY])
            true
        ;;
        *)
            false
        ;;
    esac
}


confirm || exit 0

ssh -i "$PATH_TO_PRIVATE_KEY" "$USER_AT_IP" mkdir -p "$SERVER_PATH"
echo "Uploading files"
rsync --exclude 'node_modules' --exclude 'build' --exclude 'coverage' --exclude 'cache' -e "ssh -i $1" -Pav "$PWD" "$USER_AT_IP":"$SERVER_PATH"

echo "Installing deps, transpiling typescript and starting keeper"
ssh -i "$PATH_TO_PRIVATE_KEY" "$USER_AT_IP" "cd $LOCAL_FOLDER_NAME;npm i;npm run build;npm run start"
echo "Starting prometheus scraper"
ssh -i "$PATH_TO_PRIVATE_KEY" "$USER_AT_IP" "cd $LOCAL_FOLDER_NAME/prometheus; docker-compose --env-file ./.env up -d"

