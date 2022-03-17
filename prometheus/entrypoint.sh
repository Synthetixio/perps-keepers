#!/bin/sh
set -ex

# Generate config.
/bin/confd -onetime -backend env

# Run Prometheus.
/bin/prometheus --web.config.file=/etc/prometheus/confd-prometheus-web.yml --config.file=/etc/prometheus/confd-prometheus.yml --log.level=debug
