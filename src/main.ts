import axios, { AxiosInstance } from 'axios'
import config from 'config'
import execa from 'execa'
import { writeFileSync } from 'fs'
import { Listr, ListrTask } from 'listr2'
import path from 'path'

import { Ctx, Repositories } from './main.interface'
import { logo } from '@templates/logo.template'
import { Logger } from '@utils/logger'
import { ILogger } from '@utils/logger.interface'

class TrackRepo {
  private logger: ILogger
  private axios: AxiosInstance
  private thisRepo: string
  private trackRepo: string

  constructor () {
    // parse flags
    const debug = process.argv.indexOf('--debug')
    if (debug !== -1) {
      process.env.NODE_ENV = 'debug'
      process.env.PLUGIN_LOGLEVEL = 'debug'
      process.argv.splice(debug, 1)
    }

    if (process.env.NODE_ENV !== 'debug') {
      process.chdir('/drone/src')
    }

    // set environment variables
    process.env.NODE_CONFIG_DIR = path.join(path.dirname(require.main.filename), '../config')

    this.logger = new Logger().log

    this.logger.debug(`Configuration directory: ${process.env.NODE_CONFIG_DIR}`)

    this.logger.direct(logo())
    this.run()
  }

  private async run (): Promise<void> {
    const repositories: Repositories[] = [
      {
        var: 'this-repo',
        env: 'PLUGIN_THIS_REPO',
        class: 'thisRepo',
        name: 'parent repository'
      },
      {
        var: 'track-repo',
        env: 'PLUGIN_TRACK_REPO',
        class: 'trackRepo',
        name: 'tracked repository'
      }
    ]

    await this.checkRequiredVariables(repositories)
    this.initiateAxios()

    try {
      await new Listr<Ctx, 'verbose'>(
        [
          {
            title: 'Plugin error.',
            enabled: (): boolean => !process.env?.DRONE_BUILD_EVENT,
            task: (): void => {
              throw new Error('No DRONE_BUILD_EVENT event found. Is this outdated or running outside Drone environment?')
            }
          },

          {
            task: (ctx, task): Listr => task.newListr(this.getLatestTags(repositories), { concurrent: true })
          },

          {
            title: 'A incremental release will be published.',
            enabled: (): boolean => process.env.DRONE_BUILD_EVENT === 'push' || process.env.DRONE_BUILD_EVENT === 'pull_request' || process.env.DRONE_BUILD_EVENT === 'rollback',
            task: (ctx, task): void => {
              task.output = `Triggered by ${process.env.DRONE_BUILD_EVENT}.`

              const increment: number = parseInt(ctx.thisRepoVersion?.match(new RegExp(/^.*(-[0-9]*)$/))?.[1]?.replace(new RegExp(/^\D+/g), ''), 10)

              ctx.newVersion = `${ctx.thisRepoVersion.replace(new RegExp(/(-[0-9]*)$/), '')}-${increment ? increment + 1 : '0'}`

              task.title = `New release with with ${ctx.newVersion} should be published.`
            }
          },

          {
            title: 'Checking whether a new release should be published.',
            enabled: (): boolean => process.env.DRONE_BUILD_EVENT === 'tag',
            task: (ctx, task): void => {
              // replace the increment part because it is done by this repository
              ctx.thisRepoVersion = ctx.thisRepoVersion?.replace(new RegExp(/(-[0-9]*)$/), '')

              // compare versions, can not use semver because some repositories does not apply it
              if (!(ctx.thisRepoVersion === ctx.trackRepoVersion || `v${ctx.thisRepoVersion}` === ctx.trackRepoVersion || ctx.thisRepoVersion === `v${ctx.trackRepoVersion}`)) {
                // strip v from the tracked repo
                if (this.trackRepo.substring(1) !== 'v') {
                  ctx.newVersion = `v${ctx.trackRepoVersion}`
                } else {
                  ctx.newVersion = ctx.trackRepoVersion
                }

                // if the version is incremented
                task.title = `A new version with ${ctx.newVersion} should be published.`
              } else {
                task.title = 'No need to publish a new version.'
              }
            }
          },

          {
            title: 'Writing to file.',
            enabled: (ctx): boolean => !!ctx.newVersion && config.has('release-file'),
            task: (ctx, task): void => {
              const output = config.get<string>('release-file')

              writeFileSync(output, ctx.newVersion)

              task.title = `Wrote file "${output}".`
            }
          },

          {
            title: 'Writing to environment variable.',
            enabled: (ctx): boolean => !!ctx.newVersion && config.has('environment-variable'),
            task: (ctx, task): void => {
              const output = config.get<string>('environment-variable')

              process.env[output] = ctx.newVersion

              task.title = `Expored environment variable "${output}".`
            }
          },

          {
            title: 'Login to GIT.',
            enabled: (ctx): boolean => !!ctx.newVersion && (config.has('do-tag') || config.has('do-release')),
            task: async (): Promise<void> => {
              if (!config.has('git-username') || !config.has('git-token')) {
                throw new Error('GIT username and GIT password must be set to enable this functionality.')
              }

              await execa.command('git config --global user.name "track-repository"')
              await execa.command('git config --global user.name "$PLUGIN_GIT_USERNAME"')
              await execa.command('git config --global credential.helper store')
              await execa.command('git config --global credential.helper "!f() { echo \'username=${PLUGIN_GIT_USERNAME}\'; echo \'password=${PLUGIN_GIT_TOKEN}\'; }; f"')
            }
          },

          {
            title: 'Do tag.',
            enabled: (ctx): boolean => !!ctx.newVersion && config.has('do-tag'),
            task: async (ctx, task): Promise<void> => {
              await execa.command(`git tag ${ctx.newVersion} && git push origin ${ctx.newVersion}`)

              task.title = 'Published a new GIT tag.'
            }
          },

          {
            title: 'Do release.',
            enabled: (ctx): boolean => !!ctx.newVersion && config.has('do-release'),
            task: async (ctx, task): Promise<void> => {
              const url = `${config.get('api-url')}/repos/${config.get('this-repo')}/releases`
              this.logger.debug(`Will try to post for new release at "${url}".`)

              const res = await this.axios.post(url, {
                // eslint-disable-next-line @typescript-eslint/camelcase
                tag_name: ctx.newVersion,
                // eslint-disable-next-line @typescript-eslint/camelcase
                target_commitish: process.env.DRONE_BRANCH,
                name: ctx.newVersion,
                body:
                  process.env.DRONE_BUILD_EVENT === 'tag'
                    ? `Autoupdated repository tracking the parent repository update on "${config.get('track-repo')}".`
                    : 'Incremental update independent of the parent repository.',
                draft: false,
                prerelease: false
              })

              this.logger.debug(JSON.stringify(res.data))

              if (res.status !== 201) {
                throw new Error('There was a error publishing new release.')
              }

              task.title = 'Published a new GIT release.'
            }
          }
        ],
        {
          renderer: 'verbose'
        }
      ).run()
    } catch (e) {
      this.logger.debug(e.trace)
      process.exit(1)
    }
  }

  private initiateAxios (): void {
    this.axios = axios.create({
      headers: {
        'User-Agent': 'drone-track-repository',
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        Accept: '*/*',
        ...config.has('git-username') && config.has('git-token') ? { Authorization: `Bearer ${config.get('git-token')}` } : {}
      }
    })
  }

  private async checkRequiredVariables (repositories: Repositories[]): Promise<void> {
    // check required variables
    let failed: boolean
    await Promise.all(
      repositories.map((variable) => {
        if (!config.has(variable.var)) {
          this.logger.critical(`Can not find required variable for ${variable.name}. Set it using "${variable.env}" environment variable.`)
          failed = true
        } else {
          this[variable.class] = `${config.get('api-url')}/repos/${config.get(variable.var)}/releases/latest`
        }
      })
    )

    if (failed) {
      this.logger.critical('Can not proceed further.')
      process.exit(127)
    }
  }

  private getLatestTags (repositories: Repositories[]): ListrTask<any, any>[] {
    return repositories.reduce((o, value) => {
      return [
        ...o,
        {
          title: `Getting the latest tag of ${value.name}.`,
          task: async (ctx, task): Promise<void> => {
            this.logger.debug(`Will try to get "${this[value.class]}".`)

            const res = await axios.get(this[value.class])

            this.logger.debug(JSON.stringify(res.data))

            ctx[`${value.class}Version`] = res.data?.tag_name

            if (!ctx[`${value.class}Version`] && value.class !== 'thisRepo') {
              throw new Error(`Can not parse the version of ${value.name}.`)
            }

            task.title = `Current version of ${value.name}: ${ctx[`${value.class}Version`]}`
          }
        }
      ]
    }, [])
  }
}

function bootstrap (): TrackRepo {
  return new TrackRepo()
}

bootstrap()
