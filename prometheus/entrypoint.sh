#!/bin/sh
set -ex

# Generate config.
/bin/confd -onetime -backend env

# Run Prometheus.
/bin/prometheus --config.file=/etc/prometheus/confd-prometheus.yml
