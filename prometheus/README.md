prometheus
==========

A dockerised Prometheus setup designed to scrape and upload keeper metrics (uptime, liquidated positions) to a remote Prometheus backend.

 1. Prometheus is started on `localhost:9090`.
 2. Keeper is started, and exposes a scrapable metrics endpoint at `http://localhost:8080`.
 3. Prometheus scrapes the keeper metrics endpoint periodically (currently every 1s).
 4. Using the remote write feature, Prometheus writes these metrics to a remote Prometheus backend - this is configured to be a Grafana cloud instance.

Since Prometheus configurations don't support environment variables, [confd](https://github.com/kelseyhightower/confd) is used to generate config from a template file.

## Usage.

The setup can be run with Docker Compose and configured using environment variables.

 1. `cp .env.example .env`
 2. Configure the remote Prometheus backend:
    
    - `PROM_REMOTE_WRITE_HOST`
    - `PROM_REMOTE_WRITE_USERNAME`
    - `PROM_REMOTE_WRITE_PASSWORD`

 3. Run the Docker container.

    ```sh
    docker-compose --env-file ./.env up
    ```


## Props.

Inspiration taken from https://github.com/zakkg3/Prometheus-confd

