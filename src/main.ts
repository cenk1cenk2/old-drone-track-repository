import axios, { AxiosRequestConfig } from 'axios'
import config from 'config'
import { writeFileSync } from 'fs'
import { Listr, ListrTask } from 'listr2'
import path from 'path'

import { Ctx, Repositories } from './main.interface'
import { logo } from '@templates/logo.template'
import { Logger } from '@utils/logger'
import { ILogger } from '@utils/logger.interface'

class TrackRepo {
  private logger: ILogger = new Logger().log
  private axiosSettings: AxiosRequestConfig
  private thisRepo: string
  private trackRepo: string

  constructor () {
    // set environment variables
    process.env.SUPPRESS_NO_CONFIG_WARNING = 'true'
    process.env.NODE_CONFIG_DIR = path.join(path.dirname(require.main.filename), '../config')

    // parse flags
    const debug = process.argv.indexOf('--debug')
    if (debug !== -1) {
      process.env.NODE_ENV = 'debug'
      process.argv.splice(debug, 1)
    }

    if (process.env.NODE_ENV !== 'debug') {
      process.chdir('/src/drone')
    }

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
      await new Listr<Ctx>(
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
            enabled: (ctx): boolean => !!ctx.newVersion,
            task: (ctx, task): void => {
              const tagsFile = config.get<string>('release_file')

              writeFileSync(tagsFile, ctx.newVersion)

              task.title = `Wrote file ${tagsFile}`
            }
          }
        ],
        { renderer: process.env.NODE_ENV === 'debug' ? 'default' : ('verbose' as 'default') }
      ).run()
    } catch (e) {
      this.logger.debug(e.trace)
    }
  }

  private initiateAxios (): void {
    this.axiosSettings = {
      headers: {
        'User-Agent': 'drone-track-repository'
      }
    }

    if (config.has('git-username') && config.has('git-password')) {
      this.axiosSettings = { ...this.axiosSettings, ...{ auth: { username: config.get('git-username'), password: config.get('git-password') } } }
    }
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
            let res
            try {
              res = await axios.get(this[value.class], this.axiosSettings)
            } catch (e) {
              throw new Error(e)
            }

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
