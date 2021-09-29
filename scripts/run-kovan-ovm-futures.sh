set -ex
export NETWORK=kovan-ovm-futures 

until node src/ run -p ws://kovan.optimism.io:8546 --from-block 0 -n 1; do
    echo "Server 'myserver' crashed with exit code $?.  Respawning.." >&2
    sleep 1
done
