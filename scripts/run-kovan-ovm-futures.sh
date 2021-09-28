set -ex
export NETWORK=kovan-ovm-futures 
node src/ run -p https://kovan.optimism.io --from-block 0 -n 1
