PATH_TO_PRIVATE_KEY=$1
USER_AT_IP=$2
CURRENT=`pwd`
LOCAL_FOLDER_NAME=`basename "$CURRENT"`

echo "Stopping keeper"
ssh -i "$PATH_TO_PRIVATE_KEY" "$USER_AT_IP" "cd $LOCAL_FOLDER_NAME;npx pm2 stop futures-keeper"
echo "Stopping prometheus"
ssh -i "$PATH_TO_PRIVATE_KEY" "$USER_AT_IP" "cd $LOCAL_FOLDER_NAME/prometheus;docker-compose stop"
