export class IcodeError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'IcodeError'
    this.code = options.code || 'ICODE_ERROR'
    this.exitCode = options.exitCode || 1
    this.meta = options.meta || {}
    this.cause = options.cause
  }
}

export function asIcodeError(error, fallbackMessage = '命令执行失败') {
  if (error instanceof IcodeError) {
    return error
  }

  const wrapped = new IcodeError(error?.message || fallbackMessage, {
    cause: error,
    meta: {
      original: error
    }
  })

  return wrapped
}
