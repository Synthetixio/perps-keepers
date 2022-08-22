# prometheus

A dockerised Prometheus setup designed to scrape and upload keeper metrics (uptime, liquidated positions) to a Prometheus backend. You can connect an Grafana instance to this prometheus backend.

1.  Prometheus is started on `localhost:9090`.
2.  Keeper is started, and exposes a scrapable metrics endpoint at `http://localhost:8084`.
3.  Prometheus scrapes the keeper metrics endpoint periodically (currently every 1s).

Since Prometheus configurations don't support environment variables, [confd](https://github.com/kelseyhightower/confd) is used to generate config from a template file.

## Usage.

The setup can be run with Docker Compose and configured using environment variables.

1.  `cp .env.example .env`
2.  Configure the remote Prometheus backend. If using Grafana you can create a prometheus dashboard and the values will be created for you.

    The endpoint to scrape from. We start the metric server on port 8084, but since we run this in a docker container we use `host.docker.internal:8084` instead of `localhost:8084`

    - `PROM_ENDPOINT_TO_SCRAPE` | `PROM_STAGING_ENDPOINT_TO_SCRAPE`

      Some of the metrics cant access label so to be able do differentiate goerli-ovm from mainnet-ovm we can provide a job name

    - `PROM_JOB_NAME` | `PROM_STAGING_JOB_NAME`

      The setup configures prometheus to have basic http auth. This is the password to use. Prometheus expect the password to be encrypted with bcrypt, you can to encrypt with: `htpasswd -nBC 10 "" | tr -d ':\n'`

    - `PROM_HTTP_PASSWORD`

      Exposed port

    - `PROM_PORT` | `PROM_STAGING_PORT`

3.  Run the Docker container.

    ```sh
    docker-compose --env-file ./.env up
    ```

## Deployment notes

When code is merged to `master` the github action `deploy-keeper.yml` will run `docker-compose --env-file ./.env up -d`.
This will start an instance for both goerli-ovm and mainnet-ovm. Currently there's no separate staging deployment

## Props.

Inspiration taken from https://github.com/zakkg3/Prometheus-confd
