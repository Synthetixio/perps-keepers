# Based off work from @zakkg3
# https://github.com/zakkg3/Prometheus-confd

FROM prom/prometheus

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY confd /etc/confd/
USER root
RUN wget -O /bin/confd https://github.com/kelseyhightower/confd/releases/download/v0.16.0/confd-0.16.0-linux-amd64 && \
      chmod +x /bin/confd && \
      [ "255d2559f3824dd64df059bdc533fd6b697c070db603c76aaf8d1d5e6b0cc334  /bin/confd" = "$(sha256sum /bin/confd)" ] && \
      chmod +x /usr/local/bin/entrypoint.sh

USER nobody
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
