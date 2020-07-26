import chalk from 'chalk'
import config from 'config'
import figures from 'figures'
import pad from 'pad'
import { createLogger, format, transports } from 'winston'

import { LogLevels } from './logger.constants'
import { LoggerFormat, ILogger } from './logger.interface'

export class Logger {
  static readonly levels = {
    [LogLevels.silent]: 0,
    [LogLevels.direct]: 1,
    [LogLevels.critical]: 1,
    [LogLevels.fail]: 2,
    [LogLevels.warn]: 3,
    [LogLevels.success]: 4,
    [LogLevels.info]: 5,
    [LogLevels.module]: 6,
    [LogLevels.debug]: 7
  }

  public log: ILogger
  public id: string

  constructor (module?: string) {
    this.id = module
    this.log = this.initiateLogger()
  }

  public getInstance (module?: string): ILogger {
    if (!this.log) {
      this.id = module
      this.log = this.initiateLogger()
    }

    this.id = module
    return this.log
  }

  private initiateLogger (): ILogger {
    const loglevel: string = config.get('loglevel')
    const logFormat = format.printf(({ level, message, custom }: LoggerFormat) => {
      // parse multi line messages
      try {
        let multiLineMessage = message.split('\n')
        multiLineMessage = multiLineMessage.map((msg) => {
          // format messages
          return this.logColoring({
            level,
            message: msg,
            module: this.id,
            custom
          })
        })
        // join back multi line messages
        message = multiLineMessage.join('\n')
        // eslint-disable-next-line no-empty
      } catch {}
      return message
    })

    return createLogger({
      level: loglevel || 'module',
      silent: loglevel === 'silent',
      format: format.combine(logFormat),
      levels: Logger.levels,
      transports: [ new transports.Console() ]
    }) as ILogger
  }

  private logColoring ({ level, message, module, custom }: LoggerFormat & { module?: string }): string {
    let context: string
    let icon: string

    // parse context from custom or module
    if (custom) {
      context = custom
    } else if (module) {
      context = module
    } else {
      context = level
    }

    // do the coloring
    let coloring = (input: string): string => {
      return input
    }
    switch (level) {
    case LogLevels.critical:
      coloring = chalk.bgRed.white
      icon = figures.cross
      break
    case LogLevels.fail:
      coloring = chalk.red
      icon = figures.cross
      break
    case LogLevels.warn:
      coloring = chalk.yellow
      icon = figures.warning
      break
    case LogLevels.success:
      coloring = chalk.green
      icon = figures.tick
      break
    case LogLevels.info:
      icon = figures.pointer
      break
    case LogLevels.module:
      coloring = chalk.green
      icon = figures.arrowRight
      break
    case LogLevels.debug:
      coloring = chalk.dim
      icon = figures.play
      break
    default:
      icon = figures.pointer
      break
    }

    if (level === LogLevels.direct) {
      return message
    } else {
      return coloring(`${icon} ${pad(context.toUpperCase(), 10)} | ${message}`)
    }
  }
}
