set -ex
export NETWORK=kovan-ovm-futures 

until node src/ run -p https://kovan.optimism.io --from-block 0 -n 1; do
    echo "Server 'myserver' crashed with exit code $?.  Respawning.." >&2
    sleep 1
done
