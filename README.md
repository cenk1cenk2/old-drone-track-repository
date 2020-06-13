# drone-track-repository

[![Build Status](https://drone.kilic.dev/api/badges/cenk1cenk2/drone-track-repository/status.svg)](https://drone.kilic.dev/cenk1cenk2/drone-track-repository) [![Docker Pulls](https://img.shields.io/docker/pulls/cenk1cenk2/drone-track-repository)](https://hub.docker.com/repository/docker/cenk1cenk2/drone-track-repository) [![Docker Image Size (latest by date)](https://img.shields.io/docker/image-size/cenk1cenk2/drone-track-repository)](https://hub.docker.com/repository/docker/cenk1cenk2/drone-track-repository) [![Docker Image Version (latest by date)](https://img.shields.io/docker/v/cenk1cenk2/drone-track-repository)](https://hub.docker.com/repository/docker/cenk1cenk2/drone-track-repository) [![GitHub last commit](https://img.shields.io/github/last-commit/cenk1cenk2/drone-track-repository)](https://github.com/cenk1cenk2/drone-track-repository)

Drone plugin to track other repository and act on it!

<!-- toc -->

- [Custom Release File](#custom-release-file)
- [What it does](#what-it-does)

<!-- tocstop -->

## What it does

- Tracks a GIT repository for releases, when combined with a cron job.
  - When a new release is found it triggers to do certain tasks.
  - When a new push has been made to repository it can append the latest tag with `-${number}`.
- It will then output an environment variable and also write to a file which tag should be the upcoming release.
- Rest is up to you. Useful for combining with Docker builds from source, without webhook or downstream setup which in some cases you dont have access to.

## Usage

Add the following to the drone configuration

```yml
kind: pipeline
trigger:
  event:
    - cron
    - push
    - tag
  branch:
    - master

steps:
  - name: semantic-release
    image: cenk1cenk2/drone-track-repository
    settings:
      this_repo: cenk1cenk2/drone-track-repository
      track_repo: cenk1cenk2/some-other-repo
      api_url: # some other git compatible api url. defaults to: https://api.github.com
      # GIT USERNAME AND PASSWORD IS NOT REQUIRED. But if you use it you can increase your API hit limit per hour.
      git_username:
        from_secrets: git_username
      git_password:
        from_secrets: git_password
      release_file: # it will output to a file in the base of the repo. defaults to .tags
```
