# prometheus

A dockerised Prometheus setup designed to scrape and upload keeper metrics (uptime, liquidated positions) to a remote Prometheus backend.

1.  Prometheus is started on `localhost:9090`.
2.  Keeper is started, and exposes a scrapable metrics endpoint at `http://localhost:8080`.
3.  Prometheus scrapes the keeper metrics endpoint periodically (currently every 1s).
4.  Using the remote write feature, Prometheus writes these metrics to a remote Prometheus backend - this is configured to be a Grafana cloud instance.

Since Prometheus configurations don't support environment variables, [confd](https://github.com/kelseyhightower/confd) is used to generate config from a template file.

## Usage.

The setup can be run with Docker Compose and configured using environment variables.

1.  `cp .env.example .env`
2.  Configure the remote Prometheus backend. If using Grafana you can create a prometheus dashboard and the values will be created for you.

    - `PROM_REMOTE_WRITE_HOST`
    - `PROM_REMOTE_WRITE_USERNAME`
    - `PROM_REMOTE_WRITE_PASSWORD`

      The endpoint to scrape from. We start the metric server on port 8084, but since we run this in a docker container we use `host.docker.internal:8084` instead of `localhost:8084`

    - `PROM_ENDPOINT_TO_SCRAPE`

3.  Run the Docker container.

    ```sh
    docker-compose --env-file ./.env up
    ```

## Props.

Inspiration taken from https://github.com/zakkg3/Prometheus-confd
